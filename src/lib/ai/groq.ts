import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';
import { EXTRACTION_PROMPT, responseJsonSchema, toCandidateExtraction } from './extractionSchema';
import type { FailureReason, VisionResult } from './vision';

// GroqCloud vision (OpenAI-compatible). Single attempt, no retries. Server-only.
const TIMEOUT_MS = 20_000;
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const groqModel = () => process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_MODEL;

function failed(warning: string): CandidateExtraction {
  return { inputKind: 'unknown', graph: null, warnings: [warning], unresolvedConnections: [], requiresHumanReview: true };
}

function classify(status: number, msg: string): FailureReason {
  if (status === 429) return /per day|\bTPD\b|\bRPD\b|quota/i.test(msg) ? 'quota_exhausted' : 'rate_limited';
  if (status === 404 || status === 503 || (status === 400 && /model/i.test(msg))) return 'model_unavailable';
  if (status >= 500) return 'server_error';
  return 'other';
}

export type GroqRaw = { event: ModelTraceEvent; failure?: FailureReason; raw?: unknown };

/** One Groq vision call returning parsed JSON (not yet normalised). Single attempt, 20s timeout. */
export async function callGroq(step: string, instruction: string, image: Uint8Array, mimeType: string): Promise<GroqRaw> {
  const model = groqModel();
  const event: ModelTraceEvent = { step, provider: 'groq', model, durationMs: 0, status: 'ok' };
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    event.status = 'skipped';
    event.note = 'GROQ_API_KEY not configured';
    return { event, failure: 'not_configured' };
  }
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const fail = (failure: FailureReason, note: string): GroqRaw => {
    event.status = 'error';
    event.note = note;
    return { event, failure };
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${instruction}\nRespond with a single JSON object (no prose) matching this JSON schema:\n${JSON.stringify(responseJsonSchema)}`,
              },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${Buffer.from(image).toString('base64')}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const f = classify(res.status, body);
      return fail(f, `groq ${f} (${res.status})`);
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (j.usage) event.usage = { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens };
    const text = (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail('malformed_output', 'groq malformed_output');
    }
    return { event, raw };
  } catch {
    // ponytail: error text not copied into trace (could echo request details)
    return ctrl.signal.aborted
      ? fail('timeout', `groq timeout (request timed out after ${TIMEOUT_MS / 1000}s)`)
      : fail('other', 'groq other (network error)');
  } finally {
    clearTimeout(timer);
    event.durationMs = Date.now() - started;
  }
}

export async function extractWithGroq(image: Uint8Array, mimeType: string): Promise<VisionResult> {
  const r = await callGroq('extract', EXTRACTION_PROMPT, image, mimeType);
  if (r.failure === 'malformed_output') return { extraction: toCandidateExtraction(null), event: r.event, failure: r.failure };
  if (r.failure) {
    const w = r.failure === 'timeout' ? 'Extraction timed out; enter the circuit manually.' : 'Extraction failed; enter the circuit manually.';
    return { extraction: failed(w), event: r.event, failure: r.failure };
  }
  return { extraction: toCandidateExtraction(r.raw), event: r.event };
}
