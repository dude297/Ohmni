import type { CircuitGraph } from "../../lib/circuit/types";
import type { FaultHypothesis } from "../../lib/probe";

// Display-only re-derivation of the MNA system that src/lib/circuit/solve.ts builds internally
// (solveDC does not expose its matrix). Same node order, same stamps, same elimination, so the
// solution matches solveDC; tests/for-the-larp/math.test.ts checks that. solveDC stays the authority.

export type MNASystem = {
  nodes: string[]; // non-ground nodes, solver order
  sources: string[]; // voltage-source ids, solver order
  A: number[][]; // [[G, B], [C, D]]
  b: number[]; // [i; e]
  x: number[]; // [v; j]
};

export function buildMNA(graph: CircuitGraph): MNASystem {
  const nodes = [...new Set(graph.components.flatMap((c) => [c.positiveNode, c.negativeNode]))].filter(
    (n) => n !== graph.groundNode,
  );
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const src = graph.components.filter((c) => c.kind === "dc_voltage");
  const n = nodes.length + src.length;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const c of graph.components) {
    const p = idx.get(c.positiveNode);
    const q = idx.get(c.negativeNode);
    if (c.kind === "resistor") {
      const g = 1 / c.value;
      if (p !== undefined) A[p][p] += g;
      if (q !== undefined) A[q][q] += g;
      if (p !== undefined && q !== undefined) {
        A[p][q] -= g;
        A[q][p] -= g;
      }
    } else {
      const k = nodes.length + src.indexOf(c);
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
  return { nodes, sources: src.map((c) => c.id), A, b, x: gauss(A, b) };
}

// Gaussian elimination with partial pivoting on copies (same steps as solveDC).
function gauss(A0: number[][], b0: number[]): number[] {
  const A = A0.map((r) => [...r]);
  const b = [...b0];
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-14) return new Array<number>(n).fill(NaN);
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
  return x;
}

// Expected information gain of measuring `node` next, given probeStep's posterior.
// Mirrors src/lib/probe (meter sigma = 2 % + 10 mV; readings within 2 sigma are indistinguishable).
const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01;
const entropy = (ps: number[]) => -ps.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);

export function expectedBits(all: FaultHypothesis[], node: string): number {
  // the out-of-model 'unmodeled' hypothesis has no predictions: gain is computed among modeled faults, renormalized (as probeStep does)
  const mz = all.reduce((s, h) => s + (h.id === "unmodeled" ? 0 : h.probability), 0) || 1;
  const hs = all.filter((h) => h.id !== "unmodeled").map((h) => ({ ...h, probability: h.conditionalProbability ?? h.probability / mz }));
  const sorted = hs.filter((h) => h.probability > 1e-3).sort((a, b) => a.predicted[node] - b.predicted[node]);
  const groups: { volts: number; ps: number[] }[] = [];
  for (const h of sorted) {
    const last = groups.at(-1);
    if (last && Math.abs(h.predicted[node] - last.volts) <= 2 * sigma(last.volts)) last.ps.push(h.probability);
    else groups.push({ volts: h.predicted[node], ps: [h.probability] });
  }
  const remaining = groups.reduce((s, g) => {
    const p = g.ps.reduce((a, b) => a + b, 0);
    return s + p * entropy(g.ps.map((x) => x / p));
  }, 0);
  return entropy(hs.map((h) => h.probability)) - remaining;
}
