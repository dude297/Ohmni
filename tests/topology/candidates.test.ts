import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  discriminate,
  equivalentResistance,
  resistanceOptions,
  safeVoltages,
  voltageOptions,
} from '../../src/lib/topology/candidates';
import { POST } from '../../src/app/api/topology/route';
import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from '../../src/lib/circuit/fixtures';
import { solveDC } from '../../src/lib/circuit/solve';
import type { CircuitComponent, CircuitGraph } from '../../src/lib/circuit/types';

const g = (...components: CircuitComponent[]): CircuitGraph => ({ schemaVersion: 1, groundNode: 'GND', measureNode: 'A', components });
const R = (id: string, value: number, p: string, n: string): CircuitComponent => ({ id, kind: 'resistor', value, positiveNode: p, negativeNode: n });
const V = (value: number, p = 'VIN', n = 'GND'): CircuitComponent => ({ id: 'V1', kind: 'dc_voltage', value, positiveNode: p, negativeNode: n });

describe('equivalentResistance (hand calcs)', () => {
  it('series: 1k + 2k = 3k (supply unplugged)', () => {
    const s = g(V(5), R('R1', 1000, 'VIN', 'A'), R('R2', 2000, 'A', 'GND'));
    expect(equivalentResistance(s, 'VIN', 'GND', 'open')).toBeCloseTo(3000, 6);
    // supply shorted: VIN = GND, so A sees 1k || 2k = 666.67
    expect(equivalentResistance(s, 'A', 'GND')).toBeCloseTo(2000 / 3, 6);
  });
  it('parallel: 1k || 1k = 500', () => {
    expect(equivalentResistance(g(V(5), R('R1', 1000, 'VIN', 'GND'), R('R2', 1000, 'VIN', 'GND')), 'VIN', 'GND', 'open')).toBeCloseTo(500, 6);
  });
  it('divider from VOUT with source shorted = R1 || R2 = 5k; unplugged = R2 = 10k; VIN-GND shorted = 0', () => {
    expect(equivalentResistance(DIVIDER_10K_10K, 'VOUT', 'GND')).toBeCloseTo(5000, 6);
    expect(equivalentResistance(DIVIDER_10K_10K, 'GND', 'VOUT')).toBeCloseTo(5000, 6);
    expect(equivalentResistance(DIVIDER_10K_10K, 'VOUT', 'GND', 'open')).toBeCloseTo(10000, 6);
    expect(equivalentResistance(DIVIDER_10K_10K, 'VIN', 'GND')).toBe(0);
  });
  it('series-parallel MID seen with 12 V shorted = 100 || 200 || 300 = 600/11', () => {
    expect(equivalentResistance(SERIES_PARALLEL_12V, 'MID', 'GND')).toBeCloseTo(600 / 11, 6);
  });
  it('balanced Wheatstone bridge of five 1k = 1k corner to corner', () => {
    const b = g(V(1, 'X', 'Y'), R('a', 1e3, 'T', 'L'), R('b', 1e3, 'T', 'R'), R('c', 1e3, 'L', 'B'), R('d', 1e3, 'R', 'B'), R('e', 1e3, 'L', 'R'));
    expect(equivalentResistance(b, 'T', 'B')).toBeCloseTo(1000, 6);
  });
  it('unconnected nodes read open (Infinity); unknown node throws', () => {
    const s = g(V(5), R('R1', 1000, 'VIN', 'GND'), R('R9', 1000, 'X', 'Y'));
    expect(equivalentResistance(s, 'X', 'GND')).toBe(Infinity);
    expect(() => equivalentResistance(s, 'NOPE', 'GND')).toThrow();
  });
});

describe('buildCandidates', () => {
  it('B merges VOUT into GND, drops the shorted-out R2 and keeps GND as the survivor', () => {
    const [a, b] = buildCandidates(DIVIDER_10K_10K, 'VOUT', 'GND');
    expect(a.graph).toBe(DIVIDER_10K_10K);
    expect(b.alias).toEqual({ VOUT: 'GND' });
    expect(b.graph.measureNode).toBe('GND');
    expect(b.graph.components.map((c) => c.id)).toEqual(['V1', 'R1']);
    expect(b.shortsSupply).toBe(false);
    const s = solveDC(b.graph);
    expect(s.currents.R1).toBeCloseTo(5 / 10000, 12); // 2x the as-read 0.25 mA
    expect(buildCandidates(DIVIDER_10K_10K, 'GND', 'VOUT')[1].alias).toEqual({ VOUT: 'GND' });
  });
  it('rejects identical or unknown nodes', () => {
    expect(() => buildCandidates(DIVIDER_10K_10K, 'VOUT', 'VOUT')).toThrow();
    expect(() => buildCandidates(DIVIDER_10K_10K, 'VOUT', 'X')).toThrow();
  });
});

