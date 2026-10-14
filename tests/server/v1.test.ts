import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as listWorkspaces } from '@/app/api/v1/workspaces/route';
import { GET as getInvestigation } from '@/app/api/v1/investigations/[id]/route';
import { check, limitKey, LIMITED_ROUTES, resetRateLimits } from '@/lib/server/rateLimit';
import { tierOf } from '@/lib/features';

// Network-free checks of the persistence API plumbing. The live flow + tenant isolation is scripts/persistence-e2e.mjs.
const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://x${path}`, { headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => vi.unstubAllEnvs());

describe('/api/v1 persistence API', () => {
  it('503 PERSISTENCE_DISABLED when Supabase is not configured (production default)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    const r = await listWorkspaces(req('/api/v1/workspaces', { authorization: `Bearer ${'a'.repeat(40)}` }));
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.error.code).toBe('PERSISTENCE_DISABLED');
    expect(j.error.requestId).toBe(r.headers.get('x-request-id'));
  });

  it('401 without a well-formed bearer token, before any network call', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    for (const authorization of [undefined, 'Bearer short', 'Basic abc', `Bearer ${'a'.repeat(30)} x`]) {
      const r = await listWorkspaces(req('/api/v1/workspaces', authorization ? { authorization } : {}));
      expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('an unconfigured deployment answers 503 on every v1 route, whatever the path id', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    const r = await getInvestigation(req('/api/v1/investigations/not-a-uuid'), ctx('not-a-uuid'));
    expect(r.status).toBe(503);
  });

  it('all /api/v1/* paths share one rate-limit rule and are tiered experimental', () => {
    expect(limitKey('/api/v1/investigations/0b4c6a1e-0000-4000-a000-000000000001/measurements')).toBe('/api/v1');
    expect(LIMITED_ROUTES).toContain('/api/v1');
    expect(tierOf('/api/v1/projects')).toBe('experimental');
    resetRateLimits();
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9' });
    let blocked = null;
    for (let i = 0; i < 121 && !blocked; i++) blocked = check('POST', `/api/v1/investigations/${i}/measurements`, h);
    expect(blocked?.status).toBe(429);
    expect(check('GET', '/api/v1/workspaces', h)).toBeNull(); // reads are not rate limited
  });
});
