// Read-only aliases of the backend-owned canonical contract.
import type {
  CircuitComponent as Component,
  CircuitGraph as Graph,
  RouteChoice as Route,
  ModelTraceEvent as Trace,
  CandidateExtraction as Extraction,
  SolveResponse as Result,
} from "../../lib/circuit/types";
export type { Component, Graph, Route, Trace, Extraction, Result };
import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from "../../lib/circuit/fixtures";
export type SampleKind = "divider" | "network" | "ladder";
export const sampleGraph = (kind: SampleKind = "divider"): Graph => {
  if (kind === "ladder") return {
    schemaVersion: 1, groundNode: "GND", measureNode: "B",
    components: [
      { id: "V1", kind: "dc_voltage", value: 5, positiveNode: "VIN", negativeNode: "GND" },
      { id: "R1", kind: "resistor", value: 10000, positiveNode: "VIN", negativeNode: "A" },
      { id: "R2", kind: "resistor", value: 10000, positiveNode: "A", negativeNode: "B" },
      { id: "R3", kind: "resistor", value: 10000, positiveNode: "B", negativeNode: "GND" },
    ],
  };
  const fixture = kind === "network" ? SERIES_PARALLEL_12V : DIVIDER_10K_10K;
  return { ...fixture, components: fixture.components.map((c) => ({ ...c })) };
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
export function isGraph(v: unknown): v is Graph {
  if (
    !record(v) ||
    v.schemaVersion !== 1 ||
    v.groundNode !== "GND" ||
    typeof v.measureNode !== "string" ||
    !Array.isArray(v.components) ||
    !v.components.length ||
    v.components.length > 30
  )
    return false;
  const ids = new Set<string>();
  return v.components.every((c) => {
    if (
      !record(c) ||
      typeof c.id !== "string" ||
      !c.id ||
      ids.has(c.id) ||
      !["resistor", "dc_voltage"].includes(String(c.kind)) ||
      !finite(c.value) ||
      (c.kind === "resistor" && c.value <= 0) ||
      typeof c.positiveNode !== "string" ||
      !c.positiveNode ||
      typeof c.negativeNode !== "string" ||
      !c.negativeNode ||
      c.positiveNode === c.negativeNode
    )
      return false;
    ids.add(c.id);
    return true;
  });
}
export function isTrace(v: unknown): v is Trace[] {
  return (
    Array.isArray(v) &&
    v.every(
      (t) =>
        record(t) &&
        typeof t.step === "string" &&
        typeof t.provider === "string" &&
        finite(t.durationMs) &&
        t.durationMs >= 0 &&
        ["ok", "error", "skipped"].includes(String(t.status)) &&
        (t.model === undefined || typeof t.model === "string") &&
        (t.chosenRoute === undefined ||
          ["review_extraction", "verify_topology", "ask_user"].includes(
            String(t.chosenRoute),
          )) &&
        (t.confidence === undefined ||
          (finite(t.confidence) && t.confidence >= 0 && t.confidence <= 1)) &&
        (t.note === undefined || typeof t.note === "string") &&
        validUsage(t.usage),
    )
  );
}
function validUsage(v: unknown) {
  return (
    v === undefined ||
    (record(v) &&
      ["inputTokens", "outputTokens"].every(
        (k) => v[k] === undefined || (finite(v[k]) && v[k] >= 0),
      ))
  );
}
export function parseExtraction(v: unknown): {
  extraction: Extraction;
  route: Route;
  trace: Trace[];
} {
  if (
    !record(v) ||
    !record(v.extraction) ||
    !["review_extraction", "verify_topology", "ask_user"].includes(
      String(v.route),
    ) ||
    !isTrace(v.trace)
  )
    throw new Error(
      "Extraction response does not match the documented API contract. Review manually.",
    );
  const e = v.extraction;
  if (
    !["schematic", "breadboard_template", "unknown"].includes(
      String(e.inputKind),
    ) ||
    (e.graph !== null && !isGraph(e.graph)) ||
    !strings(e.warnings) ||
    !strings(e.unresolvedConnections) ||
    e.requiresHumanReview !== true
  )
    throw new Error(
      "This circuit is unsupported or its extraction is invalid. Use the manual divider below.",
    );
  return v as unknown as {
    extraction: Extraction;
    route: Route;
    trace: Trace[];
  };
}
export function parseResult(v: unknown): Result {
  if (!record(v) || !record(v.result))
    throw new Error("Solver returned an invalid response.");
  const r = v.result;
  if (
    r.grounded !== true ||
    !record(r.voltages) ||
    !Object.values(r.voltages).every(finite) ||
    !record(r.currents) ||
    !Object.values(r.currents).every(finite) ||
    !isTrace(r.trace) ||
    (r.hypotheses !== undefined &&
      (!Array.isArray(r.hypotheses) ||
        !r.hypotheses.every(
          (h) =>
            record(h) &&
            ["title", "rationale", "nextMeasurement"].every(
              (k) => typeof h[k] === "string",
            ),
        )))
  )
    throw new Error("Solver returned invalid electrical results.");
  return r as Result;
}
export async function request(
  path: string,
  body: FormData | object,
): Promise<unknown> {
  const controller = new AbortController();
  // Extraction can include primary vision, a fallback and one routing/verification pass.
  const timeoutMs = path === "/api/extract" ? 75000 : 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
      headers:
        body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retry = Number(response.headers.get("Retry-After"));
        throw new Error(`Request limit reached.${Number.isFinite(retry) && retry > 0 ? ` Try again in ${Math.ceil(retry)} seconds.` : " Please wait before trying again."} Your circuit is preserved; manual review is still available.`);
      }
      if (response.status === 413)
        throw new Error("The image is too large. Choose a PNG, JPEG or WebP up to 5 MB.");
      if (response.status === 404 || response.status === 503)
        throw new Error(
          "The backend is unavailable. Try the labeled sample or build a manual divider.",
        );
      if (response.status === 422)
        throw new Error(
          "The solver rejected this circuit. Check its connections, values and ground before confirming again.",
        );
      throw new Error(
        `Analysis could not complete (HTTP ${response.status}). Review manually or try again.`,
      );
    }
    return await response.json();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw new Error(
        `Analysis timed out after ${timeoutMs / 1000} seconds. Your circuit is preserved; try again or review manually.`,
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
export function isDivider(g: Graph) {
  const expected = sampleGraph();
  return (
    g.components.length === 3 &&
    g.measureNode === "VOUT" &&
    expected.components.every((e) =>
      g.components.some(
        (c) =>
          c.id === e.id &&
          c.kind === e.kind &&
          c.positiveNode === e.positiveNode &&
          c.negativeNode === e.negativeNode,
      ),
    )
  );
}
// Restricted, transparent sample math. Arbitrary circuits always go to the server's MNA solver.
export function solveSample(g: Graph, measured?: number): Result {
  if (!isGraph(g) || !isDivider(g))
    throw new Error(
      "Local sample calculation supports only the displayed divider.",
    );
  const value = (id: string) => g.components.find((c) => c.id === id)!.value;
  const vin = value("V1"),
    r1 = value("R1"),
    r2 = value("R2");
  if (!Number.isFinite(r1 + r2))
    throw new Error(
      "Resistor values are too large for the local sample calculation.",
    );
  const current = vin / (r1 + r2),
    vout = current * r2;
  if (!Number.isFinite(current) || !Number.isFinite(vout))
    throw new Error("Values exceed the local sample calculation range.");
  const hypotheses: NonNullable<Result["hypotheses"]> = [];
  if (
    measured !== undefined &&
    vin > 0 &&
    measured > 0 &&
    measured < vin &&
    Math.abs(measured - vout) > Math.max(0.05, Math.abs(vout) * 0.05)
  ) {
    const inferred = (r1 * measured) / (vin - measured);
    const candidates = [
      100, 220, 470, 1000, 2200, 4700, 10000, 22000, 47000, 100000,
    ];
    const nearest = candidates.reduce(
      (best, r) =>
        Math.abs((vin * r) / (r1 + r) - measured) <
        Math.abs((vin * best) / (r1 + best) - measured)
          ? r
          : best,
      candidates[0],
    );
    const candidate =
      Math.abs((vin * nearest) / (r1 + nearest) - measured) <=
      Math.max(0.05, Math.abs(measured) * 0.05)
        ? nearest
        : inferred;
    hypotheses.push({
      title: `Check R2: a ${formatValue(candidate, "resistor")} value is plausible`,
      rationale: `That value predicts ${((vin * candidate) / (r1 + candidate)).toFixed(3)} V. The observation implies about ${formatValue(inferred, "resistor")} if VIN and R1 are correct. Loading, a wiring error or a changed supply can also explain the mismatch.`,
      nextMeasurement:
        "Disconnect power. Measure R2 out of circuit (or lift one lead) to avoid parallel paths. Verify the component value before changing it.",
    });
  }
  return {
    voltages: { VIN: vin, VOUT: vout, GND: 0 },
    currents: { V1: -current, R1: current, R2: current },
    grounded: true,
    hypotheses,
    trace: [],
  };
}
export function formatValue(value: number, kind: Component["kind"]) {
  if (kind === "dc_voltage") return `${Number(value.toFixed(3))} V`;
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(2))} MΩ`;
  return value >= 1000
    ? `${Number((value / 1000).toFixed(2))} kΩ`
    : `${Number(value.toFixed(1))} Ω`;
}
