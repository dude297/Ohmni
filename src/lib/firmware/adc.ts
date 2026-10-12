import { solveDC } from '@/lib/circuit/solve';
import type { CircuitGraph } from '@/lib/circuit/types';
import type { AdcBits, AdcConfig, AdcFormula, AdcReported, AnalyzeResult, Correction, Diagnosis } from './types';

const VREFS = [1.1, 1.2, 2.048, 2.5, 3.3, 5.0];
const BITS: AdcBits[] = [8, 10, 12, 16];
const FORMULAS: AdcFormula[] = ['counts*vref/(2^bits-1)', 'counts*vref/2^bits'];
const denom = (bits: number, f: AdcFormula) => (f === 'counts*vref/2^bits' ? 2 ** bits : 2 ** bits - 1);
const num = (x: number) => String(+x.toPrecision(6));

type Hyp = Pick<Diagnosis, 'id' | 'title' | 'kind' | 'change'> & { hwVref: number; hwBits: number; ratio: number; formula: AdcFormula };

export type AnalyzeInput = {
  graph: CircuitGraph;
  adcNode: string;
  measuredVolts: number;
  reported: AdcReported;
  config: AdcConfig;
  candidates?: { vrefs?: number[]; bits?: number[] };
};

/**
 * Static, deterministic. Each candidate varies ONE assumption of `config` (the firmware's belief) and
 * simulates an ideal ADC reading the MEASURED pin voltage, then the firmware's formula; the candidate that
 * reproduces the reported value best wins.
 */
