import { z } from 'zod';
import { adminDb, ApiError, dbFail, type Caller } from '../server/supabase';

// Workspace membership. Clients have no write policy on workspace_members: the server checks the caller's role
// through RLS (their own membership row), then writes with the service role. Members are added by email only if
// the person already has an account; no invitation email is sent.
// ponytail: last-owner checks read-then-write without a lock; two owners demoting each other at the same instant
// could leave zero owners. Upgrade path: one SQL function doing the check and write in a single transaction.

export const memberSchemas = {
  add: z.object({ email: z.email().max(320), role: z.enum(['owner', 'editor', 'viewer']) }),
};

async function myRole({ user, db }: Caller, workspaceId: string): Promise<string> {
  const { data, error } = await db.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (error) dbFail(error, 'check membership');
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'workspace: not found.');
  return data.role as string;
}

async function owners(workspaceId: string): Promise<string[]> {
  const { data, error } = await adminDb().from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner');
  if (error) dbFail(error, 'count owners');
  return (data ?? []).map((r) => r.user_id as string);
}

export async function listMembers(c: Caller, workspaceId: string) {
  await myRole(c, workspaceId);
  const { data, error } = await adminDb().rpc('workspace_member_list', { p_workspace: workspaceId });
  if (error) dbFail(error, 'list members');
  return data ?? [];
}

/** Owner adds an existing user or changes a member's role. */
export async function upsertMember(c: Caller, workspaceId: string, b: z.infer<typeof memberSchemas.add>) {
  if ((await myRole(c, workspaceId)) !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can manage members.');
  const { data: userId, error } = await adminDb().rpc('user_id_by_email', { p_email: b.email });
  if (error) dbFail(error, 'look up user');
  if (!userId) throw new ApiError(404, 'USER_NOT_FOUND', 'No Ohmni account uses that email yet. Ask them to sign in once, then add them.');
  const own = await owners(workspaceId);
  if (b.role !== 'owner' && own.length === 1 && own[0] === userId) throw new ApiError(409, 'LAST_OWNER', 'A workspace needs at least one owner.');
  const { data, error: e2 } = await adminDb()
    .from('workspace_members')
    .upsert({ workspace_id: workspaceId, user_id: userId, role: b.role }, { onConflict: 'workspace_id,user_id' })
    .select('user_id, role, created_at')
    .single();
  if (e2) dbFail(e2, 'save member');
  return { ...data, email: b.email };
}

/** Owners remove anyone; any member may remove themselves (leave). The last owner cannot leave. */
export async function removeMember(c: Caller, workspaceId: string, userId: string) {
  const role = await myRole(c, workspaceId);
  if (role !== 'owner' && userId !== c.user.id) throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can remove other members.');
  const own = await owners(workspaceId);
  if (own.length === 1 && own[0] === userId) throw new ApiError(409, 'LAST_OWNER', 'A workspace needs at least one owner.');
  const { data, error } = await adminDb().from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId).select('user_id');
  if (error) dbFail(error, 'remove member');
  if (!data?.length) throw new ApiError(404, 'NOT_FOUND', 'member: not found.');
  return { removed: userId };
}
