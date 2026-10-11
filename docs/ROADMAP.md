# OHMNI NORTH STAR — 210-Minute Hackathon Launch

**Single authoritative plan.** Product: Ohmni. Date: October 11, 2026. Clock: T0 = actual development kickoff, not a fabricated wall-clock deadline. Owner: Claude Opus 5.5. UI owner: ChatGPT Work. Target branch: main, PRs only.

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

## Timeboxed execution / go-no-go gates

| Relative time | Claude/backend | Work/frontend | Mandatory gate |
|---|---|---|---|
| T+0–15 | Inspect repo, lock contracts, test Gemini/Jev keys, start 20-min Anbaric spike, delegate isolated PRs | Confirm tokens/layout, create frontend branch | Ownership/contracts recorded |
| T+15–65 | Solver, extraction, Jev and QA branches; route interfaces | Working attractive sample circuit lab | **T+65: 2.5 V solver verified** or cut breadth |
| T+65–110 | Real image → candidate → Jev → user review → solver | Connect real APIs, edits/ambiguities | **T+110: real image-to-solve** or stop features, repair |
| T+110–150 | Add mismatch diagnosis, second route, review/merge verified PRs | Responsiveness, truthful route timeline | **T+150: FEATURE FREEZE** |
| T+150–180 | Public deploy + real provider and negative smoke checks | Incognito/mobile QA | **T+180: verified URL** or NO-GO |
| T+180–210 | P0 fixes only, release evidence, costs, freeze verdict | Rehearse and capture recorded fallback | **T+210: evidence-based RED/AMBER/GREEN** |

Anbaric must pass a real Node/Next.js public UI/health/API deployment in its first 20-minute spike; otherwise switch to Vercel. **No separate free Render Python service**. If Gemini/Jev unavailable, retain manual netlist+solver and clearly mark **multimodel criterion not proven**; never present fixture traces as live.

## PR path
Docs/contracts → parallel solver, Gemini, Jev, CI/QA PRs → API integration → Work UI PR → diagnostics → verified deployment. Each PR gets diff/security/CI review; author fixes via comments, Claude integrates. No direct main commits. If T+150 arrives, cancel P1/P2; only P0 regression fixes and retests.

## Release definition
Only mark **GREEN / freeze-ready** once docs/FREEZE_CHECKLIST.md P0 evidence includes exact deployed URL+SHA, real provider routes, verified numerical tests and public E2E. Documentation freeze is **not** product freeze. Update docs/CURRENT_STATE.md at each materially verified milestone.

## References
Gemini models/pricing: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
Jev quickstart: https://docs.typesafe.ai/introduction/quickstart
Next.js deployment: https://nextjs.org/docs/app/getting-started/deploying
