// TODO(moonshot/studio-breadboard): TEMPORARY local copy of the breadboard model contract.
// Replace this whole file with `export * from '@/lib/breadboard'` once that branch merges.
// Connectivity is ONLY via strips + explicit jumper endpoints, never proximity.
import type { CircuitGraph } from '@/lib/circuit/types';
import { validateGraph } from '@/lib/circuit/validate';

export type HoleId = string; // 'a1'..'j30' or rails 'L+1','L-1','R+1','R-1'
export type BoardSpec = { id: 'half' | 'full'; cols: 30 | 63; railSegments: number; railBreakAfter?: number };
export type Placement = {
  id: string;
  kind: 'resistor' | 'dc_supply';
  value: number;
  pins: { positive: HoleId; negative: HoleId };
};
export type Jumper = { id: string; a: HoleId; b: HoleId; color?: string };
export type BuildState = {
  board: BoardSpec;
  placements: Placement[];
  jumpers: Jumper[];
  groundNet?: HoleId;
  probeHoles?: Record<string, HoleId>; // label -> a hole whose net gets that label
};
export type Net = { id: string; holes: HoleId[]; strips: string[]; label?: string };

export const HALF_BOARD: BoardSpec = { id: 'half', cols: 30, railSegments: 1 };
export const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
export const ROWS_BOTTOM = ['f', 'g', 'h', 'i', 'j'];
export const RAIL_NAMES = ['L+', 'L-', 'R+', 'R-'];
export const RAIL_LEN = 25;

const MAIN = /^([a-j])(\d{1,2})$/;
const RAIL = /^([LR][+-])(\d{1,2})$/;

export function parseHole(h: HoleId, board: BoardSpec = HALF_BOARD) {
  const m = MAIN.exec(h);
  if (m) {
    const col = Number(m[2]);
    if (col >= 1 && col <= board.cols) return { kind: 'main' as const, row: m[1], col };
  }
  const r = RAIL.exec(h);
  if (r) {
    const n = Number(r[2]);
    if (n >= 1 && n <= RAIL_LEN) return { kind: 'rail' as const, rail: r[1], n };
  }
  return null;
}

export function allHoles(board: BoardSpec = HALF_BOARD): HoleId[] {
  const out: HoleId[] = [];
  for (const r of RAIL_NAMES.slice(0, 2)) for (let n = 1; n <= RAIL_LEN; n++) out.push(`${r}${n}`);
  for (const row of [...ROWS_TOP, ...ROWS_BOTTOM]) for (let c = 1; c <= board.cols; c++) out.push(`${row}${c}`);
  for (const r of RAIL_NAMES.slice(2)) for (let n = 1; n <= RAIL_LEN; n++) out.push(`${r}${n}`);
  return out;
}

export function stripOf(h: HoleId, board: BoardSpec = HALF_BOARD): string | null {
  const p = parseHole(h, board);
  if (!p) return null;
  if (p.kind === 'rail') {
    const seg = board.railBreakAfter && p.n > board.railBreakAfter ? 1 : 0;
    return `${p.rail}#${seg}`;
  }
  return `${ROWS_TOP.includes(p.row) ? 'T' : 'B'}${p.col}`;
}

export function holesOfStrip(strip: string, board: BoardSpec = HALF_BOARD): HoleId[] {
  return allHoles(board).filter((h) => stripOf(h, board) === strip);
}

function find(parent: Map<string, string>, x: string): string {
  if (!parent.has(x)) parent.set(x, x);
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  parent.set(x, r);
  return r;
}

/** Union-find over strips joined by explicit jumpers. */
function components(state: BuildState) {
  const parent = new Map<string, string>();
  for (const j of state.jumpers) {
    const sa = stripOf(j.a, state.board);
    const sb = stripOf(j.b, state.board);
    if (sa && sb) {
      const ra = find(parent, sa);
      const rb = find(parent, sb);
      if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra); // smaller key is root: deterministic
    }
  }
  return (s: string) => find(parent, s);
}

/** Strips that matter: any strip touched by a pin or a jumper end. */
function usedStrips(state: BuildState) {
  const holes = [...state.placements.flatMap((p) => [p.pins.positive, p.pins.negative]), ...state.jumpers.flatMap((j) => [j.a, j.b])];
  return [...new Set(holes.map((h) => stripOf(h, state.board)).filter((s): s is string => !!s))];
}

/** Every hole electrically connected to `hole` (all strips + jumpers). */
export function netHoles(state: BuildState, hole: HoleId): HoleId[] {
  const s = stripOf(hole, state.board);
  if (!s) return [];
  const root = components(state);
  const r = root(s);
  const strips = new Set<string>([s, ...usedStrips(state).filter((x) => root(x) === r)]);
  return [...strips].flatMap((x) => holesOfStrip(x, state.board));
}

