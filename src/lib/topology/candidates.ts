import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';

// Dual-candidate topology probing. One ambiguous junction (two nodes that may or may not be joined)
// gives two wirings: A = as read, B = the two nodes merged. Pick the single meter reading that best
// tells them apart, preferring a power-off resistance check. Pure and deterministic; no model calls.

export type TopologyCandidate = {
  id: 'A' | 'B';
  title: string;
  graph: CircuitGraph;
  alias: Record<string, string>; // node name in A -> surviving node name in this candidate
  shortsSupply: boolean; // merging collapses a voltage source onto one node
};
export type Prediction = { candidateId: string; value: number; openSupplyValue?: number };
export type Measurement = {
  kind: 'resistance' | 'voltage';
  between?: [string, string]; // resistance: the two physical nodes (names as in candidate A)
  node?: string; // voltage: red probe node, black probe on GND
  unit: 'ohm' | 'V';
  predictions: Prediction[];
  separation: number; // |a - b| / (sigma_a + sigma_b); >= 3 means one reading settles it
  instruction: string;
  unplugSupply?: true; // resistance check only valid with the supply physically disconnected
};
export type Discrimination = Measurement & {
  poweredSafe: boolean;
  decisive: boolean; // separation >= 3: one reading settles A vs B
  safety: string;
  voltageOption: Measurement | null; // best powered alternative, only when every candidate is safe to power
};

