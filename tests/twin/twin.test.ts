import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/twin/route';
import { importNetlist } from '@/lib/netlist';
import { diffDesigns } from '@/lib/twin';
import type { CircuitGraph } from '@/lib/circuit/types';

const NET = readFileSync('fixtures/netlist/loaded_bridge.net', 'utf8');
const fx = (n: string) => JSON.parse(readFileSync(`fixtures/twin/${n}`, 'utf8')) as { synthetic: true; graph: CircuitGraph };
const INTENDED = importNetlist(NET, { measureNode: 'VOUT' }).graph!;
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));
const req = (observed: unknown, extra: object = {}) => ({
  intended: { netlist: NET, format: 'kicad', measureNode: 'VOUT' },
  observed,
  observedProvenance: { kind: 'human_review' },
  userConfirmed: true,
  ...extra,
});

describe('diffDesigns', () => {
  it('fixtures are labeled synthetic', () => {
    for (const f of ['SYNTHETIC_bridge_r6_6800.json', 'SYNTHETIC_bridge_r6_neg_on_gnd.json', 'SYNTHETIC_bridge_renamed_nodes.json']) expect(fx(f).synthetic).toBe(true);
  });
  it('(3) renamed nodes only is identical', () => {
    const d = diffDesigns(INTENDED, fx('SYNTHETIC_bridge_renamed_nodes.json').graph);
    expect(d).toMatchObject({ identical: true, componentDiffs: [], connectionDiffs: [], uncertainties: [] });
    expect(d.nodeMap).toMatchObject({ OUT: 'VOUT', MID: 'B', X1: 'N1', GND: 'GND', VIN: 'VIN' });
  });
  it('swapping a resistor\'s leads is not a diff', () => {
    const g = { ...INTENDED, components: INTENDED.components.map((c) => (c.id === 'R5' ? { ...c, positiveNode: c.negativeNode, negativeNode: c.positiveNode } : c)) };
    expect(diffDesigns(INTENDED, g).identical).toBe(true);
  });
  it('(1) value fault: R6 ratio 10', () => {
    const d = diffDesigns(INTENDED, fx('SYNTHETIC_bridge_r6_6800.json').graph);
    expect(d.componentDiffs).toHaveLength(1);
    expect(d.componentDiffs[0]).toMatchObject({ componentId: 'R6', kind: 'value', ratio: 10 });
    expect(d.connectionDiffs).toEqual([]);
  });
  it('within 1% is not a value diff', () => {
    const g = { ...INTENDED, components: INTENDED.components.map((c) => (c.id === 'R1' ? { ...c, value: 1005 } : c)) };
    expect(diffDesigns(INTENDED, g).identical).toBe(true);
  });
  it('(2) wiring fault: R6 negative on GND', () => {
    const d = diffDesigns(INTENDED, fx('SYNTHETIC_bridge_r6_neg_on_gnd.json').graph);
    expect(d.componentDiffs).toEqual([]);
    expect(d.connectionDiffs).toEqual([{ componentId: 'R6', terminal: 'negative', intendedNode: 'VOUT', observedNode: 'GND' }]);
    expect(d.identical).toBe(false);
  });
  it('(4) missing and extra components', () => {
    const miss = { ...INTENDED, components: INTENDED.components.filter((c) => c.id !== 'R7') };
    expect(diffDesigns(INTENDED, miss).componentDiffs).toEqual([{ componentId: 'R7', kind: 'missing_in_observed', intended: { kind: 'resistor', value: 1200 } }]);
    const extra = { ...INTENDED, components: [...INTENDED.components, { id: 'R9', kind: 'resistor' as const, value: 100, positiveNode: 'B', negativeNode: 'GND' }] };
    const d = diffDesigns(INTENDED, extra);
    expect(d.componentDiffs[0]).toMatchObject({ componentId: 'R9', kind: 'extra_in_observed' });
    expect(d.identical).toBe(false);
  });
  it('split net is reported as an uncertainty, not guessed', () => {
    const g = { ...INTENDED, components: INTENDED.components.map((c) => (c.id === 'R5' ? { ...c, positiveNode: 'N1x' } : c)) };
    const d = diffDesigns(INTENDED, g);
    expect(d.identical).toBe(false);
    expect(d.uncertainties.join()).toMatch(/both map to intended "N1"/);
  });
});

