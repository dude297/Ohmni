import { GoogleGenAI } from '@google/genai';
import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';
import { EXTRACTION_PROMPT, responseJsonSchema, toCandidateExtraction } from './extractionSchema';
import type { FailureReason } from './vision';

// Owner: Agent B. Gemini vision -> CandidateExtraction (zod-validated). Server-only.
const TIMEOUT_MS = 20_000;

function failed(warning: string): CandidateExtraction {
  return { inputKind: 'unknown', graph: null, warnings: [warning], unresolvedConnections: [], requiresHumanReview: true };
}

// Single source of truth for the Gemini default (health route and fallback adapter read this too).
export const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export async function extractCircuit(
  image: Uint8Array,
  mimeType: string,
): Promise<{ extraction: CandidateExtraction; event: ModelTraceEvent; failure?: FailureReason }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_NOT_CONFIGURED');
  const model = geminiModel();
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const event: ModelTraceEvent = { step: 'extract', provider: 'google', model, durationMs: 0, status: 'ok' };

  try {
    // ponytail: Promise.race because the SDK can hang past abortSignal (observed on 3.7-flash)
    const hang = new Promise<never>((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('timeout'))));
    const res = await Promise.race([hang, new GoogleGenAI({ apiKey }).models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: EXTRACTION_PROMPT }, { inlineData: { mimeType, data: Buffer.from(image).toString('base64') } }],
        },
      ],
      config: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema, abortSignal: ctrl.signal },
    })]);
    const u = res.usageMetadata;
    if (u) event.usage = { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };

    let raw: unknown;
    try {
      raw = JSON.parse(res.text ?? '');
    } catch {
      event.status = 'error';
      event.note = 'gemini malformed_output';
      return { extraction: toCandidateExtraction(null), event, failure: 'malformed_output' };
    }
    return { extraction: toCandidateExtraction(raw), event };
  } catch (e) {
    const timedOut = ctrl.signal.aborted;
    const status = (e as { status?: unknown })?.status;
    const msg = e instanceof Error ? e.message : '';
    const failure: FailureReason = timedOut
      ? 'timeout'
      : status === 429
        ? /quota|billing|RESOURCE_EXHAUSTED/i.test(msg) ? 'quota_exhausted' : 'rate_limited'
        : status === 404 || status === 503 || (status === 400 && /model/i.test(msg) && /not found|unsupported|invalid/i.test(msg))
          ? 'model_unavailable'
          : typeof status === 'number' && status >= 500 // other 5xx
            ? 'server_error'
            : 'other';
    // ponytail: SDK error text deliberately not copied into the trace (may echo request details)
    event.status = 'error';
    event.note = `gemini ${failure}${timedOut ? ` (request timed out after ${TIMEOUT_MS / 1000}s)` : typeof status === 'number' ? ` (${status})` : ''}`;
    return {
      extraction: failed(timedOut ? 'Extraction timed out; enter the circuit manually.' : 'Extraction failed; enter the circuit manually.'),
      event,
      failure,
    };
  } finally {
    clearTimeout(timer);
    event.durationMs = Date.now() - started;
  }
}
