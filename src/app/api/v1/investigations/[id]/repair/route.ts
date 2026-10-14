import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const POST = v1('/api/v1/investigations/[id]/repair', async (req, p) => persist.proposeRepair(await caller(req), uuidParam(p.id)));
