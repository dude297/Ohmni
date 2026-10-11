import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractWithGroq } from '../../src/lib/ai/groq';

const good = {
  inputKind: 'schematic',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: '5V', positiveNode: 'VIN', negativeNode: 'ground' },
    { id: 'R1', kind: 'resistor', value: '10k', positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: '10k', positiveNode: 'VOUT', negativeNode: '0' },
  ],
  measureNode: 'VOUT',
  warnings: [],
  unresolvedConnections: [],
};
const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 });

const fetchMock = vi.fn();
const OLD = { ...process.env };
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.GROQ_API_KEY = 'gsk-test-secret';
  delete process.env.GROQ_VISION_MODEL;
});
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('extractWithGroq', () => {
  it('skipped + not_configured without key, no network', async () => {
    delete process.env.GROQ_API_KEY;
    const r = await extractWithGroq(new Uint8Array([1]), 'image/png');
    expect(r.failure).toBe('not_configured');
    expect(r.event).toMatchObject({ provider: 'groq', status: 'skipped', note: 'GROQ_API_KEY not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends image as data URL and normalises via the shared zod mapper', async () => {
    fetchMock.mockResolvedValue(ok('<think>hmm</think>' + JSON.stringify(good)));
    const r = await extractWithGroq(new Uint8Array([1, 2]), 'image/png');
    expect(r.failure).toBeUndefined();
    expect(r.extraction.graph?.components.map((c) => [c.id, c.value, c.negativeNode])).toEqual([
      ['V1', 5, 'GND'],
      ['R1', 10000, 'VOUT'],
      ['R2', 10000, 'GND'],
    ]);
    expect(r.event).toMatchObject({ provider: 'groq', model: 'qwen/qwen3.8-27b', status: 'ok', usage: { inputTokens: 7, outputTokens: 3 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(r.event)).not.toContain('gsk-test-secret');
  });

  it('maps vsource -> dc_voltage', async () => {
    const g = { ...good, components: good.components.map((c) => (c.kind === 'dc_voltage' ? { ...c, kind: 'vsource' } : c)) };
    fetchMock.mockResolvedValue(ok(JSON.stringify(g)));
    const r = await extractWithGroq(new Uint8Array([1]), 'image/png');
    expect(r.extraction.graph?.components[0].kind).toBe('dc_voltage');
  });

  it('429 TPM message -> rate_limited; per-day -> quota_exhausted', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Rate limit reached for tokens per minute (TPM). Upgrade for billing', { status: 429 }));
    expect((await extractWithGroq(new Uint8Array([1]), 'image/png')).failure).toBe('rate_limited');
    fetchMock.mockResolvedValueOnce(new Response('Rate limit reached for tokens per day (TPD)', { status: 429 }));
    expect((await extractWithGroq(new Uint8Array([1]), 'image/png')).failure).toBe('quota_exhausted');
  });

  it('honours GROQ_VISION_MODEL', async () => {
    process.env.GROQ_VISION_MODEL = 'other/model';
    fetchMock.mockResolvedValue(ok(JSON.stringify(good)));
    expect((await extractWithGroq(new Uint8Array([1]), 'image/png')).event.model).toBe('other/model');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('other/model');
  });

  it.each([
    [429, 'rate_limited'],
    [404, 'model_unavailable'],
    [503, 'model_unavailable'],
    [502, 'server_error'],
    [401, 'other'],
  ])('HTTP %s -> %s', async (status, reason) => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"x"}}', { status }));
    const r = await extractWithGroq(new Uint8Array([1]), 'image/png');
    expect(r.failure).toBe(reason);
    expect(r.event.status).toBe('error');
    expect(r.event.note).toContain(String(status));
  });

  it('malformed content -> malformed_output', async () => {
    fetchMock.mockResolvedValue(ok('not json'));
    const r = await extractWithGroq(new Uint8Array([1]), 'image/png');
    expect(r.failure).toBe('malformed_output');
    expect(r.extraction.graph).toBeNull();
  });

  it('times out after 20s', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const p = extractWithGroq(new Uint8Array([1]), 'image/png');
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(r.failure).toBe('timeout');
    expect(r.event.note).toMatch(/timed out/);
  });
});
