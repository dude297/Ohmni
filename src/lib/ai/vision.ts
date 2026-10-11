import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';
import { extractCircuit, geminiModel } from './gemini';
import { extractWithGroq, groqModel } from './groq';

export type FailureReason =
  | 'rate_limited' | 'quota_exhausted' | 'model_unavailable' | 'timeout'
  | 'server_error' | 'not_configured' | 'malformed_output' | 'other';

export type VisionResult = { extraction: CandidateExtraction; event: ModelTraceEvent; failure?: FailureReason };

export interface VisionExtractor {
  provider: string;
  model: string;
  extract(image: Uint8Array, mime: string): Promise<VisionResult>;
}

const empty = (): CandidateExtraction => ({ inputKind: 'unknown', graph: null, warnings: [], unresolvedConnections: [], requiresHumanReview: true });

export const geminiExtractor: VisionExtractor = {
  provider: 'google',
  get model() {
    return geminiModel();
  },
  async extract(image, mime) {
    try {
      return await extractCircuit(image, mime);
    } catch (e) {
      const nc = e instanceof Error && e.message === 'GEMINI_NOT_CONFIGURED';
      const event: ModelTraceEvent = {
        step: 'extract', provider: 'google', model: this.model, durationMs: 0,
        status: nc ? 'skipped' : 'error', note: nc ? 'gemini not_configured' : 'gemini other',
      };
      return { extraction: empty(), event, failure: nc ? 'not_configured' : 'other' };
    }
  },
};

export const groqExtractor: VisionExtractor = {
  provider: 'groq',
  get model() {
    return groqModel();
  },
  extract: extractWithGroq,
};

// Groq is free-tier, so even malformed Gemini output earns a second attempt.
// 'other' (auth/bad request) does not: Groq is unlikely to help and we should not mask a config bug.
const FALLBACK_ON = new Set<FailureReason>([
  'rate_limited', 'quota_exhausted', 'model_unavailable', 'timeout', 'server_error', 'not_configured', 'malformed_output',
]);

function manual(reasons: string[]): CandidateExtraction {
  return {
    ...empty(),
    warnings: [`Automated extraction unavailable (${reasons.join(', ')}); enter the circuit manually.`],
  };
}

/** Gemini first; Groq once if Gemini failed in a fallback-worthy way. `ok` = some provider returned usable output. */
export async function extractWithFallback(
  image: Uint8Array,
  mime: string,
  primary: VisionExtractor = geminiExtractor,
  backup: VisionExtractor = groqExtractor,
): Promise<{ extraction: CandidateExtraction; events: ModelTraceEvent[]; ok: boolean }> {
  const a = await primary.extract(image, mime);
  if (!a.failure) return { extraction: a.extraction, events: [a.event], ok: true };
  if (!FALLBACK_ON.has(a.failure)) return { extraction: manual([`gemini ${a.failure}`]), events: [a.event], ok: false };

  const reason = a.event.note?.replace(/^gemini /, '') ?? a.failure; // e.g. "rate_limited (429)"
  const events: ModelTraceEvent[] = [{ ...a.event, note: `fallback: gemini ${reason}` }];
  const b = await backup.extract(image, mime);
  events.push(b.failure === 'not_configured' ? b.event : { ...b.event, note: [b.event.note, `fallback from gemini ${a.failure}`].filter(Boolean).join('; ') });
  if (!b.failure) return { extraction: b.extraction, events, ok: true };
  return { extraction: manual([`gemini ${a.failure}`, `groq ${b.failure}`]), events, ok: false };
}
