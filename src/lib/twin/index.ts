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
};

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
  if (observations.length)
    try {
      repair = repairStep(intended, observations);
    } catch {
      /* repair is optional */
    }
  return { diff, intendedSolution, observedSolution, predictedVsMeasured, probe, ...(repair && { repair }) };
}
