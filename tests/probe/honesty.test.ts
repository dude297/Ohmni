import { describe, expect, it } from 'vitest';
import { probeStep } from '../../src/lib/probe';
import { probeStepMulti } from '../../src/lib/probe-multi';
import { solveDC } from '../../src/lib/circuit/solve';
import { LOADED_BRIDGE_12V as G } from '../../src/lib/circuit/fixtures';
import { buildSets, runSet, summarize } from '../../bench/calibration';
import type { CircuitGraph } from '../../src/lib/circuit/types';

const withR = (g: CircuitGraph, id: string, v: number): CircuitGraph => ({ ...g, components: g.components.map((c) => (c.id === id ? { ...c, value: v } : c)) });
const all = (g: CircuitGraph) => Object.entries(solveDC(g).voltages).filter(([n]) => n !== 'GND').map(([node, volts]) => ({ node, volts }));

describe('probe honesty (out-of-model faults)', () => {
  it('exposes fit and outOfModelProbability and an explicit unmodeled hypothesis', () => {
    const s = probeStep(G);
    expect(s.fit).toBe('good');
    expect(s.outOfModelProbability).toBeGreaterThan(0);
    expect(s.hypotheses.find((h) => h.id === 'unmodeled')?.title).toBe('No single modeled fault fits these readings');
  });

  it('bridge R5 x3 (not a modeled fault) is not concluded as a confident single fault', () => {
    // R5 bridges A-B: x3 moves the readings off every modeled hypothesis
    for (const f of [3, 0.3]) {
      const s = probeStep(G, all(withR(G, 'R5', 3300 * f)));
      const top = s.hypotheses[0];
      const confidentModeled = top.id !== 'unmodeled' && top.probability >= 0.9 && s.done;
      expect(confidentModeled, `R5 x${f} -> ${top.id} ${top.probability}`).toBe(false);
    }
  });

  it('a clearly unexplained reading gives fit poor, done false, a warning, and out-of-model mass', () => {
    const obs = all(G).map((o) => ({ ...o, volts: o.node === 'A' ? 2.0 : o.node === 'B' ? 9.0 : o.volts }));
    const s = probeStep(G, obs);
    expect(s.fit).toBe('poor');
    expect(s.done).toBe(false);
    expect(s.fitWarning).toBeDefined();
    expect(s.hypotheses[0].id).toBe('unmodeled');
    expect(s.outOfModelProbability).toBeGreaterThan(0.5);
    expect(s.next).toBeNull(); // every node measured: recommend an ohmmeter check instead
    expect(s.reason).toMatch(/ohmmeter/);
  });

  it('poor fit with unmeasured nodes still recommends the next probe', () => {
    const s = probeStep(G, [{ node: 'C', volts: 9.5 }]);
    expect(s.fit).toBe('poor');
    expect(s.done).toBe(false);
    expect(s.next).not.toBeNull();
  });

  it('nominal needs every resistor-dependent node before it is declared done', () => {
    let s = probeStep(G, [{ node: 'C', volts: 2.6089 }]);
    expect(s.done).toBe(false);
    const truth = solveDC(G).voltages;
    const obs = [{ node: 'C', volts: truth.C }];
    for (let i = 0; i < 4 && !s.done; i++) {
      obs.push({ node: s.next!.node, volts: truth[s.next!.node] });
      s = probeStep(G, obs);
    }
    expect(s.done).toBe(true);
    expect(s.hypotheses[0].id).toBe('nominal');
    expect(obs.map((o) => o.node)).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('part tolerance is in the likelihood: a 4 % drift on every part still reads as nominal', () => {
    const drift: CircuitGraph = { ...G, components: G.components.map((c) => (c.kind === 'resistor' ? { ...c, value: c.value * (c.id.charCodeAt(1) % 2 ? 1.04 : 0.96) } : c)) };
    const s = probeStep(G, all(drift));
    expect(s.hypotheses[0].id).toBe('nominal');
    expect(s.fit).toBe('good');
  });

  it('probe-multi uses the same gating and still ranks a true pair first', () => {
    const truth = withR(withR(G, 'R7', 12000), 'R1', 1e9);
    const m = probeStepMulti(G, all(truth), { maxFaults: 2 });
    expect(m.hypotheses[0].id).toBe('R1:open+R7:x10');
    expect(m.fit).toBe('good');
    const bad = probeStepMulti(G, all(G).map((o) => (o.node === 'A' ? { ...o, volts: 1 } : o)), { maxFaults: 2 });
    expect(bad.fit).toBe('poor');
    expect(bad.done).toBe(false);
    expect(bad.fitWarning).toMatch(/Neither single nor two-fault/);
  });

  it('calibration regression (seed 1, small N): in-model accuracy holds and detectable out-of-model wrongs stay rare', () => {
    const rows = buildSets(1, 60).filter((s) => s.fixture === 'bridge').map((s, i) => runSet(probeStep, s, 100 + i));
    const sum = summarize(rows);
    expect(sum.inModel.top1EquivAware).toBeGreaterThan(0.93);
    expect(sum.outOfModel.detectableConfidentWrongRate).toBeLessThan(0.1);
    expect(sum.outOfModel.flaggedRate).toBeGreaterThan(0.4);
  }, 120_000);
});

describe('repair refuses to invent a fix on poor fit', () => {
  it('out-of-model readings -> no repair proposal, blocked poor_fit', async () => {
    const { repairStep } = await import('../../src/lib/repair');
    const { solveDC } = await import('../../src/lib/circuit/solve');
    const { LOADED_BRIDGE_12V: G } = await import('../../src/lib/circuit/fixtures');
    // R3 doubled (not in the single-fault model): read every node exactly
    const faulted = { ...G, components: G.components.map((c) => (c.id === 'R3' ? { ...c, value: c.value * 2 } : c)) };
    const v = solveDC(faulted).voltages;
    const r = repairStep(G, ['A', 'B', 'C'].map((node) => ({ node, volts: v[node] })));
    expect(r.basis.blocked).toBe('poor_fit');
    expect(r.proposals).toEqual([]);
  });
});
