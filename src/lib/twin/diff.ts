import type { CircuitComponent, CircuitGraph } from '../circuit/types';
import type { ComponentDiff, ConnectionDiff, TwinDiff } from './types';

const TERMS = ['positive', 'negative'] as const;
type Term = (typeof TERMS)[number];
const nodeOf = (c: CircuitComponent, t: Term) => (t === 'positive' ? c.positiveNode : c.negativeNode);
const other = (t: Term): Term => (t === 'positive' ? 'negative' : 'positive');

/**
 * Compare intended vs observed by refdes. Node names are NOT compared: observed nodes are mapped to intended
 * nodes by majority vote over the terminals of shared components, so a rename alone is never a diff.
 * Ties / unmatched nodes map to null and are reported in uncertainties, never guessed.
 * ponytail: majority vote, not graph isomorphism; fine for the small DC circuits the solver accepts.
 */
export function diffDesigns(intended: CircuitGraph, observed: CircuitGraph, opts: { valueTol?: number } = {}): TwinDiff {
  const tol = opts.valueTol ?? 0.01;
  const uncertainties: string[] = [];
  const iBy = new Map(intended.components.map((c) => [c.id, c]));
  const oBy = new Map(observed.components.map((c) => [c.id, c]));

  const componentDiffs: ComponentDiff[] = [];
  const pairs: [CircuitComponent, CircuitComponent][] = []; // matched, same kind
  for (const i of intended.components) {
    const o = oBy.get(i.id);
    if (!o) componentDiffs.push({ componentId: i.id, kind: 'missing_in_observed', intended: { kind: i.kind, value: i.value } });
    else if (o.kind !== i.kind)
      componentDiffs.push({ componentId: i.id, kind: 'kind_changed', intended: { kind: i.kind, value: i.value }, observed: { kind: o.kind, value: o.value } });
    else {
      pairs.push([i, o]);
      const bad = i.value === 0 ? o.value !== 0 : Math.abs(o.value / i.value - 1) > tol;
      if (bad)
        componentDiffs.push({
          componentId: i.id,
          kind: 'value',
          intended: { kind: i.kind, value: i.value },
          observed: { kind: o.kind, value: o.value },
          ...(i.value !== 0 && { ratio: o.value / i.value }),
        });
    }
  }
  for (const o of observed.components)
    if (!iBy.has(o.id)) componentDiffs.push({ componentId: o.id, kind: 'extra_in_observed', observed: { kind: o.kind, value: o.value } });

  // Vote observed node -> intended node. Resistors are symmetric: a swapped orientation is benign if it fits better.
  const vote = (flip: (i: CircuitComponent) => boolean) => {
    const v = new Map<string, Map<string, number>>();
    for (const [i, o] of pairs)
      for (const t of TERMS) {
        const inn = nodeOf(i, flip(i) ? other(t) : t);
        const row = v.get(nodeOf(o, t)) ?? new Map<string, number>();
        row.set(inn, (row.get(inn) ?? 0) + 1);
        v.set(nodeOf(o, t), row);
      }
    return v;
  };
  const pick = (votes: Map<string, Map<string, number>>, note: boolean) => {
    const m: Record<string, string | null> = {};
    for (const [on, row] of votes) {
      if (on === 'GND') {
        m[on] = 'GND';
        continue;
      }
      const ranked = [...row].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
        m[on] = null;
        if (note)
          uncertainties.push(
            `observed node "${on}" matches intended ${ranked.filter((r) => r[1] === ranked[0][1]).map((r) => `"${r[0]}"`).join(' and ')} equally; not guessed`,
          );
      } else m[on] = ranked[0][0];
    }
    return m;
  };
  const first = pick(vote(() => false), false);
  const flipped = new Set<string>();
  for (const [i, o] of pairs) {
    if (i.kind !== 'resistor') continue;
    const fit = (a: string, b: string) => first[o.positiveNode] === a && first[o.negativeNode] === b;
    if (!fit(i.positiveNode, i.negativeNode) && fit(i.negativeNode, i.positiveNode)) flipped.add(i.id);
  }
  const nodeMap = pick(vote((i) => flipped.has(i.id)), true);
  for (const n of new Set(observed.components.flatMap((c) => [c.positiveNode, c.negativeNode])))
    if (!(n in nodeMap)) {
      nodeMap[n] = n === 'GND' ? 'GND' : null;
      if (n !== 'GND') uncertainties.push(`observed node "${n}" touches only components absent from the design; cannot be matched`);
    }

  const connectionDiffs: ConnectionDiff[] = [];
  for (const [i, o] of pairs)
    for (const t of TERMS) {
      const it = flipped.has(i.id) ? other(t) : t;
      const mapped = nodeMap[nodeOf(o, t)];
      if (mapped !== null && mapped !== nodeOf(i, it))
        connectionDiffs.push({ componentId: i.id, terminal: it, intendedNode: nodeOf(i, it), observedNode: nodeOf(o, t) });
    }

  // Two observed nodes onto one intended node = a split net: report, don't guess which terminal is wrong.
  const seen = new Map<string, string>();
  for (const [on, inn] of Object.entries(nodeMap)) {
    if (!inn) continue;
    const prev = seen.get(inn);
    if (prev) uncertainties.push(`observed nodes "${prev}" and "${on}" both map to intended "${inn}" (possible open/split net)`);
    else seen.set(inn, on);
  }

  const identical = !componentDiffs.length && !connectionDiffs.length && !uncertainties.length;
  return { componentDiffs, connectionDiffs, nodeMap, identical, uncertainties };
}
