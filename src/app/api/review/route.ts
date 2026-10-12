import { z } from 'zod';
import { reviewCircuit, mentorExplain } from '../../../lib/review';
import type { ModelTraceEvent } from '../../../lib/circuit/types';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  intended: z.unknown().optional(),
  ratings: z.record(z.string(), z.object({ powerW: z.number().positive().finite().optional() })).optional(),
  mentor: z
    .object({
      findingId: z.string(),
      level: z.enum(['beginner', 'intermediate', 'advanced']),
      mode: z.enum(['explain', 'hint']),
      hintIndex: z.number().int().min(0).max(2).optional(),
    })
    .optional(),
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
  const { graph, userConfirmed, intended, ratings, mentor } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before review');

  const t0 = performance.now();
  const review = reviewCircuit(graph, { ratings, intended: intended as never });
  const trace: ModelTraceEvent[] = [
    { step: 'review', provider: 'local', model: 'rules+mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' },
  ];
  let mentorOut;
  if (mentor) {
    const finding = review.findings.find((f) => f.id === mentor.findingId);
    if (!finding) return err(422, 'FINDING_NOT_FOUND', `No finding with id "${mentor.findingId}"`);
    mentorOut = await mentorExplain({ graph, finding, level: mentor.level, mode: mentor.mode, hintIndex: mentor.hintIndex });
    trace.push(...mentorOut.trace);
  }
  return Response.json({ result: { findings: review.findings, solution: review.solution, mentor: mentorOut, trace } });
}
