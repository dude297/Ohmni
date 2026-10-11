import type { CircuitGraph } from "../../../lib/circuit/types";
import type { Obs } from "./machine";
import { fmtNum } from "./parser";

// Repair Studio client. Contract is served by another branch: POST /api/repair and /api/repair/verify.
// Everything shown or spoken is derived from these responses; nothing about the conclusion is hardcoded.

export type Verification = { instruction: string; node: string; expectVolts: number; toleranceVolts: number };
export type RepairProposal = {
  id: string;
  hypothesisId: string;
  title: string;
  faultClass?: string;
  target: { componentId: string };
  probability: number;
  patch: { kind: "restore_design"; componentId: string; faultedValue: number; designValue: number; unit: string };
  supportingObservations: { node: string; measured: number; predictedIfFault: number; predictedIfRepaired: number }[];
  before: { voltages: Record<string, number>; currents: Record<string, number> };
  after: { voltages: Record<string, number>; currents: Record<string, number> };
  resolves?: boolean;
  uncertainty?: string;
  verification: Verification;
  actions: string[];
  status: "hypothesized";
};
export type RepairResult = {
  proposals: RepairProposal[];
  basis: { topHypothesisId: string; topProbability: number; done: boolean };
  safety?: string;
  trace?: unknown;
};
export type VerifyResult = { verified: boolean; status: "verified" | "not_verified"; delta: number; message: string };

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class RepairUnavailable extends Error {
  constructor() {
    super("Repair engine not available on this build");
  }
}

async function post<T>(f: Fetch, url: string, payload: unknown): Promise<T> {
  const res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (res.status === 404) throw new RepairUnavailable();
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!res.ok || !body?.result) throw new Error(res.status === 429 ? "Too many requests. Wait a few seconds and retry." : body?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  return body.result;
}

/** Defensive: a malformed proposal is dropped rather than crashing the panel. */
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
export function validProposal(p: unknown): p is RepairProposal {
  const q = p as RepairProposal | undefined;
  return !!q && typeof q.title === "string" && typeof q.target?.componentId === "string" && num(q.probability) &&
    typeof q.before?.voltages === "object" && typeof q.after?.voltages === "object" &&
    typeof q.verification?.node === "string" && num(q.verification.expectVolts) && num(q.verification.toleranceVolts);
}

export async function fetchRepair(f: Fetch, graph: CircuitGraph, observations: Obs[]): Promise<RepairResult> {
  const r = await post<RepairResult>(f, "/api/repair", { graph, userConfirmed: true, observations });
  return {
    ...r,
    proposals: (Array.isArray(r.proposals) ? r.proposals : []).filter(validProposal).map((p) => ({ ...p, actions: Array.isArray(p.actions) ? p.actions : [] })),
    basis: r.basis ?? { topHypothesisId: "", topProbability: 0, done: false },
  };
}

export async function verifyRepair(f: Fetch, graph: CircuitGraph, p: RepairProposal, measured: { node: string; volts: number }): Promise<VerifyResult> {
  return post<VerifyResult>(f, "/api/repair/verify", {
    graph, userConfirmed: true, proposal: { hypothesisId: p.hypothesisId, verification: p.verification }, measured,
  });
}

/** Panel trigger: probe posterior top >= 0.5 or the probe is done. */
export const repairReady = (probe: { hypotheses: { probability: number }[]; done: boolean } | null) =>
  !!probe && (probe.done || (probe.hypotheses[0]?.probability ?? 0) >= 0.5);

export type Badge = "MEASURED" | "SIMULATED" | "HYPOTHESIZED" | "VERIFIED";
/** VERIFIED only ever comes from a verify response with verified === true. */
export const verifyBadge = (v: VerifyResult | null): Badge => (v?.verified === true && v.status === "verified" ? "VERIFIED" : "HYPOTHESIZED");

const V = (x: number) => `${fmtNum(+x.toPrecision(3))} V`;

export type NodeDiff = { node: string; measured: number | null; before: number; after: number };
/** Rows for the big before/after numbers: measured value where the user supplied one, else the simulated "before". */
export function nodeDiffs(p: RepairProposal, observations: Obs[]): NodeDiff[] {
  return Object.keys(p.after.voltages)
    .filter((n) => n !== "GND" && Number.isFinite(p.after.voltages[n]) && Number.isFinite(p.before.voltages[n]))
    .map((node) => ({ node, measured: observations.find((o) => o.node === node)?.volts ?? null, before: p.before.voltages[node], after: p.after.voltages[node] }));
}

export function proposalNarration(r: RepairResult): string {
  const p = r.proposals[0];
  if (!p) return "No repair is proposed for these readings within the tested fault set.";
  return `${p.title} is now the leading hypothesis within the tested fault set, at ${Math.round(p.probability * 100)} percent. This is not a confirmed fault. Simulated after a fix, ${p.verification.node} should read ${V(p.verification.expectVolts)}.`;
}
export function verifyNarration(v: VerifyResult): string {
  return v.message || (v.verified ? "Reading matches the repaired circuit." : "Reading does not match the repaired circuit.");
}
