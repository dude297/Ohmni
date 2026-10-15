import { z } from 'zod';
import { adminDb, ApiError, dbFail, type Caller } from '../server/supabase';
import { removeWorkspaceObjects } from './artifacts';

// Workspace data lifecycle: full export (owners/editors, RLS reads) and permanent deletion (owner, typed confirmation).
// Viewers can read records in the app but not bulk-download them (contractor/auditor seats).

const TABLES = ['workspace_members', 'projects', 'artifacts', 'design_revisions', 'investigations', 'measurements', 'hypotheses', 'repair_proposals', 'verifications', 'model_traces', 'reports'] as const;
const PAGE = 1000; // PostgREST default max_rows
const MAX_PER_TABLE = 50_000; // ponytail: synchronous export; move to a background job + Storage file past this

async function role({ user, db }: Caller, workspaceId: string) {
  const { data, error } = await db.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (error) dbFail(error, 'check membership');
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'workspace: not found.');
  return data.role as string;
}

/** Every row of the workspace (RLS reads), table by table, paged. Owners and editors only. */
export async function exportWorkspace(c: Caller, workspaceId: string) {
  if ((await role(c, workspaceId)) === 'viewer') throw new ApiError(403, 'FORBIDDEN', 'Viewers cannot export a workspace; ask an owner or editor.');
  const { data: workspace, error } = await c.db.from('workspaces').select('id, name, created_at').eq('id', workspaceId).single();
  if (error) dbFail(error, 'load workspace');
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; from < MAX_PER_TABLE; from += PAGE) {
      const { data, error: e } = await c.db.from(t).select('*').eq('workspace_id', workspaceId).order(t === 'workspace_members' ? 'user_id' : 'id').range(from, from + PAGE - 1);
      if (e) dbFail(e, `export ${t}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (rows.length >= MAX_PER_TABLE) throw new ApiError(413, 'EXPORT_TOO_LARGE', `Table ${t} exceeds ${MAX_PER_TABLE} rows; contact support for a bulk export.`);
    tables[t] = rows;
  }
  return { schema: 'ohmni.workspace-export.v1' as const, exportedAt: new Date().toISOString(), workspace, tables };
}

export const deleteSchema = z.object({ confirm: z.string() });

/** Permanent: cascades through every table. The caller must be an owner and type the workspace name exactly. */
export async function deleteWorkspace(c: Caller, workspaceId: string, b: z.infer<typeof deleteSchema>) {
  if ((await role(c, workspaceId)) !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can delete a workspace.');
  const { data: ws, error } = await c.db.from('workspaces').select('name').eq('id', workspaceId).single();
  if (error) dbFail(error, 'load workspace');
  if (b.confirm !== ws.name) throw new ApiError(422, 'CONFIRMATION_MISMATCH', 'Type the workspace name exactly to confirm deletion.');
  await removeWorkspaceObjects(workspaceId); // stored images first: the cascade removes the rows that point to them
  // Through the caller's RLS client: the owner-only delete policy is the database backstop for the role check above.
  const { data: gone, error: e2 } = await c.db.from('workspaces').delete().eq('id', workspaceId).select('id');
  if (e2) dbFail(e2, 'delete workspace');
  if (!gone?.length) throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can delete a workspace.');
  return { deleted: workspaceId };
}

export const accountDeleteSchema = z.object({ confirm: z.string() });

/**
 * Permanent account deletion; body { confirm: "<the account's email>" }. Refused (409 LAST_OWNER, nothing changed) while
 * the caller is the only owner of a workspace that has other members: transfer ownership or remove them first.
 * Workspaces where the caller is the only member are deleted (stored images first). Then the auth user is deleted:
 * memberships cascade and authorship on evidence in shared workspaces is cleared (set null), the evidence stays.
 */
export async function deleteAccount(c: Caller, b: z.infer<typeof accountDeleteSchema>) {
  if (!c.user.email || b.confirm.trim().toLowerCase() !== c.user.email.toLowerCase())
    throw new ApiError(422, 'CONFIRMATION_MISMATCH', 'Type your account email exactly to confirm deletion.');
  const admin = adminDb();
  const { data: mine, error } = await admin.from('workspace_members').select('workspace_id, role').eq('user_id', c.user.id);
  if (error) dbFail(error, 'load memberships');
  const ids = (mine ?? []).map((m) => m.workspace_id as string);
  const { data: all, error: e2 } = ids.length
    ? await admin.from('workspace_members').select('workspace_id, user_id, role').in('workspace_id', ids)
    : { data: [], error: null };
  if (e2) dbFail(e2, 'load members');
  const solo: string[] = [];
  const blocked: string[] = [];
  for (const ws of ids) {
    const members = (all ?? []).filter((m) => m.workspace_id === ws);
    if (members.length === 1) solo.push(ws);
    else if (!members.some((m) => m.role === 'owner' && m.user_id !== c.user.id)) blocked.push(ws);
  }
  if (blocked.length) {
    const { data: names } = await admin.from('workspaces').select('id, name').in('id', blocked);
    throw new ApiError(409, 'LAST_OWNER', 'You are the only owner of shared workspaces; make another member an owner or remove the other members first.', (names ?? []).map((w) => `${w.name} (${w.id})`));
  }
  for (const ws of solo) {
    await removeWorkspaceObjects(ws);
    const { error: e3 } = await admin.from('workspaces').delete().eq('id', ws);
    if (e3) dbFail(e3, 'delete workspace');
  }
  const { error: e4 } = await admin.auth.admin.deleteUser(c.user.id);
  if (e4) throw new ApiError(500, 'INTERNAL', 'Account deletion failed after its workspaces were removed; retry.');
  return { deleted: true, workspacesDeleted: solo, membershipsRemoved: ids.length - solo.length };
}
