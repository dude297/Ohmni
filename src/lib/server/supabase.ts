import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// Server-only Supabase access for the persistence API (/api/v1/*).
// - userDb(): anon key + the caller's JWT, so every read/write is enforced by RLS as that user.
// - adminDb(): service role, ONLY after the caller's access/role was proven through their RLS-scoped client, for writes
//   clients have no policy for: engine output (hypotheses, proposals, verifications, traces), membership changes, and
//   Storage objects. Prefer an RLS policy where one can express the rule. The key never leaves the server (no NEXT_PUBLIC_).

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const url = () => process.env.SUPABASE_URL;
const anonKey = () => process.env.SUPABASE_ANON_KEY;
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export const persistenceConfigured = () => Boolean(url() && anonKey() && serviceKey());

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export type Caller = { user: User; db: SupabaseClient };

/** Authenticates the Bearer token and returns an RLS-scoped client for that user. */
export async function caller(req: Request): Promise<Caller> {
  if (!persistenceConfigured()) throw new ApiError(503, 'PERSISTENCE_DISABLED', 'Saved investigations are not configured on this deployment.');
  const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to use saved investigations.');
  const db = createClient(url()!, anonKey()!, { ...opts, global: { headers: { Authorization: `Bearer ${m[1]}` } } });
  const { data, error } = await db.auth.getUser(m[1]);
  if (error || !data.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired or invalid. Sign in again.');
  return { user: data.user, db };
}

let admin: SupabaseClient | undefined;
export function adminDb(): SupabaseClient {
  return (admin ??= createClient(url()!, serviceKey()!, opts));
}

/** Throws a typed ApiError for a PostgREST/Postgres error; RLS denials and FK misses become 403/404, never 500 details. */
export function dbFail(error: { code?: string; message?: string } | null, what: string): never {
  const code = error?.code;
  if (code === '42501') throw new ApiError(403, 'FORBIDDEN', `Not allowed to ${what}.`);
  if (code === '23503') throw new ApiError(404, 'NOT_FOUND', `Referenced record for ${what} not found in this workspace.`);
  if (code === '23505') throw new ApiError(409, 'CONFLICT', `${what}: already exists.`);
  if (code === '23514' || code === '22P02') throw new ApiError(422, 'INVALID_REQUEST', `Invalid value for ${what}.`);
  throw new ApiError(502, 'DB_ERROR', `Database error while trying to ${what}.`);
}

export const engineVersion = () =>
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? (process.env.NETLIFY_COMMIT_REF || undefined)?.slice(0, 7) ?? process.env.BUILD_SHA ?? 'dev';
