import { describe, expect, it } from 'vitest';
import { analyzeTwin } from '@/lib/twin';
import { LOADED_BRIDGE_12V as G } from '@/lib/circuit/fixtures';

describe('twin recommendation on ties', () => {
  it('(a) C=0 only: no single repair, tie listed, next probe is A', () => {
    const r = analyzeTwin(G, G, [{ node: 'C', volts: 0 }]).recommendation;
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.tied.map((t) => t.id).sort()).toEqual(['R4:short', 'R6:open', 'R7:short', 'V1:dead']);
    expect(r.nextProbe?.node).toBe('A');
  });
  it('(b) C=0 + A=7.533: Restore R6 is proposed', () => {
    const a = analyzeTwin(G, G, [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }]);
    expect(a.recommendation).toMatchObject({ status: 'repair', hypothesisId: 'R6:open', basis: 'measurements' });
    expect(a.repair?.proposals.find((p) => p.hypothesisId === 'R6:open')?.title).toBe('Restore R6 connection');
  });
  it('(c) described hardware missing R6 is primary evidence and drives the repair', () => {
    const obs = { ...G, components: G.components.filter((c) => c.id !== 'R6') };
    const a = analyzeTwin(G, obs, []);
    expect(a.recommendation).toMatchObject({ status: 'repair', hypothesisId: 'R6:open', basis: 'observed_diff', evidence: ['Your described hardware is missing R6.'] });
    expect(a.repair?.proposals[0].supportingObservations).toEqual([]);
    expect(a.repair?.proposals[0]).toMatchObject({ simulatedOnly: true });
  });
  it('identical hardware, no readings: nothing recommended', () => {
    expect(analyzeTwin(G, G, []).recommendation.status).toBe('insufficient');
  });
});
