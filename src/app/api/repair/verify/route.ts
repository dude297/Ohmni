import { z } from 'zod';
import { validateGraph } from '../../../../lib/circuit/validate';
import { verifyRepair } from '../../../../lib/repair';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  proposal: z.object({
    hypothesisId: z.string().min(1),
    verification: z.object({ node: z.string().min(1), expectVolts: z.number().finite(), toleranceVolts: z.number().finite().nonnegative() }),
  }),
  measured: z.object({ node: z.string().min(1), volts: z.number().finite() }),
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
  if (!parsed.success)
    return err(422, 'INVALID_REQUEST', 'Invalid request body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  if (parsed.data.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before verification');
  const v = validateGraph(parsed.data.graph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);
  return Response.json({ result: verifyRepair(parsed.data.proposal.verification, parsed.data.measured) });
}
