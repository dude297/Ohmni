# Cinematic UI/UX audit: brief for ChatGPT Work

**Scope:** `/`, `/lab?sample=divider` (Capture → Review → Compare → Investigate), `/probe`, `/for-the-larp`. Read-only audit. No `src/**` changes in this PR.
**Build:** `main` @ `9b3f777`, prod https://multimodal-hackathon-sage.vercel.app. Audited 2026-10-11, about 2:35–2:55 PM PDT.
**Method:** I read the code on main. I drove prod with Playwright (Chromium, installed outside the repo in `%TEMP%\ohmni-e2e`) at 1440×900, at 390×844, and with `reducedMotion: "reduce"`. I measured FCP/LCP/CLS with PerformanceObserver and JS bytes from `/_next/static` resource timing, and recorded focus order over 14 Tab presses. Only the sample paths and the model-free `/api/solve` and `/api/probe` were called. `/api/extract` was blocked with `page.route(...abort)`.
**Screenshots** are in `%TEMP%\ohmni-e2e\cine\` (not committed). Names are `<page>-<d|m>-<anim|rm|full>.png`, plus `lab-review-*`, `lab-compare-*`, `lab-investigate-*`, `lab-probe-*` and `probe-step-*-full.png`.

**Baseline measurements (prod):**

| Route | FCP / LCP (warm) | LCP element | CLS | JS (enc / dec) | Notes |
|---|---|---|---|---|---|
| `/` | 308 / 308 ms (cold first hit: TTFB 2818 ms, LCP 3464 ms) | `H1` | 0 | 169 / 540 KB, 9 files | No running animations |
| `/lab?sample=divider` | 84 / 172 ms | `H1` | 0 | 169 / 540 KB | `/api/solve` round trip about 0.9–1.4 s |
| `/probe` | 184 / 184 ms | `H1` | 0 | 183 / 578 KB | Only animation is `pg-pulse` |
| `/for-the-larp` | 380 / 380 ms | `P` | 0 | 202 / 649 KB | No animation |

There is no horizontal scroll at 390 px on any route, and no console errors. Performance is not a problem. The one exception is the cold-start TTFB on `/`: open the homepage once before the demo to warm it.
**Overall:** the design is calm and credible, but it is **static**. Running `document.getAnimations()` gives 0 on every route except the probe pulse. The solver results are the product's best evidence, and they appear as plain text swaps. The gap is not about adding motion everywhere. It is about making the *solved* numbers arrive, connect to the circuit and resolve.

---

## P0: usability and correctness defects (fix first, all small)

**P0-1 · `measurement-comparison.tsx`: the expected-vs-measured chart scales up to giant text and pushes the verdict below the fold**
- *Evidence:* `lab-compare-d.png`. The SVG `viewBox="0 0 280 108"` stretches to 756 px wide, about 2.7× scale. "PREDICTED / 2.500 V" renders at about 26 px caps and the bars are about 32 px tall. The component is 357 px tall, and `.mismatch-card` (the actual verdict) starts at y=1082 in a 900 px viewport. On mobile it is 294 px wide with 9 px labels.
- *Fix:* add `.measurement-comparison svg { max-width: 420px; width: 100%; height: auto; }`, or replace the SVG text with HTML labels and keep the SVG only for the bars. Also add `.comparison-heading span { font-size: 11px }`.
- *Benefit:* the hero comparison and the verdict fit on one screen. *Risk:* very low (CSS only).
- *Accept:* at 1440×900, after "Analyze & compare", `.mismatch-card` top is under 900 px and the comparison is 160 px tall or less. No text in the comparison is under 11 px or over 20 px.

**P0-2 · `circuit-view.tsx` on light surfaces: solved node voltages and node names are effectively invisible**
- *Evidence:* the `.circuit-node .node-reading` fill is `#e0ebe4` and the node `text` fill is `#abc0b9`. Both are designed for the dark hero card. CircuitView is also rendered on `#ffffff80` in `.circuit-preview` (lab sidebar, `lab-compare-d.png`) and on white in `/probe` (`probe-d-anim.png`). The VIN/VOUT/GND voltages in the lab preview cannot be read, so the persistent circuit hides the solver result.
- *Fix:* add `.circuit-preview .circuit-node text, .pg-panel .circuit-node text { fill: #3d5450 } .circuit-preview .node-reading, .pg-panel .node-reading { fill: #173b35; font-weight: 600 }`, and match `.part-value`. Alternatively, give those containers the dark instrument background `var(--ohmni-dark)`.
- *Accept:* in lab preview and `/probe`, node labels and readings meet a WCAG contrast of 4.5:1 or better against their background. Check with DevTools contrast.

