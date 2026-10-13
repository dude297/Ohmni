import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { validateGraph } from '../../../../lib/circuit/validate';
import { revisionId } from '../../../../lib/circuit/revision';
import { VerifyInputError, verifyHypothesis } from '../../../../lib/repair';

// Client expectations are accepted for backward compatibility but never used: the server recomputes everything.
const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  revisionId: z.string().optional(),
  hypothesisId: z.string().min(1).optional(),
  proposal: z
    .object({
      hypothesisId: z.string().min(1).optional(),
      verification: z.object({ node: z.string(), expectVolts: z.number().finite(), toleranceVolts: z.number().finite().nonnegative() }).partial().optional(),
    })
    .optional(),
  measured: z.object({ node: z.string().min(1), volts: z.number().finite() }),
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
  if (parsed.data.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before verification');
  const v = validateGraph(parsed.data.graph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);
  const rev = revisionId(v.graph);
  if (parsed.data.revisionId && parsed.data.revisionId !== rev) return err(409, 'REVISION_MISMATCH', 'Graph does not match the revision the evidence was bound to', [`expected ${parsed.data.revisionId}, got ${rev}`]);
  const hypothesisId = parsed.data.hypothesisId ?? parsed.data.proposal?.hypothesisId;
  if (!hypothesisId) return err(422, 'INVALID_REQUEST', 'Invalid request body', ['hypothesisId: required']);
  try {
    const result = verifyHypothesis(v.graph, hypothesisId, parsed.data.measured);
    const c = parsed.data.proposal?.verification;
    const clientExpectationIgnored =
      !!c && ((c.node !== undefined && c.node !== result.node) || (c.expectVolts !== undefined && Math.abs(c.expectVolts - result.expectVolts) > result.toleranceVolts) || (c.toleranceVolts !== undefined && Math.abs(c.toleranceVolts - result.toleranceVolts) > result.toleranceVolts));
    return Response.json({ result: { ...result, revisionId: rev, ...(clientExpectationIgnored && { clientExpectationIgnored }) } });
  } catch (e) {
    if (e instanceof VerifyInputError) return err(422, e.code, e.message);
    return err(422, 'UNSOLVABLE', e instanceof Error ? e.message : 'Circuit could not be solved');
  }
}
