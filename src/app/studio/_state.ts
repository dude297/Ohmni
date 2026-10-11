// Pure studio state: selection sync, constrained wiring edits, revision/confirmation/solve invalidation.
import { holesOfNode, netHoles, type BuildState, type HoleId } from './_model';

export type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'hole'; id: HoleId }
  | { kind: 'jumper'; id: string }
  | { kind: 'node'; name: string }
  | null;
export type Tool = { kind: 'none' } | { kind: 'move'; jumperId: string; end: 'a' | 'b' } | { kind: 'add'; first?: HoleId };
export type SolveState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  rev: number; // revision the result belongs to
  voltages?: Record<string, number>;
  currents?: Record<string, number>;
  error?: string;
};
export type StudioState = {
  build: BuildState;
  revision: number;
  confirmed: boolean;
  selection: Selection;
  tool: Tool;
  solve: SolveState;
  notice?: string;
  nextJumper: number;
};
export type Action =
  | { type: 'select'; sel: Selection }
  | { type: 'clickHole'; hole: HoleId }
  | { type: 'beginMove'; jumperId: string; end: 'a' | 'b' }
  | { type: 'beginAdd' }
  | { type: 'cancelTool' }
  | { type: 'deleteJumper'; id: string }
  | { type: 'load'; build: BuildState }
  | { type: 'confirm'; value: boolean }
  | { type: 'solveStart'; rev: number }
  | { type: 'solveDone'; rev: number; voltages: Record<string, number>; currents: Record<string, number> }
  | { type: 'solveFail'; rev: number; error: string };

export const IDLE_SOLVE: SolveState = { status: 'idle', rev: -1 };

export function initState(build: BuildState): StudioState {
  const n = Math.max(0, ...build.jumpers.map((j) => Number(/^J(\d+)$/.exec(j.id)?.[1] ?? 0)));
  return { build, revision: 0, confirmed: false, selection: null, tool: { kind: 'none' }, solve: IDLE_SOLVE, nextJumper: n + 1 };
}

export function occupant(build: BuildState, hole: HoleId): string | null {
  for (const p of build.placements) {
    if (p.pins.positive === hole) return `${p.id}.positive`;
    if (p.pins.negative === hole) return `${p.id}.negative`;
  }
  for (const j of build.jumpers) {
    if (j.a === hole) return `${j.id}.a`;
    if (j.b === hole) return `${j.id}.b`;
  }
  return null;
}

/** Any wiring edit: new revision, confirmation dropped, stale solver results dropped. */
function edited(s: StudioState, build: BuildState, extra: Partial<StudioState>): StudioState {
  return { ...s, build, revision: s.revision + 1, confirmed: false, solve: IDLE_SOLVE, tool: { kind: 'none' }, notice: undefined, ...extra };
}

export function studioReducer(s: StudioState, a: Action): StudioState {
  switch (a.type) {
    case 'select':
      return { ...s, selection: a.sel, notice: undefined };
    case 'beginMove':
      return { ...s, tool: { kind: 'move', jumperId: a.jumperId, end: a.end }, selection: { kind: 'jumper', id: a.jumperId }, notice: undefined };
    case 'beginAdd':
      return { ...s, tool: { kind: 'add' }, selection: null, notice: undefined };
    case 'cancelTool':
      return { ...s, tool: { kind: 'none' }, notice: undefined };
    case 'clickHole': {
      const t = s.tool;
      if (t.kind === 'none') return { ...s, selection: { kind: 'hole', id: a.hole }, notice: undefined };
      const occ = occupant(s.build, a.hole);
      if (t.kind === 'move') {
        const j = s.build.jumpers.find((x) => x.id === t.jumperId);
        if (!j) return { ...s, tool: { kind: 'none' } };
        if (j[t.end] === a.hole) return { ...s, notice: `${j.id} end ${t.end.toUpperCase()} is already on ${a.hole}` };
        if (occ) return { ...s, notice: `${a.hole} is taken by ${occ}` };
        const jumpers = s.build.jumpers.map((x) => (x.id === j.id ? { ...x, [t.end]: a.hole } : x));
        return edited(s, { ...s.build, jumpers }, { selection: { kind: 'jumper', id: j.id } });
      }
      // add
      if (occ) return { ...s, notice: `${a.hole} is taken by ${occ}` };
      if (!t.first) return { ...s, tool: { kind: 'add', first: a.hole }, notice: undefined };
      const id = `J${s.nextJumper}`;
      return edited(s, { ...s.build, jumpers: [...s.build.jumpers, { id, a: t.first, b: a.hole, color: '#2f6db5' }] }, { nextJumper: s.nextJumper + 1, selection: { kind: 'jumper', id } });
    }
    case 'deleteJumper':
      return edited(s, { ...s.build, jumpers: s.build.jumpers.filter((j) => j.id !== a.id) }, { selection: null });
    case 'load':
      return { ...initState(a.build), revision: s.revision + 1 };
    case 'confirm':
      return { ...s, confirmed: a.value, solve: a.value ? s.solve : IDLE_SOLVE };
    case 'solveStart':
      return a.rev === s.revision && s.confirmed ? { ...s, solve: { status: 'loading', rev: a.rev } } : s;
    case 'solveDone':
      return a.rev === s.revision && s.confirmed ? { ...s, solve: { status: 'ok', rev: a.rev, voltages: a.voltages, currents: a.currents } } : s;
    case 'solveFail':
      return a.rev === s.revision && s.confirmed ? { ...s, solve: { status: 'error', rev: a.rev, error: a.error } } : s;
  }
}

/** Holes to highlight (copper) for the current selection. */
export function selectedHoles(s: StudioState): HoleId[] {
  const sel = s.selection;
  if (!sel) return [];
  if (sel.kind === 'hole') return netHoles(s.build, sel.id);
  if (sel.kind === 'component') {
    const p = s.build.placements.find((x) => x.id === sel.id);
    return p ? [p.pins.positive, p.pins.negative] : [];
  }
  if (sel.kind === 'jumper') {
    const j = s.build.jumpers.find((x) => x.id === sel.id);
    return j ? [j.a, j.b] : [];
  }
  return holesOfNode(s.build, sel.name);
}
