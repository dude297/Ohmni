import { caller } from '@/lib/server/supabase';
import { body, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const POST = v1('/api/v1/investigations', async (req) => {
  const c = await caller(req);
  return { investigation: await persist.openInvestigation(c, await body(req, persist.schemas.investigation)) };
});
