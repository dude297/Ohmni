import { describe, expect, it } from 'vitest';
import { LOADED_BRIDGE_12V } from '@/lib/circuit/fixtures';
import { probeStep, R_MAX } from '@/lib/probe';
import { buildReport, reportMarkdown, REPORT_DISCLAIMER } from '@/lib/persist/report';

const m = (id: string, node: string, value: number, extra: Partial<{ supersedes: string; provenance: Record<string, unknown> }> = {}) => ({
  id, node, value, method: 'typed', measured_at: `2026-10-14T00:00:0${id}Z`, supersedes: extra.supersedes ?? null, provenance: extra.provenance ?? {},
});

describe('investigation report', () => {
  const measurements = [m('1', 'C', 0), m('2', 'A', 7.533), m('3', 'B', 5.22), m('4', 'B', 4.09, { provenance: { kind: 'verification' } })];
  const report = buildReport(
    {
      investigation: { id: 'i', title: 'C reads 0 V | <b> [click](https://evil.example) *x*', status: 'open', opened_at: 't0', closed_at: null },
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
    expect(md).toContain(String.raw`# C reads 0 V    b  \[click\]\(https://evil.example\) \*x\*`);
    expect(md).not.toContain('<b>');
    expect(md).not.toContain('[click](');
    expect(md).toContain('| R6 | resistor | 680 Ω | B | C |');
    expect(md).toContain('**verified**');
    expect(md).toContain('within tolerance');
    expect(md).toContain('Ohmni performs no physical change');
  });

  it('says whether the stored verdict reproduces from stored evidence', () => {
    const base = {
      investigation: { id: 'i', title: 't', status: 'open', opened_at: 't0', closed_at: null },
      revision: { revisionHash: 'rev_0123456789abcdef', graph: LOADED_BRIDGE_12V },
      measurements: measurements.slice(0, 3),
      probe: probeStep(LOADED_BRIDGE_12V, measurements.slice(0, 3).map((x) => ({ node: x.node, volts: x.value }))),
      proposals: [],
      verifications: [],
    };
    const snap = (probability: number, ids = ['1', '2', '3']) =>
      base.probe.hypotheses.slice(0, 3).map((h, i) => ({ hypothesis_key: h.id, probability: i === 0 ? probability : h.probability, engine_version: 'old1234', evidence_measurement_ids: ids }));
    const ok = buildReport({ ...base, latestHypotheses: snap(base.probe.hypotheses[0].probability) }, 'new5678');
    expect(ok.diagnosis.reproducibility).toMatchObject({ status: 'reproduced', snapshotEngine: 'old1234', currentEngine: 'new5678' });
    expect(reportMarkdown(ok)).toContain('gives the stored verdict');
    expect(buildReport({ ...base, latestHypotheses: snap(0.5) }, 'x').diagnosis.reproducibility.status).toBe('differs');
    expect(buildReport({ ...base, latestHypotheses: snap(1, ['1', '2']) }, 'x').diagnosis.reproducibility.status).toBe('stale_snapshot');
    expect(buildReport(base, 'x').diagnosis.reproducibility.status).toBe('no_snapshot');
  });

  it('reports power-off resistance readings with their node pair, OL at over-range', () => {
    const ms = [
      { ...m('1', 'A', 4700), quantity: 'resistance', reference_node: 'GND' },
      { ...m('2', 'B', R_MAX), quantity: 'resistance', reference_node: 'C' },
      m('3', 'C', 0),
    ];
    const r = buildReport(
      { investigation: { id: 'i', title: 't', status: 'open', opened_at: 't0', closed_at: null }, revision: { revisionHash: 'rev_x', graph: LOADED_BRIDGE_12V }, measurements: ms, probe: probeStep(LOADED_BRIDGE_12V, []), proposals: [], verifications: [] },
      'x',
    );
    expect(r.measurements[0]).toMatchObject({ quantity: 'resistance', node: 'A', reference: 'GND', ohms: 4700 });
    expect(r.measurements[2]).toMatchObject({ quantity: 'voltage', node: 'C', volts: 0 });
    const md = reportMarkdown(r);
    expect(md).toContain('| A–GND (power off) | 4.7 kΩ | — |');
    expect(md).toContain('| B–C (power off) | OL | — |');
  });
});
