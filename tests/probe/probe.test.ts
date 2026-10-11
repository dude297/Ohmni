import { describe, expect, it } from 'vitest';
import { probeStep } from '../../src/lib/probe';
import { POST } from '../../src/app/api/probe/route';
import { DIVIDER_10K_10K } from '../../src/lib/circuit/fixtures';
import type { CircuitGraph } from '../../src/lib/circuit/types';

// 5 V -> R1 -> A -> R2 -> B -> R3 -> GND, all 10k. Nominal: VIN 5, A 3.33, B 1.67.
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

describe('probeStep', () => {
  it('with no readings, nominal leads and a probe is suggested', () => {
    const s = probeStep(ladder);
    expect(s.hypotheses[0].id).toBe('nominal');
    expect(s.done).toBe(false);
    expect(s.next?.expectedBits).toBeGreaterThan(0);
  });

  it('localizes R2 open in a ladder by guided probing', () => {
    // Truth: R2 open -> VIN 5, A 5, B 0. Simulate a user following the guide.
    const truth: Record<string, number> = { VIN: 5, A: 5, B: 0 };
    const obs = [{ node: 'B', volts: 0 }];
    let s = probeStep(ladder, obs);
    expect(s.hypotheses[0].id).not.toBe('nominal');
    for (let i = 0; i < 3 && !s.done; i++) {
      const node = s.next!.node;
      expect(obs.map((o) => o.node)).not.toContain(node);
      obs.push({ node, volts: truth[node] });
      s = probeStep(ladder, obs);
    }
    expect(s.done).toBe(true);
    expect(s.hypotheses[0].id).toBe('R2:open');
    expect(s.hypotheses[0].probability).toBeGreaterThan(0.9);
    expect(s.fitWarning).toBeUndefined();
  });

  it('first suggested probe after B=0 is the one that splits the most', () => {
    const s = probeStep(ladder, [{ node: 'B', volts: 0 }]);
    // B=0 leaves R1 open, R2 open, R3 short, V1 dead: A splits them 3 ways, VIN only 2.
    expect(s.next?.node).toBe('A');
    expect(s.next!.outcomes.length).toBeGreaterThanOrEqual(3);
  });

  it('reports observationally equivalent faults instead of guessing', () => {
    // Divider: R1 open and R2 short both give VOUT 0, VIN 5.
    const s = probeStep(DIVIDER_10K_10K, [
      { node: 'VOUT', volts: 0 },
      { node: 'VIN', volts: 5 },
    ]);
    expect(s.done).toBe(true);
    expect(s.next).toBeNull();
    expect(s.reason).toMatch(/R1 open/);
    expect(s.reason).toMatch(/R2 shorted/);
  });

  it('warns when no single fault fits', () => {
    const s = probeStep(ladder, [{ node: 'B', volts: 3.0 }]);
    expect(s.fitWarning).toMatch(/No single-fault/);
  });
});

describe('POST /api/probe', () => {
  const call = (b: unknown) =>
    POST(new Request('http://x/api/probe', { method: 'POST', body: JSON.stringify(b) }));

  it('requires confirmation', async () => {
    const r = await call({ graph: ladder, userConfirmed: false });
    expect(r.status).toBe(422);
  });

  it('returns a next probe', async () => {
    const r = await call({ graph: ladder, userConfirmed: true, observations: [{ node: 'B', volts: 0 }] });
    expect(r.status).toBe(200);
    const { result } = await r.json();
    expect(result.next.node).toBe('A');
    expect(result.trace[0].provider).toBe('local');
  });
});
