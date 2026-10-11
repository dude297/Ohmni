# Ohmni 3-minute demo script (Groq-primary pipeline)

Prod: https://multimodal-hackathon-sage.vercel.app. Check `/api/health` first (build SHA, `visionPrimary: "groq"`, all three providers `configured: true`).

Pipeline you are showing: **Groq `qwen/qwen3.8-27b` reads the image** → Zod + graph validation → **Jev `jev-1.13-free`** picks `review_extraction` / `verify_topology` / `ask_user` → **you confirm** the graph → **local MNA solver** → diagnosis. **Gemini `gemini-3.5-flash-lite`** is the vision fallback (only when Groq fails) and powers the grounded tutor.

Quota rules (free tiers): Jev allows **1 successful call per minute**, Groq's free plan about 3 extractions per minute, the app 6 extractions/min per IP. Keep **≥ 65 s between uploads**, and do not test-upload in the 5 minutes before going on stage.

Prep: tabs on `/` and `/probe`; have `public/samples/clear-divider.png` and `public/samples/ambiguous-smudged.png` in an easy folder; backup video `docs/demo/ohmni-demo-backup.webm` open in a player (see `docs/demo/README.md`).

Note: ChatGPT's PR #35 (merged, prod `d1096b7`) put the Probe Guide inside `/lab` and reworked the lab layout; button names below were re-checked in the browser against `d1096b7`. If the lab UI changes again, re-run the click-through once before demoing.

| Time | Do | Say |
|---|---|---|
| 0:00-0:15 | `/` hero "Your circuit has a problem. Find out why." Click **Upload your schematic**. | "You expect 2.5 V, your meter says 0.45 V. Which part is wrong, and what do I check next?" |
| 0:15-0:40 | In **Capture**, choose `clear-divider.png`. Wait ~2 s. Open **Model Orchestration** at the bottom. | "Groq reads the pixels into a candidate graph. Jev never sees the image; it reads a structured summary and picks the route: here `review_extraction`. Those are the real model, latency and tokens from this request." |
| 0:40-0:55 | In **Review**, tick any "I corrected or verified" boxes, then **I verified values, terminals and ground**. | "Nothing is solved until a human confirms the graph. Edits clear the confirmation." |
| 0:55-1:30 | In **Understand**, **Use demo reading: 0.45 V** → **Analyze & compare**. Point at Expected 2.500 V vs Observed 0.450 V and the hypothesis card. | "The solver is deterministic MNA, not an LLM: 2.5 V. 0.45 V fits R2 being 1 kΩ instead of 10 kΩ (0.455 V). It's a hypothesis with a safe next action: power off, measure R2." |
| 1:30-2:10 | Probe Guide: either scroll to **What should I check next?** in the lab and click **Guide me**, or (smoother for the iterative story) switch to the `/probe` tab: Resistor ladder, type `0` → **Guide me** → it says **Measure A next** and shows what each reading would mean → type `5` → **Submit reading** → "Most likely: R2 open". Optionally click **Explain this circuit**. | "One wrong reading doesn't say which part failed. Ohmni re-solves every candidate fault and picks the probe that splits them best. Two readings, one answer. The tutor's numbers are checked against the solver." |
| 2:10-2:45 | Second route, only if ≥ 65 s since the first upload: `/lab` → **Upload your schematic** → `ambiguous-smudged.png`. Open **Model Orchestration**. Otherwise play `docs/demo/ohmni-demo-backup.webm` from ~1:23 and say **"this is a recording"**. | "Same pipeline, smudged value. Jev routes to `ask_user`: R2 reads '1?k', so Ohmni refuses to guess and asks me." If the trace shows a Groq 429 and a Gemini row: "Groq hit its free rate limit, Gemini took over automatically; that's the fallback, live." |
| 2:45-3:00 | Footer safety line. | "DC resistive circuits only, free-tier models, hypotheses not verdicts. Every trace row is real." |

## Backup (provider rate-limited or down)

1. If an upload returns an `error`/`skipped` row: say "free-tier limit, here's the honest failure", point at it, and do **not** claim a multimodel result for that run.
2. Use **Load sample** / "Try sample circuit" (no model calls): confirm → 0.45 V → Analyze & compare; the solver, diagnosis and Probe Guide work without any provider.
3. Play `docs/demo/ohmni-demo-backup.webm` and label it **RECORDED** (recorded 2026-10-11 12:51 PDT on build `d1096b7`).

## What not to claim
- `verify_topology` has **not** been reproduced on the Groq-primary pipeline. It was observed once in the Gemini-primary era (`docs/DEMO_CASES.md`); mention only as dated historical evidence.
- Accuracy on real photos, cost per diagnosis, and willingness to pay are not measured.

## Likely judge questions

**Where is multimodel essential?** Groq turns pixels into a candidate graph (Gemini if Groq fails); Jev decides the trust route from structured state; Gemini also writes the tutor explanation, whose numbers are checked against the solver. The solver is deliberately not an LLM. Dev-time Claude Code / ChatGPT use is not counted.

**Is it accurate?** Not measured at scale. On 10 synthetic fixtures Groq was 10/10 exact (docs/VISION_FALLBACK.md); the divider was verified end to end on production. Two models agreeing is not proof, hence the confirmation gate.

**What does it cost?** Free plans, so $0 here, which is not a production cost. Jev's free tier is 1 call/min; scale needs paid tiers priced from measured tokens.
