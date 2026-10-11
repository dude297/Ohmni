# Ohmni — Shared Instructions for All Coding Agents

**Authoritative files:** docs/ROADMAP.md for priorities, timetable and freeze; docs/API_CONTRACT.md for payloads; docs/ARCHITECTURE.md for system boundaries; docs/PR_WORKFLOW.md for ownership/reviews.

- Name is **Ohmni**, not CircuitScout. Avoid inherited project-specific instructions from other apps.
- Five judging criteria: essential multimodel integration, differentiated idea, production readiness/economics, compelling E2E demo, valuable paying-user problem.
- One feature per isolated branch/PR to **main**. Never edit another agent's assigned files, directly push main, or silently change the shared contract.
- Claude Opus 5.5 reviews and integrates; ChatGPT Work owns frontend and opens separate PR.
- Electrical graph is computational source of truth; coordinates/visual layouts are not.
- Never fake provider traces, confidence, test results, deployments, metrics or costs. Clearly mark samples and hypotheses.
- **Gemini 3.8 free-tier access is unverified** until a real image/JSON API smoke test. Never enable paid billing without explicit user approval. Jev receives structured state, not images; optional second model runs only if configured and actually available.
- Server keys only, upload/timeout limits, no high-voltage repair instructions, explicit human confirmation before mathematical solve.
- After feature freeze, implement P0 fixes only, with regressions and deployed verification.
- Every handoff includes PR URL, base SHA, changed files, actual tests, provider calls, risks and blockers.
