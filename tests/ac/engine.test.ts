import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE_VERSION, runAc } from '../../src/lib/ac/engine';
import { crHighpass, rcLowpass, rlcBandpass } from './fixtures';

const sweep = { pointsPerDecade: 50, fMin: 1, fMax: 1e7 };
const deg = (r: number) => (r * 180) / Math.PI;
const interp = (f: number[], y: number[], x: number) => {
  const k = f.findIndex((v) => v >= x);
  const t = Math.log(x / f[k - 1]) / Math.log(f[k] / f[k - 1]);
  return y[k - 1] + (y[k] - y[k - 1]) * t;
};

describe('ngspice AC vs analytic (real engine)', () => {
  it('pins the reported engine version to the installed package', () => {
    expect(JSON.parse(readFileSync('node_modules/eecircuit-engine/package.json', 'utf8')).version).toBe(ENGINE_VERSION);
  });

  it('RC low-pass 1k/1uF: every grid point matches H=1/(1+jwRC); -3.01 dB / -45 deg at fc', async () => {
    const c = await runAc(rcLowpass(), sweep);
    c.freq.forEach((f, i) => {
      const w = 2 * Math.PI * f * 1e-3;
      expect(Math.abs(c.magDb[i] + 10 * Math.log10(1 + w * w))).toBeLessThan(0.02);
      expect(Math.abs(c.phaseDeg[i] + deg(Math.atan(w)))).toBeLessThan(0.1);
    });
    const fc = 1 / (2 * Math.PI * 1e-3);
    expect(fc).toBeCloseTo(159.155, 2);
    expect(interp(c.freq, c.magDb, fc)).toBeCloseTo(-3.01, 1);
    expect(interp(c.freq, c.phaseDeg, fc)).toBeCloseTo(-45, 0);
  });

  it('series RLC band-pass R100 L10mH C1uF: peak at f0=1591.5 Hz, ~0 dB, Q=1', async () => {
    const c = await runAc(rlcBandpass(), sweep);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-3 * 1e-6));
    expect(f0).toBeCloseTo(1591.5, 1);
    const k = c.magDb.indexOf(Math.max(...c.magDb));
    const nearest = c.freq.reduce((b, f, i) => (Math.abs(Math.log(f / f0)) < Math.abs(Math.log(c.freq[b] / f0)) ? i : b), 0);
    expect(Math.abs(k - nearest)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.magDb[k])).toBeLessThan(0.05);
    expect(Math.abs(interp(c.freq, c.phaseDeg, f0))).toBeLessThan(1);
    // Q = f0/BW from the -3.01 dB crossings (analytic: edges at 0.618 f0 and 1.618 f0 => BW = f0 for Q=1)
    const above = c.magDb.map((m) => m > -3.0103);
    const lo = c.freq[above.indexOf(true)];
    const hi = c.freq[above.lastIndexOf(true)];
    const q = f0 / (hi - lo);
    expect(q).toBeGreaterThan(0.93);
    expect(q).toBeLessThan(1.07);
  });

  it('CR high-pass 1k/1uF: +45 deg and -3.01 dB at fc, flat above', async () => {
    const c = await runAc(crHighpass(), sweep);
    const fc = 1 / (2 * Math.PI * 1e-3);
    expect(interp(c.freq, c.magDb, fc)).toBeCloseTo(-3.01, 1);
    expect(interp(c.freq, c.phaseDeg, fc)).toBeCloseTo(45, 0);
    expect(Math.abs(c.magDb[c.magDb.length - 1])).toBeLessThan(0.01);
  });

  it('does not leak a global window (it would make every Next route 500)', async () => {
    await runAc(rcLowpass());
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
  });

  it('concurrency guard: one at a time, queue of 3, the rest get BUSY', async () => {
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => runAc(rcLowpass())));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(4);
    const rej = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(rej.map((x) => x.reason.code)).toEqual(['BUSY', 'BUSY']);
  });
});
