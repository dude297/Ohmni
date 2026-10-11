# Backup demo recording

**`ohmni-demo-backup.webm` is a RECORDED run** of the real production app. Play it only if live providers are down during judging, and say "recorded" when you do.

- Recorded: 2026-10-11, 12:51:11 to 12:52:49 PDT (about 1 min 38 s; 1280x800 video of a 1440x900 browser; Playwright headless Chromium, scripted clicks with pauses).
- Target: https://multimodal-hackathon-sage.vercel.app, `/api/health` at start: `{"status":"ok","build":"d1096b7","visionPrimary":"groq", gemini gemini-3.5-flash-lite, groq qwen/qwen3.8-27b, jev jev-1.13-free, all configured}`.
- Nothing in the video is mocked. Every model call was live at the time of recording; the trace rows are exactly what the backend returned.

## What happens in the video (all live at recording time)

| t (approx) | Step | What the backend actually returned |
|---|---|---|
| 0:00 | Homepage `/` | static |
| 0:16 | `/lab` upload `public/samples/clear-divider.png` (live upload 1, 12:51:28 PDT) | Groq `qwen/qwen3.8-27b` extract ok 839 ms (1208 in / 211 out tokens) → Jev `jev-1.13-free` route `review_extraction`, p=1.00, 711 ms. Screenshot `02-live-trace-review_extraction.png` |
| 0:28 | Acknowledge review warnings, tick "I verified values, terminals and ground" | client-side gate |
| 0:33 | "Use demo reading: 0.45 V" → "Analyze & compare" | `/api/solve` (local MNA, no model): expected VOUT 2.500 V vs measured 0.450 V; top hypothesis "R2 may be 1 kΩ instead of 10 kΩ" (1 kΩ gives 0.455 V, exact fit 989 Ω) with a power-off next measurement. `04`, `05` |
| 0:45 | In-lab Probe Guide "Guide me" | `/api/probe` (solver only): R1 100 kΩ vs R2 1 kΩ remain at 50/50 and give identical node voltages, so it says to check them with power off and an ohmmeter. `06` |
| 1:00 | `/probe`, resistor ladder, B = 0 V → "Measure A next" → A = 5 V | `/api/probe`: next probe A (1.50 bits), then "Most likely: R2 open / not connected (100 %)". `07`, `08` |
| 1:10 | "Explain this circuit" (tutor) | `/api/explain` with Gemini: "Every number checked against the solver". `08b` |
| 1:23 | `/lab` upload `public/samples/ambiguous-smudged.png` (live upload 2, 12:52:34 PDT, 66 s after upload 1 for Jev's 1 call/min quota) | Groq returned **429 rate_limited** (374 ms) → **Gemini `gemini-3.5-flash-lite` fallback** extract ok 1140 ms (1310 in / 229 out) → Jev route **`ask_user`**, p=1.00, 707 ms. The UI shows "R2 value partially obscured, reads as 1?k", no graph is solved. `09-live-trace-ask_user.png` |

Notes for honest narration:
- The second route used the Gemini fallback because Groq's free plan rate-limited us (we had made 3 Groq extractions in the previous ~7 minutes during QA). That is the real fallback path, shown as an `error` row plus a `fallback from groq rate_limited` row.
- `/probe` in this recording is the production build `d1096b7`, where the standalone page rendered **without its stylesheet** (CSS-module bug, fixed in PR #37). The in-lab Probe Guide is styled. If PR #37 is merged before judging, the live `/probe` looks like `qa-probe-fixed-desktop-local.png` (a local `next start` of that branch).
- `verify_topology` does not appear: it has not been reproduced on the Groq-primary pipeline. It was observed once in the Gemini-primary era (see `docs/DEMO_CASES.md`, dated historical evidence).

## Files
- `ohmni-demo-backup.webm` – RECORDED backup walkthrough (< 15 MB).
- `01`–`09*.png` – stills from the same recorded run.
- `qa-lab-mobile-prod.png` – 390x844 full-page `/lab` (prod d1096b7) after sample solve + Probe Guide.
- `qa-probe-fixed-desktop-local.png` – `/probe` with the PR #37 fix, local build (not production).
