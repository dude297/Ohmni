import { z } from 'zod';
import type { CircuitGraph } from '../circuit/types';
import { solveDC } from '../circuit/solve';
import { validateGraph } from '../circuit/validate';

// RESEARCH PoC (research/topology-confidence-moonshot). Not wired into any route.
// Idea: make the vision model enumerate every place wires meet (with bbox + dot present?) so a confident
// graph can be cross-checked against its own junction self-report, then decide deterministically which
// junctions need a second look or a user question. Graph validation alone CANNOT establish what the image
// connected; this only surfaces where the reading could be wrong and whether it matters.

export const CROSSING_REPORT_PROMPT = `Also audit every place in the image where two or more wire lines meet or cross.
Add to the JSON:
- junctions: one entry per meeting/crossing point:
  { "id": "J1", "bbox": [x0,y0,x1,y1] normalised 0..1 of the image, "shape": "crossing" (4 arms, lines pass through) | "tee" (3 arms) | "corner" (2 arms) | "unclear",
    "dot": true if a filled junction dot is drawn there, false if clearly no dot, null if you cannot tell,
    "treatedAsConnected": true if your components/nodes above treat these wires as the same node,
    "nodes": the node names (from your components) of the wires meeting there }
- danglingEnds: wire ends not attached to a component, junction or label: { "bbox": [...], "note": "..." }
- componentBoxes: { "<component id>": [x0,y0,x1,y1] } normalised 0..1
Report crossings even if you are sure about them.`;

