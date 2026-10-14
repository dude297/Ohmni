import { describe, expect, it } from 'vitest';
import { LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { probeStep } from '@/lib/probe';
import { buildReport, reportMarkdown, REPORT_DISCLAIMER } from '@/lib/persist/report';

const m = (id: string, node: string, value: number, extra: Partial<{ supersedes: string; provenance: Record<string, unknown> }> = {}) => ({
  id, node, value, method: 'typed', measured_at: `2026-10-14T00:00:0${id}Z`, supersedes: extra.supersedes ?? null, provenance: extra.provenance ?? {},
});

describe('investigation report', () => {
  const measurements = [m('1', 'C', 0), m('2', 'A', 7.533), m('3', 'B', 5.22), m('4', 'B', 4.09, { provenance: { kind: 'verification' } })];
  const report = buildReport(
    {
      investigation: { id: 'i', title: 'C reads 0 V | <b>', status: 'open', opened_at: 't0', closed_at: null },
      revision: { revisionHash: 'rev_0123456789abcdef', graph: LOADED_BRIDGE_12V },
      measurements,
      probe: probeStep(LOADED_BRIDGE_12V, measurements.slice(0, 3).map((x) => ({ node: x.node, volts: x.value }))),
      proposals: [{ id: 'p1234567-x', patch: { componentId: 'R6' }, verification_node: 'B', expect_value: 4.087, tolerance: 0.092, status: 'verified', created_at: 't1' }],
      verifications: [{ repair_proposal_id: 'p1234567-x', verified: true, delta: 0.003, engine_version: 'abc1234', created_at: 't2' }],
    },
    'abc1234',
    'tG',
  );

  it('carries diagnosis, roles, design predictions and the disclaimer', () => {
    expect(report.schema).toBe('ohmni.report.v1');
    expect(report.diagnosis.hypotheses[0].id).toBe('R6:open');
    expect(report.diagnosis.done).toBe(true);
    expect(report.measurements.map((x) => x.role)).toEqual(['evidence', 'evidence', 'evidence', 'verification']);
    expect(report.designVoltages.C).toBeCloseTo(2.608949, 5);
    expect(report.repairs[0].checks).toHaveLength(1);
    expect(report.disclaimer).toBe(REPORT_DISCLAIMER);
  });

  it('renders markdown with user text neutralised', () => {
    const md = reportMarkdown(report);
    expect(md).toContain('# C reads 0 V    b ');
    expect(md).not.toContain('<b>');
    expect(md).toContain('| R6 | resistor | 680 Ω | B | C |');
    expect(md).toContain('**verified**');
    expect(md).toContain('within tolerance');
    expect(md).toContain('Ohmni performs no physical change');
  });
});
