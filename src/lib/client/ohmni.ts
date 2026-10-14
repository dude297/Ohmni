import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type * as P from '../persist';
import type * as M from '../persist/members';
import type { Report } from '../persist/report';

// Browser client for saved investigations (/api/v1/*). Sign-in uses Supabase Auth directly; all data goes through
// the Ohmni API with the session's access token. Needs NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// (publishable key, safe to expose). Without them, supabaseBrowser() is null and the UI should hide saving.

let sb: SupabaseClient | null | undefined;
export function supabaseBrowser(): SupabaseClient | null {
  if (sb !== undefined) return sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (sb = url && key ? createClient(url, key) : null);
}

/** Email magic link; the user returns to `redirectTo` signed in. */
export async function signInWithEmail(email: string, redirectTo = `${location.origin}${location.pathname}`) {
  const c = supabaseBrowser();
  if (!c) throw new OhmniApiError(503, 'PERSISTENCE_DISABLED', 'Saving is not configured on this deployment.');
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) throw new OhmniApiError(error.status ?? 400, 'AUTH_ERROR', error.message);
}

export class OhmniApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details?: unknown) {
    super(message);
  }
}

type Get<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;
type Body<K extends keyof typeof P.schemas> = import('zod').input<(typeof P.schemas)[K]>;

export function createOhmniApi(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new OhmniApiError(401, 'UNAUTHENTICATED', 'Sign in to save investigations.');
    const res = await fetchImpl(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.headers.get('content-type')?.startsWith('text/markdown')) return (await res.text()) as T;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new OhmniApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Request failed (${res.status})`, e.requestId ?? res.headers.get('x-request-id') ?? undefined, e.details);
    }
    return json as T;
  }
  const id = encodeURIComponent;
  return {
    workspaces: {
      list: () => call<{ workspaces: Get<typeof P.listWorkspaces> }>('GET', '/workspaces'),
      create: (b: Body<'workspace'>) => call<{ workspace: Get<typeof P.createWorkspace> }>('POST', '/workspaces', b),
    },
    members: {
      list: (ws: string) => call<{ members: Get<typeof M.listMembers> }>('GET', `/workspaces/${id(ws)}/members`),
      upsert: (ws: string, b: { email: string; role: 'owner' | 'editor' | 'viewer' }) => call<{ member: Get<typeof M.upsertMember> }>('POST', `/workspaces/${id(ws)}/members`, b),
      remove: (ws: string, userId: string) => call<{ removed: string }>('DELETE', `/workspaces/${id(ws)}/members/${id(userId)}`),
    },
    projects: {
      list: (ws: string) => call<{ projects: Get<typeof P.listProjects> }>('GET', `/projects?workspaceId=${id(ws)}`),
      create: (b: Body<'project'>) => call<{ project: Get<typeof P.createProject> }>('POST', '/projects', b),
      revisions: (project: string) => call<{ revisions: Get<typeof P.listRevisions> }>('GET', `/projects/${id(project)}/revisions`),
      /** The user confirms this circuit: stores an immutable revision (same circuit -> existing: true). */
      confirm: (project: string, b: Body<'revision'>) => call<Get<typeof P.confirmRevision>>('POST', `/projects/${id(project)}/revisions`, b),
    },
    investigations: {
      open: (b: Body<'investigation'>) => call<{ investigation: Get<typeof P.openInvestigation> }>('POST', '/investigations', b),
      get: (inv: string) => call<Get<typeof P.getInvestigation>>('GET', `/investigations/${id(inv)}`),
      close: (inv: string, status: 'resolved' | 'abandoned') => call<{ investigation: Get<typeof P.closeInvestigation> }>('POST', `/investigations/${id(inv)}/close`, { status }),
      /** Stores the reading and returns the recomputed probe step (render `probe`). */
      measure: (inv: string, b: Body<'measurement'>) => call<Get<typeof P.addMeasurement>>('POST', `/investigations/${id(inv)}/measurements`, b),
      repair: (inv: string) => call<Get<typeof P.proposeRepair>>('POST', `/investigations/${id(inv)}/repair`),
      reportMarkdown: (inv: string) => call<string>('GET', `/investigations/${id(inv)}/report`),
      reportJson: (inv: string) => call<Report>('GET', `/investigations/${id(inv)}/report?format=json`),
    },
    proposals: {
      verify: (proposal: string, b: Body<'verify'>) => call<Get<typeof P.verifyProposal>>('POST', `/proposals/${id(proposal)}/verify`, b),
    },
  };
}
export type OhmniApi = ReturnType<typeof createOhmniApi>;

/** Default instance: token from the browser Supabase session. */
export const ohmni = createOhmniApi(async () => (await supabaseBrowser()?.auth.getSession())?.data.session?.access_token ?? null);
