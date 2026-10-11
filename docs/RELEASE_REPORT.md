# Ohmni Release QA Report

> **Historical (2026-10-11 afternoon audits).** Not the current state. Since then: primary host is Anbaric (https://ohmni.cloud.anbaric.ai, build `d4b97d2` (release candidate #62 + Loaded bridge sample #64, redeployed ~16:00 PDT), login required); the Vercel fallback is frozen at `d5a0035` (daily deploy allowance exhausted), so "production", "known-good build" and "Build SHA == main" below refer to the Vercel host at the audited SHA only. Backup video is now `docs/demo/ohmni-demo-guided.webm`. Prelint is `tag_only` since #60. Submission is not declared complete by this report.

**Overall: AMBER** (no P0 regression found). Prepared ~12:45 PM PDT, 2026-10-11, against main `a9f6360600be0f755aeb614f9085f30308488b16` and production https://multimodal-hackathon-sage.vercel.app.

AMBER reasons (FREEZE_CHECKLIST.md): the three-minute desktop/mobile rehearsal and backup recording are not verified by this report; latency/cost data are observed-only (free plan, unit economics unmeasured); `verify_topology` has not been reproduced on the current Groq-primary stack; parallel serverless instances count rate limits separately. Everything else checked here passed.

Method: no model calls were made by this report (zero `/api/extract` calls; no Jev/Groq/Gemini quota used). Live model rows cite the coordinator's evidence captured today on build `a9f6360` (~12:30 PM PDT) and are marked "(coordinator)".

| Area | Result | Evidence | Next action |
|---|---|---|---|
| Main / CI | PASS | `git ls-remote origin refs/heads/main` -> `a9f6360600be0f755aeb614f9085f30308488b16` (12:43 PM PDT). `gh pr list --state open` -> none. `gh run list --branch main -L 3`: three most recent `ci` runs all `completed success` (38168353936 for a9f6360, 40 s; 38168164434; 38168079296). | Re-check after any post-freeze P0 fix. |
| Production deployment | PASS | `GET /api/health` (12:43 PM PDT): `{"status":"ok","build":"a9f6360","visionPrimary":"groq","providers":{"gemini":{"configured":true,"model":"gemini-3.5-flash-lite"},"groq":{"configured":true,"model":"qwen/qwen3.8-27b"},"jev":{"configured":true,"model":"jev-1.13-free"}}}`. Build SHA == main SHA. `VISION_PRIMARY` is NOT set as a Vercel env var; `groq` is the code default (`src/lib/ai/vision.ts`, `src/app/api/health/route.ts`). `npm run smoke` (non-live, zero model calls) 11/11 PASS: `/` 200 "Ohmni", `/lab` 200, health ok, solve 2.5 V, solve 0.454545 V, diagnose top hypothesis R2 1 kOhm, plus 5 negatives. (Coordinator's 12/12 at a9f6360 included one more check.) | None. Docs-only mismatch: prod Gemini model is `gemini-3.5-flash-lite` while DEPLOY_AND_DEMO.md lists `gemini-3.5-flash` as default. |
| Groq vision | PASS (coordinator) | `clear-divider.png` -> groq ok 795 ms; `ambiguous-smudged.png` -> groq ok 864 ms with warning "R2 partially obscured... appears to be 10k" (~12:30 PM PDT, a9f6360). | Keep to ~3 extractions/min (Groq free tier). Groq model is a Preview model. |
| Gemini fallback | PASS (historical evidence, build 8fad171) | Gemini `quota_exhausted` 429 -> Groq ok 710 ms -> Jev ok (real fallback, CURRENT_STATE.md). Code: `src/lib/ai/vision.ts` order is `[groq, gemini]` by default; both failing returns `manual()` "enter the circuit manually" (no crash). Not re-run at a9f6360. | None; do not burn quota re-proving. |
| Jev review route | PASS (coordinator) | `clear-divider.png` -> Jev `review_extraction` p=1.00 (~12:30 PM PDT, a9f6360). | None. |
| Jev clarification route | PASS (coordinator) | `ambiguous-smudged.png` -> Jev `ask_user` p=1.00 (~12:30 PM PDT, a9f6360). With the review route this is the contrasting downstream outcome the freeze gate requires. | None. |
| Historical topology verification (Gemini-era only, NOT current) | HISTORICAL | `verify_topology` + Groq verifier was observed on the Gemini-era stack (`ambiguous-junction.png`, DEMO_CASES.md). NOT reproduced on the Groq-primary stack (a9f6360 commit message: "verify_topology not reproduced"). Do not present it as current behaviour. | Demo only review_extraction and ask_user routes. |
| Solver / diagnosis | PASS | Smoke: 10k/10k -> 2.5 V; 10k/1k -> 0.45454545 V; measured 0.45 V -> top hypothesis "R2 may be 1 kOhm instead of 10 kOhm". Negatives: `userConfirmed:false` -> 422 NOT_CONFIRMED; floating graph -> 422 INVALID_GRAPH; bad JSON -> 400 BAD_JSON. | None. |
| Probe Guide API | PASS | `/probe` page serves 200; coordinator: `/api/probe` ladder B=0 -> next A 1.50 bits. Invalid: `POST /api/probe` `{bad` -> 400 BAD_JSON; `{}` -> 422 INVALID_REQUEST ("graph: ..."). (12:44 PM PDT) | None. |
| Tutor API | PASS | Coordinator: `/api/explain` grounded:true, gemini-3.5-flash-lite 1885 ms. Invalid: `{bad` -> 400 BAD_JSON; `{}` -> 422 INVALID_REQUEST. Not called live here (would use Gemini quota). | None. |
| Rate limiting | PASS | `src/lib/server/rateLimit.ts` + `src/proxy.ts` (matcher: extract, solve, explain): extract 6/min + 40/h, solve 60/min, explain 10/min (env-overridable); in-memory per instance. Live: 62 rapid `POST /api/solve` (bad JSON, model-free) -> 54x 400, 8x 429 with `Retry-After: 37` (count includes earlier smoke calls from the same IP in the same minute). `/api/explain` 11-rapid test NOT run (would call Gemini); limiter config confirmed from code only. Oversize: 7 MB PNG to `/api/extract` -> 413 `FUNCTION_PAYLOAD_TOO_LARGE`, returned by the Vercel platform before the app (its body cap is below the app's 6 MB check, so oversize is rejected either way). Extract negatives: non-multipart -> 400 INVALID_FORM; text/plain file -> 400 UNSUPPORTED_TYPE; no image -> 400 MISSING_IMAGE. | Do not run back-to-back extractions in the demo; per-instance limits can undercount across instances. |
| Security / keys | PASS | Repo grep (src, docs, scripts, public, tests, fixtures, README) for `AIza`, `gsk_`, `sk-`, `Bearer <token>`: no matches. `NEXT_PUBLIC`: only a doc sentence ("Never NEXT_PUBLIC keys"), zero usage in src. Production `/`, `/lab`, `/probe` HTML plus 12 `_next/static` chunks (~717 KB) scanned: no key patterns, no `BEATAPI`/`GEMINI_API_KEY`/`GROQ_API_KEY` strings, no provider hostnames. Client `fetch` calls only hit same-origin `/api/*` (`src/components/ohmni/api.ts`, `src/app/probe/probe-client.tsx`); model calls are server-only. OpenAI: no code path (only "openai" hits are Groq's OpenAI-compatible URL in `src/lib/ai/groq.ts` and its test); no `gpt-`. `/api/health` exposes only configured booleans and model names. | None. |
| Paid-escalation guard | PASS | `src/lib/ai/jev.ts`: `FREE_MODELS = new Set(['jev-1.13-free'])`; any other `BEATAPI_JEV_MODEL` is refused ("Refused non-free Jev model ...; defaulting to ask_user"). Pacing 1 call/min, max wait 8 s, then honest skipped trace. Prod model is `jev-1.13-free`. | None. |

## Fallback / manual recovery
From code and existing evidence only (no live non-circuit extract, to preserve the shared 1/min Jev slot): malformed model output -> "enter the circuit manually" (`extractionSchema.ts:85`); timeouts/failures -> same message (gemini.ts, groq.ts); all providers down -> `manual()` in `vision.ts`; missing measure node -> user chooses it. Jev unavailable/skipped -> default route `ask_user`. The user can always edit/enter the circuit and confirm; the solver is local and model-free.

## Rollback
Known-good build: `a9f6360600be0f755aeb614f9085f30308488b16` (current main, prod `build: a9f6360`, CI green). Command (NOT run): `vercel rollback <previous-good-deployment-url-or-id>` or `vercel promote <deployment-url>`; alternatively `git revert` the bad commit on main and let Vercel redeploy.

## Known limitations
Free-tier quotas (Jev 1 call/min shared, Groq ~3 extractions/min, Gemini quota previously exhausted); Groq model is Preview; samples are synthetic clean renders; accuracy on real photos unmeasured; unit economics unmeasured.

---

# Release audit 2 — ~1:25 PM PDT, 2026-10-11

**Overall: GREEN (no P0 regression; no open P0 gate that needs engineering).** Main `947eb06`, prod `build: 947eb06` (== main), CI on main `success` (947eb06 and 06609f9). Open PR: #39 "research: topology confidence engine" (not part of release; do not merge before submission). `/api/health`: `visionPrimary: groq`; gemini `gemini-3.5-flash-lite`, groq `qwen/qwen3.8-27b`, jev `jev-1.13-free`, all configured.

Method: zero `/api/extract` calls (Groq/Jev quota preserved), 1 `/api/explain` call (Gemini). Model-live rows reuse recorded evidence with build/time.

| P0 gate | Status | Evidence |
|---|---|---|
| E2E live routes (extract -> route) | CLOSED (recorded) | a9f6360 ~12:30 PDT: clear-divider Groq 795 ms -> Jev `review_extraction` p=1.00; smudged Groq 864 ms + obscured warning -> Jev `ask_user` p=1.00 (c06a53b). Fallback Gemini 429 -> Groq 710 ms (8fad171). Not re-run now (quota). Code since then is docs/tutor only. |
| Solver / diagnosis | CLOSED | `npm run smoke` vs prod: 11/11 PASS (build 947eb06). 2.5 V; 0.454545 V; 0.45 V -> "R2 may be 1 kΩ instead of 10 kΩ"; negatives 422/400. |
| Probe Guide | CLOSED | Live `/api/probe`, ladder: B=0 V -> next A (1.50 bits) with outcomes (0 V -> V1 dead/R1 open 50%; 2.5 V -> R3 short; 5 V -> R2 open); B=0 + A=5 -> done, "Most likely: R2 open / not connected (100%)". Model-free (trace: local mna-dc). Re-record at bdf035f in docs/demo. |
| Tutor (Gemini) | CLOSED | 1 call now on divider with 0.45 V: `grounded: true`, `ungroundedNumbers: []`, gemini-3.5-flash-lite 1372 ms, hypotheses incl. R2 1 kΩ, readable numbers (no long floats). Earlier 947eb06 ~1:10 PDT on ladder: "0.167 mA", "3.33 V", "1.67 V". |
| Browser QA | CLOSED | Playwright on PRODUCTION, `/`, `/lab`, `/probe` at 1440x900 and 390x844: 0 console errors, 0 px horizontal overflow, Tab reaches Upload / Load sample / sample picker / Guide controls / Explain with visible focus. Minor (not P0): SVG schematic nodes are tabbable without a distinct focus ring; on `/probe` the Guide me/Submit buttons were not within the first 10 tabs (disabled until a reading is typed). Screenshots in %TEMP%\ohmni-e2e-d (not committed). Earlier clean pass at d1096b7 (PR #38, docs/demo/README.md). |
| Recording | CLOSED (superseded) | Then: ohmni-demo-backup.webm (d1096b7) plus /probe re-record (bdf035f). Now: docs/demo/ohmni-demo-guided.webm (2:35, guided UI, c27807c). Must be labeled RECORDED. |
| Submission copy | CLOSED | SUBMISSION.md and DEMO_SCRIPT.md corrected: 4-minute script, core-value sentence, model roles (Groq extraction; Jev structured routing and ambiguity escalation; Gemini = vision fallback AND separate tutor role; local MNA = mathematical authority), tutor beat + Probe Guide in the demo, >= 65 s Jev spacing or RECORDED clip, verify_topology historical only. |
| Rollback | CLOSED | Known-good SHA `947eb06` (current main, prod, CI green). Command (NOT executed): `vercel rollback <previous-good-deployment-url-or-id>` or `vercel promote <947eb06-deployment-url>`; or `git revert` and redeploy. |

Rubric coverage in the demo: multimodel 25% (Groq + Jev + Gemini x2 roles + solver, all in the trace/tutor beats); novelty 20% (cross-representation, next-best measurement); production and economics 15% (live prod, rate limits, free-model guard, honest limitations, UNIT_ECONOMICS unmeasured); demo 20% (4-min script with recorded backup); real need 20% (0.45 V vs 2.5 V debugging story).

Remaining user actions:
1. Final rehearsal of the 4-minute script on desktop; do not test-upload in the 5 minutes before the live run (Jev 1 call/min).
2. Run the second upload (smudged) only >= 65 s after the first; otherwise play the clip and say "this is a recording".
3. Record narration if the submission form requires a video; submit the form (repo, live URL, SUBMISSION.md summary) by 5:00 PM PDT target.
4. Do not merge #39 or other changes after the 3:30 freeze unless fixing a P0.
