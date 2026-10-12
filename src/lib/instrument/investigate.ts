import type { CircuitGraph, SolveResponse } from '../circuit/types';
import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from '../circuit/fixtures';
import { validateGraph } from '../circuit/validate';
import { diagnose } from '../diagnosis';
import { probeStep, type Observation } from '../probe';
import type { ImportedObservation, ImportResult } from './import';

// Replays imported meter readings through the existing Probe Guide, one reading at a time, and
// records how each hypothesis's probability moves. The solver/probe/diagnosis code is untouched.

export type HypothesisSnapshot = { id: string; title: string; probability: number; delta: number };
export type InvestigationStep = {
  index: number; // 0 = before any reading
  added: ImportedObservation | null;
  observations: Observation[]; // prefix fed to probeStep
  top: HypothesisSnapshot[]; // top 3 by probability; delta vs the previous step (0 at index 0)
  gained: HypothesisSnapshot | null; // biggest probability gain this step
  lost: HypothesisSnapshot | null; // biggest probability loss this step
  next: { node: string; expectedBits: number; instruction: string } | null;
  done: boolean;
  reason: string;
  fitWarning?: string;
  diagnosis?: NonNullable<SolveResponse['hypotheses']>; // diagnose() when this step adds graph.measureNode
};
export type Investigation = { steps: InvestigationStep[]; safety: string } | { error: string };

const TOP_N = 3;

export function runInvestigation(graph: CircuitGraph, imported: ImportResult): Investigation {
  const v = validateGraph(graph);
  if (!v.ok) return { error: `invalid circuit graph: ${v.errors.join('; ')}` };
  const steps: InvestigationStep[] = [];
  let prev = new Map<string, number>();
  let safety = '';
  for (let k = 0; k <= imported.observations.length; k++) {
    const added = k ? imported.observations[k - 1] : null;
    const observations = imported.observations.slice(0, k).map(({ node, volts }) => ({ node, volts }));
    const s = probeStep(v.graph, observations);
    safety = s.safety;
    const all = s.hypotheses.map((h) => ({
      id: h.id,
      title: h.title,
      probability: h.probability,
      delta: k ? h.probability - (prev.get(h.id) ?? 0) : 0,
    }));
    prev = new Map(all.map((h) => [h.id, h.probability]));
    const byDelta = [...all].sort((a, b) => b.delta - a.delta);
    const up = byDelta[0];
    const down = byDelta[byDelta.length - 1];
    steps.push({
      index: k,
      added,
      observations,
      top: all.slice(0, TOP_N),
      gained: up && up.delta > 0 ? up : null,
      lost: down && down.delta < 0 ? down : null,
      next: s.next && { node: s.next.node, expectedBits: s.next.expectedBits, instruction: s.next.instruction },
      done: s.done,
      reason: s.reason,
      fitWarning: s.fitWarning,
      diagnosis: added?.node === v.graph.measureNode ? diagnose(v.graph, added.volts) : undefined,
    });
  }
  return { steps, safety };
}

// 5 V -> R1 -> A -> R2 -> B -> R3 -> GND, all 10k, measure B (same ladder as tests/probe).
export const LADDER_10K: CircuitGraph = {
  schemaVersion: 1,
  groundNode: 'GND',
  measureNode: 'B',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10000, positiveNode: 'VIN', negativeNode: 'A' },
    { id: 'R2', kind: 'resistor', value: 10000, positiveNode: 'A', negativeNode: 'B' },
    { id: 'R3', kind: 'resistor', value: 10000, positiveNode: 'B', negativeNode: 'GND' },
  ],
};

export const INSTRUMENT_FIXTURES: Record<string, CircuitGraph> = {
  ladder: LADDER_10K,
  divider: DIVIDER_10K_10K,
  'series-parallel': SERIES_PARALLEL_12V,
};

/** Plain-text table of an investigation, for the CLI. */
export function formatInvestigation(inv: Investigation): string {
  if ('error' in inv) return `ERROR: ${inv.error}`;
  const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
  const sgn = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`;
  const out: string[] = [];
  for (const s of inv.steps) {
    const head = s.added
      ? `Step ${s.index}: ${s.added.node} = ${+s.added.volts.toPrecision(4)} V  (rows ${s.added.rows.join(', ')})`
      : 'Step 0: no readings (prior)';
    out.push(head);
    for (const h of s.top) out.push(`   ${pct(h.probability).padStart(6)}  ${s.index ? sgn(h.delta).padStart(9) : ''.padStart(9)}  ${h.title}`);
    if (s.gained) out.push(`   gained most: ${s.gained.title} (${sgn(s.gained.delta)})`);
    if (s.lost) out.push(`   lost most:   ${s.lost.title} (${sgn(s.lost.delta)})`);
    out.push(`   ${s.done ? 'DONE' : 'next'}: ${s.reason}`);
    if (s.fitWarning) out.push(`   warning: ${s.fitWarning}`);
    if (s.diagnosis) for (const d of s.diagnosis) out.push(`   diagnose(): ${d.title}`);
    out.push('');
  }
  out.push(`Safety: ${inv.safety}`);
  return out.join('\n');
}
