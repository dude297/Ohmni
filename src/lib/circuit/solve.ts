import type { CircuitGraph } from './types';

// Owner: Agent A. Deterministic DC Modified Nodal Analysis. Input must already pass validateGraph.
export class SolveError extends Error {}

// currents[id]:
//  - resistor: (V(positiveNode) - V(negativeNode)) / R, i.e. flowing positiveNode -> negativeNode.
//  - dc_voltage: MNA convention: current flowing INTO the positive terminal, through the source, out of
//    the negative terminal. A source delivering power to a load therefore reports a NEGATIVE current.
export type DCSolution = { voltages: Record<string, number>; currents: Record<string, number> };

const PIVOT_EPS = 1e-14;

export function solveDC(graph: CircuitGraph): DCSolution {
  const nodes = [...new Set(graph.components.flatMap((c) => [c.positiveNode, c.negativeNode]))].filter(
    (n) => n !== graph.groundNode,
  );
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const sources = graph.components.filter((c) => c.kind === 'dc_voltage');
  const n = nodes.length + sources.length;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);

  for (const c of graph.components) {
    const p = idx.get(c.positiveNode);
    const q = idx.get(c.negativeNode);
    if (c.kind === 'resistor') {
      if (!(c.value > 0) || !Number.isFinite(c.value)) throw new SolveError(`${c.id}: invalid resistance`);
      const g = 1 / c.value;
      if (p !== undefined) A[p][p] += g;
      if (q !== undefined) A[q][q] += g;
      if (p !== undefined && q !== undefined) {
        A[p][q] -= g;
        A[q][p] -= g;
      }
    } else {
      const k = nodes.length + sources.indexOf(c);
      if (p !== undefined) {
        A[p][k] += 1;
        A[k][p] += 1;
      }
      if (q !== undefined) {
        A[q][k] -= 1;
        A[k][q] -= 1;
      }
      b[k] = c.value;
    }
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < PIVOT_EPS) {
      throw new SolveError('circuit is singular (e.g. conflicting/looped voltage sources or floating nodes)');
    }
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  if (x.some((v) => !Number.isFinite(v))) throw new SolveError('non-finite solution');

  const voltages: Record<string, number> = { [graph.groundNode]: 0 };
  nodes.forEach((name, i) => (voltages[name] = x[i]));
  const currents: Record<string, number> = {};
  for (const c of graph.components) {
    currents[c.id] =
      c.kind === 'resistor'
        ? (voltages[c.positiveNode] - voltages[c.negativeNode]) / c.value
        : x[nodes.length + sources.indexOf(c)];
  }
  return { voltages, currents };
}
