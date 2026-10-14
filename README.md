# Ohmni

**Photo of a circuit in, testable diagnosis out. Several models, one deterministic solver, a human in the loop.**

Production: https://multimodal-hackathon-sage.vercel.app (no signup; deploys `main` automatically; `/api/health` shows the build) · Hackathon submission build: Anbaric https://ohmni.cloud.anbaric.ai (login-gated) and the frozen branch `release/frozen-2026-10-11-1600-pdt` · Demo flow: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## The problem

You build a simple low-voltage circuit, measure 0.45 V where the schematic says 2.50 V, and have no fast way to reconcile the drawing, the reading and the likely mistake. Ohmni reads the schematic image, lets you confirm the connections, computes the expected behavior exactly, and turns your measurement into ranked, testable hypotheses with a safe next measurement.

Willingness to pay and time saved are hypotheses, not validated claims (see [docs/PRD.md](docs/PRD.md)).

## How it works

1. **Upload** a PNG/JPEG/WebP schematic (up to 5 MB) at `/lab`, or load a built-in sample (divider, series-parallel, probe ladder).
2. **Groq** (`qwen/qwen3.8-27b`) reads the image and returns a *candidate* circuit graph as JSON. If it is rate-limited, over quota, unavailable, times out, errors, is unconfigured or returns malformed output, **Gemini** (`GEMINI_MODEL`) reads the image once instead. Order is configurable (`VISION_PRIMARY=groq|gemini`); Groq is first because on our 10 synthetic fixtures it was 10/10 exact with 0 API errors at 735 ms median, vs Gemini 3.5 Flash 7/7 with 3/10 503s at 4223 ms ([docs/VISION_FALLBACK.md](docs/VISION_FALLBACK.md)).
3. **Zod + structural validation** checks the candidate. Hard invalidity always forces correction.
4. **Jev** (`jev-1.13-free`) receives only the structured summary and picks a route: `review_extraction`, `verify_topology` or `ask_user`.
5. The app dispatches the route: show it for review, run the Groq topology verifier, or ask the user to clarify.
6. **You review and confirm** the graph (editable values and nodes). The server refuses to solve without `userConfirmed: true`.
7. A **local MNA solver** (pure TypeScript) computes node voltages and currents.
8. You enter a **measured voltage**; the diagnosis step tests bounded alternate resistor hypotheses against it and proposes a next measurement.
9. **Probe Guide** (in `/lab`, and standalone at `/probe`) re-solves every candidate single fault and tells you which node to measure next; a grounded **tutor** (`/probe`, Gemini) explains the circuit with solver-checked numbers.

```mermaid
flowchart LR
  IMG[Schematic image] --> GEM[Groq vision<br/>Gemini fallback]
  GEM --> ZOD[Zod validation]
  ZOD --> JEV{Jev route choice}
  JEV -->|review_extraction| REV[Human review]
  JEV -->|verify_topology| GRQ[Groq verify] --> REV
  JEV -->|ask_user| ASK[Ask user to clarify] --> REV
  REV --> CONF[User confirms graph]
  CONF --> MNA[Local MNA solver]
  MNA --> MEAS[Measured voltage]
  MEAS --> DX[Diagnosis hypotheses]
```

## Why multimodel

