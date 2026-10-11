# Ohmni — QA & Safety Test Plan

This is a historical safety/QA plan; a plan is not evidence. Today's build-stamped hosted smoke (11/11), Chrome browser user journeys (8/8), source/deployment provenance and outstanding signed-in Anbaric gates are recorded in [RELEASE_E2E_2026-10-11.md](RELEASE_E2E_2026-10-11.md). Older smoke results below remain historical, not current release sign-off.

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

### Evidence ledger
| Check | Build SHA | Command/browser URL | Actual observation | Status |
|---|---|---|---|---|
| Solver fixtures | 8fad171 | `npm run smoke` (solve checks) | 2.5 V and 0.454545 V plus negative cases PASS | VERIFIED |
| Real Gemini image | see MODEL_ACCESS.md | production /api/extract | ok earlier on 2026-10-11; quota later exhausted (429), Groq fallback used | VERIFIED, quota-limited |
| Real Jev routing | 8fad171 | `npm run smoke -- --live` | ok 718 ms, `review_extraction` after Groq extraction | VERIFIED |
| Public E2E smoke | 8fad171 | `npm run smoke` | 12/12 PASS | VERIFIED |

Do not mark PASS without actual action/output tied to a commit.

## Smoke results (historical run, 2026-10-11 11:48 PDT; superseded by 12/12 PASS at 8fad171)

Run with `npm run smoke` (add `-- --live` for one real extract call; `SMOKE_IMAGE=<png>` overrides the image).

**2026-10-11 11:48-11:49 PDT**, target https://multimodal-hackathon-sage.vercel.app (health reports `build=dev`, no providers block).

Non-live: 11/11 PASS (latencies 91-325 ms).

Live (`--live`, image `fixtures/circuits/01_divider_5v_10k_10k.png`): HTTP 200 and contract shape valid, so the check passes, but **both model providers failed**:

```
      route: ask_user
      graph: null
      warnings: Extraction failed; enter the circuit manually.
      trace: extract provider=google model=gemini-3.5-flash status=error durationMs=2914 usage=null note=Gemini request failed
      trace: route provider=beatapi model=jev-1.13-free status=error durationMs=605 usage=null note=Jev rate limited (429), retry after 60s; defaulting to ask_user
```

Findings at that time (since addressed by the Groq fallback and Jev pacing; kept as history): (1) production Gemini extraction FAILS ("Gemini request failed", 2.9 s) on a clean fixture, so the real-image path currently yields no graph; cause unknown (key, model id, or quota), needs a Vercel log check. (2) Jev 429 here is partly self-inflicted: an earlier live run about 1 min before (output not captured) used the free-tier call, so Jev routing is still unproven.

| Check | Result | ms |
|---|---|---|
| GET / is 200 and contains "Ohmni" | PASS | 325 |
| GET /lab is 200 | PASS | 179 |
| GET /api/health status ok | PASS | 184 |
| solve 10k/10k -> VOUT = 2.5 | PASS | 286 |
| solve 10k/1k -> VOUT = 0.454545 | PASS | 114 |
| diagnose measured 0.45V -> top hypothesis R2 / 1 kΩ | PASS | 115 |
| negative: userConfirmed false -> 422 NOT_CONFIRMED | PASS | 125 |
| negative: floating graph -> 422 | PASS | 102 |
| negative: bad JSON -> 400 | PASS | 95 |
| negative: /api/extract text/plain file -> 400 | PASS | 131 |
| negative: /api/extract no image -> 400 | PASS | 91 |
| LIVE /api/extract (1 model call) | PASS (shape only; route ask_user) | 3696 |
