import { solveDC } from '../src/lib/circuit/solve';
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V, SERIES_PARALLEL_12V } from '../src/lib/circuit/fixtures';
import type { CircuitGraph } from '../src/lib/circuit/types';
import type { Observation, ProbeStep } from '../src/lib/probe';

// Deterministic Probe Guide calibration simulation. A simulated user follows the guide's next-probe advice;
// readings are truth voltages + Gaussian meter noise (sigma = 2 % + 10 mV, the guide's own meter model).
// Case schema: { truth graph, label (the hypothesis id that is "right") }; sets group cases by regime.

export type ProbeFn = (g: CircuitGraph, obs: Observation[]) => ProbeStep & { fit?: 'good' | 'poor' };
export type CalCase = { truth: CircuitGraph; label: string };
export type CalSet = { name: string; fixture: string; group: 'in-model' | 'in-model+tol' | 'nominal+tol' | 'out-of-model'; model: CircuitGraph; cases: CalCase[]; n: number };
export type CalRow = {
  name: string; fixture: string; group: CalSet['group']; n: number;
  top1: number; top1EquivAware: number; meanProbes: number;
  confident: number; confidentWrong: number; silentConfidentWrong: number; detectableConfidentWrong: number; flaggedOutOfModel: number;
};

export function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01;
const FV: Record<string, (v: number) => number> = { open: () => 1e9, short: () => 1e-3, x10: (v) => v * 10, 'x0.1': (v) => v / 10, dead: () => 0 };
const setv = (g: CircuitGraph, id: string, v: number): CircuitGraph => ({ ...g, components: g.components.map((c) => (c.id === id ? { ...c, value: v } : c)) });
const resistors = (g: CircuitGraph) => g.components.filter((c) => c.kind === 'resistor');

export function buildSets(seed = 20261012, n = 300): CalSet[] {
  const r = rng(seed);
  const tol = (g: CircuitGraph, pct: number): CircuitGraph => ({
    ...g, components: g.components.map((c) => (c.kind === 'resistor' ? { ...c, value: c.value * (1 + (r.u() * 2 - 1) * pct) } : c)),
  });
  const fx: [string, CircuitGraph][] = [['divider', DIVIDER_10K_10K], ['series-parallel', SERIES_PARALLEL_12V], ['bridge', LOADED_BRIDGE_12V]];
  const sets: CalSet[] = [];
  for (const [fixture, g] of fx) {
    const single: CalCase[] = [];
    for (const c of g.components)
      for (const k of c.kind === 'resistor' ? ['open', 'short', 'x10', 'x0.1'] : ['dead']) single.push({ truth: setv(g, c.id, FV[k](c.value)), label: `${c.id}:${k}` });
    sets.push({ name: `${fixture} in-model single faults`, fixture, group: 'in-model', model: g, cases: single, n });
    // each tolerance case is one random draw of all resistors within +-5 % (pool of 200 draws, sampled per session)
    const pool: CalCase[] = [];
    for (let i = 0; i < 200; i++) { const c = single[i % single.length]; pool.push({ ...c, truth: tol(c.truth, 0.05) }); }
    sets.push({ name: `${fixture} in-model faults + 5% parts`, fixture, group: 'in-model+tol', model: g, cases: pool, n });
    sets.push({ name: `${fixture} nominal + 5% parts`, fixture, group: 'nominal+tol', model: g, cases: Array.from({ length: 100 }, () => ({ truth: tol(g, 0.05), label: 'nominal' })), n: 200 });
    for (const f of [3, 0.3, 2, 1.5])
      sets.push({ name: `${fixture} OOM R x${f}`, fixture, group: 'out-of-model', model: g, cases: resistors(g).map((c) => ({ truth: setv(g, c.id, c.value * f), label: `${c.id}:x${f}` })), n });
    const rs = resistors(g);
    if (rs.length >= 3) {
      const cs: CalCase[] = [];
      while (cs.length < 40) {
        const a = rs[Math.floor(r.u() * rs.length)], b = rs[Math.floor(r.u() * rs.length)];
        if (a.id !== b.id) cs.push({ truth: setv(setv(g, a.id, a.value * 10), b.id, 1e-3), label: `${a.id}:x10+${b.id}:short` });
      }
      sets.push({ name: `${fixture} OOM two faults`, fixture, group: 'out-of-model', model: g, cases: cs, n });
    }
  }
  return sets;
}

