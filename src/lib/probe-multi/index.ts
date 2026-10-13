import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';
import {
  decide,
  fmtOhm,
  NOMINAL_PRIOR,
  R_OPEN,
  R_SHORT,
  sigma,
  UNMODELED_ID,
  withValue,
  probeStep,
  type Candidate,
  type Observation,
  type ProbeStep,
} from '../probe';

// Two-fault Probe Guide (moonshot). Same return shape as probeStep plus optional extras, so a UI can swap it in.
// Singles + pairs of single faults on DIFFERENT components; every pair is re-solved by solveDC with both patches.
// Scoring (unmodeled hypothesis, part tolerance, fit/done gating, next probe) is the shared `decide` from src/lib/probe;
// maxFaults 1 delegates to probeStep.

export type MultiOpts = { maxFaults: 1 | 2; pairPrior?: number };
export type ProbeStepMulti = ProbeStep & {
  pairCandidates: number; // pair candidates enumerated (before equivalence merging)
  pairsSolved: number; // pairs kept as distinct hypotheses
  notes: string[]; // equivalence merges
  warnings: string[]; // e.g. combinatorics cap
};

export const MAX_PAIR_CANDIDATES = 2000;
export const DEFAULT_PAIR_PRIOR = 0.1; // pair prior = 0.1 x a single fault's prior (two independent faults are rarer)
const EQ_SIGMAS = 0.5; // two candidates are "the same" when predicted voltages agree within 0.5 meter sigma at every node

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
  return fs.reduce((acc, f) => withValue(acc, f.comp, f.value), g);
}

function trysolve(g: CircuitGraph): Record<string, number> | null {
  try {
    const { voltages } = solveDC(g);
    return Object.values(voltages).every(Number.isFinite) ? voltages : null;
  } catch {
    return null;
  }
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

  type Cand = Candidate & { predicted: Record<string, number>; pair: boolean };
  const singlePrior = (1 - NOMINAL_PRIOR) / singles.length; // same as probeStep
  const pairPrior = (opts.pairPrior ?? DEFAULT_PAIR_PRIOR) * singlePrior;
  const kept: Cand[] = [];
  const nominal = trysolve(graph);
  if (nominal) kept.push({ id: 'nominal', title: 'Circuit matches the confirmed diagram', prior: NOMINAL_PRIOR, graph, predicted: nominal, pair: false });
  for (const f of singles) {
    const g = patch(graph, [f]);
    const v = trysolve(g);
    if (v) kept.push({ id: f.id, title: f.title, prior: singlePrior, graph: g, predicted: v, pair: false });
  }
  const nSingles = kept.length;
  const same = (a: Record<string, number>, b: Record<string, number>) =>
    Object.keys(a).every((n) => Math.abs(a[n] - (b[n] ?? NaN)) <= EQ_SIGMAS * sigma(a[n]));
  for (let i = 0; i < singles.length; i++)
    for (let j = i + 1; j < singles.length; j++) {
      const [a, b] = [singles[i], singles[j]];
      if (a.comp === b.comp) continue;
      const g = patch(graph, [a, b]);
      const v = trysolve(g);
      if (!v) continue;
      const twin = kept.find((k) => same(k.predicted, v));
      if (twin) {
        extras.notes.push(`${a.id} + ${b.id} merged into "${twin.id}": predicted voltages agree within ${EQ_SIGMAS} meter sigma at every node, so no voltage measurement can tell them apart.`);
        continue;
      }
      kept.push({ id: `${a.id}+${b.id}`, title: `Two independent faults: ${a.title}; AND ${b.title}`, prior: pairPrior, graph: g, predicted: v, pair: true });
    }
  extras.pairsSolved = kept.length - nSingles;
  const pairIds = new Set(kept.filter((k) => k.pair).map((k) => k.id));

  const res = decide(graph, kept, observations, 'No single or two-fault hypothesis fits these readings');
  let fitWarning = res.fitWarning;
  if (observations.length && res.fit === 'good') {
    // Do the single faults alone explain the readings? If not, and a pair does, say so.
    const singlesFit = decide(graph, kept.slice(0, nSingles), observations).fit === 'good';
    const lead = res.hypotheses.find((h) => h.id !== UNMODELED_ID);
    if (!singlesFit && lead && pairIds.has(lead.id))
      fitWarning = `No single-fault hypothesis explains the readings. The best explanation is two independent faults: ${lead.title.replace('Two independent faults: ', '')}. This is still a hypothesis; confirm each part with power off and an ohmmeter.`;
  } else if (res.fit === 'poor') {
    fitWarning = res.fitWarning?.replace('No single-fault hypothesis', 'Neither single nor two-fault hypotheses');
  }
  return { ...res, fitWarning, ...extras };
}
