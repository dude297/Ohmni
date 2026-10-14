import { describe, expect, it } from 'vitest';
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import type { CircuitGraph } from '@/lib/circuit/types';
import { probeStep, resistanceBetween, type Reading } from '@/lib/probe';

const setv = (g: CircuitGraph, id: string, v: number): CircuitGraph => ({ ...g, components: g.components.map((c) => (c.id === id ? { ...c, value: v } : c)) });

// Follow the guide with exact readings from `truth`; returns the final step and the readings taken.
function session(truth: CircuitGraph, ohmmeter: boolean) {
  const t = solveDC(truth).voltages;
  const obs: Reading[] = [];
  let s = probeStep(LOADED_BRIDGE_12V, obs, { ohmmeter });
  while (!s.done && s.next && obs.length < 15) {
    const nx = s.next;
    obs.push(nx.kind === 'resistance' ? { kind: 'resistance', a: nx.a!, b: nx.b!, ohms: resistanceBetween(truth, nx.a!, nx.b!) } : { node: nx.node, volts: t[nx.node] });
    s = probeStep(LOADED_BRIDGE_12V, obs, { ohmmeter });
  }
  return { s, obs };
}

describe('ohmmeter readings (power off, sources removed)', () => {
  it('computes in-circuit resistance with the supply disconnected', () => {
    expect(resistanceBetween(DIVIDER_10K_10K, 'VIN', 'GND')).toBeCloseTo(20_000, 6);
    const out = DIVIDER_10K_10K.components.find((c) => c.id === 'R2')!.positiveNode;
    expect(resistanceBetween(DIVIDER_10K_10K, out, 'GND')).toBeCloseTo(10_000, 6); // R1 dangles from the removed supply
  });

  it('is opt-in: without it the guide never asks for resistance, and never before a voltage reading', () => {
    expect(session(setv(LOADED_BRIDGE_12V, 'R6', 1e9), false).obs.every((o) => !('kind' in o))).toBe(true);
    expect(probeStep(LOADED_BRIDGE_12V, [], { ohmmeter: true }).next?.kind).toBeUndefined();
  });

  it('exposes a second fault that every node voltage hides (R3 x10 + R4 short reads exactly like R4 short)', () => {
    const truth = setv(setv(LOADED_BRIDGE_12V, 'R3', 15_000), 'R4', 1e-3);
    const v = session(truth, false).s;
    expect(v.hypotheses[0].id).toBe('R4:short'); // voltage-only: confidently wrong (the documented floor)
    expect(v.hypotheses[0].probability).toBeGreaterThan(0.9);
    const o = session(truth, true);
    expect(o.obs.some((r) => 'kind' in r)).toBe(true);
    expect(o.s.fit).toBe('poor'); // a resistance reading contradicts R4-short-alone
    expect(o.s.hypotheses[0].id === 'R4:short' && o.s.hypotheses[0].probability >= 0.9).toBe(false);
  });

  it('still concludes the true single fault, confirmed by resistance', () => {
    const o = session(setv(LOADED_BRIDGE_12V, 'R6', 1e9), true);
    expect(o.s.done).toBe(true);
    expect(o.s.fit).toBe('good');
    expect(o.s.hypotheses[0].id).toBe('R6:open');
    expect(o.obs.filter((r) => 'kind' in r).length).toBeGreaterThan(0);
  });

  it('POST /api/probe accepts resistance readings and the ohmmeter flag', async () => {
    const { POST } = await import('@/app/api/probe/route');
    const call = (b: unknown) => POST(new Request('http://x/api/probe', { method: 'POST', body: JSON.stringify(b) }));
    const truth = setv(LOADED_BRIDGE_12V, 'R6', 1e9);
    const res = await call({ graph: LOADED_BRIDGE_12V, userConfirmed: true, ohmmeter: true, observations: [{ node: 'C', volts: 0 }, { kind: 'resistance', a: 'B', b: 'C', ohms: resistanceBetween(truth, 'B', 'C') }] });
    expect(res.status).toBe(200);
    expect((await res.json()).result.hypotheses[0].id).toBe('R6:open');
    const bad = await call({ graph: LOADED_BRIDGE_12V, userConfirmed: true, observations: [{ kind: 'resistance', a: 'B', b: 'C', ohms: -1 }] });
    expect(bad.status).toBe(422);
  });

  it('ignores resistance readings on unknown nodes', () => {
    const base = probeStep(LOADED_BRIDGE_12V, [{ node: 'C', volts: 0 }]);
    const withJunk = probeStep(LOADED_BRIDGE_12V, [{ node: 'C', volts: 0 }, { kind: 'resistance', a: 'NOPE', b: 'GND', ohms: 5 }]);
    expect(withJunk.hypotheses.map((h) => h.id)).toEqual(base.hypotheses.map((h) => h.id));
  });
});
