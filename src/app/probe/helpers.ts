import { DIVIDER_10K_10K, LOADED_BRIDGE_12V, SERIES_PARALLEL_12V } from "../../lib/circuit/fixtures";
import type { CircuitGraph } from "../../lib/circuit/types";

export type Obs = { node: string; volts: number };

const r = (id: string, a: string, b: string) => ({ id, kind: "resistor" as const, value: 10000, positiveNode: a, negativeNode: b });
export const LADDER_5V: CircuitGraph = {
  schemaVersion: 1,
  components: [
    { id: "V1", kind: "dc_voltage", value: 5, positiveNode: "VIN", negativeNode: "GND" },
    r("R1", "VIN", "A"),
    r("R2", "A", "B"),
    r("R3", "B", "GND"),
  ],
  groundNode: "GND",
  measureNode: "B",
};

export const CIRCUITS: { key: string; label: string; blurb: string; graph: CircuitGraph }[] = [
  { key: "ladder", label: "Resistor ladder", blurb: "5 V, R1 to R2 to R3, all 10 kΩ; measure B", graph: LADDER_5V },
  { key: "divider", label: "Voltage divider", blurb: "5 V, 10 kΩ + 10 kΩ; measure VOUT", graph: DIVIDER_10K_10K },
  { key: "series-parallel", label: "Series-parallel", blurb: "12 V, 100 Ω then 200 Ω || 300 Ω", graph: SERIES_PARALLEL_12V },
  { key: "loaded-bridge", label: "Loaded bridge", blurb: "12 V, 7 resistors (R5 bridges A–B, R6–R7 load); measure C", graph: LOADED_BRIDGE_12V },
];

export function parseVolts(s: string): number | null {
  const t = s.trim().replace(/v$/i, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Newest reading for a node replaces an older one. */
export function addObservation(list: Obs[], o: Obs): Obs[] {
  return [...list.filter((x) => x.node !== o.node), o];
}

export const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
export const fmtPct = (p: number) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** Friendly message from a non-200 API response. */
export function apiErrorMessage(status: number, body: unknown, retryAfterHeader?: string | null): string {
  const e = (body as { error?: { code?: string; message?: string; details?: string[]; retryAfterSeconds?: number } } | null)?.error;
  if (status === 429 || e?.code === "RATE_LIMITED") {
    const secs = e?.retryAfterSeconds ?? (retryAfterHeader ? Number(retryAfterHeader) : NaN);
    return Number.isFinite(secs) && secs > 0
      ? `Too many requests. Please retry in ${Math.ceil(secs)} seconds.`
      : "Too many requests. Please wait a few seconds and retry.";
  }
  if (e?.message) return e.details?.length ? `${e.message}: ${e.details.join("; ")}` : e.message;
  return `Request failed (HTTP ${status}).`;
}

/** Schematic layout: nodes in a column (ground last), each component a labelled bracket on its own lane. */
export type SchemNode = { name: string; x: number; y: number };
export type SchemPart = { id: string; kind: string; a: SchemNode; b: SchemNode; laneX: number };
export function schematicLayout(graph: CircuitGraph): { nodes: SchemNode[]; parts: SchemPart[]; width: number; height: number } {
  const names: string[] = [];
  for (const c of graph.components) for (const n of [c.positiveNode, c.negativeNode]) if (!names.includes(n)) names.push(n);
  const ordered = [...names.filter((n) => n !== graph.groundNode), ...(names.includes(graph.groundNode) ? [graph.groundNode] : [])];
  const nodes = ordered.map((name, i) => ({ name, x: 70, y: 52 + i * 80 }));
  const at = (n: string) => nodes.find((x) => x.name === n)!;
  const spans: [number, number][] = [];
  const parts = graph.components.map((c) => {
    const a = at(c.positiveNode), b = at(c.negativeNode);
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    const lane = spans.filter(([l, h]) => l < hi && h > lo).length;
    spans.push([lo, hi]);
    return { id: c.id, kind: c.kind, a, b, laneX: 150 + lane * 56 };
  });
  const lanes = Math.max(0, ...parts.map((p) => (p.laneX - 150) / 56)) + 1;
  return { nodes, parts, width: Math.max(290, 150 + lanes * 56 + 40), height: 52 + Math.max(0, nodes.length - 1) * 80 + 36 };
}

/** "≈ 0 V → V1 dead or R1 open (50%)" */
export function outcomePhrase(volts: number, titles: string[], probability: number): string {
  const more = titles.length > 3 ? ` +${titles.length - 3} more` : "";
  return `≈ ${fmtV(volts)} → ${titles.slice(0, 3).join(" or ")}${more} (${fmtPct(probability)})`;
}

/** Plain-words reading of expectedBits. */
export function bitsPhrase(bits: number): string {
  if (bits >= 0.9) return "this reading splits the remaining suspects about in half, the best possible check";
  if (bits >= 0.4) return "this reading splits the remaining suspects best";
  return "this reading narrows the suspects a little, but it is the most useful one left";
}
