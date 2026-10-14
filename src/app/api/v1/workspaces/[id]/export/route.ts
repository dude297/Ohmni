import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { exportWorkspace } from '@/lib/persist/lifecycle';

// Full JSON export of a workspace (owners/editors). Download it before deleting.
export const GET = v1('/api/v1/workspaces/[id]/export', async (req, p) => {
  const id = uuidParam(p.id);
  const out = await exportWorkspace(await caller(req), id);
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="ohmni-workspace-${id.slice(0, 8)}.json"` },
  });
});
