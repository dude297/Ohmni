import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTopology } from '@/lib/ai/secondary';

const ex = { inputKind: 'schematic' as const, graph: null, warnings: [], unresolvedConnections: ['R1?'], requiresHumanReview: true as const };
const img = new Uint8Array([1, 2, 3]);
const good = {
  inputKind: 'schematic',
  components: [
    { id: 'V1', kind: 'dc_voltage', value: '5V', positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: '10k', positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: '10k', positiveNode: 'VOUT', negativeNode: 'GND' },
  ],
  measureNode: 'VOUT',
  warnings: [],
  unresolvedConnections: [],
};
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('verifyTopology (Groq)', () => {
  it('skipped without key, no fetch', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event).toMatchObject({ provider: 'groq', status: 'skipped', note: 'GROQ_API_KEY not configured' });
    expect(f).not.toHaveBeenCalled();
  });

  it('returns validated revised extraction with an agreement-is-not-proof note', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify(good))));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.event.status).toBe('ok');
    expect(r.event.note).toMatch(/not proof/);
    expect(r.extraction?.graph?.measureNode).toBe('VOUT');
    expect(r.extraction?.warnings.join()).toMatch(/not proof/);
    expect(r.extraction?.requiresHumanReview).toBe(true);
  });

  it('unparseable output -> error, no extraction', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('nope')));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event.status).toBe('error');
  });

  it('output that fails normalisation -> error, original kept', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify({ ...good, measureNode: 'NOPE' }))));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event.status).toBe('error');
  });

  it('HTTP 429 -> error event, no extraction', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    const r = await verifyTopology(img, 'image/png', ex);
    expect(r.extraction).toBeUndefined();
    expect(r.event).toMatchObject({ status: 'error', note: expect.stringContaining('429') });
  });
});
