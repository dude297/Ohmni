import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/probe-multi/route';
import { LOADED_BRIDGE_12V, MALFORMED_NO_GND } from '@/lib/circuit/fixtures';

const post = (b: unknown) => POST(new Request('http://x/api/probe-multi', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));

describe('POST /api/probe-multi', () => {
  it('400 on bad JSON, 422 unconfirmed / invalid graph', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ graph: LOADED_BRIDGE_12V })).status).toBe(422);
    expect((await post({ graph: LOADED_BRIDGE_12V, userConfirmed: 'true' })).status).toBe(422);
    const r = await post({ graph: MALFORMED_NO_GND, userConfirmed: true });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('INVALID_GRAPH');
  });
  it('200 with pair hypotheses and trace', async () => {
    const r = await post({ graph: LOADED_BRIDGE_12V, userConfirmed: true, observations: [{ node: 'C', volts: 0 }] });
    const { result } = await r.json();
    expect(r.status).toBe(200);
    expect(result.hypothesisOnly).toBe(true);
    expect(result.pairsSolved).toBeGreaterThan(0);
    expect(result.trace[0].step).toBe('probe-multi');
  });
});
