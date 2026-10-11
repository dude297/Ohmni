import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSiValue, toCandidateExtraction } from '../../src/lib/ai/extractionSchema';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { extractCircuit } from '../../src/lib/ai/gemini';

const goodRaw = {
  inputKind: 'schematic',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: '5V', positiveNode: 'VIN', negativeNode: 'ground' },
    { id: 'R1', kind: 'resistor', value: '10k', positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: '10kΩ', positiveNode: 'VOUT', negativeNode: '0' },
  ],
  measureNode: 'VOUT',
  warnings: [],
  unresolvedConnections: [],
};
const fixture = {
  schemaVersion: 1,
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10000, positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: 10000, positiveNode: 'VOUT', negativeNode: 'GND' },
  ],
  groundNode: 'GND',
  measureNode: 'VOUT',
};

describe('parseSiValue', () => {
  it.each([
    ['10k', 10000],
    ['4.7kΩ', 4700],
    ['1M', 1e6],
    ['5V', 5],
    ['4k7', 4700],
    ['2.2 kohm', 2200],
    ['1meg', 1e6],
    ['100m', 0.1],
    ['470', 470],
    [12, 12],
  ])('%s -> %s', (i, o) => expect(parseSiValue(i)).toBeCloseTo(o as number, 9));
  it.each(['', 'abc', '-5', '0', null, undefined, NaN])('rejects %s', (i) => expect(parseSiValue(i)).toBeNull());
});

describe('toCandidateExtraction', () => {
  it('maps a good divider to the contract fixture', () => {
    const e = toCandidateExtraction(goodRaw);
    expect(e.graph).toEqual(fixture);
    expect(e.requiresHumanReview).toBe(true);
    expect(e.inputKind).toBe('schematic');
  });
  it('excludes unsupported parts with a warning', () => {
    const e = toCandidateExtraction({ ...goodRaw, components: [...goodRaw.components, { id: 'C1', kind: 'capacitor', value: '1u', positiveNode: 'VOUT', negativeNode: 'GND' }] });
    expect(e.warnings.join()).toContain('C1');
    expect(e.graph?.components.map((c) => c.id)).toEqual(['V1', 'R1', 'R2']);
  });
  it('returns null graph for malformed output', () => {
    for (const bad of [null, 'oops', { components: 'x' }]) {
      const e = toCandidateExtraction(bad);
      expect(e.graph).toBeNull();
      expect(e.warnings.length).toBeGreaterThan(0);
      expect(e.requiresHumanReview).toBe(true);
    }
  });
  it('null graph + warning when measure node missing', () => {
    const e = toCandidateExtraction({ ...goodRaw, measureNode: null });
    expect(e.graph).toBeNull();
    expect(e.warnings.join()).toMatch(/measure/i);
  });
  it('never invents a missing value', () => {
    const e = toCandidateExtraction({ ...goodRaw, components: [goodRaw.components[0], { ...goodRaw.components[1], value: undefined }, goodRaw.components[2]] });
    expect(e.graph).toBeNull();
  });
});

describe('extractCircuit', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    generateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    process.env = { ...OLD };
    vi.useRealTimers();
  });

  it('throws GEMINI_NOT_CONFIGURED without key', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(extractCircuit(new Uint8Array([1]), 'image/png')).rejects.toThrow('GEMINI_NOT_CONFIGURED');
  });

  it('returns extraction + trace event on success', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify(goodRaw),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });
    const { extraction, event } = await extractCircuit(new Uint8Array([1, 2]), 'image/png');
    expect(extraction.graph).toEqual(fixture);
    expect(event).toMatchObject({ step: 'extract', provider: 'google', model: 'gemini-3.8-flash', status: 'ok', usage: { inputTokens: 100, outputTokens: 50 } });
    expect(generateContent.mock.calls[0][0].config.temperature).toBe(0);
  });

  it('malformed JSON -> null graph, error event', async () => {
    generateContent.mockResolvedValue({ text: 'not json' });
    const { extraction, event } = await extractCircuit(new Uint8Array([1]), 'image/png');
    expect(extraction.graph).toBeNull();
    expect(event.status).toBe('error');
    expect(event.note).toBeTruthy();
  });

  it('times out after 20s via abort signal', async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(
      ({ config }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_, rej) => config.abortSignal.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const p = extractCircuit(new Uint8Array([1]), 'image/png');
    await vi.advanceTimersByTimeAsync(20_000);
    const { extraction, event } = await p;
    expect(extraction.graph).toBeNull();
    expect(event.status).toBe('error');
    expect(event.note).toMatch(/timed out/);
  });
});
