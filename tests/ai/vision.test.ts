import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { extractWithFallback } from '../../src/lib/ai/vision';

const good = {
  inputKind: 'schematic',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: '5V', positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: '10k', positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: '10k', positiveNode: 'VOUT', negativeNode: 'GND' },
  ],
  measureNode: 'VOUT',
  warnings: [],
  unresolvedConnections: [],
};
const apiError = (status: number, message = 'boom') => Object.assign(new Error(message), { status });
const groqOk = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 });

const fetchMock = vi.fn();
const OLD = { ...process.env };
beforeEach(() => {
  generateContent.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.GEMINI_API_KEY = 'g-key';
  process.env.GROQ_API_KEY = 'q-key';
  delete process.env.GEMINI_MODEL;
  delete process.env.GROQ_VISION_MODEL;
  process.env.VISION_PRIMARY = 'gemini'; // existing cases exercise Gemini-first; Groq-first default tested below
});
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const run = () => extractWithFallback(new Uint8Array([1, 2]), 'image/png');

describe('extractWithFallback', () => {
  it('does not call Groq when Gemini succeeds', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(good), usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ provider: 'google', status: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['429 rate limit', apiError(429, 'slow down'), 'rate_limited (429)'],
    ['429 quota', apiError(429, 'You exceeded your current quota'), 'quota_exhausted (429)'],
    ['404 model', apiError(404, 'model not found'), 'model_unavailable (404)'],
    ['503 high demand', apiError(503, 'UNAVAILABLE high demand'), 'model_unavailable (503)'],
    ['500', apiError(500), 'server_error (500)'],
  ])('falls back to Groq on Gemini %s', async (_n, err, reason) => {
    generateContent.mockRejectedValue(err);
    fetchMock.mockResolvedValue(groqOk());
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.extraction.graph?.measureNode).toBe('VOUT');
    expect(r.events.map((e) => e.provider)).toEqual(['google', 'groq']);
    expect(r.events[0]).toMatchObject({ status: 'error', note: `fallback: gemini ${reason}` });
    expect(r.events[1]).toMatchObject({ status: 'ok', model: 'qwen/qwen3.8-27b', usage: { inputTokens: 5, outputTokens: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back on Gemini timeout', async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(
      ({ config }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_, rej) => config.abortSignal.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    fetchMock.mockResolvedValue(groqOk());
    const p = run();
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.events[0].note).toMatch(/^fallback: gemini timeout/);
  });

  it('falls back when Gemini is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    fetchMock.mockResolvedValue(groqOk());
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.events[0]).toMatchObject({ provider: 'google', status: 'skipped', note: 'fallback: gemini not_configured' });
  });

  it('falls back on malformed Gemini output', async () => {
    generateContent.mockResolvedValue({ text: 'nope' });
    fetchMock.mockResolvedValue(groqOk());
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.events[0].note).toContain('malformed_output');
  });

  it('does not fall back on non-fallback errors (e.g. 401)', async () => {
    generateContent.mockRejectedValue(apiError(401));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.extraction.warnings[0]).toMatch(/gemini other/);
  });

  it('skips Groq honestly without GROQ_API_KEY; manual-entry extraction', async () => {
    delete process.env.GROQ_API_KEY;
    generateContent.mockRejectedValue(apiError(429));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.events[1]).toMatchObject({ provider: 'groq', status: 'skipped', note: 'GROQ_API_KEY not configured' });
    expect(r.extraction).toEqual({
      inputKind: 'unknown',
      graph: null,
      warnings: ['Automated extraction unavailable (gemini rate_limited, groq not_configured); enter the circuit manually.'],
      unresolvedConnections: [],
      requiresHumanReview: true,
    });
  });

  it('both fail -> manual entry, two trace events, no secrets', async () => {
    generateContent.mockRejectedValue(apiError(503));
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.extraction.graph).toBeNull();
    expect(r.extraction.warnings[0]).toBe('Automated extraction unavailable (gemini model_unavailable, groq rate_limited); enter the circuit manually.');
    expect(r.events).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(/g-key|q-key/);
  });
});

describe('default order (VISION_PRIMARY unset) is Groq first', () => {
  beforeEach(() => {
    delete process.env.VISION_PRIMARY;
  });

  it('uses Groq and never calls Gemini when Groq succeeds', async () => {
    fetchMock.mockResolvedValue(groqOk());
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ provider: 'groq', status: 'ok' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back to Gemini once when Groq is rate limited, with an honest note', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"rate limit"}}', { status: 429 }));
    generateContent.mockResolvedValue({ text: JSON.stringify(good), usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.events.map((e) => e.provider)).toEqual(['groq', 'google']);
    expect(r.events[0].note).toBe("fallback: groq rate_limited (429)");
    expect(r.events[1].note).toMatch(/fallback from groq rate_limited/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('both fail -> manual entry naming both providers', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    generateContent.mockRejectedValue(apiError(503, 'UNAVAILABLE high demand'));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.extraction.graph).toBeNull();
    expect(r.extraction.warnings[0]).toMatch(/groq .*gemini .*enter the circuit manually/);
  });

  it('VISION_PRIMARY=gemini restores Gemini first', async () => {
    process.env.VISION_PRIMARY = 'gemini';
    generateContent.mockResolvedValue({ text: JSON.stringify(good), usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    const r = await run();
    expect(r.events[0].provider).toBe('google');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
