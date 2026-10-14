import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const GET = v1('/api/v1/projects', async (req) => {
  const c = await caller(req);
  return { projects: await persist.listProjects(c, uuidParam(new URL(req.url).searchParams.get('workspaceId') ?? undefined, 'workspaceId')) };
});
export const POST = v1('/api/v1/projects', async (req) => {
  const c = await caller(req);
  return { project: await persist.createProject(c, await body(req, persist.schemas.project)) };
});
