import { z } from 'zod';
import type { CandidateExtraction, ModelTraceEvent, RouteChoice } from '../circuit/types';

// Owner: Agent C. TypeSafe Jev choice routing over structured text state. Falls back to ask_user.
// Direct TypeSafe preferred (no free-tier rate limit); BeatAPI gateway serves the same API shape.
const PROVIDERS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', keyEnv: 'TYPESAFE_API_KEY', modelEnv: 'JEV_MODEL', model: 'jev-latest' },
  beatapi: { url: 'https://api.beatapi.io/v1/systemone', keyEnv: 'BEATAPI_API_KEY', modelEnv: 'BEATAPI_JEV_MODEL', model: 'jev-1.13-free' },
} as const;

function pickProvider() {
  const name = process.env.TYPESAFE_API_KEY ? 'typesafe' : process.env.BEATAPI_API_KEY ? 'beatapi' : 'typesafe';
  const p = PROVIDERS[name];
  return { name, url: p.url, key: process.env[p.keyEnv], model: process.env[p.modelEnv] || p.model };
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
    'The circuit graph is present and valid, with no or only minor warnings and no unresolved connections. Ready for the user to review.',
  verify_topology:
    'A graph exists but has unresolved connections or ambiguous wiring that a second vision read of the image could settle.',
  ask_user:
    'The graph is missing or invalid, or component values are unreadable. The user must enter the circuit manually.',
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
  const { name: provider, url, key, model } = pickProvider();
  const base = { step: 'route', provider, model };
  const fallback = (status: 'error' | 'skipped', note: string) => ({
    route: 'ask_user' as RouteChoice,
    event: { ...base, durationMs: Date.now() - start, status, chosenRoute: 'ask_user' as RouteChoice, note },
  });

  if (!key) return fallback('skipped', 'TYPESAFE_API_KEY / BEATAPI_API_KEY not configured; defaulting to ask_user');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        state: buildState(input.extraction, input.validationErrors),
        model,
        questions: {
          route: {
            type: 'choice',
            instructions: 'Decide the next step for this extracted circuit.',
            criteria: CRITERIA,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fallback('error', `Jev HTTP ${res.status}; defaulting to ask_user`);
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
