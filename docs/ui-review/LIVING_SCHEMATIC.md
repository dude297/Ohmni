# The Living Schematic — post-submission experience

**Release hold:** this is an isolated post-submission feature, not authorization to merge into or redeploy the October 11 hackathon release. Branch: `feat/living-schematic-post-submission`. Baseline: `d2182e2a697a5bf8757fc36a980a76ff64a99225`. Claude remains independent reviewer; the frontend author owns corrections. Anbaric primary, Vercel fallback, providers, contracts and solver mathematics are preserved.

## Implemented visual experience

The homepage puts an oversized circuit instrument beside a confident two-line headline, 21 words of supporting copy and one primary **Try Ohmni** CTA. The beginner divider remains an interactive, explicitly local preview; changing R2 immediately changes its real calculation. Backend verification still requires review. Mobile puts the diagram before supporting prose while keeping keyboard actions in their DOM order. Repetitive marketing/roadmap cards are removed; audience limits remain labelled.

The four Lab stages and their state remain intact. **Try Ohmni** opens the prepared bridge in unconfirmed Review. Component inspection is keyboard accessible; advanced edit forms are disclosed on demand. Compare places the real expected/measured numerals, signed gap and shared-scale bars beside one orthogonal schematic. The measured node is highlighted. On small screens the values arrive first and the instrument is a keyboard-focusable pan viewport; selecting a recommended node pans only that instrument, not the page. Raw events are preserved inside the trace disclosure.

Probe Guide gives the schematic visual priority. Actual API probabilities drive bar scales and deemphasis below 1%; rows are not labelled impossible. The actual recommended node receives one focus ring. Reading history, expected outcomes, model-relative uncertainty and safety remain available. The conclusion names the returned leading model or unresolved tie. The optional tutor is progressively disclosed and the advanced graph requires explicit review before either probe or tutor requests. No calls are duplicated or automatically replayed by a visual effect.

## Canonical advanced graph and verified scenario

Reuse the backend-owned `LOADED_BRIDGE_12V` fixture introduced independently on main. The frontend clones it for editable Lab state; Probe Guide keeps its existing `loaded-bridge` key and fixture identity, with one **Advanced bridge** entry. No duplicate canonical graph, solver or predetermined next-node script is shipped.

| Component | Value | Positive → negative |
| --- | --- | --- |
| V1 | 12 V | VIN → GND |
| R1 | 1 kΩ | VIN → A |
| R2 | 2 kΩ | A → GND |
| R3 | 1.5 kΩ | VIN → B |
| R4 | 1 kΩ | B → GND |
| R5 | 3.3 kΩ | A → B |
| R6 | 680 Ω | B → C |
| R7 | 1.2 kΩ | C → GND |

Healthy targets: **A 7.342 V, B 4.087 V, C 2.609 V**. Independently remove R6 and solve again: **A 7.533 V, B 5.220 V, C 0 V**. These are verification references, never hardcoded display results. The existing backend independently tests its own nodal calculation and the modeled 1 GΩ approximation to an open branch. Frontend tests add KCL, exact branch removal, edited-topology layout protection and refusal of the divider-only fallback.

The actual probe model starts from a demo C=0 V observation, retains four leading modeled faults, selects **A** (2.00 estimated bits in the verified fixture), and narrows to **R6 open** after the corresponding scenario reading near 7.533 V. The UI reads the recommendation and posterior from the server; these details belong to the fixture demonstration, not a guaranteed diagnosis of physical hardware. No measurement acquisition or image extraction is implied by prepared examples.

The orthogonal drawing is enabled only when all component IDs, kinds and terminals match the canonical topology. Value edits preserve the drawing; connection edits switch to the existing graph renderer and clear confirmation/results. Every component retains its real endpoints as inspection metadata. No diagonal crossings are added to imply new nodes.

## Design and motion specification

