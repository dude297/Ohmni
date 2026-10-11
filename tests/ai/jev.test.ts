import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetJevPacing, routeExtraction } from '@/lib/ai/jev';

const input = {
  extraction: { inputKind: 'schematic' as const, graph: null, warnings: [], unresolvedConnections: ['R1?'], requiresHumanReview: true as const },
  validationErrors: [],
};
const ok = (body: unknown) => vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
const choice = (c: string) => ({ answers: { route: { type: 'choice', choice: c, confidence: 0.9 } } });

beforeEach(() => {
  __resetJevPacing();
  vi.stubEnv('BEATAPI_API_KEY', 'k');
  vi.stubEnv('BEATAPI_JEV_MODEL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('routeExtraction', () => {
  it('calls BeatAPI free Jev and parses choice, confidence, usage', async () => {
    const f = ok({
      answers: { route: { type: 'choice', choice: 'verify_topology', confidence: 0.8, probabilities: { verify_topology: 0.8, ask_user: 0.2 } } },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('verify_topology');
    expect(r.event).toMatchObject({ provider: 'beatapi', model: 'jev-1.13-free', status: 'ok', confidence: 0.8, usage: { inputTokens: 10, outputTokens: 2 } });
    expect(f.mock.calls[0][0]).toBe('https://api.beatapi.io/v1/systemone');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(f.mock.calls[0][1].body).model).toBe('jev-1.13-free');
  });

  it('refuses a paid model id without calling the API', async () => {
    vi.stubEnv('BEATAPI_JEV_MODEL', 'jev-1.13');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event).toMatchObject({ status: 'skipped', model: 'jev-1.13' });
    expect(f).not.toHaveBeenCalled();
  });

  it('malformed response -> ask_user error', async () => {
    vi.stubGlobal('fetch', ok({ answers: { route: { choice: 'bogus' } } }));
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.status).toBe('error');
    expect(r.event.confidence).toBeUndefined();
  });

  it('missing key -> ask_user skipped, no fetch', async () => {
    vi.stubEnv('BEATAPI_API_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.status).toBe('skipped');
    expect(f).not.toHaveBeenCalled();
  });

  it('paces: second call within the free-tier minute is skipped, not sent', async () => {
    const f = ok(choice('review_extraction'));
    vi.stubGlobal('fetch', f);
    expect((await routeExtraction(input)).route).toBe('review_extraction');
    const second = await routeExtraction(input);
    expect(second.route).toBe('ask_user');
    expect(second.event.status).toBe('skipped');
    expect(second.event.note).toMatch(/pacing/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429 honours Retry-After and blocks calls until then', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '42' } }));
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.status).toBe('error');
    expect(r.event.note).toMatch(/429.*42s/);
    const again = await routeExtraction(input);
    expect(again.event.status).toBe('skipped');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('waits briefly when the next slot is within a few seconds', async () => {
    vi.useFakeTimers();
    const f = ok(choice('review_extraction'));
    vi.stubGlobal('fetch', f);
    await routeExtraction(input);
    vi.advanceTimersByTime(55_000);
    const p = routeExtraction(input);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).event.status).toBe('ok');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('timeout -> ask_user error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError')));
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.note).toMatch(/timed out/);
  });
});
