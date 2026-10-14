# Ohmni — Binding API / Canonical Circuit Contract v1

**This exact v1 TypeScript wire shape mirrors the existing src/lib/circuit/types.ts scaffold.** The backend must implement Zod validation without changing this shape silently. Units are SI (ohms, volts, amperes). A later addition such as a hypothesis-status enum or extra top-level field requires a separate coordinated contract PR.

~~~ts
export type CircuitComponent = {
  id: string;
  kind: "resistor" | "dc_voltage";
  value: number; // ohms (>0) for resistor; finite signed volts for source
  positiveNode: string;
  negativeNode: string;
  sourceBoundingBox?: [number, number, number, number]; // normalized 0..1
};
export type CircuitGraph = {
  schemaVersion: 1;
  components: CircuitComponent[];
  groundNode: "GND";
  measureNode: string;
};
export type CandidateExtraction = {
  inputKind: "schematic" | "breadboard_template" | "unknown";
  graph: CircuitGraph | null;
  warnings: string[];
  unresolvedConnections: string[];
  requiresHumanReview: true;
};
export type RouteChoice = "review_extraction" | "verify_topology" | "ask_user";
export type ModelTraceEvent = {
  step: string;
  provider: string;
  model?: string;
  durationMs: number;
  status: "ok" | "error" | "skipped";
  chosenRoute?: RouteChoice;
  confidence?: number; // only if returned by provider
  usage?: { inputTokens?: number; outputTokens?: number };
  note?: string; // sanitized
};
export type SolveResponse = {
  voltages: Record<string, number>; // volts
  currents: Record<string, number>; // amps, sign convention in solver
  grounded: true;
  hypotheses?: { title: string; rationale: string; nextMeasurement: string }[];
  trace: ModelTraceEvent[];
};
~~~

## Endpoint contracts (implemented)
- **POST /api/extract** multipart `image` JPEG/PNG/WebP <=5 MB -> { extraction: CandidateExtraction, route: RouteChoice, trace: ModelTraceEvent[] }. Every candidate requires user review. Content is sniffed by magic bytes (declared `file.type` is not trusted). Typed errors: 400 (`INVALID_FORM`, `MISSING_IMAGE`), 413 `TOO_LARGE` (streamed byte count, not Content-Length), 415 `UNSUPPORTED_MEDIA`, 429 `RATE_LIMITED` / `MODEL_BUDGET` (per-IP guard in src/proxy.ts: 6/min, 40/h; bodies >6 MB get 413 there). If all providers fail the response is still 200 with `graph: null` and route `ask_user` (manual fallback).
- **POST /api/solve** JSON { graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number } -> { result: SolveResponse }; 400 `BAD_JSON`, 422 `NOT_CONFIRMED` (missing confirmation), `INVALID_GRAPH` or `UNSOLVABLE`; 429 above 60/min per IP.
- **POST /api/probe** JSON { graph, userConfirmed: true, observations?: { node, volts }[] } -> { result: { hypotheses, next, done, reason, fitWarning?, safety, trace } }; same error codes as /api/solve. Probe Guide, no model calls; spec in MOONSHOT.md.
- **GET /api/health** -> { status:"ok", build, providers: { gemini, groq, jev } } where each provider is { configured: boolean, model: string }. Reports env presence only, never key values, and does not call providers.

## Invariants
Unique component IDs, finite values, positive resistances, valid nodes/ground/measure node; preserve signed independent voltage-source orientation. Reject floating/singular/conflicting networks and unresolved candidate topology. Invalid Jev output or outage → explicit ask_user, trace actual error. Never treat visual recognition or a successful solver output as proof the photograph was perfectly parsed.

## Deterministic fixture
V1 5V VIN-GND; R1 10k VIN-VOUT; R2 10k VOUT-GND -> VOUT=2.5V. With R2=1k -> VOUT=5/11≈0.454545V. Recommended tolerance 1e-5V.

## Contract changes
Update this doc, shared src/lib/circuit/types.ts, Zod schema, fixtures and UI consumer as a coordinated reviewed change. No silent drift.

## /api/repair/verify (server-authoritative)
See docs/REPAIR_STUDIO.md. Request: `{ graph, userConfirmed, hypothesisId, measured, revisionId? }`; client expectVolts/toleranceVolts are ignored. Response adds `node, expectVolts, toleranceVolts, hypothesisId, revisionId, basis:"server_recomputed"`. Errors: 422 UNKNOWN_HYPOTHESIS / UNKNOWN_NODE, 409 REVISION_MISMATCH. `/api/repair` result now includes `revisionId`.

## Workload ceilings (P0)
- Every JSON route reads its body through a streaming byte cap (256 KB): 413 `TOO_LARGE` regardless of Content-Length/chunking; malformed JSON is 400 `BAD_JSON`.
- `CircuitGraph`: at most 60 components; component ids and node names 1-32 chars of `A-Za-z0-9_+-.()/:~`. Violations are 422 `INVALID_GRAPH` with messages (also applies to twin `observed` and imported netlists).
- 429 `MODEL_BUDGET` (with `Retry-After`) when the instance-wide budget for /api/extract, /api/explain, /api/review (30/min, `RATE_MODEL_GLOBAL_PER_MIN`) is spent.
- /api/ac: whole analysis (queue wait + all fault sims) has a 20 s deadline; exceeded -> 504 `TIMEOUT` with `partial: false` (no partial result). Queue overflow remains 429 `BUSY`.

## AI consent gate (P0)
With `REQUIRE_AI_CONSENT=1`, routes that send user content to an AI provider require consent: `/api/extract` multipart field `aiConsent=true`; `/api/explain` and `/api/review` (only when `mentor` is present) JSON `"aiConsent": true`. Otherwise 422 `CONSENT_REQUIRED` before any provider call. Unset: no gate. Data flows in docs/PRIVACY.md.
