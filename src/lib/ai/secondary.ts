import type { CandidateExtraction, ModelTraceEvent } from '../circuit/types';

// Owner: Agent C. Optional OpenAI vision verifier, only when Jev picks verify_topology and key exists.
export async function verifyTopology(
  _image: Uint8Array,
  _mimeType: string,
  _extraction: CandidateExtraction,
): Promise<{ extraction?: CandidateExtraction; event: ModelTraceEvent }> {
  throw new Error('verifyTopology not implemented');
}
