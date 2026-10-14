import { z } from 'zod';
import { adminDb, ApiError, dbFail, type Caller } from '../server/supabase';

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
  // Through the caller's RLS client: the owner-only delete policy is the database backstop for the role check above.
  const { data: gone, error: e2 } = await c.db.from('workspaces').delete().eq('id', workspaceId).select('id');
  if (e2) dbFail(e2, 'delete workspace');
  if (!gone?.length) throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can delete a workspace.');
  return { deleted: workspaceId };
}
