import { z } from 'zod';
import { LOADED_BRIDGE_12V } from '../../lib/circuit/fixtures';
import { solveDC } from '../../lib/circuit/solve';
import { probeStep } from '../../lib/probe';

export const DISCLAIMER =
  'Browser-only: nothing is stored on a server; no shared workspace, SSO, permissions or audit trail. Hypotheses are modeled, single-fault and uncalibrated. Content hash is an identifier, not a signature.';

const num = z.number().finite();
const graph = z.object({
  schemaVersion: z.literal(1),
  components: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['resistor', 'dc_voltage']),
      value: num,
      positiveNode: z.string(),
      negativeNode: z.string(),
      sourceBoundingBox: z.tuple([num, num, num, num]).optional(),
    }),
  ),
  groundNode: z.literal('GND'),
  measureNode: z.string(),
});

export const PacketSchema = z.object({
  schema: z.literal('ohmni.evidence.v1'),
  createdAt: z.string(),
  source: z.literal('build'),
  circuit: z.object({ name: z.string(), graph, provenance: z.string() }),
  predictions: z.object({ voltages: z.record(z.string(), num), currents: z.record(z.string(), num) }),
  observations: z.array(z.object({ node: z.string(), volts: num, at: z.string() })),
  hypotheses: z.array(z.object({ id: z.string(), title: z.string(), probability: num })),
  nextTest: z.object({ node: z.string(), instruction: z.string(), expectedBits: num }).optional(),
  repair: z
    .object({
      title: z.string(),
      patch: z.unknown(),
      before: z.record(z.string(), num),
      after: z.record(z.string(), num),
      status: z.enum(['hypothesized', 'verified', 'not_verified']),
      verification: z
        .object({ node: z.string(), expectVolts: num, toleranceVolts: num, measured: num.optional() })
        .optional(),
    })
    .optional(),
  assumptions: z.array(z.string()),
  safety: z.string(),
});
export type EvidencePacket = z.infer<typeof PacketSchema>;

/** Returns the packet or a human-readable error string. */
export function parsePacket(text: string): { ok: true; packet: EvidencePacket } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  const r = PacketSchema.safeParse(raw);
  if (r.success) return { ok: true, packet: r.data };
  return {
    ok: false,
    error:
      'Not a valid ohmni.evidence.v1 packet: ' +
      r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  };
}

/** EXAMPLE packet: every number comes from the solver / probeStep at call time. */
export function buildExamplePacket(now = new Date()): EvidencePacket {
  const g = LOADED_BRIDGE_12V;
  const { voltages, currents } = solveDC(g);
  const at = now.toISOString();
  const observations = [
    { node: 'C', volts: 0, at },
    { node: 'A', volts: 7.533, at },
  ];
  const step = probeStep(g, observations.map(({ node, volts }) => ({ node, volts })));
  return {
    schema: 'ohmni.evidence.v1',
    createdAt: at,
    source: 'build',
    circuit: {
      name: 'EXAMPLE: loaded bridge 12 V',
      graph: g,
      provenance: 'EXAMPLE packet generated in the browser from the built-in loaded-bridge fixture; observations are illustrative, not from a real bench.',
    },
    predictions: { voltages, currents },
    observations,
    hypotheses: step.hypotheses.slice(0, 5).map(({ id, title, probability }) => ({ id, title, probability })),
    nextTest: step.next
      ? { node: step.next.node, instruction: step.next.instruction, expectedBits: step.next.expectedBits }
      : undefined,
    assumptions: ['Ideal resistors and source; DC steady state.', 'Single fault only.', 'Observation values are example inputs.'],
    safety: step.safety,
  };
}

export async function contentHash(p: EvidencePacket): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const fmt = (v: number) => `${+v.toPrecision(4)}`;

export function residuals(p: EvidencePacket) {
  return p.observations.map((o) => {
    const pred = p.predictions.voltages[o.node];
    return { node: o.node, observed: o.volts, predicted: pred, residual: pred === undefined ? undefined : o.volts - pred };
  });
}

export function toMarkdown(p: EvidencePacket, hash: string, notes: string, questions: string[]): string {
  const L: string[] = [];
  L.push(`# Review: ${p.circuit.name}`, '', `> ${DISCLAIMER}`, '');
  L.push(`- Packet created: ${p.createdAt}`, `- Provenance: ${p.circuit.provenance}`, `- Content hash (SHA-256, first 16 hex; identifier, not a signature): ${hash}`, '');
  L.push('## Observed vs predicted (volts)', '', '| Node | Observed | Predicted | Residual |', '|---|---|---|---|');
  for (const r of residuals(p))
    L.push(`| ${r.node} | ${fmt(r.observed)} | ${r.predicted === undefined ? 'n/a' : fmt(r.predicted)} | ${r.residual === undefined ? 'n/a' : fmt(r.residual)} |`);
  L.push('', '## Hypotheses (modeled, single-fault, uncalibrated)', '');
  p.hypotheses.forEach((h, i) => L.push(`${i + 1}. ${h.title}: ${fmt(h.probability * 100)}%`));
  L.push('', '## Recommended follow-up test', '');
  L.push(p.nextTest ? `${p.nextTest.instruction} (node ${p.nextTest.node}, expected information ${fmt(p.nextTest.expectedBits)} bits)` : 'None in packet.');
  L.push('', '## Repair', '');
  if (p.repair) {
    L.push(`- ${p.repair.title}`, `- Status (as in packet): ${p.repair.status}`);
    const rows = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
    L.push(`- Before: ${rows(p.repair.before)}`, `- After: ${rows(p.repair.after)}`);
    const v = p.repair.verification;
    if (v) L.push(`- Verification: node ${v.node}, expect ${fmt(v.expectVolts)} V +/- ${fmt(v.toleranceVolts)} V, measured ${v.measured === undefined ? 'not measured' : fmt(v.measured)}`);
  } else L.push('None in packet.');
  L.push('', '## Assumptions and unresolved questions', '');
  p.assumptions.forEach((a) => L.push(`- Assumption: ${a}`));
  questions.forEach((q) => L.push(`- Open question: ${q}`));
  L.push('', '## Reviewer notes (local)', '', notes.trim() || '(none)', '', '## Safety', '', p.safety, '');
  return L.join('\n');
}
