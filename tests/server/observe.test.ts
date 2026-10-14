import { afterEach, describe, expect, it, vi } from 'vitest';
import { observe } from '@/lib/server/observe';
import { POST as SOLVE } from '@/app/api/solve/route';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://local/api/solve', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

afterEach(() => vi.restoreAllMocks());

describe('observe', () => {
  it('propagates a sane incoming x-request-id and adds it to error bodies', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await SOLVE(post({ graph: {}, userConfirmed: false }, { 'x-request-id': 'abc-123_X' }));
    expect(res.status).toBe(422);
    expect(res.headers.get('x-request-id')).toBe('abc-123_X');
    const json = await res.json();
    expect(json.error).toMatchObject({ code: 'NOT_CONFIRMED', requestId: 'abc-123_X' });
  });

  it('replaces an unsafe or oversized incoming id with a fresh uuid', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const bad of ['has space', 'x'.repeat(65), 'a;b', '../etc']) {
      const res = await SOLVE(post({}, { 'x-request-id': bad }));
      const id = res.headers.get('x-request-id')!;
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('sets the header on success responses too, leaving the body untouched', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const h = observe('/t', async () => Response.json({ result: { ok: 1 } }));
    const res = await h(new Request('http://local/t'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(await res.json()).toEqual({ result: { ok: 1 } });
  });

  it('turns a thrown handler into a generic 500 INTERNAL with no stack or message leak', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = observe('/boom', async () => {
      throw new TypeError('secret sk-live-123 at /srv/app.ts:9');
    });
    const res = await h(new Request('http://local/boom', { method: 'POST' }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/secret|sk-live|app\.ts|stack/);
    const json = JSON.parse(text);
    expect(json.error).toEqual({ code: 'INTERNAL', message: 'Internal server error', requestId: res.headers.get('x-request-id') });
    const line = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ route: '/boom', method: 'POST', status: 500, code: 'INTERNAL', error: 'TypeError' });
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/secret|sk-live/);
  });

  it('logs one metadata-only JSON line: no body content, graph or ip', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const graph = { components: [{ id: 'SECRET_R1', type: 'resistor', value: 1000, nodes: ['A', 'B'] }], groundNode: 'B' };
    const res = await SOLVE(post({ graph, userConfirmed: true, token: 'tok_SHOULD_NOT_LOG' }, { 'x-forwarded-for': '203.0.113.7' }));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const raw = logSpy.mock.calls[0][0] as string;
    expect(raw).not.toMatch(/SECRET_R1|tok_SHOULD_NOT_LOG|203\.0\.113/);
    const line = JSON.parse(raw);
    expect(Object.keys(line).sort()).toEqual(expect.arrayContaining(['method', 'ms', 'requestId', 'route', 'status', 'ts']));
    expect(line).toMatchObject({ route: '/api/solve', method: 'POST', status: res.status, requestId: res.headers.get('x-request-id') });
  });
});
