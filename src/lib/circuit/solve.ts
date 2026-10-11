import type { CircuitGraph } from './types';

// Owner: Agent A. Deterministic DC Modified Nodal Analysis. Input must already pass validateGraph.
export class SolveError extends Error {}

export type DCSolution = { voltages: Record<string, number>; currents: Record<string, number> };

export function solveDC(_graph: CircuitGraph): DCSolution {
  throw new SolveError('solveDC not implemented');
}
