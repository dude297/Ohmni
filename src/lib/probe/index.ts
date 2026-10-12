import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';

// Probe Guide: sequential single-fault localization. Every candidate fault is re-solved by the MNA
// solver (the only math authority); the next probe is the node whose predicted readings split the
// current posterior the most (expected information gain, bits). No model calls.
// Honesty: an explicit 'unmodeled' hypothesis (uniform over the physically possible voltage range) soaks up
// readings no modeled fault explains, the likelihood includes part tolerance, and `done` also requires a good fit.

export type Observation = { node: string; volts: number };
export type FaultHypothesis = {
  id: string;
  title: string;
  probability: number;
  predicted: Record<string, number>; // solver node voltages if this hypothesis were true ({} for 'unmodeled')
  conditionalProbability?: number; // posterior among modeled hypotheses only (survives the underflow of `probability` when nothing fits)
};
export type ProbePrediction = { volts: number; hypothesisIds: string[]; probability: number };
export type ProbeStep = {
  hypotheses: FaultHypothesis[]; // ranked, most probable first (includes the 'unmodeled' out-of-model hypothesis)
  next: { node: string; expectedBits: number; instruction: string; outcomes: ProbePrediction[] } | null;
  done: boolean;
  reason: string;
  fitWarning?: string;
  fit?: 'good' | 'poor'; // (optional so older callers still type-check) poor: best modeled hypothesis misses a reading by > 3 sigma, or 'unmodeled' beats it
  outOfModelProbability?: number; // posterior of 'unmodeled'
  safety: string;
};

export const UNMODELED_ID = 'unmodeled';
export const R_SHORT = 1e-3; // ponytail: 1 mOhm = short, 1 GOhm = open; same idea as diagnosis/
export const R_OPEN = 1e9;
export const NOMINAL_PRIOR = 0.5;
export const UNMODELED_PRIOR = 0.15; // tuned on bench/calibration: out-of-model wrong-confident vs in-model accuracy
export const UNMODELED_WIDTH = 0.1;
export const PARTS_TOL = 0.05; // resistor tolerance assumed when the user gives none
export const DONE_P = 0.9;
export const MIN_BITS = 0.05;
export const MIN_READINGS = 2;
export const SAFETY =
  'Low-voltage DC only. Measure node voltages with the black probe on GND. Disconnect power before measuring resistance or touching parts. These are hypotheses, not confirmed faults.';

