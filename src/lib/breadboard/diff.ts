import type { CircuitGraph } from '@/lib/circuit/types';
import { stripIdOfHole } from './board';
import { buildNetIndex } from './connectivity';
import type { BuildState, HoleId, Net, Placement, Terminal } from './types';

export type ComponentDiff = {
  componentId: string;
  issue: 'missing' | 'extra' | 'kind_mismatch' | 'value_mismatch';
  intended?: { kind: string; value: number };
  observed?: { kind: string; value: number };
};
export type ConnectionDiff = {
  componentId: string;
  terminal: Terminal;
  intendedNode: string;
  observedNode: string; // intended node whose net this pin actually sits on, else probe label / net id
  holes: HoleId[]; // physical holes implicated, for UI highlighting
  kind: 'wrong_net' | 'short';
};
export type BreadboardDiff = {
  componentDiffs: ComponentDiff[];
  connectionDiffs: ConnectionDiff[];
  identical: boolean;
  uncertainties: string[];
};

type Entry = { id: string; p: Placement; t: Terminal; node: string; net: Net | null; hole: HoleId };

/**
 * Compare a build to the intended graph. Components match by refdes. Intended nodes are matched to
 * physical nets by terminal incidence (majority of placed terminals; GND pinned to the declared ground
 * net; ties broken by probe label, then first terminal). Resistor leads are symmetric, so a flipped
 * resistor is not a diff.
 */
export function diffAgainstIntended(intended: CircuitGraph, build: BuildState): BreadboardDiff {
  const { board } = build;
  const idx = buildNetIndex(build);
  const uncertainties = [...idx.errors];
  const componentDiffs: ComponentDiff[] = [];
  const placed = new Map(build.placements.map((p) => [p.id, p]));
  const kindOf = (k: string) => (k === 'dc_voltage' ? 'dc_supply' : k);

  const entries: Entry[] = [];
  for (const c of intended.components) {
    const p = placed.get(c.id);
    if (!p) {
      componentDiffs.push({ componentId: c.id, issue: 'missing', intended: { kind: c.kind, value: c.value } });
      continue;
    }
    if (kindOf(c.kind) !== p.kind)
      componentDiffs.push({ componentId: c.id, issue: 'kind_mismatch', intended: { kind: c.kind, value: c.value }, observed: { kind: p.kind, value: p.value } });
    else if (c.value !== p.value)
      componentDiffs.push({ componentId: c.id, issue: 'value_mismatch', intended: { kind: c.kind, value: c.value }, observed: { kind: p.kind, value: p.value } });
    for (const t of ['positive', 'negative'] as const)
      entries.push({ id: c.id, p, t, node: t === 'positive' ? c.positiveNode : c.negativeNode, net: idx.netOfHole(p.pins[t]), hole: p.pins[t] });
  }
  const intendedIds = new Set(intended.components.map((c) => c.id));
  for (const p of build.placements)
    if (!intendedIds.has(p.id)) componentDiffs.push({ componentId: p.id, issue: 'extra', observed: { kind: p.kind, value: p.value } });

  // Ground reference.
  let gnd = build.groundNet !== undefined ? idx.netOfHole(build.groundNet) : null;
  if (!gnd) {
    const s = build.placements.find((p) => p.kind === 'dc_supply');
    gnd = s ? idx.netOfHole(s.pins.negative) : null;
    uncertainties.push('no valid groundNet declared; GND assumed to be the supply negative net');
  }

  const probeNet = (node: string) => {
    const h = build.probeHoles?.[node];
    return h ? idx.netOfHole(h) : null;
  };

  function matchNodes(es: Entry[]) {
    const nodeNet = new Map<string, Net | null>([['GND', gnd]]);
    const claimedBy = new Map<string, string>(); // netId -> node
    const collided = new Set<string>();
    if (gnd) claimedBy.set(gnd.id, 'GND');
    const nodes = [...new Set(es.map((e) => e.node))].filter((n) => n !== 'GND');
    for (const node of nodes) {
      const votes = new Map<string, { net: Net; n: number }>();
      for (const e of es) if (e.node === node && e.net) votes.set(e.net.id, { net: e.net, n: (votes.get(e.net.id)?.n ?? 0) + 1 });
      const label = probeNet(node);
      const ranked = [...votes.values()].sort((a, b) => b.n - a.n || Number(b.net.id === label?.id) - Number(a.net.id === label?.id));
      if (ranked.length > 1 && ranked[0].n === ranked[1].n)
        uncertainties.push(`node ${node}: terminals split evenly across nets; chose ${ranked[0].net.id}${label ? ' (probe label)' : ' (first terminal)'}`);
      const pick = ranked.find((r) => !claimedBy.has(r.net.id)) ?? ranked[0];
      if (!pick) continue;
      nodeNet.set(node, pick.net);
      if (claimedBy.has(pick.net.id)) collided.add(node);
      else claimedBy.set(pick.net.id, node);
    }
    return { nodeNet, claimedBy, collided };
  }

  let m = matchNodes(entries);
  // Resistor symmetry: swap leads of a resistor only if that strictly reduces its mismatches.
  const byId = new Map<string, Entry[]>();
  for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  let flipped = false;
  for (const [, [pos, neg]] of byId) {
    if (pos.p.kind !== 'resistor') continue;
    const direct = Number(pos.net !== m.nodeNet.get(pos.node)) + Number(neg.net !== m.nodeNet.get(neg.node));
    const swapped = Number(neg.net !== m.nodeNet.get(pos.node)) + Number(pos.net !== m.nodeNet.get(neg.node));
    if (swapped < direct) {
      [pos.net, neg.net] = [neg.net, pos.net];
      [pos.hole, neg.hole] = [neg.hole, pos.hole];
      flipped = true;
    }
  }
  if (flipped) m = matchNodes(entries);
  const { nodeNet, claimedBy, collided } = m;

  const nameOf = (n: Net | null) => (n ? (claimedBy.get(n.id) ?? Object.entries(build.probeHoles ?? {}).find(([, h]) => idx.netOfHole(h)?.id === n.id)?.[0] ?? n.id) : '(invalid hole)');
  const connectionDiffs: ConnectionDiff[] = [];
  for (const e of entries) {
    const want = nodeNet.get(e.node);
    const isShort = collided.has(e.node) && !!e.net && claimedBy.has(e.net.id) && claimedBy.get(e.net.id) !== e.node;
    if (!isShort && e.net && want && e.net.id === want.id) continue;
    if (!isShort && e.net && !want) continue; // node has no reference net to compare against
    let holes: HoleId[];
    if (isShort) {
      const loserStrips = new Set(entries.filter((x) => x.node === e.node).map((x) => stripIdOfHole(board, x.hole)));
      const stray = build.jumpers.filter((j) => loserStrips.has(stripIdOfHole(board, j.a)) || loserStrips.has(stripIdOfHole(board, j.b))).flatMap((j) => [j.a, j.b]);
      holes = [e.hole, ...stray];
    } else {
      holes = [e.hole, ...entries.filter((x) => x.node === e.node && x !== e).map((x) => x.hole)];
    }
    connectionDiffs.push({
      componentId: e.id,
      terminal: e.t,
      intendedNode: e.node,
      observedNode: nameOf(e.net),
      holes: [...new Set(holes)],
      kind: isShort ? 'short' : 'wrong_net',
    });
  }

  return { componentDiffs, connectionDiffs, identical: !componentDiffs.length && !connectionDiffs.length, uncertainties };
}
