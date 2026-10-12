import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  discriminate,
  equivalentResistance,
  nodesOf,
  resistanceOptions,
  safeVoltages,
  voltageOptions,
} from '../../src/lib/topology/candidates';
import { POST } from '../../src/app/api/topology/route';
import { DIVIDER_10K_10K, MALFORMED_FLOATING, MALFORMED_NO_GND, MALFORMED_UNKNOWN_KIND, SERIES_PARALLEL_12V } from '../../src/lib/circuit/fixtures';
import type { CircuitComponent, CircuitGraph } from '../../src/lib/circuit/types';

// Repeatable benchmark for the dual-candidate topology engine (#57). All expected values live in
// fixtures/topology/benchmark.json and were derived by hand (derivation strings in the fixture);
// nothing below calls the engine to obtain an expectation. Set BENCH_REPORT=1 to print the report table.
type Pair = [number | null, number | null];
type Case = {
  id: string;
  description: string;
  graph: CircuitGraph;
  ambiguous: [string, string];
  expected: {
    derivation: string;
    pairA: Pair;
    pairB: Pair;
    shortsSupply: boolean;
    poweredSafe: boolean;
    decisive: boolean;
    unplugSupply: boolean;
    alias: Record<string, string>;
    survivor: string;
    voltageOption?: { node: string; A: number; B: number };
    voltageSeparationMax?: number;
    separationMax?: number;
  };
};
type Net = { id: string; formula: string; pair: [string, string]; expected: number | null; graph: CircuitGraph };
const bench = JSON.parse(readFileSync(new URL('../../fixtures/topology/benchmark.json', import.meta.url), 'utf8')) as { cases: Case[]; networks: Net[] };

// ---- independent oracles (no engine code) ----------------------------------------------------
const OL = 1e9;
const capped = (x: number | null) => (x === null ? OL : Math.min(x, OL));
// Documented meter model: 2 % + 1 ohm per reading; separation = |a-b| / (sa + sb); decisive at >= 3.
const sepR = (a: number, b: number) => Math.abs(a - b) / (0.02 * a + 1 + 0.02 * b + 1);
const near = (got: number, want: number | null, rel = 1e-9) => {
  if (want === null) return expect(got).toBe(Infinity);
  expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)));
};

/** R_eff(i,j) = (ei-ej)^T L^+ (ei-ej), L^+ = (L + J/n)^-1 - J/n. Gauss-Jordan; resistors only. Different algorithm from the engine. */
function laplacianReff(g: CircuitGraph, i: string, j: string): number {
  const ns = nodesOf(g);
  const n = ns.length;
  const ix = new Map(ns.map((x, k) => [x, k]));
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const c of g.components)
    if (c.kind === 'resistor') {
      const p = ix.get(c.positiveNode)!;
      const q = ix.get(c.negativeNode)!;
      L[p][p] += 1 / c.value;
      L[q][q] += 1 / c.value;
      L[p][q] -= 1 / c.value;
      L[q][p] -= 1 / c.value;
    }
  const M = L.map((row, r) => [...row.map((x) => x + 1 / n), ...Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-15) return Infinity; // disconnected network: L + J/n still singular only if n==0; guard anyway
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = M[r][c];
        for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
      }
  }
  const e = new Array<number>(n).fill(0);
  e[ix.get(i)!] = 1;
  e[ix.get(j)!] -= 1;
  const inv = (a: number, b: number) => M[a][n + b] - 1 / n;
  let s = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) s += e[a] * inv(a, b) * e[b];
  return s;
}
const connected = (g: CircuitGraph, a: string, b: string) => {
  const seen = new Set([a]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of g.components)
      if (c.kind === 'resistor' && seen.has(c.positiveNode) !== seen.has(c.negativeNode)) {
        seen.add(c.positiveNode).add(c.negativeNode);
        grew = true;
      }
  }
  return seen.has(b);
};

