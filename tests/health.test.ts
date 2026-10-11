import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../src/app/api/health/route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('returns ok with defaults and nothing configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('BEATAPI_API_KEY', '');
    const j = await GET().json();
    expect(j.status).toBe('ok');
    expect(j.providers.gemini).toEqual({ configured: false, model: 'gemini-3.5-flash' });
    expect(j.providers.groq.model).toBe('qwen/qwen3.8-27b');
    expect(j.providers.jev.model).toBe('jev-1.13-free');
  });

  it('shows configured flags and never leaks key values', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'SECRET-gem-123');
    vi.stubEnv('BEATAPI_API_KEY', 'SECRET-bea-456');
    const text = JSON.stringify(await GET().json());
    expect(text).not.toContain('SECRET');
    const j = JSON.parse(text);
    expect(j.providers.gemini.configured).toBe(true);
    expect(j.providers.jev.configured).toBe(true);
  });
});