**P0-3 · `circuit-view.tsx` generic ring layout: R1 is drawn exactly under R3 in the `/probe` "Resistor ladder"**
- *Evidence:* `probe-d-anim.png`. In the ring layout, VIN–A and B–GND share a midpoint, so the R1 and R3 symbols overlap. The labels show as "R3" over "R1", and R1 seems to be missing. The caption also says "select a component", but no `onSelect` is passed in `/probe`.
- *Fix (fastest):* in `/probe` (`probe-client.tsx`), **remove the generic `<CircuitView graph={graph} />`**. The page already renders the correct `ProbeSchematic` directly below it, so it currently shows two diagrams of the same circuit. If the generic view is kept anywhere, nudge any component whose midpoint is within 20 px of another's by a perpendicular offset of 28 px.
- *Accept:* `/probe` shows exactly one diagram. All 3 resistors and V1 are distinguishable on every circuit tab.

**P0-4 · `globals.css` / `lab-workspace.tsx`: microtype in the evidence path**
- *Evidence:* `.result-card .eyebrow` is **8 px** and `.comparison-heading span` is 9 px. The hypothesis body text in `lab-probe-d.png` is about 10 px, and `.circuit-preview .text-button` is 10 px.
- *Fix:* set a floor of 11 px for any text that carries meaning, with eyebrows at 11 px and `letter-spacing: .12em`.
- *Accept:* `[...document.querySelectorAll('main *')].filter(e => e.innerText?.trim() && parseFloat(getComputedStyle(e).fontSize) < 11)` returns nothing in `/lab`.

---

## P1: high-impact, low-risk cinematic refinements (the core of this brief)

Motion rules for every item: 250 ms or less, `cubic-bezier(.2,.8,.2,1)` (ease-out), `transform`/`opacity`/`stroke-dashoffset` only, and everything inside `@media (prefers-reduced-motion: no-preference)`. The existing global reduce rule at `globals.css:2006` already zeroes out animations, so reduced motion falls back to the final state with no extra work.

**P1-1 · Expected-vs-measured as the hero moment (`measurement-comparison.tsx`, `lab-workspace.tsx` compare section)**
- *Issue:* "2.500 V" (45 px) sits alone in `.result-card`. The 0.450 V reading appears only inside the oversized chart and a 13 px sentence. The *gap* between the two values, which is the whole story, is never shown as a number.
- *Proposal:* make one row of two equal tabular numerals: `EXPECTED 2.500 V` and `MEASURED 0.450 V`, both at `font-size: clamp(36px,4vw,52px); font-variant-numeric: tabular-nums`. Put a centered **Δ −2.050 V (−82%)** chip between them, amber when there is a mismatch and green when the values match. Under the numerals, draw the two shared-scale bars (from P0-1) with `transform: scaleX()` growing from 0 to 1 over 220 ms. The measured bar starts 60 ms after the expected bar.
- *Benefit:* a judge sees "predicted vs reality" in under one second. *Risk:* low (presentational only, the data already exists).
- *Accept:* after Analyze, both numbers and the Δ chip are in the first viewport at 1440×900 and 390×844. With reduced motion, the bars render at their final width immediately.

