import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { validateGraph } from '../../../lib/circuit/validate';
import { buildCandidates, discriminate, nodesOf } from '../../../lib/topology/candidates';

// Dual-candidate topology probing: same request gate and error shapes as /api/probe. No model calls.
const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  ambiguous: z.object({ a: z.string().trim().min(1), b: z.string().trim().min(1) }),
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
  const { a, b } = parsed.data.ambiguous;
  const nodes = nodesOf(v.graph);
  if (a === b || !nodes.includes(a) || !nodes.includes(b))
    return err(422, 'INVALID_REQUEST', 'Invalid request body', [`ambiguous: a and b must be two different nodes of the graph (${nodes.join(', ')})`]);
  const t0 = performance.now();
  const candidates = buildCandidates(v.graph, a, b);
  const measurement = discriminate(candidates, [a, b]);
  return Response.json({
    result: {
      candidates,
      measurement,
      trace: [{ step: 'topology', provider: 'local', model: 'mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' }],
    },
  });
}

export const POST = observe('/api/topology', handle);
