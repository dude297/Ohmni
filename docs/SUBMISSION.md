# Ohmni — Submission

**From schematic to verified electrical diagnosis, with intelligent model routing, human oversight, and a deterministic engineering solver.**

- Live app (no signup): https://multimodal-hackathon-sage.vercel.app
  - Lab (upload → review → solve → diagnose → Probe Guide): https://multimodal-hackathon-sage.vercel.app/lab
  - Probe Guide + tutor: https://multimodal-hackathon-sage.vercel.app/probe
  - Health / build SHA / model ids: https://multimodal-hackathon-sage.vercel.app/api/health
- Repo: https://github.com/dude297/Ohmni
- 3-minute demo script: [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- Backup recording (RECORDED, live calls at the time; 2026-10-11 12:51 PDT, build `d1096b7`): [demo/ohmni-demo-backup.webm](demo/ohmni-demo-backup.webm), details in [demo/README.md](demo/README.md)

## The problem

You build a low-voltage circuit, the schematic says 2.50 V, your meter says 0.45 V. Which part is wrong, and what should you measure next? Today that means re-deriving the circuit by hand and guessing. Ohmni reads the schematic, makes you confirm what it read, computes what the circuit should do, and turns your reading into ranked, testable hypotheses and the next safe measurement.

## What makes it different

1. **Cross-representation reasoning.** One circuit, three representations kept consistent: the image (read by a vision model), a typed circuit graph (validated by Zod and structural checks, then edited and confirmed by you), and physics (node voltages and currents from a local MNA solver). Your multimeter reading is a fourth representation; Ohmni explains the gap between the reading and the solved graph with concrete component hypotheses (e.g. "R2 may be 1 kΩ instead of 10 kΩ: 1 kΩ gives 0.455 V").
2. **Safety and epistemic honesty.** The server refuses to solve without `userConfirmed: true`. Ambiguous or illegible inputs route to `ask_user` instead of a guess (a smudged "1?k" value produced no graph and a request for clarification, live). Every trace row is what the provider actually returned: model, status, latency, tokens, fallback reason; failures and skips are shown as such. Outputs are hypotheses, not verdicts, with "disconnect power before measuring resistance". The tutor's numbers are checked against the solver and flagged if they don't match.
3. **Next-best measurement.** One reading rarely identifies the failed part. The Probe Guide enumerates single-fault hypotheses (open, short, ×10, ÷10, dead source), re-solves each with the solver, and picks the node whose reading best splits them (expected information in bits), showing what each possible reading would mean. On the 5 V three-resistor ladder: B = 0 V → "measure A next" → A = 5 V → "Most likely: R2 open". No LLM is involved in that step.

## Architecture

```
image ─► Groq qwen/qwen3.8-27b (vision, primary) ──fail──► Gemini gemini-3.5-flash-lite (vision fallback)
      ─► Zod + graph validation (hard invalidity always forces correction)
      ─► Jev jev-1.13-free (BeatAPI): route = review_extraction | verify_topology | ask_user
      ─► human review + edit + confirm (required)
      ─► local MNA solver (TypeScript, deterministic) ─► expected V/I
      ─► measured voltage ─► diagnosis hypotheses + next safe action
      ─► Probe Guide (/api/probe, solver-only)   ·   grounded tutor (/api/explain, Gemini + solver check)
```

Next.js 16 (App Router, Node route handlers), React 19, TypeScript, Tailwind 4, Zod 4, Vitest; deployed on Vercel. Keys are server-only; uploads are size-bounded and not persisted by default; per-IP rate limits on public endpoints.

## Model roles

| Component | Role | Never does |
|---|---|---|
| Groq `qwen/qwen3.8-27b` | Primary image reader → candidate graph JSON; topology verifier on `verify_topology` | Override validation, do the math |
| Gemini `gemini-3.5-flash-lite` | Vision fallback when Groq fails (429, timeout, error, malformed output); tutor explanations | Decide trust, do the math |
| Jev `jev-1.13-free` (BeatAPI) | Reads a structured summary (never pixels) and chooses the trust route, with probabilities | See the image, solve equations |
| Local MNA solver | The only authority for voltages and currents; also powers diagnosis and Probe Guide | Trust an image |
| Human | Confirms values, terminals and ground before any solve | — |

Why Groq first: on our 10 synthetic fixtures Groq was 10/10 exact with 0 API errors at 735 ms median, vs Gemini 3.5 Flash 7/7 exact with 3/10 503 errors at 4223 ms ([VISION_FALLBACK.md](VISION_FALLBACK.md)). Synthetic fixtures; not a general accuracy benchmark.

Observed live on production (2026-10-11, build `d1096b7`): `clear-divider.png` → Groq ok 839 ms → Jev `review_extraction` (p=1.00) → 2.500 V expected vs 0.450 V measured → "R2 may be 1 kΩ instead of 10 kΩ". `ambiguous-smudged.png` 66 s later → Groq 429 → Gemini fallback ok 1140 ms → Jev `ask_user` (p=1.00).

## Limitations

- **DC resistive only:** resistors and DC voltage sources. No capacitors/inductors, AC, transients or nonlinear parts.
- **No PCB, hierarchical schematics or breadboard photos;** clean single-sheet schematics only.
- **Synthetic fixtures and samples:** accuracy on real photos or hand drawings is not measured.
- **Groq `qwen/qwen3.8-27b` is a Preview model** and may change or be withdrawn.
- **Free-tier limits:** Jev 1 successful call/min, Groq about 3 extractions/min, Gemini quota/503s observed; the app paces and falls back, but heavy use will see `skipped`/`error` rows.
- **`verify_topology` not reproduced on the Groq-primary pipeline.** It was observed once in the earlier Gemini-primary deployment ([DEMO_CASES.md](DEMO_CASES.md)); we do not claim it for the current pipeline.
- Probe Guide models single faults only; its probabilities are model-relative, not calibrated fault rates. Diagnosis thresholds are demo heuristics.
- Cost per diagnosis, time saved and willingness to pay are not measured ([UNIT_ECONOMICS.md](UNIT_ECONOMICS.md)).

## Roadmap (planned / research — not live)

From [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md); none of these ship today:
- **Planned — See denser:** image-region cropping, junction/crossing indicators, per-component provenance, targeted clarification questions; gated on exact-connectivity evaluation on labeled real images.
- **Research — Simulate more:** capacitors, inductors, nonlinear parts, AC/transient via a validated solver (e.g. SPICE).
- **Exploration — Connect workflows:** breadboard and PCB/EDA imports, lab reports, instrument integration, classroom/team review.

## Built with

Claude Code and ChatGPT Work were development tools, not runtime models. Runtime providers: GroqCloud, Google Gemini, Jev via BeatAPI.
