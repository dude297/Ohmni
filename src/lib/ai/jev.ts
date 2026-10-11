import type { CandidateExtraction, ModelTraceEvent, RouteChoice } from '../circuit/types';

// Owner: Agent C. TypeSafe Jev choice routing over structured text state. Falls back to ask_user.
export async function routeExtraction(_input: {
  extraction: CandidateExtraction;
  validationErrors: string[];
}): Promise<{ route: RouteChoice; event: ModelTraceEvent }> {
  throw new Error('routeExtraction not implemented');
}
