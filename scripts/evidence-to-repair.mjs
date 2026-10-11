#!/usr/bin/env node
// Offline evidence -> repair demo. No network, no model calls, no hardware.
// Usage: node scripts/evidence-to-repair.mjs <readings.csv> <bridge|ladder|divider|series-parallel> [--verify NODE=VOLTS]
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Same loader shim as instrument-demo.mjs: lets Node's built-in TS stripping load src/*.ts.
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

const args = process.argv.slice(2);
const vi = args.indexOf('--verify');
const verifyArg = vi >= 0 ? args.splice(vi, 2)[1] : undefined;
const [csvPath, fixture] = args;
const { importReadings } = await import('../src/lib/instrument/import.ts');
const { runInvestigation, formatInvestigation, INSTRUMENT_FIXTURES } = await import('../src/lib/instrument/investigate.ts');
const { LOADED_BRIDGE_12V } = await import('../src/lib/circuit/fixtures.ts');
const { repairStep, verifyRepair } = await import('../src/lib/repair/index.ts');
const graphs = { ...INSTRUMENT_FIXTURES, bridge: LOADED_BRIDGE_12V };
const graph = graphs[fixture];
if (!csvPath || !graph) {
  console.error(`usage: node scripts/evidence-to-repair.mjs <readings.csv> <${Object.keys(graphs).join('|')}> [--verify NODE=VOLTS]`);
  process.exit(2);
}
const imported = importReadings(readFileSync(csvPath, 'utf8'), graph);
console.log(`Imported ${imported.observations.length} observation(s) from ${csvPath} [fixture: ${fixture}]`);
for (const r of imported.rejected) console.log(`  rejected row ${r.row}: ${r.reason}`);
console.log('\n' + formatInvestigation(runInvestigation(graph, imported)));
if (!imported.observations.length) process.exit(1);
const rep = repairStep(graph, imported.observations.map(({ node, volts }) => ({ node, volts })));
const p = rep.proposals[0];
if (!p) {
  console.log('\nNo repair proposal above 5% probability.');
  process.exit(1);
}
const f = (v) => v.toFixed(4).padStart(9);
console.log(`\nTop repair proposal [hypothesized, ${(p.probability * 100).toFixed(1)}%]: ${p.title}  (resolves: ${p.resolves})`);
console.log(`  patch: ${p.patch.componentId} ${p.patch.faultedValue} -> ${p.patch.designValue} ${p.patch.unit} (restore confirmed design)`);
console.log('  node   MEASURED  SIMULATED-before  SIMULATED-after');
for (const n of Object.keys(p.after.voltages).filter((n) => n !== 'GND')) {
  const o = p.supportingObservations.find((s) => s.node === n);
  console.log(`  ${n.padEnd(5)} ${o ? f(o.measured) : '        -'}  ${f(p.before.voltages[n])}         ${f(p.after.voltages[n])}`);
}
const v = p.verification;
console.log(`\nVerify: measure ${v.node}, expect ${v.expectVolts.toFixed(4)} V +/- ${v.toleranceVolts.toFixed(4)} V`);
console.log(`  ${v.instruction}`);
console.log(`Uncertainty: ${p.uncertainty}`);
console.log('Actions:');
p.actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
if (verifyArg) {
  const [node, volts] = verifyArg.split('=');
  const r = verifyRepair(v, { node, volts: Number(volts) });
  console.log(`\nVERIFY RESULT [${r.status}] ${r.message}`);
}
