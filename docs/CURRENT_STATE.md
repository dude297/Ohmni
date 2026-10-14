# Ohmni — Current Verified State (Evidence Ledger)

Repo: https://github.com/dude297/Ohmni. Production: https://multimodal-hackathon-sage.vercel.app (Vercel project "ohmni"; URL unchanged). Hard deadline: 5:30 PM PDT, October 11, 2026.

## Current state (main at 51e5327, 2026-10-14 day)
- **Production** https://multimodal-hackathon-sage.vercel.app `/api/health` reports build `51e5327`; gemini/groq/jev configured (Vercel `GEMINI_MODEL` = `gemini-3.5-flash-lite`).
- **Merged 2026-10-13/14:** #73 server-authoritative `/api/repair/verify` (`5c90656`), #74 workload ceilings (`fe74394`), #75 diagnosis honesty (`e16a270`; includes a merge fix so verify reads nodes from the top *modeled* hypothesis, since `unmodeled` has no predicted voltages).
- **Merged 2026-10-14:** #76 AI consent gate (`1c52178`, `REQUIRE_AI_CONSENT` off by default) + docs/PRIVACY.md; #77 feature tiers + security headers + post-deploy smoke (`3fea355`; postdeploy workflow green against production); #78 request id, JSON logs, `INTERNAL` catch-all (`925f7c6`).
- **Demo numbers changed by #75:** ladder B=0, A=5 -> R2 open 99.7% (was 100%); bridge C=0, A=7.533 -> R6 open 88.5% and the guide asks for B; B=5.22 -> R6 open ~100%.
- **Merged:** #72 docs/audit (`51e5327`).
- **Supabase project `ohmni` (`oyiwnfcbdiakzmqpufaf`) is live with 4 migrations applied** (schema, private RLS helpers, cascade FKs, member lookup). `supabase/tests/rls_matrix.sql` ALL PASS on the live schema; advisors: no issues. Not connected to Vercel yet (owner sets env vars).
- **Open PRs, CI green, awaiting owner merge** (agent merges are blocked by policy): #79 backend P1 hardening; #80 Supabase persistence API (`/api/v1/*`, 503 until env set); #81 members + investigation report + browser client (stacked on #80); #82 Probe Guide confirms every node (out-of-model confident-wrong 7.12% -> 6.19% held-out, in-model 98.78% unchanged; <5% blocked by a ~4.6% indistinguishable floor); #83 enforcing CSP (all 14 routes clean); #85 usage metering (`model_traces`, first data point: one explain = 570 in / 349 out tokens on gemini-3.5-flash-lite); #86 workspace export + owner delete with typed confirmation. All five merged together locally: typecheck clean, 712 tests pass, persistence e2e ALL PASS.
- **Known gaps:** out-of-model floor (needs ohmmeter/current readings or equivalence lists); no invitation emails; persistence not enabled on Vercel; UI does not yet sign in, send `aiConsent`/`revisionId`, or render `fit: poor`.

## Snapshot (main at d7e38f5, 2026-10-11, superseded)
- **Merged to main** (see `git log`): scaffold and stubs (#1, #2), docs and north star (#3, #5, #17), UI (#4, #19), solver and `/api/solve` (#8), Gemini extraction (#6), Jev routing (#10, #15, #16), measurement-driven diagnosis (#7, #13), docs/README/demo script (#18, #20, #21), smoke script (#22), demo samples (#23), per-IP abuse guard (#24), Probe Guide backend (#25), Groq vision fallback and verifier (#26), single-source model defaults (#27).
- **Pipeline (all real, none stubbed):** Gemini `gemini-3.5-flash` reads the image; on 429/quota/503/timeout/5xx/not configured/malformed output Groq `qwen/qwen3.8-27b` reads it instead; Zod + structural validation; Jev `jev-1.13-free` (BeatAPI only, paid ids refused, paced 1 call/min, `Retry-After` honoured) picks `review_extraction` / `verify_topology` / `ask_user`; `verify_topology` runs the Groq verifier; user confirms; local MNA solver; measured-voltage diagnosis. OpenAI and the TypeSafe direct path are removed.
- **Endpoints:** `POST /api/extract`, `POST /api/solve`, `POST /api/probe` (Probe Guide, backend only), `GET /api/health` (build + `providers {gemini, groq, jev}` configured/model). Wire shapes in API_CONTRACT.md.
- **Abuse guard (src/proxy.ts):** per IP, extract 6/min and 40/h, solve 60/min, request bodies over 6 MB get 413.
- **Demo samples (`public/samples/`):** `clear-divider.png` -> `review_extraction`, `ambiguous-junction.png` -> `verify_topology`, `ambiguous-smudged.png` -> `ask_user`; live-observed once each (DEMO_CASES.md).
- **Verification:** `npm run smoke` (non-live) and `npm run smoke -- --live` against production. Latest live smoke at 8fad171: 12/12 PASS. The live trace was gemini `quota_exhausted` (429) -> Groq ok 710 ms -> Jev ok 718 ms `review_extraction`.

## Known risks
- **Gemini free quota / 503s:** the quota on this key was exhausted (429) by evaluation runs today, and Gemini models returned intermittent 503s earlier; the Groq fallback covers this.
- **Free-tier rate limits:** Groq free plan about 8K tokens/min (roughly 3 extractions/min); Jev 1 successful call/min (extra calls are skipped with an honest trace); the per-IP guard adds its own limits. Do not run back-to-back extractions during the demo.
- **Groq `qwen/qwen3.8-27b` is a Preview model** and may change or disappear.
- **Probe UI not wired:** `/api/probe` works, but the lab UI does not call it yet (UI owner: ChatGPT Work; spec in MOONSHOT.md).
- **Fixtures and samples are synthetic clean renders:** accuracy on real photos is not measured; the 10-fixture comparison is not a benchmark (VISION_FALLBACK.md).
- Per-instance in-memory rate limiting and Jev pacing: parallel serverless instances count separately.
- Unit economics are not measured; free-plan $0 is not a production cost (UNIT_ECONOMICS.md).

## Release status
Product freeze verdict is issued per FREEZE_CHECKLIST.md with exact SHA, URL and links; this page is a dated snapshot, so verify the live repository, CI and `/api/health` before reporting current progress.

## History (superseded, kept for audit trail)
- Initial docs-only baseline main: bcb1e41806f62177498bac61f7e0e89a58de9eda. At the second audit (main b315da3) `validateGraph`, `solveDC`, `extractCircuit` and `routeExtraction` were stubs and Gemini, Jev, secondary vision and the production URL were UNVERIFIED; release status was RED.
- PR #3 (docs) merged as 2b2fbce1644d64b02505dbaa929fe6c5f452c1f4; documentation freeze only, product RED at that time. PR #4 (frontend) was then open with typecheck failures; it has since merged.

## Release snapshot 2026-10-11 ~12:45 PM PDT
Main `a9f6360`, CI green, prod `/api/health` build `a9f6360` (visionPrimary groq by code default; `VISION_PRIMARY` unset in Vercel), non-live smoke 11/11, negatives and rate limit (429 + Retry-After) verified, no secrets in repo or production bundles. Overall AMBER; details and evidence in `docs/RELEASE_REPORT.md`.