**P1-2 · Node voltages settle from the solver result (`circuit-view.tsx` `.node-reading`)**
- *Issue:* readings change by text swap. On the hero slider, VOUT jumps from 2.500 to 0.455 with no sense of cause.
- *Proposal:* `useCountUp(value, 200ms)`. A requestAnimationFrame tween from the previous value to the new one, about 12 lines and no library. Apply it to `.node-reading` and to the hero `PREDICTED VOUT`. Add a 1-frame `opacity:.4 → 1` on the label that changed. Animate only when the value comes from a real solve or slider change, never on first paint. **Do not fake intermediate solver states.** The tween only interpolates between two real results.
- *Accept:* moving the hero slider animates VOUT in 220 ms or less. The final text equals `result.voltages.VOUT.toFixed(3)`. With reduced motion, the value appears instantly.

**P1-3 · Current flow along the real solved branches (`circuit-view.tsx` `.circuit-wire`)**
- *Issue:* the wires are static grey. `result.currents` is computed but shown only in a collapsed `<details>` labelled "Component currents".
- *Proposal:* when `result` exists, overlay each component's wire segment with a second path: `stroke: #f2b45a; stroke-dasharray: 2 10; animation: flow var(--dur) linear infinite`, with `@keyframes flow { to { stroke-dashoffset: -12 } }`. Set `--dur` from the real magnitude: `clamp(0.6s, 0.25mA/|I| * 1s, 4s)`. Use `animation-direction: reverse` when I < 0 so the direction follows the graph's +→− convention, and draw no overlay when |I| < 1 µA, so an open branch is visibly dead. For the divider, split the single `.circuit-wire` path (`circuit-view.tsx`) at the VIN, VOUT and GND junctions so that each component owns its own segment.
- *Benefit:* this is the "animated circuit evidence" that a static diagram cannot fake. In the probe ladder, a "R2 open" fault would show flow stopping. *Risk:* medium-low (SVG/CSS only, with an isolated overlay layer).
- *Accept:* with `R2=1kΩ` the R1/R2 dashes move about 5× faster than at 10 kΩ. No dashes appear when there is no `result`. Under reduce, `document.getAnimations().length === 0`.

**P1-4 · Stage transitions in the guided lab (`lab-workspace.tsx` `.guided-frame`, `globals.css:2306`)**
- *Issue:* stages swap with `hidden`, so the change is instant. Focus does move correctly to the `h2`, which is good and should be kept.
- *Proposal:* `.guided-frame:not([hidden]) { animation: stage-in 200ms cubic-bezier(.2,.8,.2,1) }`, with `@keyframes stage-in { from { opacity:0; transform: translateX(calc(var(--dir,1) * 12px)) } }`. Set `--dir: -1` on the frame when you go back. Also animate the active `.guided-steps` pill: a `::after` underline with `transform: scaleX` over 180 ms.
- *Accept:* forward and back each show a 12 px directional slide in 200 ms or less. Focus still lands on the stage `h2`. CLS stays at 0.

**P1-5 · Sample deep link should land on Review (`lab-workspace.tsx`, initial `stage`)**
- *Issue:* `/lab?sample=divider` (the homepage primary CTA) opens on **Capture** (`lab-d-anim.png`), with the sample already loaded and an upload zone as the dominant element. The user needs an extra "Next step" click before seeing anything that relates to the circuit.
- *Proposal:* `useState<Stage>(params.has("sample") ? "review" : "capture")`. Add a one-time 200 ms highlight pulse on the Review pill.
- *Accept:* from the homepage, "Try sample circuit" shows the Review stage with circuit values. Reaching the comparison takes 3 clicks: confirm, Next, Analyze. That path can be rehearsed.

**P1-6 · Analyze result reveal and scroll anchoring (`lab-workspace.tsx` `solve()` / `.analysis-status`)**
- *Issue:* after "Analyze & compare", the result appears at y=548. On mobile the comparison starts at y=842 of 844, so the payoff is off-screen. The button press gives no motion feedback beyond the spinner.
- *Proposal:* on result, `statusRef.current.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })` with `scroll-margin-top: 90px`. This is a single programmatic scroll to the answer, not scroll-jacking. Fade in `.result-card` and then the comparison at 0 and 80 ms (180 ms each).
- *Accept:* at 390×844, after Analyze, the expected and measured numerals are both visible without manual scrolling.

