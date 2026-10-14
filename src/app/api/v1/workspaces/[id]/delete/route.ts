import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import { deleteSchema, deleteWorkspace } from '@/lib/persist/lifecycle';

// Permanent deletion of a workspace and everything in it. Owners only; body { confirm: "<exact workspace name>" }.
export const POST = v1('/api/v1/workspaces/[id]/delete', async (req, p) => {
  const c = await caller(req);
  return deleteWorkspace(c, uuidParam(p.id), await body(req, deleteSchema));
});
