import type { BoardSpec, HoleId, Strip } from './types';

export const HALF_BOARD: BoardSpec = { id: 'half', cols: 30, railSegments: 1 };
export const FULL_BOARD: BoardSpec = { id: 'full', cols: 63, railSegments: 1 };
export const FULL_BOARD_SPLIT_RAILS: BoardSpec = { id: 'full', cols: 63, railSegments: 2, railBreakAfter: [25] };

// ponytail: rail length is fixed per board size (25 half / 50 full); real boards vary, add to BoardSpec if needed.
export const railLength = (b: BoardSpec) => (b.cols === 30 ? 25 : 50);

type ParsedHole =
  | { kind: 'main'; row: string; col: number }
  | { kind: 'rail'; side: 'L' | 'R'; pol: '+' | '-'; idx: number };

function parseHole(board: BoardSpec, id: HoleId): ParsedHole | null {
  if (typeof id !== 'string') return null;
  let m = /^([a-j])([1-9]\d?)$/.exec(id);
  if (m) {
    const col = Number(m[2]);
    return col <= board.cols ? { kind: 'main', row: m[1], col } : null;
  }
  m = /^([LR])([+-])([1-9]\d?)$/.exec(id);
  if (m) {
    const idx = Number(m[3]);
    return idx <= railLength(board) ? { kind: 'rail', side: m[1] as 'L' | 'R', pol: m[2] as '+' | '-', idx } : null;
  }
  return null;
}

// A break after k puts rail holes with index > k into the next segment.
const segOf = (b: BoardSpec, idx: number) => (b.railBreakAfter ?? []).filter((k) => k < idx).length;

/** Strip id only (cheap). Null for invalid holes. */
export function stripIdOfHole(board: BoardSpec, hole: HoleId): string | null {
  const h = parseHole(board, hole);
  if (!h) return null;
  if (h.kind === 'main') return `col${h.col}-${h.row <= 'e' ? 'top' : 'bot'}`;
  return `rail-${h.side}${h.pol}-s${segOf(board, h.idx)}`;
}

export function stripsOf(board: BoardSpec): Strip[] {
  const out: Strip[] = [];
  for (let c = 1; c <= board.cols; c++) {
    out.push({ id: `col${c}-top`, holes: [...'abcde'].map((r) => `${r}${c}`) });
    out.push({ id: `col${c}-bot`, holes: [...'fghij'].map((r) => `${r}${c}`) });
  }
  for (const side of ['L', 'R'] as const)
    for (const pol of ['+', '-'] as const) {
      const segs = new Map<number, string[]>();
      for (let i = 1; i <= railLength(board); i++) {
        const s = segOf(board, i);
        segs.set(s, [...(segs.get(s) ?? []), `${side}${pol}${i}`]);
      }
      for (const [s, holes] of segs) out.push({ id: `rail-${side}${pol}-s${s}`, holes });
    }
  return out;
}

export function stripOf(board: BoardSpec, hole: HoleId): Strip | null {
  const id = stripIdOfHole(board, hole);
  return id ? (stripsOf(board).find((s) => s.id === id) ?? null) : null;
}
