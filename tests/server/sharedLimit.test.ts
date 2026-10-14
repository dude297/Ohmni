import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkShared } from '@/lib/server/sharedLimit';

const h = new Headers({ 'x-forwarded-for': '198.51.100.7' });
afterEach(() => vi.unstubAllEnvs());

describe('shared (cross-instance) limiter', () => {
  it('is inert without Supabase, for non-model routes, for GETs and when switched off', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    expect(await checkShared('POST', '/api/extract', h)).toBeNull();
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_ANON_KEY', 'a');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's');
    expect(await checkShared('POST', '/api/solve', h)).toBeNull();
    expect(await checkShared('GET', '/api/extract', h)).toBeNull();
    vi.stubEnv('RATE_SHARED', 'off');
    expect(await checkShared('POST', '/api/extract', h)).toBeNull();
  });

  it('fails open when the database is unreachable', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_ANON_KEY', 'a');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = Date.now();
    expect(await checkShared('POST', '/api/explain', h)).toBeNull();
    expect(Date.now() - t).toBeLessThan(2500);
    expect(log.mock.calls.some(([l]) => String(l).includes('shared_rate_limit_unavailable') && !String(l).includes('198.51.100.7'))).toBe(true);
    log.mockRestore();
  });

  it('a shared-limit 429 inside observe() carries Retry-After and error.requestId', async () => {
    const { observe } = await import('@/lib/server/observe');
    const { sharedLimited } = await import('@/lib/server/sharedLimit');
    const blocked = async () => ({ status: 429 as const, code: 'RATE_LIMITED' as const, message: 'slow down', retryAfter: 7 });
    const route = observe('/api/explain', sharedLimited('/api/explain', async () => new Response('never'), blocked));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await route(new Request('http://x/api/explain', { method: 'POST' }));
    log.mockRestore();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('7');
    expect((await r.json()).error.requestId).toBe(r.headers.get('x-request-id'));
  });
});
