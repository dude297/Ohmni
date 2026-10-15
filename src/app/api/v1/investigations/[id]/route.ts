import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import * as persist from '@/lib/persist';

// ?ohmmeter=1 lets the guide ask for power-off resistance readings (always on once one is stored).
export const GET = v1('/api/v1/investigations/[id]', async (req, p) =>
  persist.getInvestigation(await caller(req), uuidParam(p.id), { ohmmeter: new URL(req.url).searchParams.get('ohmmeter') === '1' }),
);