describe('short-circuit guard', () => {
  it('a merge that shorts the supply never yields a powered instruction', () => {
    const cs = buildCandidates(DIVIDER_10K_10K, 'VIN', 'GND');
    expect(cs[1].shortsSupply).toBe(true);
    expect(safeVoltages(cs[1])).toBeNull();
    expect(voltageOptions(cs)).toEqual([]);
    const d = discriminate(cs, ['VIN', 'GND']);
    expect(d.kind).toBe('resistance');
    expect(d.poweredSafe).toBe(false);
    expect(d.voltageOption).toBeNull();
    expect(d.safety).toMatch(/DO NOT power/);
    expect(d.instruction).toMatch(/power OFF/);
    // Supply sits across VIN-GND: shorted-supply convention reads 0 Ω for both, so unplug it: 20k vs 0.
    expect(d.unplugSupply).toBe(true);
    expect(d.between).toEqual(['VIN', 'GND']);
    expect(d.predictions.map((p) => p.value)).toEqual([expect.closeTo(20000, 6), 0]);
    expect(d.decisive).toBe(true);
    expect(d.instruction).toMatch(/supply disconnected/);
  });
  it('huge source current (merge puts 5 V across 1 Ω = 5 A) counts as unsafe', () => {
    const hot = g(V(5), R('R1', 1, 'VIN', 'A'), R('R2', 10000, 'A', 'GND'));
    const [a, b] = buildCandidates(hot, 'A', 'GND');
    expect(safeVoltages(a)).not.toBeNull(); // as read: 0.5 mA
    expect(b.shortsSupply).toBe(false);
    expect(safeVoltages(b)).toBeNull(); // SolveError-free, but 5 A
    // with the supply shorted A-GND reads 1 Ω vs 0 Ω (useless); unplugged it reads R2 = 10k vs 0 Ω.
    const u = discriminate([a, b], ['A', 'GND']);
    expect(u.unplugSupply).toBe(true);
    expect(u.predictions.map((p) => p.value)).toEqual([expect.closeTo(10000, 6), 0]);
    expect(u.decisive).toBe(true);
    const d = discriminate([a, b], ['A', 'GND']);
    expect(d.poweredSafe).toBe(false);
    expect(d.kind).toBe('resistance');
  });
});

describe('discriminate', () => {
  const cs = buildCandidates(DIVIDER_10K_10K, 'VOUT', 'GND');
  const d = discriminate(cs, ['VOUT', 'GND']);

  it('ambiguous-junction divider: power-off resistance VOUT-GND, 5k (10k unplugged) vs 0', () => {
    expect(d.kind).toBe('resistance');
    expect(d.between).toEqual(['VOUT', 'GND']);
    expect(d.predictions[0].value).toBeCloseTo(5000, 6);
    expect(d.predictions[0].openSupplyValue).toBeCloseTo(10000, 6);
    expect(d.predictions[1]).toEqual({ candidateId: 'B', value: 0, openSupplyValue: 0 });
    expect(d.separation).toBeGreaterThan(3);
    expect(d.decisive).toBe(true);
    expect(d.instruction).toContain("VOUT (R1's lead)");
    expect(d.instruction).toContain('≈5 kΩ (≈10 kΩ if the supply is unplugged) means VOUT and GND not connected');
    expect(d.instruction).toContain('≈0 Ω means VOUT and GND connected');
    expect(d.poweredSafe).toBe(true);
    expect(d.voltageOption?.node).toBe('VOUT');
    expect(d.voltageOption?.predictions.map((p) => p.value)).toEqual([expect.closeTo(2.5, 9), 0]);
  });
  it('chosen measurement has the maximum separation of all options', () => {
    const all = resistanceOptions(cs, ['VOUT', 'GND']);
    expect(d.separation).toBe(Math.max(...all.map((m) => m.separation)));
    // VIN-VOUT looks different with the supply shorted, but both read 10k with it unplugged: rejected.
    const vinVout = all.find((m) => m.between?.join() === 'VIN,VOUT')!;
    expect(vinVout.separation).toBeLessThan(1);
    const vbest = voltageOptions(cs).reduce((a, b) => (b.separation > a.separation ? b : a));
    expect(d.voltageOption?.separation).toBe(vbest.separation);
  });
});

describe('POST /api/topology', () => {
  const post = (b: unknown) =>
    POST(new Request('http://x/api/topology', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));

  it('returns both candidates and the measurement', async () => {
    const res = await post({ graph: DIVIDER_10K_10K, userConfirmed: true, ambiguous: { a: 'VOUT', b: 'GND' } });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.candidates.map((c: { id: string }) => c.id)).toEqual(['A', 'B']);
    expect(result.measurement.kind).toBe('resistance');
    expect(result.trace[0]).toMatchObject({ step: 'topology', provider: 'local', status: 'ok' });
  });
  it('same error codes as /api/probe', async () => {
    expect((await post('{nope')).status).toBe(400);
    const nc = await post({ graph: DIVIDER_10K_10K, userConfirmed: false, ambiguous: { a: 'VOUT', b: 'GND' } });
    expect((await nc.json()).error.code).toBe('NOT_CONFIRMED');
    const bad = await post({ graph: { schemaVersion: 1 }, userConfirmed: true, ambiguous: { a: 'VOUT', b: 'GND' } });
    expect((await bad.json()).error.code).toBe('INVALID_GRAPH');
    const node = await post({ graph: DIVIDER_10K_10K, userConfirmed: true, ambiguous: { a: 'VOUT', b: 'X' } });
    expect(node.status).toBe(422);
    expect((await node.json()).error.code).toBe('INVALID_REQUEST');
  });
});
