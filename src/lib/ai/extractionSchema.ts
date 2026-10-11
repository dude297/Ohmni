import { z } from 'zod';
import type { CandidateExtraction, CircuitComponent } from '../circuit/types';

// Raw model output. Lenient on purpose: we normalise and never invent missing data.
export const rawExtractionSchema = z.object({
  inputKind: z.string().optional(),
  components: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        value: z.union([z.string(), z.number()]).nullable().optional(),
        positiveNode: z.string().nullable().optional(),
        negativeNode: z.string().nullable().optional(),
      }),
    )
    .default([]),
  measureNode: z.string().nullable().optional(),
  warnings: z.array(z.string()).default([]),
  unresolvedConnections: z.array(z.string()).default([]),
});

// JSON schema handed to Gemini (responseJsonSchema).
export const responseJsonSchema = {
  type: 'object',
  properties: {
    inputKind: { type: 'string', enum: ['schematic', 'breadboard_template', 'unknown'] },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', description: 'resistor, dc_voltage, or the real part name (capacitor, led, opamp...)' },
          value: { type: 'string', description: 'value exactly as printed, e.g. "10k", "5V"; omit if not visible' },
          positiveNode: { type: 'string' },
          negativeNode: { type: 'string' },
        },
        required: ['id', 'kind', 'positiveNode', 'negativeNode'],
      },
    },
    measureNode: { type: 'string', description: 'node explicitly labelled VOUT; omit if none' },
    warnings: { type: 'array', items: { type: 'string' } },
    unresolvedConnections: { type: 'array', items: { type: 'string' } },
  },
  required: ['inputKind', 'components', 'warnings', 'unresolvedConnections'],
};

const PREFIX: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, MEG: 1e6, Meg: 1e6, meg: 1e6, G: 1e9,
};

/** "10k", "4.7kΩ", "1M", "5V", "4k7" -> SI number; null if unparseable or not > 0. */
export function parseSiValue(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s+/g, '');
  s = s.replace(/(ohms?|volts?|Ω|ω|V|v|R)$/, '');
  const rkm = /^(\d+)(MEG|Meg|meg|[pnuµμmkKMG])(\d+)$/.exec(s); // 4k7 notation
  if (rkm) s = `${rkm[1]}.${rkm[3]}${rkm[2]}`;
  const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?)(MEG|Meg|meg|[pnuµμmkKMG])?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const GROUND = new Set(['GND', 'GROUND', '0', 'EARTH', 'AGND', 'DGND']);
export function normalizeNode(name: string): string {
  const n = name.trim().toUpperCase();
  return GROUND.has(n) ? 'GND' : n;
}

function nullResult(
  inputKind: CandidateExtraction['inputKind'],
  warnings: string[],
  unresolvedConnections: string[] = [],
): CandidateExtraction {
  return { inputKind, graph: null, warnings, unresolvedConnections, requiresHumanReview: true };
}

/** Pure: validate + normalise raw model JSON into a CandidateExtraction. Never throws. */
export function toCandidateExtraction(raw: unknown): CandidateExtraction {
  const parsed = rawExtractionSchema.safeParse(raw);
  if (!parsed.success) return nullResult('unknown', ['Model output was malformed; enter the circuit manually.']);
  const r = parsed.data;
  const inputKind = (['schematic', 'breadboard_template'] as const).find((k) => k === r.inputKind) ?? 'unknown';
  const warnings = [...r.warnings];
  const fail = (msg: string) => nullResult(inputKind, [...warnings, msg], r.unresolvedConnections);

  const components: CircuitComponent[] = [];
  const ids = new Set<string>();
  let bad = false;
  for (const c of r.components) {
    const kind = c.kind.trim().toLowerCase();
    const mapped =
      kind === 'resistor'
        ? 'resistor'
        : ['dc_voltage', 'voltage_source', 'dc_source', 'battery'].includes(kind)
          ? 'dc_voltage'
          : null;
    if (!mapped) {
      warnings.push(`Unsupported component ignored: ${c.id} (${c.kind})`);
      continue;
    }
    const value = parseSiValue(c.value);
    const pos = c.positiveNode?.trim() ? normalizeNode(c.positiveNode) : '';
    const neg = c.negativeNode?.trim() ? normalizeNode(c.negativeNode) : '';
    const id = c.id.trim();
    if (value === null || !pos || !neg || !id || ids.has(id)) {
      warnings.push(`Component ${c.id || '(unnamed)'} has a missing/unreadable value, node or id`);
      bad = true;
      continue;
    }
    ids.add(id);
    components.push({ id, kind: mapped, value, positiveNode: pos, negativeNode: neg });
  }

  if (bad) return fail('Could not build a circuit: some components are incomplete.');
  if (!components.some((c) => c.kind === 'dc_voltage') || !components.some((c) => c.kind === 'resistor'))
    return fail('Need at least one resistor and one DC voltage source.');
  const nodes = new Set(components.flatMap((c) => [c.positiveNode, c.negativeNode]));
  if (!nodes.has('GND')) return fail('No ground node found.');
  if (!r.measureNode?.trim()) return fail('No explicit VOUT/measure node label found; choose the measure node manually.');
  const measureNode = normalizeNode(r.measureNode);
  if (!nodes.has(measureNode)) return fail(`Measure node ${measureNode} is not connected to any component.`);

  return {
    inputKind,
    graph: { schemaVersion: 1, components, groundNode: 'GND', measureNode },
    warnings,
    unresolvedConnections: r.unresolvedConnections,
    requiresHumanReview: true,
  };
}
