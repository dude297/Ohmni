import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../../src/lib/ac/netlist';
import { validateAcGraph, type AcGraph } from '../../src/lib/ac/types';
import { rcLowpass } from './fixtures';

const ALLOWED = [
  /^ohmni ac$/,
  /^[RCL]\d+ (0|n\d+) (0|n\d+) \d(\.\d+)?e-?\d+$/,
  /^V\d+ (0|n\d+) (0|n\d+) DC 0 AC 1$/,
  /^\.ac dec \d+ \d(\.\d+)?e-?\d+ \d(\.\d+)?e-?\d+$/,
  /^\.end$/,
];

describe('netlist mapper', () => {
  it('emits only whitelisted line shapes with plain exponent values', () => {
    const { text } = buildNetlist(rcLowpass());
    for (const l of text.split('\n')) expect(ALLOWED.some((r) => r.test(l)), l).toBe(true);
    expect(text).toContain('R2 n1 n2 1.000000000e3');
    expect(text).toContain('.ac dec 20 1.000000000e0 1.000000000e7');
  });

  it('cannot be injected through ids or node names, even bypassing validation', () => {
    const evil = 'x\n.include /etc/passwd\n.control\nshell calc\n.endc\n* ';
    const g = rcLowpass();
    g.components = g.components.map((c) => ({ ...c, id: evil + c.id, ...(c.a === 'out' ? { a: evil } : {}) })) as AcGraph['components'];
    const { text } = buildNetlist({ ...g, outputNode: evil });
    expect(text.split('\n')).toHaveLength(1 + 3 + 2);
    for (const l of text.split('\n')) expect(ALLOWED.some((r) => r.test(l)), l).toBe(true);
    expect(text).not.toMatch(/include|control|shell|passwd|endc/i);
  });

  it('validator rejects hostile or out-of-range graphs', () => {
    const bad = (mut: (g: AcGraph) => void) => {
      const g = structuredClone(rcLowpass());
      mut(g);
      return validateAcGraph(g).length > 0;
    };
    expect(validateAcGraph(rcLowpass())).toEqual([]);
    expect(bad((g) => (g.components[1].id = 'R1\n.include /etc/passwd'))).toBe(true);
    expect(bad((g) => (g.outputNode = 'out\n.control'))).toBe(true);
    expect(bad((g) => ((g.components[1] as { value: number }).value = 0.5))).toBe(true);
    expect(bad((g) => ((g.components[2] as { value: number }).value = 1))).toBe(true);
    expect(bad((g) => g.components.push(structuredClone(g.components[0])))).toBe(true);
    expect(bad((g) => ((g.components[0] as { kind: string }).kind = 'resistor'))).toBe(true);
    expect(bad((g) => (g.components = Array(13).fill(g.components[1])))).toBe(true);
  });

  it('bounds the sweep', () => {
    const g = rcLowpass();
    expect(() => buildNetlist(g, { pointsPerDecade: 51, fMin: 1, fMax: 1e7 })).toThrow();
    expect(() => buildNetlist(g, { pointsPerDecade: 10, fMin: 0.5, fMax: 1e7 })).toThrow();
    expect(() => buildNetlist(g, { pointsPerDecade: 10, fMin: 1, fMax: 1e8 })).toThrow();
  });
});
