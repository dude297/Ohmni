# Backup demo recordings

## CURRENT: `ohmni-demo-guided.webm` (RECORDED, guided four-stage lab)

Play only if live providers are down during judging, and say "recorded".

- Recorded 2026-10-11, 14:05:41 to 14:08:16 PDT (about 2 min 35 s; 1280x800 video (re-encoded from the raw Playwright capture, 6.1 MB), real production, Playwright headless Chromium, scripted clicks with pauses; no audio). A 43 s idle wait (so extract 2 lands 79 s after extract 1, Jev quota) sits at about 1:00 to 1:45; the page is static on the Investigate stage there.
- Target: the Vercel host https://multimodal-hackathon-sage.vercel.app (now frozen at `d5a0035`; the primary host is Anbaric https://ohmni.cloud.anbaric.ai, build `d4b97d2` (release candidate #62 + Loaded bridge sample #64, redeployed ~16:00 PDT), login required, same flow), `/api/health` at start: build **`c27807c`** (= main at the time), visionPrimary groq, gemini `gemini-3.5-flash-lite`, groq `qwen/qwen3.8-27b`, jev `jev-1.13-free`, all configured.
- Nothing mocked. 2 live `/api/extract` calls (79 s apart, Jev quota), plus `/api/solve` x1, `/api/probe` x4 (solver only), `/api/explain` x1 (Gemini tutor).

| Step | Live or static | What the backend actually returned |
|---|---|---|
| `/` sticky nav + audience section | static | none |
| `/lab` Capture: demo image **Clear divider** (14:06:03 PDT) | LIVE | extract: Groq `qwen/qwen3.8-27b` ok 1053 ms (1208 in / 211 out tokens); route: Jev (`beatapi` / `jev-1.13-free`) `review_extraction`, 100% confidence, 731 ms (527 in / 49 out); probabilities ask_user 0.00 / review_extraction 1.00 / verify_topology 0.00; no fallback. Total client time 3.3 s. Still `guided-02` |
| Review: tick confirmation, Next step | client-side gate | none |
| Compare: demo reading 0.45 V, **Analyze & compare** | LIVE (local solver, no model) | `/api/solve`: VOUT expected 2.500 V (VIN 5.000, GND 0); top hypothesis "R2 may be 1 kΩ instead of 10 kΩ" (1 kΩ gives 0.455 V, exact fit 989 Ω), next step: power off, measure R2. Stills `04`, `05` |
| Investigate: in-lab Probe Guide **Guide me** | LIVE (solver) | `/api/probe`: R1 100 kΩ and R2 1 kΩ tie at 50.0% each with identical node voltages, so "check them with power off and an ohmmeter". Still `06` |
| (idle about 43 s so extract 2 is over 70 s after extract 1) | | |
| Capture again: demo image **Smudged value** (14:07:25 PDT, 79 s after extract 1) | LIVE | extract: Groq ok 953 ms (1208 in / 238 out); route: Jev `ask_user`, 100% confidence, 383 ms (547 in / 46 out); probabilities ask_user 1.00. Groq's warning on this run was "The value for R2 is partially obscured by a grey box but appears to be 10k." (it returned a candidate graph, R2 = 10 kΩ, rather than "1?k"); the app lands on Review with "Review required", the warning to acknowledge, and nothing solved. No 429/fallback this time. Total 5.3 s. Still `07` |
| `/probe`: Resistor ladder, B = 0 V, **Guide me** | LIVE (solver) | "Measure A next" (1.50 bits; about 0 V 50% / 2.5 V 25% / 5 V 25%). The video shows the next-probe card; the **Show guide** side panel was not opened in this take. Still `08` |
| A = 5 V, **Submit reading** | LIVE (solver) | "Diagnosis: Most likely: R2 open / not connected (100%)". Still `09` |
| **Explain this circuit** | LIVE (Gemini tutor) | `/api/explain`: grounded true, badge "Every number checked against the solver", explanation cites 0.167 mA, 3.33 V, 1.67 V. Still `10` |
| `/for-the-larp` quick scroll (pipeline + matrix) | static | page loaded; scroll ends on the matrix section. Still `11` |

