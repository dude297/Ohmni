# The Living Schematic — post-submission experience

**Source status:** [#67](https://github.com/dude297/Ohmni/pull/67) was reviewed as an isolated post-submission draft, then merged as `da11efee` and included in [integration #69](https://github.com/dude297/Ohmni/pull/69), main `1ec8a79`. Original branch: `feat/living-schematic-post-submission`; baseline: `d2182e2a697a5bf8757fc36a980a76ff64a99225`. This document records that frontend change and its exact-build evidence, not a fresh production deployment or verification of later experiments. Its original Anbaric-primary/Vercel-fallback, provider, contract and solver behavior was preserved.

## Implemented visual experience

The homepage puts an oversized circuit instrument beside a confident two-line headline, 21 words of supporting copy and one primary **Try Ohmni** CTA. The beginner divider remains an interactive, explicitly local preview; changing R2 immediately changes its real calculation. Backend verification still requires review. Mobile puts the diagram before supporting prose while keeping keyboard actions in their DOM order. Repetitive marketing/roadmap cards are removed; audience limits remain labelled.

The four Lab stages and their state remain intact. **Try Ohmni** opens the beginner divider in unconfirmed Review; the visible advanced link opens the bridge. Component inspection is keyboard accessible; component values and connections start open before confirmation and remain collapsible. Compare places the real expected/measured numerals, signed gap and shared-scale bars beside one orthogonal schematic. The measured node is highlighted. On small screens the values arrive first and the instrument is a keyboard-focusable pan viewport; selecting a recommended node pans only that instrument, not the page. Raw events are preserved inside the trace disclosure.

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
| 0:20–0:55 | Explore the advanced bridge; inspect the diagram and initially open values; explicitly confirm | Eight components, three coupled nodes, prepared provenance, confirmation gate |
| 0:55–1:25 | Compare the reviewed circuit against a **labelled demo C=0 V** reading | Server MNA C≈2.609 V versus 0.000 V; real discrepancy and illuminated C |
| 1:25–2:25 | Probe Guide; select Advanced bridge, review, enter demo C=0, then the server-selected node's independently calculated R6-open scenario reading | Four plausible models recede to the returned leading R6-open model. No scripted recommendation or physical certainty |
| 2:25–3:00 | Show the actual reading trail, verification warning and expandable engineering evidence | Single-fault assumptions, safe physical follow-up, data provenance |

Use the known-good ladder (B=0, A=5, modeled R2 open) as an interactive fallback. Scenario inputs are synthetic demonstration observations; do not present them as live measurements.

## Validation and screenshot evidence

Verified application commit: `e1e97dd61ec0a924683e4d128a4dc0241044e05f`, against immutable baseline `d2182e2a697a5bf8757fc36a980a76ff64a99225`. Documentation follow-ups do not change the application validated at that commit.

- [Standard CI](https://github.com/dude297/Ohmni/actions/runs/38186787568): lint, fresh route/type generation, **169 unit tests** and production build passed.
- [Full Next production + real Chrome QA](https://github.com/dude297/Ohmni/actions/runs/38186787555): **302 feature checks / 58 baseline checks** passed at **320, 390, 768 and 1440px**, with both motion preferences, zero browser runtime errors and zero model calls.
- [Authoritative before/after artifact](https://github.com/dude297/Ohmni/actions/runs/38186787555/artifacts/11719518069): homepage, basic comparison, advanced Lab entry/comparison and Probe Guide screenshots at 390/1440px with both motion preferences, plus all-width results. Actual screenshots were inspected, including label clearance from other labels and physical wires. Artifact retention is 14 days; download to preserve the evidence.

Earlier local checks render actual components and genuine solve/probe handlers with lightweight Next navigation adapters and fallback fonts. They are **component-level preflight**, not hosted-release proof. [living/local-browser](living/local-browser) contains the earlier validated 294-check iteration and captures; [living/before](living/before) precedes main's loaded-bridge addition. These committed local images do not show the final VIN/GND spacing; the exact-build full-app artifact above is authoritative. The broader guided workflow also passed 131 local regression assertions.

`scripts/living-ui-smoke.mjs` runs against a target application's real routes at 320, 390, 768 and 1440px with both motion preferences. It verifies confirmation, actual API values, exact rendered terminals, nonoverlapping labels, visible comparison values, graph-edit invalidation, actual recommended-node highlighting, posterior narrowing, safety and no model calls. `scripts/guided-ui-smoke.mjs` retains broader retry/extraction-fixture/regression checks. Unit tests cover independent bridge conservation and fallback protection.

`.github/workflows/living-schematic-qa.yml` is **QA-only and restricted to this feature branch**. It builds the immutable PR base and the feature with Next, runs real Google Chrome against each isolated production-mode server, and saves paired screenshots/results as `living-schematic-before-after`. Browser tooling installs only into runner temporary storage. It has read-only repository permissions, no secrets and no deployment step. The baseline shows the previously available loaded bridge in Probe Guide and the absence of an advanced Lab entry.

The Windows Next build was blocked before application compilation by the native SWC canonical-path access error. Fresh Linux type generation, build and full-app Chrome QA subsequently passed as linked above. These tests do not establish deployment parity, live-provider availability or coverage of the later integration routes. Source merge status is recorded above; review/merge is not hosted acceptance.

No new application runtime packages were added. Homepage, Lab and Probe remain prerendered. In the isolated QA runner the feature compiled in 3.8s versus 3.5s for the baseline; this is a build observation, not a browser-performance benchmark.

## Hosted verification and remaining review scope

This frontend PR did not change hosting configuration or request a production deployment; the existing Vercel integration created branch previews. This documentation pass did not recheck current production. Do not substitute its local/CI screenshots for hosted-release evidence. The QA job does not verify authenticated Anbaric, provider quotas, live extraction or physical measurements. Native hypothesis-row motion is limited to true probability transforms and deemphasis. Photo morphs, AC/transients, arbitrary PCB inference and continuous current flow were outside this frontend PR; later standalone experiments have their own notes in [the index](../README.md).

The original independent review scope covers canonical fixture integration, drawing-to-terminals correspondence, numeric/probe claims, mobile pan/focus, confirmation/tutor gates and full-app artifacts. Frontend findings return to the owning author. The subsequent merge does not extend these tests to the other integrated experiments or authorize a new deployment in this documentation pass.

## Prelint follow-up

The owner explicitly authorized Prelint while [#67](https://github.com/dude297/Ohmni/pull/67) was draft. Final technical review on the verified application commit is **LGTM**; product decision review is **Ship with changes**. The three earlier disagreements are corrected: beginner-first primary CTA, visible upload/advanced links and values open before confirmation. The advanced Capture preview remains available. Full-app font collisions and the ground-label contact with a wire were corrected and are covered by the loaded-font clearance assertions.

Remaining product recommendations concern explanations for generic-layout fallback, consistency of prepared-fixture review gates, upload-link prominence while retaining one primary CTA, and an always-visible provenance summary. Full execution evidence intentionally remains inside the trace disclosure; actual events are preserved and the visible summary shows their count. This documentation pass does not implement those recommendations or perform any production deployment.