| Token / behavior | Rule |
| --- | --- |
| Ivory | `#f6f5f0`, quiet page surface |
| Deep teal | `#142c32`, instrument canvas and primary controls |
| Amber | `#f2b45a`, selected component / current measurement target |
| Sage | `#b7d8c4`, actual calculated labels on dark canvases |
| Red | `#863b2a` on `#fff0e9`, meaningful mismatch; textual verdict remains |
| Typography | Geist headings and text; Geist Mono for numerical evidence; labelled units |
| Microinteraction | 140ms part response |
| Stage / posterior | Existing 200ms directional stages; 220ms probability-bar transform and deemphasis |
| Node focus | 260ms scale/opacity lock; internal pan only |
| Evidence / hero | Actual paths reveal in 450ms / 650ms; hero enters in 450–600ms |
| Reduced motion | Final values and geometry immediately; no running animations or smooth internal pan |

No animation package, new runtime dependency, endless electrical ticker, synthetic progress or interpolated fictitious solver state is added. Current-direction animation is deferred until separately verified. Keyboard inspection, focus return, safety and confirmation work without animation.

## Three-minute visual-first storyboard

| Time | Scene / action | Evidence to show |
| --- | --- | --- |
| 0:00–0:20 | Homepage; set tutorial R2 to 1 kΩ, then return to 10 kΩ | Real local 0.455 / 2.500 V; **LOCAL PREVIEW**, no model call |
| 0:20–0:55 | Try Ohmni; inspect the bridge and open values if needed; explicitly confirm | Eight components, three coupled nodes, prepared provenance, confirmation gate |
| 0:55–1:25 | Compare the reviewed circuit against a **labelled demo C=0 V** reading | Server MNA C≈2.609 V versus 0.000 V; real discrepancy and illuminated C |
| 1:25–2:25 | Probe Guide; select Advanced bridge, review, enter demo C=0, then the server-selected node's independently calculated R6-open scenario reading | Four plausible models recede to the returned leading R6-open model. No scripted recommendation or physical certainty |
| 2:25–3:00 | Show the actual reading trail, verification warning and expandable engineering evidence | Single-fault assumptions, safe physical follow-up, data provenance |

Use the known-good ladder (B=0, A=5, modeled R2 open) as an interactive fallback. Scenario inputs are synthetic demonstration observations; do not present them as live measurements.

## Validation and screenshot evidence

Local browser checks render actual components and genuine solve/probe handlers with lightweight Next navigation adapters and fallback fonts. They are **component-level preflight**, not full production proof. Local evidence is in [living/local-browser](living/local-browser); baseline captures are in [living/before](living/before). The local browser folder contains 278 passing assertions and current after captures at 390 and 1440px with both motion preferences. Earlier local baseline screenshots precede main's loaded-bridge addition; authoritative paired baseline/after screenshots come from the isolated CI job.

`scripts/living-ui-smoke.mjs` runs against a target application's real routes at 320, 390, 768 and 1440px with both motion preferences. It verifies confirmation, actual API values, exact rendered terminals, nonoverlapping labels, visible comparison values, graph-edit invalidation, actual recommended-node highlighting, posterior narrowing, safety and no model calls. `scripts/guided-ui-smoke.mjs` retains broader retry/extraction-fixture/regression checks. Unit tests cover independent bridge conservation and fallback protection.

`.github/workflows/living-schematic-qa.yml` is **QA-only and restricted to this feature branch**. It builds the immutable PR base and the feature with Next, runs real Google Chrome against each production server, and saves paired screenshots/results as `living-schematic-before-after`. Browser tooling installs only into runner temporary storage. It has read-only repository permissions, no secrets and no deployment step. The baseline shows the previously available loaded bridge in Probe Guide and the absence of an advanced Lab entry. Workflow status/artifact links belong in the PR description once executed.

Local lint/typecheck and unit/browser results are reported in the PR. Local Next build remains blocked before application compilation by the existing Windows SWC canonical-path access error; fresh Linux build/type generation and full-app Chrome checks must pass before acceptance.

## Remaining undeployed / review scope

This experience is not deployed to Anbaric or Vercel. Do not substitute its local/CI screenshots for current production evidence. The QA job does not verify authenticated Anbaric, provider quotas, live extraction or physical measurements. Native hypothesis-row motion is deliberately limited to true probability transforms and deemphasis; photo morphs, AC/transients, arbitrary PCB inference and continuous current flow remain out of scope.

Claude should independently review the canonical fixture integration, drawing-to-terminals correspondence, numeric/probe claims, mobile pan and focus, confirmation/tutor gates and full-app artifacts. Valid findings return to the frontend author for corrections and re-review. Keep this PR out of the submission release.
