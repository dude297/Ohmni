import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/ai/gemini', () => ({ extractCircuit: vi.fn() }));
vi.mock('../../src/lib/ai/jev', () => ({ routeExtraction: vi.fn() }));
vi.mock('../../src/lib/ai/secondary', () => ({ verifyTopology: vi.fn() }));
vi.mock('../../src/lib/circuit/validate', () => ({ validateGraph: vi.fn(() => ({ ok: true })) }));

import { POST } from '../../src/app/api/extract/route';
import { extractCircuit } from '../../src/lib/ai/gemini';
import { routeExtraction } from '../../src/lib/ai/jev';

const post = (file?: File) => {
  const fd = new FormData();
  if (file) fd.set('image', file);
  return POST(new Request('http://x/api/extract', { method: 'POST', body: fd }));
};
const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/extract', () => {
  it('400 on missing image', async () => {
    const r = await post();
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('MISSING_IMAGE');
  });

  it('400 on wrong mime', async () => {
    expect((await post(new File(['x'], 'a.gif', { type: 'image/gif' }))).status).toBe(400);
  });

  it('413 on oversize', async () => {
    expect((await post(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }))).status).toBe(413);
  });

  it('falls back to ask_user when extraction throws', async () => {
    vi.mocked(extractCircuit).mockRejectedValue(new Error('GEMINI_NOT_CONFIGURED'));
    const r = await post(png());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.route).toBe('ask_user');
    expect(j.extraction.graph).toBeNull();
    expect(j.extraction.warnings[0]).toMatch(/Vision extraction unavailable/);
    expect(j.trace[0].status).toBe('error');
  });

  it('happy path returns route and 2+ trace events', async () => {
    const extraction = { inputKind: 'schematic', graph: null, warnings: [], unresolvedConnections: [], requiresHumanReview: true };
    vi.mocked(extractCircuit).mockResolvedValue({ extraction, event: { step: 'extract', provider: 'gemini', durationMs: 1, status: 'ok' } } as never);
    vi.mocked(routeExtraction).mockResolvedValue({
      route: 'review_extraction',
      event: { step: 'route', provider: 'typesafe', durationMs: 1, status: 'ok', chosenRoute: 'review_extraction' },
    });
    const j = await (await post(png())).json();
    expect(j.route).toBe('review_extraction');
    expect(j.trace.length).toBeGreaterThanOrEqual(2);
  });
});
