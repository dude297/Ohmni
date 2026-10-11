import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { solveDC } from '@/lib/circuit/solve';
import { importNetlist, parseSiValue } from '@/lib/netlist';

const fx = (n: string) => readFileSync(new URL(`../../fixtures/netlist/${n}`, import.meta.url), 'utf8');
const sortedV = (g: NonNullable<ReturnType<typeof importNetlist>['graph']>) =>
  Object.entries(solveDC(g).voltages).map(([, v]) => v).sort((a, b) => a - b);

describe('parseSiValue', () => {
  const table: [string, number | null][] = [
    ['1k', 1e3], ['1K', 1e3], ['1m', 1e-3], ['1M', 1e-3], ['1meg', 1e6], ['1MEG', 1e6], ['2.2Meg', 2.2e6],
    ['10u', 1e-5], ['10µ', 1e-5], ['4n7', 4.7e-9], ['100p', 1e-10], ['1f', 1e-15], ['1g', 1e9], ['1t', 1e12],
    ['4k7', 4700], ['4R7', 4.7], ['1M5', 1.5e-3], ['1Meg5', 1.5e6],
    ['10kohm', 1e4], ['5V', 5], ['3mV', 3e-3], ['2mohm', 2e-3], ['1.2kΩ', 1200], ['1e3', 1000], ['-5', -5], ['.5', 0.5],
    ['1mil', null], ['abc', null], ['1xyz', null], ['', null],
  ];
  it.each(table)('%s', (s, v) => {
    const got = parseSiValue(s);
    if (v === null) expect(got).toBeNull();
    else expect(got).toBeCloseTo(v, 12);
  });
});

describe('loaded bridge', () => {
  const expected = sortedV(LOADED_BRIDGE_12V);
  for (const [name, file, fmt] of [['SPICE', 'loaded_bridge.cir', 'spice'], ['KiCad', 'loaded_bridge.net', 'kicad']] as const) {
    it(`${name} fixture matches LOADED_BRIDGE_12V node voltages`, () => {
      const r = importNetlist(fx(file), { measureNode: fmt === 'kicad' ? '/VOUT' : undefined });
      expect(r.format).toBe(fmt);
      expect(r.rejected).toEqual([]);
      expect(r.errors).toEqual([]);
      const g = r.graph!;
      expect(g.groundNode).toBe('GND');
      const v = sortedV(g);
      v.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 9));
      expect(solveDC(g).voltages[g.measureNode]).toBeCloseTo(2.608949, 5);
    });
  }
  it('KiCad naming: strips "/", maps unnamed nets to N#', () => {
    const r = importNetlist(fx('loaded_bridge.net'), { measureNode: '/VOUT' });
    const nodes = new Set(r.graph!.components.flatMap((c) => [c.positiveNode, c.negativeNode]));
    expect([...nodes].sort()).toEqual(['B', 'GND', 'N1', 'VIN', 'VOUT']);
    expect(r.graph!.measureNode).toBe('VOUT');
    expect(r.warnings).toEqual([]);
  });
  it('KiCad polarity: pin 1 is +', () => {
    const v1 = importNetlist(fx('loaded_bridge.net')).graph!.components.find((c) => c.id === 'V1')!;
    expect([v1.positiveNode, v1.negativeNode]).toEqual(['VIN', 'GND']);
  });
  it('SPICE measure comment, option override, and fallback warning', () => {
    expect(importNetlist(fx('loaded_bridge.cir')).graph!.measureNode).toBe('C');
    expect(importNetlist(fx('loaded_bridge.cir'), { measureNode: 'a' }).graph!.measureNode).toBe('A');
    const r = importNetlist('t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n');
    expect(r.graph!.measureNode).toBe('IN');
    expect(r.warnings.join()).toMatch(/defaulting/);
  });
});

