# OHMNI NORTH STAR — 5:30 PM PDT HARD-DEADLINE RELEASE

**Single authoritative plan.** Product: Ohmni. Date: **Sunday, October 11, 2026**. User-confirmed external hard deadline: **5:30 PM Pacific Daylight Time (PDT; America/Los_Angeles)** = **8:30 PM Eastern Daylight Time (EDT)**. The original 210-minute kickoff schedule below is superseded by the absolute-time recovery schedule in this document. **Submit by 5:00 PM PDT**, leaving a 30-minute contingency buffer. Owner: Claude Opus 5.5; frontend owner: ChatGPT Work; target branch: main; PRs only.

## Product expansion vision
See [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) and the homepage for honest phase statuses and future use cases. It does **not** authorize new P1/P2 code before the fixed hackathon freeze.

## The demo promise
A real, clear low-voltage DC schematic image becomes an editable, user-confirmed **electrical graph**; a real Jev decision changes how it is checked; a deterministic simulator computes expected node voltages; a measured voltage mismatch yields a **testable** fault hypothesis and a suggested next safe measurement. The UI is polished, fast and honest about uncertainty.

## Judges: what must be proven
1. **Essential multimodel:** Gemini visual extraction + live Jev conditional routing, optionally independent second provider, solver as deterministic tool. Show actual route selection and at least two distinct outcomes. A badge is not integration.
2. **Differentiation:** cross-representation architecture and next-best-measurement debugging, not a generic AI tutor or virtual breadboard simulator.
3. **Readiness + economics:** typed validation, limits, errors, checked calculations, deployment, measured token counts and clearly sourced marginal cost estimates (unknown ≠ zero).
4. **Compelling E2E:** 3-minute live public demo, sample fallback and recorded backup clearly labeled.
5. **Paying problem:** reduce hardware troubleshooting time for EE labs, makers and prototype engineers. Willingness to pay not validated; call it a hypothesis.

## Boundaries
**P0:** deployable Next.js site + health API; real Gemini schematic extract; live Jev router; graph edit/review; correct resistor/DC-source MNA; observed/predicted comparison; supported hypothesis; trace/errors/security; 3-minute demo.
**P1:** polished responsive landing+lab; optional second vision provider with real call; optional standardized virtual breadboard coordinate adapter; short EE teaching explanation.
**P2 DEFER:** arbitrary breadboard photos, PCB, complex handwriting, AC/SPICE/transients, 3D editor, database/auth, video/voice streaming and multi-provider features lacking keys.
The canonical graph is mathematical truth after user review; breadboard coordinates/visual positions are input/view metadata. **Do not force schematic inputs into a virtual breadboard for computation.**

## Absolute-time execution and go/no-go gates — October 11 (PDT)

**Corrected deadline: 5:30 PM PDT.** Around 11:30 AM PDT there were approximately six hours remaining; these are wall-clock *targets* and must not be treated as evidence of feature completion. This schedule overrides the earlier T+65 / T+110 / T+150 / T+180 / T+210 gates.

| Time (PDT) | Owner / priorities | Required exit evidence |
|---|---|---|
| **11:30 AM–12:15 PM** | Claude reviews and merges Work frontend PR #4 if clean; production build/deploy and /api/health; no UI scope expansion | Real front page + lab on verified host; working backend sample |
| **12:15–1:30 PM** | Configure/test actual Gemini free-tier image+JSON and BeatAPI Jev; fix image→Jev→review→solve integration; prevent accidental paid API calls | One real clean photo yields confirmable candidate and deterministic 2.50 V; real Jev decision trace recorded |
| **1:30–2:45 PM** | Hard-case QA: ambiguous wire crossing, free-tier 429, manual correction; Groq free vision fallback **only if tested with real key and core flow already stable** | Two honest outcomes (clear/uncertain), human intervention, recovery; no fake provider trace |
| **2:45–3:30 PM** | Final accessible visual polish + 3-min demo story, note actual usage/latency and honestly unknown costs; audit sample/edit state | Demo rehearsable, no P0s introduced |
| **3:30 PM — FEATURE FREEZE** | Stop all feature/P1/P2 PRs and sponsor experiments. Only evidence-backed P0 fixes with regression + redeploy | Freeze candidate SHA, fix list and reviewers |
| **3:30–4:30 PM** | Production release QA: incognito, live Gemini/Jev, fallback, mobile, no-secret audit, source/build SHA, backup recording | Verified GREEN/AMBER/RED release evidence |
| **4:30–5:00 PM** | Submit by **5:00 PM PDT**, capture submitted links and success receipt; run final 3-min rehearsal | Proof of submission, backup ready |
| **5:00–5:30 PM** | **Contingency buffer only** (submission deadline is hard at 5:30 PM PDT); no optional changes | Time cushion for website/form issues |

**If a gate misses:** do not add scope. Preserve a functional sample/manual graph + numerical solver, state missing live-model capabilities honestly, and prioritize submission. Never treat unknown provider access as passing.

Anbaric trial had a 20-minute cap at initial kickoff; with the app already underway, **do not restart hosting experiments just because the schedule expanded**. Stay on any *verified working* host, use Vercel when Anbaric is not demonstrably reliable, and avoid free Render Python cold starts. Gemini/Jev key access and actual account allowance must be proved; no pay-as-you-go enabled without explicit user consent.

## PR path
Docs/contracts → parallel solver, Gemini, Jev, CI/QA PRs → API integration → Work UI PR → diagnostics → verified deployment. Each PR gets diff/security/CI review; author fixes via comments, Claude integrates. No direct main commits. At **3:30 PM PDT**, cancel P1/P2; only P0 regression fixes and retests.

## Release definition
Only mark **GREEN / freeze-ready** once docs/FREEZE_CHECKLIST.md P0 evidence includes exact deployed URL+SHA, real provider routes, verified numerical tests and public E2E. Documentation freeze is **not** product freeze. Update docs/CURRENT_STATE.md at each materially verified milestone.

## References
Gemini models/pricing: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
Jev quickstart: https://docs.typesafe.ai/introduction/quickstart
Next.js deployment: https://nextjs.org/docs/app/getting-started/deploying
