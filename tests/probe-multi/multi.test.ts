import { describe, expect, it } from 'vitest';
import { LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import { probeStep } from '@/lib/probe';
import { probeStepMulti, MAX_PAIR_CANDIDATES } from '@/lib/probe-multi';
import type { CircuitGraph } from '@/lib/circuit/types';

const ladder: CircuitGraph = {
  schemaVersion: 1,
  groundNode: 'GND',
  measureNode: 'B',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10000, positiveNode: 'VIN', negativeNode: 'A' },
    { id: 'R2', kind: 'resistor', value: 10000, positiveNode: 'A', negativeNode: 'B' },
    { id: 'R3', kind: 'resistor', value: 10000, positiveNode: 'B', negativeNode: 'GND' },
  ],
};
const withR = (g: CircuitGraph, id: string, v: number): CircuitGraph => ({ ...g, components: g.components.map((c) => (c.id === id ? { ...c, value: v } : c)) });
const readAll = (g: CircuitGraph) => Object.entries(solveDC(g).voltages).filter(([n]) => n !== 'GND').map(([node, volts]) => ({ node, volts }));
const two = { maxFaults: 2 as const };

describe('probeStepMulti', () => {
  it('(1) single-fault regression: R6 open on the bridge concludes like probeStep', () => {
    const obs = [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }];
    const s1 = probeStep(LOADED_BRIDGE_12V, obs);
    const m1 = probeStepMulti(LOADED_BRIDGE_12V, obs, { maxFaults: 1 });
    const m2 = probeStepMulti(LOADED_BRIDGE_12V, obs, two);
    expect(m1.hypotheses.map((h) => h.id)).toEqual(s1.hypotheses.map((h) => h.id));
    expect(s1.hypotheses[0].id).toBe('R6:open');
    expect(m2.hypotheses[0].id).toBe('R6:open');
    expect(m2.hypotheses[0].probability).toBeGreaterThan(0.6); // pairs dilute a little; B reading would finish it
    expect(probeStepMulti(LOADED_BRIDGE_12V, [...obs, { node: "B", volts: 5.22 }], two).done).toBe(true);
    expect(m2.fitWarning).toBeUndefined();
  });

  it('(1b) ladder R2 open: same winner', () => {
    const obs = [{ node: 'B', volts: 0 }, { node: 'A', volts: 5 }];
    expect(probeStepMulti(ladder, obs, two).hypotheses[0].id).toBe(probeStep(ladder, obs).hypotheses[0].id);
  });

  it('(2) genuine double fault: singles misfit, pair ranks top (bridge R7 x10 + R1 open)', () => {
    const truth = withR(withR(LOADED_BRIDGE_12V, 'R7', 12000), 'R1', 1e9);
    const obs = readAll(truth);
    const s = probeStep(LOADED_BRIDGE_12V, obs);
    expect(s.fitWarning).toBeDefined();
    const m = probeStepMulti(LOADED_BRIDGE_12V, obs, two);
    expect(m.hypotheses[0].id).toBe('R1:open+R7:x10');
    expect(m.hypotheses[0].title).toMatch(/Two independent faults/);
    expect(m.fitWarning).toMatch(/two independent faults/);
    expect(m.fitWarning).toMatch(/still a hypothesis|This is still a hypothesis/);
  });

  it('(2b) ladder double fault R1 x10 + R3 x0.1', () => {
    const obs = readAll(withR(withR(ladder, 'R1', 100000), 'R3', 1000));
    expect(probeStep(ladder, obs).fitWarning).toBeDefined();
    expect(probeStepMulti(ladder, obs, two).hypotheses[0].id).toBe('R1:x10+R3:x0.1');
  });

  it('(3) equivalent pairs merge into the single with a note (supply dead + anything)', () => {
    const m = probeStepMulti(ladder, [], two);
    expect(m.notes.some((n) => /V1:dead/.test(n) && /merged/.test(n))).toBe(true);
    expect(m.hypotheses.filter((h) => h.id.includes('V1:dead')).map((h) => h.id)).toEqual(['V1:dead']);
    expect(m.pairCandidates).toBeGreaterThan(m.pairsSolved);
  });

  it('(4) combinatorics cap falls back to singles with a warning and count', () => {
    const comps: CircuitGraph['components'] = [{ id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'N0', negativeNode: 'GND' }];
    for (let i = 0; i < 20; i++) comps.push({ id: `R${i + 1}`, kind: 'resistor', value: 1000, positiveNode: `N${i}`, negativeNode: i === 19 ? 'GND' : `N${i + 1}` });
    const big: CircuitGraph = { schemaVersion: 1, groundNode: 'GND', measureNode: 'N5', components: comps };
    const m = probeStepMulti(big, [], two);
    expect(m.pairCandidates).toBeGreaterThan(MAX_PAIR_CANDIDATES);
    expect(m.warnings[0]).toMatch(/falling back to single faults/);
    expect(m.pairsSolved).toBe(0);
    expect(m.hypotheses.every((h) => !h.id.includes('+'))).toBe(true);
  });

  it('(5) performance: bridge pairs solve fast', () => {
    const obs = [{ node: 'C', volts: 0 }];
    const t = performance.now();
    const m = probeStepMulti(LOADED_BRIDGE_12V, obs, two);
    const ms = performance.now() - t;
    console.log(`bridge: ${m.pairCandidates} pair candidates, ${m.pairsSolved} kept, ${m.notes.length} merged, ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});
