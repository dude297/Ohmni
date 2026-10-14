import { describe, expect, it } from 'vitest';
import { solveDC, SolveError } from '../../src/lib/circuit/solve';
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V, SERIES_PARALLEL_12V } from '../../src/lib/circuit/fixtures';
import { kclViolation, stress, tinyR1 } from '../../bench/solver-stress';
import type { CircuitGraph } from '../../src/lib/circuit/types';

describe('solver numerical honesty', () => {
  it('well-conditioned fixtures carry no warnings', () => {
    for (const g of [DIVIDER_10K_10K, SERIES_PARALLEL_12V, LOADED_BRIDGE_12V]) expect(solveDC(g).warnings).toBeUndefined();
  });

  it('R1 = 1e-12 ohm: the 11 % KCL violation is reported, not silent', () => {
    const s = solveDC(tinyR1());
    expect(kclViolation(tinyR1(), s)).toBeGreaterThan(1e-3);
    expect(s.warnings).toEqual(['ill_conditioned']);
    expect(s.residual).toBeGreaterThan(1e-9);
  });

  it('1 mOhm - 1 TOhm random networks: any KCL violation above 1e-6 is flagged ill_conditioned', () => {
    const r = stress(solveDC, 400, 99);
    expect(r.over1e6).toBeGreaterThan(0); // the regime really is hard
    expect(r.silentOver1e6).toBe(0);
  });

  it('still rejects genuinely singular circuits (floating node, source loop)', () => {
    const floating: CircuitGraph = { schemaVersion: 1, groundNode: 'GND', measureNode: 'A', components: [
      { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'A', negativeNode: 'GND' },
      { id: 'R1', kind: 'resistor', value: 1000, positiveNode: 'B', negativeNode: 'C' },
    ] };
    expect(() => solveDC(floating)).toThrow(SolveError);
    const loop: CircuitGraph = { schemaVersion: 1, groundNode: 'GND', measureNode: 'A', components: [
      { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'A', negativeNode: 'GND' },
      { id: 'V2', kind: 'dc_voltage', value: 3, positiveNode: 'A', negativeNode: 'GND' },
      { id: 'R1', kind: 'resistor', value: 1000, positiveNode: 'A', negativeNode: 'GND' },
    ] };
    expect(() => solveDC(loop)).toThrow(SolveError);
  });

  it('extreme-but-benign scale (all parts 1 GOhm) is solved exactly and unflagged', () => {
    const g: CircuitGraph = { ...DIVIDER_10K_10K, components: DIVIDER_10K_10K.components.map((c) => (c.kind === 'resistor' ? { ...c, value: 1e9 } : c)) };
    const s = solveDC(g);
    expect(s.voltages.VOUT).toBeCloseTo(2.5, 9);
    expect(s.warnings).toBeUndefined();
  });
});
