import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';
import { probeStep, type FaultHypothesis, type Observation, type ProbePrediction, type ProbeStep } from '../probe';

// Two-fault Probe Guide (moonshot). Same return shape as probeStep plus optional extras, so a UI can swap it in.
// Singles + pairs of single faults on DIFFERENT components; every pair is re-solved by solveDC with both patches.
// Copies probeStep's fault set and scoring constants (src/lib/probe is not edited); maxFaults 1 delegates to probeStep.

export type MultiOpts = { maxFaults: 1 | 2; pairPrior?: number };
export type ProbeStepMulti = ProbeStep & {
  pairCandidates: number; // pair candidates enumerated (before equivalence merging)
  pairsSolved: number; // pairs kept as distinct hypotheses
  notes: string[]; // equivalence merges
  warnings: string[]; // e.g. combinatorics cap
};

export const MAX_PAIR_CANDIDATES = 2000;
export const DEFAULT_PAIR_PRIOR = 0.1; // pair prior = 0.1 x a single fault's prior (two independent faults are rarer)
const EQ_TOL = 1e-9;
const R_SHORT = 1e-3;
const R_OPEN = 1e9;
const NOMINAL_PRIOR = 0.5;
const DONE_P = 0.9;
const MIN_BITS = 0.05;
const SAFETY =
  'Low-voltage DC only. Measure node voltages with the black probe on GND. Disconnect power before measuring resistance or touching parts. These are hypotheses, not confirmed faults.';
