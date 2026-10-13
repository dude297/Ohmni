import { createHash } from 'node:crypto';
import type { CircuitGraph } from './types';

const canon = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canon)
    : x && typeof x === 'object'
      ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canon(v)]))
      : x;

/** Stable id of a validated graph: independent of component order and key order; changes with any value/node edit. */
export function revisionId(graph: CircuitGraph): string {
  const g = { ...graph, components: [...graph.components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  return 'rev_' + createHash('sha256').update(JSON.stringify(canon(g))).digest('hex').slice(0, 16);
}
