import { AcError, ENGINE_VERSION, runAcRaw, toCurve, type RawAc } from './engine';
import { LIMITS, type AcGraph, type AcResult, type Candidate, type Discriminator, type MeasuredPoint, type Prediction } from './types';

// Overall wall-clock budget for one analysis (queue wait + every candidate sim). Beyond it: AcError TIMEOUT -> 504, no partial result.
export const ANALYSIS_DEADLINE_MS = 20_000;
const FACTORS = [0.1, 10];
const AMBIGUOUS_DB = 0.25; // candidates whose RMS fit differs by less than this are indistinguishable by magnitude
const GOOD_FIT_DB = 1.5;

const sig = (x: number) => Number(x.toPrecision(3));
export function fmtSi(x: number, unit: string): string {
  const p: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  const [s, pre] = p.find(([m]) => Math.abs(x) >= m) ?? p[p.length - 1];
  return `${sig(x / s)} ${pre}${unit}`;
}
const UNIT = { resistor: 'Ω', capacitor: 'F', inductor: 'H' } as const;

/** RMS dB error of a curve against measured points, interpolating linearly in log-frequency. */
export function fitError(freq: number[], magDb: number[], pts: MeasuredPoint[]): number {
  let sum = 0;
  for (const p of pts) {
    let k = freq.findIndex((f) => f >= p.freqHz);
    if (k < 0) k = freq.length - 1;
    const k0 = Math.max(0, k - 1);
    const t = k === k0 ? 0 : Math.log(p.freqHz / freq[k0]) / Math.log(freq[k] / freq[k0]);
    const y = magDb[k0] + (magDb[k] - magDb[k0]) * Math.min(1, Math.max(0, t));
    sum += (y - p.magDb) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}

const zin = (r: RawAc, k: number) => 1 / Math.hypot(...r.src[k]);

type Cand = Candidate & { compId: string; kind: 'resistor' | 'capacitor' | 'inductor'; value: number; raw: RawAc };

export async function analyze(
  g: AcGraph,
  opts: { faults?: boolean; measuredPoints?: MeasuredPoint[]; deadlineMs?: number } = {},
): Promise<AcResult> {
  const t0 = performance.now();
  const deadline = t0 + (opts.deadlineMs ?? ANALYSIS_DEADLINE_MS);
  const guard = () => {
    if (performance.now() > deadline) throw new AcError('TIMEOUT', 'AC analysis exceeded its overall time budget; try without fault search');
  };
  const nominalRaw = await runAcRaw(g);
  guard();
  const result: AcResult = {
    nominal: toCurve(nominalRaw),
    trace: [],
  };
  const pts = opts.measuredPoints ?? [];
  if (opts.faults && pts.length) {
    const cands: Cand[] = [];
    for (const c of g.components) {
      if (c.kind === 'ac_source') continue;
      for (const f of FACTORS) {
        const v = c.value * f;
        const [lo, hi] = LIMITS.range[c.kind];
        if (v < lo || v > hi) continue;
        guard();
        const raw = await runAcRaw({ ...g, components: g.components.map((x) => (x.id === c.id ? { ...x, value: v } : x)) });
        const cv = toCurve(raw);
        cands.push({
          ...cv,
          id: `${c.id}x${f}`,
          title: `${c.id} ×${f} (${fmtSi(v, UNIT[c.kind])})`,
          fitError: fitError(cv.freq, cv.magDb, pts),
          compId: c.id,
          kind: c.kind,
          value: v,
          raw,
        });
      }
    }
    cands.sort((a, b) => a.fitError! - b.fitError!);
    const top = cands.filter((c) => c.fitError! < 6).slice(0, 4); // drop hopeless fits so the plot stays readable
    result.candidates = top.map((c) => ({ id: c.id, title: c.title, fitError: c.fitError, freq: c.freq, magDb: c.magDb, phaseDeg: c.phaseDeg }));
    const [a, b] = top;
    if (a && b && a.fitError! < GOOD_FIT_DB && b.fitError! - a.fitError! < AMBIGUOUS_DB)
      result.discriminator = discriminate(g, a, b, pts);
  }
  result.trace.push({
    step: 'ac',
    provider: 'ngspice',
    model: `eecircuit-engine@${ENGINE_VERSION}`,
    durationMs: Math.round(performance.now() - t0),
    status: 'ok',
  });
  return result;
}

function discriminate(g: AcGraph, a: Cand, b: Cand, pts: MeasuredPoint[]): Discriminator {
  const pair = [a, b];
  // Probe frequency: the measured point closest to the -3 dB corner.
  const probe = pts.reduce((p, q) => (Math.abs(q.magDb + 3.01) < Math.abs(p.magDb + 3.01) ? q : p));
  const k = a.freq.findIndex((f) => f >= probe.freqHz * 0.999);
  const fz = a.freq[k];
  const zPred: Prediction[] = pair.map((c) => ({ candidateId: c.id, value: sig(zin(c.raw, k)), unit: 'Ω' }));
  const zText = `Alternatively, measure the source loading (input impedance |Zin|) at ${sig(fz)} Hz: ${zPred
    .map((p) => `${fmtSi(p.value, 'Ω')} if ${p.candidateId}`)
    .join(' vs ')}.`;
  const why = `${a.id} and ${b.id} fit the measured points equally well (${a.fitError!.toFixed(2)} dB vs ${b.fitError!.toFixed(2)} dB RMS), so AC magnitude at the output cannot tell them apart.`;
  const rc = pair.find((c) => c.kind === 'resistor');
  if (!rc) return { instruction: `${why} ${zText}`, predictions: zPred };
  const nominalR = (g.components.find((c) => c.id === rc.compId) as { value: number }).value;
  const pred: Prediction[] = pair.map((c) => ({
    candidateId: c.id,
    value: sig(c.compId === rc.compId ? c.value : nominalR),
    unit: 'Ω',
  }));
  return {
    instruction: `${why} Power the circuit off and measure the DC resistance across ${rc.compId}: ${pred
      .map((p) => `${fmtSi(p.value, 'Ω')} means ${p.candidateId}`)
      .join(', ')}.`,
    predictions: pred,
    alternative: { instruction: zText, predictions: zPred },
  };
}
