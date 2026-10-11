import { z } from 'zod';
import type { CircuitGraph } from './types';

// Owner: Agent A. Zod schema + topology checks (GND present, measureNode exists, no floating nodes,
// supported kinds only, positive resistances). Never throws.
export type ValidationResult = { ok: true; graph: CircuitGraph } | { ok: false; errors: string[] };

const node = z.string().trim().min(1, 'node name must be non-empty');
const component = z
  .object({
    id: z.string().min(1, 'component id must be non-empty'),
    kind: z.enum(['resistor', 'dc_voltage']),
    value: z.number().finite('value must be finite'),
    positiveNode: node,
    negativeNode: node,
    sourceBoundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  })
  .strict();
export const circuitGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    components: z.array(component).min(1, 'at least one component required'),
    groundNode: z.literal('GND'),
    measureNode: node,
  })
  .strict();

export function validateGraph(input: unknown): ValidationResult {
  try {
    const parsed = circuitGraphSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'graph'}: ${i.message}`),
      };
    }
    const g = parsed.data as CircuitGraph;
    const errors: string[] = [];
    const ids = new Set<string>();
    for (const c of g.components) {
      if (ids.has(c.id)) errors.push(`duplicate component id "${c.id}"`);
      ids.add(c.id);
      if (c.kind === 'resistor' && !(c.value > 0)) errors.push(`${c.id}: resistance must be > 0`);
      if (c.positiveNode === c.negativeNode) errors.push(`${c.id}: both terminals on node "${c.positiveNode}"`);
    }
    if (!g.components.some((c) => c.kind === 'dc_voltage')) errors.push('at least one dc_voltage source required');

    const adj = new Map<string, string[]>();
    for (const c of g.components) {
      adj.set(c.positiveNode, [...(adj.get(c.positiveNode) ?? []), c.negativeNode]);
      adj.set(c.negativeNode, [...(adj.get(c.negativeNode) ?? []), c.positiveNode]);
    }
    if (!adj.has('GND')) errors.push('GND does not appear on any component');
    if (!adj.has(g.measureNode)) errors.push(`measureNode "${g.measureNode}" is not in the circuit`);
    if (adj.has('GND')) {
      const seen = new Set(['GND']);
      const stack = ['GND'];
      while (stack.length) {
        for (const n of adj.get(stack.pop()!) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      for (const n of adj.keys()) if (!seen.has(n)) errors.push(`node "${n}" is floating (not connected to GND)`);
    }
    return errors.length ? { ok: false, errors } : { ok: true, graph: g };
  } catch (e) {
    return { ok: false, errors: [`validation failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
