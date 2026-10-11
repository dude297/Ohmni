# CircuitScout | API and Canonical Data Contract v1
Both UI and backend must build against this contract. A generated typed file should be merged in the first PR; changes after that require coordinated approval.

```ts
export type CircuitComponent = {
  id: string;
  kind: 'resistor' | 'dc_voltage';
  value: number; // SI units: ohm or volt
  positiveNode: string; // resistor terminals are symmetric; voltage source terminals are directional
  negativeNode: string;
  sourceBoundingBox?: [number, number, number, number]; // optional normalized image box
};
export type CircuitGraph = {
  schemaVersion: 1;
  components: CircuitComponent[];
  groundNode: 'GND';
  measureNode: string;
};
export type CandidateExtraction = {
  inputKind: 'schematic' | 'breadboard_template' | 'unknown';
  graph: CircuitGraph | null;
  warnings: string[];
  unresolvedConnections: string[];
  requiresHumanReview: true;
};
export type RouteChoice = 'review_extraction' | 'verify_topology' | 'ask_user';
export type ModelTraceEvent = {
  step: string;
  provider: string;
  model?: string;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  chosenRoute?: RouteChoice;
  confidence?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  note?: string;
};
export type SolveResponse = {
  voltages: Record<string, number>;
  currents: Record<string, number>;
  grounded: true;
  hypotheses?: { title: string; rationale: string; nextMeasurement: string }[];
  trace: ModelTraceEvent[];
};
```

## Endpoints (JSON)
- `POST /api/extract` multipart image -> `{ extraction: CandidateExtraction, route: RouteChoice, trace: ModelTraceEvent[] }`. Cannot claim final correctness.
- `POST /api/solve` `{ graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number }` -> `{ result: SolveResponse }` or typed `422` error. Require user confirmation server-side; do not accept unresolved, unsupported graph.
- `GET /api/health` -> `{ status: 'ok', build?: string }`.

## Test fixture
```json
{"schemaVersion":1,"components":[{"id":"V1","kind":"dc_voltage","value":5,"positiveNode":"VIN","negativeNode":"GND"},{"id":"R1","kind":"resistor","value":10000,"positiveNode":"VIN","negativeNode":"VOUT"},{"id":"R2","kind":"resistor","value":10000,"positiveNode":"VOUT","negativeNode":"GND"}],"groundNode":"GND","measureNode":"VOUT"}
```
Expected VOUT = 2.5V. With R2 = 1000, VOUT ~ 0.454545V.

## Jev decision contract
Use documented `questions: { route: { type: 'choice', instructions, criteria: { review_extraction, verify_topology, ask_user } } }` over candidate summary, validation output, and image-type classification. Parse `answers.route.choice`, `confidence`, `probabilities` only after schema checking. When missing/invalid, route to `ask_user`. Do not attach arbitrary assumed confidence scores to vision output.
