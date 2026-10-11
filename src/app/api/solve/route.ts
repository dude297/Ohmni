import { z } from 'zod';
import { validateGraph } from '../../../lib/circuit/validate';
import { solveDC, SolveError } from '../../../lib/circuit/solve';
import { diagnose } from '../../../lib/diagnosis';
import type { SolveResponse } from '../../../lib/circuit/types';

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
  const { graph: rawGraph, userConfirmed, measuredVoltage } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before solving');
  const v = validateGraph(rawGraph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);

  const t0 = performance.now();
  try {
    const { voltages, currents } = solveDC(v.graph);
    const result: SolveResponse = {
      voltages,
      currents,
      grounded: true,
      trace: [
        {
          step: 'solve',
          provider: 'local',
          model: 'mna-dc',
          durationMs: Math.round(performance.now() - t0),
          status: 'ok',
        },
      ],
    };
    if (measuredVoltage !== undefined) result.hypotheses = diagnose(v.graph, measuredVoltage);
    return Response.json({ result });
  } catch (e) {
    if (e instanceof SolveError) return err(422, 'UNSOLVABLE', e.message);
    throw e;
  }
}