const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01;
const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
const fmtOhm = (r: number) =>
  r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`;

type Fault = { comp: string; id: string; title: string; value: number };

function faultsOf(g: CircuitGraph): Fault[] {
  const out: Fault[] = [];
  for (const c of g.components) {
    if (c.kind === 'resistor') {
      const f = (k: string, title: string, value: number) => out.push({ comp: c.id, id: `${c.id}:${k}`, title, value });
      f('open', `${c.id} open / not connected`, R_OPEN);
      f('short', `${c.id} shorted (bridge or stray wire)`, R_SHORT);
      f('x10', `${c.id} is ${fmtOhm(c.value * 10)}, not ${fmtOhm(c.value)} (band misread)`, c.value * 10);
      f('x0.1', `${c.id} is ${fmtOhm(c.value / 10)}, not ${fmtOhm(c.value)} (band misread)`, c.value / 10);
    } else out.push({ comp: c.id, id: `${c.id}:dead`, title: `Supply ${c.id} off / dead / disconnected`, value: 0 });
  }
  return out;
}

function patch(g: CircuitGraph, fs: Fault[]): CircuitGraph {
  return { ...g, components: g.components.map((c) => { const f = fs.find((x) => x.comp === c.id); return f ? { ...c, value: f.value } : c; }) };
}

function trysolve(g: CircuitGraph): Record<string, number> | null {
  try {
    const { voltages } = solveDC(g);
    return Object.values(voltages).every(Number.isFinite) ? voltages : null;
  } catch {
    return null;
  }
}

const entropy = (ps: number[]) => -ps.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);

function outcomes(hs: FaultHypothesis[], node: string): ProbePrediction[] {
  const sorted = hs.filter((h) => h.probability > 1e-3).sort((a, b) => a.predicted[node] - b.predicted[node]);
  const groups: ProbePrediction[] = [];
  for (const h of sorted) {
    const v = h.predicted[node];
    const last = groups.at(-1);
    if (last && Math.abs(v - last.volts) <= 2 * sigma(last.volts)) {
      last.hypothesisIds.push(h.id);
      last.probability += h.probability;
    } else groups.push({ volts: v, hypothesisIds: [h.id], probability: h.probability });
  }
  return groups;
}

export function probeStepMulti(graph: CircuitGraph, observations: Observation[] = [], opts: MultiOpts = { maxFaults: 1 }): ProbeStepMulti {
  const extras = { pairCandidates: 0, pairsSolved: 0, notes: [] as string[], warnings: [] as string[] };
  const singles = faultsOf(graph);
  let pairCandidates = 0;
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) if (singles[i].comp !== singles[j].comp) pairCandidates++;
  extras.pairCandidates = pairCandidates;
  if (opts.maxFaults === 1 || pairCandidates === 0) return { ...probeStep(graph, observations), ...extras };
  if (pairCandidates > MAX_PAIR_CANDIDATES) {
    extras.warnings.push(`${pairCandidates} two-fault candidates exceeds the ${MAX_PAIR_CANDIDATES} cap; falling back to single faults only.`);
    return { ...probeStep(graph, observations), ...extras };
  }

  type Cand = { id: string; title: string; prior: number; predicted: Record<string, number>; pair: boolean };
  const singlePrior = (1 - NOMINAL_PRIOR) / singles.length; // same as probeStep
  const pairPrior = (opts.pairPrior ?? DEFAULT_PAIR_PRIOR) * singlePrior;
  const kept: Cand[] = [];
  const nominal = trysolve(graph);
  if (nominal) kept.push({ id: 'nominal', title: 'Circuit matches the confirmed diagram', prior: NOMINAL_PRIOR, predicted: nominal, pair: false });
  for (const f of singles) {
    const v = trysolve(patch(graph, [f]));
    if (v) kept.push({ id: f.id, title: f.title, prior: singlePrior, predicted: v, pair: false });
  }
  const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).every((n) => Math.abs(a[n] - (b[n] ?? NaN)) <= EQ_TOL);
  for (let i = 0; i < singles.length; i++)
    for (let j = i + 1; j < singles.length; j++) {
      const [a, b] = [singles[i], singles[j]];
      if (a.comp === b.comp) continue;
      const v = trysolve(patch(graph, [a, b]));
      if (!v) continue;
      const twin = kept.find((k) => same(k.predicted, v));
      if (twin) {
        extras.notes.push(`${a.id} + ${b.id} merged into "${twin.id}": identical predicted voltages at every node (within 1e-9 V), so no measurement can tell them apart.`);
        continue;
      }
      kept.push({ id: `${a.id}+${b.id}`, title: `Two independent faults: ${a.title}; AND ${b.title}`, prior: pairPrior, predicted: v, pair: true });
    }
  extras.pairsSolved = kept.filter((k) => k.pair).length;

  const nodes = Object.keys(kept[0]?.predicted ?? {}).filter((n) => n !== graph.groundNode);
  const obs = observations.filter((o) => nodes.includes(o.node));
  const logp = kept.map((h) => Math.log(h.prior) - obs.reduce((s, o) => s + 0.5 * ((o.volts - h.predicted[o.node]) / sigma(o.volts)) ** 2, 0));
  const m = Math.max(...logp);
  const w = logp.map((l) => Math.exp(l - m));
  const z = w.reduce((a, b) => a + b, 0);
  const pairIds = new Set(kept.filter((k) => k.pair).map((k) => k.id));
  const hypotheses: FaultHypothesis[] = kept
    .map((h, i) => ({ id: h.id, title: h.title, probability: w[i] / z, predicted: h.predicted }))
    .sort((a, b) => b.probability - a.probability);

  // A hypothesis "fits" when no reading is > 3 sigma off.
  const misfit = (h: FaultHypothesis) => obs.find((o) => Math.abs(o.volts - h.predicted[o.node]) > 3 * sigma(o.volts));
  const best = hypotheses[0];
  let fitWarning: string | undefined;
  if (best && obs.length && !hypotheses.some((h) => !pairIds.has(h.id) && !misfit(h))) {
    const bestPair = hypotheses.find((h) => pairIds.has(h.id) && !misfit(h));
    if (bestPair)
      fitWarning = `No single-fault hypothesis explains the readings. The best explanation is two independent faults: ${bestPair.title.replace('Two independent faults: ', '')}. This is still a hypothesis; confirm each part with power off and an ohmmeter.`;
    else {
      const mf = misfit(best)!;
      fitWarning = `Neither single nor two-fault hypotheses explain ${fmtV(mf.volts)} at ${mf.node} (best guess predicts ${fmtV(best.predicted[mf.node])}). Re-check the confirmed diagram, meter range, or look for more faults.`;
    }
  }

  const base = { hypotheses, fitWarning, safety: SAFETY, ...extras };
  if (!best) return { ...base, next: null, done: true, reason: 'Circuit could not be solved.' };
  if (best.probability >= DONE_P) return { ...base, next: null, done: true, reason: `Most likely: ${best.title} (${Math.round(best.probability * 100)}%).` };

  const measured = new Set(obs.map((o) => o.node));
  const H = entropy(hypotheses.map((h) => h.probability));
  const byId = new Map(hypotheses.map((h) => [h.id, h]));
  let next: ProbeStep['next'] = null;
  for (const node of nodes) {
    if (measured.has(node)) continue;
    const outs = outcomes(hypotheses, node);
    const remaining = outs.reduce((s, o) => s + o.probability * entropy(o.hypothesisIds.map((id) => byId.get(id)!.probability / o.probability)), 0);
    const bits = H - remaining;
    if (!next || bits > next.expectedBits + 1e-9)
      next = {
        node,
        expectedBits: bits,
        instruction: `With the circuit powered, put the black probe on ${graph.groundNode} and the red probe on ${node}; enter the DC voltage.`,
        outcomes: outs.sort((a, b) => b.probability - a.probability),
      };
  }
  if (!next || next.expectedBits < MIN_BITS)
    return {
      ...base,
      next: null,
      done: true,
      reason: `Remaining hypotheses give the same voltage at every node; check them with power off and an ohmmeter: ${hypotheses.filter((h) => h.probability > 0.05).map((h) => h.title).join('; ')}.`,
    };
  return { ...base, next, done: false, reason: `Measure ${next.node} next (~${next.expectedBits.toFixed(2)} bits expected).` };
}