// Meter + model tolerance: 2 % of reading plus 10 mV.
export const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01;
export const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
export const fmtOhm = (r: number) =>
  r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`;

export type Candidate = { id: string; title: string; prior: number; graph: CircuitGraph };

export function withValue(g: CircuitGraph, id: string, value: number): CircuitGraph {
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

// Part-tolerance sigma per node for one hypothesis: finite-difference sensitivity of every node voltage to each
// resistor moving by +PARTS_TOL, combined as independent uniform(+-tol) errors (variance = delta^2 / 3).
function partsSigma(g: CircuitGraph, base: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of g.components) {
    if (c.kind !== 'resistor') continue;
    let v: Record<string, number>;
    try {
      v = solveDC(withValue(g, c.id, c.value * (1 + PARTS_TOL))).voltages;
    } catch {
      continue;
    }
    for (const n of Object.keys(base)) out[n] = (out[n] ?? 0) + (v[n] - base[n]) ** 2 / 3;
  }
  for (const n of Object.keys(out)) out[n] = Math.sqrt(out[n]);
  return out;
}

/** Shared by probe and probe-multi: Bayesian update over solved candidates plus 'unmodeled', fit gate, next probe. */
export function decide(
  graph: CircuitGraph,
  solved: (Candidate & { predicted: Record<string, number> })[],
  observations: Observation[],
  unmodeledTitle = 'No single modeled fault fits these readings',
): ProbeStep {
  const nodes = Object.keys(solved[0]?.predicted ?? {}).filter((n) => n !== graph.groundNode);
  const obs = observations.filter((o) => nodes.includes(o.node));

  // sigma_total^2 = sigma_meter^2 + sigma_parts^2 per hypothesis and node.
  const ps = obs.length ? solved.map((h) => partsSigma(h.graph, h.predicted)) : [];
  const sig = (i: number, o: Observation) => Math.hypot(sigma(o.volts), ps[i]?.[o.node] ?? 0);
  const srcs = graph.components.filter((c) => c.kind === 'dc_voltage').map((c) => c.value);
  const range = Math.max(Math.max(0, ...srcs) - Math.min(0, ...srcs), 1);

  // Gaussian log-density per modeled hypothesis; uniform density over the possible range for 'unmodeled'.
  const logp = solved.map(
    (h, i) =>
      Math.log(h.prior) -
      obs.reduce((s, o) => s + 0.5 * ((o.volts - h.predicted[o.node]) / sig(i, o)) ** 2 + Math.log(sig(i, o) * Math.sqrt(2 * Math.PI)), 0),
  );
  // Out-of-model readings (drifted part, two faults) land near modeled predictions but not on them: model them as
  // a broad Gaussian mixture (one component per modeled prediction, width = UNMODELED_WIDTH of the supply span).
  const W = UNMODELED_WIDTH * range;
  const logU =
    Math.log(UNMODELED_PRIOR) +
    obs.reduce((t, o) => {
      const d = solved.reduce((a, h) => a + Math.exp(-0.5 * ((o.volts - h.predicted[o.node]) / W) ** 2), 0) / (solved.length * W * Math.sqrt(2 * Math.PI));
      return t + Math.log(d + 1e-300);
    }, 0);
  const m = Math.max(logU, ...logp);
  const w = logp.map((l) => Math.exp(l - m));
  const wU = Math.exp(logU - m);
  const z = w.reduce((a, b) => a + b, 0) + wU;
  const mc = Math.max(...logp); // modeled-only normalization, computed in log space so it never underflows
  const wc = logp.map((l) => Math.exp(l - mc));
  const zc = wc.reduce((a, b) => a + b, 0);
  const modeled: FaultHypothesis[] = solved.map((h, i) => ({ id: h.id, title: h.title, probability: w[i] / z, predicted: h.predicted, conditionalProbability: wc[i] / zc }));
  const outOfModelProbability = wU / z;
  const hypotheses = [...modeled, { id: UNMODELED_ID, title: unmodeledTitle, probability: outOfModelProbability, predicted: {} }].sort(
    (a, b) => b.probability - a.probability || (b.conditionalProbability ?? 0) - (a.conditionalProbability ?? 0),
  );

  const best = hypotheses[0];
  const bestModeled = hypotheses.find((h) => h.id !== UNMODELED_ID);
  const bi = bestModeled ? solved.findIndex((h) => h.id === bestModeled.id) : -1;
  const misfit = bestModeled && obs.find((o) => Math.abs(o.volts - bestModeled.predicted[o.node]) > 3 * sig(bi, o));
  const poor = obs.length > 0 && (!bestModeled || !!misfit || outOfModelProbability > bestModeled.probability);
  const fit: 'good' | 'poor' = poor ? 'poor' : 'good';
  const fitWarning = misfit
    ? `No single-fault hypothesis explains ${fmtV(misfit.volts)} at ${misfit.node} (best guess predicts ${fmtV(bestModeled!.predicted[misfit.node])}). Re-check the confirmed diagram, meter range, or look for more than one fault.`
    : poor
      ? `The readings do not fit any modeled fault (out-of-model probability ${Math.round(outOfModelProbability * 100)}%). Re-check the confirmed diagram, meter range, or look for a drifted part or more than one fault.`
      : undefined;

  const base = { hypotheses, fitWarning, fit, outOfModelProbability, safety: SAFETY };
  if (!bestModeled) return { ...base, next: null, done: true, reason: 'Circuit could not be solved.' };
  // A conclusion needs a confirming second reading: one voltage can coincide with a modeled fault by chance.
  const measured = new Set(obs.map((o) => o.node));
  // "Matches the diagram" is a claim about every node, so it needs all resistor-dependent nodes measured.
  const pinned = new Set(graph.components.filter((c) => c.kind === 'dc_voltage' && c.negativeNode === graph.groundNode).map((c) => c.positiveNode));
  const measuredFree = obs.filter((o) => !pinned.has(o.node)).length;
  const need = best.id === 'nominal' ? nodes.filter((n) => !pinned.has(n)).length : MIN_READINGS;
  const confirm = !poor && best.probability >= DONE_P && measuredFree < need && nodes.some((n) => !measured.has(n) && !pinned.has(n));
  if (!poor && best.probability >= DONE_P && !confirm)
    return {
      ...base,
      next: null,
      done: true,
      reason: `Most likely: ${best.title} (${Math.round(best.probability * 100)}%).${best.id === 'nominal' ? ' Voltages match the diagram within meter and part tolerance; a drifted part smaller than that cannot be seen with voltage probes.' : ''}`,
    };

  // Next probe: expected information gain among the modeled hypotheses (renormalized); when confirming, the node
  // where the leading hypothesis differs most from the rest of the fault set (a wrong leader is exposed there).
  const confirmScore = (node: string) =>
    solved.reduce((t, h) => t + Math.abs(h.predicted[node] - bestModeled.predicted[node]) / sigma(bestModeled.predicted[node]), 0);
  const cond = modeled.map((h) => ({ ...h, probability: h.conditionalProbability! })).sort((a, b) => b.probability - a.probability);
  const H = entropy(cond.map((h) => h.probability));
  const byId = new Map(cond.map((h) => [h.id, h]));
  let next: ProbeStep['next'] = null;
  let bestScore = -Infinity;
  for (const node of nodes) {
    if (measured.has(node) || (confirm && pinned.has(node))) continue;
    const outs = outcomes(cond, node);
    const remaining = outs.reduce((s, o) => s + o.probability * entropy(o.hypothesisIds.map((id) => byId.get(id)!.probability / o.probability)), 0);
    const bits = H - remaining;
    const score = confirm ? confirmScore(node) : bits;
    if (!next || score > bestScore + 1e-9) {
      bestScore = score;
      next = {
        node,
        expectedBits: bits,
        instruction: `With the circuit powered, put the black probe on ${graph.groundNode} and the red probe on ${node}; enter the DC voltage.`,
        outcomes: outs.sort((a, b) => b.probability - a.probability),
      };
    }
  }
  if (confirm && next)
    return { ...base, next, done: false, reason: `Leading hypothesis: ${best.title}. Confirm it by measuring ${next.node} before concluding.` };
  if (poor && (!next || next.expectedBits < MIN_BITS)) {
    // The modeled faults can't be split further, but another reading can still expose what is really wrong.
    const free = nodes.filter((n) => !measured.has(n) && !pinned.has(n)).sort((x, y) => confirmScore(y) - confirmScore(x));
    if (free.length)
      return {
        ...base,
        next: { node: free[0], expectedBits: 0, instruction: `With the circuit powered, put the black probe on ${graph.groundNode} and the red probe on ${free[0]}; enter the DC voltage.`, outcomes: outcomes(cond, free[0]) },
        done: false,
        reason: `Readings do not fit any modeled fault. Measure ${free[0]} to see where the circuit departs from the diagram, or check parts with an ohmmeter.`,
      };
    return {
      ...base,
      next: null,
      done: false,
      reason:
        'No modeled fault fits these readings and no further voltage probe separates the candidates. Power off and check each resistor with an ohmmeter, and compare the board against the confirmed diagram.',
    };
  }
  if (!next || next.expectedBits < MIN_BITS)
    return {
      ...base,
      next: null,
      done: true,
      reason: `Remaining hypotheses give the same voltage at every node; check them with power off and an ohmmeter: ${cond
        .filter((h) => h.probability > 0.05)
        .map((h) => h.title)
        .join('; ')}.`,
    };
  return {
    ...base,
    next,
    done: false,
    reason: poor
      ? `Readings do not fit a modeled fault well. Measure ${next.node} next (~${next.expectedBits.toFixed(2)} bits expected), or check parts with an ohmmeter.`
      : `Measure ${next.node} next (~${next.expectedBits.toFixed(2)} bits expected).`,
  };
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
  return decide(graph, solved, observations);
}

/** The posterior restricted to modeled faults and renormalized (what probeStep returned before 'unmodeled' existed). */
export function modeledHypotheses(step: Pick<ProbeStep, 'hypotheses'>): FaultHypothesis[] {
  return step.hypotheses
    .filter((h) => h.id !== UNMODELED_ID)
    .map((h) => ({ ...h, probability: h.conditionalProbability ?? h.probability }))
    .sort((a, b) => b.probability - a.probability);
}
