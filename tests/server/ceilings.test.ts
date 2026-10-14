import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, validateGraph } from '../../src/lib/circuit/validate';
import { __setTrustedIpHeader, check, clientIp, resetRateLimits, trackedKeys } from '../../src/lib/server/rateLimit';
import { readJson, sniffImage } from '../../src/lib/server/readBody';
import { analyze } from '../../src/lib/ac/analysis';
import { rcLowpass } from '../ac/fixtures';
import { POST as probePOST } from '../../src/app/api/probe/route';
import { POST as probeMultiPOST } from '../../src/app/api/probe-multi/route';
import { POST as twinPOST } from '../../src/app/api/twin/route';
import { POST as extractPOST } from '../../src/app/api/extract/route';

beforeEach(() => {
  resetRateLimits();
  __setTrustedIpHeader('x-vercel-forwarded-for');
});

/** N0 source -> n-1 series resistors -> GND. */
const chain = (n: number) => {
  const components: unknown[] = [{ id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'N0', negativeNode: 'GND' }];
  for (let i = 1; i < n; i++)
    components.push({ id: `R${i}`, kind: 'resistor', value: 1000, positiveNode: `N${i - 1}`, negativeNode: i === n - 1 ? 'GND' : `N${i}` });
  return { schemaVersion: 1, components, groundNode: 'GND', measureNode: `N${Math.max(1, n - 2)}` };
};
const json = (url: string, body: string) =>
  new Request(`http://x${url}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
const stream = (chunks: number, size: number) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i++ >= chunks) return c.close();
      c.enqueue(new Uint8Array(size).fill(32));
    },
  });
};
const streamReq = (url: string, chunks: number, size: number, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { method: 'POST', body: stream(chunks, size), headers, duplex: 'half' } as RequestInit);

describe('graph ceilings', () => {
  it('accepts exactly MAX_COMPONENTS and rejects one more with a clear message', () => {
    expect(validateGraph(chain(MAX_COMPONENTS)).ok).toBe(true);
    const r = validateGraph(chain(MAX_COMPONENTS + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain(`at most ${MAX_COMPONENTS} components`);
  });
  it('rejects long or odd names', () => {
    const g = chain(3) as { components: { id: string }[] };
    g.components[1].id = 'R'.repeat(33);
    expect(validateGraph(g).ok).toBe(false);
    g.components[1].id = 'R 1;drop';
    expect(validateGraph(g).ok).toBe(false);
  });
  it('POST /api/probe: 400-resistor graph -> 422, fast', async () => {
    const t = performance.now();
    const res = await probePOST(json('/api/probe', JSON.stringify({ graph: chain(400), userConfirmed: true, observations: [] })));
    expect(res.status).toBe(422);
    expect(performance.now() - t).toBeLessThan(1500);
  });
  it('probe at the cap stays fast (local ~140 ms; generous CI bound)', async () => {
    const body = JSON.stringify({ graph: chain(MAX_COMPONENTS), userConfirmed: true, observations: [] });
    const t = performance.now();
    const res = await probePOST(json('/api/probe', body));
    const ms = performance.now() - t;
    console.log(`probe @${MAX_COMPONENTS} components: ${ms.toFixed(1)} ms`);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(1500);
  });
  it('probe-multi at the cap falls back (pair ceiling) and stays fast', async () => {
    const t = performance.now();
    const res = await probeMultiPOST(json('/api/probe-multi', JSON.stringify({ graph: chain(MAX_COMPONENTS), userConfirmed: true })));
    const ms = performance.now() - t;
    console.log(`probe-multi @${MAX_COMPONENTS} components: ${ms.toFixed(1)} ms`);
    expect(res.status).toBe(200);
    expect(JSON.stringify((await res.json()).result.warnings)).toContain('cap');
    expect(ms).toBeLessThan(2000);
  });
  it('twin rejects an oversized observed graph and an oversized netlist', async () => {
    const small = chain(4);
    const prov = { kind: 'manual' };
    let res = await twinPOST(json('/api/twin', JSON.stringify({ intended: small, observed: chain(400), observedProvenance: prov, userConfirmed: true })));
    expect(res.status).toBe(422);
    const lines = ['V1 N0 0 5', ...Array.from({ length: 200 }, (_, i) => `R${i} N${i} N${i + 1} 1k`), 'R999 N200 0 1k'];
    res = await twinPOST(json('/api/twin', JSON.stringify({ intended: { netlist: lines.join('\n') }, observed: small, observedProvenance: prov, userConfirmed: true })));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('components');
  });
});

describe('bounded body reader', () => {
  it('413 for an oversized chunked body with no Content-Length', async () => {
    const req = streamReq('/api/probe', 20, 64 * 1024);
    expect(req.headers.get('content-length')).toBeNull();
    const res = await probePOST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('TOO_LARGE');
  });
  it('413 when Content-Length lies low', async () => {
    expect((await probePOST(streamReq('/api/probe', 20, 64 * 1024, { 'content-length': '10' }))).status).toBe(413);
  });
  it('400 BAD_JSON on malformed body; readJson parses valid', async () => {
    expect((await probePOST(json('/api/probe', '{nope'))).status).toBe(400);
    expect(await readJson(json('/x', '{"a":1}'))).toEqual({ a: 1 });
  });
  it('extract: chunked >6 MB multipart -> 413', async () => {
    const req = streamReq('/api/extract', 7, 1024 * 1024, { 'content-type': 'multipart/form-data; boundary=b' });
    expect((await extractPOST(req)).status).toBe(413);
  });
  it('sniff: real PNG/JPEG/WebP pass, text named .png is rejected with 415', async () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBP'))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('hello world, not an image'))).toBeNull();
    const fd = new FormData();
    fd.set('image', new File(['<html>not a png</html>'], 'x.png', { type: 'image/png' }));
    const res = await extractPOST(new Request('http://x/api/extract', { method: 'POST', body: fd }));
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('UNSUPPORTED_MEDIA');
  });
});

describe('limiter hardening', () => {
  it('spoofed leading X-Forwarded-For hops no longer bypass the limit', () => {
    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      const h = new Headers({ 'x-forwarded-for': `9.9.${i}.1, 203.0.113.7` }); // real client = last hop
      if (check('POST', '/api/solve', h, 0)) blocked++;
    }
    expect(blocked).toBe(40); // 60/min allowed
  });
  it('platform header wins over XFF; no headers -> shared "unknown" bucket', () => {
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '6.6.6.6' }))).toBe('1.2.3.4');
    __setTrustedIpHeader('x-real-ip');
    expect(clientIp(new Headers({ 'x-real-ip': '5.5.5.5' }))).toBe('5.5.5.5');
    // a header from another platform is NOT trusted on this host
    __setTrustedIpHeader('x-nf-client-connection-ip');
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': '9.9.9.9, 7.7.7.7' }))).toBe('7.7.7.7');
    __setTrustedIpHeader('x-vercel-forwarded-for');
    expect(clientIp(new Headers())).toBe('unknown');
  });
  it('map stays bounded under 50k unique keys (generous CI bound)', () => {
    const hs = Array.from({ length: 50_000 }, (_, i) => new Headers({ 'x-vercel-forwarded-for': `ip-${i}` })); // built outside the timer
    for (const h of hs.slice(0, 5000)) check('POST', '/api/solve', h, 0); // JIT warm-up
    resetRateLimits();
    const t = performance.now();
    for (const h of hs) check('POST', '/api/solve', h, 0);
    const ms = performance.now() - t;
    console.log(`50k unique keys: ${ms.toFixed(1)} ms, tracked=${trackedKeys()}`);
    expect(trackedKeys()).toBeLessThanOrEqual(10_000);
    expect(ms).toBeLessThan(1500);
  });
  it('global model budget: 30/min across clients on model routes only', () => {
    for (let i = 0; i < 30; i++) expect(check('POST', '/api/explain', new Headers({ 'x-vercel-forwarded-for': `c${i}` }), 0)).toBeNull();
    const fresh = new Headers({ 'x-vercel-forwarded-for': 'fresh' });
    const b = check('POST', '/api/explain', fresh, 0)!;
    expect(b.status).toBe(429);
    expect(b.code).toBe('MODEL_BUDGET');
    expect(check('POST', '/api/solve', fresh, 0)).toBeNull();
    expect(check('POST', '/api/explain', fresh, 60_001)).toBeNull();
  });
});

describe('AC analysis deadline', () => {
  it('throws TIMEOUT when the overall budget is exhausted', async () => {
    await expect(analyze(rcLowpass(), { deadlineMs: -1 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
