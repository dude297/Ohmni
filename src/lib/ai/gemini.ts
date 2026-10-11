import { GoogleGenAI } from '@google/genai';
import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';
import { responseJsonSchema, toCandidateExtraction } from './extractionSchema';

// Owner: Agent B. Gemini vision -> CandidateExtraction (zod-validated). Server-only.
const TIMEOUT_MS = 20_000;

const PROMPT = `You read images of simple DC circuits (schematic or breadboard layout).
Extract ONLY what is visible. Never guess or infer a value, label or wire that is not clearly shown.
- components: every part with its printed id (R1, V1...), kind, value exactly as printed, and its two node names.
  Use kind "resistor" or "dc_voltage"; for any other part use its real name (capacitor, led, opamp...).
  For dc_voltage, positiveNode is the + terminal. Omit value if not legible.
- Name nodes by their printed labels (VIN, VOUT...); the ground symbol is "GND". Give unlabeled junctions short names like N1.
- measureNode: only if a node is explicitly labelled VOUT (or a clearly marked measurement point); otherwise omit it.
- unresolvedConnections: describe any wire or junction you are unsure about.
- warnings: anything illegible or ambiguous.
Return JSON matching the schema.`;

function failed(warning: string): CandidateExtraction {
  return { inputKind: 'unknown', graph: null, warnings: [warning], unresolvedConnections: [], requiresHumanReview: true };
}

export async function extractCircuit(
  image: Uint8Array,
  mimeType: string,
): Promise<{ extraction: CandidateExtraction; event: ModelTraceEvent }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_NOT_CONFIGURED');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const event: ModelTraceEvent = { step: 'extract', provider: 'google', model, durationMs: 0, status: 'ok' };

  try {
    const res = await new GoogleGenAI({ apiKey }).models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: PROMPT }, { inlineData: { mimeType, data: Buffer.from(image).toString('base64') } }],
        },
      ],
      config: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema, abortSignal: ctrl.signal },
    });
    const u = res.usageMetadata;
    if (u) event.usage = { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };

    let raw: unknown;
    try {
      raw = JSON.parse(res.text ?? '');
    } catch {
      event.status = 'error';
      event.note = 'Model returned malformed JSON';
      return { extraction: toCandidateExtraction(null), event };
    }
    return { extraction: toCandidateExtraction(raw), event };
  } catch {
    // ponytail: SDK error text deliberately not copied into the trace (may echo request details)
    event.status = 'error';
    event.note = ctrl.signal.aborted ? `Gemini request timed out after ${TIMEOUT_MS / 1000}s` : 'Gemini request failed';
    return {
      extraction: failed(ctrl.signal.aborted ? 'Extraction timed out; enter the circuit manually.' : 'Extraction failed; enter the circuit manually.'),
      event,
    };
  } finally {
    clearTimeout(timer);
    event.durationMs = Date.now() - started;
  }
}