**P1-7 · Probe: next node is the one obvious thing (`app/probe/guide-overlay.tsx`, `probe-client.tsx`)**
- *Issue:* `probe-step-d-full.png`. The "Put the red probe here; black probe on GND" callout overlaps the `A` label and the R1 wire. The "MEASURE NEXT" card on the right is in a different column from the schematic, so on desktop the eye has to jump about 600 px.
- *Proposal:* anchor the callout above or right of the node with a 12 px leader line, so it never covers the node label. When `result.next.node` changes, transition the ring with `transform: scale(1.4)→1` and `opacity: 0→1` over 220 ms (a "focus lock"), and keep the existing pulse. Repeat the node pill color (`--ohmni-accent`) on the schematic node label so card and diagram read as one.
- *Accept:* no overlap between the callout box and any node label (bounding boxes do not intersect). The ring re-animates on each new `next.node`.

**P1-8 · Probe outcomes: "what each reading would mean" resolves after submit (`probe-client.tsx` `.pg-outcomes`, `.pg-bars`)**
- *Issue:* after a reading, the outcome list and hypothesis bars are replaced wholesale. The user can't see *which* hypotheses were eliminated by their reading.
- *Proposal:* key bars by `h.id` so `.pg-fill`'s existing `transition: width .3s` actually animates. Shorten it to 220 ms ease-out. Hypotheses that drop to under 1% keep their row for one render with `opacity:.35; text-decoration: line-through` before they leave. In the outcomes list, mark the band matching the user's reading with a `✓ matched` tag.
- *Accept:* submitting `A = 0` on the ladder visibly shrinks the eliminated bars over 220 ms or less. The matched outcome row is marked.

**P1-9 · Probe conclusion as a closing beat (`probe-client.tsx` `.pg-done`, lab `probe-guide.tsx` `.probe-conclusion`)**
- *Issue:* the diagnosis is a small green box in the same style as a warning. In the lab divider demo, the guide concludes straight away with "MODEL RESULT · VERIFY PHYSICALLY" (`lab-probe-d.png`), and the two tied hypotheses (50/50) are rendered as plain list rows.
- *Proposal:* use a conclusion card with a 20 px title ("Most consistent: R2 is 1 kΩ, not 10 kΩ"), the reading trail as chips (`B = 0 V → A = 2.5 V`), and the tied/ambiguous state stated explicitly ("2 faults fit equally; check with an ohmmeter, power off"). Fade it in over 200 ms. Keep the "verify physically" safety line.
- *Accept:* the end state names the top hypothesis (or the tie), lists the readings that led there, and shows the safety copy.

**P1-10 · Homepage first five seconds (`hero-circuit.tsx`, `globals.css` `.hero-instrument`)**
- *Issue:* `home-d-anim.png`. The hero is strong, but the instrument is cut at the fold. "Verify sample with backend" sits at y≈880 of 900 and the card is rotated. The circuit is inert until the user drags the slider, so the product's "solved numbers" story isn't seen in five seconds.
- *Proposal:* (a) on first load, run one *real* local solve sweep: R2 animates 10 kΩ→1 kΩ→10 kΩ over about 1.2 s total, once, through the existing `changeResistance` path, with VOUT settling via P1-2 and current dashes via P1-3. Stop on any user input. Skip it under reduced motion. (b) Tighten `.hero-instrument` vertical padding about 16 px so the Verify button is above the fold at 1440×900.
- *Accept:* without interaction, within 3 s of load, VOUT visibly goes 2.500 → 0.455 → 2.500 V. The Verify button is fully visible at 1440×900. Reduced motion shows a static 2.500 V.