const R_OL = 1e9; // ponytail: anything above 1 GOhm reads as "OL" (open) on a hobby meter
const MAX_SAFE_A = 0.5; // ponytail: >0.5 A from a breadboard supply = treat as a short; tune per bench
const MIN_SEP = 3;
const sigmaV = (v: number) => 0.02 * Math.abs(v) + 0.01; // same meter model as src/lib/probe
const sigmaR = (r: number) => 0.02 * r + 1; // 2 % + 1 Ohm lead/contact resistance
const sep = (a: number, b: number, s: (x: number) => number) => Math.abs(a - b) / (s(a) + s(b));
const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
const fmtOhm = (r: number) =>
  r >= R_OL ? 'open (OL)' : r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(2)} Ω`;

export const nodesOf = (g: CircuitGraph) => [...new Set(g.components.flatMap((c) => [c.positiveNode, c.negativeNode]))];

/** A = graph as read; B = nodeA and nodeB joined (GND survives a merge). Split direction is not supported. */
export function buildCandidates(graph: CircuitGraph, nodeA: string, nodeB: string): [TopologyCandidate, TopologyCandidate] {
  const nodes = nodesOf(graph);
  if (nodeA === nodeB || !nodes.includes(nodeA) || !nodes.includes(nodeB))
    throw new Error('ambiguous nodes must be two different nodes of the graph');
  const [keep, gone] = nodeB === graph.groundNode ? [nodeB, nodeA] : [nodeA, nodeB];
  const ren = (n: string) => (n === gone ? keep : n);
  const components = graph.components
    .map((c) => ({ ...c, positiveNode: ren(c.positiveNode), negativeNode: ren(c.negativeNode) }))
    // ponytail: a resistor with both leads on one node is shorted out; drop it (mergeDelta from #39).
    .filter((c) => c.kind !== 'resistor' || c.positiveNode !== c.negativeNode);
  return [
    { id: 'A', title: `As read: ${nodeA} and ${nodeB} not connected`, graph, alias: {}, shortsSupply: false },
    {
      id: 'B',
      title: `${nodeA} and ${nodeB} connected`,
      graph: { ...graph, measureNode: ren(graph.measureNode), components },
      alias: { [gone]: keep },
      shortsSupply: components.some((c) => c.kind === 'dc_voltage' && c.positiveNode === c.negativeNode),
    },
  ];
}

/**
 * Resistance an ohmmeter would read between n1 and n2 with power off. Nodal analysis on the resistor
 * network: inject 1 A at n1, n2 is the reference, R = V(n1). Voltage sources are shorted (ideal,
 * Thevenin convention) or, with sources = 'open', removed (supply unplugged). Infinity if unconnected.
 */
export function equivalentResistance(graph: CircuitGraph, n1: string, n2: string, sources: 'short' | 'open' = 'short'): number {
  const all = nodesOf(graph);
  if (!all.includes(n1) || !all.includes(n2)) throw new Error(`unknown node ${all.includes(n1) ? n2 : n1}`);
  const parent = new Map(all.map((n) => [n, n]));
  const find = (n: string): string => (parent.get(n) === n ? n : find(parent.get(n)!));
  if (sources === 'short')
    for (const c of graph.components) if (c.kind === 'dc_voltage') parent.set(find(c.positiveNode), find(c.negativeNode));
  const a = find(n1);
  const ref = find(n2);
  if (a === ref) return 0;
  const edges = graph.components
    .filter((c) => c.kind === 'resistor')
    .map((c) => ({ p: find(c.positiveNode), q: find(c.negativeNode), g: 1 / c.value }))
    .filter((e) => e.p !== e.q);

  // Keep only the part of the network connected to n1 (anything else would make the matrix singular).
  const seen = new Set([a]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges)
      if (seen.has(e.p) !== seen.has(e.q)) {
        seen.add(e.p);
        seen.add(e.q);
        grew = true;
      }
  }
  if (!seen.has(ref)) return Infinity;
  const nodes = [...seen].filter((n) => n !== ref);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const n = nodes.length;
  const G = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const I = new Array<number>(n).fill(0);
  I[idx.get(a)!] = 1;
  for (const { p, q, g } of edges) {
    const i = idx.get(p);
    const j = idx.get(q);
    if (i !== undefined) G[i][i] += g;
    if (j !== undefined) G[j][j] += g;
    if (i !== undefined && j !== undefined) {
      G[i][j] -= g;
      G[j][i] -= g;
    }
  }
  // Gaussian elimination with partial pivoting (G is SPD here, so pivots stay positive).
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(G[r][col]) > Math.abs(G[piv][col])) piv = r;
    [G[col], G[piv]] = [G[piv], G[col]];
    [I[col], I[piv]] = [I[piv], I[col]];
    for (let r = col + 1; r < n; r++) {
      const f = G[r][col] / G[col][col];
      for (let c = col; c < n; c++) G[r][c] -= f * G[col][c];
      I[r] -= f * I[col];
    }
  }
  const v = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = I[r];
    for (let c = r + 1; c < n; c++) s -= G[r][c] * v[c];
    v[r] = s / G[r][r];
  }
  return v[idx.get(a)!];
}

/** Powered DC node voltages, or null when powering this wiring would short or overload the supply. */
export function safeVoltages(c: TopologyCandidate): Record<string, number> | null {
  if (c.shortsSupply) return null;
  try {
    const s = solveDC(c.graph);
    const overload = c.graph.components.some((k) => k.kind === 'dc_voltage' && !(Math.abs(s.currents[k.id]) <= MAX_SAFE_A));
    return overload || !Object.values(s.voltages).every(Number.isFinite) ? null : s.voltages;
  } catch {
    return null; // SolveError: singular / impossible wiring
  }
}

const label = (g: CircuitGraph, n: string) => {
  if (n === g.groundNode) return g.groundNode;
  const r = g.components.find((c) => c.kind === 'resistor' && (c.positiveNode === n || c.negativeNode === n));
  return r ? `${n} (${r.id}'s lead)` : n;
};
const outcomeText = (ps: Prediction[], cs: TopologyCandidate[], fmt: (x: number) => string) =>
  ps
    .map((p, i) => {
      const alt = p.openSupplyValue !== undefined && fmt(p.openSupplyValue) !== fmt(p.value) ? ` (≈${fmt(p.openSupplyValue)} if the supply is unplugged)` : '';
      return `≈${fmt(p.value)}${alt} means ${cs[i].title.replace(/^As read: /, '')}`;
    })
    .join('; ');

/**
 * Every power-off resistance check between two physical nodes, ambiguous pair first. Default: the
 * reading must separate A/B whether the off supply acts as a short or as open. unplugged = true: the
 * user disconnects the supply, so only the open-supply prediction counts (needed when the supply
 * itself sits across the ambiguous pair).
 */
