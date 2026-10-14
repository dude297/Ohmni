# Anbaric as a separate investigation-workflow backend (research)

**Status:** research. **No hackathon deployment.** The Next.js app stays on Vercel and is **not** migrated.

**Sources** (accessed 2026-10-11):
- `npm view anbaric readme` and `npm view anbaric-cli readme`: v1.68.3, MIT, both modified 2026-10-11.
- The `anbaric-impl-cloud` / `anbaric-state-machine` tarballs from `npm pack`, file list only.
- `https://cloud.anbaric.ai`: returns a 302 to an Auth0 login (`*.uk.auth0.com/authorize`). There is no public pricing or docs page behind it.
- The earlier team spike (owner report, not re-verified today): `anbaric app deploy` runs TS source via tsx, and our Next.js deploy there sat behind the Auth0 login wall.

## What Anbaric actually provides (documented in the README)
- **State machines and jobs.** `StateMachine(id, State[])`, `State(name, actions, transitions)`, `Action.run(job) → Map` of property changes, and `Transition(target, async predicate)`. Jobs carry `properties` (async `get/has/getMany`), the current `state`, and a full history of every from→to move with its actor. Terminal states carry an optional `SUCCESS`/`FAILURE` outcome.
- **Actors and audit.** Every write names a `Human`, `Code` or `Agent` actor. Audit records hold actor, resource, interaction and description. Locally they go to the console; when deployed they are persisted and browsable in the admin console. Reads are masked by default.
- **Human pauses.** `Await(name, "HUMAN" | "EXTERNAL_SYSTEM")` with `fields` and `resolveUrl(job)` parks a job in `Awaiting input` until `updateJob(id, props, actor)` arrives. On resume, only the transitions are re-evaluated.
- **Stores.**
  - `JsonStoreFactory` (schema-validated docs), `SecretStoreFactory` (encrypted) and `SqlStoreFactory`.
  - SQL is SQLite locally and the tenant's PostgreSQL (`anbaric_app_data` schema) when deployed.
  - There is also a `JobRunScheduler` for cron-like runs, which Ohmni does not need.
- **Hosting requirements.**
  - `package.json` must have `"type": "module"` and `main` pointing at TS source.
  - `.anbaric/app-config.json` holds `{name, internalPort}`.
  - The platform runs `npm install` but **no build step**: source runs via tsx in a baked Docker image.
  - HTTP listens on `process.env.PORT` and is served at `<platform>/app/<name>/*` (the prefix is stripped).
  - Any front-end there "must be React + anbaric-design-system". This is irrelevant if we keep the UI on Vercel.
- **Local mode.** With no `ANBARIC_*` env vars, everything is in-memory and in-process (`npx tsx src/main.ts`), so it costs **$0** and needs no account. This is the PoC mode.
- **CLI auth.**
  - `anbaric login` is a browser flow that mints an Ed25519 key.
  - Each request carries a 60-second EdDSA JWT plus an `x-anbaric-tenant` header.
  - `jobs create | list | watch | update | set-state | kill` drive jobs from scripts and CI.
- **Built-in LLM agents.** `OpenAIAgent` + `RemoteLLMAgenticAction` (the README example uses `gpt-5.4-mini`). **Ohmni must not use these:** they are paid OpenAI calls, and model calls stay in Ohmni's own policy-checked adapters.

## Not documented / unknown (do not assume)
- **Pricing:** no public pricing found. Cloud tiers, per-job or storage costs, and free-tier limits are all **unknown**.
- **Self-hosting:** the README says "open source, you can self-host", but npm metadata lists no repository URL, so the self-host procedure is **unverified**.
- **Service-to-service auth:** an external server (Ohmni on Vercel) calling the app proxy or platform API. Is the `/app/<name>` proxy behind the same Auth0 session wall we hit? Probably yes, from the spike, but **unverified**. No documented API keys for non-CLI clients.
- **Webhooks or outbound notifications:** none documented. `CloudNotifier` exists in the dist file list, but its behaviour is undocumented.
- **Other unknowns:** data residency (the Auth0 tenant is `.uk.`), retention, SLA and rate limits.
- **Maturity:** the packages were republished today at v1.68.x, which suggests fast churn. Pin exact versions.