const report: string[] = [];
const rec = (id: string, what: string, expected: string, engine: string, ok: boolean) =>
  report.push(`| ${id} | ${what} | ${expected} | ${engine} | ${ok ? 'pass' : 'FAIL'} |`);
const fmt = (x: number | null | undefined) => (x === null ? 'open' : x === undefined ? '-' : String(+x.toPrecision(6)));

const post = (b: unknown) => POST(new Request('http://x/api/topology', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));

// ---- 1. labelled ambiguous-pair cases ---------------------------------------------------------
describe.each(bench.cases)('case $id', (cs) => {
  const { graph, ambiguous: pair, expected: e } = cs;
  const cands = buildCandidates(graph, pair[0], pair[1]);
  const [a, b] = cands;

  it('hand-derived readings match the engine (supply shorted and unplugged)', () => {
    const o = resistanceOptions(cands, pair)[0];
    expect(o.between).toEqual(pair);
    near(o.predictions[0].value, capped(e.pairA[0]));
    near(o.predictions[0].openSupplyValue!, capped(e.pairA[1]));
    near(o.predictions[1].value, capped(e.pairB[0]));
    near(o.predictions[1].openSupplyValue!, capped(e.pairB[1]));
    // separation per the documented meter model (worst case over both supply conventions)
    const want = Math.min(sepR(capped(e.pairA[0]), capped(e.pairB[0])), sepR(capped(e.pairA[1]), capped(e.pairB[1])));
    near(o.separation, want, 1e-9);
    const u = resistanceOptions(cands, pair, true)[0];
    near(u.predictions[0].value, capped(e.pairA[1]));
    near(u.predictions[1].value, capped(e.pairB[1]));
    rec(cs.id, 'pair reading A (short/unplug) vs B', `${fmt(e.pairA[0])}/${fmt(e.pairA[1])} vs ${fmt(e.pairB[0])}/${fmt(e.pairB[1])}`, `${fmt(o.predictions[0].value)}/${fmt(o.predictions[0].openSupplyValue)} vs ${fmt(o.predictions[1].value)}/${fmt(o.predictions[1].openSupplyValue)}`, true);
  });

  it('alias map and ground survivor', () => {
    expect(b.alias).toEqual(e.alias);
    const survivor = Object.values(b.alias)[0];
    expect(survivor).toBe(e.survivor);
    expect(b.graph.groundNode).toBe('GND');
    if (pair.includes('GND')) expect(survivor).toBe('GND'); // GND never disappears
    expect(nodesOf(b.graph)).not.toContain(Object.keys(b.alias)[0]);
    expect(a.alias).toEqual({});
    expect(a.graph).toBe(graph);
    expect(b.graph.components.every((c) => c.kind !== 'resistor' || c.positiveNode !== c.negativeNode)).toBe(true);
    rec(cs.id, 'alias / survivor', `${JSON.stringify(e.alias)} / ${e.survivor}`, `${JSON.stringify(b.alias)} / ${survivor}`, true);
  });

  it('decisive / powered-safety flags', () => {
    const d = discriminate(cands, pair);
    // oracle for "decisive": best of (default worst-case separation, unplugged-only separation) >= 3
    const def = Math.min(sepR(capped(e.pairA[0]), capped(e.pairB[0])), sepR(capped(e.pairA[1]), capped(e.pairB[1])));
    const unp = sepR(capped(e.pairA[1]), capped(e.pairB[1]));
    expect(Math.max(def, unp) >= 3).toBe(e.decisive); // sanity-check of the hand labels themselves
    expect(b.shortsSupply).toBe(e.shortsSupply);
    expect(d.decisive).toBe(e.decisive);
    expect(d.decisive).toBe(d.separation >= 3);
    expect(d.poweredSafe).toBe(e.poweredSafe);
    // engine asks for the supply to be unplugged only when that reading separates better than the default one
    expect(!!d.unplugSupply).toBe(def < 3 && unp > def);
    if (e.decisive) expect(!!d.unplugSupply).toBe(e.unplugSupply);
    if (e.separationMax !== undefined) expect(d.separation).toBeLessThan(e.separationMax);
    rec(cs.id, 'decisive / poweredSafe / shortsSupply / unplug', `${e.decisive} / ${e.poweredSafe} / ${e.shortsSupply} / ${e.unplugSupply}`, `${d.decisive} / ${d.poweredSafe} / ${b.shortsSupply} / ${!!d.unplugSupply}`, true);
  });

  if (!e.poweredSafe)
    it('SAFETY: unsafe candidate -> resistance-only, power-off wording, DO NOT power', async () => {
      const d = discriminate(cands, pair);
      expect(safeVoltages(b)).toBeNull();
      expect(voltageOptions(cands)).toEqual([]);
      expect(d.kind).toBe('resistance');
      expect(d.voltageOption).toBeNull();
      expect(d.safety).toMatch(/DO NOT power/);
      expect(d.instruction).toMatch(/power OFF/);
      expect(d.instruction).not.toMatch(/power ON/i);
      expect(d.instruction).not.toMatch(/red probe/);
      if (e.unplugSupply) expect(d.instruction).toMatch(/supply disconnected/);
      const res = await post({ graph, userConfirmed: true, ambiguous: { a: pair[0], b: pair[1] } });
      const m = (await res.json()).result.measurement;
      expect(m.kind).toBe('resistance');
      expect(m.poweredSafe).toBe(false);
      expect(m.instruction).not.toMatch(/power ON/i);
      expect(m.safety).toMatch(/DO NOT power/);
    });
  else
    it('powered check is only offered when every candidate is safe', () => {
      const d = discriminate(cands, pair);
      expect(safeVoltages(a)).not.toBeNull();
      expect(safeVoltages(b)).not.toBeNull();
      expect(d.safety).not.toMatch(/DO NOT/);
      expect(d.voltageOption).not.toBeNull();
      if (e.voltageOption) {
        expect(d.voltageOption!.node).toBe(e.voltageOption.node);
        near(d.voltageOption!.predictions[0].value, e.voltageOption.A, 1e-9);
        near(d.voltageOption!.predictions[1].value, e.voltageOption.B, 1e-9);
      }
      if (e.voltageSeparationMax !== undefined) {
        // equipotential merge: the best powered reading cannot tell A from B
        const best = Math.max(...voltageOptions(cands).map((m) => m.separation));
        expect(best).toBeLessThan(e.voltageSeparationMax);
        rec(cs.id, 'best voltage-probe separation', `< ${e.voltageSeparationMax}`, fmt(best), true);
      }
    });

  it('POST /api/topology agrees with the library', async () => {
    const res = await post({ graph, userConfirmed: true, ambiguous: { a: pair[0], b: pair[1] } });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.candidates[1].shortsSupply).toBe(e.shortsSupply);
    expect(result.measurement.decisive).toBe(e.decisive);
    expect(result.measurement.poweredSafe).toBe(e.poweredSafe);
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });
});

