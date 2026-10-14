import { observe } from '@/lib/server/observe';
import { readJson, bodyErrorResponse } from '@/lib/server/readBody';
import { z } from 'zod';
import { circuitGraphSchema, validateGraph } from '../../../lib/circuit/validate';
import { importNetlist } from '../../../lib/netlist';
import { analyzeTwin, type DesignProvenance } from '../../../lib/twin';
import type { CircuitGraph } from '../../../lib/circuit/types';

const MAX_NETLIST_BYTES = 64 * 1024;
const netlistIntended = z.object({
  netlist: z.string().refine((s) => new TextEncoder().encode(s).length <= MAX_NETLIST_BYTES, 'netlist must be at most 64 KB'),
  format: z.enum(['spice', 'kicad']).optional(),
  measureNode: z.string().min(1).optional(),
});
const body = z.object({
  intended: z.unknown(),
  observed: z.unknown(),
  observedProvenance: z.object({ kind: z.enum(['human_review', 'image_extraction', 'manual']), note: z.string().max(500).optional() }),
  userConfirmed: z.unknown(),
  observations: z.array(z.object({ node: z.string().min(1), volts: z.number().finite() })).max(50).default([]),
});

const err = (status: number, code: string, message: string, details?: string[]) =>
  Response.json({ error: { code, message, ...(details && { details }) } }, { status });

async function handle(req: Request) {
  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (e) {
    return bodyErrorResponse(e);
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success)
    return err(422, 'INVALID_REQUEST', 'Invalid request body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  if (parsed.data.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the observed circuit before comparing');

  // Intended: a graph, or a netlist imported through the (directive-rejecting, file-access-free) importer.
  let intended: CircuitGraph;
  let provenance: DesignProvenance;
  const nl = netlistIntended.safeParse(parsed.data.intended);
  if (nl.success) {
    const r = importNetlist(nl.data.netlist, { format: nl.data.format, measureNode: nl.data.measureNode });
    if (r.rejected.length)
      return err(422, 'INVALID_REQUEST', 'Netlist import rejected unsupported lines', r.rejected.map((x) => `line ${x.line}: ${x.text} (${x.reason})`));
    if (!r.graph) return err(422, 'INVALID_GRAPH', 'Imported netlist is not a valid circuit', r.errors);
    intended = r.graph;
    provenance = { kind: r.format, name: `netlist.${r.format === 'kicad' ? 'net' : 'cir'}`, warnings: r.warnings };
  } else {
    if (parsed.data.intended && typeof parsed.data.intended === 'object' && 'netlist' in parsed.data.intended)
      return err(422, 'INVALID_REQUEST', 'Invalid intended netlist', nl.error.issues.map((i) => `intended.${i.path.join('.')}: ${i.message}`));
    const v = validateGraph(parsed.data.intended);
    if (!v.ok) return err(422, 'INVALID_GRAPH', 'Intended circuit graph is invalid', v.errors);
    intended = v.graph;
    provenance = { kind: 'fixture', name: 'inline-graph', warnings: [] };
  }

  // Observed: must be structurally a graph; topology/solvability problems are reported in the result, not rejected.
  const shape = circuitGraphSchema.safeParse(parsed.data.observed);
  if (!shape.success) return err(422, 'INVALID_GRAPH', 'Observed circuit graph is invalid', shape.error.issues.map((i) => `observed.${i.path.join('.') || 'graph'}: ${i.message}`));

  const known = new Set(intended.components.flatMap((c) => [c.positiveNode, c.negativeNode]));
  const unknown = parsed.data.observations.filter((o) => !known.has(o.node));
  if (unknown.length) return err(422, 'INVALID_REQUEST', 'Observations reference nodes not in the intended design', unknown.map((o) => `unknown node "${o.node}"`));

  const t0 = performance.now();
  try {
    const a = analyzeTwin(intended, shape.data as CircuitGraph, parsed.data.observations);
    return Response.json({
      result: {
        intended: { graph: intended, provenance },
        ...a,
        trace: [{ step: 'twin', provider: 'local', model: 'mna-dc', durationMs: Math.round(performance.now() - t0), status: 'ok' }],
      },
    });
  } catch (e) {
    return err(422, 'UNSOLVABLE', e instanceof Error ? e.message : 'Intended circuit could not be solved');
  }
}

export const POST = observe('/api/twin', handle);
