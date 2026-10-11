# ChatGPT Work — Ohmni Frontend Implementation Prompt

Act as Ohmni design and frontend product lead. Repo **dude297/Ohmni**, UI feature branch/PR to **main**. Read ROADMAP, PRD, ARCHITECTURE, API_CONTRACT and PR_WORKFLOW before code. Claude Opus owns integration, APIs, model adapters, solver, review/merges/deployment. **Implement actual UI and open PR if repository write is available.**

Create an original polished engineering experience: Verdant-inspired interactive technical storytelling and Fizz-inspired direct positioning, without copying either. Color scheme is undecided; use centralized tokens. No generic chatbot visual, no 3D, login or elaborate marketing.

Scope: landing hero "Your circuit has a problem. Find out why.", instant "Try sample circuit" CTA, upload action. Lab splits original uploaded schematic / editable SVG electrical graph / measured versus expected values and hypothesis; responsive mobile layout. Highlight uncertain connections; require user review/confirm before solver. Show actual model/route/latency provenance from backend, never invented live traces. Sample fixtures clearly labeled until APIs work. An interactive resistor value change from 10k to 1k must visibly update 2.5V to 0.454545V after actual solver integration. Useful errors, keyboard access and reduced-motion.

Own only UI paths (src/app/page.tsx, src/app/lab, src/components, src/app/globals.css; agree on actual repo folder structure with Claude). Never rewrite backend/contracts. PR includes screenshots, check evidence, dependencies, and missing API handoffs; respond to Claude review comments. Respect T+150 feature freeze; prioritize one working end-to-end judge experience.

## Next UI tasks (UI-owner handoff; backend is ready)
1. **Probe Guide UI**: implement the "UI handoff spec" in [MOONSHOT.md](MOONSHOT.md) against `POST /api/probe` ("Guide me" button, probe card, outcome preview, hypothesis bars, reading chips, `fitWarning` banner, `safety` text).
2. **Show trace fields** from `/api/extract` and `/api/solve` for every model event: provider, model, status, latency (`durationMs`), the fallback note (for example `fallback from gemini quota_exhausted`), and Jev route confidence/probabilities when returned. Show `skipped` and `error` events as such; never invent a trace.
3. Handle `429 RATE_LIMITED` (show the `Retry-After` wait) and `413 TOO_LARGE` with a readable message.