// ---- 2. decisive threshold ----------------------------------------------------------------------
describe('decisive threshold (closed form x/(2+0.02x) = 3 -> x = 6.383 ohm)', () => {
  it('a 6 ohm shunt is not decisive, a 7 ohm shunt is, and separations match the formula', () => {
    const six = bench.cases.find((c) => c.id === 'shunt-6ohm-below-threshold')!;
    const seven = bench.cases.find((c) => c.id === 'shunt-7ohm-above-threshold')!;
    const thr = 6 / (1 - 0.06); // x/(2+0.02x)=3  =>  x(1-0.06)=6
    expect(thr).toBeCloseTo(6.383, 3);
    for (const [c, want] of [[six, false], [seven, true]] as const) {
      const d = discriminate(buildCandidates(c.graph, c.ambiguous[0], c.ambiguous[1]), c.ambiguous);
      expect(d.decisive).toBe(want);
      const def = Math.min(sepR(c.expected.pairA[0]!, 0), sepR(c.expected.pairA[1]!, 0));
      const hand = def >= 3 ? def : Math.max(def, sepR(c.expected.pairA[1]!, 0)); // engine only tries 'unplugged' when the default reading is < 3
      near(d.separation, hand, 1e-9);
      rec(c.id, 'separation (threshold 3)', fmt(hand), fmt(d.separation), true);
    }
  });
  it('separation is monotonic in the shunt value and crosses 3 exactly between 6 and 7 ohm', () => {
    const seps = [1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 100].map((rs) => {
      const g: CircuitGraph = {
        schemaVersion: 1, groundNode: 'GND', measureNode: 'X',
        components: [
          { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
          { id: 'R1', kind: 'resistor', value: 1e4, positiveNode: 'VIN', negativeNode: 'X' },
          { id: 'Rs', kind: 'resistor', value: rs, positiveNode: 'X', negativeNode: 'Y' },
          { id: 'R2', kind: 'resistor', value: 1e4, positiveNode: 'Y', negativeNode: 'GND' },
        ],
      };
      return discriminate(buildCandidates(g, 'X', 'Y'), ['X', 'Y']);
    });
    seps.reduce((prev, d) => (expect(d.separation).toBeGreaterThan(prev), d.separation), 0);
    expect(seps.map((d) => d.decisive)).toEqual([false, false, false, false, false, false, true, true, true, true, true]);
  });
});

// ---- 3. numeric agreement of equivalentResistance with independent oracles -----------------------
describe('equivalentResistance: hand value == Laplacian pseudo-inverse == engine', () => {
  it.each(bench.networks)('$id', (n) => {
    const eng = equivalentResistance(n.graph, n.pair[0], n.pair[1], 'open');
    near(eng, n.expected);
    if (n.expected !== null) {
      near(laplacianReff(n.graph, n.pair[0], n.pair[1]), n.expected, 1e-9);
      near(eng, laplacianReff(n.graph, n.pair[0], n.pair[1]), 1e-9);
    }
    expect(equivalentResistance(n.graph, n.pair[1], n.pair[0], 'open')).toBeCloseTo(eng, 6); // symmetric (Infinity === Infinity)
    rec(`net:${n.id}`, `R_eff ${n.pair.join('-')} (${n.formula})`, fmt(n.expected), fmt(eng), true);
  });
  it('>= 6 networks incl. balanced + unbalanced Wheatstone and a ladder', () => {
    const ids = bench.networks.map((n) => n.id);
    expect(bench.networks.filter((n) => n.expected !== null).length).toBeGreaterThanOrEqual(6);
    expect(ids).toEqual(expect.arrayContaining(['wheatstone-balanced-1k', 'wheatstone-unbalanced', 'ladder-3-section']));
  });
  it('40 seeded random connected networks agree with the Laplacian oracle', () => {
    let s = 12345;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let t = 0; t < 40; t++) {
      const n = 3 + Math.floor(rnd() * 6);
      const comps: CircuitComponent[] = [];
      for (let k = 1; k < n; k++) comps.push({ id: `t${k}`, kind: 'resistor', value: 10 ** (1 + 4 * rnd()), positiveNode: `N${k}`, negativeNode: `N${Math.floor(rnd() * k)}` });
      for (let k = 0; k < n; k++) {
        const p = Math.floor(rnd() * n);
        const q = Math.floor(rnd() * n);
        if (p !== q) comps.push({ id: `x${k}`, kind: 'resistor', value: 10 ** (1 + 4 * rnd()), positiveNode: `N${p}`, negativeNode: `N${q}` });
      }
      const g: CircuitGraph = { schemaVersion: 1, groundNode: 'GND', measureNode: 'N0', components: comps };
      const i = `N${Math.floor(rnd() * n)}`;
      const j = `N${Math.floor(rnd() * n)}`;
      if (i === j || !connected(g, i, j)) continue;
      near(equivalentResistance(g, i, j, 'open'), laplacianReff(g, i, j), 1e-8);
    }
  });
});

