import type { CircuitGraph } from '../circuit/types';
import { parseCsv, parseVolts } from './csv';

// Instrument evidence import: CSV of real meter readings -> validated {node, volts} observations
// that the Probe Guide (probeStep) and diagnose() accept unchanged. Offline, pure, no actuation.

export const MAX_BYTES = 256 * 1024;
export const MAX_ROWS = 500;
export const MAX_OBSERVATIONS = 50; // probe API cap

export type ImportPolicy = 'reject' | 'latest';
export type ImportOptions = { policy?: ImportPolicy };
export type ReadingProvenance = {
  row: number; // 1-based physical line in the CSV (0 = whole file)
  node: string; // canonical graph node name
  volts: number;
  timestamp?: string;
  instrument?: string;
  channel?: string;
  note?: string;
  raw: string;
};
export type ImportedObservation = {
  node: string;
  volts: number;
  rows: number[]; // provenance: every CSV row merged into this observation
  timestamp?: string;
};
export type RejectedRow = { row: number; reason: string };
export type ImportResult = {
  observations: ImportedObservation[]; // assignable to probe Observation[]; ordered by timestamp (else file order)
  provenance: ReadingProvenance[]; // every row that parsed and named a valid node, incl. contradictory ones
  rejected: RejectedRow[];
  warnings: string[];
};

// Same tolerance as the Probe Guide likelihood: 2 % of reading + 10 mV.
const tol = (a: number, b: number) => 0.02 * Math.max(Math.abs(a), Math.abs(b)) + 0.01;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const fmt = (v: number) => `${+v.toPrecision(4)} V`;

export function importReadings(csvText: string, graph: CircuitGraph, opts: ImportOptions = {}): ImportResult {
  const policy = opts.policy ?? 'reject';
  const fail = (reason: string, warnings: string[] = []): ImportResult => ({
    observations: [],
    provenance: [],
    rejected: [{ row: 0, reason }],
    warnings,
  });
  if (new TextEncoder().encode(csvText).length > MAX_BYTES) return fail(`input exceeds ${MAX_BYTES / 1024} KB`);
  const table = parseCsv(csvText);
  if (table.error) return fail(table.error, table.warnings);
  if (table.rows.length > MAX_ROWS) return fail(`too many rows (${table.rows.length} > ${MAX_ROWS})`, table.warnings);

  const warnings = [...table.warnings];
  const rejected: RejectedRow[] = [];
  const nodes = new Map<string, string>();
  for (const c of graph.components) for (const n of [c.positiveNode, c.negativeNode]) nodes.set(n.toLowerCase(), n);
  const gnd = graph.groundNode.toLowerCase();
  const vmax = Math.max(0, ...graph.components.filter((c) => c.kind === 'dc_voltage').map((c) => Math.abs(c.value)));

  const accepted: ReadingProvenance[] = [];
  for (const { row, values, raw } of table.rows) {
    const reject = (reason: string) => rejected.push({ row, reason });
    const name = values.node ?? '';
    if (!name) {
      reject('missing node');
      continue;
    }
    if (name.toLowerCase() === gnd) {
      reject(`${graph.groundNode} is the reference (black probe), not a measurement target`);
      continue;
    }
    const node = nodes.get(name.toLowerCase());
    if (!node) {
      reject(`unknown node "${name}" (graph nodes: ${[...nodes.values()].filter((n) => n.toLowerCase() !== gnd).join(', ')})`);
      continue;
    }
    if (!values.value) {
      reject('missing value');
      continue;
    }
    if (!values.unit) {
      reject('missing unit (V or mV)');
      continue;
    }
    const parsed = parseVolts(values.value, values.unit);
    if ('error' in parsed) {
      reject(parsed.error);
      continue;
    }
    const ts = values.timestamp || undefined;
    if (ts && !(ISO.test(ts) && Number.isFinite(Date.parse(ts)))) {
      reject(`malformed timestamp "${ts}" (ISO-8601 expected)`);
      continue;
    }
    if (vmax > 0 && Math.abs(parsed.volts) > vmax * 1.1)
      warnings.push(`row ${row}: ${fmt(parsed.volts)} at ${node} exceeds 1.1 × max source (${fmt(vmax)}); check meter range`);
    accepted.push({
      row,
      node,
      volts: parsed.volts,
      timestamp: ts,
      instrument: values.instrument || undefined,
      channel: values.channel || undefined,
      note: values.note || undefined,
      raw,
    });
  }

  // Order: by timestamp when every accepted row has one (stable, ties keep file order); else file order.
  const timed = accepted.length > 0 && accepted.every((p) => p.timestamp);
  if (accepted.length > 0 && !timed && accepted.some((p) => p.timestamp))
    warnings.push('some rows lack timestamps; using file order');
  const ordered = timed ? [...accepted].sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!)) : accepted;

  // Group by node; keep first-seen order so the investigation replays readings as they were taken.
  const groups = new Map<string, ReadingProvenance[]>();
  for (const p of ordered) groups.set(p.node, [...(groups.get(p.node) ?? []), p]);

  const observations: (ImportedObservation & { at: number })[] = [];
  for (const [node, rs] of groups) {
    const lo = Math.min(...rs.map((r) => r.volts));
    const hi = Math.max(...rs.map((r) => r.volts));
    const pos = (p: ReadingProvenance) => ordered.indexOf(p);
    if (hi - lo <= tol(lo, hi)) {
      // Duplicates: collapse to the mean, merge provenance, position at the first reading.
      const volts = rs.reduce((s, r) => s + r.volts, 0) / rs.length;
      observations.push({ node, volts, rows: rs.map((r) => r.row), timestamp: rs[0].timestamp, at: pos(rs[0]) });
    } else if (policy === 'latest') {
      const last = rs[rs.length - 1];
      warnings.push(
        `${node}: contradictory readings (${fmt(lo)} … ${fmt(hi)}); policy 'latest' keeps row ${last.row} (${fmt(last.volts)})${timed ? '' : ' by file order, no timestamps'}`,
      );
      observations.push({ node, volts: last.volts, rows: [last.row], timestamp: last.timestamp, at: pos(last) });
    } else {
      for (const r of rs) rejected.push({ row: r.row, reason: `contradictory readings at ${node} (${fmt(lo)} … ${fmt(hi)})` });
    }
  }
  observations.sort((a, b) => a.at - b.at);
  for (const o of observations.splice(MAX_OBSERVATIONS))
    for (const row of o.rows) rejected.push({ row, reason: `over the ${MAX_OBSERVATIONS}-observation probe cap` });

  rejected.sort((a, b) => a.row - b.row);
  return {
    observations: observations.map(({ at: _at, ...o }) => o), // eslint-disable-line @typescript-eslint/no-unused-vars
    provenance: accepted,
    rejected,
    warnings,
  };
}
