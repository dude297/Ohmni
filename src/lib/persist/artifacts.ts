import { createHash } from 'node:crypto';
import { readFormData, sniffImage } from '../server/readBody';
import { adminDb, ApiError, dbFail, type Caller } from '../server/supabase';

// Saved schematic images (opt-in). Bytes live in the private 'artifacts' bucket at <workspace>/<project>/<sha256>.<ext>;
// the artifacts row is the provenance record (hash, size, type, AI-processing consent). Clients never touch Storage:
// uploads and short-lived signed download URLs are issued by the server after an RLS-checked read/insert.

const BUCKET = 'artifacts';
const MAX_BYTES = 6 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
const COLS = 'id, project_id, kind, sha256, bytes, mime, ai_processing_consent, created_by, created_at';

export async function uploadArtifact(c: Caller, projectId: string, req: Request) {
  const fd = await readFormData(req, MAX_BYTES);
  const file = fd.get('image');
  if (!(file instanceof File)) throw new ApiError(400, 'MISSING_IMAGE', 'Field "image" is required');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Image content must be png, jpeg or webp');
  const consent = fd.get('aiConsent') === 'true';

  const { data: project, error } = await c.db.from('projects').select('id, workspace_id').eq('id', projectId).maybeSingle();
  if (error) dbFail(error, 'load project');
  if (!project) throw new ApiError(404, 'NOT_FOUND', 'project: not found.');
  const { data: me, error: e1 } = await c.db.from('workspace_members').select('role').eq('workspace_id', project.workspace_id).eq('user_id', c.user.id).maybeSingle();
  if (e1) dbFail(e1, 'check membership');
  if (!me || me.role === 'viewer') throw new ApiError(403, 'FORBIDDEN', 'Editor access to this workspace is required.');

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = `${project.workspace_id}/${projectId}/${sha256}.${EXT[mime]}`;
  const { error: e2 } = await adminDb().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (e2) throw new ApiError(502, 'STORAGE_ERROR', 'Could not store the image.');
  const { data, error: e3 } = await c.db
    .from('artifacts')
    .insert({ workspace_id: project.workspace_id, project_id: projectId, kind: 'schematic_image', storage_path: path, sha256, bytes: bytes.length, mime, ai_processing_consent: consent, created_by: c.user.id })
    .select(COLS)
    .single();
  if (e3) dbFail(e3, 'record artifact'); // ponytail: the object stays if this insert fails; same-hash re-upload overwrites it
  return data;
}

/** Short-lived (60 s) download URL for an artifact the caller can read. */
export async function artifactUrl(c: Caller, id: string) {
  const { data, error } = await c.db.from('artifacts').select(`${COLS}, storage_path`).eq('id', id).maybeSingle();
  if (error) dbFail(error, 'load artifact');
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'artifact: not found.');
  const { data: s, error: e2 } = await adminDb().storage.from(BUCKET).createSignedUrl(data.storage_path, 60);
  if (e2 || !s) throw new ApiError(502, 'STORAGE_ERROR', 'Could not sign a download URL.');
  const { storage_path: _omit, ...artifact } = data;
  void _omit;
  return { artifact, url: s.signedUrl, expiresIn: 60 };
}

/** Removes every stored object of a workspace (called before the database cascade). Pages through every folder. */
export async function removeWorkspaceObjects(workspaceId: string) {
  const s = adminDb().storage.from(BUCKET);
  const listAll = async (prefix: string) => {
    const names: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await s.list(prefix, { limit: 1000, offset });
      if (error) throw new ApiError(502, 'STORAGE_ERROR', 'Could not list stored images; nothing was deleted.');
      names.push(...(data ?? []).map((f) => f.name));
      if (!data || data.length < 1000) return names;
    }
  };
  for (const project of await listAll(workspaceId)) {
    const paths = (await listAll(`${workspaceId}/${project}`)).map((f) => `${workspaceId}/${project}/${f}`);
    for (let i = 0; i < paths.length; i += 1000) {
      const { error } = await s.remove(paths.slice(i, i + 1000));
      if (error) throw new ApiError(502, 'STORAGE_ERROR', 'Could not delete stored images; the workspace was not deleted.');
    }
  }
}
