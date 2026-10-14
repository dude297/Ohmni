import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { artifactUrl } from '@/lib/persist/artifacts';

// Metadata + a 60-second signed download URL (members).
export const GET = v1('/api/v1/artifacts/[id]', async (req, p) => artifactUrl(await caller(req), uuidParam(p.id)));
