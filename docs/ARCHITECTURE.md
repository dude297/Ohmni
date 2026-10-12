# Ohmni — Architecture and Deployment Decision

## Locked stack (ADR-001)
**Single deployable app:** Next.js 16 App Router + TypeScript/React/Tailwind/Zod, Node route handlers, SVG circuit viewer and Vitest. Core DC Modified Nodal Analysis (MNA) remains pure TypeScript for resistors and independent DC voltage sources. No split Python/FastAPI service, database or full CAD system. The merged experiments add a Three.js/React Three Fiber virtual breadboard and a separate worker-isolated ngspice frequency-response sandbox; they do not replace the core DC solver.

## Runtime path
1. Browser sends a bounded image to the server. Groq extracts a **candidate**, not a verified netlist; supported failure classes allow one Gemini fallback. `VISION_PRIMARY=gemini` reverses the order. Prepared samples skip image models.
2. Structural/schema checks make text/JSON ambiguity summary. Jev System One makes a real typed decision from structured state: review_extraction / verify_topology / ask_user. Jev **does not process pixels or solve equations**; app code dispatches route.
3. `verify_topology` dispatches the configured Groq verifier; unavailable verification requests clarification. Hard structural invalidity overrides any model choice. A current code path is not proof of a live route: the recorded Groq-primary demo demonstrates `review_extraction` and `ask_user`, while its topology-verification observation is historical.
4. UI presents candidate and editable components/edges. User explicitly confirms. Backend validates submitted graph before solving.
5. MNA solver computes node voltages/currents from **reviewed graph**; detects floating/singular/inconsistent circuits.
6. User-provided measured voltage is compared to prediction. Diagnosis and Probe Guide test their bounded modeled hypotheses and explain a safe next check. Probe posteriors are model-relative, not calibrated physical fault rates. Treat each hypothesis as unconfirmed.

The Lab preserves **Capture → Review → Compare → Investigate**. Editing a confirmed circuit invalidates confirmation and clears prior analysis. The server MNA implementation supports reviewed resistive networks; the optional browser fallback supports only the divider. The homepage divider is explicitly a local preview. The prepared advanced bridge requires server MNA.

## Representations (ADR-002)
**CircuitGraph** is the implemented canonical DC representation: electrical nodes, component terminals and SI values. Visual coordinates and labels cannot alter mathematics. The experimental [breadboard model](BREADBOARD_MODEL.md) maps explicit hole IDs, conductive strips and jumper endpoints into that graph; visual proximity never establishes a connection. `/studio` uses synthetic virtual placements, not recognized photographs. Arbitrary physical breadboard/PCB recognition remains unimplemented. The AC sandbox uses a separate bounded graph type.

## Model access/routing (ADR-003)
The source default is Groq-first (`visionOrder()` in `src/lib/ai/vision.ts`), with one Gemini fallback for the enumerated failures. Other errors return manual recovery. `geminiModel()` defaults to `gemini-3.5-flash`; the dated hosted evidence records an explicit `gemini-3.5-flash-lite` override. The tutor separately reads `EXPLAIN_MODEL`. Provider availability and account access require actual smoke evidence, not assumptions from a model ID.

Jev `jev-1.13-free` uses the BeatAPI gateway (`https://api.beatapi.io/v1/systemone`) with structured state, one routing decision per analysis and paced calls. Other Jev IDs are refused. Unavailable or skipped routing is reported honestly and falls back to clarification. Both vision outputs pass the same schema and structural checks. Two models agreeing is **not** proof of electrical correctness. Development-time Claude Code / ChatGPT Work activity is not product runtime. These code settings do not verify provider billing accounts. See [model evidence](MODEL_ACCESS.md).

## Hosting (ADR-004)
Anbaric Cloud is primary; Vercel is the public fallback. Both serve the single Next application. Anbaric requires signed-in access; dated deployment-source reports do not replace runtime build and browser verification. See [deployment notes](ANBARIC_DEPLOYMENT.md) and [release evidence](RELEASE_E2E_2026-10-11.md). No split Python service or additional hosting target is introduced. The post-submission branch can receive an automatic Vercel preview without changing production.

## Safety / economics
Server-side keys only, <=5MB supported image upload, timeouts/limits/one specialist pass, redacted logs, no photo persistence by default, no unsafe mains/high-voltage guidance. Every runtime trace records **actual** provider/model/status/latency/usage if returned, and never fabricated confidence. Marginal costs estimated from measured tokens/provider rates; missing charges marked unknown. UI distinguishes model extraction, confirmation, prediction, measurement and hypothesis.

## Other server pieces
`src/proxy.ts` now applies per-IP limits to every implemented POST API: extract, solve, explain, probe, topology, review, AC, repair, repair verification, twin and firmware ADC. Limits remain in memory per instance; AC also has a queue/worker timeout. `POST /api/probe` defaults to single-fault ranking without model calls and is connected in Lab and `/probe` ([Probe Guide](MOONSHOT.md)). The optional tutor and review mentor make explicit model requests with solver grounding. The topology endpoint has no dedicated connected user flow.

## Merged post-submission integration

[Merged #67](https://github.com/dude297/Ohmni/pull/67) adds the Living Schematic presentation and Advanced bridge in Lab. It reuses `LOADED_BRIDGE_12V`, clones it for editable Lab state, and renders the custom orthogonal layout only while terminals match. Value edits preserve the layout; topology edits use the generic renderer. Confirmation and results still invalidate. That frontend change made no API/provider/solver changes; its [exact-build QA](ui-review/LIVING_SCHEMATIC.md) predates the wider [#69 integration](https://github.com/dude297/Ohmni/pull/69).

The integration also contains Learn/Build/Teams, typed/voice repair, virtual breadboard, netlist/observed-graph comparison, review/mentor, firmware ADC and evidence-import prototypes. AC uses `eecircuit-engine` in a worker to isolate its browser-like globals, generates netlists from a validated typed graph, and never executes arbitrary pasted SPICE. Two-fault probing is a separate library; default probe behavior remains single-fault. Teams is browser-only packet review, not a shared backend. Consult [current state](CURRENT_STATE.md) and individual module notes for experimental limits and hosted checks still needed.

More: [API contract](API_CONTRACT.md), [deploy and demo](DEPLOY_AND_DEMO.md), [documentation index](README.md).
