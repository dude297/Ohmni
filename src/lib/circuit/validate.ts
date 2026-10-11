import type { CircuitGraph } from './types';

// Owner: Agent A. Zod schema + topology checks (GND present, measureNode exists, no floating nodes,
// supported kinds only, positive resistances). Never throws.
export type ValidationResult = { ok: true; graph: CircuitGraph } | { ok: false; errors: string[] };

export function validateGraph(_input: unknown): ValidationResult {
  return { ok: false, errors: ['validateGraph not implemented'] };
}
