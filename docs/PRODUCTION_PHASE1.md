# Ohmni — Production Phase 1: Audit, Architecture and Release Gates

Audited source: main `d6bc997` (2026-10-12). Method: three independent read-only audits (security/parsers, numerical/diagnosis, reliability/ops/privacy) with reproductions, plus coordinator verification of the top finding. CONFIRMED = reproduced; SUSPECTED = code reading only.

Product north star: an evidence-driven hardware debugging workspace connecting intended designs, real observations, simulation, fault diagnosis and repair verification. First paid user: an electrical engineer doing prototype bring-up on supported low-voltage DC resistive circuits.

Owner decisions (2026-10-12): Supabase for auth and tenant-isolated persistence; Vercel as the single production host (Netlify/Anbaric become preview/fallback; Vercel Hobby forbids commercial use, so Pro is required before a paid beta); free AI tiers only behind explicit consent and disclosure for the alpha; frontend ownership stays split (ChatGPT Work: `src/app/page.tsx`, `src/app/lab/**`, `src/components/**`).

## A. Production audit — ranked findings

### P0 — must fix before any external user

| ID | Finding | Evidence | Remediation | PR |
|---|---|---|---|---|
| P0-1 | **Repair verification trusts the client.** `/api/repair/verify` passes client `expectVolts`/`toleranceVolts` to `verifyRepair`; graph and `hypothesisId` are unused. | CONFIRMED: fabricated hypothesis `does:notexist`, expect = measured = 7 V, tol 0 → `verified:true`; unknown node, tol 1e9 → `verified:true`. `src/app/api/repair/verify/route.ts`, `src/lib/repair/index.ts:152`. | Server re-derives the proposal from the confirmed graph + hypothesis, computes expectation and tolerance itself, binds to `revisionId`. | `p0/verify-server-authoritative` |
| P0-2 | **Probe Guide is confidently wrong outside its fault model.** Only open/short/×10/÷10/dead-source single faults are modelled; R×2 on the bridge: 258/300 sessions reported ≥ 0.9, all wrong, 178 with no warning. With 5 % part tolerance, 20/407 confident answers were wrong. | CONFIRMED, 300 noisy sessions per case. `src/lib/probe/index.ts`. | Explicit out-of-model hypothesis, fit-gated `done`, part tolerance in the likelihood; calibration benchmark. | `p0/diagnosis-honesty` |
| P0-3 | **Unbounded workload.** No component/string caps on the DC graph; no body cap except extract. A 400-resistor chain (36 KB) blocks the event loop ≈ 4 s; cost grows ≈ n³+. 64 KB netlists → thousands of components. | CONFIRMED timings. `src/lib/circuit/validate.ts:16-29`. | Component cap, identifier caps, streamed 256 KB JSON body cap, pair-count ceiling for multi-fault, AC per-request deadline. | `p0/workload-ceilings` |
| P0-4 | **Abuse controls are bypassable.** Limiter keys on the first `X-Forwarded-For` (100 spoofed requests, 0 blocked); its purge loop is O(map) per request (20k keys → 5.3 s CPU); no auth; free-tier quota can be drained. | CONFIRMED. `src/lib/server/rateLimit.ts:35,50`. | Trusted platform IP, bounded map with O(1) eviction, global per-instance model budget; auth + per-user quotas with persistence. | `p0/workload-ceilings` (+ auth PR) |
| P0-5 | **No consent or disclosure for third-party AI.** Images go to Groq, Gemini fallback and BeatAPI (structured summary) on free tiers whose terms may permit training. No privacy notice, ToS or retention statement. | CONFIRMED absence. | `docs/PRIVACY.md`; server requires an explicit `aiConsent` flag on `/api/extract` (env-gated until the upload UI ships it); consent banner on upload (frontend task). | follow-up |
| P0-6 | **No authentication or persistence.** Every route is anonymous; `userConfirmed` is a client boolean; evidence lives in `sessionStorage`. A paying engineer cannot keep a private investigation. | CONFIRMED. | Supabase Auth + RLS data model (section B); confirmation becomes a recorded fact (`design_revisions.confirmed_by`). | follow-up |
| P0-7 | **No observability.** No request IDs, logs or metrics; failures and quota exhaustion are invisible. Health reports config only. | CONFIRMED (grep). | Route wrapper: request id, one JSON log line per request (route, status, ms, provider events; never bodies), uniform error envelope, catch-all 500. | follow-up |

