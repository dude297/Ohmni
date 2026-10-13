import { describe, expect, it } from 'vitest';
import { revisionId } from '@/lib/circuit/revision';
import { LOADED_BRIDGE_12V as G } from '@/lib/circuit/fixtures';

describe('revisionId', () => {
  it('is deterministic and order-insensitive', () => {
    const shuffled = { ...G, components: [...G.components].reverse().map((c) => Object.fromEntries(Object.entries(c).reverse())) } as typeof G;
    expect(revisionId(G)).toMatch(/^rev_[0-9a-f]{16}$/);
    expect(revisionId(shuffled)).toBe(revisionId(G));
  });
  it('changes with any value or node change', () => {
    const val = { ...G, components: G.components.map((c) => (c.id === 'R6' ? { ...c, value: 681 } : c)) };
    const node = { ...G, components: G.components.map((c) => (c.id === 'R6' ? { ...c, positiveNode: 'A' } : c)) } as typeof G;
    expect(revisionId(val)).not.toBe(revisionId(G));
    expect(revisionId(node)).not.toBe(revisionId(G));
  });
});
