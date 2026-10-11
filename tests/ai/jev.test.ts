import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeExtraction } from '@/lib/ai/jev';

const input = {
  extraction: { inputKind: 'schematic' as const, graph: null, warnings: [], unresolvedConnections: ['R1?'], requiresHumanReview: true as const },
  validationErrors: [],
};
const ok = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('routeExtraction', () => {
  it('parses choice and confidence', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'k');
    const f = ok({
      answers: { route: { type: 'choice', choice: 'verify_topology', confidence: 0.8, probabilities: { verify_topology: 0.8, ask_user: 0.2 } } },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('verify_topology');
    expect(r.event).toMatchObject({ status: 'ok', confidence: 0.8, usage: { inputTokens: 10, outputTokens: 2 } });
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
  });

  it('malformed response -> ask_user error', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'k');
    vi.stubGlobal('fetch', ok({ answers: { route: { choice: 'bogus' } } }));
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.status).toBe('error');
    expect(r.event.confidence).toBeUndefined();
  });

  it('missing key -> ask_user skipped, no fetch', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.status).toBe('skipped');
    expect(f).not.toHaveBeenCalled();
  });

  it('timeout -> ask_user error', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError')));
    const r = await routeExtraction(input);
    expect(r.route).toBe('ask_user');
    expect(r.event.note).toMatch(/timed out/);
  });
});
