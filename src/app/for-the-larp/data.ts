import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from "../../lib/circuit/fixtures";
import type { CircuitGraph } from "../../lib/circuit/types";

// Static, recorded evidence only. Every number below is copied from a doc in this repo (cited per item).
// Nothing on this page calls a model.

const r = (id: string, a: string, b: string) => ({ id, kind: "resistor" as const, value: 10000, positiveNode: a, negativeNode: b });
// Same ladder as /probe (src/app/probe/helpers.ts), duplicated to keep this route self-contained.
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

export const FIXTURES: { key: string; label: string; graph: CircuitGraph }[] = [
  { key: "divider", label: "Divider 5 V, 10k/10k", graph: DIVIDER_10K_10K },
  { key: "ladder", label: "Ladder 5 V, 3 x 10k", graph: LADDER_5V },
  { key: "sp", label: "Series-parallel 12 V", graph: SERIES_PARALLEL_12V },
];

export type PipeNode = {
  id: string;
  title: string;
  sub: string;
  kind: "model" | "code" | "human";
  inputs: string;
  outputs: string;
  files: string[];
  failure: string;
};

export const PIPELINE: PipeNode[] = [
  {
    id: "groq",
    title: "Groq vision",
    sub: "qwen/qwen3.8-27b",
    kind: "model",
    inputs: "The uploaded PNG/JPEG/WebP (max 5 MB, checked in /api/extract) plus an extraction instruction.",
    outputs: "Raw JSON: components, nodes, warnings, unresolved connections. Trace event with latency and token usage.",
    files: ["src/lib/ai/groq.ts", "src/lib/ai/vision.ts", "src/app/api/extract/route.ts"],
    failure:
      "Single attempt, 20 s timeout. rate_limited / quota_exhausted / model_unavailable / timeout / server_error / not_configured / malformed_output hand the image to the Gemini fallback once. Other errors (auth, bad request) are not masked: the user enters the circuit manually.",
  },
  {
    id: "fallback",
    title: "Gemini vision fallback",
    sub: "gemini-3.5-flash-lite",
    kind: "model",
    inputs: "Same image, only when Groq failed in a fallback-worthy way. Model from GEMINI_MODEL (production: gemini-3.5-flash-lite).",
    outputs: "Same raw JSON contract as Groq; trace row noted 'fallback from groq <reason>'.",
    files: ["src/lib/ai/gemini.ts", "src/lib/ai/vision.ts"],
    failure:
      "20 s timeout. If it also fails, the response is still HTTP 200 with graph: null, route ask_user and 'enter the circuit manually'; Jev is skipped (nothing to route).",
  },
  {
    id: "normalize",
    title: "Normalize + validate",
    sub: "zod, deterministic",
    kind: "code",
    inputs: "Raw model JSON.",
    outputs: "CandidateExtraction (requiresHumanReview: true) and a list of validation errors (missing GND, floating node, bad values).",
    files: ["src/lib/ai/extractionSchema.ts", "src/lib/circuit/validate.ts"],
    failure: "Never throws. Malformed output becomes graph: null plus a warning; topology errors are passed to Jev and shown to the user.",
  },
  {
    id: "jev",
    title: "Jev router",
    sub: "jev-1.13-free (BeatAPI)",
    kind: "model",
    inputs:
      "Structured TEXT state only (component list, measure node, warnings, unresolved connections, validation errors). Never pixels.",
    outputs:
      "One choice: review_extraction / verify_topology / ask_user, with probabilities. verify_topology triggers one Groq verifier read (src/lib/ai/secondary.ts) that passes the same normalizer.",
    files: ["src/lib/ai/jev.ts", "src/lib/ai/secondary.ts"],
    failure:
      "No key, a paid model id, free-tier pacing (1 call/min, waits at most 8 s), 429 (Retry-After honoured) or a 15 s timeout all default to ask_user with an honest 'skipped'/'error' trace row. Paid jev-1.13 is refused in code.",
  },
  {
    id: "human",
    title: "Human confirmation",
    sub: "the user, in /lab",
    kind: "human",
    inputs: "Candidate graph, warnings, Jev's route.",
    outputs: "A confirmed CircuitGraph; /api/solve requires userConfirmed: true.",
    files: ["src/components/ohmni/lab-workspace.tsx", "src/app/api/solve/route.ts"],
    failure: "Without confirmation /api/solve returns 422 NOT_CONFIRMED. The user can always edit or enter the graph by hand.",
  },
  {
    id: "mna",
    title: "MNA solver",
    sub: "local TS, no model",
    kind: "code",
    inputs: "Confirmed CircuitGraph (DC: resistors + ideal voltage sources).",
    outputs: "Node voltages and branch currents. ~1 ms, no model involved.",
    files: ["src/lib/circuit/solve.ts"],
    failure: "Singular systems (floating nodes, looped sources) and non-finite results throw SolveError and surface as 422 UNSOLVABLE. No fictional result.",
  },
  {
    id: "diag",
    title: "Diagnosis + Probe",
    sub: "solver re-runs, no model",
    kind: "code",
    inputs: "Confirmed graph plus measured voltage(s).",
    outputs: "Ranked single-fault hypotheses with a safe next measurement; Probe Guide picks the node with the highest expected information gain.",
    files: ["src/lib/diagnosis/index.ts", "src/lib/probe/index.ts", "src/app/api/probe/route.ts"],
    failure: "Candidates the solver rejects are dropped. If no single fault fits, a fit warning says so instead of guessing.",
  },
  {
    id: "tutor",
    title: "Grounded tutor",
    sub: "gemini-3.5-flash-lite",
    kind: "model",
    inputs: "Solver facts (voltages, currents, hypotheses) rounded to 4 significant figures.",
    outputs: "Step-by-step prose; every number is checked against solver output in code (checkGrounding) and flagged if it doesn't match.",
    files: ["src/lib/explain/index.ts", "src/app/api/explain/route.ts"],
    failure: "No key, model error, 15 s timeout or malformed JSON returns explanation: null and grounded: false. No canned text is ever returned.",
  },
];

