import { ApiError, caller, dbFail } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { usageSummary } from '@/lib/persist/traces';

// Model usage metadata (calls, errors, tokens, latency) per provider/model; ?days=1..90 (default 30).
export const GET = v1('/api/v1/workspaces/[id]/usage', async (req, p) => {
  const ws = uuidParam(p.id);
  const c = await caller(req);
  const { data, error } = await c.db.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (error) dbFail(error, 'load workspace');
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'workspace: not found.');
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 30));
  return usageSummary(c, ws, days);
});