// ---- 4. cross-cutting safety sweeps --------------------------------------------------------------
const V1 = (value: number, p: string, n: string, id = 'V1'): CircuitComponent => ({ id, kind: 'dc_voltage', value, positiveNode: p, negativeNode: n });
const R1 = (id: string, value: number, p: string, n: string): CircuitComponent => ({ id, kind: 'resistor', value, positiveNode: p, negativeNode: n });
const twoSources: CircuitGraph = {
  schemaVersion: 1, groundNode: 'GND', measureNode: 'A',
  components: [V1(5, 'VIN', 'GND'), V1(3, 'V2', 'GND', 'V2'), R1('R1', 1000, 'VIN', 'A'), R1('R2', 1000, 'V2', 'A'), R1('R3', 1000, 'A', 'GND')],
};
const sweepGraphs: [string, CircuitGraph][] = [
  ['divider', DIVIDER_10K_10K],
  ['series-parallel', SERIES_PARALLEL_12V],
  ...bench.cases.map((c): [string, CircuitGraph] => [c.id, c.graph]),
  ['two-sources', twoSources],
];

describe('exhaustive safety sweep over every node pair', () => {
  it('whenever a candidate is unsafe to power: poweredSafe=false, no powered instruction, DO NOT power; decisive <=> separation >= 3', () => {
    let pairs = 0;
    let unsafe = 0;
    for (const [name, g] of sweepGraphs) {
      const ns = nodesOf(g);
      for (let i = 0; i < ns.length; i++)
        for (let j = i + 1; j < ns.length; j++) {
          pairs++;
          const cs = buildCandidates(g, ns[i], ns[j]);
          const d = discriminate(cs, [ns[i], ns[j]]);
          const tag = `${name} ${ns[i]}-${ns[j]}`;
          expect(d.decisive, tag).toBe(d.separation >= 3);
          expect(Number.isFinite(d.separation), tag).toBe(true);
          const anyUnsafe = cs.some((c) => safeVoltages(c) === null);
          expect(d.poweredSafe, tag).toBe(!anyUnsafe);
          if (cs[1].shortsSupply) expect(anyUnsafe, tag).toBe(true);
          if (anyUnsafe) {
            unsafe++;
            expect(d.kind, tag).toBe('resistance');
            expect(d.voltageOption, tag).toBeNull();
            expect(d.safety, tag).toMatch(/DO NOT power/);
            expect(d.instruction, tag).not.toMatch(/power ON/i);
          } else {
            expect(d.safety, tag).not.toMatch(/DO NOT/);
          }
          if (d.kind === 'voltage') expect(d.poweredSafe, tag).toBe(true);
        }
    }
    expect(pairs).toBeGreaterThan(50);
    expect(unsafe).toBeGreaterThan(5);
    rec('sweep', `${pairs} node pairs over ${sweepGraphs.length} graphs`, 'unsafe => resistance-only, DO NOT power', `${unsafe} unsafe pairs all compliant`, true);
  });
  it('merging two nodes joined by conflicting ideal sources (5 V vs 3 V in parallel) is treated as unsafe', () => {
    const cs = buildCandidates(twoSources, 'VIN', 'V2');
    expect(safeVoltages(cs[1])).toBeNull();
    const d = discriminate(cs, ['VIN', 'V2']);
    expect(d.poweredSafe).toBe(false);
    expect(d.safety).toMatch(/DO NOT power/);
    rec('two-sources-conflict', 'VIN+V2 merge (5 V || 3 V ideal)', 'poweredSafe=false', `poweredSafe=${d.poweredSafe}`, !d.poweredSafe);
  });
});

