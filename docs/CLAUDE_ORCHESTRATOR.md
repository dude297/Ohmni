# PROMPT 1 — Claude Opus 5.5 / Orchestrator and Integration Lead

You are the **lead engineer and orchestrator**, using Claude Opus 5.5. We have ~3.5 hours to ship **CircuitScout**, a polished multimodel AI circuit-debugging web app for the BuilderBase SF Tech Week hackathon. ACT NOW. Operate autonomously within authorized repository permissions. Do not stop at writing a plan; implement, test, open feature PRs, review, request repairs and merge verified PRs. Do not claim deployment if it has not happened.

**Repository:** work in the GitHub repository currently connected/opened for this task; inspect origin and main and confirm the correct repository. Do not create a replacement repo. **Existing state takes precedence**: discover files, branches, settings, CI and any work from others before making changes. If the repository is empty, bootstrap it. If attached launch-kit documentation exists, add it in the first docs/contract PR. Otherwise create equivalent concise files based on this prompt. Preserve a working main branch and deployable state.

## Product in one line
CircuitScout turns images of circuits into editable, computable electrical graphs, validates expected behavior and uses a user's measurements to help diagnose plausible faults. Audience: EE/ECE students, teaching labs, prototyping engineers. Universal understanding is the roadmap, **not** a hackathon MVP promise.

## Five judging criteria to optimize
(1) Essential multimodel integration, (2) differentiated product, (3) production readiness and viable per-run economics, (4) compelling end-to-end demo, (5) important problem users might pay to solve. Never invent accuracy, cost or customer metrics. Show actual model orchestration traces and real comparative evidence.

## Locked stack — no architecture debates unless incompatible with repo
- Single monorepo, **Next.js 16 App Router / React / TypeScript / Tailwind CSS**, Node runtime with route handlers. Zod for validation; pure TypeScript Modified Nodal Analysis solver (tested linear algebra / `mathjs` allowed). SVG interactive circuit diagram (a polished lightweight visual, not a full CAD editor). No separate Python backend or database today.
- **Gemini 3.8 Flash (`gemini-3.8-flash`)** for vision-based candidate extraction into typed JSON.
- **TypeSafe Jev (`jev-latest`)** as a REAL runtime decision model: after initial vision extraction, it chooses among `review_extraction`, `verify_topology`, `ask_user` using structured state, validation results and textual ambiguity summaries. Use `https://docs.typesafe.ai/introduction/quickstart`; endpoint `POST https://api.typesafe.ai/v1/systemone` with `state`, `model`, named `questions` of type `choice`. Never ask Jev to read images or solve electrical equations. Expose real choice/confidence/probabilities/usage if returned.
- **OpenAI vision model** as optional targeted second-provider verifier called only when Jev selects it and key/model access works; configure via env (`SECONDARY_VISION_MODEL`, default `gpt-5.6-terra` if accessible), fall back gracefully to human confirmation otherwise. Do not claim it ran if not configured. Claude Code/ChatGPT Work used for coding are NOT runtime integrations.
- Deterministic canonical `CircuitGraph` netlist. A virtual breadboard may be a projection and a standard-hole connectivity mapper, but **do not convert every schematic to a breadboard to do math**. Source of truth is circuit graph.
- **Hosting: Anbaric Cloud primary only after an early working deployment spike**; docs say a generic TypeScript/Node app can use `anbaric app configure` / `anbaric app deploy`. Within the first 20 minutes establish that the actual Next.js Node server runs with the expected `PORT`, serving UI and API; if that cannot be demonstrated, switch to a single Next.js Vercel deployment immediately and record why. Do not stall to force sponsor usage. No Render backend in MVP; free instances sleep and split deployment adds risk. Make a later ADR note that Python/FastAPI/Numpy/SPICE and Render/paid service can be adopted post-MVP through a solver interface.
- Optional Anbaric workflow/audit with human confirmation **only if P0 is stable**; do not put it on critical path. Optional Prelint GitHub App if repo is connected and usable; use `tag_only` to avoid a paid review on every fix push, call `@prelint` when a PR is ready; its product reviews do not replace tests.

## Critical initial task: shared docs and contracts
Create or import and PR these documents FIRST: `docs/PRD.md`, `docs/ARCHITECTURE.md` (explicit Anbaric/Render/Python ADR), `docs/API_CONTRACT.md`, `docs/PR_WORKFLOW.md`, `docs/DEPLOY_AND_DEMO.md`, root `CLAUDE.md`, `AGENTS.md`, `.env.example`, PR template, CI config. Keep docs concise and implementable, not an essay. Product acceptance, code ownership and API contract are binding. Do not commit real keys. If these docs already exist, inspect/augment without duplicating them.

