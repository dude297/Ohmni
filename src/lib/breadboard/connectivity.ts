import { stripIdOfHole, stripsOf } from './board';
import type { BuildState, HoleId, Net } from './types';

export type NetIndex = { nets: Net[]; errors: string[]; netOfHole: (h: HoleId) => Net | null };

/**
 * Union-find over strips joined by jumpers ONLY. Component pins never join strips; geometry/proximity
 * never matters (wire crossings in 3D mean nothing). Only strips touched by a pin, jumper, ground or
 * probe hole become nets. Net id = 'net:' + first strip id (board order), stable across unrelated edits.
 */
export function buildNetIndex(state: BuildState): NetIndex {
  const { board } = state;
  const errors: string[] = [];
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const used = new Set<string>();
  const sid = (h: HoleId, what: string) => {
    const s = stripIdOfHole(board, h);
    if (!s) errors.push(`invalid hole "${h}" (${what})`);
    else used.add(s);
    return s;
  };

  const pinAt = new Map<HoleId, string>();
  const ids = new Set<string>();
  for (const p of state.placements) {
    if (ids.has(p.id)) errors.push(`duplicate placement id "${p.id}"`);
    ids.add(p.id);
    for (const t of ['positive', 'negative'] as const) {
      const h = p.pins[t];
      const label = `${p.id}.${t}`;
      if (!sid(h, label)) continue;
      const prev = pinAt.get(h);
      if (prev) errors.push(`hole ${h} holds two pins (${prev}, ${label})`);
      else pinAt.set(h, label);
    }
  }
  for (const j of state.jumpers) {
    const a = sid(j.a, `jumper ${j.id}`);
    const b = sid(j.b, `jumper ${j.id}`);
    if (a && b) parent.set(find(a), find(b));
  }
  if (state.groundNet !== undefined) sid(state.groundNet, 'groundNet');
  for (const [label, h] of Object.entries(state.probeHoles ?? {})) sid(h, `probe ${label}`);

  const all = stripsOf(board);
  const byId = new Map(all.map((s) => [s.id, s]));
  const groups = new Map<string, string[]>();
  for (const s of all) {
    if (!used.has(s.id)) continue;
    const r = find(s.id);
    groups.set(r, [...(groups.get(r) ?? []), s.id]);
  }
  const nets: Net[] = [];
  const netOfStrip = new Map<string, Net>();
  for (const strips of groups.values()) {
    const net: Net = { id: `net:${strips[0]}`, strips, holes: strips.flatMap((s) => byId.get(s)!.holes) };
    nets.push(net);
    for (const s of strips) netOfStrip.set(s, net);
  }
  const netOfHole = (h: HoleId) => {
    const s = stripIdOfHole(board, h);
    return s ? (netOfStrip.get(s) ?? null) : null;
  };
  return { nets, errors, netOfHole };
}

export const buildNets = (state: BuildState): { nets: Net[]; errors: string[] } => {
  const { nets, errors } = buildNetIndex(state);
  return { nets, errors };
};
