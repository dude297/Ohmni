import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';
import { validateGraph } from '../circuit/validate';
import { groqModel, callGroq } from './groq';
import { toCandidateExtraction } from './extractionSchema';
import { fence, FENCE_RULE } from './fence';

// Secondary topology verifier: Groq vision (free tier), only when Jev picks verify_topology.
// Output goes through the same zod normaliser + validateGraph as the primary extraction.
const NOTE = 'Second-opinion model read of the image; agreement between models is not proof the circuit was parsed correctly.';

export async function verifyTopology(
  image: Uint8Array,
  mimeType: string,
  extraction: CandidateExtraction,
): Promise<{ extraction?: CandidateExtraction; event: ModelTraceEvent }> {
  const base = { step: 'verify_topology', provider: 'groq', model: groqModel() };
  if (!process.env.GROQ_API_KEY) {
    return { event: { ...base, durationMs: 0, status: 'skipped', note: 'GROQ_API_KEY not configured' } };
  }
  const prior = extraction.graph && {
    components: extraction.graph.components.map((c) => ({ id: c.id, kind: c.kind, value: c.value, positiveNode: c.positiveNode, negativeNode: c.negativeNode })),
    measureNode: extraction.graph.measureNode,
  };
  const instruction =
    'You are verifying a circuit image. A first pass extracted the circuit below, with some connections unresolved. ' +
    'Re-read the image independently and return the full circuit. Extract ONLY what is visible; never guess. ' +
    'Components use kind "resistor" or "dc_voltage" (positiveNode is the + terminal), values as printed, ground node "GND", measureNode only if explicitly labelled VOUT.\n' +
    FENCE_RULE + '\n' +
    'First pass: ' + fence(JSON.stringify({ ...prior, unresolvedConnections: extraction.unresolvedConnections }));
  const r = await callGroq('verify_topology', instruction, image, mimeType);
  const keep = (note: string) => ({ event: { ...r.event, status: 'error' as const, note } });
  if (r.failure === 'not_configured') return { event: r.event };
  if (r.failure) return { event: r.event }; // callGroq already set status 'error' + reason; original extraction kept

  const revised = toCandidateExtraction(r.raw);
  const v = revised.graph ? validateGraph(revised.graph) : null;
  if (!revised.graph || !v?.ok) return keep('groq output failed normalisation/validation; original extraction kept');
  return {
    extraction: {
      ...extraction,
      graph: v.graph,
      unresolvedConnections: revised.unresolvedConnections,
      warnings: [...extraction.warnings, ...revised.warnings, NOTE],
      requiresHumanReview: true,
    },
    event: { ...r.event, note: NOTE },
  };
}
