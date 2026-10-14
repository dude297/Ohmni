import { z } from 'zod';
import type { CandidateExtraction, ModelTraceEvent, RouteChoice } from '../circuit/types';
import { fence, FENCE_RULE } from './fence';

// Owner: Agent C. Jev choice routing over structured text state. Falls back to ask_user.
// Locked to BeatAPI's FREE Jev model. Paid ids (e.g. jev-1.13) are refused, never silently used.
const JEV_URL = 'https://api.beatapi.io/v1/systemone';
const FREE_MODELS = new Set(['jev-1.13-free']);
// BeatAPI free tier: 1 successful call/min before first top-up.
const MIN_INTERVAL_MS = 60_000;
const MAX_WAIT_MS = 8_000;

// ponytail: in-memory per server instance; parallel serverless instances can still collide,
// which the 429 + Retry-After handling below covers. Shared store (KV) if that bites.
let nextAllowedAt = 0;
export function __resetJevPacing() {
  nextAllowedAt = 0;
}

const JevResponse = z.object({
  answers: z.object({
    route: z.object({
      choice: z.enum(['review_extraction', 'verify_topology', 'ask_user']),
      confidence: z.number().optional(),
      probabilities: z.record(z.string(), z.number()).optional(),
    }),
  }),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

const CRITERIA = {
  review_extraction:
    'The circuit graph is present and valid, every component value was read clearly (no warning says a value is obscured, partially legible, guessed or "appears to be"), and there are no unresolved connections. Ready for the user to review.',
  verify_topology:
    'A graph exists but has unresolved connections or ambiguous wiring that a second vision read of the image could settle.',
  ask_user:
    'The graph is missing or invalid, or any component value is unreadable, obscured, partially legible, guessed or described as "appears to be" — a guessed value must not reach the solver without the user re-entering it.',
};

function buildState(e: CandidateExtraction, validationErrors: string[]): string {
  const g = e.graph;
  const comps = g
    ? g.components.map((c) => `${c.id} ${c.kind} ${c.value} (${c.positiveNode}->${c.negativeNode})`).join('; ')
    : 'none';
  return [
    `Input kind: ${e.inputKind}`,
    `Graph present: ${g ? 'yes' : 'no'}`,
    `Components (${g?.components.length ?? 0}): ${comps}`,
    g ? `Measure node: ${g.measureNode}` : '',
    `Warnings: ${e.warnings.join(' | ') || 'none'}`,
    `Unresolved connections: ${e.unresolvedConnections.join(' | ') || 'none'}`,
    `Validation errors: ${validationErrors.join(' | ') || 'none'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function routeExtraction(input: {
  extraction: CandidateExtraction;
  validationErrors: string[];
}): Promise<{ route: RouteChoice; event: ModelTraceEvent }> {
  const start = Date.now();
  const model = process.env.BEATAPI_JEV_MODEL || 'jev-1.13-free';
  const key = process.env.BEATAPI_API_KEY;
  const base = { step: 'route', provider: 'beatapi', model };
  const fallback = (status: 'error' | 'skipped', note: string) => ({
    route: 'ask_user' as RouteChoice,
    event: { ...base, durationMs: Date.now() - start, status, chosenRoute: 'ask_user' as RouteChoice, note },
  });

  if (!key) return fallback('skipped', 'BEATAPI_API_KEY not configured; defaulting to ask_user');
  if (!FREE_MODELS.has(model)) return fallback('skipped', `Refused non-free Jev model "${model}"; defaulting to ask_user`);

  const wait = nextAllowedAt - Date.now();
  if (wait > MAX_WAIT_MS)
    return fallback('skipped', `Jev free-tier pacing: next call allowed in ${Math.ceil(wait / 1000)}s; defaulting to ask_user`);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        state: fence(buildState(input.extraction, input.validationErrors)), // warnings/ids come from the user's image
        model,
        questions: {
          route: {
            type: 'choice',
            instructions: `Decide the next step for this extracted circuit. ${FENCE_RULE}`,
            criteria: CRITERIA,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      const retryMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : MIN_INTERVAL_MS;
      nextAllowedAt = Date.now() + retryMs;
      return fallback('error', `Jev rate limited (429), retry after ${Math.ceil(retryMs / 1000)}s; defaulting to ask_user`);
    }
    if (!res.ok) return fallback('error', `Jev HTTP ${res.status}; defaulting to ask_user`);
    nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
    const parsed = JevResponse.safeParse(await res.json());
    if (!parsed.success) return fallback('error', 'Jev response failed schema check; defaulting to ask_user');
    const { choice, confidence, probabilities } = parsed.data.answers.route;
    const u = parsed.data.usage;
    return {
      route: choice,
      event: {
        ...base,
        durationMs: Date.now() - start,
        status: 'ok',
        chosenRoute: choice,
        ...(confidence !== undefined && { confidence }),
        ...(u && { usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens } }),
        ...(probabilities && {
          note: 'probabilities: ' + Object.entries(probabilities).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', '),
        }),
      },
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fallback('error', timedOut ? 'Jev request timed out; defaulting to ask_user' : 'Jev request failed; defaulting to ask_user');
  }
}
