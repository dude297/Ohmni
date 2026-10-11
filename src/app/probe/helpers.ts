import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from "../../lib/circuit/fixtures";
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
