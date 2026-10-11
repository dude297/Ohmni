// RESEARCH (research/topology-confidence-moonshot): free-tier junction self-report experiment.
// Usage:
//   node scripts/topology-probe.mjs report --out <dir> [--env .env.local] [--gap-ms 25000] [--only groq|gemini] img1.png ...
//   node scripts/topology-probe.mjs crop   --out <dir> [--env .env.local] crop1.png ...   (gemini flash-lite only)
// Sequential, ONE attempt per call, no Jev, no OpenAI. Keys come from the env file and are never printed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const files = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
const out = flag('--out', join(root, 'topology-probe-out'));
const gap = Number(flag('--gap-ms', 25000));
const only = flag('--only', '');
mkdirSync(out, { recursive: true });

try {
  for (const line of readFileSync(flag('--env', join(root, '.env.local')), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.error('no env file; relying on process.env');
}
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!/\\.\\w+$/.test(s))return n(s+'.ts',c);throw e}}`,
));
const { EXTRACTION_PROMPT, responseJsonSchema, toCandidateExtraction } = await import('../src/lib/ai/extractionSchema.ts');
const { CROSSING_REPORT_PROMPT, assessTopology } = await import('../src/lib/topology/crossings.ts');
const { GoogleGenAI } = await import('@google/genai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (f) => readFileSync(f).toString('base64');
const strip = (t) => (t ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:json)?|```$/gm, '').trim();

async function groq(prompt, file) {
  const t = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(file)}` } }] }],
    }),
  });
  const ms = Date.now() - t;
  if (!res.ok) return { ms, error: `HTTP ${res.status}` };
  const j = await res.json();
  return { ms, text: strip(j.choices?.[0]?.message?.content), usage: j.usage && [j.usage.prompt_tokens, j.usage.completion_tokens] };
}

const LITE = 'gemini-3.5-flash-lite';
async function gemini(prompt, file) {
  const t = Date.now();
  try {
    const r = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent({
      model: LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: b64(file) } }] }],
      config: { temperature: 0, responseMimeType: 'application/json', abortSignal: AbortSignal.timeout(30_000) },
    });
    const u = r.usageMetadata;
    return { ms: Date.now() - t, text: strip(r.text), usage: u && [u.promptTokenCount, u.candidatesTokenCount] };
  } catch (e) {
    return { ms: Date.now() - t, error: `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const log = [];

if (mode === 'report') {
  const prompt = `${EXTRACTION_PROMPT}\n${CROSSING_REPORT_PROMPT}\nRespond with a single JSON object (no prose). Base fields follow this JSON schema: ${JSON.stringify(responseJsonSchema)}`;
  const providers = [['groq', groq], ['gemini', gemini]].filter(([p]) => !only || p === only);
  for (const f of files) {
    for (const [p, call] of providers) {
      const r = await call(prompt, f);
      const raw = r.text ? parse(r.text) : null;
      const ext = raw ? toCandidateExtraction(raw) : null;
      const a = raw ? assessTopology(ext.graph, raw) : null;
      const row = { file: basename(f), provider: p, ms: r.ms, usage: r.usage, error: r.error ?? (r.text && !raw ? 'malformed' : undefined),
        graph: ext?.graph ? ext.graph.components.map((c) => `${c.id}:${c.positiveNode}-${c.negativeNode}`).join(' ') + ` m=${ext.graph.measureNode}` : null,
        warnings: ext?.warnings, unresolved: ext?.unresolvedConnections, junctions: raw?.junctions, danglingEnds: raw?.danglingEnds, componentBoxes: raw?.componentBoxes,
        escalation: a?.escalation, suspects: a?.suspects };
      log.push(row);
      writeFileSync(join(out, `${basename(f, '.png')}.${p}.raw.txt`), r.text ?? r.error ?? '');
      console.log(`${row.file} ${p} ${r.ms}ms ${row.error ?? ''} graph=${row.graph} esc=${row.escalation} suspects=${(a?.suspects ?? []).map((s) => s.kind).join(',')}`);
      await sleep(p === 'groq' ? 2000 : gap);
    }
  }
} else if (mode === 'reassess') {
  // Offline: re-run the deterministic assessor over saved *.raw.txt model outputs. No API calls.
  for (const f of files) {
    const raw = parse(readFileSync(f, 'utf8'));
    const ext = raw ? toCandidateExtraction(raw) : null;
    const a = raw ? assessTopology(ext.graph, raw) : null;
    const row = { file: basename(f), graph: !!ext?.graph, modelWarnings: ext?.warnings.length ?? 0, escalation: a?.escalation,
      suspects: a?.suspects.map((s) => `${s.kind}${s.junctionId ? `@${s.junctionId}` : ''}${s.measureDelta != null ? ` dV=${s.measureDelta}` : ''}`) };
    log.push(row);
    console.log(JSON.stringify(row));
  }
} else if (mode === 'crop') {
  const prompt = 'This is a crop of a circuit schematic, centred on a point where wire lines meet or cross. ' +
    'Answer only what is visible. JSON: {"lineCount": number of wire arms meeting at the centre, "dotPresent": true|false|null, ' +
    '"connected": true|false|null (by schematic convention: a filled dot = connected; two lines crossing without a dot = NOT connected), "confidence": 0..1}';
  for (const f of files) {
    const r = await gemini(prompt, f);
    const row = { file: basename(f), provider: LITE, ms: r.ms, usage: r.usage, error: r.error, answer: r.text ? parse(r.text) ?? r.text : null };
    log.push(row);
    console.log(JSON.stringify(row));
    await sleep(gap);
  }
}
writeFileSync(join(out, `${mode}.json`), JSON.stringify(log, null, 1));
