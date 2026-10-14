import { caller } from '@/lib/server/supabase';
import { body, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const GET = v1('/api/v1/workspaces', async (req) => ({ workspaces: await persist.listWorkspaces(await caller(req)) }));
export const POST = v1('/api/v1/workspaces', async (req) => {
  const c = await caller(req);
  return { workspace: await persist.createWorkspace(c, await body(req, persist.schemas.workspace)) };
});