**P1-11 · `/for-the-larp` pipeline and MNA viz (`under-the-hood.tsx` `Pipeline`, `Matrix`)**
- *Issue:* `larp-d-anim.png`. The pipeline SVG is static, and the dashed "on failure" arrow cuts diagonally across the Normalize box. The MNA table colors blocks, but it doesn't link a matrix cell to the component that stamped it.
- *Proposal:* on stage select, animate the *path into* the selected box (`stroke-dashoffset` from path length to 0 over 240 ms). Re-route the dashed fallback arrow orthogonally so it no longer crosses the Normalize box. In `Matrix`, hovering or focusing a `G` cell highlights the same component on the topology view above it, with a shared `data-comp` attribute and a CSS `:has()` selector. For 2-node G entries, show `1/R1 + 1/R2` as a title.
- *Accept:* selecting "MNA solver" draws its incoming edge in 240 ms or less. Hovering G[VOUT,VOUT] highlights R1 and R2.

---

## P2: expensive or risky experiments (after the hackathon)

- **P2-1 · Photo-to-graph morph** (`lab-workspace.tsx` capture→review): crossfade the uploaded schematic into the extracted graph, with nodes "lifting" from their bounding boxes. This needs extraction coordinates the API does not return today. *Risk:* high.
- **P2-2 · Instrument-panel dark mode for the whole lab**, so CircuitView lives in its native dark palette everywhere. It would also remove the need for the P0-2 overrides. *Risk:* a wide CSS change across about 2.4k lines of `globals.css`.
- **P2-3 · Live "what-if" scrubbing in Review**: drag any resistor value and see node voltages and current dashes update per frame via the local solver. *Risk:* MNA solve per frame on larger graphs, and it has to stay clearly labelled "local preview".
- **P2-4 · Shared-element transition** of the circuit from homepage hero to `/lab` (View Transitions API, `view-transition-name: circuit`). *Risk:* Next App Router support and browser coverage.
- **P2-5 · Probe "bisection tree"**: draw the remaining hypothesis set as a shrinking tree as readings arrive. *Risk:* new layout work, and it gets cluttered with more than 8 hypotheses.

## Accessibility notes (verified)

- Focus order is logical on all 4 routes. The lab moves focus to the stage `h2` on transition. SVG components are `role=button` with a stroke focus style (not an outline, which is acceptable). The `:focus-visible` outline is 3 px amber.
- Reduced motion: the global rule (`globals.css:2006`) kills all animation and transition, and `.scroll-reveal` content is forced visible. That is verified: with `reducedMotion: reduce`, getAnimations is 0 on every route. Note that this also stops spinners, so keep the text labels ("Solving circuit…").
- `/probe`: the whole "Next probe" section is `aria-live="polite"`, so every result re-announces the entire panel. Narrow it to the `MEASURE NEXT` heading and the conclusion.

## Suggested implementation order for ChatGPT Work before 3:30 PM (about 45 min)

1. **P0-1 + P0-4** (10 min, CSS only): fix comparison scale and the 11 px type floor. Safest and most visible.
2. **P0-2** (5 min, CSS only): make lab-preview and probe node voltages readable.
3. **P1-5** (3 min, one line): `?sample=` lands on Review, which shortens the demo path.
4. **P1-1** (12 min): expected vs measured numerals plus the Δ chip as the hero moment.
5. **P1-2** (8 min): node voltages settle (count-up between real results).
6. **P1-4** (5 min, CSS only): 200 ms directional stage transition.

P0-3 (delete the duplicate `CircuitView` in `/probe`) is a one-line removal. Bundle it with item 1 if `/probe` is in the demo. If it isn't, skip it.

## After the hackathon

P1-3 current-flow dashes (the best "wow", but needs per-component wire segments), P1-6 and P1-7 probe callout and anchoring, P1-8 and P1-9 probe elimination and conclusion beats, P1-10 hero auto-sweep, P1-11 larp pipeline and matrix linking, then the P2 list. Warm `/` before the demo (cold TTFB 2.8 s).
