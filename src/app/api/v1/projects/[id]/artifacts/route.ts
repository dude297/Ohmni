import { caller } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { uploadArtifact } from '@/lib/persist/artifacts';

// Opt-in: save the schematic image (multipart field "image", optional aiConsent=true) with the project. Editors only.
export const POST = v1('/api/v1/projects/[id]/artifacts', async (req, p) => {
  const c = await caller(req);
  return { artifact: await uploadArtifact(c, uuidParam(p.id), req) };
});