export function runSet(probe: ProbeFn, set: CalSet, seed: number): CalRow {
  const r = rng(seed);
  let top1 = 0, eq = 0, probes = 0, conf = 0, confWrong = 0, silent = 0, detect = 0, flagged = 0;
  for (let i = 0; i < set.n; i++) {
    const c = set.cases[Math.floor(r.u() * set.cases.length)];
    const t = solveDC(c.truth).voltages;
    const obs: Observation[] = [];
    let step = probe(set.model, obs);
    while (!step.done && step.next && obs.length < 20) {
      const node = step.next.node;
      obs.push({ node, volts: t[node] + r.gauss() * sigma(t[node]) });
      step = probe(set.model, obs);
    }
    probes += obs.length;
    const best = step.hypotheses[0];
    const right = best.id === c.label;
    const th = step.hypotheses.find((h) => h.id === c.label);
    const keys = Object.keys(best.predicted);
    const equiv = !!th && keys.length > 0 && keys.every((k) => Math.abs(best.predicted[k] - th.predicted[k]) <= 2 * sigma(best.predicted[k]));
    if (right) top1++;
    if (right || equiv) eq++;
    const modeled = best.id !== 'unmodeled';
    if (!modeled || step.fit === 'poor') flagged++;
    if (modeled && best.probability >= 0.9) {
      conf++;
      // in-model: a different-but-indistinguishable hypothesis is not counted wrong; out-of-model: any modeled answer is wrong
      if (!right && !(set.group !== 'out-of-model' && equiv)) {
        confWrong++;
        // detectable: the chosen hypothesis contradicts the true voltages (> 3 meter sigma) at some node,
        // i.e. a complete set of readings would have exposed it. Undetectable misses are limits of the meter.
        if (keys.some((k) => Math.abs(best.predicted[k] - t[k]) > 3 * sigma(t[k]))) detect++;
        if (!step.fitWarning && step.fit !== 'poor') silent++;
      }
    }
  }
  const f = (x: number) => +(x / set.n).toFixed(4);
  return {
    name: set.name, fixture: set.fixture, group: set.group, n: set.n, top1: f(top1), top1EquivAware: f(eq), meanProbes: +(probes / set.n).toFixed(2),
    confident: conf, confidentWrong: confWrong, silentConfidentWrong: silent, detectableConfidentWrong: detect, flaggedOutOfModel: flagged,
  };
}

export function summarize(rows: CalRow[]) {
  const pool = (g: (r: CalRow) => boolean) => {
    const rs = rows.filter(g), n = rs.reduce((s, r) => s + r.n, 0);
    const w = (k: 'top1' | 'top1EquivAware' | 'meanProbes') => +(rs.reduce((s, r) => s + r[k] * r.n, 0) / n).toFixed(4);
    const sum = (k: 'confident' | 'confidentWrong' | 'silentConfidentWrong' | 'detectableConfidentWrong' | 'flaggedOutOfModel') => rs.reduce((s, r) => s + r[k], 0);
    return { sessions: n, top1: w('top1'), top1EquivAware: w('top1EquivAware'), meanProbes: w('meanProbes'), confidentWrongRate: +(sum('confidentWrong') / n).toFixed(4), silentConfidentWrongRate: +(sum('silentConfidentWrong') / n).toFixed(4), detectableConfidentWrongRate: +(sum('detectableConfidentWrong') / n).toFixed(4), flaggedRate: +(sum('flaggedOutOfModel') / n).toFixed(4) };
  };
  return {
    inModel: pool((r) => r.group === 'in-model'),
    inModelPlusParts: pool((r) => r.group === 'in-model+tol'),
    nominalPlusParts: pool((r) => r.group === 'nominal+tol'),
    outOfModel: pool((r) => r.group === 'out-of-model'),
    bridgeOutOfModel: pool((r) => r.group === 'out-of-model' && r.fixture === 'bridge'),
    bridgeInModel: pool((r) => r.group === 'in-model' && r.fixture === 'bridge'),
  };
}
