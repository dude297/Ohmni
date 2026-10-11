// Canonical contract — mirrors docs/API_CONTRACT.md v1. Changes need coordinated approval.
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
