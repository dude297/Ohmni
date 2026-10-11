import { describe, expect, it } from 'vitest';
import { diagnoseWith } from '../../src/lib/diagnosis';
import type { CircuitGraph } from '../../src/lib/circuit/types';

// Minimal MNA reference solver (test-only).
function solve(g: CircuitGraph): { voltages: Record<string, number> } {
  const nodes = [...new Set(g.components.flatMap((c) => [c.positiveNode, c.negativeNode]))].filter((n) => n !== 'GND');
  const srcs = g.components.filter((c) => c.kind === 'dc_voltage');
  const n = nodes.length + srcs.length;
  const A = Array.from({ length: n }, () => Array<number>(n + 1).fill(0));
  const ix = (x: string) => nodes.indexOf(x);
  for (const c of g.components.filter((c) => c.kind === 'resistor')) {
    const y = 1 / c.value;
    const p = ix(c.positiveNode);
    const q = ix(c.negativeNode);
    if (p >= 0) A[p][p] += y;
    if (q >= 0) A[q][q] += y;
    if (p >= 0 && q >= 0) {
      A[p][q] -= y;
      A[q][p] -= y;
    }
  }
  srcs.forEach((s, k) => {
    const r = nodes.length + k;
    const p = ix(s.positiveNode);
    const q = ix(s.negativeNode);
    if (p >= 0) {
      A[p][r] += 1;
      A[r][p] += 1;
    }
    if (q >= 0) {
      A[q][r] -= 1;
      A[r][q] -= 1;
    }
    A[r][n] = s.value;
  });
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[m][i])) m = j;
    [A[i], A[m]] = [A[m], A[i]];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const f = A[j][i] / A[i][i];
      for (let k = i; k <= n; k++) A[j][k] -= f * A[i][k];
    }
  }
  const voltages: Record<string, number> = { GND: 0 };
  nodes.forEach((x, i) => {
    voltages[x] = A[i][n] / A[i][i];
  });
  return { voltages };
}

const divider: CircuitGraph = {
  schemaVersion: 1,
  groundNode: 'GND',
  measureNode: 'N2',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'N1', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10000, positiveNode: 'N1', negativeNode: 'N2' },
    { id: 'R2', kind: 'resistor', value: 10000, positiveNode: 'N2', negativeNode: 'GND' },
  ],
};
const run = (m: number) => diagnoseWith(divider, m, solve);

describe('diagnoseWith', () => {
  it('demo: 0.45V points to R2 ~1k first', () => {
    const h = run(0.45);
    expect(h).toHaveLength(3);
    expect(h[0].title).toContain('R2');
    expect(h[0].title).toContain('1 kΩ');
    expect(h[0].rationale).toContain('exact fit 989 Ω');
    expect(h[0].rationale).toMatch(/hypothesis/i);
  });
  it('matching measurement gives one hypothesis', () => {
    const h = run(2.5);
    expect(h).toHaveLength(1);
    expect(h[0].title).toBe('Measurement matches expected');
    expect(h[0].nextMeasurement).toMatch(/supply voltage/i);
  });
  it('5V: R1 short and R2 open in top hypotheses', () => {
    const t = run(5).map((x) => x.title).join('|');
    expect(t).toMatch(/R1 may be shorted/);
    expect(t).toMatch(/R2 may be open/);
  });
  it('0V: R1 open and R2 short', () => {
    const t = run(0).map((x) => x.title).join('|');
    expect(t).toMatch(/R1 may be open/);
    expect(t).toMatch(/R2 may be shorted/);
  });
  it('1.65V: source ~3.3V hypothesis present', () => {
    expect(run(1.65).some((x) => /V1 may be 3\.3 V/.test(x.title))).toBe(true);
  });
  it('resistance checks always say to remove power', () => {
    for (const m of [0, 0.45, 1.65, 5]) {
      for (const h of run(m)) {
        if (/resistance/i.test(h.nextMeasurement)) expect(h.nextMeasurement).toMatch(/disconnect power/i);
      }
    }
  });
});
