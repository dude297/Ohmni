import { describe, expect, it } from 'vitest';
import { resistorBands } from '@/app/studio/_bands';
import { BOARD_BOUNDS, holePos, nearestHole } from '@/app/studio/_geometry';
import { allHoles, diffAgainstIntended, netHoles, toCircuitGraph } from '@/app/studio/_model';
import { CORRECT_PRESET, INTENDED, MISTAKE_PRESET } from '@/app/studio/_examples';
import { initState, selectedHoles, studioReducer } from '@/app/studio/_state';
import { solveDC } from '@/lib/circuit/solve';

describe('hole <-> 3D mapping', () => {
  const holes = allHoles();
  it('every hole has a unique position inside the board', () => {
    const keys = new Set(holes.map((h) => JSON.stringify(holePos(h))));
    expect(keys.size).toBe(holes.length);
    for (const h of holes) {
      const p = holePos(h)!;
      expect(p.x).toBeGreaterThan(BOARD_BOUNDS.minX);
      expect(p.x).toBeLessThan(BOARD_BOUNDS.maxX);
      expect(p.z).toBeGreaterThan(BOARD_BOUNDS.minZ);
      expect(p.z).toBeLessThan(BOARD_BOUNDS.maxZ);
    }
  });
  it('columns are 1 unit apart; rows a..j ascend; centre channel is wider', () => {
    expect(holePos('a2')!.x - holePos('a1')!.x).toBe(1);
    expect(holePos('b1')!.z - holePos('a1')!.z).toBe(1);
    expect(holePos('f1')!.z - holePos('e1')!.z).toBeGreaterThan(1);
  });
  it('nearestHole inverts holePos', () => {
    for (const h of ['a1', 'e30', 'j12', 'L+3', 'R-25']) {
      const p = holePos(h)!;
      expect(nearestHole(p.x + 0.1, p.z - 0.1, holes)).toBe(h);
    }
    expect(nearestHole(100, 100, holes)).toBeNull();
  });
  it('returns null for unknown holes', () => {
    expect(holePos('k1')).toBeNull();
    expect(holePos('a31')).toBeNull();
  });
});

describe('colour bands', () => {
  it('encodes common values', () => {
    expect(resistorBands(10000)!.names).toEqual(['brown', 'black', 'orange', 'gold']);
    expect(resistorBands(330)!.names).toEqual(['orange', 'orange', 'brown', 'gold']);
    expect(resistorBands(4700)!.names).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBands(1000)!.names).toEqual(['brown', 'black', 'red', 'gold']);
    expect(resistorBands(2.2)!.names).toEqual(['red', 'red', 'gold', 'gold']);
    expect(resistorBands(1e6)!.names.slice(0, 3)).toEqual(['brown', 'black', 'green']);
  });
  it('rejects invalid values', () => {
    expect(resistorBands(0)).toBeNull();
    expect(resistorBands(NaN)).toBeNull();
  });
});

describe('model: mistake vs correct', () => {
  it('mistake splits VOUT and the diff points at R2', () => {
    const d = diffAgainstIntended(INTENDED, MISTAKE_PRESET());
    expect(d.identical).toBe(false);
    expect(d.connectionDiffs).toHaveLength(1);
    expect(d.connectionDiffs[0]).toMatchObject({ componentId: 'R2', terminal: 'positive', intendedNode: 'VOUT' });
    expect(d.connectionDiffs[0].holes).toEqual(['a14', 'a10']);
    const g = toCircuitGraph(MISTAKE_PRESET()).graph!;
    expect(solveDC(g).voltages.VOUT).toBeCloseTo(5, 9); // R1 side floats up to VIN
  });
  it('correct build is identical and computes 2.5 V', () => {
    const d = diffAgainstIntended(INTENDED, CORRECT_PRESET());
    expect(d.identical).toBe(true);
    expect(solveDC(toCircuitGraph(CORRECT_PRESET()).graph!).voltages.VOUT).toBeCloseTo(2.5, 12);
  });
  it('net highlight follows strips + jumpers only, never proximity', () => {
    const holes = netHoles(CORRECT_PRESET(), 'e10');
    expect(holes).toContain('a14'); // via J2
    expect(holes).not.toContain('a11'); // adjacent column, not connected
    expect(netHoles(MISTAKE_PRESET(), 'e10')).not.toContain('a14');
  });
  it('flags a short between nodes', () => {
    const b = CORRECT_PRESET();
    b.jumpers.push({ id: 'J9', a: 'd5', b: 'd18' }); // VIN <-> GND
    const d = diffAgainstIntended(INTENDED, b);
    expect(d.identical).toBe(false);
    expect(toCircuitGraph(b).errors.length).toBeGreaterThan(0);
  });
});

