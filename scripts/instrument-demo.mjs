#!/usr/bin/env node
// Offline instrument-evidence demo. No network, no model calls, no hardware.
// Usage: node scripts/instrument-demo.mjs <readings.csv> <ladder|divider|series-parallel> [--latest]
// (`npx tsx scripts/instrument-demo.mjs ...` also works where tsx is installed.)
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Let Node's built-in TypeScript stripping load src/*.ts: resolve the repo's extensionless relative
// imports and mark .ts files as ES modules (the package.json has no "type").
register(
  'data:text/javascript,' +
    encodeURIComponent(`async function find(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (!s.startsWith('.') || /\\.[cm]?[jt]s$/.test(s)) throw e;
    try { return await next(s + '.ts', c); } catch { return next(s + '/index.ts', c); }
  }
}
export async function resolve(s, c, next) {
  const r = await find(s, c, next);
  return r.url.endsWith('.ts') ? { ...r, format: 'module-typescript' } : r;
}`),
);

const [csvPath, fixture, flag] = process.argv.slice(2);
const { importReadings } = await import('../src/lib/instrument/import.ts');
const { runInvestigation, formatInvestigation, INSTRUMENT_FIXTURES } = await import('../src/lib/instrument/investigate.ts');
const graph = INSTRUMENT_FIXTURES[fixture];
if (!csvPath || !graph) {
  console.error(`usage: node scripts/instrument-demo.mjs <readings.csv> <${Object.keys(INSTRUMENT_FIXTURES).join('|')}> [--latest]`);
  process.exit(2);
}
const result = importReadings(readFileSync(csvPath, 'utf8'), graph, { policy: flag === '--latest' ? 'latest' : 'reject' });
console.log(
  `Imported ${result.observations.length} observation(s) from ${result.provenance.length} usable row(s) of ${csvPath} [fixture: ${fixture}]`,
);
for (const r of result.rejected) console.log(`  rejected row ${r.row}: ${r.reason}`);
for (const w of result.warnings) console.log(`  warning: ${w}`);
console.log('');
console.log(formatInvestigation(runInvestigation(graph, result)));
