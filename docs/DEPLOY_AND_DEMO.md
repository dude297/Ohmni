# Ohmni — Deployment, Smoke Test and Three-Minute Demo

### Corrected deadline and release sequence
**External hard deadline: Sunday October 11, 2026, 5:30 PM PDT = 8:30 PM EDT.** Target submission **5:00 PM PDT**, 30-minute cushion. Feature freeze **3:30 PM PDT**, production verification **3:30–4:30 PM PDT**, rehearsal/submission **4:30–5:00 PM PDT**. See ROADMAP.md; old T+150 schedule superseded.

### Hosting decision
Single Node/Next.js deploy. Anbaric Cloud is a **20-minute T0 spike**: verify public frontend, /api/health, POST handling, PORT/start and server-only env variables. If no real result, deploy unchanged app to Vercel immediately. Do not introduce Render free/second FastAPI service.

### Credentials and safety
GEMINI_API_KEY, GEMINI_MODEL (real tested model), TYPESAFE_API_KEY, optional SECONDARY_VISION_API_KEY + model are server-only. Never NEXT_PUBLIC keys. .env.local excluded. Validate <=5MB file/MIME, timeouts, secrets in bundles/logs, no persistent images.

### Smoke steps
1. Public URL opens in incognito, mobile UI responsive.
2. GET /api/health 200 from actual Node runtime.
3. Real clean schematic → Gemini candidate + Jev choice with trace.
4. Edit/review → real solver 2.50V, alternate 0.454545V.
5. Enter 0.45V against expected 2.50V → hypothesis-labeled resistor test with power off.
6. Ambiguous/error path asks for clarification; no invented specialist call.
7. Record hosted build SHA, actual provider/token/latency observations, log-link and known limitations.

### Judge demo (180s)
0:00–0:20 real problem/payoff. 0:20–1:00 real image upload/extraction. 1:00–1:30 Jev reason/route choice incl contrasting example. 1:30–2:00 user-confirmed netlist and deterministic 2.50V. 2:00–2:35 measured 0.45V and next measurement. 2:35–3:00 cost/latency/provenance and classroom/engineering value.

Record backup video but **label it recorded**. Do not show a pre-recorded model trace as live. If real model unavailable, clearly call manual-mode a fallback and mark multimodel judging proof incomplete.

### Release
Product only freezes after FREEZE_CHECKLIST all P0 gates supported by real links. At **3:30 PM PDT**, no new features, only P0 repairs; submit **before 5:30 PM PDT** (target 5:00).