export function buildNets(state: BuildState): { nets: Net[]; errors: string[] } {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const claim = (h: HoleId, who: string) => {
    if (!parseHole(h, state.board)) errors.push(`${who}: unknown hole "${h}"`);
    else if (seen.has(h)) errors.push(`${who} and ${seen.get(h)} both use hole ${h}`);
    else seen.set(h, who);
  };
  for (const p of state.placements) {
    claim(p.pins.positive, `${p.id}.positive`);
    claim(p.pins.negative, `${p.id}.negative`);
  }
  for (const j of state.jumpers) {
    claim(j.a, `${j.id}.a`);
    claim(j.b, `${j.id}.b`);
    if (j.a === j.b) errors.push(`${j.id}: both ends on ${j.a}`);
  }
  const root = components(state);
  const groups = new Map<string, string[]>();
  for (const s of usedStrips(state)) groups.set(root(s), [...(groups.get(root(s)) ?? []), s]);
  const nets: Net[] = [...groups.values()]
    .map((strips) => strips.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map((strips, i) => ({ id: `net${i + 1}`, strips, holes: strips.flatMap((s) => holesOfStrip(s, state.board)) }));
  return { nets, errors };
}

export function netOfHole(nets: Net[], state: BuildState, h: HoleId) {
  const s = stripOf(h, state.board);
  return nets.find((n) => s && n.strips.includes(s));
}

/** Label nets: GND (supply -, or groundNet), probe labels, VIN (supply +), else N1.. */
function labelNets(state: BuildState, nets: Net[]): Net[] {
  const out = nets.map((n) => ({ ...n }));
  const get = (h?: HoleId) => (h ? netOfHole(out, state, h) : undefined);
  const supply = state.placements.find((p) => p.kind === 'dc_supply');
  const gnd = get(state.groundNet) ?? get(supply?.pins.negative);
  if (gnd) gnd.label = 'GND';
  for (const [label, h] of Object.entries(state.probeHoles ?? {})) {
    const n = get(h);
    if (n && !n.label) n.label = label;
  }
  const vin = get(supply?.pins.positive);
  if (vin && !vin.label) vin.label = 'VIN';
  let k = 1;
  for (const n of out) if (!n.label) n.label = `N${k++}`;
  return out;
}

export type PinMap = Record<string, string>; // 'R1.positive' -> node name
export function toCircuitGraph(state: BuildState): {
  graph: CircuitGraph | null;
  netOfPin: PinMap;
  nets: Net[];
  errors: string[];
  warnings: string[];
} {
  const { nets: raw, errors } = buildNets(state);
  const nets = labelNets(state, raw);
  const warnings: string[] = [];
  const netOfPin: PinMap = {};
  const nodeOf = (h: HoleId) => netOfHole(nets, state, h)?.label ?? '?';
  for (const p of state.placements) {
    netOfPin[`${p.id}.positive`] = nodeOf(p.pins.positive);
    netOfPin[`${p.id}.negative`] = nodeOf(p.pins.negative);
  }
  if (!state.placements.some((p) => p.kind === 'dc_supply')) errors.push('no supply placed');
  for (const p of state.placements) {
    if (netOfPin[`${p.id}.positive`] === netOfPin[`${p.id}.negative`]) errors.push(`${p.id}: both pins on net ${netOfPin[`${p.id}.positive`]} (shorted)`);
  }
  const measure = Object.keys(state.probeHoles ?? {}).find((l) => nets.some((n) => n.label === l)) ?? 'VOUT';
  let graph: CircuitGraph | null = null;
  if (!errors.length) {
    const g: CircuitGraph = {
      schemaVersion: 1,
      components: state.placements.map((p) => ({
        id: p.id,
        kind: p.kind === 'dc_supply' ? 'dc_voltage' : 'resistor',
        value: p.value,
        positiveNode: netOfPin[`${p.id}.positive`],
        negativeNode: netOfPin[`${p.id}.negative`],
      })),
      groundNode: 'GND',
      measureNode: measure,
    };
    const v = validateGraph(g);
    if (v.ok) graph = v.graph;
    else errors.push(...v.errors);
  }
  return { graph, netOfPin, nets, errors, warnings };
}

export type ConnectionDiff = { componentId: string; terminal: 'positive' | 'negative'; intendedNode: string; observedNode: string; holes: HoleId[] };
export type ComponentDiff = { componentId: string; problem: 'missing' | 'value'; detail: string };

export function diffAgainstIntended(intended: CircuitGraph, build: BuildState) {
  const { netOfPin, errors } = toCircuitGraph(build);
  const componentDiffs: ComponentDiff[] = [];
  const connectionDiffs: ConnectionDiff[] = [];
  type Term = { id: string; t: 'positive' | 'negative'; node: string; hole: HoleId; obs: string };
  const terms: Term[] = [];
  for (const c of intended.components) {
    const p = build.placements.find((x) => x.id === c.id);
    if (!p) {
      componentDiffs.push({ componentId: c.id, problem: 'missing', detail: `${c.id} is not on the board` });
      continue;
    }
    if (p.value !== c.value) componentDiffs.push({ componentId: c.id, problem: 'value', detail: `${c.id} is ${p.value}, intended ${c.value}` });
    for (const t of ['positive', 'negative'] as const)
      terms.push({ id: c.id, t, node: t === 'positive' ? c.positiveNode : c.negativeNode, hole: p.pins[t], obs: netOfPin[`${c.id}.${t}`] ?? '?' });
  }
  // The observed net most terminals of an intended node agree on is that node's "home" net.
  const home = new Map<string, string>();
  for (const node of new Set(terms.map((x) => x.node))) {
    const counts = new Map<string, number>();
    for (const x of terms.filter((y) => y.node === node)) counts.set(x.obs, (counts.get(x.obs) ?? 0) + 1);
    home.set(node, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  for (const x of terms) {
    const h = home.get(x.node)!;
    const ref = terms.find((y) => y.node === x.node && y.obs === h)!;
    const clash = [...home.entries()].find(([n, o]) => n !== x.node && o === h);
    if (x.obs !== h) connectionDiffs.push({ componentId: x.id, terminal: x.t, intendedNode: x.node, observedNode: x.obs, holes: [x.hole, ref.hole] });
    else if (clash) connectionDiffs.push({ componentId: x.id, terminal: x.t, intendedNode: x.node, observedNode: `${x.node}=${clash[0]} (short)`, holes: [x.hole] });
  }
  return { componentDiffs, connectionDiffs, identical: !componentDiffs.length && !connectionDiffs.length && !errors.length, uncertainties: errors };
}
