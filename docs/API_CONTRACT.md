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
- **GET /api/health** -> { status:"ok", build, providers: { gemini, groq, jev } } where each provider is { configured: boolean, model: string }, plus `persistence: { configured, browserAuth }` (server Supabase vars / NEXT_PUBLIC sign-in vars present). Reports env presence only, never key values, and does not call providers.

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

## Observability (P0)
- Every `/api/*` route handler is wrapped by `observe()` (src/lib/server/observe.ts). Every response it returns carries `x-request-id`: the incoming `x-request-id` if it matches `[A-Za-z0-9_-]{1,64}`, otherwise a fresh UUID.
- Error bodies keep `{ error: { code, message, details? } }` and add `error.requestId`; quote it when reporting a problem.
- An unhandled throw becomes 500 `{ error: { code: "INTERNAL", message: "Internal server error", requestId } }`; no stack or exception message is returned.
- One JSON log line per request: `ts, requestId, route, method, status, ms`, plus `code` (error code) and `error` (exception class name only) when present. Bodies, images, graphs, tokens, keys, IPs and provider responses are never logged.
- Responses produced by `src/proxy.ts` before the handler runs (rate-limit 429, oversized 413) do not yet carry `x-request-id`.
## Feature tiers
Responses on tiered routes carry `x-ohmni-tier: core|experimental|demo`. A tier disabled via `OHMNI_DISABLED_TIERS` returns 404 `{ error: { code: "FEATURE_DISABLED" } }` on API routes. See SECURITY.md.
## AI consent gate (P0)
With `REQUIRE_AI_CONSENT=1`, routes that send user content to an AI provider require consent: `/api/extract` multipart field `aiConsent=true`; `/api/explain` and `/api/review` (only when `mentor` is present) JSON `"aiConsent": true`. Otherwise 422 `CONSENT_REQUIRED` before any provider call. Unset: no gate. Data flows in docs/PRIVACY.md.

## Saved investigations: /api/v1/* (experimental)
Supabase-backed persistence; design and invariants in docs/PERSISTENCE.md. Every request needs `Authorization: Bearer <Supabase access token>`; unset Supabase env -> 503 `PERSISTENCE_DISABLED`; bad/missing token -> 401 `UNAUTHENTICATED`; RLS denial -> 403 `FORBIDDEN`; invisible or foreign ids -> 404 `NOT_FOUND`. Errors use the shared envelope with `requestId`. POSTs share one rate rule (`RATE_PERSIST_PER_MIN`, default 120/min/IP).
- `GET|POST /api/v1/workspaces` `{ name }` -> `{ workspaces: [{ role, workspace }] }` / `{ workspace }` (creator becomes owner).
- `GET /api/v1/workspaces/:id/members` -> `{ members: [{ user_id, role, email, created_at }] }` (members only). `POST` `{ email, role: owner|editor|viewer }` (owners only; adds an existing account or changes its role; 404 `USER_NOT_FOUND`, no email is sent). `DELETE /api/v1/workspaces/:id/members/:userId` (owners remove anyone; members remove themselves). 409 `LAST_OWNER` when a change would leave no owner.
- `GET /api/v1/workspaces/:id/usage?days=1..90` (members): model calls, errors, input/output tokens and latency per provider/model from `model_traces` (newest 1000 calls; `truncated` flag). Metering: `/api/extract` (form field `projectId`) and `/api/explain` (JSON `projectId`) record trace **metadata** when the request also carries a Supabase Bearer token for a member of that project; otherwise nothing is stored and the response is unchanged.
- `GET /api/v1/workspaces/:id/export` (owners/editors; viewers 403): `ohmni.workspace-export.v1` JSON attachment with every row of every table for that workspace, including `workspace_members` (paged; 413 `EXPORT_TOO_LARGE` past 50k rows/table). `POST /api/v1/workspaces/:id/delete` `{ confirm: "<exact workspace name>" }` (owners): permanent cascade delete; 422 `CONFIRMATION_MISMATCH`.
- `POST /api/v1/projects/:id/artifacts` (editors; multipart `image` png/jpeg/webp ≤ 6 MB, sniffed; optional `aiConsent=true`) -> `{ artifact: { id, sha256, bytes, mime, ai_processing_consent, ... } }`. `GET /api/v1/artifacts/:id` (members) -> `{ artifact, url, expiresIn: 60 }` signed download. Link a revision to its image with `sourceArtifactId` on `POST /projects/:id/revisions`.
- `GET /api/v1/projects?workspaceId=` / `POST /api/v1/projects` `{ workspaceId, name, description? }`.
- `GET|POST /api/v1/projects/:id/revisions` `{ graph, source: image_extraction|netlist_import|manual|fixture, parentId? }` -> `{ revision, existing }`. POST **is** the human confirmation (`confirmed_by` = caller); same circuit returns the existing revision.
- `POST /api/v1/investigations` `{ revisionId, title }`; `GET /api/v1/investigations/:id` -> `{ investigation, revision{id, revisionHash, graph}, measurements, latestHypotheses, probe, proposals, verifications }` (`probe` is recomputed from stored evidence on every read); `POST /api/v1/investigations/:id/close` `{ status: resolved|abandoned }`.
- `GET /api/v1/investigations/:id/report?format=md|json`: report built from stored evidence only (no model calls). Default `text/markdown` attachment; `json` returns `ohmni.report.v1` (circuit, design voltages, measurements with role evidence|superseded|verification, recomputed diagnosis, repairs with checks, safety, disclaimer). User text is neutralised in the markdown.
- `POST /api/v1/investigations/:id/measurements` `{ node, volts, method: typed|voice|csv|instrument, instrument?, supersedes?, provenance? }` -> `{ measurement, probe }`; 422 `UNKNOWN_NODE`, 409 `INVESTIGATION_CLOSED`.
- `POST /api/v1/investigations/:id/repair` -> repair result + `stored: [{ id, hypothesis_id, verification_node, expect_value, tolerance, status }]`; no proposals when the fit is poor.
- `POST /api/v1/proposals/:id/verify` `{ volts, method, instrument? }` -> `{ verification, result, measurementId }`; the reading is stored as evidence (excluded from diagnosis) and judged against the server's expectation for the stored revision.

## Shared rate limits (model routes)
When Supabase is configured, `/api/extract`, `/api/explain` and `/api/review` POSTs are also counted in Postgres (`public.rate_hit`, service role only), so the per-IP limits and the per-route model budget hold across serverless instances. Same 429 `RATE_LIMITED` / `MODEL_BUDGET` responses with `Retry-After`. Keys are salted SHA-256 hashes of the client IP; counters expire within a day. Fails open to the in-memory limiter if the database is unavailable or slower than 1.5 s. `RATE_SHARED=off` disables it.
