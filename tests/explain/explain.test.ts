import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { POST } from '@/app/api/explain/route';
import { checkGrounding, extractNumbers } from '@/lib/explain';
import { DIVIDER_10K_10K, MALFORMED_NO_GND } from '@/lib/circuit/fixtures';

const post = (body: unknown) =>
  POST(new Request('http://x/api/explain', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const reply = (obj: unknown) => ({ text: JSON.stringify(obj), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } });
const good = {
  summary: 'R1 and R2 (10 kΩ each) split the 5 V supply, so VOUT is 2.5 V.',
  steps: [
    { title: 'Step 1: Ohm', text: 'Current is 5 V / 20 kΩ... 0.25 mA flows through R1 and R2.' },
    { title: 'Step 2: KVL', text: 'R1 drops 2.5 V and R2 drops 2.5 V; disconnect power before measuring resistance.' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test';
});
afterEach(() => delete process.env.GEMINI_API_KEY);

describe('grounding checker', () => {
  const allowed = [5, 2.5, 10000, 0.00025];
  it('normalizes kΩ / mA / mV / µA', () => {
    expect(extractNumbers('10 kΩ, 0.25 mA, 2500 mV, 250 µA, 10k, 1,000 Ω').map((n) => n.value)).toEqual([
      10000, 0.00025, 2.5, 0.00025, 10000, 1000,
    ]);
    expect(checkGrounding('10 kΩ, 10k, 0.25 mA, 250 µA, 2500 mV, R12 at VOUT', allowed)).toEqual([]);
  });
  it('flags invented numbers', () => {
    expect(checkGrounding('VOUT is 3.3 V across 4.7 kΩ', allowed)).toEqual(['3.3 V', '4.7 kΩ']);
  });
  it('tiny prefixed values do not match zero', () => {
    expect(checkGrounding('0.2 µA', [0])).toEqual(['0.2 µA']);
  });
});

describe('POST /api/explain', () => {
  it('grounded explanation passes', async () => {
    generateContent.mockResolvedValue(reply(good));
    const r = await post({ graph: DIVIDER_10K_10K, userConfirmed: true });
    expect(r.status).toBe(200);
    const { result } = await r.json();
    expect(result.explanation).toEqual(good);
    expect(result.ungroundedNumbers).toEqual([]);
    expect(result.grounded).toBe(true);
    expect(result.facts.voltages.VOUT).toBeCloseTo(2.5);
    expect(result.trace[1]).toMatchObject({ step: 'explain', provider: 'google', status: 'ok', usage: { inputTokens: 100, outputTokens: 50 } });
  });

  it('invented number is flagged but text still returned', async () => {
    generateContent.mockResolvedValue(reply({ ...good, summary: 'VOUT should be 3.3 V.' }));
    const { result } = await (await post({ graph: DIVIDER_10K_10K, userConfirmed: true })).json();
    expect(result.grounded).toBe(false);
    expect(result.ungroundedNumbers).toEqual(['3.3 V']);
    expect(result.explanation.summary).toBe('VOUT should be 3.3 V.');
  });

  it('measured voltage adds hypotheses and their numbers are allowed', async () => {
    generateContent.mockResolvedValue(reply({ ...good, summary: 'Expected 2.5 V but measured 0.45 V; a gap of 2.05 V.' }));
    const { result } = await (await post({ graph: DIVIDER_10K_10K, userConfirmed: true, measuredVoltage: 0.45 })).json();
    expect(result.facts.hypotheses.length).toBeGreaterThan(0);
    expect(result.grounded).toBe(true);
  });

  it('model failure -> explanation null + error trace', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));
    const { result } = await (await post({ graph: DIVIDER_10K_10K, userConfirmed: true })).json();
    expect(result.explanation).toBeNull();
    expect(result.grounded).toBe(false);
    expect(result.trace[1]).toMatchObject({ status: 'error', note: 'gemini error (503)' });
  });

  it('malformed model output -> null + error', async () => {
    generateContent.mockResolvedValue({ text: 'not json' });
    const { result } = await (await post({ graph: DIVIDER_10K_10K, userConfirmed: true })).json();
    expect(result.explanation).toBeNull();
    expect(result.trace[1].note).toBe('gemini malformed_output');
  });

  it('no key -> skipped, no model call', async () => {
    delete process.env.GEMINI_API_KEY;
    const { result } = await (await post({ graph: DIVIDER_10K_10K, userConfirmed: true })).json();
    expect(result.explanation).toBeNull();
    expect(result.trace[1].status).toBe('skipped');
    expect(result.facts.voltages.VOUT).toBeCloseTo(2.5);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('422 / 400 paths', async () => {
    const code = async (b: unknown) => {
      const r = await post(b);
      return [r.status, (await r.json()).error.code];
    };
    expect(await code('{nope')).toEqual([400, 'BAD_JSON']);
    expect(await code({ graph: DIVIDER_10K_10K, userConfirmed: false })).toEqual([422, 'NOT_CONFIRMED']);
    expect(await code({ graph: MALFORMED_NO_GND, userConfirmed: true })).toEqual([422, 'INVALID_GRAPH']);
    const loop = {
      ...DIVIDER_10K_10K,
      components: [
        { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'A', negativeNode: 'GND' },
        { id: 'V2', kind: 'dc_voltage', value: 3, positiveNode: 'A', negativeNode: 'GND' },
        { id: 'R1', kind: 'resistor', value: 1000, positiveNode: 'A', negativeNode: 'GND' },
      ],
      measureNode: 'A',
    };
    expect(await code({ graph: loop, userConfirmed: true })).toEqual([422, 'UNSOLVABLE']);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
