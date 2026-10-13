import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { validateGraph } from '../../../lib/circuit/validate';
import { probeStepMulti } from '../../../lib/probe-multi';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  observations: z.array(z.object({ node: z.string().min(1), volts: z.number().finite() })).max(50).default([]),
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
  if (!parsed.success)
    return err(422, 'INVALID_REQUEST', 'Invalid request body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  if (parsed.data.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before probing');
  const v = validateGraph(parsed.data.graph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);
  const t0 = performance.now();
  const result = probeStepMulti(v.graph, parsed.data.observations, { maxFaults: 2 });
  return Response.json({
    result: {
      ...result,
      hypothesisOnly: true, // ranked fault candidates, never confirmed faults
      trace: [{ step: 'probe-multi', provider: 'local', model: 'mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' }],
    },
  });
}
