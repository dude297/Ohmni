import { validateGraph } from '@/lib/circuit/validate';
import type { CircuitGraph } from '@/lib/circuit/types';
import { stripIdOfHole } from './board';
import { buildNetIndex } from './connectivity';
import type { BuildState } from './types';

export type ToGraphOpts = { measureNode?: string; nodeNames?: Record<string, string> /* netId -> name */ };
export type ToGraphResult = {
  graph: CircuitGraph | null;
  netOfPin: Record<string, { netId: string }>; // key 'R6.positive'
  errors: string[];
  warnings: string[];
  nodeOfNet: Record<string, string>; // netId -> graph node name (nets that hold a component pin)
  probeNodes: Record<string, string>; // probe label -> graph node name
};

export function toCircuitGraph(state: BuildState, opts: ToGraphOpts = {}): ToGraphResult {
  const { errors: buildErrors, netOfHole } = buildNetIndex(state);
  const errors = [...buildErrors];
  const warnings: string[] = [];
  const netOfPin: ToGraphResult['netOfPin'] = {};
  const pinCount = new Map<string, number>();
  const pinOrder: string[] = []; // netIds by first pin use, for deterministic N1..Nk

  for (const p of state.placements)
    for (const t of ['positive', 'negative'] as const) {
      const n = netOfHole(p.pins[t]);
      if (!n) continue;
      netOfPin[`${p.id}.${t}`] = { netId: n.id };
      if (!pinCount.has(n.id)) pinOrder.push(n.id);
      pinCount.set(n.id, (pinCount.get(n.id) ?? 0) + 1);
    }

  const gndNet = state.groundNet !== undefined ? netOfHole(state.groundNet) : null;
  if (state.groundNet === undefined) errors.push('groundNet not set');

  const name = new Map<string, string>(); // netId -> node name
  if (gndNet) name.set(gndNet.id, 'GND');
  const probeNodes: Record<string, string> = {};
  for (const [label, h] of Object.entries(state.probeHoles ?? {})) {
    const n = netOfHole(h);
    if (!n) continue;
    if (label === 'GND' && n.id !== gndNet?.id) {
      warnings.push('probe label "GND" is not on the ground net; ignored');
      continue;
    }
    const have = name.get(n.id);
    if (have) {
      if (have !== label && have !== 'GND') warnings.push(`probes ${have} and ${label} are on the same net; using ${have}`);
    } else {
      name.set(n.id, label);
    }
    probeNodes[label] = name.get(n.id)!;
    if (!pinCount.has(n.id)) warnings.push(`probe ${label} (${h}) is on a net with no component pins`);
  }
  for (const [netId, nm] of Object.entries(opts.nodeNames ?? {})) if (pinCount.has(netId) && netId !== gndNet?.id) name.set(netId, nm);
  const taken = new Set(name.values());
  let k = 0;
  for (const id of pinOrder) {
    if (name.has(id)) continue;
    let nm: string;
    do nm = `N${++k}`;
    while (taken.has(nm));
    name.set(id, nm);
    taken.add(nm);
  }

  for (const [pin, { netId }] of Object.entries(netOfPin))
    if (pinCount.get(netId) === 1 && netId !== gndNet?.id) warnings.push(`${pin}: unconnected pin`);

  const components: CircuitGraph['components'] = [];
  for (const p of state.placements) {
    const a = netOfPin[`${p.id}.positive`];
    const b = netOfPin[`${p.id}.negative`];
    if (!a || !b) continue;
    if (a.netId === b.netId) {
      const oneStrip = stripIdOfHole(state.board, p.pins.positive) === stripIdOfHole(state.board, p.pins.negative);
      const msg = `${p.id}: component shorted by placement (both pins on one ${oneStrip ? 'strip' : 'net'})`;
      // A shorted resistor carries no current, so dropping it from the solve is exact.
      if (p.kind === 'resistor') warnings.push(`${msg}; omitted from solve`);
      else errors.push(msg);
      continue;
    }
    components.push({
      id: p.id,
      kind: p.kind === 'dc_supply' ? 'dc_voltage' : 'resistor',
      value: p.value,
      positiveNode: name.get(a.netId)!,
      negativeNode: name.get(b.netId)!,
    });
  }

  const measureNode =
    opts.measureNode ??
    Object.keys(state.probeHoles ?? {})
      .map((l) => probeNodes[l])
      .find((n) => n && n !== 'GND') ??
    components.flatMap((c) => [c.positiveNode, c.negativeNode]).find((n) => n !== 'GND') ??
    'GND';

  let graph: CircuitGraph | null = null;
  if (!errors.length) {
    const v = validateGraph({ schemaVersion: 1, components, groundNode: 'GND', measureNode });
    if (v.ok) graph = v.graph;
    else errors.push(...v.errors);
  }
  const nodeOfNet: Record<string, string> = {};
  for (const id of pinCount.keys()) nodeOfNet[id] = name.get(id)!;
  return { graph, netOfPin, errors, warnings, nodeOfNet, probeNodes };
}