describe('SPICE parsing', () => {
  it('handles comments, continuation lines, case, node aliases, title', () => {
    const r = importNetlist(`My title line
* a comment
v1 in GND
+ dc 5 ; inline comment
r1 in out
+ 10k
R2 OUT 0 10K
.tran 1m 10m
.end
R9 ignored after end 1`, { measureNode: 'out' });
    expect(r.rejected).toEqual([]);
    expect(r.graph!.components.map((c) => [c.id, c.value])).toEqual([['V1', 5], ['R1', 1e4], ['R2', 1e4]]);
    expect(solveDC(r.graph!).voltages.OUT).toBeCloseTo(2.5, 9);
    expect(r.warnings.join()).toMatch(/\.tran/);
  });
  it('treats a well-formed first element line as an element, not a title', () => {
    const r = importNetlist('V1 in 0 5\nR1 in 0 1k', { measureNode: 'in' });
    expect(r.graph!.components).toHaveLength(2);
  });
  it.each([
    ['C1 a 0 1u', /capacitor/],
    ['L1 a 0 1m', /inductor/],
    ['D1 a 0 dio', /diode/],
    ['Q1 a b 0 npn', /BJT/],
    ['M1 d g s b nmos', /MOSFET/],
    ['I1 a 0 1m', /current source/],
    ['X1 a 0 sub', /subcircuit/],
    ['V2 a 0 SIN(0 1 1k)', /SIN/],
    ['V2 a 0 AC 1', /AC/],
    ['V2 a 0 PULSE(0 5 0 1n 1n 1u 2u)', /PULSE/],
    ['R5 a 0 1k tc=1', /extra|unexpected/],
    ['R5 a 0 zzz', /cannot parse/],
    ['.model foo D', /directive/],
  ])('rejects %s', (line, reason) => {
    const r = importNetlist(`t\nV1 a 0 5\nR1 a 0 1k\n${line}\n`);
    expect(r.graph).toBeNull();
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].line).toBe(4);
    expect(r.rejected[0].reason).toMatch(reason);
  });
  it('rejects duplicate names (case-insensitive)', () => {
    const r = importNetlist('t\nV1 a 0 5\nR1 a 0 1k\nr1 a 0 2k\n');
    expect(r.rejected[0].reason).toMatch(/duplicate/);
    expect(r.graph).toBeNull();
  });
  it('rejects contents of .subckt blocks', () => {
    const r = importNetlist('t\n.subckt foo a b\nR1 a b 1k\n.ends\nV1 a 0 5\nR2 a 0 1k\n');
    expect(r.rejected.map((x) => x.line)).toEqual([2, 3, 4]);
    expect(r.graph).toBeNull();
  });
  it('floating sub-circuit gives a validate error, not a silent fix', () => {
    const r = importNetlist('t\nV1 a 0 5\nR1 a 0 1k\nR2 x y 1k\n', { measureNode: 'a' });
    expect(r.graph).toBeNull();
    expect(r.rejected).toEqual([]);
    expect(r.errors.join()).toMatch(/floating/);
  });
  it('reports missing source', () => {
    const r = importNetlist('t\nR1 a 0 1k\n', { measureNode: 'a' });
    expect(r.errors.join()).toMatch(/dc_voltage/);
  });
});

describe('KiCad rejects', () => {
  const net = (extraComp: string, extraNode: string) => `(export (version "E")
(components (comp (ref "V1") (value "DC 5")) (comp (ref "R1") (value "1k")) ${extraComp})
(nets (net (code "1") (name "GND") (node (ref "V1") (pin "2")) (node (ref "R1") (pin "2")) ${extraNode})
(net (code "2") (name "/IN") (node (ref "V1") (pin "1")) (node (ref "R1") (pin "1")))))`;
  it('accepts "DC 5" source values', () => {
    const r = importNetlist(net('', ''), { measureNode: 'IN' });
    expect(r.errors).toEqual([]);
    expect(r.graph!.components.find((c) => c.id === 'V1')!.value).toBe(5);
  });
  it('rejects capacitors and unsupported parts with reasons', () => {
    const r = importNetlist(net('(comp (ref "C1") (value "1u"))', '(node (ref "C1") (pin "2"))'));
    expect(r.graph).toBeNull();
    expect(r.rejected[0].reason).toMatch(/unsupported.*C1/);
  });
  it('requires exactly 2 pins', () => {
    const r = importNetlist(net('(comp (ref "R2") (value "1k"))', '(node (ref "R2") (pin "1")) (node (ref "R2") (pin "2")) (node (ref "R2") (pin "3"))'));
    expect(r.rejected[0].reason).toMatch(/exactly 2/);
  });
  it('rejects garbage', () => {
    expect(importNetlist('(export (version "E")', { format: 'kicad' }).graph).toBeNull();
    expect(importNetlist('(foo)', { format: 'kicad' }).rejected[0].reason).toMatch(/not a KiCad/);
  });
});

describe('40-resistor ladder', () => {
  const lines = ['* SYNTHETIC generated ladder', 'V1 n0 0 10'];
  for (let i = 0; i < 20; i++) lines.push(`RS${i} n${i} n${i + 1} 1k`, `RP${i} n${i + 1} 0 2k`);
  lines.push('.end');
  it('imports and solves; monotone decay down the ladder', () => {
    const r = importNetlist(lines.join('\n'), { measureNode: 'n20' });
    expect(r.errors).toEqual([]);
    expect(r.graph!.components).toHaveLength(41);
    const v = solveDC(r.graph!).voltages;
    expect(v.N0).toBeCloseTo(10, 9);
    for (let i = 0; i < 20; i++) expect(v[`N${i + 1}`]).toBeLessThan(v[`N${i}`]);
    expect(v.N20).toBeGreaterThan(0);
  });
});
