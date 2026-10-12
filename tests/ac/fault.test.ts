import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/ac/analysis';
import { rcLowpass } from './fixtures';

// Bench readings of a board whose C1 is really 100 nF instead of 1 uF:
// fc moves 159 Hz -> 1591 Hz (10x). Readings carry +-0.1 dB wobble.
const fc = 1591.55;
const wobble = [0.05, -0.08, 0.1, -0.05, 0.07, -0.1, 0.03];
export const measured = [100, 300, 800, 1590, 3000, 8000, 20000].map((f, i) => ({
  freqHz: f,
  magDb: Number((-10 * Math.log10(1 + (f / fc) ** 2) + wobble[i]).toFixed(2)),
}));

describe('fault discrimination (solver-backed)', () => {
  it('C1x0.1 and R1x0.1 are indistinguishable by magnitude; DC resistance and |Zin| separate them', async () => {
    const r = await analyze(rcLowpass(), { faults: true, measuredPoints: measured });
    const [a, b] = r.candidates!;
    expect([a.id, b.id].sort()).toEqual(['C1x0.1', 'R1x0.1']);
    expect(Math.abs(a.fitError! - b.fitError!)).toBeLessThan(0.05);
    expect(a.fitError!).toBeLessThan(0.15);
    const d = r.discriminator!;
    expect(d.instruction).toMatch(/cannot tell them apart/);
    const dc = Object.fromEntries(d.predictions.map((p) => [p.candidateId, p.value]));
    expect(dc['C1x0.1']).toBe(1000);
    expect(dc['R1x0.1']).toBe(100);
    const z = Object.fromEntries(d.alternative!.predictions.map((p) => [p.candidateId, p.value]));
    expect(z['C1x0.1']).toBeGreaterThan(1300); // |1000 - j1000| ~ 1414
    expect(z['R1x0.1']).toBeLessThan(160); // |100 - j100| ~ 141
    expect(r.trace[0]).toMatchObject({ step: 'ac', provider: 'ngspice', model: 'eecircuit-engine@1.8.0', status: 'ok' });
  });

  it('a reading at the nominal corner returns ranked candidates without crashing', async () => {
    const r = await analyze(rcLowpass(), { faults: true, measuredPoints: [{ freqHz: 159, magDb: -3 }] });
    expect(r.candidates!.length).toBeGreaterThan(0);
  });
});
