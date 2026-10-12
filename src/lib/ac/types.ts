// AC small-signal circuit graph (schemaVersion 2). Separate from the DC CircuitGraph (schemaVersion 1).
export type AcComponent =
  | { id: string; kind: 'resistor'; value: number; a: string; b: string }
  | { id: string; kind: 'capacitor'; value: number; a: string; b: string }
  | { id: string; kind: 'inductor'; value: number; a: string; b: string }
  | { id: string; kind: 'ac_source'; amplitude: 1; a: string; b: string };

export type AcGraph = {
  schemaVersion: 2;
  components: AcComponent[];
  groundNode: 'GND';
  outputNode: string;
};

export type MeasuredPoint = { freqHz: number; magDb: number };
export type Curve = { freq: number[]; magDb: number[]; phaseDeg: number[] };
export type Prediction = { candidateId: string; value: number; unit: string };
export type Candidate = Curve & { id: string; title: string; fitError?: number };
export type Discriminator = {
  instruction: string;
  predictions: Prediction[];
  alternative?: { instruction: string; predictions: Prediction[] };
};
export type AcResult = {
  nominal: Curve;
  candidates?: Candidate[];
  discriminator?: Discriminator;
  trace: { step: 'ac'; provider: 'ngspice'; model: string; durationMs: number; status: 'ok' | 'error' }[];
};

export const LIMITS = {
  maxComponents: 12,
  range: { resistor: [1, 1e7], capacitor: [1e-12, 1e-2], inductor: [1e-9, 10] } as const,
  fMin: 1,
  fMax: 1e7,
  maxPtsPerDecade: 50,
  defaultPtsPerDecade: 20,
};

const NAME = /^[\x20-\x7e]{1,32}$/; // printable ASCII; names are only ever mapped through a table, never printed

/** Returns error strings (empty = valid). Does not trust any field. */
export function validateAcGraph(g: unknown): string[] {
  const e: string[] = [];
  if (typeof g !== 'object' || g === null) return ['graph must be an object'];
  const o = g as Record<string, unknown>;
  if (o.schemaVersion !== 2) e.push('schemaVersion must be 2');
  if (o.groundNode !== 'GND') e.push("groundNode must be 'GND'");
  if (typeof o.outputNode !== 'string' || !NAME.test(o.outputNode)) e.push('outputNode must be a short printable string');
  if (!Array.isArray(o.components)) return [...e, 'components must be an array'];
  if (o.components.length < 2 || o.components.length > LIMITS.maxComponents)
    e.push(`components must have 2..${LIMITS.maxComponents} entries`);
  const ids = new Set<string>();
  const nodes = new Set<string>();
  let sources = 0;
  for (const [i, c] of (o.components as unknown[]).slice(0, 64).entries()) {
    const k = c as Record<string, unknown> | null;
    if (typeof k !== 'object' || k === null) {
      e.push(`components[${i}] must be an object`);
      continue;
    }
    if (typeof k.id !== 'string' || !NAME.test(k.id)) e.push(`components[${i}].id must be a short printable string`);
    else if (ids.has(k.id)) e.push(`duplicate id at components[${i}]`);
    else ids.add(k.id);
    for (const n of ['a', 'b'] as const) {
      if (typeof k[n] !== 'string' || !NAME.test(k[n] as string))
        e.push(`components[${i}].${n} must be a short printable string`);
      else nodes.add(k[n] as string);
    }
    if (k.a === k.b) e.push(`components[${i}] has both terminals on the same node`);
    if (k.kind === 'ac_source') {
      sources++;
      if (k.amplitude !== 1) e.push(`components[${i}].amplitude must be 1`);
    } else if (k.kind === 'resistor' || k.kind === 'capacitor' || k.kind === 'inductor') {
      const [lo, hi] = LIMITS.range[k.kind];
      if (typeof k.value !== 'number' || !Number.isFinite(k.value) || k.value < lo || k.value > hi)
        e.push(`components[${i}].value must be within ${lo}..${hi}`);
    } else e.push(`components[${i}].kind is not supported`);
  }
  if (sources !== 1) e.push('exactly one ac_source is required');
  if (!nodes.has('GND')) e.push('circuit must use node GND');
  if (typeof o.outputNode === 'string' && (o.outputNode === 'GND' || !nodes.has(o.outputNode)))
    e.push('outputNode must be a non-ground node used by a component');
  return e;
}
