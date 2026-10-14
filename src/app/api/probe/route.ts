import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { validateGraph } from '../../../lib/circuit/validate';
import { probeStep } from '../../../lib/probe';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  observations: z
    .array(
      z.union([
        z.object({ kind: z.literal('resistance'), a: z.string().min(1), b: z.string().min(1), ohms: z.number().finite().nonnegative() }),
        z.object({ node: z.string().min(1), volts: z.number().finite() }),
      ]),
    )
    .max(50)
    .default([]),
  ohmmeter: z.boolean().optional(), // let the guide ask for power-off resistance readings (next.kind === 'resistance')
});

const err = (status: number, code: string, message: string, details?: string[]) =>
  Response.json({ error: { code, message, ...(details && { details }) } }, { status });

async function handle(req: Request) {
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
  const result = probeStep(v.graph, parsed.data.observations, { ohmmeter: parsed.data.ohmmeter });
  return Response.json({
    result: {
      ...result,
      trace: [{ step: 'probe', provider: 'local', model: 'mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' }],
    },
  });
}

export const POST = observe('/api/probe', handle);
