import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/repair/route';
import { POST as VERIFY } from '@/app/api/repair/verify/route';
import { repairStep, withValue } from '@/lib/repair';
import { solveDC } from '@/lib/circuit/solve';
import { validateGraph } from '@/lib/circuit/validate';
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V as BRIDGE } from '@/lib/circuit/fixtures';

const call = (h: (r: Request) => Promise<Response>, b: unknown) =>
  h(new Request('http://x', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));
const post = (b: unknown) => call(POST, b);
const obsOf = (g: typeof BRIDGE, id: string, v: number, nodes: string[]) => {
  const s = solveDC(withValue(g, id, v)).voltages;
  return nodes.map((node) => ({ node, volts: s[node] }));
};

describe('repair engine', () => {
  it('R6 open on the bridge: restore R6, deterministic verification node', () => {
    const r = repairStep(BRIDGE, [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }]);
    const p = r.proposals[0];
    expect(p.hypothesisId).toBe('R6:open');
    expect(p.title).toBe('Restore R6 connection');
    expect(p.faultClass).toBe('open');
    expect(p.before.voltages.C).toBeCloseTo(0, 2);
    expect(p.after.voltages.C).toBeCloseTo(2.6089, 3);
    expect(p.verification.node).toBe('C');
    expect(p.verification.expectVolts).toBeCloseTo(2.6089, 3);
    expect(p.verification.toleranceVolts).toBeCloseTo(0.02 * 2.6089 + 0.01, 4);
    expect(p.resolves).toBe(true);
    expect(p.status).toBe('hypothesized');
    expect(p.actions[0]).toMatch(/power/i);
    expect(r.proposals.length).toBeLessThanOrEqual(3);
    expect(r.proposals.some((x) => x.hypothesisId === 'nominal')).toBe(false);
    for (let i = 1; i < r.proposals.length; i++) expect(r.proposals[i - 1].probability).toBeGreaterThanOrEqual(r.proposals[i].probability);
  });

  it('R7 short', () => {
    const r = repairStep(BRIDGE, obsOf(BRIDGE, 'R7', 1e-3, ['C', 'B']));
    const p = r.proposals[0];
    expect(p.hypothesisId).toBe('R7:short');
    expect(p.faultClass).toBe('short');
    expect(p.patch.designValue).toBe(1200);
    expect(p.resolves).toBe(true);
  });

  it('R2 x0.1 on divider: replace R2 with 10 kOhm, VOUT 2.5', () => {
    // R1 x10 gives the same VOUT; the engine reports both (see uncertainty).
    const p = repairStep(DIVIDER_10K_10K, [{ node: 'VOUT', volts: 0.4545 }]).proposals.find((x) => x.hypothesisId === 'R2:x0.1')!;
    expect(p.uncertainty).toContain('R1');
    expect(p.hypothesisId).toBe('R2:x0.1');
    expect(p.faultClass).toBe('value');
    expect(p.title).toContain('10 kΩ');
    expect(p.patch).toMatchObject({ faultedValue: 1000, designValue: 10000, unit: 'ohm' });
    expect(p.after.voltages.VOUT).toBeCloseTo(2.5, 6);
    expect(p.verification.node).toBe('VOUT');
  });

  it('V1 dead: restore source, never above design', () => {
    const p = repairStep(DIVIDER_10K_10K, [{ node: 'VOUT', volts: 0 }, { node: 'VIN', volts: 0 }]).proposals[0];
    expect(p.hypothesisId).toBe('V1:dead');
    expect(p.faultClass).toBe('source');
    expect(p.patch).toMatchObject({ faultedValue: 0, designValue: 5, unit: 'volt' });
    expect(p.verification.expectVolts).toBeLessThanOrEqual(5);
  });

  it('contradictory observations: no repair is invented (blocked on poor fit)', () => {
    const r = repairStep(DIVIDER_10K_10K, [{ node: 'VOUT', volts: 3.7 }, { node: 'VIN', volts: 1 }]);
    expect(r.proposals).toEqual([]);
    expect(r.basis.blocked).toBe('poor_fit');
    expect(r.basis.done).toBe(false);
  });

  it('patched graph validates and solves', () => {
    for (const p of repairStep(BRIDGE, [{ node: 'C', volts: 0 }]).proposals) {
      const g = withValue(BRIDGE, p.patch.componentId, p.patch.designValue);
      expect(validateGraph(g).ok).toBe(true);
      expect(() => solveDC(g)).not.toThrow();
    }
  });
});

describe('POST /api/repair', () => {
  const ok = { graph: BRIDGE, userConfirmed: true, observations: [{ node: 'C', volts: 0 }, { node: 'A', volts: 7.533 }] };
  it('200 with trace', async () => {
    const res = await post(ok);
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.proposals[0].hypothesisId).toBe('R6:open');
    expect(result.trace[0]).toMatchObject({ step: 'repair', provider: 'local', model: 'mna-dc' });
    expect(result.basis.topHypothesisId).toBeTruthy();
  });
  it('errors', async () => {
    expect((await post('{nope')).status).toBe(400);
    const nc = await post({ ...ok, userConfirmed: false });
    expect(nc.status).toBe(422);
    expect((await nc.json()).error.code).toBe('NOT_CONFIRMED');
    expect((await (await post({ ...ok, observations: [] })).json()).error.code).toBe('INVALID_REQUEST');
    expect((await (await post({ ...ok, graph: { nope: 1 } })).json()).error.code).toBe('INVALID_GRAPH');
  });
});

describe('POST /api/repair/verify', () => {
  const proposal = { hypothesisId: 'R6:open', verification: { node: 'C', expectVolts: 2.6089, toleranceVolts: 0.0622 } };
  const v = async (measured: unknown, extra = {}) => (await (await call(VERIFY, { graph: BRIDGE, userConfirmed: true, proposal, measured, ...extra })).json()).result;
  it('verified / not_verified / wrong node', async () => {
    const good = await v({ node: 'C', volts: 2.6 });
    expect(good).toMatchObject({ verified: true, status: 'verified' });
    expect(good.message).toContain('consistent with the repair');
    expect(good.message).not.toMatch(/for certain/);
    const bad = await v({ node: 'C', volts: 0.1 });
    expect(bad).toMatchObject({ verified: false, status: 'not_verified' });
    expect(bad.message).toContain('does not match; re-check');
    expect((await v({ node: 'A', volts: 2.6089 })).verified).toBe(false);
  });
  it('unconfirmed 422', async () => {
    const res = await call(VERIFY, { graph: BRIDGE, userConfirmed: false, proposal, measured: { node: 'C', volts: 2.6 } });
    expect(res.status).toBe(422);
  });
});
