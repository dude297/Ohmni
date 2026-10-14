import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import { listMembers, memberSchemas, upsertMember } from '@/lib/persist/members';

export const GET = v1('/api/v1/workspaces/[id]/members', async (req, p) => ({ members: await listMembers(await caller(req), uuidParam(p.id)) }));
// Owner adds an existing account by email, or changes a member's role.
export const POST = v1('/api/v1/workspaces/[id]/members', async (req, p) => {
  const c = await caller(req);
  return { member: await upsertMember(c, uuidParam(p.id), await body(req, memberSchemas.add)) };
});