describe('POST /api/twin', () => {
  it('(1) value fault end to end: diff, solutions, probe -> R6:x10, repair restores 680', async () => {
    const observed = fx('SYNTHETIC_bridge_r6_6800.json').graph;
    const r1 = await (await call(req(observed))).json();
    expect(r1.result.diff.componentDiffs[0]).toMatchObject({ componentId: 'R6', ratio: 10 });
    expect(r1.result.intended.provenance).toMatchObject({ kind: 'kicad' });
    expect(r1.result.trace[0]).toMatchObject({ step: 'twin', provider: 'local', model: 'mna-dc' });
    const obsV = r1.result.observedSolution.voltages;
    expect(obsV.VOUT).toBeCloseTo(0.8, 0); // sanity: far below the intended VOUT
    expect(r1.result.intendedSolution.voltages.VOUT).toBeGreaterThan(2);

    // measure VOUT first, then the node the probe recommends
    const r2 = await (await call(req(observed, { observations: [{ node: 'VOUT', volts: obsV.VOUT }] }))).json();
    const next = r2.result.probe.next.node as string;
    const obs = [{ node: 'VOUT', volts: obsV.VOUT }, { node: next, volts: obsV[next] }];
    const r3 = await (await call(req(observed, { observations: obs }))).json();
    expect(r3.result.probe.hypotheses[0].id).toBe('R6:x10');
    const p = r3.result.repair.proposals[0];
    expect(p.hypothesisId).toBe('R6:x10');
    expect(p.patch).toMatchObject({ componentId: 'R6', designValue: 680, faultedValue: 6800 });
    const row = r3.result.predictedVsMeasured.find((x: { node: string }) => x.node === 'VOUT');
    expect(row.measured).toBeCloseTo(obsV.VOUT, 9);
    expect(row.observed).toBeCloseTo(obsV.VOUT, 9);
    expect(row.intended).toBeCloseTo(r3.result.intendedSolution.voltages.VOUT, 9);
  });

  it('renamed nodes: observed values map back onto intended nodes', async () => {
    const r = await (await call(req(fx('SYNTHETIC_bridge_renamed_nodes.json').graph))).json();
    expect(r.result.diff.identical).toBe(true);
    for (const row of r.result.predictedVsMeasured) expect(row.observed).toBeCloseTo(row.intended, 9);
    expect(r.result.repair).toBeUndefined();
  });

  it('(5) unsolvable observed: null solution + uncertainty, still 200', async () => {
    const floating = { ...INTENDED, components: [...INTENDED.components, { id: 'R8', kind: 'resistor' as const, value: 100, positiveNode: 'FX', negativeNode: 'FY' }] };
    const r = await call(req(floating));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.result.observedSolution).toBeNull();
    expect(j.result.diff.identical).toBe(false);
    expect(j.result.diff.uncertainties.join()).toMatch(/cannot be solved.*floating/);
    expect(j.result.predictedVsMeasured.every((x: { observed: number | null }) => x.observed === null)).toBe(true);
  });

  it('(6) .include is rejected with the rejected lines', async () => {
    const r = await call({ ...req(INTENDED), intended: { netlist: '.include /etc/passwd\nV1 1 0 5\nR1 1 0 1k\n', format: 'spice' } });
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error.code).toBe('INVALID_REQUEST');
    expect(j.error.details.join()).toMatch(/\.include \/etc\/passwd/);
  });

  it('netlist over 64 KB is rejected', async () => {
    const r = await call({ ...req(INTENDED), intended: { netlist: '* ' + 'x'.repeat(70_000) } });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('accepts an intended graph directly', async () => {
    const r = await (await call({ ...req(INTENDED), intended: INTENDED })).json();
    expect(r.result.intended.provenance.kind).toBe('fixture');
    expect(r.result.diff.identical).toBe(true);
  });

  it('error shapes', async () => {
    expect((await call('{nope')).status).toBe(400);
    expect((await call({ ...req(INTENDED), userConfirmed: false })).status).toBe(422);
    expect((await (await call({ ...req(INTENDED), userConfirmed: false })).json()).error.code).toBe('NOT_CONFIRMED');
    expect((await (await call({ ...req(INTENDED), observedProvenance: { kind: 'telepathy' } })).json()).error.code).toBe('INVALID_REQUEST');
    expect((await (await call({ ...req({ schemaVersion: 1 }) })).json()).error.code).toBe('INVALID_GRAPH');
    expect((await (await call({ ...req(INTENDED), intended: { schemaVersion: 1, components: [] } })).json()).error.code).toBe('INVALID_GRAPH');
    const bad = await call({ ...req(INTENDED), observations: [{ node: 'NOPE', volts: 1 }] });
    expect(bad.status).toBe(422);
  });
});