### P1 — fix before private alpha completes

| ID | Finding | Remediation |
|---|---|---|
| P1-1 | Tutor/mentor grounding false-accepts: `99volts`, `6.02e23 V`, `2.5e-3 A` escape extraction; free integers 0–10 always allowed; unit-blind (`2.5 A` passes on a 2.5 V fact). ≈ 6.5 % of random volt claims accepted on the bridge. CONFIRMED. | Typed claims (value, dimension), same-dimension match only, scientific notation. `p0/diagnosis-honesty`. |
| P1-2 | Solver has an absolute pivot threshold and no residual check: 1 mΩ–1 TΩ networks return KCL residual up to 2 % with no warning; 1e-12 Ω gives 11 % current error. CONFIRMED vs exact rational solver. Voltages for 1 mΩ–1 GΩ are fine (4e-7). | Relative pivot, residual + one refinement step, `ill_conditioned` warning. `p0/diagnosis-honesty`. |
| P1-3 | Extract size check trusts `Content-Length` and buffers first; MIME is client-asserted. SUSPECTED (code). | Streamed byte cap, magic-byte sniff. `p0/workload-ceilings`. |
| P1-4 | AC: one global ngspice worker; `faults:true` can hold it for minutes (per-sim 10 s timeout, no request deadline). SUSPECTED. | Request deadline, per-client concurrency 1. |
| P1-5 | No feature registry: experimental routes (`/ac`, `/twin`, `/studio`, `/review` mentor, `/api/firmware/adc`, `/api/topology`) are served beside core without a gate. | `src/lib/features.ts` registry + proxy enforcement + experimental badge (frontend renders). |
| P1-6 | Hosts drift and are unverifiable: Netlify production reports `build:"dev"`; `GEMINI_MODEL` differs (flash vs flash-lite); no `vercel.json`/`netlify.toml`; smoke not in CI. CONFIRMED by curl. | Vercel only for production; post-deploy smoke comparing `/api/health` build to the merged SHA; committed host config; env parity check. |
| P1-7 | Security headers absent (no CSP, frame-ancestors, nosniff). CONFIRMED. | `headers()` in `next.config.ts`. |
| P1-8 | `userConfirmed` is client-asserted; extraction output unsigned. | Replaced by persisted confirmation (P0-6). Interim: optional HMAC of extracted graph. |

### P2

Single-attempt provider calls with no retry on 5xx; `/api/extract` error envelope lacks `details`; Node 22 vs 24 between workflows; CI `permissions:` not set and actions pinned by tag; prompt fences for user strings in model prompts; Jev routing depends on model-authored warnings (human review still gates); multi-fault pair equivalence tolerance 1e-9 V (σ-scaled needed); `diagnosis/` bisection never says "nothing fits"; stale Anbaric `circuitscout` app; `eecircuit-engine` is a 20 MB opaque WASM bundle (pinned, MIT, no install scripts).

### Checked clean

AC netlist is built from typed tokens only (no user text reaches ngspice; no `.control`/`.shell`); netlist/KiCad importers reject directives and file includes, parse 64 KB in milliseconds, iterative (no recursion bomb); CSV import capped (256 KB / 500 rows); firmware "code" is regex-scanned, never executed (8 KB cap); no `NEXT_PUBLIC_*` or env in client components; provider error text not copied into traces; no `dangerouslySetInnerHTML`; singular/conflicting circuits refused with `SolveError`, never garbage.

## Capability classification

