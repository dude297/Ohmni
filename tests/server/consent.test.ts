import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/vision', () => ({ extractWithFallback: vi.fn() }));
vi.mock('@/lib/ai/jev', () => ({ routeExtraction: vi.fn() }));
vi.mock('@/lib/ai/secondary', () => ({ verifyTopology: vi.fn() }));

import { POST as extract } from '@/app/api/extract/route';
import { POST as explain } from '@/app/api/explain/route';
import { POST as review } from '@/app/api/review/route';
import { extractWithFallback } from '@/lib/ai/vision';
import { routeExtraction } from '@/lib/ai/jev';
import { reviewCircuit } from '@/lib/review';
import { DIVIDER_10K_10K, DIVIDER_10K_1K } from '@/lib/circuit/fixtures';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const postImage = (consent?: string) => {
  const fd = new FormData();
  fd.set('image', new File([new Uint8Array(PNG)], 'a.png', { type: 'image/png' }));
  if (consent !== undefined) fd.set('aiConsent', consent);
  return extract(new Request('http://x/api/extract', { method: 'POST', body: fd }));
};
const postJson = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GEMINI_API_KEY', ''); // never reach a real model from these tests
  vi.mocked(extractWithFallback).mockResolvedValue({
    extraction: { inputKind: 'schematic', graph: null, warnings: [], unresolvedConnections: [], requiresHumanReview: true },
    events: [{ step: 'extract', provider: 'google', durationMs: 1, status: 'ok' }],
    ok: true,
  } as never);
  vi.mocked(routeExtraction).mockResolvedValue({
    route: 'review_extraction',
    event: { step: 'route', provider: 'beatapi', durationMs: 1, status: 'ok', chosenRoute: 'review_extraction' },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('AI consent gate', () => {
  it('unset: extract works without consent (current behaviour)', async () => {
    vi.stubEnv('REQUIRE_AI_CONSENT', '');
    expect((await postImage()).status).toBe(200);
    expect(extractWithFallback).toHaveBeenCalledOnce();
  });

  it('enforced: extract without consent is 422 CONSENT_REQUIRED and no provider is called', async () => {
    vi.stubEnv('REQUIRE_AI_CONSENT', '1');
    for (const c of [undefined, 'false', '1']) {
      const r = await postImage(c);
      expect(r.status).toBe(422);
      expect((await r.json()).error.code).toBe('CONSENT_REQUIRED');
    }
    expect(extractWithFallback).not.toHaveBeenCalled();
  });

  it('enforced: extract with aiConsent=true passes the gate', async () => {
    vi.stubEnv('REQUIRE_AI_CONSENT', '1');
    const r = await postImage('true');
    expect(r.status).toBe(200);
    expect((await r.json()).route).toBe('review_extraction');
  });

  it('enforced: explain needs aiConsent: true', async () => {
    vi.stubEnv('REQUIRE_AI_CONSENT', '1');
    const base = { graph: DIVIDER_10K_10K, userConfirmed: true };
    const r = await postJson(explain, base);
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('CONSENT_REQUIRED');
    expect((await postJson(explain, { ...base, aiConsent: 'true' })).status).toBe(422); // JSON must be boolean true
    expect((await postJson(explain, { ...base, aiConsent: true })).status).toBe(200);
  });

  it('enforced: review gates only the mentor (model) call', async () => {
    vi.stubEnv('REQUIRE_AI_CONSENT', '1');
    const findingId = reviewCircuit(DIVIDER_10K_1K, { intended: DIVIDER_10K_10K }).findings[0].id;
    const base = { graph: DIVIDER_10K_1K, intended: DIVIDER_10K_10K, userConfirmed: true };
    expect((await postJson(review, base)).status).toBe(200);
    const mentor = { findingId, level: 'beginner', mode: 'hint', hintIndex: 0 };
    const r = await postJson(review, { ...base, mentor });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('CONSENT_REQUIRED');
    expect((await postJson(review, { ...base, mentor, aiConsent: true })).status).toBe(200);
  });
});
