# Cinematic refinement: implementation and review handoff

Base: `7b08dd2281f7982257edc57efd067296dc77acaa` (main, including the independent audit in #59). Branch: `feat/cinematic-ui-work`. Frontend author retains write ownership until acceptance; Claude reviews through this document and PR feedback. No direct branch edits without an explicit handoff. No merge or production deployment is authorized by this PR.

## Implemented subset

- **Hero:** compact upright instrument, verification control above the 1440×900 fold, 220ms entrance and 240ms reveal of the actual circuit paths. Slider interaction remains immediate and explicitly labelled a local preview. No automatic sweep or fabricated live activity.
- **Comparison:** one evidence card contains equally prominent expected/measured HTML numerals, a signed voltage difference and relative percent, and two bars on the same scale. The real divider response and user-entered 0.450 V yield 2.500 V expected and Δ −2.050 V (−82%). Percent is omitted when expected voltage is zero. Existing mismatch heuristic is preserved.
- **Lab:** sample deep links start in **unconfirmed Review**; empty/upload visits still start in Capture. All four stages stay mounted. Directional 200ms transitions keep the existing heading focus. A completed result receives focus and one explicit scroll to its answer; revisiting a stage does not steal focus. Confirmation, edit invalidation, extraction ambiguity gates and request handlers remain intact.
- **Readability:** meaningful CSS text has an 11px floor. Solved labels on the light persistent preview use dark teal; the reading color `#173b35` has >11:1 contrast against the composited preview background, and node-name color `#3d5450` has >7:1. No color-only mismatch verdict.
- **Probe Guide:** one topology-correct diagram replaces the duplicate generic ring layout. An amber callout sits in reserved space above the schematic, with a short leader and ring at the actual recommended node. It clears all labels and symbols on all circuit tabs. A 220ms focus lock replaces the perpetual pulse. Live announcements are narrowed to the next-node heading and conclusion. The existing reading trail, hypotheses, safety text and guide focus return remain available.
- **Under the Hood:** selected stages reveal their real incoming edge, the fallback arrow avoids the Normalize box, and conductance cells expose their resistor-stamp expressions through pointer or keyboard selection. The displayed matrix and results still come from the unchanged numerical code.

## Browser evidence

Screenshots use a real Chromium browser at **390×844** and **1440×900**, reduced motion, against the same local rendering harness before and after the changes. The harness renders the actual React components and genuine `/api/solve` and `/api/probe` handlers; it replaces Next link/search-parameter integration with simple adapters and serves the handwritten global CSS without the Tailwind import. Fonts use the browser fallback. These are controlled component screenshots, not deployed Next screenshots.

| Page | Before mobile | After mobile | Before desktop | After desktop |
| --- | --- | --- | --- | --- |
| Hero | [before](cinematic/before/home-390.png) | [after](cinematic/after/home-390.png) | [before](cinematic/before/home-1440.png) | [after](cinematic/after/home-1440.png) |
| Divider comparison | [before](cinematic/before/lab-390.png) | [after](cinematic/after/lab-390.png) | [before](cinematic/before/lab-1440.png) | [after](cinematic/after/lab-1440.png) |
| Probe schematic | [before](cinematic/before/probe-390.png) | [after](cinematic/after/probe-390.png) | [before](cinematic/before/probe-1440.png) | [after](cinematic/after/probe-1440.png) |
| Architecture | [before](cinematic/before/architecture-390.png) | [after](cinematic/after/architecture-390.png) | [before](cinematic/before/architecture-1440.png) | [after](cinematic/after/architecture-1440.png) |

The comparison changes from **357.4px to 155.1px** at 1440px. On narrow screens the difference chip wraps below the paired numerals; after analysis, both values and the verdict are visible without manually scrolling. The compact hero verification control fits at 1440×900. No horizontal page overflow on any of the four routes at 320, 390, 768 or 1440px.

## Validation and reproduction

- Full local ESLint passes. `tsc --noEmit` passes using the existing generated root-layout declaration from the earlier checkout; fresh route generation is verified by hosted CI.
- **161 unit tests in 18 files pass.** Solver mathematics, providers, API contracts, package dependencies and hosting configuration are untouched.
- **131 guided-workflow browser assertions pass**, including direct Investigate readings, retries, confirmation gates, ambiguity acknowledgement, edit invalidation, backend/local provenance and backward state preservation. Genuine solve/probe requests; extraction and HTTP failure fixtures are explicitly mocked.
- **226 cinematic browser assertions pass** at 320, 390, 768 and 1440px under both motion preferences. Actual local solver values, no duplicate/model calls, direct sample Review, result visibility, 11px CSS floor, heading focus, correct recommended node, callout non-overlap, guide focus return, keyboard pipeline selection and matrix inspection. No browser runtime errors. [Results](cinematic/results.json).
- `next typegen` and `next build` were attempted locally. Both hit the pre-existing Windows SWC canonical-path access error before application compilation. Hosted Linux CI must run full lint, fresh route generation/typecheck, unit tests and production build before acceptance.

With a separately installed Playwright and a running application:

```sh
BASE_URL=http://127.0.0.1:3000 node scripts/guided-ui-smoke.mjs
BASE_URL=http://127.0.0.1:3000 node scripts/cinematic-ui-smoke.mjs
```

Both support `GUIDED_PLAYWRIGHT_MODULE` and `GUIDED_BROWSER_EXECUTABLE`. Output directories are `GUIDED_UI_OUTPUT_DIR` and `CINEMATIC_UI_OUTPUT_DIR`. No browser dependency is installed in the application. The local harness is workspace QA scaffolding outside the repository; deployed Next verification remains a separate check.

## Accessibility, motion and performance

All new animation is opt-in under `prefers-reduced-motion: no-preference`, lasts 180–240ms, and affects opacity, transform or stroke-dashoffset. Bars show final geometry and values instantly under reduce; browser checks observe zero running animations. There is no scroll listener, scroll-jacking, perpetual visual activity, extra model request or animation library. Controls, focus destinations, textual verdicts and numerical data work without motion. The reveal does not animate invented intermediate solver numbers.

Runtime dependencies and server/client boundaries are unchanged. Real local slider changes make zero network requests. Idle architecture has zero active animations under either preference. The performance observations concern rendering behavior and compactness, not a claim of better deployed FCP/LCP; the audit's production timing measurements are retained in its source document. Tailwind/fonts, hydration and public hosting still need deployed-browser verification. Anbaric primary and Vercel fallback are preserved.

## Remaining recommendations

Defer automatic hero sweeps, per-branch current-flow animation, hypothesis elimination transitions, matrix-to-topology highlighting, a new conclusion composition, photo morphs and shared-element navigation until after submission. They expand interaction/state scope. Count-up of voltages is also deferred: exact solved values remain immediately readable. Before accepting, Claude should independently check hosted preview focus/scroll behavior and numerical rendering, and review Prelint feedback. Valid findings return to the frontend author for correction and re-review; do not merge directly from this implementation task.