| Tier | Routes | Rule |
|---|---|---|
| Core (alpha candidate) | `/lab`, `/probe`, `/build` (repair bench), `/api/extract`, `/api/solve`, `/api/probe`, `/api/repair`, `/api/repair/verify`, `/api/health` | Advertised as engineering tools only after their P0s close and benchmark gates pass. |
| Experimental (visible, badged, not advertised) | `/review`, `/multi-fault`, `/twin`, `/studio`, `/ac`, `/teams`, `/api/review`, `/api/probe-multi`, `/api/twin`, `/api/ac`, `/api/topology`, `/api/firmware/adc`, `/api/explain` | Preserved; every response carries `x-ohmni-tier: experimental`; hidden in production when `OHMNI_EXPERIMENTAL=off`. |
| Demo/education | `/learn`, `/tracks`, `/for-the-larp/**` (incl. voice lab) | Not part of the paid product; may move under `/labs` later. Voice: browser speech services may send audio to the browser vendor; real microphone still unverified. |

## B. Architecture — canonical investigation model

```
Workspace (tenant) ─┬─ members (owner | editor | viewer)
                    └─ Project
                         ├─ Artifact (schematic image, netlist, CSV, report) → Supabase Storage, sha256, ai_processing_consent
                         └─ DesignRevision  (immutable; revision_hash = rev_ + sha256(canonical graph); confirmed_by/at)
                              └─ Investigation (open | resolved | abandoned)
                                   ├─ Measurement (append-only; node, reference, quantity, unit, method, instrument, powered, provenance, supersedes)
                                   ├─ Hypothesis snapshot (engine, engine_version, key, probability, fit, evidence_measurement_ids)
                                   ├─ RepairProposal (hypothesis, patch, predicted before/after, verification node/expect/tolerance, status, approved_by)
                                   │    └─ Verification (server-recomputed verdict, measurement, revision, engine_version)
                                   └─ Report (export artifact pinned to a revision)
ModelTrace (metadata only: request id, route, provider, model, status, ms, tokens — never prompts or images)
```

Invariants:
1. **Revision binding.** Every hypothesis, proposal and verification references the `design_revisions` row it was computed on; editing a circuit creates a new revision and never mutates evidence.
2. **Server authority.** Hypotheses, proposals, verifications and traces are written only by server routes (no client insert policy); the server recomputes from stored revision + measurements and records `engine_version` (deployed SHA).
3. **Human confirmation is data.** `confirmed_by`/`confirmed_at` replace the `userConfirmed` request flag once auth lands.
4. **Append-only evidence.** Measurements are corrected by superseding rows; no update/delete policies on evidence tables.
5. **Tenant isolation by RLS** using `is_member(workspace_id)` / `can_edit(workspace_id)`; workspace creator becomes owner via trigger; invites go through the server.
6. **Exportable case.** A report bundles revision graph + hash, measurement provenance, hypothesis snapshots with engine versions, proposal, verification and model-trace metadata, so a case can be re-run and re-verified offline.

Schema: `supabase/migrations/20261012000000_core_investigation_model.sql` (written, **not applied**). Next: create a Supabase dev project (free tier), apply, and add RLS tests (member/non-member/viewer matrices) before any route writes to it.

## D. Benchmark

Existing true oracles: closed-form solver tests, AC closed forms. Self-referential: probe-multi, repair and firmware tests derive truth from `solveDC`; probe tests are noise-free. Missing before this phase: noise, out-of-model faults, ill-conditioned networks, calibration, grounding corpus.

Harness (`bench/`, landing with `p0/diagnosis-honesty`): deterministic seeds; cases `bench/cases/<id>/case.json` (+ original schematic/netlist) with `{ source: real|synthetic, graph, gold: { faults, equivalenceClass }, observations: [{node, volts, instrument, timestamp}], inModel, partTolerances }`. Metrics: top-1 (strict and equivalence-merged), probes to termination, calibration (ECE, Brier, reliability bins), confident-wrong rate split silent/warned, out-of-model abstention, solver KCL residual and error vs exact rationals, grounding false-accept/false-reject on a labelled corpus.

