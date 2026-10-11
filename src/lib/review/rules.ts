import type { CircuitGraph } from '../circuit/types';

// Deterministic structural rules for "Review my circuit". No model, no network.
export type Severity = 'error' | 'warning' | 'info';
export type Category =
  | 'floating_node' | 'supply_short' | 'supply_conflict' | 'ground_reference' | 'open_or_unconnected'
  | 'power_dissipation' | 'value_mismatch' | 'connectivity_mismatch' | 'unsolvable';
export type Finding = {
  id: string;
  severity: Severity;
  category: Category;
  components: string[];
  nodes: string[];
  evidence: { statement: string; numbers: Record<string, number> }; // numbers come from validator/solver only
  basis: 'rule' | 'simulation' | 'design_diff';
  assumptions?: string[];
};

export const mk = (
  severity: Severity, category: Category, components: string[], nodes: string[], statement: string,
  numbers: Record<string, number> = {}, basis: Finding['basis'] = 'rule', assumptions?: string[],
): Finding => ({
  id: `${category}:${[...components, ...nodes].join(',') || 'circuit'}`,
  severity, category, components, nodes, evidence: { statement, numbers }, basis, ...(assumptions && { assumptions }),
});

export const scopeFinding = (): Finding => ({ ...mk('info', 'unsolvable', [], [], SCOPE_NOTE), id: 'scope_note' });
export const SCOPE_NOTE =
  'Scope: resistors and DC voltage sources only. LED/semiconductor checks are not supported; such kinds are rejected by validation.';

/** Map validateGraph error strings (it never throws) to findings. */
export function mapValidationErrors(errors: string[], raw: unknown): Finding[] {
  const kinds = new Map<string, string>();
  const comps = (raw as { components?: unknown })?.components;
  if (Array.isArray(comps)) for (const c of comps) if (c && typeof c.id === 'string') kinds.set(c.id, String(c.kind));
  return errors.map((e) => {
    let m: RegExpMatchArray | null;
    if ((m = e.match(/^(.+): both terminals on node "(.*)"/))) {
      const src = kinds.get(m[1]) === 'dc_voltage';
      return mk('error', src ? 'supply_short' : 'unsolvable', [m[1]], [m[2]],
        src ? `${m[1]} has both terminals on node "${m[2]}": the supply is shorted.` : e);
    }
    if (e.startsWith('GND does not')) return mk('error', 'ground_reference', [], ['GND'], 'No component connects to GND, so there is no 0 V reference.');
    if ((m = e.match(/^node "(.*)" is floating/))) return mk('error', 'floating_node', [], [m[1]], `Node "${m[1]}" has no path to GND.`);
    if (/dc_voltage source required/.test(e)) return mk('error', 'unsolvable', [], [], 'No DC voltage source: nothing drives the circuit.');
    if (/kind/i.test(e)) return mk('error', 'unsolvable', [], [], `${e}. ${SCOPE_NOTE}`);
    return mk('error', 'unsolvable', [], [], e);
  });
}

/** Direct shorts, conflicting parallel sources, ambiguous ground naming, single-terminal nodes. Graph must be valid. */
export function structuralFindings(g: CircuitGraph): Finding[] {
  const out: Finding[] = [];
  const sources = g.components.filter((c) => c.kind === 'dc_voltage');
  const res = g.components.filter((c) => c.kind === 'resistor');

  // shorts: series-resistance shortest path between a source's terminals (other sources ignored)
  // ponytail: series paths only; a parallel-combination short is not detected
  for (const s of sources) {
    const dist = new Map<string, number>([[s.positiveNode, 0]]);
    for (let i = 0; i < g.components.length; i++)
      for (const r of res)
        for (const [a, b] of [[r.positiveNode, r.negativeNode], [r.negativeNode, r.positiveNode]]) {
          const d = dist.get(a);
          if (d !== undefined && d + r.value < (dist.get(b) ?? Infinity)) dist.set(b, d + r.value);
        }
    const path = dist.get(s.negativeNode);
    if (path !== undefined && path <= 1e-3)
      out.push(mk('error', 'supply_short', [s.id], [s.positiveNode, s.negativeNode],
        `${s.id} is joined across its terminals by a path of ${path} ohm (<= 1 mohm): effectively a short circuit.`,
        { sourceVoltageV: s.value, pathResistanceOhm: path }, 'rule', ['Wires are ideal; only resistor paths are summed in series.']));
  }

  // parallel sources
  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    const k = [s.positiveNode, s.negativeNode].sort().join('|');
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    const ref = grp[0];
    const v = grp.map((s) => (s.positiveNode === ref.positiveNode ? s.value : -s.value));
    const same = v.every((x) => Math.abs(x - v[0]) < 1e-9);
    const numbers = Object.fromEntries(grp.map((s, i) => [`${s.id}_V`, v[i]]));
    const ids = grp.map((s) => s.id);
    const nodes = [ref.positiveNode, ref.negativeNode];
    out.push(same
      ? mk('warning', 'supply_conflict', ids, nodes, `${ids.join(' and ')} are ideal sources of equal voltage in parallel: how they share current is undefined.`, numbers)
      : mk('error', 'supply_conflict', ids, nodes, `${ids.join(' and ')} force different voltages across the same two nodes (KVL violated).`, numbers));
  }

  // ambiguous ground: other node names that look like ground
  const names = new Set(g.components.flatMap((c) => [c.positiveNode, c.negativeNode]));
  for (const n of names)
    if (n !== 'GND' && /^(0|gnd|ground|vss)$/i.test(n))
      out.push(mk('warning', 'ground_reference', [], [n], `Node "${n}" looks like a ground but is a different node from GND; only "GND" is the 0 V reference.`));

  // single-terminal nodes (measureNode excepted: a probe point may legitimately be an end node)
  const deg = new Map<string, string[]>();
  for (const c of g.components) for (const n of [c.positiveNode, c.negativeNode]) deg.set(n, [...(deg.get(n) ?? []), c.id]);
  for (const [n, ids] of deg)
    if (ids.length === 1 && n !== 'GND' && n !== g.measureNode)
      out.push(mk('warning', 'floating_node', ids, [n], `Node "${n}" connects to only ${ids[0]}; nothing completes the path, so ${ids[0]} carries no current.`));
  return out;
}
