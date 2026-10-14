import { solveDC } from '../circuit/solve';
import type { CircuitGraph } from '../circuit/types';
import { fmtV, type ProbeStep } from '../probe';

// Investigation report from STORED evidence: deterministic, no model calls. JSON ('ohmni.report.v1') and Markdown.

export const REPORT_DISCLAIMER =
  'All expected values are solver simulations of the confirmed design. Hypotheses are modeled single faults with uncalibrated probabilities. A "verified" repair means one post-repair reading matched the simulated design within tolerance; Ohmni performs no physical change and does not certify hardware.';

export type ReportInput = {
  investigation: { id: string; title: string; status: string; opened_at: string; closed_at: string | null };
  revision: { revisionHash: string; graph: CircuitGraph };
  measurements: { id: string; node: string; value: number; method: string; measured_at: string; supersedes: string | null; provenance: Record<string, unknown> }[];
  probe: ProbeStep;
  proposals: { id: string; patch: unknown; verification_node: string; expect_value: number; tolerance: number; status: string; created_at: string }[];
  verifications: { repair_proposal_id: string; verified: boolean; delta: number; engine_version: string; created_at: string }[];
  /** Stored engine snapshot (sorted by probability, newest computation). */
  latestHypotheses?: { hypothesis_key: string; probability: number; engine_version: string; evidence_measurement_ids: string[] }[];
};

/** Does re-running the engine on the stored evidence give the stored verdict? (paid-beta release gate) */
function reproducibility(d: ReportInput, evidenceIds: string[], engineVersion: string) {
  const snap = d.latestHypotheses ?? [];
  if (!snap.length) return { status: 'no_snapshot' as const };
  const snapshotEngine = snap[0].engine_version;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(snap[0].evidence_measurement_ids, evidenceIds)) return { status: 'stale_snapshot' as const, snapshotEngine };
  const now = new Map(d.probe.hypotheses.map((h) => [h.id, h.probability]));
  const maxProbabilityDelta = Math.max(0, ...snap.map((h) => Math.abs(h.probability - (now.get(h.hypothesis_key) ?? 0))));
  const storedTop = snap[0].hypothesis_key;
  const recomputedTop = d.probe.hypotheses[0]?.id ?? null;
  const status = storedTop === recomputedTop && maxProbabilityDelta < 1e-6 ? ('reproduced' as const) : ('differs' as const);
  return { status, snapshotEngine, currentEngine: engineVersion, storedTop, recomputedTop, maxProbabilityDelta };
}

export function buildReport(d: ReportInput, engineVersion: string, generatedAt = new Date().toISOString()) {
  const superseded = new Set(d.measurements.map((m) => m.supersedes).filter(Boolean));
  const evidenceIds = d.measurements.filter((m) => !superseded.has(m.id) && m.provenance?.kind !== 'verification').map((m) => m.id);
  let design: Record<string, number> = {};
  try {
    design = solveDC(d.revision.graph).voltages;
  } catch {
    // unsolvable stored graph: report evidence without predictions
  }
  return {
    schema: 'ohmni.report.v1' as const,
    generatedAt,
    engineVersion,
    investigation: d.investigation,
    revision: { hash: d.revision.revisionHash, components: d.revision.graph.components, groundNode: d.revision.graph.groundNode },
    designVoltages: design,
    measurements: d.measurements.map((m) => ({
      id: m.id,
      node: m.node,
      volts: m.value,
      method: m.method,
      at: m.measured_at,
      role: m.provenance?.kind === 'verification' ? ('verification' as const) : superseded.has(m.id) ? ('superseded' as const) : ('evidence' as const),
    })),
    diagnosis: {
      fit: d.probe.fit ?? 'good',
      outOfModelProbability: d.probe.outOfModelProbability ?? null,
      done: d.probe.done,
      reason: d.probe.reason,
      hypotheses: d.probe.hypotheses.slice(0, 5).map((h) => ({ id: h.id, title: h.title, probability: h.probability })),
      nextTest: d.probe.next ? { node: d.probe.next.node, instruction: d.probe.next.instruction } : null,
      reproducibility: reproducibility(d, evidenceIds, engineVersion),
    },
    repairs: d.proposals.map((p) => ({
      id: p.id,
      patch: p.patch,
      status: p.status,
      verification: { node: p.verification_node, expectVolts: p.expect_value, toleranceVolts: p.tolerance },
      checks: d.verifications.filter((v) => v.repair_proposal_id === p.id).map((v) => ({ verified: v.verified, delta: v.delta, at: v.created_at, engineVersion: v.engine_version })),
    })),
    safety: d.probe.safety,
    disclaimer: REPORT_DISCLAIMER,
  };
}
export type Report = ReturnType<typeof buildReport>;

