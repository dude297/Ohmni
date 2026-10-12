import type { CircuitGraph } from "../../lib/circuit/types";

export const EVIDENCE_KEY = "ohmni.evidence.v1";

export type EvidencePacket = {
  schema: "ohmni.evidence.v1";
  createdAt: string;
  source: "build";
  circuit: { name: string; graph: CircuitGraph; provenance: string };
  predictions: { voltages: Record<string, number>; currents: Record<string, number> };
  observations: { node: string; volts: number; at: string }[];
  hypotheses: { id: string; title: string; probability: number }[];
  nextTest?: { node: string; instruction: string; expectedBits: number };
  repair?: {
    title: string;
    patch: unknown;
    before: Record<string, number>;
    after: Record<string, number>;
    status: "hypothesized" | "verified" | "not_verified";
    verification?: { node: string; expectVolts: number; toleranceVolts: number; measured?: number };
  };
  assumptions: string[];
  safety: string;
};

export type Reading = { node: string; volts: number; at: string };

/** Evidence-log row: residual = measured - predicted nominal (solver, as-designed circuit). */
export function logRows(readings: Reading[], nominal: Record<string, number>) {
  return readings.map((r) => {
    const predicted = nominal[r.node];
    return { ...r, predicted, residual: predicted === undefined ? NaN : r.volts - predicted };
  });
}

export function buildPacket(
  i: Omit<EvidencePacket, "schema" | "source" | "createdAt" | "assumptions"> & { createdAt?: string },
): EvidencePacket {
  return {
    schema: "ohmni.evidence.v1",
    source: "build",
    createdAt: i.createdAt ?? new Date().toISOString(),
    assumptions: [
      "User confirmed the circuit graph before any analysis.",
      "Single-fault model; meter tolerance 2% + 10 mV.",
      "Predictions come from the deterministic DC solver; hypotheses are not confirmed faults.",
      "Ohmni makes no physical change; the repair is performed by the user.",
    ],
    ...i,
  };
}
