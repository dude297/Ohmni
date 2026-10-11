import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importReadings } from '@/lib/instrument/import';
import { runInvestigation } from '@/lib/instrument/investigate';
import { repairStep, verifyRepair } from '@/lib/repair';
import { LOADED_BRIDGE_12V as G } from '@/lib/circuit/fixtures';

describe('evidence -> repair (bridge R6 open)', () => {
  it('imports, investigates, proposes, verifies', () => {
    const imported = importReadings(readFileSync('fixtures/instrument/bridge_r6_open.csv', 'utf8'), G);
    expect(imported.observations.map((o) => o.node)).toEqual(['C', 'A']);
    const inv = runInvestigation(G, imported);
    expect('steps' in inv && inv.steps.at(-1)!.top[0].id).toBe('R6:open');
    const p = repairStep(G, imported.observations).proposals[0];
    expect(p.hypothesisId).toBe('R6:open');
    expect(p.resolves).toBe(true);
    expect(verifyRepair(p.verification, { node: 'C', volts: 2.61 })).toMatchObject({ verified: true, status: 'verified' });
    expect(verifyRepair(p.verification, { node: 'C', volts: 0.5 })).toMatchObject({ verified: false, status: 'not_verified' });
  });
});
