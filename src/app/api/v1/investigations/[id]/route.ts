import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

export const GET = v1('/api/v1/investigations/[id]', async (req, p) => persist.getInvestigation(await caller(req), uuidParam(p.id)));
