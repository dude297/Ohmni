import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTopology } from '../../src/lib/ai/secondary';

const ex = { inputKind: 'schematic' as const, graph: null, warnings: [], unresolvedConnections: ['R1?'], requiresHumanReview: true as const };
const img = new Uint8Array([1, 2, 3]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('verifyTopology', () => {
  it('skipped without key, no fetch', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event).toMatchObject({ status: 'skipped', note: 'OPENAI_API_KEY not configured' });
    expect(f).not.toHaveBeenCalled();
  });

  it('returns revised extraction when output parses', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ graph: null, unresolvedConnections: [] }) }))));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.event.status).toBe('ok');
    expect(r.extraction?.unresolvedConnections).toEqual([]);
  });

  it('unparseable output -> error, no extraction', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: 'nope' }))));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event.status).toBe('error');
  });
});
