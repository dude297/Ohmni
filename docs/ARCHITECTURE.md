# Ohmni — Architecture and Deployment Decision

## Locked stack (ADR-001)
**Single deployable app:** Next.js 16 App Router + TypeScript/React/Tailwind/Zod, Node route handlers, SVG circuit viewer, Vitest. Pure TypeScript Modified Nodal Analysis (MNA) for resistors and independent DC voltage sources. No Python/FastAPI/Render backend, database, full CAD or SPICE today. Solver interface remains replaceable for future Python/ngspice.

## Runtime path
1. Browser sends bounded image to server; model-access-selected Gemini multimodal model extracts a **candidate**, not a verified netlist.
2. Structural/schema checks make text/JSON ambiguity summary. Jev System One makes a real typed decision from structured state: review_extraction / verify_topology / ask_user. Jev **does not process pixels or solve equations**; app code dispatches route.
3. verify_topology calls independent second vision provider **only** if tested and configured; otherwise requests user clarification. Hard structural invalidity overrides any model choice.
4. UI presents candidate and editable components/edges. User explicitly confirms. Backend validates submitted graph before solving.
5. MNA solver computes node voltages/currents from **reviewed graph**; detects floating/singular/inconsistent circuits.
6. User-provided measured voltage is compared to prediction. Diagnosis tests bounded alternate resistor/connection hypotheses and explains a safe next check. Treat hypothesis as unconfirmed.

## Representations (ADR-002)
**CircuitGraph** = canonical electrical nodes, component terminals, SI values. **VisualLayout** = coordinates/labels/source bounding boxes only; changing image coordinates cannot alter math. **BreadboardLayout** = standardized hole IDs, conductive row/rail groups, jumper endpoints; union-find maps holes/wires to electrical nodes. Components remain resistive/source edges between nodes. A schematic parser and virtual breadboard adapter both produce the graph; don't remap every schematic into breadboard holes. Arbitrary physical breadboard/PCB recognition is later research, NOT current product claim.

## Model access/routing (ADR-003)
Gemini free-tier **must be smoke-tested** for actual image+structured JSON on this key: try gemini-3.8-flash, gemini-3.6-flash, then any valid accessible image model. Set GEMINI_MODEL to proven ID; free pricing is not a quota guarantee. Jev via official TypeSafe System One endpoint from structured state; validate route output. Unavailable → manual clarify, explicitly not a real Jev success. Second provider only if authenticated and real call succeeds. Claude Code / ChatGPT Work development activity **does not count as product multimodel runtime**.

## Hosting (ADR-004)
Anbaric Cloud: up to 20-minute real Next.js Node/PORT test (public UI, health and route). If no proof, use a single Vercel deployment. Free Render sleeps and split deployment adds cold start/CORS risks. Sponsor audit/review integration is optional and cannot block the MVP.

## Safety / economics
Server-side keys only, <=5MB supported image upload, timeouts/limits/one specialist pass, redacted logs, no photo persistence by default, no unsafe mains/high-voltage guidance. Every runtime trace records **actual** provider/model/status/latency/usage if returned, and never fabricated confidence. Marginal costs estimated from measured tokens/provider rates; missing charges marked unknown. UI distinguishes model extraction, confirmation, prediction, measurement and hypothesis.

More: MODEL_ACCESS.md, API_CONTRACT.md, DEPLOY_AND_DEMO.md.
