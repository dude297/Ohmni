import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIVIDER_10K_1K, DIVIDER_10K_10K } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import { POST } from '@/app/api/firmware/adc/route';
import { analyzeAdc, configFromExtraction, extractFromCode, MAX_CODE_BYTES, proposeDiff, type AdcConfig } from '@/lib/firmware';

const cfg = (o: Partial<AdcConfig> = {}): AdcConfig => ({ bits: 12, vrefVolts: 5, vrefSource: 'vdd', formulaInCode: 'counts*vref/(2^bits-1)', ...o });
const run = (o: Parameters<typeof analyzeAdc>[0]) => analyzeAdc(o);
const base = { graph: DIVIDER_10K_10K, adcNode: 'VOUT' };
const fx = (n: string) => readFileSync(`fixtures/firmware/${n}`, 'utf8');

describe('reference case: 5 V divider, MCU at 3.3 V, code says VREF 5.0', () => {
  const counts = Math.round((2.5 / 3.3) * 4095);
  const reportedV = (counts * 5.0) / 4095;
  const r = run({ ...base, measuredVolts: 2.5, reported: { volts: reportedV }, config: cfg() });
  it('numbers', () => {
    expect(solveDC(DIVIDER_10K_10K).voltages.VOUT).toBeCloseTo(2.5, 9);
    expect(counts).toBe(3102);
    expect(reportedV).toBeCloseTo(3.7875, 3);
    expect(r.expectedVolts).toBeCloseTo(2.5, 9);
    expect(r.impliedCounts).toBe(3102);
  });
  it('picks vref_mismatch 3.3, matching within 1 mV, circuit fine', () => {
    expect(r.best.kind).toBe('vref_mismatch');
    expect(r.best.id).toBe('vref_3.3');
    expect(Math.abs(r.best.predictedReported - reportedV)).toBeLessThan(0.001);
    expect(r.circuitOk).toBe(true);
    expect(r.handoff).toBeUndefined();
    expect(r.confident).toBe(true);
    expect(r.correction?.after).toContain('3.3');
  });
  it('proposes the VREF line change from pasted code', () => {
    const code = fx('vref5_adc12.ino');
    const e = extractFromCode(code);
    expect(e.config).toMatchObject({ vrefVolts: 5, bits: 12 });
    expect(e.findings.find((f) => f.field === 'vref')?.line).toBe(2);
    const d = proposeDiff(code, e, r.best)!;
    expect(d).toContain('PROPOSED (not applied)');
    expect(d).toContain('-#define VREF 5.0');
    expect(d).toContain('+#define VREF 3.3');
  });
  it('works with counts only', () => {
    const c = run({ ...base, measuredVolts: 2.5, reported: { counts }, config: cfg() });
    expect(c.unit).toBe('counts');
    expect(c.best.id).toBe('vref_3.3');
  });
});

