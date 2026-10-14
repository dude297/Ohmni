import type { z } from 'zod';
import { observe } from './observe';
import { BodyError, readJson } from './readBody';
import { ApiError } from './supabase';

// Shared plumbing for /api/v1/* (persistence API): typed errors, JSON body parsing, observe() wrapping.
type Ctx = { params: Promise<Record<string, string>> };

export function v1(route: string, handler: (req: Request, params: Record<string, string>) => Promise<unknown>) {
  return observe(route, async (req: Request, ctx?: Ctx) => {
    try {
      const out = await handler(req, (await ctx?.params) ?? {});
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } }, { status: e.status });
      if (e instanceof BodyError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      throw e; // observe() turns anything else into 500 INTERNAL
    }
  });
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const p = schema.safeParse(await readJson(req)); // BodyError: 413 TOO_LARGE / 400 BAD_JSON
  if (!p.success) throw new ApiError(422, 'INVALID_REQUEST', 'Invalid request body', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return p.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(v: string | undefined, name = 'id'): string {
  if (!v || !UUID.test(v)) throw new ApiError(404, 'NOT_FOUND', `Unknown ${name}.`);
  return v;
}
