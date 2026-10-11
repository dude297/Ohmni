import { describe, expect, it } from 'vitest';
import { LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import { probeStep } from '@/lib/probe';
import { CIRCUITS } from '@/app/probe/helpers';

const withR = (id: string, v: number) => ({ ...LOADED_BRIDGE_12V, components: LOADED_BRIDGE_12V.components.map((c) => (c.id === id ? { ...c, value: v } : c)) });

// Independent nodal solve (VIN fixed at 12 V), written separately from solveDC.
function nodal(r: Record<string, number>) {
  const g = (k: string) => 1 / r[k];
  const M = [
    [g('R1') + g('R2') + g('R5'), -g('R5'), 0, 12 * g('R1')],
    [-g('R5'), g('R3') + g('R4') + g('R5') + g('R6'), -g('R6'), 12 * g('R3')],
    [0, -g('R6'), g('R6') + g('R7'), 0],
  ];
  for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return { A: x[0], B: x[1], C: x[2] };
}
const R = { R1: 1000, R2: 2000, R3: 1500, R4: 1000, R5: 3300, R6: 680, R7: 1200 };

describe('loaded bridge probe sample', () => {
  it('is offered on /probe', () => {
    expect(CIRCUITS.some((c) => c.key === 'loaded-bridge' && c.graph === LOADED_BRIDGE_12V)).toBe(true);
  });

  it('solver matches an independent nodal solve (nominal and R6 open)', () => {
    const v = solveDC(LOADED_BRIDGE_12V).voltages;
    const n = nodal(R);
    for (const k of ['A', 'B', 'C'] as const) expect(v[k]).toBeCloseTo(n[k], 9);
    expect(v.A).toBeCloseTo(7.342412, 5);
    expect(v.B).toBeCloseTo(4.087354, 5);
    expect(v.C).toBeCloseTo(2.608949, 5);
    const o = solveDC(withR('R6', 1e9)).voltages;
    expect(o.A).toBeCloseTo(7.532846, 5);
    expect(o.B).toBeCloseTo(5.220435, 5);
    expect(Math.abs(o.C)).toBeLessThan(1e-4);
  });

  it('two readings localize the modeled R6-open fault (C=0 then the recommended node)', () => {
    const s1 = probeStep(LOADED_BRIDGE_12V, [{ node: 'C', volts: 0 }]);
    expect(s1.done).toBe(false);
    expect(s1.hypotheses.slice(0, 4).map((h) => h.id).sort()).toEqual(['R4:short', 'R6:open', 'R7:short', 'V1:dead']);
    expect(s1.next?.node).toBe('A');
    const s2 = probeStep(LOADED_BRIDGE_12V, [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }]);
    expect(s2.done).toBe(true);
    expect(s2.hypotheses[0].id).toBe('R6:open');
    expect(s2.hypotheses[0].probability).toBeGreaterThan(0.9);
  });
});
