import { z } from 'zod';
import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';

// Owner: Agent C. Optional OpenAI vision verifier, only when Jev picks verify_topology and key exists.
const Revised = z.object({
  unresolvedConnections: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  graph: z
    .object({
      schemaVersion: z.literal(1),
      components: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['resistor', 'dc_voltage']),
          value: z.number(),
          positiveNode: z.string(),
          negativeNode: z.string(),
          sourceBoundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        }),
      ),
      groundNode: z.literal('GND'),
      measureNode: z.string(),
    })
    .nullable(),
});

export async function verifyTopology(
  image: Uint8Array,
  mimeType: string,
  extraction: CandidateExtraction,
): Promise<{ extraction?: CandidateExtraction; event: ModelTraceEvent }> {
  const start = Date.now();
  const model = process.env.SECONDARY_VISION_MODEL || 'gpt-5.6-terra';
  const base = { step: 'verify_topology', provider: 'openai', model };
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { event: { ...base, durationMs: 0, status: 'skipped', note: 'OPENAI_API_KEY not configured' } };
  }
  const fail = (note: string) => ({ event: { ...base, durationMs: Date.now() - start, status: 'error' as const, note } });

  try {
    const prompt =
      'You are verifying a circuit image. A first pass extracted this graph with unresolved connections. ' +
      'Re-read the image and correct ONLY the connections listed in unresolvedConnections; do not change other components. ' +
      'Return JSON only: {"graph": <same graph shape, schemaVersion 1, groundNode "GND", or null>, "unresolvedConnections": string[] (still-unresolved items), "warnings": string[]}.\n' +
      JSON.stringify({ graph: extraction.graph, unresolvedConnections: extraction.unresolvedConnections });
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: `data:${mimeType};base64,${Buffer.from(image).toString('base64')}` },
            ],
          },
        ],
        text: { format: { type: 'json_object' } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return fail(`OpenAI HTTP ${res.status}`);
    const body = (await res.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      body.output_text ?? body.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
    const parsed = Revised.safeParse(JSON.parse(text ?? ''));
    if (!parsed.success) return fail('OpenAI output failed schema check; original extraction kept');
    const r = parsed.data;
    return {
      extraction: {
        ...extraction,
        graph: r.graph ?? extraction.graph,
        unresolvedConnections: r.unresolvedConnections,
        warnings: [...extraction.warnings, ...(r.warnings ?? [])],
        requiresHumanReview: true,
      },
      event: {
        ...base,
        durationMs: Date.now() - start,
        status: 'ok',
        ...(body.usage && { usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } }),
      },
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fail(timedOut ? 'OpenAI request timed out' : 'OpenAI request failed or returned non-JSON');
  }
}
