// Live Gemini vs Groq comparison on fixtures/circuits. Sequential, paced for free-tier limits, ONE attempt per call.
// Usage: node scripts/vision-compare.mjs [--env <path to .env.local>] [--gap-ms 8000] [--only gemini|groq] [--json out.json]
// Keys are loaded from the env file and never printed.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const envFile = arg('--env', join(root, '.env.local'));
const gap = Number(arg('--gap-ms', 8000));
const only = arg('--only', '');

try {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.error(`no env file at ${envFile}; relying on process.env`);
}

// Let node's TS type-stripping resolve the repo's extensionless relative imports.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!/\\.\\w+$/.test(s))return n(s+'.ts',c);throw e}}`,
    ),
);
const { extractCircuit } = await import('../src/lib/ai/gemini.ts');
const { extractWithGroq } = await import('../src/lib/ai/groq.ts');
const { validateGraph } = await import('../src/lib/circuit/validate.ts');

const expected = JSON.parse(readFileSync(join(root, 'fixtures/circuits/expected.json'), 'utf8')).circuits;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

function componentAccuracy(exp, got) {
  const pool = [...got];
  let hit = 0;
  for (const e of exp) {
    const i = pool.findIndex((g) => g.kind === e.kind && close(g.value, e.value));
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  return hit / Math.max(exp.length, got.length);
}

const sig = (c, map) => {
  const a = map(c.positiveNode), b = map(c.negativeNode);
  return `${c.kind}|${c.value}|${c.kind === 'resistor' ? [a, b].sort().join(',') : `${a},${b}`}`;
};
function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
/** Graph isomorphism up to renaming of non-ground nodes (ground and the measure node must correspond). */
function sameTopology(expG, got) {
  const nodes = (comps) => [...new Set(comps.flatMap((c) => [c.positiveNode, c.negativeNode]))].filter((n) => n !== 'GND');
  const en = nodes(expG.components), gn = nodes(got.components);
  if (en.length !== gn.length || expG.components.length !== got.components.length) return false;
  const target = expG.components.map((c) => sig(c, (n) => n)).sort().join(';');
  return permutations(en).some((perm) => {
    const m = new Map(gn.map((n, i) => [n, perm[i]]));
    const map = (n) => (n === 'GND' ? 'GND' : m.get(n));
    return map(got.measureNode) === expG.measureNode && got.components.map((c) => sig(c, map)).sort().join(';') === target;
  });
}

const gem = (m) => ['google', m, (img) => { process.env.GEMINI_MODEL = m; return extractCircuit(img, 'image/png'); }, 'GEMINI_API_KEY'];
const providers = [
  gem('gemini-3.8-flash'),
  gem('gemini-3.5-flash'),
  ['groq', process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b', (img) => extractWithGroq(img, 'image/png'), 'GROQ_API_KEY'],
].filter(([p]) => !only || (only === 'gemini' ? p === 'google' : p === only));

const results = [];
const stopped = {};
for (const [provider, model, run, keyName] of providers) {
  let streak = 0;
  if (!process.env[keyName]) {
    console.log(`${provider}: ${keyName} not set - NOT RUN live`);
    continue;
  }
  for (const [file, exp] of Object.entries(expected)) {
    if (streak >= 3) { stopped[model] = `stopped early after ${streak} consecutive rate-limit/unavailable errors`; break; }
    const img = new Uint8Array(readFileSync(join(root, 'fixtures/circuits', file)));
    let r;
    try {
      r = await run(img);
    } catch (e) {
      r = { extraction: { graph: null }, event: { durationMs: 0 }, failure: e?.message || 'threw' };
    }
    const g = r.extraction.graph;
    const apiError = !!r.failure && r.failure !== 'malformed_output';
    const valid = !!g && validateGraph(g).ok;
    results.push({
      provider, model, file, apiError, failure: r.failure ?? null,
      invalid: !apiError && !valid,
      componentAccuracy: g ? componentAccuracy(exp.components, g.components) : 0,
      topologyExact: g ? sameTopology(exp, g) : false,
      latencyMs: r.event.durationMs, inputTokens: r.event.usage?.inputTokens ?? null, outputTokens: r.event.usage?.outputTokens ?? null,
      warnings: r.extraction.warnings,
    });
    const x = results.at(-1);
    streak = ['rate_limited', 'quota_exhausted', 'model_unavailable', 'timeout'].includes(x.failure) ? streak + 1 : 0;
    console.log(`${provider} ${file}: ${x.apiError ? `API ERROR ${x.failure}` : x.invalid ? 'INVALID' : `acc=${x.componentAccuracy.toFixed(2)} topo=${x.topologyExact}`} ${x.latencyMs}ms`);
    await sleep(gap);
  }
}

const out = arg('--json', '');
if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(results, null, 1));

console.log('\n| provider | model | calls | API errors | invalid output | component acc (mean) | topology exact | mean latency ms | tokens in/out (mean) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [provider, model] of providers) {
  const rs = results.filter((r) => r.provider === provider && r.model === model);
  if (!rs.length) continue;
  const ok = rs.filter((r) => !r.apiError);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const tok = (k) => mean(ok.map((r) => r[k]).filter((v) => v != null));
  console.log(
    `| ${provider} | ${model} | ${rs.length} | ${rs.length - ok.length} | ${ok.filter((r) => r.invalid).length}/${ok.length} | ${mean(ok.map((r) => r.componentAccuracy)).toFixed(2)} | ${ok.filter((r) => r.topologyExact).length}/${ok.length} | ${mean(ok.map((r) => r.latencyMs)).toFixed(0)} | ${tok('inputTokens').toFixed(0)}/${tok('outputTokens').toFixed(0)} |`,
  );
}

for (const [m, why] of Object.entries(stopped)) console.log(`NOTE ${m}: ${why}`);
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN; };
for (const [, model] of providers) { const ok = results.filter((r) => r.model === model && !r.apiError); if (ok.length) console.log(`median latency ${model}: ${med(ok.map((r) => r.latencyMs))}ms`); }
console.log('failures:', JSON.stringify(results.filter((r) => r.failure).map((r) => [r.model, r.file, r.failure])));
