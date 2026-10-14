import { describe, expect, it, vi } from 'vitest';

const pending: (() => void)[] = [];
vi.mock('@/lib/ac/analysis', () => ({ analyze: vi.fn(() => new Promise((r) => pending.push(() => r({ ok: true })))) }));
vi.mock('@/lib/ac/types', async (orig) => ({ ...(await orig<typeof import('@/lib/ac/types')>()), validateAcGraph: () => [] }));

import { POST } from '@/app/api/ac/route';

const call = (ip: string) =>
  POST(new Request('http://x/api/ac', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ graph: {}, userConfirmed: true }) }));
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('/api/ac per-client concurrency', () => {
  it('rejects a second concurrent analysis from the same client, allows others, and frees the slot after', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const first = call('203.0.113.5');
    await tick();
    const second = await call('203.0.113.5');
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe('BUSY');
    const other = call('203.0.113.6'); // a different client is not blocked by this guard
    await tick();
    expect(pending).toHaveLength(2);
    pending.splice(0).forEach((done) => done());
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
    const again = call('203.0.113.5'); // slot freed after completion
    await tick();
    pending.splice(0).forEach((done) => done());
    expect((await again).status).toBe(200);
  });
});