// ---- 5. rejected inputs ---------------------------------------------------------------------------
describe('floating / invalid inputs are rejected', () => {
  const ok = { graph: DIVIDER_10K_10K, userConfirmed: true, ambiguous: { a: 'VOUT', b: 'GND' } };
  const code = async (b: unknown) => {
    const r = await post(b);
    return [r.status, (await r.json()).error?.code] as const;
  };
  it('library: same node twice / unknown node throws', () => {
    expect(() => buildCandidates(DIVIDER_10K_10K, 'VOUT', 'VOUT')).toThrow();
    expect(() => buildCandidates(DIVIDER_10K_10K, 'NOPE', 'GND')).toThrow();
    expect(() => buildCandidates(DIVIDER_10K_10K, 'VOUT', 'nope')).toThrow();
  });
  it.each([
    ['unknown node in pair (b)', { ...ok, ambiguous: { a: 'VOUT', b: 'NOPE' } }, 422, 'INVALID_REQUEST'],
    ['unknown node in pair (a)', { ...ok, ambiguous: { a: 'NOPE', b: 'GND' } }, 422, 'INVALID_REQUEST'],
    ['case-sensitive node names', { ...ok, ambiguous: { a: 'vout', b: 'GND' } }, 422, 'INVALID_REQUEST'],
    ['same node twice', { ...ok, ambiguous: { a: 'VOUT', b: 'VOUT' } }, 422, 'INVALID_REQUEST'],
    ['same node twice after trim', { ...ok, ambiguous: { a: 'VOUT', b: '  VOUT ' } }, 422, 'INVALID_REQUEST'],
    ['blank node name', { ...ok, ambiguous: { a: '   ', b: 'GND' } }, 422, 'INVALID_REQUEST'],
    ['ambiguous missing', { graph: DIVIDER_10K_10K, userConfirmed: true }, 422, 'INVALID_REQUEST'],
    ['ambiguous not an object', { ...ok, ambiguous: ['VOUT', 'GND'] }, 422, 'INVALID_REQUEST'],
    ['body is null', null, 422, 'INVALID_REQUEST'],
    ['missing GND node', { ...ok, graph: MALFORMED_NO_GND }, 422, 'INVALID_GRAPH'],
    ['floating subcircuit', { ...ok, graph: MALFORMED_FLOATING }, 422, 'INVALID_GRAPH'],
    ['unsupported component kind', { ...ok, graph: MALFORMED_UNKNOWN_KIND }, 422, 'INVALID_GRAPH'],
    ['graph key missing (caught by the schema gate)', { userConfirmed: true, ambiguous: ok.ambiguous }, 422, 'INVALID_REQUEST'],
    ['unconfirmed (false)', { ...ok, userConfirmed: false }, 422, 'NOT_CONFIRMED'],
    ['userConfirmed key missing (caught by the schema gate)', { graph: ok.graph, ambiguous: ok.ambiguous }, 422, 'INVALID_REQUEST'],
    ['unconfirmed (string "true")', { ...ok, userConfirmed: 'true' }, 422, 'NOT_CONFIRMED'],
    ['unconfirmed (1)', { ...ok, userConfirmed: 1 }, 422, 'NOT_CONFIRMED'],
    ['not JSON', '{nope', 400, 'BAD_JSON'],
  ] as const)('%s', async (name, body, status, errCode) => {
    const [s, c] = await code(body);
    expect([s, c]).toEqual([status, errCode]);
    rec(`reject:${name}`, 'POST status / error.code', `${status} ${errCode}`, `${s} ${c}`, s === status && c === errCode);
  });
  it('a valid request with surrounding whitespace in node names is accepted (trimmed)', async () => {
    const r = await post({ ...ok, ambiguous: { a: ' VOUT ', b: 'GND' } });
    expect(r.status).toBe(200);
  });
});

it.runIf(process.env.BENCH_REPORT)('prints the report table', () => {
  console.log(['| case | check | expected | engine | result |', '|---|---|---|---|---|', ...report].join('\n'));
});
