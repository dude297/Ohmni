import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { validateGraph } from '../../../lib/circuit/validate';
import { solveDC } from '../../../lib/circuit/solve';
import { revisionId } from '../../../lib/circuit/revision';
import { repairStep } from '../../../lib/repair';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  observations: z.array(z.object({ node: z.string().min(1), volts: z.number().finite() })).min(1).max(50),
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
  if (parsed.data.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before repair');
  const v = validateGraph(parsed.data.graph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);
  const t0 = performance.now();
  try {
    solveDC(v.graph);
    const result = repairStep(v.graph, parsed.data.observations);
    return Response.json({
      result: { ...result, revisionId: revisionId(v.graph), trace: [{ step: 'repair', provider: 'local', model: 'mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' }] },
    });
  } catch (e) {
    return err(422, 'UNSOLVABLE', e instanceof Error ? e.message : 'Circuit could not be solved');
  }
}

export const POST = observe('/api/repair', handle);
