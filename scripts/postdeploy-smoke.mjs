// Post-deploy smoke: waits until <url>/api/health reports the expected commit, then hits cheap non-model endpoints.
// Usage: node scripts/postdeploy-smoke.mjs <baseUrl> <commitSha>   (env: SMOKE_URL, EXPECTED_SHA, SMOKE_TIMEOUT_S default 600)
// No model calls, no secrets. Exit 1 on any failure.
const [argUrl, argSha] = process.argv.slice(2);
const BASE = (argUrl || process.env.SMOKE_URL || 'https://multimodal-hackathon-sage.vercel.app').replace(/\/$/, '');
const SHA = (argSha || process.env.EXPECTED_SHA || '').slice(0, 7);
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_S || 600) * 1000;
if (SHA.length < 7) throw new Error('expected commit SHA required (arg 2 or EXPECTED_SHA)');

const get = async (path, init) => {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { res, data };
};

let build = '';
while (Date.now() < deadline) {
  try {
    build = (await get('/api/health')).data?.build ?? '';
    if (build.slice(0, 7) === SHA) break;
  } catch {}
  console.log(`waiting: ${BASE} reports build "${build}", want ${SHA}`);
  await new Promise((r) => setTimeout(r, 15000));
}
if (build.slice(0, 7) !== SHA) {
  console.error(`FAIL deployed build "${build}" != expected ${SHA} after timeout`);
  process.exit(1);
}
console.log(`PASS /api/health build ${build}`);

const R = (id, value, p, n) => ({ id, kind: 'resistor', value, positiveNode: p, negativeNode: n });
const graph = {
  schemaVersion: 1,
  components: [{ id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' }, R('R1', 10000, 'VIN', 'VOUT'), R('R2', 10000, 'VOUT', 'GND')],
  groundNode: 'GND',
  measureNode: 'VOUT',
};
const bridge = {
  schemaVersion: 1,
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 12, positiveNode: 'VIN', negativeNode: 'GND' },
    R('R1', 1000, 'VIN', 'A'), R('R2', 2000, 'A', 'GND'), R('R3', 1500, 'VIN', 'B'), R('R4', 1000, 'B', 'GND'),
    R('R5', 3300, 'A', 'B'), R('R6', 680, 'B', 'C'), R('R7', 1200, 'C', 'GND'),
  ],
  groundNode: 'GND',
  measureNode: 'C',
};
const bridgeObs = [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }, { node: 'B', volts: 5.22 }];
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

const checks = [
  ['POST /api/solve divider -> VOUT 2.5 V', async () => {
    const { res, data } = await get('/api/solve', post(JSON.stringify({ graph, userConfirmed: true })));
    const v = data?.result?.voltages?.VOUT ?? data?.voltages?.VOUT;
    return res.status === 200 && Math.abs(v - 2.5) < 1e-6 ? null : `status ${res.status}, VOUT ${v}`;
  }],
  ['POST /api/solve bad JSON -> 400', async () => {
    const { res } = await get('/api/solve', post('{nope'));
    return res.status === 400 ? null : `status ${res.status}`;
  }],
  // Demo bridge, C reads 0 V: the guide must land on R6 open, the repair must target it, and verify must be server-judged.
  ['POST /api/probe bridge C=0, A=7.533, B=5.22 -> R6 open, done', async () => {
    const { res, data } = await get('/api/probe', post(JSON.stringify({ graph: bridge, userConfirmed: true, observations: bridgeObs })));
    const top = data?.result?.hypotheses?.[0];
    return res.status === 200 && top?.id === 'R6:open' && top.probability > 0.9 && data.result.done === true ? null : `status ${res.status}, top ${top?.id} ${top?.probability}`;
  }],
  ['POST /api/repair + /api/repair/verify bridge -> R6 fix, verified at the server expectation only', async () => {
    const { res, data } = await get('/api/repair', post(JSON.stringify({ graph: bridge, userConfirmed: true, observations: bridgeObs })));
    const p = data?.result?.proposals?.[0];
    if (res.status !== 200 || p?.hypothesisId !== 'R6:open') return `repair status ${res.status}, first ${p?.hypothesisId}`;
    const verify = (volts) => get('/api/repair/verify', post(JSON.stringify({ graph: bridge, userConfirmed: true, hypothesisId: 'R6:open', revisionId: data.result.revisionId, measured: { node: p.verification.node, volts } })));
    const ok = await verify(p.verification.expectVolts);
    const off = await verify(p.verification.expectVolts + 1);
    if (ok.res.status !== 200 || ok.data?.result?.verified !== true) return `verify ok status ${ok.res.status}, verified ${ok.data?.result?.verified}`;
    return off.data?.result?.verified === false ? null : `off-by-1V verified ${off.data?.result?.verified}`;
  }],
  ['GET /api/v1/workspaces without token -> 503 (persistence off) or 401', async () => {
    const { res, data } = await get('/api/v1/workspaces');
    const code = data?.error?.code;
    return (res.status === 503 && code === 'PERSISTENCE_DISABLED') || (res.status === 401 && code === 'UNAUTHENTICATED') ? null : `status ${res.status} ${code}`;
  }],
  ['GET /probe -> 200, core tier, security headers', async () => {
    const { res } = await get('/probe');
    const h = res.headers;
    if (res.status !== 200) return `status ${res.status}`;
    if (h.get('x-ohmni-tier') !== 'core') return `x-ohmni-tier ${h.get('x-ohmni-tier')}`;
    if (h.get('x-content-type-options') !== 'nosniff') return 'missing nosniff';
    if (!h.get('strict-transport-security')) return 'missing HSTS';
    if (!/frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '')) return 'missing enforcing CSP';
    return null;
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  const why = await fn().catch((e) => String(e));
  console.log(`${why ? 'FAIL' : 'PASS'} ${name}${why ? `: ${why}` : ''}`);
  if (why) failed++;
}
process.exit(failed ? 1 : 0);
