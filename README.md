# Ohmni

**From circuit to clarity.** A multimodal AI circuit-debugging copilot for EE/ECE students, teaching labs, and hardware prototyping teams.

**Status (2026-10-11): documentation-stage repository. No application, verified provider integration, CI, or deployment was present at audit.** Do not confuse documentation freeze with release readiness.

## Read in order
1. [NORTH STAR: roadmap and freeze gates](docs/ROADMAP.md)
2. [Product requirements](docs/PRD.md) and [architecture](docs/ARCHITECTURE.md)
3. [API contract](docs/API_CONTRACT.md) and [model-access policy](docs/MODEL_ACCESS.md)
4. [PR collaboration](docs/PR_WORKFLOW.md), [testing](docs/QA_ACCEPTANCE.md), [deploy and demo](docs/DEPLOY_AND_DEMO.md)
5. [Unit economics](docs/UNIT_ECONOMICS.md), [current status](docs/CURRENT_STATE.md), [release freeze checklist](docs/FREEZE_CHECKLIST.md)
6. [Claude orchestration](docs/CLAUDE_ORCHESTRATOR.md) and [ChatGPT Work UI](docs/CHATGPT_WORK_UI.md)

## MVP
One working flow: upload a clean DC schematic; Gemini extracts a candidate circuit; Jev chooses verification/review/clarification; user confirms graph; deterministic DC solver calculates voltages; enter observed voltage; explain a **testable** fault hypothesis and next measurement. Real calls and traces only.

**Stack:** Next.js 16, TypeScript, React, Tailwind, Zod, Node route handlers, TypeScript Modified Nodal Analysis, SVG diagram, Vitest. Anbaric Cloud 20-minute hosting spike, Vercel fallback. No Python/Render service or database in MVP. Canonical **electrical graph** drives computation; virtual breadboard coordinates are an adapter/view, not a replacement for netlist.

No direct pushes to main. One feature, one branch, one reviewed PR.
