import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

// POST = the human confirms this circuit: stored as an immutable revision with confirmed_by = caller.
export const GET = v1('/api/v1/projects/[id]/revisions', async (req, p) => ({ revisions: await persist.listRevisions(await caller(req), uuidParam(p.id)) }));
export const POST = v1('/api/v1/projects/[id]/revisions', async (req, p) => {
  const c = await caller(req);
  return persist.confirmRevision(c, uuidParam(p.id), await body(req, persist.schemas.revision));
});