export function resistanceOptions(cs: TopologyCandidate[], ambiguous?: [string, string], unplugged = false): Measurement[] {
  const a = cs[0].graph;
  const nodes = nodesOf(a);
  const pairs: [string, string][] = ambiguous ? [ambiguous] : [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (!pairs.some(([x, y]) => (x === nodes[i] && y === nodes[j]) || (x === nodes[j] && y === nodes[i]))) pairs.push([nodes[i], nodes[j]]);
  return pairs.map(([x, y]) => {
    const r = (c: TopologyCandidate, mode: 'short' | 'open') =>
      Math.min(R_OL, equivalentResistance(c.graph, c.alias[x] ?? x, c.alias[y] ?? y, mode));
    const predictions: Prediction[] = unplugged
      ? cs.map((c) => ({ candidateId: c.id, value: r(c, 'open') }))
      : cs.map((c) => ({ candidateId: c.id, value: r(c, 'short'), openSupplyValue: r(c, 'open') }));
    const [p, q] = predictions;
    const separation = unplugged
      ? sep(p.value, q.value, sigmaR)
      : Math.min(sep(p.value, q.value, sigmaR), sep(p.openSupplyValue!, q.openSupplyValue!, sigmaR));
    const how = unplugged ? 'With power OFF and the supply disconnected from the circuit (unplug one supply lead)' : 'With power OFF';
    return {
      ...(unplugged && { unplugSupply: true as const }),
      kind: 'resistance' as const,
      between: [x, y] as [string, string],
      unit: 'ohm' as const,
      predictions,
      separation,
      instruction: `${how}, measure resistance between ${label(a, x)} and ${label(a, y)}: ${outcomeText(predictions, cs, fmtOhm)}.`,
    };
  });
}

/** Powered node-voltage checks (black probe on GND); empty when any candidate is unsafe to power. */
export function voltageOptions(cs: TopologyCandidate[]): Measurement[] {
  const vs = cs.map(safeVoltages);
  if (vs.some((v) => v === null)) return [];
  const a = cs[0].graph;
  return nodesOf(a)
    .filter((n) => n !== a.groundNode)
    .map((n) => {
      const predictions = cs.map((c, i) => ({ candidateId: c.id, value: vs[i]![c.alias[n] ?? n] }));
      return {
        kind: 'voltage' as const,
        node: n,
        unit: 'V' as const,
        predictions,
        separation: sep(predictions[0].value, predictions[1].value, sigmaV),
        instruction: `With power ON, black probe on ${a.groundNode}, red probe on ${label(a, n)}: ${outcomeText(predictions, cs, fmtV)}.`,
      };
    });
}

const best = (ms: Measurement[]) => ms.reduce<Measurement | null>((b, m) => (!b || m.separation > b.separation + 1e-9 ? m : b), null);

/** Most informative single measurement; power-off resistance wins whenever it separates the candidates. */
export function discriminate(cs: [TopologyCandidate, TopologyCandidate], ambiguous?: [string, string]): Discrimination {
  let r = best(resistanceOptions(cs, ambiguous))!;
  if (r.separation < MIN_SEP) {
    const u = best(resistanceOptions(cs, ambiguous, true))!;
    if (u.separation > r.separation) r = u;
  }
  const v = best(voltageOptions(cs));
  const poweredSafe = v !== null;
  const safety = poweredSafe
    ? 'Low-voltage DC only. Disconnect power before measuring resistance; an ohmmeter on a live circuit reads wrong and can be damaged.'
    : `DO NOT power this circuit to test: ${cs.filter((c) => !safeVoltages(c)).map((c) => `"${c.title}"`).join(' and ')} would short or overload the supply. Use the power-off resistance check only.`;
  const pick = r.separation >= MIN_SEP || !v || v.separation <= r.separation ? r : v;
  return { ...pick, decisive: pick.separation >= MIN_SEP, poweredSafe, safety, voltageOption: pick.kind === 'voltage' ? null : v };
}
