import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/gemini', () => ({ extractCircuit: vi.fn() }));

import { POST } from '@/app/api/extract/route';
import { extractCircuit } from '@/lib/ai/gemini';
import { DIVIDER_10K_10K, MALFORMED_FLOATING } from '@/lib/circuit/fixtures';

const post = () => {
  const fd = new FormData();
  fd.set('image', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
  return POST(new Request('http://x/api/extract', { method: 'POST', body: fd }));
};
const mockExtract = (graph: unknown) =>
  vi.mocked(extractCircuit).mockResolvedValue({
    extraction: { inputKind: 'schematic', graph, warnings: [], unresolvedConnections: [], requiresHumanReview: true },
    event: { step: 'extract', provider: 'gemini', durationMs: 1, status: 'ok' },
  } as never);
const jevReply = (choice: string) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { route: { choice, confidence: 0.9 } } })));

beforeEach(() => vi.stubEnv('TYPESAFE_API_KEY', 'k'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/extract with real validateGraph + real Jev client', () => {
  it('valid 10k/10k divider -> review_extraction', async () => {
    mockExtract(DIVIDER_10K_10K);
    const f = jevReply('review_extraction');
    vi.stubGlobal('fetch', f);
    const j = await (await post()).json();
    expect(j.route).toBe('review_extraction');
    expect(j.trace.map((e: { step: string }) => e.step)).toEqual(['extract', 'route']);
    expect(JSON.parse(f.mock.calls[0][1].body).state).toMatch(/Validation errors: none/);
  });

  it('floating graph -> validation errors reach the Jev state', async () => {
    mockExtract(MALFORMED_FLOATING);
    const f = jevReply('ask_user');
    vi.stubGlobal('fetch', f);
    const j = await (await post()).json();
    expect(j.route).toBe('ask_user');
    const state: string = JSON.parse(f.mock.calls[0][1].body).state;
    expect(state).not.toMatch(/Validation errors: none/);
  });
});
