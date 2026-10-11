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

## Planned endpoint contracts (not implemented by scaffolding)
- **POST /api/extract** multipart image JPEG/PNG/WebP <=5 MB -> { extraction: CandidateExtraction, route: RouteChoice, trace: ModelTraceEvent[] }. Every candidate requires user review. Typed 400/413/415/503 and manual fallback.
- **POST /api/solve** JSON { graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number } -> { result: SolveResponse }; 422 invalid or 409 missing confirmation.
- **GET /api/health** -> { status:"ok", build?:string }, checks server availability, NOT providers.

## Invariants
Unique component IDs, finite values, positive resistances, valid nodes/ground/measure node; preserve signed independent voltage-source orientation. Reject floating/singular/conflicting networks and unresolved candidate topology. Invalid Jev output or outage → explicit ask_user, trace actual error. Never treat visual recognition or a successful solver output as proof the photograph was perfectly parsed.

## Deterministic fixture
V1 5V VIN-GND; R1 10k VIN-VOUT; R2 10k VOUT-GND -> VOUT=2.5V. With R2=1k -> VOUT=5/11≈0.454545V. Recommended tolerance 1e-5V.

## Contract changes
Update this doc, shared src/lib/circuit/types.ts, Zod schema, fixtures and UI consumer as a coordinated reviewed change. No silent drift.