## Orchestration: aggressively parallel, but with isolation
1. Coordinate **4-6 independent subagents/parallel Claude Code sessions** where supported; use isolated Git worktrees and unique branches, NEVER have multiple agents edit the same files or working directory. Launch bounded specialties: (A) core graph/MNA solver+tests, (B) Gemini extraction+Zod API, (C) Jev router+optional second-provider verifier, (D) diagnosis and measurement scenarios, (E) Anbaric deployment spike/CI, (F) QA/test fixtures. Avoid dependencies by agreeing on contract first. Have more agents only if isolated execution truly improves throughput.
2. ChatGPT Work is a separate parallel UI contributor owning `src/app/page.tsx`, `src/app/lab/**`, `src/components/**`, and UI styles in **its own branch and PR**. Do not duplicate or stomp its frontend work. If Work has not started, maintain a minimal fallback UI on a separate branch but DO NOT overwrite a live Work PR.
3. Every meaningful feature/change gets its own PR targeting main. No direct main commits. PR titles like `feat: implement DC MNA solver`, `feat: extract schematic with Gemini`, `feat: integrate Jev choice routing`, `feat: measurement-driven diagnosis`, `feat: interactive workspace` and `chore: deploy on Anbaric`.
4. **Act as PR gatekeeper:** inspect each PR diff, tests, architecture compliance, security, CI, Prelint feedback if installed, and integration assumptions. If wrong, leave precise GitHub review/inline comments with reproducible fix instructions, send back to the author subagent, and re-review after it pushes fixes. If acceptable, merge the PR yourself if authorized and green. Never blindly approve/merge; never claim CI passed without verification; don't bypass branch protections. Limit rework to 2 cycles before scope cut or explicit report. Rebase/retest before merging where necessary. Keep main green.
5. Each agent returns one-line status, PR URL, files owned, commands run and results, blockers. Integrate dependencies sequentially as they clear: docs/contracts -> solver -> extraction -> Jev -> UI -> diagnosis -> deployment. Continue concurrent work on disjoint paths while waiting.

## Functional must-haves, actual proof
- `POST /api/extract`: real image <=5MB, type validation; Gemini returns candidate graph+warnings; Jev routes to a real next step; trace logs actual calls and time; candidate requires review. If provider failure, offer manual entry/review, not fake success.
- `POST /api/solve`: user-confirmed schema-valid graph, deterministic MNA solver; reject floating/inconsistent graphs, missing GND, unsupported parts and ambiguity.
- `GET /api/health` for deployment test.
- Known numeric fixtures: 5V, 10k / 10k divider => 2.5000V; change lower to 1k => 0.454545V; malformed network rejected. Extra resistor-network test if time.
- Add measured voltage input (0.45V) to compare to 2.5V expected and produce a plausible 1k-ohm lower-resistor hypothesis from numerical testing. Suggest measuring the resistance **with power disconnected**. Never assert a fault was definitively found without evidence.
- UI: visually striking Verdant-inspired but original, with premium landing page, immediate sample CTA, upload and editable graph, voltage result, meaningful route trace and ambiguous-case UI. Palette flexible. No login.
- Show two DIFFERENT real Jev outcomes (clear image vs intentionally ambiguous test), one provider-verification branch if available. Do not mock response as real. Capture latency, tokens where available, and actual estimated provider cost if calculable.
- Security: no client keys, limited image size, timeouts, minimal logs, no persistent image storage, clear safety disclaimer. No dangerous mains/high-voltage troubleshooting suggestions.

## 210-minute timeboxes from NOW
0–20: inspect repo + first docs/contract PR + Anbaric spike in parallel.
20–85: independent feature PRs + UI parallel; unit fixtures working; initial Gemini and Jev real calls.
85–135: merge integrated image→review→solve run; Jev trace truly active.
135–165: mismatch diagnosis, review, responsive polish; optional second model.
165–190: production deploy (Anbaric if proven else Vercel), real incognito smoke tests.
190–210: scope freeze, 3-minute demo rehearsal, README, measured unit economics, backup recording, final status.
**At 85 minutes** solver and contracts must work. **At 135 minutes** real image→solve required; if missing, cut breadth and fix. **At 165 minutes** stop new features.

## Required final report
State exact repo and deployment links only if verified; merged/open PRs, test/build outcomes, how Jev routed live, what was truly supported, measured latency/cost if available, known limitations, and which judging criteria the evidence supports. If external login or hosting blocks, state the blocker and move to fallback, don't pretend success. Begin execution now; do not ask me broad planning questions.
