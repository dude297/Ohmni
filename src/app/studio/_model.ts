// Canonical model lives in @/lib/breadboard (merged from moonshot/studio-breadboard). This file only adds UI-side helpers.
import { buildNetIndex, stripOf, toCircuitGraph, type BoardSpec, type BuildState, type HoleId } from '@/lib/breadboard';

export * from '@/lib/breadboard';

export const HALF = { id: 'half', cols: 30, railSegments: 1 } as const satisfies BoardSpec;
export const RAIL_NAMES = ['L+', 'L-', 'R+', 'R-'] as const;
export const RAIL_LEN = 25;

export function parseHole(h: HoleId, board: BoardSpec = HALF) {
  const m = /^([a-j])([1-9]\d?)$/.exec(h);
  if (m && Number(m[2]) <= board.cols) return { kind: 'main' as const, row: m[1], col: Number(m[2]) };
  const r = /^([LR][+-])([1-9]\d?)$/.exec(h);
  if (r && Number(r[2]) <= RAIL_LEN) return { kind: 'rail' as const, rail: r[1], n: Number(r[2]) };
  return null;
}

export function allHoles(board: BoardSpec = HALF): HoleId[] {
  const out: HoleId[] = [];
  const rail = (r: string) => Array.from({ length: RAIL_LEN }, (_, i) => `${r}${i + 1}`);
  out.push(...rail('L+'), ...rail('L-'));
  for (const row of 'abcdefghij') for (let c = 1; c <= board.cols; c++) out.push(`${row}${c}`);
  out.push(...rail('R+'), ...rail('R-'));
  return out;
}

/** Every hole electrically connected to `hole` (all strips + jumpers). */
export function netHoles(state: BuildState, hole: HoleId): HoleId[] {
  return buildNetIndex(state).netOfHole(hole)?.holes ?? stripOf(state.board, hole)?.holes ?? [];
}

/** Graph node name (GND / VIN-ish probe label / N1..) of the net holding `hole`, or null when nothing uses it. */
export function nodeNameOfHole(state: BuildState, hole: HoleId): string | null {
  const id = buildNetIndex(state).netOfHole(hole)?.id;
  return id ? (toCircuitGraph(state).nodeOfNet[id] ?? null) : null;
}

/** Holes of the net carrying graph node `name`. */
export function holesOfNode(state: BuildState, name: string): HoleId[] {
  const g = toCircuitGraph(state);
  const idx = buildNetIndex(state);
  return idx.nets.find((n) => g.nodeOfNet[n.id] === name)?.holes ?? [];
}

