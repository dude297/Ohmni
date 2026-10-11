import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';

// Probe Guide: sequential single-fault localization. Every candidate fault is re-solved by the MNA
// solver (the only math authority); the next probe is the node whose predicted readings split the
// current posterior the most (expected information gain, bits). No model calls.

export type Observation = { node: string; volts: number };
export type FaultHypothesis = {
  id: string;
  title: string;
  probability: number;
  predicted: Record<string, number>; // solver node voltages if this hypothesis were true
};
export type ProbePrediction = { volts: number; hypothesisIds: string[]; probability: number };
export type ProbeStep = {
  hypotheses: FaultHypothesis[]; // ranked, most probable first
  next: { node: string; expectedBits: number; instruction: string; outcomes: ProbePrediction[] } | null;
  done: boolean;
  reason: string;
  fitWarning?: string;
  safety: string;
};

const R_SHORT = 1e-3; // ponytail: 1 mOhm = short, 1 GOhm = open; same idea as diagnosis/
const R_OPEN = 1e9;
const NOMINAL_PRIOR = 0.5;
const DONE_P = 0.9;
const MIN_BITS = 0.05;
const SAFETY =
  'Low-voltage DC only. Measure node voltages with the black probe on GND. Disconnect power before measuring resistance or touching parts. These are hypotheses, not confirmed faults.';

// Meter + model tolerance: 2 % of reading plus 10 mV.
const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01;
const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
const fmtOhm = (r: number) =>
  r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`;

type Candidate = { id: string; title: string; prior: number; graph: CircuitGraph };

function withValue(g: CircuitGraph, id: string, value: number): CircuitGraph {
  return { ...g, components: g.components.map((c) => (c.id === id ? { ...c, value } : c)) };
}

function candidates(g: CircuitGraph): Candidate[] {
  const faults: Omit<Candidate, 'prior'>[] = [];
  for (const c of g.components) {
    if (c.kind === 'resistor') {
      faults.push(
        { id: `${c.id}:open`, title: `${c.id} open / not connected`, graph: withValue(g, c.id, R_OPEN) },
        { id: `${c.id}:short`, title: `${c.id} shorted (bridge or stray wire)`, graph: withValue(g, c.id, R_SHORT) },
        { id: `${c.id}:x10`, title: `${c.id} is ${fmtOhm(c.value * 10)}, not ${fmtOhm(c.value)} (band misread)`, graph: withValue(g, c.id, c.value * 10) },
        { id: `${c.id}:x0.1`, title: `${c.id} is ${fmtOhm(c.value / 10)}, not ${fmtOhm(c.value)} (band misread)`, graph: withValue(g, c.id, c.value / 10) },
      );
    } else {
      faults.push({ id: `${c.id}:dead`, title: `Supply ${c.id} off / dead / disconnected`, graph: withValue(g, c.id, 0) });
    }
  }
  return [
    { id: 'nominal', title: 'Circuit matches the confirmed diagram', prior: NOMINAL_PRIOR, graph: g },
    ...faults.map((f) => ({ ...f, prior: (1 - NOMINAL_PRIOR) / faults.length })),
  ];
}

const entropy = (ps: number[]) => -ps.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);

// Group hypotheses whose predicted readings a meter cannot tell apart.
function outcomes(hs: FaultHypothesis[], node: string): ProbePrediction[] {
  // ponytail: hypotheses under 0.1 % are ignored; they change the expected-bits estimate by < 0.01 bits
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

export function probeStep(graph: CircuitGraph, observations: Observation[] = []): ProbeStep {
  // Solve every candidate; drop ones the solver rejects (e.g. singular).
  const solved = candidates(graph).flatMap((c) => {
    try {
      const { voltages } = solveDC(c.graph);
      return Object.values(voltages).every(Number.isFinite) ? [{ ...c, predicted: voltages }] : [];
    } catch {
      return [];
    }
  });
  const nodes = Object.keys(solved[0]?.predicted ?? {}).filter((n) => n !== graph.groundNode);
  const obs = observations.filter((o) => nodes.includes(o.node));

  // Gaussian log-likelihood per hypothesis; normalize with log-sum-exp.
  const logp = solved.map(
    (h) => Math.log(h.prior) - obs.reduce((s, o) => s + 0.5 * ((o.volts - h.predicted[o.node]) / sigma(o.volts)) ** 2, 0),
  );
  const m = Math.max(...logp);
  const w = logp.map((l) => Math.exp(l - m));
  const z = w.reduce((a, b) => a + b, 0);
  const hypotheses: FaultHypothesis[] = solved
    .map((h, i) => ({ id: h.id, title: h.title, probability: w[i] / z, predicted: h.predicted }))
    .sort((a, b) => b.probability - a.probability);

  const best = hypotheses[0];
  const misfit = best && obs.find((o) => Math.abs(o.volts - best.predicted[o.node]) > 3 * sigma(o.volts));
  const fitWarning = misfit
    ? `No single-fault hypothesis explains ${fmtV(misfit.volts)} at ${misfit.node} (best guess predicts ${fmtV(best.predicted[misfit.node])}). Re-check the confirmed diagram, meter range, or look for more than one fault.`
    : undefined;

  const base = { hypotheses, fitWarning, safety: SAFETY };
  if (!best) return { ...base, next: null, done: true, reason: 'Circuit could not be solved.' };
  if (best.probability >= DONE_P)
    return { ...base, next: null, done: true, reason: `Most likely: ${best.title} (${Math.round(best.probability * 100)} %).` };

  const measured = new Set(obs.map((o) => o.node));
  const H = entropy(hypotheses.map((h) => h.probability));
  let next: ProbeStep['next'] = null;
  for (const node of nodes) {
    if (measured.has(node)) continue;
    const outs = outcomes(hypotheses, node);
    const remaining = outs.reduce((s, o) => {
      const ps = o.hypothesisIds.map((id) => hypotheses.find((h) => h.id === id)!.probability / o.probability);
      return s + o.probability * entropy(ps);
    }, 0);
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
      reason: `Remaining hypotheses give the same voltage at every node; check them with power off and an ohmmeter: ${hypotheses
        .filter((h) => h.probability > 0.05)
        .map((h) => h.title)
        .join('; ')}.`,
    };
  return { ...base, next, done: false, reason: `Measure ${next.node} next (~${next.expectedBits.toFixed(2)} bits expected).` };
}