describe('studio reducer', () => {
  const mk = () => initState(MISTAKE_PRESET());
  it('selection sync: component -> pin holes, hole -> whole net, node -> labelled net', () => {
    let s = studioReducer(mk(), { type: 'select', sel: { kind: 'component', id: 'R1' } });
    expect(selectedHoles(s)).toEqual(['a5', 'a10']);
    s = studioReducer(s, { type: 'clickHole', hole: 'b5' });
    expect(s.selection).toEqual({ kind: 'hole', id: 'b5' });
    expect(selectedHoles(s)).toContain('L+25');
    s = studioReducer(s, { type: 'select', sel: { kind: 'node', name: 'VOUT' } });
    expect(selectedHoles(s)).toContain('a10');
    expect(selectedHoles(s)).not.toContain('a14');
  });
  it('moving a jumper end fixes the build, bumps revision and drops confirmation + solve', () => {
    let s = mk();
    s = studioReducer(s, { type: 'confirm', value: true });
    s = studioReducer(s, { type: 'solveStart', rev: s.revision });
    s = studioReducer(s, { type: 'solveDone', rev: s.revision, voltages: { VOUT: 5 }, currents: {} });
    expect(s.solve.status).toBe('ok');
    const rev = s.revision;
    s = studioReducer(s, { type: 'beginMove', jumperId: 'J2', end: 'b' });
    s = studioReducer(s, { type: 'clickHole', hole: 'c14' });
    expect(s.revision).toBe(rev + 1);
    expect(s.confirmed).toBe(false);
    expect(s.solve.status).toBe('idle');
    expect(s.tool.kind).toBe('none');
    expect(diffAgainstIntended(INTENDED, s.build).identical).toBe(true);
  });
  it('late solver results for an old revision are ignored', () => {
    let s = studioReducer(mk(), { type: 'confirm', value: true });
    const old = s.revision;
    s = studioReducer(s, { type: 'deleteJumper', id: 'J1' });
    s = studioReducer(s, { type: 'confirm', value: true });
    s = studioReducer(s, { type: 'solveDone', rev: old, voltages: { VOUT: 1 }, currents: {} });
    expect(s.solve.status).toBe('idle');
  });
  it('rejects occupied targets and does not bump revision', () => {
    let s = studioReducer(mk(), { type: 'beginMove', jumperId: 'J2', end: 'b' });
    const rev = s.revision;
    s = studioReducer(s, { type: 'clickHole', hole: 'a14' }); // R2 pin
    expect(s.revision).toBe(rev);
    expect(s.notice).toMatch(/taken/);
    expect(s.tool.kind).toBe('move');
  });
  it('add jumper takes two clicks; delete removes it', () => {
    let s = studioReducer(mk(), { type: 'beginAdd' });
    s = studioReducer(s, { type: 'clickHole', hole: 'e1' });
    expect(s.revision).toBe(0);
    s = studioReducer(s, { type: 'clickHole', hole: 'e2' });
    expect(s.build.jumpers.at(-1)).toMatchObject({ id: 'J4', a: 'e1', b: 'e2' });
    expect(s.revision).toBe(1);
    s = studioReducer(s, { type: 'deleteJumper', id: 'J4' });
    expect(s.build.jumpers.find((j) => j.id === 'J4')).toBeUndefined();
    expect(s.revision).toBe(2);
  });
  it('selecting never changes revision or confirmation', () => {
    let s = studioReducer(mk(), { type: 'confirm', value: true });
    s = studioReducer(s, { type: 'select', sel: { kind: 'jumper', id: 'J2' } });
    expect(s.confirmed).toBe(true);
    expect(s.revision).toBe(0);
  });
});
