import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { consentMissing, CONSENT_MESSAGE } from '@/lib/server/consent';
import { explain } from '../../../lib/explain';

const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  measuredVoltage: z.number().finite().optional(),
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
  if (!parsed.success) {
    return err(
      422,
      'INVALID_REQUEST',
      'Invalid request body',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const { graph, userConfirmed, measuredVoltage } = parsed.data;
  if (userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before explaining');
  // The circuit graph is sent to Gemini for the narrative.
  if (consentMissing(parsed.data.aiConsent === true)) return err(422, 'CONSENT_REQUIRED', CONSENT_MESSAGE);
  const out = await explain(graph, measuredVoltage);
  if (!out.ok) return err(out.status, out.code, out.message, out.details);
  return Response.json({ result: out.result });
}

export const POST = observe('/api/explain', handle);
