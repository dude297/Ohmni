// ponytail: in-memory per instance (each serverless instance counts separately); upgrade path = Vercel KV/Upstash if abused.
const num = (k: string, d: number) => Number(process.env[k]) || d;

const MAX_BODY = 6 * 1024 * 1024;

type Rule = { name: string; max: number; windowMs: number };
const rules = (pathname: string): Rule[] =>
  pathname === '/api/extract'
    ? [
        { name: 'extract-min', max: num('RATE_EXTRACT_PER_MIN', 6), windowMs: 60_000 },
        { name: 'extract-hour', max: num('RATE_EXTRACT_PER_HOUR', 40), windowMs: 3_600_000 },
      ]
    : pathname === '/api/solve'
      ? [{ name: 'solve-min', max: num('RATE_SOLVE_PER_MIN', 60), windowMs: 60_000 }]
      : pathname === '/api/explain'
        ? [{ name: 'explain-min', max: num('RATE_EXPLAIN_PER_MIN', 10), windowMs: 60_000 }]
        : [];

const hits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export type Block = { status: 429 | 413; code: 'RATE_LIMITED' | 'TOO_LARGE'; message: string; retryAfter?: number };

/** Returns a Block if the request must be rejected, else null. Only POST /api/extract, /api/solve and /api/explain are guarded. */
export function check(method: string, pathname: string, headers: Headers, now = Date.now()): Block | null {
  if (method !== 'POST') return null;
  const rs = rules(pathname);
  if (!rs.length) return null;
  if (pathname === '/api/extract' && Number(headers.get('content-length')) > MAX_BODY) {
    return { status: 413, code: 'TOO_LARGE', message: 'Image too large — please upload a file under 6 MB.' };
  }
  const ip = clientIp(headers);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  let retry = 0;
  for (const r of rs) {
    const key = `${r.name}:${ip}`;
    let e = hits.get(key);
    if (!e || e.resetAt <= now) hits.set(key, (e = { count: 0, resetAt: now + r.windowMs }));
    if (++e.count > r.max) retry = Math.max(retry, Math.ceil((e.resetAt - now) / 1000));
  }
  if (!retry) return null;
  return {
    status: 429,
    code: 'RATE_LIMITED',
    message: `Too many requests — this public demo protects free model quotas. Try again in ${retry}s.`,
    retryAfter: retry,
  };
}

export function resetRateLimits() {
  hits.clear();
}
