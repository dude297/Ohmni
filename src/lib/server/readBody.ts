// Bounded request-body readers. Never trust Content-Length: count bytes as they stream and abort past the cap.
export const MAX_JSON_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export class BodyError extends Error {
  constructor(public status: 400 | 413 | 415, public code: string, message: string) {
    super(message);
  }
}

async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > maxBytes) throw new BodyError(413, 'TOO_LARGE', `Request body must be at most ${maxBytes} bytes`);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new BodyError(413, 'TOO_LARGE', `Request body must be at most ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Parse a JSON body, streaming with a byte cap. Throws BodyError(413 TOO_LARGE | 400 BAD_JSON). */
export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const bytes = await readBytes(req, maxBytes);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new BodyError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
}

/** Buffer the multipart body under the cap, then let the platform parse the buffered bytes. */
export async function readFormData(req: Request, maxBytes = MAX_IMAGE_BYTES): Promise<FormData> {
  const bytes = await readBytes(req, maxBytes);
  try {
    return await new Response(bytes as BodyInit, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch {
    throw new BodyError(400, 'INVALID_FORM', 'Expected multipart/form-data with an "image" field');
  }
}

/** Magic-byte sniff. Returns the real MIME or null; the declared file.type is never trusted. */
export function sniffImage(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const at = (o: number, s: string) => [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && at(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return null;
}

/** Shared catch helper for routes: maps BodyError to the standard error envelope. */
export function bodyErrorResponse(e: unknown): Response {
  if (e instanceof BodyError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  return Response.json({ error: { code: 'BAD_JSON', message: 'Request body must be valid JSON' } }, { status: 400 });
}