| Model | Role | Never does |
|---|---|---|
| Groq `qwen/qwen3.8-27b` | Primary reader and topology verifier (a Preview model on Groq's free plan) | Override hard validation |
| Jev `jev-1.13-free` (BeatAPI) | Chooses the route from structured state (one decision per analysis) | See pixels, solve equations |
| Gemini (`GEMINI_MODEL`) | Fallback reader when Groq fails; tutor explanations (numbers checked against the solver) | Decide trust, do the math |
| Local MNA solver | The only authority for voltages and currents | Trust an image |

Two models agreeing is not proof of electrical correctness, which is why a human confirmation gate sits before the solver. Development-time Claude Code / ChatGPT Work activity is not counted as runtime multimodel.

Measured on the Vercel host (2026-10-11 12:51 PDT, earlier build `d1096b7`, clean 10k/10k divider `public/samples/clear-divider.png`): Groq extraction ok in 839 ms (1208 in / 211 out tokens) with an exact graph; Jev ok in 711 ms, `review_extraction`, p=1.00. A minute later Groq returned 429 on `ambiguous-smudged.png`, Gemini `gemini-3.5-flash-lite` took over (1140 ms) and Jev chose `ask_user` (recorded: [docs/demo/README.md](docs/demo/README.md)). Earlier, Gemini-primary run: Gemini ok in 3790 ms, Jev 440 ms `review_extraction`; `/api/solve` gave VOUT 2.5 V, and a measured 0.45 V ranked "R2 may be 1 kΩ instead of 10 kΩ" first. Evidence ledger: [docs/MODEL_ACCESS.md](docs/MODEL_ACCESS.md).

## Since the hackathon (production phase 1)

Hardening after submission, details in [docs/PRODUCTION_PHASE1.md](docs/PRODUCTION_PHASE1.md) and [docs/HANDOFF_PHASE1.md](docs/HANDOFF_PHASE1.md):
- Repair verification is recomputed on the server and bound to the circuit revision; the diagnosis says when **no modeled fault fits** instead of forcing an answer.
- Workload ceilings (60 parts, streamed body caps, image sniffing, shared model budget), request ids and JSON logs, feature tiers (core / experimental / demo), security headers and a post-deploy smoke check.
- Optional AI consent gate (`REQUIRE_AI_CONSENT`) and a plain data-flow statement: [docs/PRIVACY.md](docs/PRIVACY.md).
- In review: saved investigations on Supabase with per-workspace row-level security ([docs/PERSISTENCE.md](docs/PERSISTENCE.md)), and an enforcing Content Security Policy.

## Trust and safety

- No fabricated traces: every model event shows the actual provider, model, status, latency and tokens returned. Failures and skips are shown as such.
- User confirmation is required before any solve.
- Output is **hypotheses, not verdicts**; the UI tells you to disconnect power before measuring resistance.
- Keys are server-only; uploads are bounded and not persisted by default; no mains or high-voltage guidance.
- Note provider free-tier data-use terms before uploading confidential designs.

## Free-plan operation and limits

All runtime model calls use free plans: Gemini free tier, Groq free plan, Jev `jev-1.13-free`. The paid Jev id is refused in code, and billing is never enabled. Jev's free tier allows 1 successful call per minute, so the app paces it (skips with an honest `skipped` trace if the slot is not near) and honors `Retry-After` on HTTP 429.

Unit economics: free-plan charges are $0 by construction, which is **not** a production marginal-cost claim. Cost per successful diagnosis, savings from routing and accuracy are not yet measured. See [docs/UNIT_ECONOMICS.md](docs/UNIT_ECONOMICS.md).

## Run locally

```bash
npm i
cp .env.example .env.local   # fill GEMINI_API_KEY, GEMINI_MODEL=gemini-3.5-flash-lite, BEATAPI_API_KEY, ...
npm run dev                  # http://localhost:3000
npm test                     # vitest
npm run lint
npm run smoke                # production smoke checks; add `-- --live` for one real extract call
```

Without keys, the sample and manual divider still solve locally; extraction reports an honest error and routes to `ask_user`.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/extract` | multipart `image` → `{ extraction, route, trace }` (400/413/429 typed errors; extraction failure returns `ask_user`) |
| `POST /api/solve` | `{ graph, userConfirmed: true, measuredVoltage? }` → `{ result: { voltages, currents, hypotheses, trace } }` (422 `NOT_CONFIRMED` / `INVALID_GRAPH` / `UNSOLVABLE`) |
| `POST /api/probe` | Probe Guide: `{ graph, userConfirmed: true, observations? }` → ranked single-fault hypotheses and the next node to probe, computed by the solver (no model calls). Used by the in-lab Probe Guide and the standalone `/probe` page ([docs/MOONSHOT.md](docs/MOONSHOT.md)) |
| `POST /api/explain` | Grounded tutor: `{ graph, userConfirmed: true, measuredVoltage? }` → step-by-step explanation (Gemini) whose numbers are checked against the solver (`grounded`, `ungroundedNumbers`); used on `/probe` ([docs/EXPLAIN.md](docs/EXPLAIN.md)) |
| `POST /api/topology` | Dual-candidate topology probe for one ambiguous junction: `{ graph, userConfirmed: true, ambiguous: { a, b } }` → both wirings plus the single best meter reading (solver-only, no model calls; refuses to suggest powering a shorting wiring). Anbaric host only right now ([docs/TOPOLOGY_CANDIDATES.md](docs/TOPOLOGY_CANDIDATES.md)) |
| `GET /api/health` | `{ status, build, providers: { gemini, groq, jev } }` (configured flag and model id per provider; never key values) |

Wire shapes: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Tech stack

Next.js 16 (App Router, Node route handlers), React 19, TypeScript, Tailwind 4, Zod 4, `@google/genai`, Vitest, hosted on Anbaric Cloud (primary) with a Vercel fallback. UI: guided lab (`/lab`), Probe Guide (`/probe`), Under the Hood (`/for-the-larp`). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limitations

- DC resistive circuits only: resistors and DC voltage sources.
- No breadboard photo recognition yet (clean schematics; breadboards need confirmed connections).
- Free-tier rate limits and provider availability apply: Groq (primary, about 3 extractions/min on its free plan) can return 429, in which case Gemini reads the image instead (seen live on 2026-10-11); Gemini itself returned 503s and quota 429s during testing; Jev allows 1 call/min. The public demo also enforces per-IP limits (extract 6/min and 40/h, solve 60/min, 413 above 6 MB).
- Probe Guide models single faults only (open, short, ×10, ÷10, dead source) and node-to-GND DC voltage probes; its probabilities are model-relative, not calibrated fault rates.
- `verify_topology` has not been reproduced on the Groq-primary pipeline (observed once in the Gemini-primary era, [docs/DEMO_CASES.md](docs/DEMO_CASES.md)).
- Groq `qwen/qwen3.8-27b` is a Preview model and may change or be withdrawn.
- Test fixtures and demo samples are synthetic clean renders; accuracy on real photos is not measured.
- Floating, singular or malformed networks are rejected, not guessed.

## Credits

Built for the BuilderBase SF Tech Week multimodel hackathon with Claude Code and ChatGPT Work as development tools (not runtime models). Providers: Google Gemini, Jev via BeatAPI, GroqCloud.
