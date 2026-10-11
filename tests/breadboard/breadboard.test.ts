import { describe, expect, it } from 'vitest';
import divider from '../../fixtures/breadboard/divider_5v_half.json';
import bridge from '../../fixtures/breadboard/bridge_12v_full.json';
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import {
  FULL_BOARD,
  FULL_BOARD_SPLIT_RAILS,
  HALF_BOARD,
  buildNets,
  diffAgainstIntended,
  stripOf,
  stripsOf,
  toCircuitGraph,
  type BuildState,
} from '@/lib/breadboard';

const D = divider as unknown as BuildState;
const B = bridge as unknown as BuildState;
const without = (s: BuildState, id: string): BuildState => ({ ...s, jumpers: s.jumpers.filter((j) => j.id !== id) });
const sameNet = (s: BuildState, a: string, b: string) => {
  const { nets } = buildNets({ ...s, probeHoles: { a, b } });
  return nets.some((n) => isJoined(n, s, a, b));
};
const isJoined = (n: { strips: string[] }, s: BuildState, a: string, b: string) => {
  const sa = stripOf(s.board, a)!.id;
  const sb = stripOf(s.board, b)!.id;
  return n.strips.includes(sa) && n.strips.includes(sb);
};
const volts = (s: BuildState) => {
  const r = toCircuitGraph(s);
  return { r, v: r.graph ? solveDC(r.graph).voltages : {} };
};

describe('strips and rails', () => {
  it('5-hole continuity', () => {
    expect(stripOf(HALF_BOARD, 'a10')!.id).toBe(stripOf(HALF_BOARD, 'e10')!.id);
    expect(stripOf(HALF_BOARD, 'a10')!.holes).toEqual(['a10', 'b10', 'c10', 'd10', 'e10']);
    expect(stripOf(HALF_BOARD, 'a10')!.id).not.toBe(stripOf(HALF_BOARD, 'a11')!.id);
    expect(stripsOf(HALF_BOARD).length).toBe(30 * 2 + 4);
  });
  it('center channel: e10 and f10 are not connected', () => {
    expect(stripOf(HALF_BOARD, 'e10')!.id).not.toBe(stripOf(HALF_BOARD, 'f10')!.id);
    expect(sameNet({ ...D, jumpers: [] }, 'e10', 'f10')).toBe(false);
  });
  it('rail break on full board', () => {
    expect(sameNet({ ...B, jumpers: [] }, 'L+1', 'L+40')).toBe(true);
    expect(sameNet({ ...B, board: FULL_BOARD_SPLIT_RAILS, jumpers: [] }, 'L+1', 'L+40')).toBe(false);
    expect(sameNet({ ...B, board: FULL_BOARD_SPLIT_RAILS, jumpers: [] }, 'L+1', 'L+25')).toBe(true);
  });
  it('rejects invalid holes', () => {
    expect(stripOf(HALF_BOARD, 'k5')).toBeNull();
    expect(stripOf(HALF_BOARD, 'a99')).toBeNull();
    expect(stripOf(HALF_BOARD, 'a31')).toBeNull();
    expect(stripOf(FULL_BOARD, 'a31')).not.toBeNull();
    const bad: BuildState = { ...D, jumpers: [{ id: 'J', a: 'k5', b: 'a99' }] };
    expect(buildNets(bad).errors.length).toBe(2);
    const r = toCircuitGraph(bad);
    expect(r.graph).toBeNull();
    expect(r.errors.join()).toContain('invalid hole');
  });
});

