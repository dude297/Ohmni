import type { CircuitGraph } from '../src/lib/circuit/types';
import { rng } from './calibration';

// Random 5 V resistor networks with log-uniform resistances in [1 mOhm, 1 TOhm] (plus fixed extreme cases).
// "violation" = independent worst-node KCL imbalance of the returned currents, relative to the largest current.
export type SolverFn = (g: CircuitGraph) => { voltages: Record<string, number>; currents: Record<string, number>; warnings?: string[] };

export function randomNet(r: ReturnType<typeof rng>, lo = -3, hi = 12): CircuitGraph {
  const nodes = ['VIN', 'A', 'B', 'C', 'D'];
  const res = (id: string, a: string, b: string) => ({ id, kind: 'resistor' as const, value: 10 ** (lo + r.u() * (hi - lo)), positiveNode: a, negativeNode: b });
  const comps: CircuitGraph['components'] = [{ id: 'V1', kind: 'dc_voltage' as const, value: 5, positiveNode: 'VIN', negativeNode: 'GND' }];
  const chain = [...nodes, 'GND'];
  for (let i = 0; i < chain.length - 1; i++) comps.push(res(`R${i + 1}`, chain[i], chain[i + 1]));
  for (let k = 0; k < 3; k++) {
    const a = chain[Math.floor(r.u() * chain.length)], b = chain[Math.floor(r.u() * chain.length)];
    if (a !== b) comps.push(res(`X${k}`, a, b));
  }
  return { schemaVersion: 1, components: comps, groundNode: 'GND', measureNode: 'A' };
}

export function kclViolation(g: CircuitGraph, sol: ReturnType<SolverFn>): number {
  const net: Record<string, number> = {};
  let imax = 0;
  for (const c of g.components) {
    const i = sol.currents[c.id];
    imax = Math.max(imax, Math.abs(i));
    net[c.positiveNode] = (net[c.positiveNode] ?? 0) + i;
    net[c.negativeNode] = (net[c.negativeNode] ?? 0) - i;
  }
  return imax > 0 ? Math.max(...Object.entries(net).filter(([n]) => n !== g.groundNode).map(([, v]) => Math.abs(v))) / imax : 0;
}

export function stress(solve: SolverFn, n = 2000, seed = 4242) {
  const r = rng(seed);
  let worst = 0, over1e6 = 0, silentOver1e6 = 0, flagged = 0, singular = 0, over1e3 = 0, silentOver1e3 = 0;
  for (let i = 0; i < n; i++) {
    const g = randomNet(r);
    try {
      const s = solve(g);
      const v = kclViolation(g, s);
      worst = Math.max(worst, v);
      const w = !!s.warnings?.includes('ill_conditioned');
      if (w) flagged++;
      if (v > 1e-6) { over1e6++; if (!w) silentOver1e6++; }
      if (v > 1e-3) { over1e3++; if (!w) silentOver1e3++; }
    } catch { singular++; }
  }
  return { cases: n, seed, worstViolation: worst, over1e6, silentOver1e6, over1e3, silentOver1e3, flagged, singularOrThrown: singular };
}

/** V1 5 V -> R1 (1e-12 Ohm) -> A -> 1 kOhm -> GND: the audit's 11 % case. */
export function tinyR1(): CircuitGraph {
  return {
    schemaVersion: 1, groundNode: 'GND', measureNode: 'A',
    components: [
      { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
      { id: 'R1', kind: 'resistor', value: 1e-12, positiveNode: 'VIN', negativeNode: 'A' },
      { id: 'R2', kind: 'resistor', value: 1000, positiveNode: 'A', negativeNode: 'GND' },
    ],
  };
}
