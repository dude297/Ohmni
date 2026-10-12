import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { reviewCircuit, mentorExplain, REVIEW_DISCLAIMER, type Finding } from '@/lib/review';
import { POST } from '@/app/api/review/route';
import { DIVIDER_10K_10K, DIVIDER_10K_1K, MALFORMED_NO_GND, MALFORMED_UNKNOWN_KIND } from '@/lib/circuit/fixtures';
import type { CircuitGraph } from '@/lib/circuit/types';

const g = (components: CircuitGraph['components'], measureNode = 'N1'): CircuitGraph => ({ schemaVersion: 1, components, groundNode: 'GND', measureNode });
const V = (id: string, value: number, p = 'N1', n = 'GND') => ({ id, kind: 'dc_voltage' as const, value, positiveNode: p, negativeNode: n });
const R = (id: string, value: number, p: string, n: string) => ({ id, kind: 'resistor' as const, value, positiveNode: p, negativeNode: n });
const errs = (f: Finding[]) => f.filter((x) => x.severity === 'error');
const reply = (obj: unknown) => ({ text: JSON.stringify(obj), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test';
});
afterEach(() => delete process.env.GEMINI_API_KEY);

describe('reviewCircuit', () => {
  it('correct divider has no errors', () => {
    const r = reviewCircuit(DIVIDER_10K_10K);
    expect(errs(r.findings)).toEqual([]);
    expect(r.solution?.voltages.VOUT).toBeCloseTo(2.5);
    expect(r.findings.some((f) => f.category === 'power_dissipation' && /No rating/.test(f.evidence.statement))).toBe(true);
  });
  it('flags a direct supply short', () => {
    const f = reviewCircuit(g([V('V1', 5), R('R1', 0.0005, 'N1', 'GND')])).findings;
    expect(f.find((x) => x.category === 'supply_short')?.severity).toBe('error');
  });
  it('flags a source with both terminals on one node (validation mapping)', () => {
    const f = reviewCircuit(g([V('V1', 5, 'N1', 'N1'), R('R1', 100, 'N1', 'GND')])).findings;
    expect(f.some((x) => x.category === 'supply_short' && x.components[0] === 'V1')).toBe(true);
  });
  it('flags parallel sources 5 V vs 3 V', () => {
    const r = reviewCircuit(g([V('V1', 5), V('V2', 3), R('R1', 100, 'N1', 'GND')]));
    const f = r.findings.find((x) => x.category === 'supply_conflict')!;
    expect(f.severity).toBe('error');
    expect(f.evidence.numbers).toEqual({ V1_V: 5, V2_V: 3 });
    expect(r.solution).toBeUndefined();
  });
  it('flags a floating (single-terminal) node', () => {
    const f = reviewCircuit(g([V('V1', 5), R('R1', 100, 'N1', 'GND'), R('R2', 100, 'N1', 'DANGLE')])).findings;
    expect(f.find((x) => x.category === 'floating_node')?.nodes).toEqual(['DANGLE']);
  });
  it('maps validation failures (missing GND, unknown kind)', () => {
    expect(reviewCircuit(MALFORMED_NO_GND).findings.some((x) => x.category === 'ground_reference')).toBe(true);
    const k = reviewCircuit(MALFORMED_UNKNOWN_KIND).findings;
    expect(k.some((x) => x.severity === 'error')).toBe(true);
    expect(k.some((x) => /LED\/semiconductor/.test(x.evidence.statement))).toBe(true);
  });
  it('100 ohm across 12 V with 0.25 W rating -> P = 1.44 W', () => {
    const f = reviewCircuit(g([V('V1', 12), R('R1', 100, 'N1', 'GND')]), { ratings: { R1: { powerW: 0.25 } } }).findings;
    const p = f.find((x) => x.category === 'power_dissipation' && x.severity === 'error')!;
    expect(p.evidence.numbers.powerW).toBeCloseTo(1.44);
    expect(p.evidence.numbers.ratingW).toBe(0.25);
    expect(p.basis).toBe('simulation');
  });
  it('value mismatch vs intended (R2 1k vs 10k) carries solver effect', () => {
    const f = reviewCircuit(DIVIDER_10K_1K, { intended: DIVIDER_10K_10K }).findings.find((x) => x.category === 'value_mismatch')!;
    expect(f.components).toEqual(['R2']);
    expect(f.basis).toBe('design_diff');
    expect(f.evidence.numbers).toMatchObject({ actualValue: 1000, intendedValue: 10000, measureNodeIntendedV: 2.5 });
    expect(f.evidence.numbers.measureNodeActualV).toBeCloseTo(0.4545, 3);
  });
  it('connectivity mismatch vs intended', () => {
    const wrong: CircuitGraph = { ...DIVIDER_10K_10K, components: DIVIDER_10K_10K.components.map((c) => (c.id === 'R2' ? { ...c, positiveNode: 'VIN' } : c)) };
    const f = reviewCircuit(wrong, { intended: DIVIDER_10K_10K }).findings;
    expect(f.some((x) => x.category === 'connectivity_mismatch' && x.components[0] === 'R2')).toBe(true);
  });
});

