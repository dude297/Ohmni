import type { CircuitComponent, CircuitGraph } from '@/lib/circuit/types';
import { validateGraph } from '@/lib/circuit/validate';

export type NetlistFormat = 'spice' | 'kicad';
export type Rejected = { line: number; text: string; reason: string };
export type NetlistResult = {
  graph: CircuitGraph | null;
  warnings: string[];
  rejected: Rejected[];
  format: NetlistFormat;
  /** validateGraph errors (floating nodes, no source, bad measureNode...). graph is null when non-empty. */
  errors: string[];
};
export type ImportOptions = { measureNode?: string; format?: NetlistFormat };

/** Shared tail: any rejection or validation error => graph null. Topology is never repaired. */
export function finish(
  format: NetlistFormat,
  components: CircuitComponent[],
  rejected: Rejected[],
  warnings: string[],
  measure: string | undefined,
  fallbackMeasure: string | undefined,
): NetlistResult {
  const out: NetlistResult = { graph: null, warnings, rejected, format, errors: [] };
  if (rejected.length) {
    warnings.push(`${rejected.length} line(s) rejected; no graph produced because the topology would be incomplete`);
    return out;
  }
  let m = measure;
  if (!m) {
    m = fallbackMeasure;
    if (m) warnings.push(`no measureNode given; defaulting to first non-ground node "${m}" (set opts.measureNode or "* ohmni:measure NODE")`);
  }
  const v = validateGraph({ schemaVersion: 1, components, groundNode: 'GND', measureNode: m ?? 'GND' });
  if (v.ok) out.graph = v.graph;
  else out.errors = v.errors;
  return out;
}