export const EDGES: [string, string, "solid" | "dashed"][] = [
  ["groq", "normalize", "solid"],
  ["groq", "fallback", "dashed"],
  ["fallback", "normalize", "dashed"],
  ["normalize", "jev", "solid"],
  ["jev", "human", "solid"],
  ["human", "mna", "solid"],
  ["mna", "diag", "solid"],
  ["diag", "tutor", "solid"],
];

export type TraceRow = { step: string; provider: string; model: string; status: string; ms: string; tokens: string; note?: string };
export type RecordedTrace = {
  key: string;
  label: string;
  when: string;
  build: string;
  input: string;
  rows: TraceRow[];
  outcome: string;
  source: string;
  historical?: boolean;
  extra?: string;
};

export const TRACES: RecordedTrace[] = [
  {
    key: "clear",
    label: "Clear divider",
    when: "2026-10-11 12:51:28 PDT",
    build: "d1096b7",
    input: "public/samples/clear-divider.png",
    rows: [
      { step: "extract", provider: "groq", model: "qwen/qwen3.8-27b", status: "ok", ms: "839", tokens: "1208 / 211" },
      { step: "route", provider: "beatapi", model: "jev-1.13-free", status: "ok", ms: "711", tokens: "not recorded", note: "review_extraction, p=1.00" },
    ],
    outcome: "Exact graph (V1 5 V, R1 10k, R2 10k); user reviews and confirms.",
    source: "docs/demo/README.md (recorded backup run); README.md",
    extra:
      "Also observed ~12:30 PM PDT on build a9f6360: groq ok 795 ms, Jev review_extraction p=1.00 (docs/RELEASE_REPORT.md; tokens not recorded in that row).",
  },
  {
    key: "smudged",
    label: "Smudged R2",
    when: "2026-10-11 ~12:30 PM PDT",
    build: "a9f6360",
    input: "public/samples/ambiguous-smudged.png",
    rows: [
      { step: "extract", provider: "groq", model: "qwen/qwen3.8-27b", status: "ok", ms: "864", tokens: "not recorded", note: 'warning: "R2 partially obscured... appears to be 10k"' },
      { step: "route", provider: "beatapi", model: "jev-1.13-free", status: "ok", ms: "not recorded", tokens: "not recorded", note: "ask_user, p=1.00" },
    ],
    outcome: "A guessed value never reaches the solver: the user is asked to re-enter R2 (Jev criteria changed in c06a53b).",
    source: "docs/RELEASE_REPORT.md (coordinator evidence)",
  },
  {
    key: "fallback",
    label: "Provider fallback",
    when: "2026-10-11 12:52:34 PDT",
    build: "d1096b7",
    input: "public/samples/ambiguous-smudged.png",
    rows: [
      { step: "extract", provider: "groq", model: "qwen/qwen3.8-27b", status: "error", ms: "374", tokens: "-", note: "429 rate_limited -> fallback" },
      { step: "extract", provider: "google", model: "gemini-3.5-flash-lite", status: "ok", ms: "1140", tokens: "1310 / 229", note: "fallback from groq rate_limited" },
      { step: "route", provider: "beatapi", model: "jev-1.13-free", status: "ok", ms: "707", tokens: "not recorded", note: "ask_user, p=1.00" },
    ],
    outcome: 'UI shows "R2 value partially obscured, reads as 1?k"; no graph is solved.',
    source: "docs/demo/README.md",
    extra:
      "Earlier fallback in the opposite direction (Gemini-primary era, build 8fad171): gemini quota_exhausted (429) -> groq ok 710 ms -> Jev ok 718 ms review_extraction (docs/CURRENT_STATE.md, docs/MODEL_ACCESS.md).",
  },
  {
    key: "tutor",
    label: "Grounded tutor",
    when: "2026-10-11 ~12:45 PM PDT",
    build: "a9f6360",
    input: "POST /api/explain on a confirmed graph",
    rows: [{ step: "explain", provider: "google", model: "gemini-3.5-flash-lite", status: "ok", ms: "1885", tokens: "not recorded", note: "grounded: true" }],
    outcome: "Every number in the explanation matched solver output.",
    source: "docs/RELEASE_REPORT.md (coordinator evidence)",
    extra:
      'Recorded take at 13:01 PDT on build bdf035f: the check flagged one number ("Some numbers could not be verified: 0.17 mA") and the UI showed the amber warning (docs/demo/README.md). PR #42/#43 then changed grounding to accept honest rounding.',
  },
  {
    key: "verify",
    label: "verify_topology (historical)",
    when: "2026-10-11 11:48:50 PDT",
    build: "not recorded (Gemini-primary era)",
    input: "public/samples/ambiguous-junction.png",
    historical: true,
    rows: [
      { step: "extract", provider: "google", model: "gemini-3.5-flash", status: "ok", ms: "6160", tokens: "1310 / 135", note: "2 unresolved connections" },
      { step: "route", provider: "beatapi", model: "jev-1.13-free", status: "ok", ms: "767", tokens: "not recorded", note: "verify_topology, p=1.00" },
      { step: "verify_topology", provider: "openai (since removed)", model: "-", status: "skipped", ms: "-", tokens: "-", note: "key not configured" },
    ],
    outcome: "Jev chose verify_topology live, but no verifier executed in that deployment.",
    source: "docs/DEMO_CASES.md",
    extra:
      "NOT reproduced on the current Groq-primary pipeline: 6 live attempts at 12:23-12:29 PDT never produced warnings + graph, so Jev never chose verify_topology and the Groq verifier step is unobserved.",
  },
];
