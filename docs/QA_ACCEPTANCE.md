# Ohmni — QA & Safety Test Plan

**Not yet executed.** A test plan is not evidence.

### Deterministic DC solver
- 5V with 10k/10k divider VOUT = 2.500000V (1e-5V tolerance).
- 5V with 10k/1k divider VOUT = 0.454545V (1e-5V tolerance).
- Additional two-node resistor graph hand-solved, correct current sign and source polarity.
- Floating network, duplicated component ID, negative/zero resistance, NaN, unsupported component, contradictory ideal sources => typed rejection, not fictional result.

### Multimodel + extraction
- Actual clean JPEG/PNG schematic -> valid candidate + uncertainty + review.
- Actual Jev clear vs ambiguous route **changes downstream action**; only claim if evidenced.
- Ambiguous crossing, missing ground, 429/timeout/malformed JSON and unconfigured second provider => user clarification/error, never fake successful solve.
- No raw keys or sensitive image bodies in browser logs; size/type/timeouts enforced.

### Schematic-first showcase acceptance
- Divider link loads 2.500 V fixture; series/parallel link loads real backend fixture expected 72/11 V; no local divider fallback for non-divider graphs.
- Third demo is a real upload prompt with honest unconfigured/provider-error states, not a fake Jev decision.
- Homepage roadmap labels only limited DC scope available and future phases as planned, research or exploration; mobile cards do not overflow.

### E2E demo + usability
- Hosted incognito URL, GET /api/health, upload, graph correction/confirmation, solve, measured 0.45V and supported next-step hypothesis.
- Desktop/mobile responsive; keyboard navigation/reduced-motion; sample CTA functions without registration.
- UI separates original photo, extracted candidate, confirmed graph, mathematical prediction, observation and hypothesis.
- Safe: no mains/high-voltage advice, power disconnected for resistance check.

### Evidence ledger template
| Check | Build SHA | Command/browser URL | Actual observation | Status |
|---|---|---|---|---|
| Solver fixtures | pending | pending | not run | UNVERIFIED |
| Real Gemini image | pending | pending | not run | UNVERIFIED |
| Real Jev routing | pending | pending | not run | UNVERIFIED |
| Public E2E smoke | pending | pending | not run | UNVERIFIED |

Do not mark PASS without actual action/output tied to a commit.