describe('other diagnoses', () => {
  it('10-bit hardware vs 12-bit code', () => {
    const rep = (Math.round((2.5 / 3.3) * 1023) * 3.3) / 4095;
    const r = run({ ...base, measuredVolts: 2.5, reported: { volts: rep }, config: cfg({ vrefVolts: 3.3 }) });
    expect(r.best.kind).toBe('bit_depth_mismatch');
    expect(r.best.id).toBe('bits_10');
    expect(r.correction?.after).toContain('10');
  });
  it('divider factor missing in code (config expects x2, firmware reports pin voltage)', () => {
    const rep = (Math.round((2.5 / 3.3) * 4095) * 3.3) / 4095;
    const r = run({ ...base, measuredVolts: 2.5, reported: { volts: rep }, config: cfg({ vrefVolts: 3.3, dividerRatioInCode: 2 }) });
    expect(r.best.kind).toBe('divider_ratio_mismatch');
    expect(r.correction?.after).toContain('2');
    expect(extractFromCode(fx('divider_factor.ino')).config.dividerRatioInCode).toBe(2);
    const noFactor = 'float v = raw * VREF / 4095.0;';
    expect(proposeDiff(noFactor, extractFromCode(noFactor), r.best)).toContain('+float v = raw * VREF / 4095.0 * 2;');
  });
  it('formula /4096 vs /4095 is minor and tied with consistent', () => {
    const rep = (Math.round((2.5 / 3.3) * 4095) * 3.3) / 4096;
    const r = run({ ...base, measuredVolts: 2.5, reported: { volts: rep }, config: cfg({ vrefVolts: 3.3 }) });
    expect(r.best.kind).toBe('consistent');
    expect(r.ties).toContain('formula');
    expect(r.diagnoses.find((d) => d.id === 'formula')!.evidence).toMatch(/Minor\/inconclusive/);
    expect(r.correction).toBeUndefined();
  });
  it('genuine circuit fault: measured 0.45 V vs expected 2.5 V', () => {
    const rep = (Math.round((0.45 / 5) * 4095) * 5) / 4095;
    const r = run({ ...base, measuredVolts: 0.45, reported: { volts: rep }, config: cfg() });
    expect(r.circuitOk).toBe(false);
    expect(r.best.kind).toBe('circuit_fault');
    expect(r.handoff).toBe('probe-guide');
  });
  it('nothing fits -> not confident; ties reported', () => {
    const r = run({ ...base, measuredVolts: 2.5, reported: { volts: 0.123 }, config: cfg() });
    expect(r.confident).toBe(false);
    expect(r.correction).toBeUndefined();
    // low-resolution 8-bit case: coarse LSB makes several candidates indistinguishable
    const t = run({ graph: DIVIDER_10K_1K, adcNode: 'VOUT', measuredVolts: 0.4545, reported: { volts: 0.4545 }, config: cfg({ bits: 8, vrefVolts: 5 }) });
    expect(t.best.kind).toBe('consistent');
    expect(t.ties.length).toBeGreaterThan(0);
  });
  it('unknown node throws', () => {
    expect(() => run({ ...base, adcNode: 'NOPE', measuredVolts: 1, reported: { volts: 1 }, config: cfg() })).toThrow(/NOPE/);
  });
});

describe('codecheck', () => {
  it('extracts constants and line numbers', () => {
    const e = extractFromCode(
      ['const float VREF = 3.3;', 'analogReference(INTERNAL);', 'analogReadResolution(10);', 'float v = raw * VREF / 1023.0 * 2.0; // x', 'float w = x / 4096;'].join('\n'),
    );
    expect(e.config).toMatchObject({ vrefVolts: 3.3, vrefSource: 'internal', dividerRatioInCode: 2 });
    expect(e.findings.filter((f) => f.field === 'vref')[0].line).toBe(1);
    expect(configFromExtraction(extractFromCode(fx('upy_adc.py')))).toMatchObject({ bits: 16, vrefVolts: 3.3 });
    expect(extractFromCode('int x = 1;').warnings.length).toBe(2);
  });
  it('rejects > 8 KB at library and route level', async () => {
    const big = '// ' + 'x'.repeat(MAX_CODE_BYTES);
    expect(extractFromCode(big).warnings[0]).toMatch(/exceeds/);
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ graph: DIVIDER_10K_10K, userConfirmed: true, adcNode: 'VOUT', measuredVolts: 2.5, reported: { volts: 2.5 }, code: big }) }));
    expect(res.status).toBe(413);
  });
});

describe('POST /api/firmware/adc', () => {
  const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));
  const good = { graph: DIVIDER_10K_10K, userConfirmed: true, adcNode: 'VOUT', measuredVolts: 2.5, reported: { volts: (3102 * 5) / 4095 } };
  it('reference case from code only', async () => {
    const res = await post({ ...good, code: fx('vref5_adc12.ino') });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result.best.id).toBe('vref_3.3');
    expect(j.result.proposedDiff).toContain('+#define VREF 3.3');
    expect(j.result.extracted.config.vrefVolts).toBe(5);
    expect(j.trace[0]).toMatchObject({ step: 'firmware-adc', provider: 'local', model: 'deterministic', status: 'ok' });
  });
  it('errors', async () => {
    expect((await post({ ...good, userConfirmed: false })).status).toBe(422);
    expect((await post(good)).status).toBe(422);
    expect((await post({ ...good, graph: {}, config: cfg() })).status).toBe(422);
    expect((await post({ ...good, reported: {}, config: cfg() })).status).toBe(422);
    expect((await post({ ...good, adcNode: 'ZZ', config: cfg() })).status).toBe(422);
    expect((await POST(new Request('http://x', { method: 'POST', body: '{' }))).status).toBe(400);
  });
});