describe('connectivity rules', () => {
  it('jumper crossing means nothing: distinct-hole jumpers never connect', () => {
    const s: BuildState = {
      board: FULL_BOARD,
      placements: [],
      jumpers: [
        { id: 'X1', a: 'a1', b: 'a40' },
        { id: 'X2', a: 'a20', b: 'a21' },
      ],
    };
    expect(sameNet(s, 'a1', 'a20')).toBe(false);
    expect(sameNet(s, 'a40', 'a21')).toBe(false);
    expect(sameNet(s, 'a1', 'a40')).toBe(true);
  });
  it('a component pin does not join strips; two pins in one hole is an error', () => {
    const s: BuildState = { board: HALF_BOARD, placements: [{ id: 'R1', kind: 'resistor', value: 1, pins: { positive: 'a1', negative: 'a2' } }], jumpers: [] };
    expect(sameNet(s, 'a1', 'a2')).toBe(false);
    const dup: BuildState = { ...s, placements: [...s.placements, { id: 'R2', kind: 'resistor', value: 1, pins: { positive: 'a1', negative: 'a3' } }] };
    expect(buildNets(dup).errors.join()).toContain('two pins');
  });
  it('both pins in one strip: component shorted by placement', () => {
    const s: BuildState = { ...D, placements: D.placements.map((p) => (p.id === 'R2' ? { ...p, pins: { positive: 'b10', negative: 'c10' } } : p)) };
    expect(toCircuitGraph(s).warnings.join()).toContain('component shorted by placement');
  });
});

describe('reference builds', () => {
  it('divider solves VOUT 2.5 V and diffs clean', () => {
    const { r, v } = volts(D);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(v.VOUT).toBeCloseTo(2.5, 9);
    expect(r.netOfPin['R1.positive']).toBeDefined();
    expect(diffAgainstIntended(DIVIDER_10K_10K, D).identical).toBe(true);
  });
  it('bridge solves A/B/C and diffs clean', () => {
    const { r, v } = volts(B);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(v.A).toBeCloseTo(7.342412, 5);
    expect(v.B).toBeCloseTo(4.087354, 5);
    expect(v.C).toBeCloseTo(2.608949, 5);
    const d = diffAgainstIntended(LOADED_BRIDGE_12V, B);
    expect(d).toMatchObject({ identical: true, componentDiffs: [], connectionDiffs: [] });
  });
  it('flipped resistor is not a diff', () => {
    const s: BuildState = { ...B, placements: B.placements.map((p) => (p.id === 'R5' ? { ...p, pins: { positive: 'c15', negative: 'c10' } } : p)) };
    expect(diffAgainstIntended(LOADED_BRIDGE_12V, s).identical).toBe(true);
  });
  it('missing jumper: C splits, diff names R6/R7 holes, solve changes', () => {
    const s = without(B, 'J_c');
    const { r, v } = volts(s);
    expect(r.warnings).toEqual(expect.arrayContaining(['R6.negative: unconnected pin', 'R7.positive: unconnected pin']));
    expect(v.C).toBeCloseTo(0, 9); // probe C sits on R7's strip, which now only reaches GND
    expect(v.A).toBeCloseTo(7.5328, 3); // R6 effectively open
    const d = diffAgainstIntended(LOADED_BRIDGE_12V, s);
    expect(d.identical).toBe(false);
    expect(d.connectionDiffs).toHaveLength(1);
    expect(d.connectionDiffs[0]).toMatchObject({ componentId: 'R6', terminal: 'negative', intendedNode: 'C', kind: 'wrong_net' });
    expect(d.connectionDiffs[0].holes).toEqual(['a20', 'a25']);
  });
  it('accidental short: B strip tied to GND rail', () => {
    const s: BuildState = { ...B, jumpers: [...B.jumpers, { id: 'J_oops', a: 'd15', b: 'L-5' }] };
    const { r, v } = volts(s);
    expect(r.probeNodes.B).toBe('GND');
    expect(v.GND).toBe(0);
    expect(r.warnings.join()).toContain('R4: component shorted by placement');
    const d = diffAgainstIntended(LOADED_BRIDGE_12V, s);
    expect(d.identical).toBe(false);
    const shorts = d.connectionDiffs.filter((c) => c.kind === 'short');
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.every((c) => c.intendedNode === 'B' && c.observedNode === 'GND')).toBe(true);
    expect(shorts.some((c) => c.holes.includes('d15') && c.holes.includes('L-5'))).toBe(true);
  });
  it('value mismatch and missing part are component diffs', () => {
    const s: BuildState = { ...B, placements: B.placements.filter((p) => p.id !== 'R7').map((p) => (p.id === 'R1' ? { ...p, value: 2000 } : p)) };
    const d = diffAgainstIntended(LOADED_BRIDGE_12V, s);
    expect(d.componentDiffs.map((c) => `${c.componentId}:${c.issue}`).sort()).toEqual(['R1:value_mismatch', 'R7:missing']);
  });
});
