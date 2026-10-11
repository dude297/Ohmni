// Hole <-> board-plane mapping shared by the 3D scene and the 2D fallback. 1 unit = 0.1 in (2.54 mm).
// x runs along columns, z across rows; y is up in 3D. Top rails (L) sit above row a, bottom rails (R) below row j.
import { HALF_BOARD, parseHole, type BoardSpec, type HoleId } from './_model';

const ROW_Z: Record<string, number> = { a: -4, b: -3, c: -2, d: -1, e: 0, f: 3, g: 4, h: 5, i: 6, j: 7 };
const RAIL_Z: Record<string, number> = { 'L+': -7.5, 'L-': -6.5, 'R+': 9.5, 'R-': 10.5 };
export const BOARD_BOUNDS = { minX: -2, maxX: 31, minZ: -9.5, maxZ: 12.5 };

export function holePos(h: HoleId, board: BoardSpec = HALF_BOARD): { x: number; z: number } | null {
  const p = parseHole(h, board);
  if (!p) return null;
  if (p.kind === 'main') return { x: p.col - 1, z: ROW_Z[p.row] };
  return { x: ((p.n - 1) * (board.cols - 1)) / 24, z: RAIL_Z[p.rail] };
}

/** Nearest hole to a board-plane point within `tol` units (pointer picking / tests). */
export function nearestHole(x: number, z: number, holes: HoleId[], board: BoardSpec = HALF_BOARD, tol = 0.45): HoleId | null {
  let best: HoleId | null = null;
  let bd = tol;
  for (const h of holes) {
    const p = holePos(h, board)!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

export type View = 'iso' | 'top' | 'side';
export const VIEW_PRESETS: Record<View, { pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { pos: [30, 26, 30], target: [15, 0, 1.5] },
  top: { pos: [15, 46, 1.6], target: [15, 0, 1.5] },
  side: { pos: [15, 7, 42], target: [15, 0, 1.5] },
};
