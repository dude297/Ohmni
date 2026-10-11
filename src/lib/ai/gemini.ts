import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';

// Owner: Agent B. Gemini vision -> CandidateExtraction (zod-validated). Server-only.
export async function extractCircuit(
  _image: Uint8Array,
  _mimeType: string,
): Promise<{ extraction: CandidateExtraction; event: ModelTraceEvent }> {
  throw new Error('extractCircuit not implemented');
}