const num = z.coerce.number(); // flash-lite returned bbox numbers as strings once
const bbox = z.tuple([num, num, num, num]);
export const junctionReportSchema = z.object({
  junctions: z
    .array(
      z.object({
        id: z.string().default('J?'),
        bbox: bbox.nullable().optional(),
        shape: z.string().default('unclear'),
        dot: z.boolean().nullable().optional(),
        treatedAsConnected: z.boolean().nullable().optional(),
        nodes: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  danglingEnds: z.array(z.object({ bbox: bbox.nullable().optional(), note: z.string().default('') })).default([]),
  componentBoxes: z.record(z.string(), bbox).default({}).catch({}), // boxes are optional evidence; never fail the report on them
});
export type JunctionReport = z.infer<typeof junctionReportSchema>;

export type Suspect = {
  kind: 'dotless_crossing_connected' | 'dotless_crossing' | 'unclear_junction' | 'dangling_end' | 'node_mismatch';
  junctionId?: string;
  bbox?: [number, number, number, number] | null;
  reason: string;
  /** VOUT change (V) if this junction were read the other way; null = could not compute. */
  measureDelta?: number | null;
  question?: string; // user-facing "connected / not connected" question
};
export type Escalation = 'accept' | 'ask_user' | 'verify_region';
export type TopologyAssessment = { suspects: Suspect[]; escalation: Escalation; reportParsed: boolean };

const up = (s: string) => {
  const n = s.trim().toUpperCase();
  return ['GROUND', '0'].includes(n) ? 'GND' : n;
};

function measureV(g: CircuitGraph): number | null {
  const v = validateGraph(g);
  if (!v.ok) return null;
  try {
    const sol = solveDC(v.graph);
    return g.measureNode === 'GND' ? 0 : (sol.voltages[g.measureNode] ?? null);
  } catch {
    return null; // singular matrix, e.g. source shorted by the merge
  }
}

/** Counterfactual: merge node b into a. Infinity = merge makes the circuit unsolvable (e.g. shorts the source). */
export function mergeDelta(g: CircuitGraph, x: string, y: string): number | null {
  const [a, b] = y === 'GND' ? [y, x] : [x, y]; // keep GND as the surviving name
  const base = measureV(g);
  if (base === null) return null;
  const ren = (n: string) => (n === b ? a : n);
  const merged: CircuitGraph = {
    ...g,
    measureNode: ren(g.measureNode),
    components: g.components
      .map((c) => ({ ...c, positiveNode: ren(c.positiveNode), negativeNode: ren(c.negativeNode) }))
      // ponytail: a resistor collapsed onto one node is shorted out; drop it. A collapsed source = impossible.
      .filter((c) => c.kind !== 'resistor' || c.positiveNode !== c.negativeNode),
  };
  if (merged.components.some((c) => c.kind === 'dc_voltage' && c.positiveNode === c.negativeNode)) return Infinity;
  const v = measureV(merged);
  return v === null ? Infinity : Math.abs(v - base);
}

const MATTERS_V = 0.01; // ponytail: 10 mV threshold, fixed; make relative to source voltage if circuits get bigger

/** Pure, deterministic. Combines the graph with the model's own junction self-report. Never throws. */
export function assessTopology(graph: CircuitGraph | null, rawReport: unknown): TopologyAssessment {
  const parsed = junctionReportSchema.safeParse(rawReport ?? {});
  if (!parsed.success) {
    return { suspects: [{ kind: 'unclear_junction', reason: 'junction report missing/malformed' }], escalation: 'verify_region', reportParsed: false };
  }
  const r = parsed.data;
  const suspects: Suspect[] = [];
  const graphNodes = new Set(graph?.components.flatMap((c) => [c.positiveNode, c.negativeNode]) ?? []);

  for (const j of r.junctions) {
    const nodes = [...new Set(j.nodes.map(up))];
    const unknown = nodes.filter((n) => graph && !graphNodes.has(n));
    if (unknown.length) suspects.push({ kind: 'node_mismatch', junctionId: j.id, bbox: j.bbox, reason: `junction names node(s) ${unknown.join(', ')} not in the graph` });

    const crossing = j.shape === 'crossing';
    if (j.dot == null || j.shape === 'unclear') {
      suspects.push({ kind: 'unclear_junction', junctionId: j.id, bbox: j.bbox, reason: 'model could not tell whether a junction dot is drawn', question: `Is junction ${j.id} connected?` });
    } else if (crossing && !j.dot) {
      const connected = j.treatedAsConnected ?? nodes.length === 1;
      let delta: number | null = null;
      if (!connected && graph && nodes.length === 2) delta = mergeDelta(graph, nodes[0], nodes[1]);
      suspects.push({
        kind: connected ? 'dotless_crossing_connected' : 'dotless_crossing',
        junctionId: j.id,
        bbox: j.bbox,
        reason: connected
          ? 'wires cross without a dot but the graph joins them (convention says NOT connected)'
          : 'wires cross without a dot; read as not connected',
        measureDelta: delta,
        question: `Do the wires crossing at ${j.id} connect? (drawn without a dot)`,
      });
    }
  }
  for (const d of r.danglingEnds) suspects.push({ kind: 'dangling_end', bbox: d.bbox, reason: `dangling wire end: ${d.note}`.trim() });

  // Escalation: a reading the convention contradicts, or one whose flip changes VOUT, needs evidence.
  // A dotless crossing read as open whose flip does not change VOUT is harmless; just surface it.
  const consequential = suspects.filter(
    (s) =>
      s.kind === 'dotless_crossing_connected' ||
      s.kind === 'unclear_junction' ||
      (s.kind === 'dotless_crossing' && (s.measureDelta == null || s.measureDelta > MATTERS_V)),
  );
  const askable = suspects.some((s) => s.kind === 'dangling_end' || s.kind === 'node_mismatch');
  const escalation: Escalation = !graph ? 'ask_user' : consequential.length ? 'verify_region' : askable ? 'ask_user' : 'accept';
  return { suspects, escalation, reportParsed: true };
}

/** Pixel crop (with margin) for a normalised bbox; for sending a suspect region to a second model. */
export function cropRect(b: [number, number, number, number], w: number, h: number, marginFrac = 0.06) {
  const [x0, y0, x1, y1] = b.map((v) => Math.min(1, Math.max(0, v)));
  const mx = marginFrac * w, my = marginFrac * h;
  const left = Math.max(0, Math.floor(Math.min(x0, x1) * w - mx));
  const top = Math.max(0, Math.floor(Math.min(y0, y1) * h - my));
  const right = Math.min(w, Math.ceil(Math.max(x0, x1) * w + mx));
  const bottom = Math.min(h, Math.ceil(Math.max(y0, y1) * h + my));
  return { left, top, width: right - left, height: bottom - top };
}
