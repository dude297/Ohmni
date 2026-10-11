# Ohmni 4-minute demo script (Groq-primary pipeline)

Hosts: primary Anbaric https://ohmni.cloud.anbaric.ai (build `89251fd` (release candidate, redeployed 15:20 PDT), needs an Anbaric login; `/api/topology` available); public fallback Vercel https://multimodal-hackathon-sage.vercel.app (frozen at `d5a0035`, no `/api/topology`, same demo flow). Check `/api/health` first (build SHA, `visionPrimary: "groq"`, all three providers `configured: true`).

Core value (say it once, early): **Ohmni turns a circuit schematic and real electrical measurements into an explainable investigation, helping users determine what went wrong and what to measure next.**

Pipeline you are showing: **Groq `qwen/qwen3.8-27b` reads the image** → Zod + graph validation → **Jev `jev-1.13-free`** does structured decision routing and ambiguity escalation (`review_extraction` / `verify_topology` / `ask_user`) → **you confirm** the graph → **local MNA solver** → diagnosis. **Gemini `gemini-3.5-flash-lite`** has two separate roles: independent vision fallback (only when Groq fails) and the grounded EE tutor (`/api/explain`, demonstrated on its own below). The **local MNA solver** is the mathematical authority; no model does the math.

Quota rules (free tiers): Jev allows **1 successful call per minute**, Groq's free plan about 3 extractions per minute, the app 6 extractions/min per IP. Keep **≥ 65 s between uploads**, and do not test-upload in the 5 minutes before going on stage.

Prep: tabs on `/lab` and `/probe`. The lab has one-click demo images (**Clear divider**, **Smudged value**), so no files are needed. Backup video `docs/demo/ohmni-demo-guided.webm` open in a player (see `docs/demo/README.md`).

Note: the lab is now the guided four-stage flow (PR #49: **Capture, Review, Compare, Investigate**, with a **Next step** button between stages). Button names below were re-checked in the browser against the Vercel host at `c27807c`; the Anbaric build `89251fd` (release candidate, redeployed 15:20 PDT) adds docs only to this flow, but re-run the click-through there once. If the lab UI changes again, re-run the click-through once before demoing.

| Time | Do | Say |
|---|---|---|
| 0:00-0:20 | `/` hero "Your circuit has a problem. Find out why." (sticky nav; scroll once past the audience section), then open `/lab`. | "You expect 2.5 V, your meter says 0.45 V. Which part is wrong, and what do I check next?" |
| 0:20-0:50 | In **Capture**, click the demo image **Clear divider**. Wait ~3 s (it jumps to Review). Open **Model Orchestration** at the bottom. | "Groq reads the pixels into a candidate graph. Jev never sees the image; it reads a structured summary and routes: here `review_extraction`. Model, latency and tokens are from this request." |
| 0:50-1:05 | In **Review**, tick any "I corrected or verified" boxes, then **I verified values, terminals and ground**, then **Next step**. | "Nothing is solved until a human confirms the graph." |
| 1:05-1:50 | In **Compare**, **Use demo reading: 0.45 V** -> **Analyze & compare** (Expected 2.500 V vs 0.450 V), **Next step** to **Investigate**: the hypothesis card. | "The solver is deterministic MNA, not an LLM: 2.5 V. 0.45 V fits R2 being 1 kΩ instead of 10 kΩ (0.455 V). A hypothesis with a safe next action: power off, measure R2." |
| 1:50-2:35 | In **Investigate**, the Probe Guide: **Guide me** (the divider can't separate R1 100 kΩ from R2 1 kΩ; says to use an ohmmeter). Then the `/probe` tab: Resistor ladder, type `0` -> **Guide me** -> "Measure A next" (optional **Show guide**) -> type `5` -> **Submit reading** -> "Most likely: R2 open (100%)". | "One reading doesn't say which part failed. Ohmni re-solves every candidate fault and picks the probe that splits them best. Two readings, one answer. No LLM in this step." |
| 2:35-3:15 | Tutor beat, still on `/probe` (ladder): click **Explain this circuit**. Expect `grounded: true` and clean numbers (~0.167 mA, 3.33 V, 1.67 V). | "Separate model role: Gemini Flash Lite is the tutor. It explains the circuit in plain language, but every number is checked against the solver, and flagged if it doesn't match." |
| 3:15-3:45 | Second route, only if >= 70 s since the first extract (Jev: 1 call/min): `/lab` -> **Capture** -> demo image **Smudged value**, open **Model Orchestration**. Otherwise play `docs/demo/ohmni-demo-guided.webm` (second extract segment) and say **"this is a recording"** (label it RECORDED). | "Same pipeline, smudged value. Jev escalates to `ask_user`: R2 is partly obscured, so Ohmni refuses to guess and asks me to verify before anything is solved." (The wording of the warning varies per run; the route is what matters.) If the trace shows a Groq 429 and a Gemini row: "Groq hit its free limit, Gemini took over as the independent fallback." |
| 3:45-4:00 | Footer safety line. | "DC resistive circuits only, free-tier models, hypotheses not verdicts. Every trace row is real." |

## Backup (provider rate-limited or down)

1. If an upload returns an `error`/`skipped` row: say "free-tier limit, here's the honest failure", point at it, and do **not** claim a multimodel result for that run.
2. Use **Load sample** (no model calls): confirm → **Next step** → 0.45 V → Analyze & compare; the solver, diagnosis and Probe Guide work without any provider.
3. Play `docs/demo/ohmni-demo-guided.webm` and label it **RECORDED** (recorded 2026-10-11 14:05-14:08 PDT, 2:35, on build `c27807c`). `ohmni-demo-backup.webm` is superseded (old three-column UI).

## What not to claim
- `verify_topology` has **not** been reproduced on the Groq-primary pipeline. It was observed once in the Gemini-primary era (`docs/DEMO_CASES.md`); mention only as dated historical evidence.
- Accuracy on real photos, cost per diagnosis, and willingness to pay are not measured.

## Likely judge questions

**Where is multimodel essential?** Groq turns pixels into a candidate graph (Gemini if Groq fails); Jev decides the trust route from structured state; Gemini also writes the tutor explanation, whose numbers are checked against the solver. The solver is deliberately not an LLM. Dev-time Claude Code / ChatGPT use is not counted.

**Is it accurate?** Not measured at scale. On 10 synthetic fixtures Groq was 10/10 exact (docs/VISION_FALLBACK.md); the divider was verified end to end on production. Two models agreeing is not proof, hence the confirmation gate.

**What does it cost?** Free plans, so $0 here, which is not a production cost. Jev's free tier is 1 call/min; scale needs paid tiers priced from measured tokens.
