import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/vision', () => ({ extractWithFallback: vi.fn() }));
vi.mock('@/lib/ai/jev', () => ({ routeExtraction: vi.fn() }));
vi.mock('@/lib/ai/secondary', () => ({ verifyTopology: vi.fn() }));
vi.mock('@/lib/circuit/validate', () => ({ validateGraph: vi.fn(() => ({ ok: true })) }));

import { POST } from '@/app/api/extract/route';
import { extractWithFallback } from '@/lib/ai/vision';
import { routeExtraction } from '@/lib/ai/jev';

const post = (file?: File) => {
  const fd = new FormData();
  if (file) fd.set('image', file);
  return POST(new Request('http://x/api/extract', { method: 'POST', body: fd }));
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const png = () => new File([new Uint8Array(PNG)], 'a.png', { type: 'image/png' });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/extract', () => {
  it('400 on missing image', async () => {
    const r = await post();
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('MISSING_IMAGE');
  });

  it('415 on wrong content (declared type is not trusted)', async () => {
    expect((await post(new File(['x'], 'a.gif', { type: 'image/gif' }))).status).toBe(415);
    const r = await post(new File(['definitely not a png'], 'a.png', { type: 'image/png' }));
    expect(r.status).toBe(415);
    expect((await r.json()).error.code).toBe('UNSUPPORTED_MEDIA');
  });

  it('413 on oversize', async () => {
    expect((await post(new File([new Uint8Array(5 * 1024 * 1024 + 1).fill(1)], 'a.png', { type: 'image/png' }))).status).toBe(413);
  });

  it('ask_user without calling Jev when every provider fails', async () => {
    const extraction = {
      inputKind: 'unknown',
      graph: null,
      warnings: ['Automated extraction unavailable (gemini rate_limited, groq not_configured); enter the circuit manually.'],
      unresolvedConnections: [],
      requiresHumanReview: true,
    };
    vi.mocked(extractWithFallback).mockResolvedValue({
      extraction,
      events: [
        { step: 'extract', provider: 'google', durationMs: 1, status: 'error' },
        { step: 'extract', provider: 'groq', durationMs: 0, status: 'skipped' },
      ],
      ok: false,
    } as never);
    const r = await post(png());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.route).toBe('ask_user');
    expect(j.extraction.graph).toBeNull();
    expect(j.extraction.warnings[0]).toMatch(/Automated extraction unavailable/);
    expect(j.trace.map((t: { provider: string }) => t.provider)).toEqual(['google', 'groq', 'jev']);
    expect(j.trace[2].status).toBe('skipped');
    expect(routeExtraction).not.toHaveBeenCalled();
  });

  it('happy path returns route and 2+ trace events; Jev runs after successful extraction', async () => {
    const extraction = { inputKind: 'schematic', graph: null, warnings: [], unresolvedConnections: [], requiresHumanReview: true };
    vi.mocked(extractWithFallback).mockResolvedValue({
      extraction,
      events: [{ step: 'extract', provider: 'google', durationMs: 1, status: 'ok' }],
      ok: true,
    } as never);
    vi.mocked(routeExtraction).mockResolvedValue({
      route: 'review_extraction',
      event: { step: 'route', provider: 'beatapi', durationMs: 1, status: 'ok', chosenRoute: 'review_extraction' },
    });
    const j = await (await post(png())).json();
    expect(j.route).toBe('review_extraction');
    expect(j.trace.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(j).sort()).toEqual(['extraction', 'route', 'trace']);
  });
});