Notes for honest narration:
- `verify_topology` does not appear (never reproduced on the Groq-primary pipeline).
- The Smudged run's Jev route is `ask_user`, but the extractor text read the value as 10k, so say "Jev refused to trust it and asked for a human check", not "Groq read 1?k".
- Duration is 2:35, not 4:00; the click-through is complete but tight. Talk over it using `docs/DEMO_SCRIPT.md`.

Stills (all under 150 KB): `guided-01-home.png`, `guided-02-trace-review_extraction.png`, `guided-04-compare-expected-vs-measured.png`, `guided-05-investigate-hypothesis.png`, `guided-06-investigate-probe-guide.png`, `guided-07-trace-smudged-ask_user.png`, `guided-08-probe-measure-A.png`, `guided-09-probe-conclusion.png`, `guided-10-tutor-grounded.png`, `guided-11-larp-matrix.png`.

---

# SUPERSEDED: older recordings (old three-column lab UI, builds `d1096b7` / `bdf035f`)

The UI shown in these videos no longer exists. Kept for the record; use `ohmni-demo-guided.webm` instead.

**`ohmni-demo-backup.webm` (SUPERSEDED, old UI) is a RECORDED run** of the real production app. Play it only if live providers are down during judging, and say "recorded" when you do.

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
- **The `/probe` segment of this video (about 1:00 to 1:23) is superseded by `ohmni-probe-segment.webm` (below).** It was recorded on build `d1096b7`, where the standalone page rendered without its stylesheet (CSS-module bug, fixed in PR #37). The in-lab Probe Guide in this video is styled and still valid.
- `verify_topology` does not appear: it has not been reproduced on the Groq-primary pipeline. It was observed once in the Gemini-primary era (see `docs/DEMO_CASES.md`, dated historical evidence).

## `/probe` re-record: `ohmni-probe-segment.webm` (RECORDED)

- Recorded: 2026-10-11, 13:01:30 to 13:02:04 PDT (about 34 s; 1280x800 video of a 1440x900 browser; Playwright headless Chromium, scripted clicks).
- Target: production, `/api/health` at start: build `bdf035f`, visionPrimary groq, all three providers configured. Page had 0 `undefined` class names (styles applied).
- Calls made (all live at recording time): `POST /api/probe` x2 (solver only, no model) and `POST /api/explain` x1 (Gemini tutor). **No `/api/extract` call** (no Groq/Jev quota used).
- What it shows: resistor ladder, B = 0 V → "Measure A next" (1.50 bits) with outcome previews ≈ 0 V 50% / ≈ 2.5 V 25% / ≈ 5 V 25% → A = 5 V → "Most likely: R2 open / not connected (100%)" → "Explain this circuit".
- Tutor result in this take: the grounding check flagged one number, **"Some numbers could not be verified: 0.17 mA"**, and the explanation is shown with that amber warning. That is the real output; we did not re-take to get a clean one. Narrate it as the grounding check doing its job.
- Stills: `10-probe-segment-next.png`, `11-probe-segment-conclusion.png`.

## Files
- `ohmni-probe-segment.webm` – RECORDED `/probe` re-record on `bdf035f` (supersedes the `/probe` part of the main backup).
- `ohmni-demo-backup.webm` – SUPERSEDED (old three-column UI), kept. Do not use for the demo.
- `01`–`09*.png` – stills from the same recorded run.
- `qa-lab-mobile-prod.png` – 390x844 full-page `/lab` (prod d1096b7) after sample solve + Probe Guide.
- `qa-probe-fixed-desktop-local.png` – `/probe` with the PR #37 fix, local build (not production; now superseded by stills 10/11 from production).
