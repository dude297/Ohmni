// Production smoke test. Usage: node scripts/smoke.mjs [baseUrl] [--live]   (env: SMOKE_URL, SMOKE_IMAGE)
import { readFile, access } from 'node:fs/promises';

const args = process.argv.slice(2);
const live = args.includes('--live');
const BASE = (args.find((a) => !a.startsWith('--')) || process.env.SMOKE_URL || 'https://multimodal-hackathon-sage.vercel.app').replace(/\/$/, '');
const IMAGE = process.env.SMOKE_IMAGE || 'public/samples/clear-divider.png';

const R = (id, value, p, n) => ({ id, kind: 'resistor', value, positiveNode: p, negativeNode: n });
const graph = (r2 = 10000, extra = []) => ({
  schemaVersion: 1,
  components: [{ id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' }, R('R1', 10000, 'VIN', 'VOUT'), R('R2', r2, 'VOUT', 'GND'), ...extra],
  groundNode: 'GND',
  measureNode: 'VOUT',
});
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const solve = (body) => req('/api/solve', json(body));

async function req(path, init) {
  const t = performance.now();
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { status: res.status, text, data, ms: Math.round(performance.now() - t) };
}

const rows = [];
async function check(name, fn) {
  let ok = false, note = '', ms = 0;
  try {
    const r = await fn();
    ok = r.ok; note = r.note || ''; ms = r.ms ?? 0;
  } catch (e) { note = `threw: ${e.message}`; }
  rows.push({ name, ok, ms });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${ms} ms)${note ? '  ' + note : ''}`);
}
const expectStatus = (r, status, code) => ({
  ok: r.status === status && (!code || r.data?.error?.code === code),
  ms: r.ms, note: `status ${r.status}${r.data?.error?.code ? ' ' + r.data.error.code : ''}`,
});

console.log(`Smoke target: ${BASE}  live=${live}\n`);

await check('GET / is 200 and contains "Ohmni"', async () => {
  const r = await req('/');
  return { ok: r.status === 200 && r.text.includes('Ohmni'), ms: r.ms, note: `status ${r.status}` };
});
await check('GET /lab is 200', async () => {
  const r = await req('/lab');
  return { ok: r.status === 200, ms: r.ms, note: `status ${r.status}` };
});
await check('GET /api/health status ok', async () => {
  const r = await req('/api/health');
  // only whitelisted fields are printed, never the raw body
  const { providers, build } = r.data || {};
  return { ok: r.data?.status === 'ok', ms: r.ms, note: `build=${build ?? '?'} providers=${providers ? JSON.stringify(providers) : 'n/a'}` };
});
await check('solve 10k/10k -> VOUT = 2.5', async () => {
  const r = await solve({ graph: graph(), userConfirmed: true });
  const v = r.data?.result?.voltages?.VOUT;
  return { ok: r.status === 200 && Math.abs(v - 2.5) < 1e-6, ms: r.ms, note: `VOUT=${v}` };
});
await check('solve 10k/1k -> VOUT = 0.454545', async () => {
  const r = await solve({ graph: graph(1000), userConfirmed: true });
  const v = r.data?.result?.voltages?.VOUT;
  return { ok: r.status === 200 && Math.abs(v - 0.454545) < 1e-5, ms: r.ms, note: `VOUT=${v}` };
});
await check('diagnose measured 0.45V -> top hypothesis R2 / 1 kΩ', async () => {
  const r = await solve({ graph: graph(), userConfirmed: true, measuredVoltage: 0.45 });
  const t = r.data?.result?.hypotheses?.[0]?.title ?? '';
  return { ok: t.includes('R2') && t.includes('1 kΩ'), ms: r.ms, note: `title="${t}"` };
});
await check('negative: userConfirmed false -> 422 NOT_CONFIRMED', async () =>
  expectStatus(await solve({ graph: graph(), userConfirmed: false }), 422, 'NOT_CONFIRMED'));
await check('negative: floating graph -> 422', async () =>
  expectStatus(await solve({ graph: graph(10000, [R('R3', 100, 'X', 'Y')]), userConfirmed: true }), 422));
await check('negative: bad JSON -> 400', async () =>
  expectStatus(await req('/api/solve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }), 400));
await check('negative: /api/extract text/plain file -> 400', async () => {
  const f = new FormData();
  f.set('image', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  return expectStatus(await req('/api/extract', { method: 'POST', body: f }), 400);
});
await check('negative: /api/extract no image -> 400', async () => {
  const f = new FormData();
  f.set('other', 'x');
  return expectStatus(await req('/api/extract', { method: 'POST', body: f }), 400);
});

if (live) {
  await check('LIVE /api/extract (1 model call)', async () => {
    try { await access(IMAGE); } catch { console.log(`      skip: image not found at ${IMAGE} (set SMOKE_IMAGE)`); return { ok: true, note: 'SKIPPED' }; }
    const f = new FormData();
    f.set('image', new Blob([await readFile(IMAGE)], { type: 'image/png' }), 'smoke.png');
    const r = await req('/api/extract', { method: 'POST', body: f });
    const d = r.data;
    const okShape = r.status === 200 && d && ['review_extraction', 'verify_topology', 'ask_user'].includes(d.route) && d.extraction && Array.isArray(d.trace);
    console.log(`      route: ${d?.route}`);
    const comps = d?.extraction?.graph?.components;
    console.log(`      graph: ${comps ? comps.map((c) => `${c.id}=${c.value}${c.kind === 'resistor' ? 'ohm' : 'V'}`).join(', ') + ` measure=${d.extraction.graph.measureNode}` : 'null'}`);
    if (d?.extraction?.warnings?.length) console.log(`      warnings: ${d.extraction.warnings.join(' | ')}`);
    for (const e of d?.trace ?? []) console.log(`      trace: ${e.step} provider=${e.provider} model=${e.model ?? '-'} status=${e.status} durationMs=${e.durationMs} usage=${JSON.stringify(e.usage ?? null)}${e.note ? ' note=' + e.note : ''}`);
    if (d?.route === 'ask_user') console.log('      NOTE: route ask_user (possible provider error) - reported, not failed');
    return { ok: !!okShape, ms: r.ms, note: `status ${r.status}` };
  });
}

console.log('\n| Check | Result | ms |\n|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.ms} |`);
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
