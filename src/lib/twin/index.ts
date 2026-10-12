import type { CircuitGraph } from '../circuit/types';
import { solveDC, type DCSolution } from '../circuit/solve';
import { validateGraph } from '../circuit/validate';
import { probeStep, type Observation, type ProbeStep } from '../probe';
import { repairStep, type RepairResult } from '../repair';
import { diffDesigns } from './diff';
import type { TwinDiff } from './types';

export * from './types';
export { diffDesigns } from './diff';

export type PredictedVsMeasured = { node: string; intended: number; observed: number | null; measured?: number };
export type TwinAnalysis = {
  diff: TwinDiff;
  intendedSolution: DCSolution;
  observedSolution: DCSolution | null;
  predictedVsMeasured: PredictedVsMeasured[];
  probe: ProbeStep;
  repair?: RepairResult;
  recommendation: Recommendation;
};

/** What the UI may present as the repair. 'repair' only when one hypothesis clearly leads (or the described hardware directly shows it). */
export type Recommendation =
  | { status: 'repair'; hypothesisId: string; basis: 'measurements' | 'observed_diff'; probability?: number; evidence: string[] }
  | { status: 'insufficient'; message: string; tied: { id: string; title: string; probability: number }[]; nextProbe: ProbeStep['next']; evidence: string[] };

export const CLEAR_LEAD = 0.8;
export const TIE_MARGIN = 0.05;

/** intended must already be validated + solvable (throws SolveError otherwise); observed is a structurally valid but possibly unsolvable graph. */
export function analyzeTwin(intended: CircuitGraph, observed: CircuitGraph, observations: Observation[] = []): TwinAnalysis {
  const diff = diffDesigns(intended, observed);
  const intendedSolution = solveDC(intended);

  let observedSolution: DCSolution | null = null;
  const v = validateGraph(observed);
  if (!v.ok) diff.uncertainties.push(`observed graph cannot be solved: ${v.errors.join('; ')}`);
  else
    try {
      observedSolution = solveDC(v.graph);
    } catch (e) {
      diff.uncertainties.push(`observed graph cannot be solved: ${e instanceof Error ? e.message : 'solver failed'}`);
    }
  if (!observedSolution) diff.identical = false;

  // intended node -> the single observed node that maps to it (ambiguous => null, never guessed)
  const byIntended = new Map<string, string[]>();
  for (const [o, i] of Object.entries(diff.nodeMap)) if (i) byIntended.set(i, [...(byIntended.get(i) ?? []), o]);
  const measured = new Map(observations.map((o) => [o.node, o.volts]));
  const predictedVsMeasured = Object.keys(intendedSolution.voltages)
    .filter((n) => n !== intended.groundNode)
    .map((node) => {
      const cand = byIntended.get(node);
      const on = cand?.length === 1 ? cand[0] : undefined;
      return {
        node,
        intended: intendedSolution.voltages[node],
        observed: observedSolution && on !== undefined ? (observedSolution.voltages[on] ?? null) : null,
        ...(measured.has(node) && { measured: measured.get(node) }),
      };
    });

  // Faults are hypothesized relative to the DESIGN.
  const probe = probeStep(intended, observations);
  let repair: RepairResult | undefined;
  // A part missing from the described hardware is a direct observation: when nothing was measured, rank on the solver's
  // voltages for that described hardware (simulated, labelled as such below), never on invented numbers.
  const pseudo = !observations.length && diff.componentDiffs.some((c) => c.kind === 'missing_in_observed');
  const repairObs = pseudo ? predictedVsMeasured.flatMap((p) => (p.observed === null ? [] : [{ node: p.node, volts: p.observed }])) : observations;
  if (repairObs.length)
    try {
      repair = repairStep(intended, repairObs);
      if (pseudo)
        repair.proposals = repair.proposals.map((p) => ({
          ...p,
          supportingObservations: [],
          resolves: false,
          uncertainty: 'Based on your described hardware (simulated), not on a measurement. ' + p.uncertainty,
        }));
    } catch {
      /* repair is optional */
    }
  const recommendation = recommend(diff, probe, observations.length, repair);
  return { diff, intendedSolution, observedSolution, predictedVsMeasured, probe, ...(repair && { repair }), recommendation };
}

/** Direct observation (a part absent from the described hardware) beats a hypothesis; otherwise refuse to pick among ties. No probabilities are invented. */
function recommend(diff: TwinDiff, probe: ProbeStep, nObs: number, repair?: RepairResult): Recommendation {
  const evidence = [
    ...diff.componentDiffs.map((c) =>
      c.kind === 'missing_in_observed' ? `Your described hardware is missing ${c.componentId}.`
      : c.kind === 'extra_in_observed' ? `Your described hardware has an extra part ${c.componentId}.`
      : c.kind === 'kind_changed' ? `${c.componentId} is a different kind of part in your described hardware.`
      : `${c.componentId} differs from the design (${c.ratio ? `x${+c.ratio.toPrecision(3)}` : 'value'}).`),
    ...diff.connectionDiffs.map((c) => `${c.componentId} ${c.terminal} terminal is on ${c.observedNode}, design says ${c.intendedNode}.`),
  ];
  const hyp = probe.hypotheses;
  const missing = diff.componentDiffs.find((c) => c.kind === 'missing_in_observed');
  const open = missing && hyp.find((h) => h.id === `${missing.componentId}:open`);
  if (open && repair?.proposals.some((p) => p.hypothesisId === open.id)) {
    // ponytail: only the first missing part; a real measurement that rules it out (<5 %) is not overridden.
    if (!(nObs && open.probability < 0.05)) return { status: 'repair', hypothesisId: open.id, basis: 'observed_diff', evidence };
  }
  const [top, second] = hyp;
  if (top && top.id !== 'nominal' && top.probability >= CLEAR_LEAD && top.probability - (second?.probability ?? 0) >= TIE_MARGIN && repair?.proposals.some((p) => p.hypothesisId === top.id))
    return { status: 'repair', hypothesisId: top.id, basis: 'measurements', probability: top.probability, evidence };
  const tied = hyp.filter((h) => h.id !== 'nominal' && top && top.probability - h.probability < TIE_MARGIN).slice(0, 6);
  return {
    status: 'insufficient',
    message: 'Not enough evidence to choose a repair yet',
    tied: tied.map((h) => ({ id: h.id, title: h.title, probability: h.probability })),
    nextProbe: probe.next,
    evidence,
  };
}
