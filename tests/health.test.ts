import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    expect((await GET().json()).status).toBe('ok');
  });
});
