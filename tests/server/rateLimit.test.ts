import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { check, resetRateLimits } from '../../src/lib/server/rateLimit';
import { proxy } from '../../src/proxy';

const h = (ip: string, extra: Record<string, string> = {}) =>
  new Headers({ 'x-forwarded-for': `${ip}, 10.0.0.1`, ...extra });

beforeEach(resetRateLimits);

describe('rateLimit', () => {
  it('allows 6/min on extract then blocks; window resets', () => {
    const t = 1_000_000; // explicit clock = deterministic window math
    for (let i = 0; i < 6; i++) expect(check('POST', '/api/extract', h('1.1.1.1'), t)).toBeNull();
    const b = check('POST', '/api/extract', h('1.1.1.1'), t + 1000)!;
    expect(b.status).toBe(429);
    expect(b.retryAfter).toBe(59);
    expect(check('POST', '/api/extract', h('1.1.1.1'), t + 60_001)).toBeNull();
  });

  it('enforces hourly cap across minute windows', () => {
    let t = 0;
    for (let i = 0; i < 40; i++) {
      expect(check('POST', '/api/extract', h('2.2.2.2'), t)).toBeNull();
      t += 11_000; // <6 per minute, so only the hourly cap trips
    }
    expect(check('POST', '/api/extract', h('2.2.2.2'), t)!.status).toBe(429);
  });

  it('isolates IPs and ignores GET / other routes', () => {
    for (let i = 0; i < 7; i++) check('POST', '/api/extract', h('3.3.3.3'), 0);
    expect(check('POST', '/api/extract', h('4.4.4.4'), 0)).toBeNull();
    expect(check('GET', '/api/extract', h('3.3.3.3'), 0)).toBeNull();
    expect(check('POST', '/api/health', h('3.3.3.3'), 0)).toBeNull();
  });

  it('solve allows 60/min', () => {
    for (let i = 0; i < 60; i++) expect(check('POST', '/api/solve', h('5.5.5.5'), 0)).toBeNull();
    expect(check('POST', '/api/solve', h('5.5.5.5'), 0)!.code).toBe('RATE_LIMITED');
  });

  it('explain allows 10/min', () => {
    for (let i = 0; i < 10; i++) expect(check('POST', '/api/explain', h('9.9.9.9'), 0)).toBeNull();
    expect(check('POST', '/api/explain', h('9.9.9.9'), 0)!.code).toBe('RATE_LIMITED');
  });

  it('413 on large content-length', () => {
    const b = check('POST', '/api/extract', h('6.6.6.6', { 'content-length': String(7 * 1024 * 1024) }))!;
    expect(b.status).toBe(413);
    expect(b.code).toBe('TOO_LARGE');
  });
});

describe('proxy', () => {
  const req = (ip: string, headers: Record<string, string> = {}) =>
    new NextRequest('http://localhost/api/extract', { method: 'POST', headers: { 'x-forwarded-for': ip, ...headers } });

  it('returns 429 JSON with Retry-After', async () => {
    for (let i = 0; i < 6; i++) expect(proxy(req('7.7.7.7')).status).toBe(200);
    const res = proxy(req('7.7.7.7'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
  });

  it('returns 413 for oversized body', async () => {
    const res = proxy(req('8.8.8.8', { 'content-length': '9000000' }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('TOO_LARGE');
  });
});

describe('route coverage', () => {
  it('proxy matcher covers every limited route and every POST API route', async () => {
    const { config } = await import('../../src/proxy');
    const { LIMITED_ROUTES } = await import('../../src/lib/server/rateLimit');
    expect([...config.matcher].sort()).toEqual([...LIMITED_ROUTES].sort());
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, sep } = await import('node:path');
    const posts: string[] = [];
    const isPost = new RegExp('export (async )?function POST|export const POST');
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f === 'route.ts' && isPost.test(readFileSync(p, 'utf8'))) posts.push(d.split(sep).join('/').replace('src/app', ''));
      }
    };
    walk('src/app/api');
    expect(posts.filter((r) => !LIMITED_ROUTES.includes(r))).toEqual([]);
  });
  it('limits /api/review at 10/min', () => {
    resetRateLimits();
    const h = new Headers({ 'x-forwarded-for': '9.9.9.9' });
    for (let i = 0; i < 10; i++) expect(check('POST', '/api/review', h)).toBeNull();
    expect(check('POST', '/api/review', h)?.status).toBe(429);
  });
});
