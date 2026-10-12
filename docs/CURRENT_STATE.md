# Ohmni — Current Verified State (Evidence Ledger)

Repo: https://github.com/dude297/Ohmni. Primary: [Anbaric](https://ohmni.cloud.anbaric.ai), signed-in access required. Public fallback: [Vercel](https://multimodal-hackathon-sage.vercel.app).

## Source and branch state — October 11, 2026

- Main snapshot: `1ec8a79844a313af1245f28767802abf3015f34f`, [merged integration #69](https://github.com/dude297/Ohmni/pull/69). Guided Lab, Probe Guide, tutor, Under the Hood, topology backend, canonical `LOADED_BRIDGE_12V` and Living Schematic are implemented. This source inventory does not establish hosted build parity.
- Runtime default: **Groq vision → schema/structural checks → Jev structured routing → explicit human confirmation → deterministic MNA → measurement-based investigation**. Gemini is the one-shot vision fallback and separate grounded tutor. `VISION_PRIMARY` can reverse the vision order.
- Probe Guide is connected in both `/lab` and `/probe`; its recommendations and model-relative posteriors come from the solver. `/api/topology` remains backend-only with no connected UI.
- [Living Schematic #67](https://github.com/dude297/Ohmni/pull/67) was merged into integration as `da11efee` on October 11 at 8:58 PM EDT, then included in #69. It adds advanced Lab selection, an orthogonal bridge and refined evidence presentation without changing its original provider/API/math contracts.
- Application commit `e1e97dd61ec0a924683e4d128a4dc0241044e05f`: [CI](https://github.com/dude297/Ohmni/actions/runs/38186787568) passed lint, fresh types, **169 unit tests** and build. [Full Next + Chrome QA](https://github.com/dude297/Ohmni/actions/runs/38186787555) passed **302 feature / 58 baseline checks** at 320/390/768/1440px with both motion preferences. These isolated tests made no model calls.
- Prelint on that application commit: technical **LGTM**, product **Ship with changes**. Three product findings are corrected; remaining recommendations are documented in [the implementation handoff](ui-review/LIVING_SCHEMATIC.md). That exact-build result does not cover the subsequent integration's additional features.

## Additional merged experiments

| Source surface | Implemented scope / status |
| --- | --- |
| `/tracks`, `/learn`, `/build`, `/teams` | Selector, solver-backed learning lesson, bridge repair bench and browser-only packet review/export. No hosted multi-user collaboration |
| `/for-the-larp/voice-lab` | Confirmed typed/voice reading and repair workflow; real microphone remains unverified ([notes](VOICE_REPAIR_STUDIO.md)) |
| `/studio` | Virtual breadboard with 3D and 2D views; explicit strip/jumper connectivity, synthetic fixture, no photo recognition ([notes](STUDIO.md)) |
| `/twin` | Imported KiCad design versus confirmed observed graph, solver-based comparison and repair verification. Simulated DC comparison, not live instrument synchronization ([notes](DIGITAL_TWIN.md)) |
| `/ac` | Separate typed-graph, worker-isolated ngspice frequency-response sandbox ([notes](AC_SIMULATION.md)) |
| Backend/library prototypes | Circuit review/mentor, firmware ADC analysis, netlist import, CSV evidence replay and bounded two-fault probe library. Default probe stays single-fault |

[CI on main snapshot](https://github.com/dude297/Ohmni/actions/runs/38190081222) passed lint, fresh types and build: **42 test files, 630 passed, 7 expected failures, 2 skipped**. The expected-failure cases remain known bugs/limitations; they are not successful feature verification. Integration-wide hosted browser, voice and hardware validation is separate from the earlier 302-check Living Schematic suite. Module notes and [the index](README.md) distinguish implemented source from proposed UI.

## Hosted evidence and remaining gates

The [release evidence ledger](RELEASE_E2E_2026-10-11.md) records public Vercel smoke and browser E2E on `d5a0035`, earlier live-model recordings, and outstanding signed-in Anbaric/deployment-parity checks. Its dates and build IDs remain authoritative for those observations. This documentation pass did not recheck either production host, rerun image models or verify a submission receipt. An automatic Vercel branch preview is not a production update.

The coordinator's #69 handoff preserves the earlier release branch for rollback and says experimental features need hosted user-flow verification. Release acceptance remains evidence-based under [FREEZE_CHECKLIST](FREEZE_CHECKLIST.md). This documentation pass makes no new application merge or production deployment.

## Historical snapshot — main at d7e38f5 (superseded)

The entries below preserve earlier observations and implementation gaps. They are not the current source inventory; in particular, Gemini-first routing and the unwired Probe UI have since been superseded.
- **Merged to main** (see `git log`): scaffold and stubs (#1, #2), docs and north star (#3, #5, #17), UI (#4, #19), solver and `/api/solve` (#8), Gemini extraction (#6), Jev routing (#10, #15, #16), measurement-driven diagnosis (#7, #13), docs/README/demo script (#18, #20, #21), smoke script (#22), demo samples (#23), per-IP abuse guard (#24), Probe Guide backend (#25), Groq vision fallback and verifier (#26), single-source model defaults (#27).
- **Pipeline (all real, none stubbed):** Gemini `gemini-3.5-flash` reads the image; on 429/quota/503/timeout/5xx/not configured/malformed output Groq `qwen/qwen3.8-27b` reads it instead; Zod + structural validation; Jev `jev-1.13-free` (BeatAPI only, paid ids refused, paced 1 call/min, `Retry-After` honoured) picks `review_extraction` / `verify_topology` / `ask_user`; `verify_topology` runs the Groq verifier; user confirms; local MNA solver; measured-voltage diagnosis. OpenAI and the TypeSafe direct path are removed.
- **Endpoints:** `POST /api/extract`, `POST /api/solve`, `POST /api/probe` (Probe Guide, backend only), `GET /api/health` (build + `providers {gemini, groq, jev}` configured/model). Wire shapes in API_CONTRACT.md.
- **Abuse guard (src/proxy.ts):** per IP, extract 6/min and 40/h, solve 60/min, request bodies over 6 MB get 413.
- **Demo samples (`public/samples/`):** `clear-divider.png` -> `review_extraction`, `ambiguous-junction.png` -> `verify_topology`, `ambiguous-smudged.png` -> `ask_user`; live-observed once each (DEMO_CASES.md).
- **Verification:** `npm run smoke` (non-live) and `npm run smoke -- --live` against production. Latest live smoke at 8fad171: 12/12 PASS. The live trace was gemini `quota_exhausted` (429) -> Groq ok 710 ms -> Jev ok 718 ms `review_extraction`.

### Risks recorded in the historical snapshot
- **Gemini free quota / 503s:** the quota on this key was exhausted (429) by evaluation runs today, and Gemini models returned intermittent 503s earlier; the Groq fallback covers this.
- **Free-tier rate limits:** Groq free plan about 8K tokens/min (roughly 3 extractions/min); Jev 1 successful call/min (extra calls are skipped with an honest trace); the per-IP guard adds its own limits. Do not run back-to-back extractions during the demo.
- **Groq `qwen/qwen3.8-27b` is a Preview model** and may change or disappear.
- **Probe UI not wired:** `/api/probe` works, but the lab UI does not call it yet (UI owner: ChatGPT Work; spec in MOONSHOT.md).
- **Fixtures and samples are synthetic clean renders:** accuracy on real photos is not measured; the 10-fixture comparison is not a benchmark (VISION_FALLBACK.md).
- Per-instance in-memory rate limiting and Jev pacing: parallel serverless instances count separately.
- Unit economics are not measured; free-plan $0 is not a production cost (UNIT_ECONOMICS.md).

### Historical release-status rule
Product freeze verdict is issued per FREEZE_CHECKLIST.md with exact SHA, URL and links; this page is a dated snapshot, so verify the live repository, CI and `/api/health` before reporting current progress.

### Earlier history (superseded, kept for audit trail)
- Initial docs-only baseline main: bcb1e41806f62177498bac61f7e0e89a58de9eda. At the second audit (main b315da3) `validateGraph`, `solveDC`, `extractCircuit` and `routeExtraction` were stubs and Gemini, Jev, secondary vision and the production URL were UNVERIFIED; release status was RED.
- PR #3 (docs) merged as 2b2fbce1644d64b02505dbaa929fe6c5f452c1f4; documentation freeze only, product RED at that time. PR #4 (frontend) was then open with typecheck failures; it has since merged.

### Release snapshot 2026-10-11 ~12:45 PM PDT
Main `a9f6360`, CI green, prod `/api/health` build `a9f6360` (visionPrimary groq by code default; `VISION_PRIMARY` unset in Vercel), non-live smoke 11/11, negatives and rate limit (429 + Retry-After) verified, no secrets in repo or production bundles. Overall AMBER; details and evidence in `docs/RELEASE_REPORT.md`.
