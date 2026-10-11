import { describe, expect, it } from 'vitest';
import { DISCLAIMER, buildExamplePacket, parsePacket, toMarkdown } from '@/app/teams/packet';

describe('teams packet', () => {
  const p = buildExamplePacket();
  it('example uses solver values', () => {
    expect(p.predictions.voltages.C).toBeCloseTo(2.6089, 4);
    expect(p.observations.map((o) => o.volts)).toEqual([0, 7.533]);
    expect(p.hypotheses.length).toBeGreaterThan(0);
  });
  it('validates round-trip and rejects bad input', () => {
    expect(parsePacket(JSON.stringify(p)).ok).toBe(true);
    expect(parsePacket(JSON.stringify({ ...p, schema: 'x' })).ok).toBe(false);
    expect(parsePacket('{nope').ok).toBe(false);
    expect(parsePacket(JSON.stringify({ ...p, observations: [{ node: 'A', volts: 'hi', at: '' }] })).ok).toBe(false);
  });
  it('markdown has disclaimer, packet numbers, preserves repair status', () => {
    const withRepair = { ...p, repair: { title: 'Replace R6', patch: {}, before: { C: 0 }, after: { C: 2.6089 }, status: 'hypothesized' as const } };
    const md = toMarkdown(withRepair, 'abc123', 'note', ['why?']);
    expect(md).toContain('Browser-only');
    expect(md).toContain(DISCLAIMER);
    expect(md).toContain('Status (as in packet): hypothesized');
    expect(md).toContain('2.609');
    expect(md).toContain('7.533');
    expect(md).toContain('Open question: why?');
  });
});
