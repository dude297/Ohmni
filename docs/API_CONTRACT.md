# Ohmni — Binding API / Canonical Circuit Contract v1

Shared frontend/backend v1 payloads. SI units throughout. Zod server validation required. New fields optional and coordinated; no silent contract drift.

~~~ts
export type CircuitComponent = {
  id: string;
  kind: "resistor" | "dc_voltage";
  value: number; // ohms (>0) for R; signed volts for source
  positiveNode: string;
  negativeNode: string;
  sourceBoundingBox?: [number,number,number,number]; // normalized 0..1
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
  confidence?: number; // only actual provider response
  usage?: { inputTokens?: number; outputTokens?: number };
  note?: string; // redacted
};
export type SolveResponse = {
  voltages: Record<string,number>; // volts, incl GND: 0
  currents: Record<string,number>; // amperes, documented sign
  hypotheses: Array<{title:string;rationale:string;nextMeasurement:string;status:"hypothesis"}>;
  trace: ModelTraceEvent[];
};
export type ApiError = {error:{code:string;message:string;reviewable?:boolean}};
~~~

## Routes
- **POST /api/extract** multipart field image, JPEG/PNG/WebP <=5MB -> { extraction: CandidateExtraction, route: RouteChoice, trace: ModelTraceEvent[] }. Invalid upload typed 400/413/415; quota/failure typed 503/manual fallback. Every candidate requires user review.
- **POST /api/solve** JSON { graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number } -> { result: SolveResponse }; typed 422 for invalid graph and 409 for missing confirmation. Boolean confirmation records a user action; it does not prove physical truth.
- **GET /api/health** -> { status:"ok", build?:string }, checks server, NOT providers.

## Invariants
Unique IDs; finite values; positive R; supported kinds; nonempty named terminals; valid measure node; source polarity preserved. Handle floating, singular or conflicting ideal voltage sources as typed failures, never silently zero volts. Unresolved candidate must be corrected before solving. Invalid/missing Jev route -> ask_user, with honest trace. Candidate extraction does not prove topology recognition.

## Deterministic fixture
V1 = 5V between VIN/GND; R1 = 10k between VIN/VOUT; R2 = 10k between VOUT/GND; VOUT = 2.5V. Set R2=1k -> VOUT=5/11 ≈ 0.454545V. Math tolerance 1e-5V.

A contract change requires API types+Zod+fixtures+UI coordination in a reviewed PR. See ROADMAP.md.
