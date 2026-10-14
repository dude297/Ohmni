import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { removeMember } from '@/lib/persist/members';

export const DELETE = v1('/api/v1/workspaces/[id]/members/[userId]', async (req, p) =>
  removeMember(await caller(req), uuidParam(p.id), uuidParam(p.userId, 'userId')),
);
