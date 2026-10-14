import { describe, expect, it } from 'vitest';
import type { CircuitGraph } from '../../src/lib/circuit/types';
import { assessTopology, cropRect, mergeDelta } from '../../src/lib/topology/crossings';

const divider: CircuitGraph = {
  schemaVersion: 1,
  groundNode: 'GND',
  measureNode: 'VOUT',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10e3, positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: 10e3, positiveNode: 'VOUT', negativeNode: 'GND' },
  ],
};
const dot = (id: string, n: string) => ({ id, bbox: [0.5, 0.2, 0.52, 0.22], shape: 'tee', dot: true, treatedAsConnected: true, nodes: [n] });

describe('assessTopology', () => {
  it('accepts a clean report (all junctions dotted)', () => {
    expect(assessTopology(divider, { junctions: [dot('J1', 'VIN'), dot('J2', 'VOUT')] })).toMatchObject({ escalation: 'accept', suspects: [] });
  });

  it('flags a dotless crossing that the graph treats as connected (Groq on fixture 08)', () => {
    const a = assessTopology(divider, { junctions: [{ id: 'J3', shape: 'crossing', dot: false, treatedAsConnected: true, nodes: ['VOUT', 'GND'] }] });
    expect(a.escalation).toBe('verify_region');
    expect(a.suspects[0]).toMatchObject({ kind: 'dotless_crossing_connected', junctionId: 'J3' });
  });

  it('computes the counterfactual VOUT change for a dotless crossing read as open (ambiguous-junction)', () => {
    const a = assessTopology(divider, {
      junctions: [{ id: 'J3', shape: 'crossing', dot: false, treatedAsConnected: false, nodes: ['VOUT', 'GND'] }],
      danglingEnds: [{ bbox: [0.78, 0.07, 0.8, 0.09], note: 'stub' }],
    });
    expect(a.suspects[0].measureDelta).toBeCloseTo(2.5);
    expect(a.escalation).toBe('verify_region');
    expect(a.suspects.map((s) => s.kind)).toContain('dangling_end');
  });

  it('a harmless dotless crossing (flip does not change VOUT) only asks when other evidence exists', () => {
    const g: CircuitGraph = { ...divider, components: [...divider.components, { id: 'R3', kind: 'resistor', value: 1e3, positiveNode: 'VIN', negativeNode: 'N9' }, { id: 'R4', kind: 'resistor', value: 1e3, positiveNode: 'N9', negativeNode: 'GND' }] };
    // merging VIN into N9 shorts R3 only; VOUT is still set by V1 -> unchanged
    const a = assessTopology(g, { junctions: [{ id: 'J1', shape: 'crossing', dot: false, treatedAsConnected: false, nodes: ['VIN', 'N9'] }] });
    expect(a.suspects[0].measureDelta).toBeCloseTo(0);
    expect(a.escalation).toBe('accept');
  });

  it('tolerates string bbox numbers and garbage componentBoxes (flash-lite output)', () => {
    const a = assessTopology(divider, { junctions: [{ ...dot('J1', 'VIN'), bbox: ['0.1', '0.2', '0.3', '0.4'] }], componentBoxes: { R1: 'nope' } });
    expect(a).toMatchObject({ reportParsed: true, escalation: 'accept' });
  });

  it('unclear dot -> verify; missing report -> verify; no graph -> ask_user', () => {
    expect(assessTopology(divider, { junctions: [{ id: 'J1', shape: 'tee', dot: null, nodes: ['VOUT'] }] }).escalation).toBe('verify_region');
    expect(assessTopology(divider, 'not json').escalation).toBe('verify_region');
    expect(assessTopology(null, { junctions: [] }).escalation).toBe('ask_user');
  });

  it('flags junction nodes the graph does not contain', () => {
    const a = assessTopology(divider, { junctions: [dot('J1', 'N7')] });
    expect(a.suspects[0].kind).toBe('node_mismatch');
    expect(a.escalation).toBe('ask_user');
  });
});

describe('mergeDelta / cropRect', () => {
  it('merging the source terminals is physically impossible -> Infinity', () => {
    expect(mergeDelta(divider, 'VIN', 'GND')).toBe(Infinity);
  });
  it('crop is clamped to the image', () => {
    expect(cropRect([0.95, 0.95, 1.2, 1.1], 820, 460)).toEqual({ left: 729, top: 409, width: 91, height: 51 });
  });
});
