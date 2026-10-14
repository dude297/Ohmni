import { caller } from '@/lib/server/supabase';
import { body, uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

// Stores the reading (RLS: editors only), then recomputes the diagnosis from ALL stored evidence and snapshots it.
export const POST = v1('/api/v1/investigations/[id]/measurements', async (req, p) => {
  const c = await caller(req);
  return persist.addMeasurement(c, uuidParam(p.id), await body(req, persist.schemas.measurement));
});
