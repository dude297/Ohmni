import type { CircuitGraph } from './types';

// Owner: Agent A. Deterministic DC Modified Nodal Analysis. Input must already pass validateGraph.
export class SolveError extends Error {}

// currents[id]:
//  - resistor: (V(positiveNode) - V(negativeNode)) / R, i.e. flowing positiveNode -> negativeNode.
//  - dc_voltage: MNA convention: current flowing INTO the positive terminal, through the source, out of
//    the negative terminal. A source delivering power to a load therefore reports a NEGATIVE current.
// warnings/residual are only present when the numerical check failed: warnings ['ill_conditioned'] means the
// KCL residual of the returned solution exceeds RESIDUAL_WARN (relative to the largest current), so treat results as approximate.
export type DCSolution = { voltages: Record<string, number>; currents: Record<string, number>; warnings?: string[]; residual?: number };

const PIVOT_EPS = 1e-13; // relative: pivot / (magnitude of its original row)
const RESIDUAL_WARN = 1e-9;
const REFINE_ABOVE = 1e-13; // well-conditioned systems are returned bit-for-bit from plain elimination

// Gaussian elimination with scaled partial pivoting. Singular when no remaining pivot is meaningful relative to its own row.
function lu(A0: number[][], b0: number[]): number[] {
  const n = b0.length;
  const A = A0.map((r) => [...r]);
  const b = [...b0];
  const scale = A.map((r) => Math.max(...r.map(Math.abs), 0));
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = -1;
    for (let r = col; r < n; r++) {
      const q = scale[r] > 0 ? Math.abs(A[r][col]) / scale[r] : 0;
      if (q > best) {
        best = q;
        piv = r;
      }
    }
    if (best < PIVOT_EPS) throw new SolveError('circuit is singular (e.g. conflicting/looped voltage sources or floating nodes)');
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    [scale[col], scale[piv]] = [scale[piv], scale[col]];
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
  return x;
}

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

  const x0 = lu(A, b);
  if (x0.some((v) => !Number.isFinite(v))) throw new SolveError('non-finite solution');
  const residual = (xv: number[]) => b.map((bi, r) => bi - A[r].reduce((acc, a, c) => acc + a * xv[c], 0));

  const build = (x: number[]) => {
    const voltages: Record<string, number> = { [graph.groundNode]: 0 };
    nodes.forEach((name, i) => (voltages[name] = x[i]));
    const currents: Record<string, number> = {};
    for (const c of graph.components) {
      currents[c.id] =
        c.kind === 'resistor'
          ? (voltages[c.positiveNode] - voltages[c.negativeNode]) / c.value
          : x[nodes.length + sources.indexOf(c)];
    }
    // Check what the caller actually receives: worst-node KCL imbalance of the returned currents, relative to the largest
    // current (computing the currents from voltage differences loses digits that A*x hides), plus the source rows.
    const net: Record<string, number> = {};
    for (const c of graph.components) {
      net[c.positiveNode] = (net[c.positiveNode] ?? 0) + currents[c.id];
      net[c.negativeNode] = (net[c.negativeNode] ?? 0) - currents[c.id];
    }
    const iMax = Math.max(...Object.values(currents).map(Math.abs), 0);
    const vMax = Math.max(...Object.values(voltages).map(Math.abs), 0);
    const r = residual(x);
    const rel = Math.max(
      iMax > 0 ? Math.max(0, ...nodes.map((nd) => Math.abs(net[nd] ?? 0))) / iMax : 0,
      vMax > 0 ? Math.max(0, ...r.slice(nodes.length).map(Math.abs)) / vMax : 0,
    );
    return { voltages, currents, rel };
  };

  let out = build(x0);
  if (out.rel > REFINE_ABOVE) {
    // one step of iterative refinement (ponytail: re-factors instead of reusing LU; systems here are < 20 unknowns)
    try {
      const d = lu(A, residual(x0));
      const xr = x0.map((v, k) => v + d[k]);
      if (xr.every(Number.isFinite)) {
        const o2 = build(xr);
        if (o2.rel <= out.rel) out = o2;
      }
    } catch {
      /* keep the unrefined solution */
    }
  }
  const { voltages, currents, rel } = out;
  return rel > RESIDUAL_WARN ? { voltages, currents, warnings: ['ill_conditioned'], residual: rel } : { voltages, currents };
}
