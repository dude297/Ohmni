import { sharedLimited } from '@/lib/server/sharedLimit';
import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { consentMissing, CONSENT_MESSAGE } from '@/lib/server/consent';
import { reviewCircuit, mentorExplain, REVIEW_DISCLAIMER } from '../../../lib/review';
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
  aiConsent: z.unknown().optional(),
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
  const { graph, userConfirmed, intended, ratings, mentor } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before review');

  const t0 = performance.now();
  const review = reviewCircuit(graph, { ratings, intended: intended as never });
  const trace: ModelTraceEvent[] = [
    { step: 'review', provider: 'local', model: 'rules+mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' },
  ];
  let mentorOut;
  // Only the mentor sends the circuit to a model; the deterministic review needs no consent.
  if (mentor && consentMissing(parsed.data.aiConsent === true)) return err(422, 'CONSENT_REQUIRED', CONSENT_MESSAGE);
  if (mentor) {
    const finding = review.findings.find((f) => f.id === mentor.findingId);
    if (!finding) return err(422, 'FINDING_NOT_FOUND', `No finding with id "${mentor.findingId}"`);
    mentorOut = await mentorExplain({ graph, finding, level: mentor.level, mode: mentor.mode, hintIndex: mentor.hintIndex });
    trace.push(...mentorOut.trace);
  }
  return Response.json({ result: { advisory: true, disclaimer: REVIEW_DISCLAIMER, findings: review.findings, solution: review.solution, mentor: mentorOut, trace } });
}

// Shared (cross-instance) model limits; in-memory limits run in src/proxy.ts.
export const POST = observe('/api/review', sharedLimited('/api/review', handle));
