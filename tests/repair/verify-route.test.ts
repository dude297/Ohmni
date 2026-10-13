import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/repair/verify/route';
import { LOADED_BRIDGE_12V as G } from '@/lib/circuit/fixtures';
import { revisionId } from '@/lib/circuit/revision';

const call = async (b: object) => {
  const r = await POST(new Request('http://x/api/repair/verify', { method: 'POST', body: JSON.stringify({ graph: G, userConfirmed: true, ...b }) }));
  return { status: r.status, json: await r.json() };
};
const fake = (node: string, expectVolts: number, toleranceVolts: number) => ({ verification: { node, expectVolts, toleranceVolts } });

describe('POST /api/repair/verify is server-authoritative', () => {
  it('rejects a fabricated hypothesis', async () => {
    const r = await call({ proposal: { hypothesisId: 'does:notexist', ...fake('C', 7, 0) }, measured: { node: 'C', volts: 7 } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('UNKNOWN_HYPOTHESIS');
  });
  it('rejects a nonexistent node even with huge client tolerance', async () => {
    const r = await call({ proposal: { hypothesisId: 'R6:open', ...fake('ZZ', 0, 1e9) }, measured: { node: 'ZZ', volts: 3 } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('UNKNOWN_NODE');
  });
  it('huge client tolerance does not verify a wrong reading', async () => {
    const r = await call({ hypothesisId: 'R6:open', proposal: fake('C', 7, 1e9), measured: { node: 'C', volts: 7 } });
    expect(r.json.result).toMatchObject({ verified: false, status: 'not_verified', clientExpectationIgnored: true });
  });
  it('verifies a consistent reading with server values', async () => {
    const r = await call({ hypothesisId: 'R6:open', revisionId: revisionId(G), measured: { node: 'C', volts: 2.609 } });
    expect(r.status).toBe(200);
    expect(r.json.result).toMatchObject({ verified: true, status: 'verified', node: 'C', hypothesisId: 'R6:open', basis: 'server_recomputed', revisionId: revisionId(G) });
    expect(r.json.result.expectVolts).toBeCloseTo(2.608949, 5);
    expect(r.json.result.toleranceVolts).toBeCloseTo(0.02 * 2.608949 + 0.01, 6);
    expect(r.json.result.clientExpectationIgnored).toBeUndefined();
  });
  it('rejects a wrong reading and ignores client expectation', async () => {
    expect((await call({ hypothesisId: 'R6:open', measured: { node: 'C', volts: 1.0 } })).json.result.verified).toBe(false);
    const r = await call({ proposal: { hypothesisId: 'R6:open', ...fake('C', 7, 0) }, measured: { node: 'C', volts: 7 } });
    expect(r.json.result).toMatchObject({ verified: false, clientExpectationIgnored: true });
  });
  it('409 on revision mismatch', async () => {
    const r = await call({ hypothesisId: 'R6:open', revisionId: 'rev_deadbeefdeadbeef', measured: { node: 'C', volts: 2.609 } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('REVISION_MISMATCH');
  });
});
