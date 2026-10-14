import { createHash } from 'node:crypto';
import { adminDb, persistenceConfigured } from './supabase';
import { clientIp, modelBudgetPerMin, sharedRules, type Block } from './rateLimit';

// Cross-instance limits for model-calling routes, backed by public.rate_hit (Postgres, service role).
// The in-memory limiter still runs first (src/proxy.ts); this adds the counts other serverless instances see.
// Applied per route via sharedLimited() so the proxy stays synchronous.
// Fails OPEN (returns null) when Supabase is not configured, RATE_SHARED=off, or the call errors/takes > 1.5 s:
// the in-memory limits and the per-instance model budget still apply, so a database hiccup never takes the app down.
const TIMEOUT_MS = 1500;
const ipKey = (ip: string) => createHash('sha256').update(`${process.env.RATE_SALT ?? 'ohmni'}:${ip}`).digest('hex').slice(0, 24);

async function hit(key: string, windowS: number, max: number): Promise<number> {
  const { data, error } = await adminDb().rpc('rate_hit', { p_key: key, p_window_s: windowS, p_max: max });
  if (error) throw new Error('rate_hit failed');
  return Number(data) || 0;
}

export async function checkShared(method: string, pathname: string, headers: Headers): Promise<Block | null> {
  if (method !== 'POST' || process.env.RATE_SHARED === 'off' || !persistenceConfigured()) return null;
  const rules = sharedRules(pathname);
  if (!rules.length) return null;
  const ip = ipKey(clientIp(headers));
  try {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS));
    const [perIp, global] = await Promise.race([
      Promise.all([
        Promise.all(rules.map((r) => hit(`${r.name}:${ip}`, Math.round(r.windowMs / 1000), r.max))).then((xs) => Math.max(0, ...xs)),
        hit(`model-global:${pathname}`, 60, modelBudgetPerMin()),
      ]),
      timeout,
    ]);
    if (perIp)
      return { status: 429, code: 'RATE_LIMITED', message: `Too many requests — this public demo protects free model quotas. Try again in ${perIp}s.`, retryAfter: perIp };
    if (global)
      return { status: 429, code: 'MODEL_BUDGET', message: `The shared model budget is used up for now. Try again in ${global}s.`, retryAfter: global };
    return null;
  } catch (e) {
    console.error(JSON.stringify({ msg: 'shared_rate_limit_unavailable', route: pathname, error: e instanceof Error ? e.message : 'unknown' }));
    return null;
  }
}

/** Wraps a model route's POST handler: shared limits run before the handler (the sync proxy keeps the in-memory ones). */
export function sharedLimited<A extends unknown[]>(pathname: string, handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const b = await checkShared(req.method, pathname, req.headers);
    if (!b) return handler(req, ...rest);
    return Response.json({ error: { code: b.code, message: b.message } }, { status: b.status, headers: b.retryAfter ? { 'Retry-After': String(b.retryAfter) } : undefined });
  };
}
