import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { disabledTiers, tierOf } from '../../src/lib/features';
import { proxy } from '../../src/proxy';
import { resetRateLimits } from '../../src/lib/server/rateLimit';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetRateLimits();
});

describe('tierOf', () => {
  it('matches by path segment, longest prefix', () => {
    expect(tierOf('/api/probe')).toBe('core');
    expect(tierOf('/api/probe-multi')).toBe('experimental');
    expect(tierOf('/api/repair/verify')).toBe('core');
    expect(tierOf('/api/firmware/adc')).toBe('experimental');
    expect(tierOf('/for-the-larp/voice-lab')).toBe('demo');
    expect(tierOf('/studio')).toBe('experimental');
    expect(tierOf('/studios')).toBeNull();
    expect(tierOf('/')).toBeNull();
  });

  it('parses disabled tiers; core can never be disabled', () => {
    expect([...disabledTiers({})]).toEqual([]);
    expect([...disabledTiers({ OHMNI_DISABLED_TIERS: 'demo, experimental,core' })].sort()).toEqual(['demo', 'experimental']);
    expect([...disabledTiers({ OHMNI_EXPERIMENTAL: 'off' })]).toEqual(['experimental']);
  });
});

describe('proxy tier gating', () => {
  const req = (path: string, method = 'GET') => new NextRequest(`http://localhost${path}`, { method, headers: { 'x-forwarded-for': '9.9.9.9' } });

  it('tags responses and serves everything when nothing is disabled', async () => {
    delete process.env.OHMNI_DISABLED_TIERS;
    delete process.env.OHMNI_EXPERIMENTAL;
    const r = (await proxy(req('/twin')));
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ohmni-tier')).toBe('experimental');
    expect((await proxy(req('/'))).headers.get('x-ohmni-tier')).toBeNull();
  });

  it('404s disabled API routes with FEATURE_DISABLED JSON and disabled pages with plain 404', async () => {
    process.env.OHMNI_DISABLED_TIERS = 'experimental';
    const api = (await proxy(req('/api/twin', 'POST')));
    expect(api.status).toBe(404);
    expect((await api.json()).error.code).toBe('FEATURE_DISABLED');
    expect((await proxy(req('/studio'))).status).toBe(404);
    expect((await proxy(req('/api/solve', 'POST'))).status).toBe(200);
    expect((await proxy(req('/learn'))).status).toBe(200);
  });

  it('keeps rate limiting on core routes and tags the 429', async () => {
    for (let i = 0; i < 6; i++) (await proxy(req('/api/extract', 'POST')));
    const r = (await proxy(req('/api/extract', 'POST')));
    expect(r.status).toBe(429);
    expect(r.headers.get('x-ohmni-tier')).toBe('core');
  });
});