export function analyzeAdc({ graph, adcNode, measuredVolts, reported, config, candidates }: AnalyzeInput): AnalyzeResult {
  if (reported.volts === undefined && reported.counts === undefined) throw new Error('reported.volts or reported.counts is required');
  const sol = solveDC(graph);
  const expectedVolts = sol.voltages[adcNode];
  if (expectedVolts === undefined) throw new Error(`adcNode "${adcNode}" is not a node of the circuit`);
  const cfgRatio = config.dividerRatioInCode ?? 1;
  const cfgDen = denom(config.bits, config.formulaInCode);
  const useVolts = reported.volts !== undefined;
  const reportedVolts = reported.volts ?? (reported.counts! * config.vrefVolts * cfgRatio) / cfgDen;
  const impliedCounts = reported.counts ?? Math.round((reported.volts! / (config.vrefVolts * cfgRatio)) * cfgDen);
  const tolerance = useVolts ? Math.max(0.001, config.vrefVolts / cfgDen) : 1;
  const rep = useVolts ? reported.volts! : reported.counts!;

  const sim = (h: Hyp) => {
    const max = 2 ** h.hwBits - 1; // ideal ADC: counts = round(V/vref*(2^bits-1)), clamped
    const counts = Math.min(max, Math.max(0, Math.round((measuredVolts / h.hwVref) * max)));
    return useVolts ? (counts * config.vrefVolts * h.ratio) / denom(config.bits, h.formula) : counts;
  };
  const base: Hyp = { id: 'consistent', title: 'Firmware and circuit agree', kind: 'consistent', hwVref: config.vrefVolts, hwBits: config.bits, ratio: cfgRatio, formula: config.formulaInCode };
  const hyps: Hyp[] = [];
  // ponytail: one assumption at a time, no combinations (add pairs if single-fault fits keep failing)
  for (const v of new Set([...VREFS, ...(candidates?.vrefs ?? [])]))
    if (v !== config.vrefVolts)
      hyps.push({ ...base, id: `vref_${v}`, kind: 'vref_mismatch', hwVref: v, title: `Hardware Vref is ${v} V, code assumes ${config.vrefVolts} V`, change: { param: 'vref', from: config.vrefVolts, to: v } });
  for (const b of new Set([...BITS, ...(candidates?.bits ?? [])]))
    if (b !== config.bits)
      hyps.push({ ...base, id: `bits_${b}`, kind: 'bit_depth_mismatch', hwBits: b, title: `ADC is really ${b}-bit, code assumes ${config.bits}-bit`, change: { param: 'bits', from: config.bits, to: b } });
  const solved = expectedVolts > 1e-9 ? Math.max(...Object.values(sol.voltages)) / expectedVolts : NaN;
  for (const r of new Set([1, solved].filter(Number.isFinite).map((x) => +x.toPrecision(6))))
    if (Math.abs(r - cfgRatio) > 1e-9)
      hyps.push({ ...base, id: `ratio_${r}`, kind: 'divider_ratio_mismatch', ratio: r, title: `Code actually applies a divider factor of ${num(r)}, expected ${num(cfgRatio)}`, change: { param: 'ratio', from: r, to: cfgRatio } });
  for (const f of FORMULAS)
    if (f !== config.formulaInCode)
      hyps.push({ ...base, id: 'formula', kind: 'formula_off_by_one', formula: f, title: `Code really uses ${f}`, change: { param: 'formula', from: f, to: config.formulaInCode } });

  const circuitOk = Math.abs(measuredVolts - expectedVolts) <= 0.02 * Math.abs(expectedVolts) + 0.01;
  const u = useVolts ? 'V' : ' counts';
  const fmt = (x: number) => (useVolts ? x.toFixed(4) : String(x)) + u;
  const mk = (h: Hyp, evidence: (p: number, e: number) => string): Diagnosis => {
    const predictedReported = sim(h);
    const fitError = Math.abs(predictedReported - rep);
    return { id: h.id, title: h.title, kind: h.kind, change: h.change, predictedReported, fitError, evidence: evidence(predictedReported, fitError) };
  };
  const baseDiag = mk(
    circuitOk ? base : { ...base, id: 'circuit_fault', kind: 'circuit_fault', title: 'Circuit does not deliver the expected pin voltage' },
    (p, e) =>
      circuitOk
        ? `Config reproduces the report from the measured pin: predicts ${fmt(p)}, reported ${fmt(rep)} (err ${fmt(e)}). Measured ${measuredVolts} V ~ expected ${expectedVolts.toFixed(4)} V, so the circuit is fine.`
        : `Measured ${measuredVolts} V vs expected ${expectedVolts.toFixed(4)} V differs by more than 2% + 10 mV. Firmware config predicts ${fmt(p)} from the measured pin (reported ${fmt(rep)}). Hand off to Probe Guide.`,
  );
  const others = hyps.map((h) =>
    mk(h, (p, e) => {
      const hit = `predicts ${fmt(p)} vs reported ${fmt(rep)} (err ${fmt(e)})`;
      return h.kind === 'formula_off_by_one' && Math.abs(p - baseDiag.predictedReported) <= tolerance
        ? `Minor/inconclusive: the two conventions differ by ${fmt(Math.abs(p - baseDiag.predictedReported))}, within noise (${fmt(tolerance)}). ${hit}`
        : `Varying only this assumption ${hit}.`;
    }),
  );
  const diagnoses = [baseDiag, ...others].sort((a, b) => a.fitError - b.fitError || (a === baseDiag ? -1 : b === baseDiag ? 1 : 0));
  const best = baseDiag.fitError <= tolerance ? baseDiag : diagnoses[0];
  const confident = best.fitError <= tolerance;
  const ties = diagnoses.filter((d) => d !== best && d.fitError <= tolerance && d.fitError <= best.fitError + tolerance).map((d) => d.id);

  let correction: Correction | undefined;
  const c = best.change;
  if (c && confident) {
    const label = { vref: 'Vref (V)', bits: 'ADC bits', ratio: 'divider factor in code', formula: 'scaling formula' }[c.param];
    correction = { before: `${label}: ${c.from}`, after: `${label}: ${c.to}`, explanation: `${best.title}. ${best.evidence}` };
  }
  return { expectedVolts, measuredVolts, reportedVolts, impliedCounts, unit: useVolts ? 'volts' : 'counts', tolerance, circuitOk, ...(circuitOk ? {} : { handoff: 'probe-guide' as const }), diagnoses, best, confident, ties, correction };
}
