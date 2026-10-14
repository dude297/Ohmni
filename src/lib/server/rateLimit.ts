// ponytail: in-memory per instance (each serverless instance counts separately); upgrade path = Vercel KV/Upstash if abused.
// Env limits are read once per process (process.env access is slow on the hot path); restart to change.
const envCache = new Map<string, number>();
const num = (k: string, d: number) => {
  let v = envCache.get(k);
  if (v === undefined) envCache.set(k, (v = Number(process.env[k]) || d));
  return v;
};

const MAX_BODY = 6 * 1024 * 1024;

type Rule = { name: string; max: number; windowMs: number };
const perMin = (name: string, env: string, d: number): Rule[] => [{ name, max: num(env, d), windowMs: 60_000 }];
const RULES: Record<string, () => Rule[]> = {
  '/api/extract': () => [
    { name: 'extract-min', max: num('RATE_EXTRACT_PER_MIN', 6), windowMs: 60_000 },
    { name: 'extract-hour', max: num('RATE_EXTRACT_PER_HOUR', 40), windowMs: 3_600_000 },
  ],
  '/api/solve': () => perMin('solve-min', 'RATE_SOLVE_PER_MIN', 60),
  '/api/explain': () => perMin('explain-min', 'RATE_EXPLAIN_PER_MIN', 10),
  // model call (free-tier quota)
  '/api/review': () => perMin('review-min', 'RATE_REVIEW_PER_MIN', 10),
  // ngspice in a worker: CPU-heavy
  '/api/ac': () => perMin('ac-min', 'RATE_AC_PER_MIN', 20),
  // local deterministic engines
  '/api/probe': () => perMin('probe-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/probe-multi': () => perMin('probe-multi-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/topology': () => perMin('topology-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/repair': () => perMin('repair-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/repair/verify': () => perMin('repair-verify-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/twin': () => perMin('twin-min', 'RATE_LOCAL_PER_MIN', 60),
  '/api/firmware/adc': () => perMin('adc-min', 'RATE_LOCAL_PER_MIN', 60),
  // persistence API: every /api/v1/* path shares one rule, so ids in the path cannot grow the rule cache
  '/api/v1': () => perMin('v1-min', 'RATE_PERSIST_PER_MIN', 120),
};
export const LIMITED_ROUTES = Object.keys(RULES);
const ruleCache = new Map<string, Rule[]>();
/** Rule key for a request path: /api/v1/* collapses to '/api/v1'. */
export const limitKey = (pathname: string) => (pathname.startsWith('/api/v1/') ? '/api/v1' : pathname);
const rules = (path: string): Rule[] => {
  const pathname = limitKey(path);
  let r = ruleCache.get(pathname);
  if (!r) ruleCache.set(pathname, (r = RULES[pathname]?.() ?? []));
  return r;
};

type Entry = { count: number; resetAt: number };
// Two-generation store: O(1) get/set, hard cap of MAX_ENTRIES total. When the current generation fills, it becomes "old" and the
// previous old one is dropped wholesale (Map.keys().next() eviction is O(n) in V8 after many deletes). ponytail: a flood of unique
// real IPs can age out counters early; shared store (KV/Upstash) is the real fix.
const MAX_ENTRIES = 10_000;
class Store {
  cur = new Map<string, Entry>();
  old = new Map<string, Entry>();
  get(k: string) {
    return this.cur.get(k) ?? this.old.get(k);
  }
  set(k: string, e: Entry) {
    if (!this.cur.has(k) && this.cur.size >= MAX_ENTRIES / 2) {
      this.old = this.cur;
      this.cur = new Map();
    }
    this.cur.set(k, e);
  }
  get size() {
    return this.cur.size + this.old.size;
  }
  clear() {
    this.cur.clear();
    this.old.clear();
  }
}
const hits = new Store();
// Model-calling routes also share one budget across ALL clients on this instance (free-tier quota protection).
const MODEL_ROUTES = new Set(['/api/extract', '/api/explain', '/api/review']);
const modelHits = new Store();


/**
 * Trusted client IP. Only the header that THIS host's edge sets/overwrites is trusted: a fixed list would let a client
 * on Netlify send its own x-vercel-forwarded-for (and vice versa). Otherwise the Nth-from-last X-Forwarded-For hop
 * (TRUSTED_PROXY_HOPS, default 1); the first hop is client-supplied and spoofable.
 */
let trusted: string | null | undefined;
const trustedHeader = () =>
  trusted !== undefined
    ? trusted
    : (trusted =
        process.env.TRUSTED_IP_HEADER?.toLowerCase() ||
        (process.env.VERCEL ? 'x-vercel-forwarded-for' : process.env.NETLIFY ? 'x-nf-client-connection-ip' : null));
/** Test hook: override the detected platform header (null = none, undefined = re-detect from env). */
export function __setTrustedIpHeader(h: string | null | undefined) {
  trusted = h;
}

export function clientIp(h: Headers): string {
  const name = trustedHeader();
  const platform = name ? h.get(name)?.trim() : undefined;
  if (platform) return platform.split(',')[0].trim();
  const hops = h.get('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
  const n = Math.max(1, Math.floor(num('TRUSTED_PROXY_HOPS', 1)));
  return hops.length ? hops[Math.max(0, hops.length - n)] : 'unknown';
}

export type Block = {
  status: 429 | 413;
  code: 'RATE_LIMITED' | 'TOO_LARGE' | 'MODEL_BUDGET';
  message: string;
  retryAfter?: number;
};

/** Fixed-window counter; returns seconds to wait if over max, else 0. O(1); the store is hard-capped. */
function bump(m: Store, key: string, max: number, windowMs: number, now: number): number {
  let e = m.get(key);
  if (!e || e.resetAt <= now) {
    m.set(key, (e = { count: 0, resetAt: now + windowMs }));
  }
  return ++e.count > max ? Math.ceil((e.resetAt - now) / 1000) : 0;
}

/** Returns a Block if the request must be rejected, else null. Only POSTs to LIMITED_ROUTES are guarded. */
export function check(method: string, pathname: string, headers: Headers, now = Date.now()): Block | null {
  if (method !== 'POST') return null;
  const rs = rules(pathname);
  if (!rs.length) return null;
  if (pathname === '/api/extract' && Number(headers.get('content-length')) > MAX_BODY) {
    return { status: 413, code: 'TOO_LARGE', message: 'Image too large — please upload a file under 6 MB.' };
  }
  const ip = clientIp(headers);
  let retry = 0;
  for (const r of rs) retry = Math.max(retry, bump(hits, `${r.name}:${ip}`, r.max, r.windowMs, now));
  if (retry)
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message: `Too many requests — this public demo protects free model quotas. Try again in ${retry}s.`,
      retryAfter: retry,
    };
  if (MODEL_ROUTES.has(pathname)) {
    const g = bump(modelHits, pathname, num('RATE_MODEL_GLOBAL_PER_MIN', 30), 60_000, now);
    if (g)
      return { status: 429, code: 'MODEL_BUDGET', message: `The shared model budget is used up for now. Try again in ${g}s.`, retryAfter: g };
  }
  return null;
}

/** Test hook: number of tracked keys. */
export const trackedKeys = () => hits.size;

/** For the shared (cross-instance) limiter: same rules, same budget, same client-IP logic. */
export const sharedRules = (pathname: string) => (MODEL_ROUTES.has(pathname) ? rules(pathname) : []);
export const modelBudgetPerMin = () => num('RATE_MODEL_GLOBAL_PER_MIN', 30);

export function resetRateLimits() {
  hits.clear();
  modelHits.clear();
}
