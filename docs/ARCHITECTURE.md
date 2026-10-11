# CircuitScout | Architecture, Deployment and Runtime Routing

## Sprint decision (ADR-001)
**Single deployable TypeScript application:** Next.js 16 App Router + React + TypeScript + Tailwind CSS + Zod + SVG circuit rendering; Node.js server runtime with route handlers. UI and backend in the same repo. Deterministic DC solver written in TypeScript (Modified Nodal Analysis, optionally using `mathjs` for a tested linear solver). No Python service or database required for hackathon MVP.

**Deployment:** First attempt Anbaric Cloud using its generic Node app deploy CLI (`anbaric app configure`, `anbaric app deploy`), with Next.js server listening on injected `PORT`; run an early deployment spike and verify build/start/runtime requests. If Anbaric cannot run it reliably within 20 minutes, deploy the unchanged Next.js app on Vercel; document what was tested. Render is *not* part of MVP: a free Render backend spins down after 15 min idle, increasing demo latency, and a second service adds integration/CORS and deployment risk. A future Python/FastAPI+NumPy/SPICE backend can replace the `CircuitSolver` interface without changing UI/contracts. **Anbaric is an optional deployment and auditable workflow layer, not the mathematical solver or mandatory core runtime.**

## Dataflow
Image upload -> server validation (image type/size) -> Gemini 3.8 Flash visual analysis (structured candidate graph and warnings) -> deterministic schema/topology checks -> Jev System One `choice` routing (review / specialist vision / clarify) -> optional second vision provider (OpenAI model, only if ambiguous+configured) -> user review/edits -> canonical graph -> MNA DC solve -> observation comparison / hypotheses -> teaching notes -> trace UI.

## Roles
- **Gemini 3.8 Flash**: visual perception only; candidate components, labels, symbols, wires, grounded estimates/uncertainty. Input images; output structured JSON.
- **TypeSafe Jev**: adaptive decision over *structured textual state*, selects `review_extraction`, `verify_topology`, `ask_user`. API `POST https://api.typesafe.ai/v1/systemone`, `model: jev-latest`, `state` and named `questions`. Jev never reads raw pixels or performs calculations.
- **Optional OpenAI image-capable model**: independent targeted read of ambiguous region, invoked *only if Jev chooses verify* and API key exists. Must disclose missing provider and fall back to user review.
- **MNA solver**: ONLY authority for electrical math from reviewed netlist. Reject unsolvable circuits and unsupported elements.
- **Diagnosis engine**: determines which simple component variations would explain the observation by rerunning solver with hypothetical parameter values; AI narrative may explain the hypothesis but cannot overrule numeric evidence.
- **Optional Anbaric state-machine**: if quick to implement, record `uploaded -> extracted -> routed -> awaiting_review -> solved -> diagnosed`, actor attribution and human confirmation. Otherwise local ephemeral structured trace suffices.

## Circuit representations
`CircuitGraph` is the solver's source of truth: electrical nodes, components and terminals. `VisualLayout` is a separate projection. A standard breadboard has known internal hole connectivity; hole locations map to conductive groups using union-find while resistors stay edges *between* those groups. A schematic parser creates the same graph via symbol/wire tracing. Both can render through an SVG graph view; neither requires a fully functioning virtual breadboard editor.

## Security, performance, and economics
- Server-side provider credentials; `.env.local` never committed; `.env.example` contains placeholders only.
- Validate MIME type and size (initial cap 5MB); avoid storing images; never log secrets or raw unredacted user images.
- Timeouts on model calls (suggest 15-25s); no unbounded recursive agents; at most one specialist pass per run.
- Log model IDs, elapsed milliseconds, provider token usage when available, and rough cost estimates only when official price inputs known. Label estimates; do not fabricate usage.
- Disable unsupported modes; fail closed to manual confirmation if Jev or second model is unavailable.
- API boundaries are typed and versioned so a Python backend can be introduced after launch without changing user-visible behavior.

## Folder ownership
- Claude backend lead: `src/lib/circuit/**`, `src/lib/ai/**`, `src/app/api/**`, `tests/**`, root package/tests/CI (only coordinating agent edits shared files).
- ChatGPT Work UI lead: `src/app/page.tsx`, `src/app/lab/**`, `src/components/**`, `src/app/globals.css` (UI branch). Shared types are read-only to UI.
- Docs and CI: architecture/orchestrator branch exclusively; require PR.

## Source docs
- https://docs.typesafe.ai/introduction/quickstart
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://www.npmjs.com/package/anbaric
- https://nextjs.org/docs/app/getting-started/deploying
- https://render.com/docs/free