const pct = (p: number) => `${(p * 100).toFixed(p >= 0.995 || p < 0.005 ? 1 : 0)}%`;
// User-entered text (titles, ids, node names): newlines/pipes/angle brackets become spaces; markdown syntax is
// backslash-escaped so `[x](https://...)`, emphasis or code spans render as literal text in any viewer.
const cell = (s: unknown) => String(s).replace(/[|\r\n<>]/g, ' ').replace(/[\\`*_[\]()#!~]/g, '\\$&');

export function reportMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# ${cell(r.investigation.title)}`, '');
  L.push(`Status **${r.investigation.status}** · opened ${r.investigation.opened_at}${r.investigation.closed_at ? ` · closed ${r.investigation.closed_at}` : ''}`);
  L.push(`Circuit revision \`${r.revision.hash}\` · engine \`${r.engineVersion}\` · generated ${r.generatedAt}`, '');
  L.push('## Circuit (confirmed)', '', '| Part | Kind | Value | + | − |', '|---|---|---|---|---|');
  for (const c of r.revision.components) L.push(`| ${cell(c.id)} | ${c.kind} | ${c.value} ${c.kind === 'resistor' ? 'Ω' : 'V'} | ${cell(c.positiveNode)} | ${cell(c.negativeNode)} |`);
  L.push('', '## Measurements', '', '| Time | Node | Reading | Expected (design) | Method | Use |', '|---|---|---|---|---|---|');
  for (const m of r.measurements) {
    const exp = r.designVoltages[m.node];
    L.push(`| ${m.at} | ${cell(m.node)} | ${fmtV(m.volts)} | ${exp === undefined ? '—' : fmtV(exp)} | ${m.method} | ${m.role} |`);
  }
  if (!r.measurements.length) L.push('| — | — | — | — | — | no readings yet |');
  L.push('', '## Diagnosis (recomputed from stored evidence)', '');
  if (r.diagnosis.fit === 'poor') L.push('> **No modeled single fault fits these readings.** Check the wiring against the diagram, the meter and ground reference, or consider more than one fault.', '');
  for (const h of r.diagnosis.hypotheses) L.push(`- ${cell(h.title)} — ${pct(h.probability)}`);
  const rp = r.diagnosis.reproducibility;
  L.push(
    '',
    rp.status === 'reproduced'
      ? `Reproducibility: re-running the engine on the stored evidence gives the stored verdict (stored by \`${rp.snapshotEngine}\`, re-run on \`${rp.currentEngine}\`).`
      : rp.status === 'differs'
        ? `Reproducibility: **differs** — stored ${cell(rp.storedTop)} (engine \`${rp.snapshotEngine}\`), re-run ${cell(rp.recomputedTop)} (engine \`${rp.currentEngine}\`), max probability change ${(rp.maxProbabilityDelta * 100).toFixed(2)} pts.`
        : rp.status === 'stale_snapshot'
          ? 'Reproducibility: the stored snapshot predates the latest evidence; the diagnosis above is recomputed.'
          : 'Reproducibility: no stored snapshot yet.',
  );
  L.push('', r.diagnosis.done ? `Conclusion reached: ${cell(r.diagnosis.reason)}` : r.diagnosis.nextTest ? `Next test: ${cell(r.diagnosis.nextTest.instruction)}` : cell(r.diagnosis.reason));
  L.push('', '## Repairs', '');
  if (!r.repairs.length) L.push('None proposed.');
  for (const p of r.repairs) {
    const v = p.verification;
    L.push(`- \`${p.id.slice(0, 8)}\` **${p.status}** — check ${cell(v.node)}: expect ${fmtV(v.expectVolts)} ± ${fmtV(v.toleranceVolts)}`);
    for (const c of p.checks) L.push(`  - ${c.at}: ${c.verified ? 'within tolerance' : 'outside tolerance'} (Δ ${fmtV(c.delta)})`);
  }
  L.push('', '## Safety', '', cell(r.safety), '', '---', '', `_${r.disclaimer}_`, '');
  return L.join('\n');
}