## Why it would improve Ohmni
- Today an investigation lives in browser state. A reload loses the confirmed graph, the probe history and the model traces.
- A durable `investigation` job would give:
  - a resumable session;
  - an **audited record of who confirmed the circuit**, so the human confirmation becomes a persisted fact with an actor, not a boolean in a request body;
  - a measurement history;
  - model events attributed to an `Agent` actor per provider.
- This is the evidence/provenance graph (ROADMAP_RESEARCH §5) with a state machine on top.

## Integration architecture (TypeScript)
```
Browser ──> Ohmni Next.js (Vercel, unchanged routes; still calls Groq/Gemini/Jev + local MNA)
              │  server-side only: POST /jobs, PATCH /jobs/:id  (Anbaric app's own JSON API)
              ▼
        Anbaric app "ohmni-investigations" (tsx, StateMachine + JsonStore)
              │  Code action on state entry → fetch(OHMNI_WEBHOOK_URL, HMAC-signed)   (we write this; no built-in webhook)
              └─ fallback: Ohmni polls GET /jobs/:id
```
- Ohmni posts **results**: the extraction JSON, trace events, the user's choice and probe readings. Anbaric never calls model providers.
- Each update names its actor: `Human(userId)` for confirmations and readings, `Code("ohmni-api")` for solver output, `Agent("groq:qwen3.8-27b")` for model reads. Model output is recorded **as reported**; no confidence is invented.
- Secrets (the HMAC key, the Anbaric credential) live server-side only and never reach `NEXT_PUBLIC_*`.
- Images are referenced by sha256, not stored, until consent and retention are decided.

## Smallest PoC: one state machine, local mode only, $0
```ts
// research/anbaric-poc/src/main.ts (sketch; run with `npx tsx`, no ANBARIC_* env = in-memory)
const review = new Await("Human reviews graph", "HUMAN"); review.fields = ["confirmedGraph", "confirmedBy"];
const probe  = new Await("Enter reading", "HUMAN");       probe.fields  = ["observation"];
const has = (k: string) => async (j: Job) => j.properties.has(k);
export const investigation = new StateMachine("investigation", [
  new State("uploaded",       [], [new Transition("extracted",      has("extraction"))]),
  new State("extracted",      [], [new Transition("routed",         has("route"))]),          // Jev choice as reported
  new State("routed",         [], [new Transition("awaiting_review", async () => true)]),
  new State("awaiting_review",[review], [new Transition("confirmed", has("confirmedBy"))]),   // the userConfirmed gate, audited
  new State("confirmed",      [solveAction], [new Transition("solved", has("solution"))]),    // Code actor wraps solveDC
  new State("solved",         [], [new Transition("probing", has("measured")), new Transition("concluded", has("noFault"))]),
  new State("probing",        [probe, probeStepAction], [new Transition("concluded", has("probeDone"))]),
  new State("concluded"),
]);
```
- **Test (vitest, in-memory):**
  - Drive one job through using the recorded fixture outputs (no live model calls).
  - Assert the job **cannot** reach `confirmed` without a `Human` actor update.
  - Assert the history lists every transition with its actor.
- **Effort:** about 0.5 day.
- **Open PoC question:** `probing` loops, since each reading re-parks the job. Check whether an `Await` re-arms on re-entry to the same state, or whether a `probing → probing` transition is needed. **Unverified.**

## Costs
- **Monetary:** local PoC $0. Cloud: **unknown** (no published pricing). The built-in OpenAI agents would be paid, and we will not use them.
- **Operational:**
  - It is a second deploy target with its own auth (browser login for the CLI) and its own logs (`anbaric app tail`).
  - We have to write the webhook/HMAC and polling code ourselves.
  - Version churn means pinning exact versions.
  - Data leaves Vercel for another processor, possibly in the UK region (unverified), so the privacy notice must change.

## GO / NO-GO (post-hackathon)
- **GO** for the local-only PoC above: zero cost, no account, and it tests whether the state-machine plus audit model fits the investigation flow.
- **NO-GO** for cloud/production adoption until the owner gets written answers on:
  1. pricing;
  2. service-to-service auth to the app proxy (no Auth0 wall for server calls);
  3. a self-host source repository;
  4. data residency and retention.
- **Fallback if those answers are bad:** the same state machine as a Postgres table plus an append-only events table (ROADMAP_RESEARCH §5). It is fewer moving parts and equally auditable.
