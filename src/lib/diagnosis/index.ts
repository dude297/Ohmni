import type { CircuitGraph, SolveResponse } from '../circuit/types';

// Owner: Agent D. Rerun solver with single-component variations to explain a measured voltage.
export function diagnose(
  _graph: CircuitGraph,
  _measuredVoltage: number,
): NonNullable<SolveResponse['hypotheses']> {
  return [];
}