Real labelled data: when an investigation is marked resolved, the app asks for the confirmed fault (component, class, out-of-circuit resistance) and accepts the case only if the post-repair verification passed on the server. Cases export (with consent) into the benchmark as `source: real`; "no fault found" is kept as an abstention class. Target before paid beta: ≥ 100 real resolved bring-up cases across ≥ 10 distinct designs.

## E. Operational readiness

| Area | Current | Required |
|---|---|---|
| Hosting | Vercel auto-deploys main (`multimodal-hackathon-sage.vercel.app`); Netlify production branch switch did not take (`build:"dev"`); Anbaric login-gated | Vercel Pro project for production; Netlify kept as preview or retired; Anbaric retired from public docs |
| Deploy | Git-triggered; no committed host config | `vercel.json` with headers/regions; required-env list; protected main; deploy only from CI-green commits |
| Smoke | `scripts/smoke.mjs` manual | Post-deploy job: `/api/health` build == merged SHA, solver/probe/repair-verify canaries, no model calls unless `--live` |
| Rollback | Undocumented | Vercel instant rollback to previous deployment; DB migrations forward-only with tested down-scripts; runbook in `docs/OPERATIONS.md` |
| Database | none | Supabase: daily backups (plan-dependent; Pro adds PITR), monthly restore drill into a scratch project, migration CI against a disposable branch |
| Monitoring | none | Structured request logs (Vercel log drain or Supabase table), error rate and p95 per route, provider 429/timeout counters, quota dashboards |
| Cost | Free tiers; Jev 1 call/min caps throughput to ≈ 1 analysis/min/instance | Measured per-analysis tokens (Groq tokens not yet recorded); paid no-training tier pricing to be collected before beta; unknowns stay unknown |

Cost estimate inputs measured so far (n = 1): Gemini extract 1310/106 tokens, Jev route 475/49, Groq latency 583 ms (tokens unrecorded). Gemini and Groq paid prices for the configured models are not listed, so per-analysis cost is **unknown**, not $0. Fixed platform costs at alpha scale: Vercel Pro (required for commercial use) and Supabase Free→Pro; confirm current list prices at decision time.

## F. Release gates

**Private alpha (invited engineers, no payment)**
- All P0 closed and merged with tests; P1-1, P1-2, P1-5, P1-6, P1-7 closed.
- Auth + RLS live; RLS test matrix passes (non-member reads 0 rows on every table).
- Consent + privacy notice shipped; no image reaches a model without recorded consent.
- Benchmark: in-model top-1 ≥ 95 % (equivalence-merged) on synthetic fixtures with 5 % part tolerance; confident-wrong (≥ 0.9) < 2 % in-model and < 5 % out-of-model; solver max relative error < 1e-6 for 1 mΩ–1 GΩ, warning on every ill-conditioned case; grounding false-accepts 0 on the corpus.
- Production SHA verified by post-deploy smoke; rollback rehearsed once.

**Paid beta**
- ≥ 100 real resolved cases (≥ 10 designs) in the benchmark; reported metrics computed on real cases, published with sample sizes.
- Paid, no-training AI tiers (or AI disabled per workspace); DPA/subprocessor list; retention and deletion implemented (workspace delete removes storage objects).
- Per-user quotas backed by shared storage; error budget defined (e.g. 99.5 % monthly availability for core routes); on-call runbook.
- Exportable engineering case reproduces the same verdict on re-run.

**General availability**
- Calibration holds on held-out real cases (ECE < 0.05); documented supported-circuit envelope with refusal outside it.
- External security review/penetration test; SOC 2 readiness plan if selling to companies.
- Backups with tested point-in-time restore; multi-region or documented RTO/RPO.
- Billing, account management, audit log, data export and deletion self-service.

## Limitations (current, stated plainly)

DC resistive circuits with ideal voltage sources only in the core; single-fault model by default (two-fault probing is experimental); probabilities are model-relative, not field-calibrated; no real-schematic accuracy measured yet; voice untested on a real microphone; nothing is persisted server-side today; third-party AI processes uploaded images under free-tier terms during the alpha only with explicit consent.
