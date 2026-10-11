import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/lib/circuit/validate';
import { solveDC, SolveError } from '../../src/lib/circuit/solve';
import { POST } from '../../src/app/api/solve/route';
import {
  DIVIDER_10K_10K,
  DIVIDER_10K_1K,
  MALFORMED_FLOATING,
  MALFORMED_NO_GND,
  MALFORMED_UNKNOWN_KIND,
} from '../../src/lib/circuit/fixtures';
import type { CircuitGraph } from '../../src/lib/circuit/types';

const R = (id: string, value: number, p: string, n: string) => ({ id, kind: 'resistor' as const, value, positiveNode: p, negativeNode: n });
const V = (id: string, value: number, p: string, n: string) => ({ id, kind: 'dc_voltage' as const, value, positiveNode: p, negativeNode: n });
const g = (components: CircuitGraph['components'], measureNode = 'VIN'): CircuitGraph => ({
  schemaVersion: 1,
  components,
  groundNode: 'GND',
  measureNode,
});
const clone = (x: CircuitGraph): CircuitGraph => JSON.parse(JSON.stringify(x));

describe('solveDC', () => {
  it('10k/10k divider', () => {
    const s = solveDC(DIVIDER_10K_10K);
    expect(s.voltages.VOUT).toBeCloseTo(2.5, 6);
    expect(s.voltages.GND).toBe(0);
    expect(s.currents.R1).toBeCloseTo(0.25e-3, 9);
    expect(s.currents.V1).toBeCloseTo(-0.25e-3, 9); // MNA convention
  });
  it('10k/1k divider', () => {
    const s = solveDC(DIVIDER_10K_1K);
    expect(s.voltages.VOUT).toBeCloseTo(5 / 11, 6);
    expect(s.currents.R1).toBeCloseTo(5 / 11000, 9);
  });
  it('series/parallel: 12V, R1=100 series with (R2=200 || R3=300)', () => {
    const s = solveDC(
      g([V('V1', 12, 'VIN', 'GND'), R('R1', 100, 'VIN', 'MID'), R('R2', 200, 'MID', 'GND'), R('R3', 300, 'MID', 'GND')], 'MID'),
    );
    // parallel = 120; total 220; I = 12/220
    expect(s.currents.R1).toBeCloseTo(12 / 220, 9);
    expect(s.voltages.MID).toBeCloseTo((12 / 220) * 120, 6);
    expect(s.currents.R2 + s.currents.R3).toBeCloseTo(s.currents.R1, 9);
  });
  it('throws SolveError on conflicting parallel sources', () => {
    const bad = g([V('V1', 5, 'VIN', 'GND'), V('V2', 3, 'VIN', 'GND'), R('R1', 100, 'VIN', 'GND')]);
    expect(() => solveDC(bad)).toThrow(SolveError);
  });
});

describe('validateGraph', () => {
  it('accepts fixtures', () => {
    expect(validateGraph(DIVIDER_10K_10K).ok).toBe(true);
    expect(validateGraph(DIVIDER_10K_1K).ok).toBe(true);
  });
  const bad = (name: string, input: unknown) => it(`rejects ${name}`, () => expect(validateGraph(input).ok).toBe(false));
  const mut = (f: (x: CircuitGraph) => void) => {
    const x = clone(DIVIDER_10K_10K);
    f(x);
    return x;
  };
  bad('missing GND', MALFORMED_NO_GND);
  bad('floating node', MALFORMED_FLOATING);
  bad('unknown kind', MALFORMED_UNKNOWN_KIND);
  bad('non-object', null);
  bad('zero resistance', mut((x) => (x.components[1].value = 0)));
  bad('negative resistance', mut((x) => (x.components[1].value = -5)));
  bad('duplicate id', mut((x) => (x.components[2].id = 'R1')));
  bad('absent measureNode', { ...DIVIDER_10K_10K, measureNode: 'NOPE' });
  bad('no source', g([R('R1', 1, 'A', 'GND')], 'A'));
  bad('same-node terminals', g([V('V1', 5, 'VIN', 'GND'), R('R1', 1, 'VIN', 'VIN')]));
  bad('non-finite value', mut((x) => (x.components[0].value = Infinity)));
});

const post = (b: unknown) =>
  POST(new Request('http://x/api/solve', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));

describe('POST /api/solve', () => {
  it('200 for fixture', async () => {
    const res = await post({ graph: DIVIDER_10K_10K, userConfirmed: true, measuredVoltage: 2.5 });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.voltages.VOUT).toBeCloseTo(2.5, 6);
    expect(result.grounded).toBe(true);
    expect(result.trace[0]).toMatchObject({ step: 'solve', provider: 'local', model: 'mna-dc', status: 'ok' });
  });
  it('422 unconfirmed', async () => {
    const res = await post({ graph: DIVIDER_10K_10K, userConfirmed: false });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('NOT_CONFIRMED');
  });
  it('422 floating', async () => {
    const res = await post({ graph: MALFORMED_FLOATING, userConfirmed: true });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('INVALID_GRAPH');
  });
  it('422 unsolvable', async () => {
    const res = await post({ graph: g([V('V1', 5, 'VIN', 'GND'), V('V2', 3, 'VIN', 'GND')]), userConfirmed: true });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('UNSOLVABLE');
  });
  it('400 bad json', async () => expect((await post('{nope')).status).toBe(400));
});