const finding = () => reviewCircuit(DIVIDER_10K_1K, { intended: DIVIDER_10K_10K }).findings.find((x) => x.category === 'value_mismatch')!;

describe('mentorExplain', () => {
  it('hint index 0 never reveals the answer value (mocked leaking model)', async () => {
    generateContent.mockResolvedValue(reply({ text: 'R2 should be 10 kΩ, i.e. 10000 ohms.' }));
    const r = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'beginner', mode: 'hint', hintIndex: 0 });
    expect(r.text).not.toMatch(/10\s*k|10000|10,000/i);
    expect(r.text).toMatch(/Mentor unavailable/);
    // prompt for hints carried no numbers
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].text).not.toMatch(/10000|1000/);
  });
  it('passes a clean hint through', async () => {
    generateContent.mockResolvedValue(reply({ text: 'Which resistor sets the output of the divider?' }));
    const r = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'beginner', mode: 'hint', hintIndex: 0 });
    expect(r).toMatchObject({ text: 'Which resistor sets the output of the divider?', grounded: true });
  });
  it('grounded explanation passes; invented 3.3 V is flagged', async () => {
    generateContent.mockResolvedValueOnce(reply({ text: 'R2 is 1 kΩ instead of 10 kΩ, so VOUT is 0.4545 V instead of 2.5 V.', steps: [{ title: 'Divider', text: 'Voltage divider rule.' }] }));
    const ok = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'intermediate', mode: 'explain' });
    expect(ok).toMatchObject({ grounded: true, ungroundedNumbers: [] });
    expect(ok.trace[0]).toMatchObject({ step: 'mentor', status: 'ok' });
    generateContent.mockResolvedValueOnce(reply({ text: 'VOUT should be 3.3 V.' }));
    const bad = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'intermediate', mode: 'explain' });
    expect(bad.grounded).toBe(false);
    expect(bad.ungroundedNumbers).toEqual(['3.3 V']);
  });
  it('falls back deterministically with no key', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'advanced', mode: 'explain' });
    expect(r.text).toMatch(/^Mentor unavailable — deterministic summary/);
    expect(r.text).toContain(finding().evidence.statement);
    expect(r.trace[0].status).toBe('skipped');
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('falls back on model error', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const r = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'advanced', mode: 'explain' });
    expect(r.text).toMatch(/Mentor unavailable/);
    expect(r.trace[0]).toMatchObject({ status: 'error', note: 'gemini error (500)' });
  });
});

describe('POST /api/review', () => {
  const post = (b: unknown) => POST(new Request('http://x/api/review', { method: 'POST', body: JSON.stringify(b) }));
  it('requires confirmation and returns findings + mentor', async () => {
    expect((await post({ graph: DIVIDER_10K_10K })).status).toBe(422);
    generateContent.mockResolvedValue(reply({ text: 'ok' }));
    const res = await post({
      graph: DIVIDER_10K_1K, userConfirmed: true, intended: DIVIDER_10K_10K,
      mentor: { findingId: 'value_mismatch:R2', level: 'beginner', mode: 'explain' },
    });
    const { result } = await res.json();
    expect(res.status).toBe(200);
    expect(result.findings.some((f: Finding) => f.id === 'value_mismatch:R2')).toBe(true);
    expect(result.mentor.text).toBe('ok');
    expect(result.advisory).toBe(true);
    expect(result.disclaimer).toBe(REVIEW_DISCLAIMER);
    expect(result.disclaimer).toContain('Advisory review: rules + DC solver');
    expect(result.trace.map((t: { step: string }) => t.step)).toEqual(['review', 'mentor']);
    expect((await post({ graph: DIVIDER_10K_1K, userConfirmed: true, mentor: { findingId: 'nope', level: 'beginner', mode: 'hint' } })).status).toBe(422);
  });
});

// Opt-in live check: RUN_LIVE_MENTOR=1 (1 Gemini call). Real key must be in env.
describe.skipIf(process.env.RUN_LIVE_MENTOR !== '1')('live mentor', () => {
  it('explains the divider value mismatch', async () => {
    const real = await vi.importActual<typeof import('@google/genai')>('@google/genai');
    generateContent.mockImplementation((args: unknown) =>
      new real.GoogleGenAI({ apiKey: process.env.LIVE_KEY }).models.generateContent(args as never));
    process.env.GEMINI_API_KEY = process.env.LIVE_KEY;
    const t = Date.now();
    const r = await mentorExplain({ graph: DIVIDER_10K_1K, finding: finding(), level: 'intermediate', mode: 'explain' });
    const out = JSON.stringify({ ms: Date.now() - t, grounded: r.grounded, ungrounded: r.ungroundedNumbers, text: r.text, steps: r.steps, trace: r.trace }, null, 2);
    console.log('LIVE_MENTOR', out);
    if (process.env.LIVE_OUT) writeFileSync(process.env.LIVE_OUT, out);
    expect(r.trace[0].status).toBe('ok');
  }, 30_000);
});
