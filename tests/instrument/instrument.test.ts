import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseRecords, parseVolts } from '@/lib/instrument/csv';
import { importReadings, MAX_OBSERVATIONS } from '@/lib/instrument/import';
import { LADDER_10K, runInvestigation, type InvestigationStep } from '@/lib/instrument/investigate';
import { DIVIDER_10K_10K } from '@/lib/circuit/fixtures';
import { probeStep } from '@/lib/probe';

const H = 'node,value,unit\n';
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/instrument/${name}`, import.meta.url), 'utf8');
const steps = (inv: ReturnType<typeof runInvestigation>): InvestigationStep[] => {
  if ('error' in inv) throw new Error(inv.error);
  return inv.steps;
};
const prob = (s: InvestigationStep, id: string) => s.top.find((h) => h.id === id)?.probability ?? 0;

describe('csv parser', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const { records } = parseRecords('﻿a,b\r\n"x, y","he said ""hi""\nok"\r\nlast,1');
    expect(records.map((r) => r.fields)).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nok'],
      ['last', '1'],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('skips # comments and blank lines; reports physical line numbers', () => {
    const t = parseCsv('# SYNTHETIC\n\nnode,value,unit\n# mid comment\nB,1,V\n\nA,2,V\n');
    expect(t.error).toBeUndefined();
    expect(t.rows.map((r) => [r.row, r.values.node])).toEqual([
      [5, 'B'],
      [7, 'A'],
    ]);
  });

  it('header is case-insensitive, any order; extra columns warn; missing columns fail', () => {
    const t = parseCsv('Unit , NODE,Value,Operator\nmV,B,450,ana\n');
    expect(t.rows[0].values).toEqual({ unit: 'mV', node: 'B', value: '450' });
    expect(t.warnings[0]).toMatch(/operator/);
    expect(parseCsv('node,value\nB,1\n').error).toMatch(/missing required column.*unit/);
    expect(parseCsv('# only a comment\n').error).toMatch(/no header/);
    expect(parseCsv('node,value,unit\n"B,1,V\n').error).toMatch(/unterminated/);
  });

  it('short rows leave columns undefined instead of shifting', () => {
    expect(parseCsv(H + 'B,1\n').rows[0].values).toEqual({ node: 'B', value: '1' });
  });
});

describe('units and numbers', () => {
  const v = (value: string, unit: string) => {
    const r = parseVolts(value, unit);
    return 'volts' in r ? r.volts : r.error;
  };
  it('0.45 V and 450 mV are the identical double; 4.5 and 0.45 differ', () => {
    expect(v('450', 'mV')).toBe(0.45);
    expect(v('0.45', 'V')).toBe(v('450', 'mV'));
    expect(v('4.5', 'V')).not.toBe(v('0.45', 'V'));
    expect(v('4.5e2', 'mV')).toBe(0.45);
    expect(v('0.1', 'mV')).toBe(0.0001);
  });
  it('trims and is case-insensitive for V/mV, but rejects MV, kV, µV, A, Ω', () => {
    expect(v(' 1.5 ', ' v ')).toBe(1.5);
    expect(v('12', 'MV')).toMatch(/ambiguous/);
    for (const u of ['kV', 'µV', 'uV', 'A', 'Ω', '', 'V DC']) expect(v('1', u)).toMatch(/unsupported unit/);
    expect(v('12', 'mv')).toBe(0.012);
  });
  it('rejects malformed numbers', () => {
    for (const bad of ['', '1,5', '1,000', 'NaN', 'Infinity', '-Infinity', '0x10', '1.2.3', '5V', '1e', '--1'])
      expect(v(bad, 'V')).toMatch(/malformed/);
    expect(v('1e400', 'V')).toMatch(/out of range/);
    expect(v('-0', 'V')).toBe(0);
    expect(Object.is(v('-0', 'V'), -0)).toBe(false);
  });
});

describe('importReadings', () => {
  it('validates node names against the graph (case-insensitive) and rejects GND / unknown', () => {
    const r = importReadings(H + 'b,1.67,V\nGND,0,V\ngnd,0,V\nC,1,V\n,1,V\n', LADDER_10K);
    expect(r.observations).toEqual([{ node: 'B', volts: 1.67, rows: [2], timestamp: undefined }]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/GND is the reference/),
      expect.stringMatching(/GND is the reference/),
      expect.stringMatching(/unknown node "C"/),
      'missing node',
    ]);
  });

  it('rejects malformed values, missing unit, bad timestamps per row without failing the file', () => {
    const r = importReadings(
      'node,value,unit,timestamp\nA,abc,V,\nA,1,,\nA,1,V,yesterday\nA,1,V,2026-13-45T99:00:00Z\nB,1.67,V,2026-10-11T10:00:00Z\n',
      LADDER_10K,
    );
    expect(r.observations.map((o) => o.node)).toEqual(['B']);
    expect(r.rejected.map((x) => x.row)).toEqual([2, 3, 4, 5]);
    expect(r.rejected[1].reason).toMatch(/missing unit/);
    expect(r.rejected[2].reason).toMatch(/timestamp/);
  });

  it('enforces size and row limits on the whole file', () => {
    const big = H + '#' + 'x'.repeat(256 * 1024) + '\n';
    expect(importReadings(big, LADDER_10K).rejected).toEqual([{ row: 0, reason: 'input exceeds 256 KB' }]);
    const many = H + 'B,1.67,V\n'.repeat(501);
    expect(importReadings(many, LADDER_10K).rejected[0]).toEqual({ row: 0, reason: 'too many rows (501 > 500)' });
    expect(importReadings(H + 'B,1.67,V\n'.repeat(500), LADDER_10K).observations).toHaveLength(1);
  });

  it(`caps accepted observations at ${MAX_OBSERVATIONS}`, () => {
    // 60-node chain: V1 -> N0 -> ... -> N59 -> GND
    const comps = Array.from({ length: 60 }, (_, i) => ({
      id: `R${i}`,
      kind: 'resistor' as const,
      value: 1000,
      positiveNode: i ? `N${i - 1}` : 'VIN',
      negativeNode: i === 59 ? 'GND' : `N${i}`,
    }));
    const g = {
      ...LADDER_10K,
      measureNode: 'N0',
      components: [LADDER_10K.components[0], ...comps],
    };
    const csv = H + Array.from({ length: 59 }, (_, i) => `N${i},1,V`).join('\n') + '\n';
    const r = importReadings(csv, g);
    expect(r.observations).toHaveLength(MAX_OBSERVATIONS);
    expect(r.rejected).toHaveLength(9);
    expect(r.rejected[0].reason).toMatch(/probe cap/);
  });

  it('collapses duplicates within tolerance and merges provenance', () => {
    const r = importReadings(
      'node,value,unit,instrument,channel\nB,1.67,V,DMM-1,CH1\nB,1665,mV,DMM-2,CH3\n',
      LADDER_10K,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0].rows).toEqual([2, 3]);
    expect(r.observations[0].volts).toBeCloseTo(1.6675, 9);
    expect(r.provenance.map((p) => [p.instrument, p.channel, p.raw])).toEqual([
      ['DMM-1', 'CH1', 'B,1.67,V,DMM-1,CH1'],
      ['DMM-2', 'CH3', 'B,1665,mV,DMM-2,CH3'],
    ]);
  });

  it('contradictory readings: default policy rejects the node, keeps provenance', () => {
    const csv = 'node,value,unit,timestamp\nA,5,V,2026-10-11T10:00:10Z\nA,3.3,V,2026-10-11T10:00:00Z\nB,0,V,2026-10-11T10:00:05Z\n';
    const r = importReadings(csv, LADDER_10K);
    expect(r.observations.map((o) => o.node)).toEqual(['B']);
    expect(r.rejected).toEqual([
      { row: 2, reason: expect.stringMatching(/contradictory readings at A/) },
      { row: 3, reason: expect.stringMatching(/contradictory readings at A/) },
    ]);
    expect(r.provenance).toHaveLength(3);
  });

  it("contradictory readings: policy 'latest' keeps the most recent timestamp", () => {
    const csv = 'node,value,unit,timestamp\nA,5,V,2026-10-11T10:00:10Z\nA,3.3,V,2026-10-11T10:00:00Z\nB,0,V,2026-10-11T10:00:05Z\n';
    const r = importReadings(csv, LADDER_10K, { policy: 'latest' });
    // ordered by timestamp: B (10:00:05) before A (10:00:10)
    expect(r.observations.map((o) => [o.node, o.volts, o.rows])).toEqual([
      ['B', 0, [4]],
      ['A', 5, [2]],
    ]);
    expect(r.warnings.join()).toMatch(/policy 'latest' keeps row 2/);
  });

  it('just outside tolerance counts as contradictory (2 % + 10 mV)', () => {
    expect(importReadings(H + 'B,1.000,V\nB,1.029,V\n', LADDER_10K).observations).toHaveLength(1);
    expect(importReadings(H + 'B,1.000,V\nB,1.040,V\n', LADDER_10K).observations).toHaveLength(0);
  });

  it('warns (but accepts) readings beyond 1.1 × max source voltage', () => {
    const r = importReadings(H + 'VIN,5.4,V\nA,5.6,V\n', LADDER_10K);
    expect(r.observations).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/A .*check meter range/);
  });

  it('observations feed probeStep unchanged', () => {
    const r = importReadings(fixture('ladder_r2_open.csv'), LADDER_10K);
    expect(probeStep(LADDER_10K, r.observations).hypotheses[0].id).toBe('R2:open');
  });
});

describe('runInvestigation', () => {
  it('ladder: B=0 then A=5 -> R2 open on top, probability rising each step', () => {
    const r = importReadings(fixture('ladder_r2_open.csv'), LADDER_10K);
    expect(r.rejected).toEqual([]);
    expect(r.observations.map((o) => [o.node, o.rows])).toEqual([
      ['B', [4, 6]],
      ['A', [5]],
    ]);
    const s = steps(runInvestigation(LADDER_10K, r));
    expect(s).toHaveLength(3);
    expect(s[0].top[0].id).toBe('nominal');
    const p = s.map((x) => prob(x, 'R2:open'));
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(s[2].top[0].id).toBe('R2:open');
    expect(s[2].done).toBe(true);
    expect(s[1].lost?.id).toBe('nominal');
    expect(s[2].gained?.id).toBe('R2:open');
    expect(s[1].diagnosis?.map((d) => d.title)).toContain('R2 may be open (disconnected)');
  });

  it('divider: 450 mV at VOUT -> R2 ≈ 1 kΩ hypothesis via probe and diagnose()', () => {
    const r = importReadings(fixture('divider_r2_1k.csv'), DIVIDER_10K_10K);
    expect(r.observations[0]).toMatchObject({ node: 'VOUT', volts: 0.45 });
    const s = steps(runInvestigation(DIVIDER_10K_10K, r));
    expect(s[1].top.map((h) => h.id)).toContain('R2:x0.1');
    expect(s[1].diagnosis?.[0].title).toBe('R2 may be 1 kΩ instead of 10 kΩ');
  });

  it('messy export: rejections are reported and the rest still runs', () => {
    const r = importReadings(fixture('messy_export.csv'), LADDER_10K);
    expect(r.rejected.map((x) => x.row)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(r.observations.map((o) => o.node)).toEqual(['B']);
    expect(steps(runInvestigation(LADDER_10K, r))).toHaveLength(2);
  });

  it('every fixture is labeled synthetic', () => {
    for (const f of ['ladder_r2_open.csv', 'divider_r2_1k.csv', 'messy_export.csv'])
      expect(fixture(f).split(/\r?\n/)[0]).toBe('# SYNTHETIC — generated for tests, not captured by an instrument');
  });

  it('rejects an invalid graph instead of throwing', () => {
    const bad = { ...LADDER_10K, measureNode: 'NOPE' };
    expect(runInvestigation(bad, importReadings(H, bad))).toHaveProperty('error');
  });
});
