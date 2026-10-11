import { describe, expect, it } from 'vitest';
import { diagnose } from '@/lib/diagnosis';
import { DIVIDER_10K_10K } from '@/lib/circuit/fixtures';

describe('diagnose with real MNA solver', () => {
  it('0.45V on 10k/10k points at R2 ≈ 1kΩ', () => {
    const h = diagnose(DIVIDER_10K_10K, 0.45);
    expect(h[0].title).toMatch(/R2/);
    expect(h[0].title).toMatch(/1 kΩ/);
  });
  it('2.5V matches expected', () => {
    expect(diagnose(DIVIDER_10K_10K, 2.5)[0].title).toMatch(/match/i);
  });
  it('5V and 0V give open/short hypotheses', () => {
    expect(diagnose(DIVIDER_10K_10K, 5).map((h) => h.title).join(' ')).toMatch(/short|open/i);
    expect(diagnose(DIVIDER_10K_10K, 0).map((h) => h.title).join(' ')).toMatch(/short|open/i);
  });
});
