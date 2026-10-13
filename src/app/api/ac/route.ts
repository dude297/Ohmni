import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { analyze } from '../../../lib/ac/analysis';
import { AcError } from '../../../lib/ac/engine';
import { validateAcGraph, type AcGraph } from '../../../lib/ac/types';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  faults: z.boolean().optional(),
  measuredPoints: z
    .array(z.object({ freqHz: z.number().min(1).max(1e7), magDb: z.number().min(-200).max(100) }))
    .max(50)
    .optional(),
});

const err = (status: number, code: string, message: string, details?: string[]) =>
  Response.json({ error: { code, message, ...(details && { details }) } }, { status });

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return bodyErrorResponse(e);
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
  const { graph, userConfirmed, faults, measuredPoints } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before simulating');
  const errors = validateAcGraph(graph);
  if (errors.length) return err(422, 'INVALID_GRAPH', 'AC circuit graph is invalid', errors);
  if (faults && !measuredPoints?.length) return err(422, 'INVALID_REQUEST', 'faults requires measuredPoints');

  try {
    const result = await analyze(graph as AcGraph, { faults, measuredPoints });
    return Response.json({ result });
  } catch (e) {
    if (e instanceof AcError && e.code === 'TIMEOUT')
      return Response.json({ error: { code: 'TIMEOUT', message: e.message }, partial: false }, { status: 504 });
    if (e instanceof AcError)
      return err(e.code === 'BUSY' ? 429 : e.code === 'TIMEOUT' ? 504 : 422, e.code === 'SIM_FAILED' ? 'UNSOLVABLE' : e.code, e.message);
    throw e;
  }
}
