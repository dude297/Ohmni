# Ohmni

**From circuit to clarity.** An AI circuit-debugging copilot for EE/ECE students, teaching labs and hardware prototyping teams.

**Current status (2026-10-11): Next.js scaffolding and typed adapter stubs are committed; the actual solver, Gemini extractor, Jev router, and diagnoses were NOT implemented or tested at the latest audit. No verified public deployment yet.** Documentation freeze does not mean the application is ready.

## North star
1. [Locked roadmap, priorities and deadlines](docs/ROADMAP.md)
2. [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Binding API contract](docs/API_CONTRACT.md)
3. [Free-tier model access](docs/MODEL_ACCESS.md) · [PR workflow](docs/PR_WORKFLOW.md)
4. [QA](docs/QA_ACCEPTANCE.md) · [Deployment/demo](docs/DEPLOY_AND_DEMO.md) · [Economics](docs/UNIT_ECONOMICS.md) · [Freeze](docs/FREEZE_CHECKLIST.md)
5. [Claude lead prompt](docs/CLAUDE_ORCHESTRATOR.md) · [ChatGPT Work UI prompt](docs/CHATGPT_WORK_UI.md) · [Live state ledger](docs/CURRENT_STATE.md)

## MVP in one sentence
Real schematic image → Gemini candidate graph → Jev routes validation/clarification → user reviews → TypeScript DC solver → measured vs predicted voltages → testable fault hypothesis.

**Stack:** Next.js 16, React/TypeScript/Tailwind, Zod, Node route handlers, pure TS Modified Nodal Analysis, SVG, Vitest. Single deploy; short Anbaric Cloud spike then Vercel if needed. No Python/Render/Supabase or database/auth for MVP. The **electrical graph** drives math, while breadboard coordinates are a future adapter/view.

## Local development (once implementation lands)
Run npm ci; npm run dev. Tests: npm test; typecheck: npm run typecheck; build: npm run build. Current stubs intentionally throw and are not feature acceptance evidence.

## Collaboration
One feature per branch and PR to main. Claude reviews/integrates; ChatGPT Work owns UI branch. Source of truth is docs/ROADMAP.md. Never fake runtime provider/CI/deployment traces.
