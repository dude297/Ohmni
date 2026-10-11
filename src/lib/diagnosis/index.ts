import type { CircuitGraph, SolveResponse } from '../circuit/types';
import { solveDC } from '../circuit/solve';

type Hypotheses = NonNullable<SolveResponse['hypotheses']>;
type Solver = (g: CircuitGraph) => { voltages: Record<string, number> };
type Scored = Hypotheses[number] & { score: number };

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const RAILS = [1.2, 1.5, 1.8, 2.5, 3.0, 3.3, 3.7, 4.5, 5, 6, 9, 12, 24];
const R_LO = 1e-3; // ponytail: 1 mOhm stands in for "short"
const R_HI = 1e12; // ponytail: 1 TOhm stands in for "open"; solver must tolerate it
const OPEN_ABOVE = 1e7;
const SHORT_BELOW = 1;
const OPEN_SHORT_SCORE = 0.5;
const HEDGE = 'This is a hypothesis, not a confirmed fault.';

const log10 = Math.log10;

function e24Dist(v: number): number {
  const d = Math.floor(log10(v));
  const m = v / 10 ** d;
  return Math.min(...[...E24, 10].map((e) => Math.abs(log10(m / e))));
}

function nearestE24(v: number): number {
  const d = 10 ** Math.floor(log10(v));
  return [...E24, 10]
    .map((e) => e * d)
    .reduce((a, b) => (Math.abs(log10(v / b)) < Math.abs(log10(v / a)) ? b : a));
}

function fmtOhm(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(3)} MΩ`;
  if (r >= 1e3) return `${+(r / 1e3).toPrecision(3)} kΩ`;
  return `${+r.toPrecision(3)} Ω`;
}
const fmtV = (v: number) => `${+v.toPrecision(3)} V`;

function withValue(g: CircuitGraph, id: string, value: number): CircuitGraph {
  return { ...g, components: g.components.map((c) => (c.id === id ? { ...c, value } : c)) };
}

export function diagnoseWith(graph: CircuitGraph, measured: number, solve: Solver): Hypotheses {
  const probe = (g: CircuitGraph): number => {
    try {
      const v = solve(g).voltages[graph.measureNode];
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const expected = probe(graph);
  if (!Number.isFinite(expected)) return [];
  const tol = (x: number) => Math.max(0.02 * Math.abs(x), 0.01);
  const ok = (v: number) => Math.abs(v - measured) <= tol(measured);

  if (Math.abs(measured - expected) <= tol(expected)) {
    const s = graph.components.find((c) => c.kind === 'dc_voltage');
    return [
      {
        title: 'Measurement matches expected',
        rationale: `Expected ${fmtV(expected)} at ${graph.measureNode}, measured ${fmtV(measured)}: within tolerance, so this reading shows no discrepancy. It does not prove every part is correct.`,
        nextMeasurement: s
          ? `Confirm the supply voltage across ${s.id} reads about ${fmtV(s.value)}, then compare another node if you want more confidence.`
          : 'Confirm the supply voltage with a multimeter, then compare another node.',
      },
    ];
  }

  const found: Scored[] = [];
  const obs = `Expected ${fmtV(expected)} at ${graph.measureNode} but measured ${fmtV(measured)}.`;

  for (const c of graph.components) {
    if (c.kind === 'resistor') {
      const f = (r: number) => probe(withValue(graph, c.id, r));
      let r: number | null = null;
      const vLo = f(R_LO);
      const vHi = f(R_HI);
      if (ok(vLo)) r = R_LO;
      else if (ok(vHi)) r = R_HI;
      else if (Number.isFinite(vLo) && Number.isFinite(vHi) && (vLo - measured) * (vHi - measured) < 0) {
        let lo = log10(R_LO);
        let hi = log10(R_HI);
        const sign = Math.sign(vLo - measured);
        for (let i = 0; i < 80; i++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(f(10 ** mid) - measured) === sign) lo = mid;
          else hi = mid;
        }
        r = 10 ** ((lo + hi) / 2);
      }
      if (r === null) continue;
      if (r > OPEN_ABOVE) {
        found.push({
          score: OPEN_SHORT_SCORE,
          title: `${c.id} may be open (disconnected)`,
          rationale: `${obs} Hypothesis: if ${c.id} (${fmtOhm(c.value)}) were open or had a broken connection, the circuit would give about ${fmtV(vHi)}. ${HEDGE}`,
          nextMeasurement: `Disconnect power first, then check ${c.id}'s joints and measure its resistance with a multimeter; an open part reads very high or "OL".`,
        });
      } else if (r < SHORT_BELOW) {
        found.push({
          score: OPEN_SHORT_SCORE,
          title: `${c.id} may be shorted`,
          rationale: `${obs} Hypothesis: if ${c.id} (${fmtOhm(c.value)}) were shorted (for example a solder bridge or stray wire), the circuit would give about ${fmtV(vLo)}. ${HEDGE}`,
          nextMeasurement: `Disconnect power first, then look for a bridge across ${c.id} and measure its resistance with a multimeter; a short reads near 0 Ω.`,
        });
      } else {
        // ponytail: ties between equal-magnitude changes prefer a decrease (misread band, e.g. 10k read as 1k)
        const score = Math.abs(log10(r / c.value)) + 5 * e24Dist(r) + (r > c.value ? 0.05 : 0);
        const std = nearestE24(r);
        const near = Math.abs(r / std - 1) <= 0.05;
        const shown = near ? std : r;
        const fit = near ? ` (exact fit ${fmtOhm(r)})` : '';
        found.push({
          score,
          title: `${c.id} may be ${fmtOhm(shown)} instead of ${fmtOhm(c.value)}`,
          rationale: `${obs} Hypothesis: a ${fmtOhm(shown)} ${c.id} would give ${fmtV(f(shown))}${fit}, instead of the ${fmtOhm(c.value)} in the diagram. A wrong resistor value or misread color band is one possible explanation. ${HEDGE}`,
          nextMeasurement: `Disconnect power first, then measure ${c.id}'s resistance with a multimeter and compare to ${fmtOhm(c.value)}.`,
        });
      }
    } else {
      // circuit is linear in one source value: two probes give the exact line
      const a = probe(withValue(graph, c.id, 1));
      const b = probe(withValue(graph, c.id, 2)) - a;
      if (!Number.isFinite(b) || Math.abs(b) < 1e-12) continue;
      const s = (measured - (a - b)) / b;
      if (!(s > 0.05 && s < 1000)) continue;
      const railDist = Math.min(...RAILS.map((x) => Math.abs(log10(s / x))));
      found.push({
        score: Math.abs(log10(s / c.value)) + 10 * railDist,
        title: `Supply ${c.id} may be ${fmtV(s)} instead of ${fmtV(c.value)}`,
        rationale: `${obs} Hypothesis: if ${c.id} were actually delivering about ${fmtV(s)} instead of ${fmtV(c.value)}, the reading would match (low battery, wrong supply or regulator setting). ${HEDGE}`,
        nextMeasurement: `With the circuit powered, measure the voltage directly across ${c.id}'s terminals (low-voltage DC only) and compare to ${fmtV(c.value)}.`,
      });
    }
  }

  return found
    .sort((x, y) => x.score - y.score)
    .slice(0, 3)
    .map(({ title, rationale, nextMeasurement }) => ({ title, rationale, nextMeasurement }));
}

export function diagnose(graph: CircuitGraph, measuredVoltage: number): Hypotheses {
  return diagnoseWith(graph, measuredVoltage, solveDC);
}
