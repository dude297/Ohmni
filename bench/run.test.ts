import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { probeStep } from '../src/lib/probe';
import { buildSets, runSet, summarize } from './calibration';
import { CORPUS, evaluateGrounding } from './grounding-corpus';
import { solveDC } from '../src/lib/circuit/solve';
import { stress, tinyR1, kclViolation } from './solver-stress';

// Run: BENCH=1 BENCH_LABEL=after npx vitest run bench   (writes bench/report/<label>.json, git-ignored)
const SEED = Number(process.env.BENCH_SEED) || 20261012; // BENCH_SEED: held-out split for tuning checks
it.skipIf(!process.env.BENCH)('bench: probe calibration + grounding corpus', () => {
  const rows = buildSets(SEED, 300).map((s, i) => runSet(probeStep, s, SEED + i));
  const report = { label: process.env.BENCH_LABEL ?? 'run', seed: SEED, summary: summarize(rows), rows, grounding: evaluateGrounding(CORPUS), solver: { ...stress(solveDC), tinyR1Violation: kclViolation(tinyR1(), solveDC(tinyR1())), tinyR1Warnings: solveDC(tinyR1()).warnings ?? [] } };
  mkdirSync('bench/report', { recursive: true });
  writeFileSync(`bench/report/${report.label}.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ summary: report.summary, grounding: report.grounding.summary, solver: report.solver, gFA: report.grounding.falseAccepts, gFR: report.grounding.falseRejects }, null, 1));
}, 1_800_000);
