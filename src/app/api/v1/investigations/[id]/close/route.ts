import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const POST = v1('/api/v1/investigations/[id]/close', async (req, p) => {
  const c = await caller(req);
  return { investigation: await persist.closeInvestigation(c, uuidParam(p.id), await body(req, persist.schemas.close)) };
});
