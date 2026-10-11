import { z } from 'zod';
import { explain } from '../../../lib/explain';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  measuredVoltage: z.number().finite().optional(),
});

const err = (status: number, code: string, message: string, details?: string[]) =>
  Response.json({ error: { code, message, ...(details && { details }) } }, { status });

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return err(
      422,
      'INVALID_REQUEST',
      'Invalid request body',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const { graph, userConfirmed, measuredVoltage } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before explaining');
  const out = await explain(graph, measuredVoltage);
  if (!out.ok) return err(out.status, out.code, out.message, out.details);
  return Response.json({ result: out.result });
}
