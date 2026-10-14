import { describe, expect, it } from 'vitest';
import { checkGrounding, extractNumbers } from '../../src/lib/explain';
import { CORPUS, evaluateGrounding } from '../../bench/grounding-corpus';

describe('typed grounding checker', () => {
  it('labelled corpus (>= 40 strings): zero false accepts, zero false rejects', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40);
    const r = evaluateGrounding(CORPUS);
    expect(r.falseAccepts).toEqual([]);
    expect(r.falseRejects).toEqual([]);
  });

  it('extracts glued units, scientific notation and space-grouped thousands', () => {
    const v = (t: string) => extractNumbers(t).map((n) => [n.value, n.dim]);
    expect(v('99volts')).toEqual([[99, 'V']]);
    expect(v('1e5 ohms')).toEqual([[1e5, 'Ω']]);
    expect(v('2.5e-3 A')).toEqual([[2.5e-3, 'A']]);
    expect(v('1 000 000 Ω')).toEqual([[1e6, 'Ω']]);
    expect(v('250 µA')).toEqual([[2.5e-4, 'A']]);
    expect(v('R12 and V1 are labels')).toEqual([]);
  });

  it('is dimension-aware: 2.5 exists only as volts', () => {
    const facts = [{ value: 2.5, dim: 'V' as const }];
    expect(checkGrounding('It is 2.5 V.', facts)).toEqual([]);
    expect(checkGrounding('It is 2.5 A.', facts)).toEqual(['2.5 A']);
    expect(checkGrounding('It is 2.5.', facts)).toEqual(['2.5']);
  });

  it('unitless numbers are only step ordinals up to the step count', () => {
    expect(checkGrounding('Step 3: divide.', [])).toEqual([]);
    expect(checkGrounding('Step 6: divide.', [])).toEqual(['6']);
    expect(checkGrounding('VOUT is 7 V.', [])).toEqual(['7 V']);
  });

  it('keeps honest rounding and legacy dimension-agnostic number facts', () => {
    expect(checkGrounding('about 3.33 V', [{ value: 10 / 3, dim: 'V' }])).toEqual([]);
    expect(checkGrounding('about 3.4 V', [{ value: 10 / 3, dim: 'V' }])).toEqual(['3.4 V']);
    expect(checkGrounding('2.5 V and 0.25 mA', [2.5, 2.5e-4])).toEqual([]);
  });
});
