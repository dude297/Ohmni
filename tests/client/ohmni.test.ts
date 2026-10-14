import { describe, expect, it, vi } from 'vitest';
import { createOhmniApi, OhmniApiError } from '@/lib/client/ohmni';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('browser API client', () => {
  it('sends the bearer token and JSON body to /api/v1', async () => {
    const f = vi.fn(async () => json(200, { measurement: { id: 'm' }, probe: { done: false } }));
    const api = createOhmniApi(async () => 'tok', f as unknown as typeof fetch);
    const r = await api.investigations.measure('inv 1', { node: 'C', volts: 0, method: 'typed' });
    expect(r.probe.done).toBe(false);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/investigations/inv%201/measurements');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ node: 'C', volts: 0, method: 'typed' });
  });

  it('throws a typed error with code and requestId', async () => {
    const api = createOhmniApi(async () => 'tok', (async () => json(409, { error: { code: 'LAST_OWNER', message: 'needs an owner', requestId: 'r1' } })) as unknown as typeof fetch);
    await expect(api.members.remove('w', 'u')).rejects.toMatchObject({ status: 409, code: 'LAST_OWNER', requestId: 'r1' });
  });

  it('refuses to call without a session', async () => {
    const f = vi.fn();
    const api = createOhmniApi(async () => null, f as unknown as typeof fetch);
    await expect(api.workspaces.list()).rejects.toBeInstanceOf(OhmniApiError);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns markdown reports as text', async () => {
    const api = createOhmniApi(async () => 'tok', (async () => new Response('# Report', { headers: { 'content-type': 'text/markdown; charset=utf-8' } })) as unknown as typeof fetch);
    expect(await api.investigations.reportMarkdown('i')).toBe('# Report');
  });
});
