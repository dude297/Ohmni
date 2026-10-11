import { LIMITS, type AcGraph } from './types';

export type AcSweep = { pointsPerDecade: number; fMin: number; fMax: number };
export const DEFAULT_SWEEP: AcSweep = { pointsPerDecade: LIMITS.defaultPtsPerDecade, fMin: LIMITS.fMin, fMax: LIMITS.fMax };

const PREFIX = { resistor: 'R', capacitor: 'C', inductor: 'L', ac_source: 'V' } as const;
/** SI value in plain exponent form (never SPICE suffixes: 'm' = milli, 'meg' = mega). */
const num = (x: number) => {
  if (!Number.isFinite(x)) throw new Error('non-finite number');
  return x.toExponential(9).replace('+', '');
};

/**
 * Builds SPICE text ONLY from the typed graph. Every user string (ids, node names) is replaced by a
 * generated token, so no user text ever reaches the netlist. Call validateAcGraph first.
 */
export function buildNetlist(g: AcGraph, sweep: AcSweep = DEFAULT_SWEEP) {
  const { pointsPerDecade: p, fMin, fMax } = sweep;
  if (!Number.isInteger(p) || p < 1 || p > LIMITS.maxPtsPerDecade) throw new Error('pointsPerDecade out of range');
  if (!(fMin >= LIMITS.fMin) || !(fMax <= LIMITS.fMax) || !(fMin < fMax)) throw new Error('frequency range out of bounds');
  const map = new Map<string, string>([[g.groundNode, '0']]);
  const tok = (n: string) => {
    if (!map.has(n)) map.set(n, `n${map.size}`);
    return map.get(n)!;
  };
  let sourceToken = '';
  const lines = g.components.map((c, i) => {
    const name = `${PREFIX[c.kind]}${i + 1}`;
    const nodes = `${tok(c.a)} ${tok(c.b)}`;
    if (c.kind !== 'ac_source') return `${name} ${nodes} ${num(c.value)}`;
    sourceToken = name.toLowerCase();
    return `${name} ${nodes} DC 0 AC 1`;
  });
  const outputToken = map.get(g.outputNode);
  if (!outputToken || outputToken === '0') throw new Error('outputNode not in circuit');
  const text = ['ohmni ac', ...lines, `.ac dec ${p} ${num(fMin)} ${num(fMax)}`, '.end'].join('\n');
  return { text, outputToken, sourceToken };
}
