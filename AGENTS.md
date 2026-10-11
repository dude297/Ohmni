<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in node_modules/next/dist/docs/ (resolved from this file's directory; in monorepos the next package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by next dev — verify at node_modules/next/dist/server/lib/generate-agent-files.js. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ohmni — Shared Instructions for All Coding Agents

**Authoritative files:** docs/ROADMAP.md for priorities/timetable/freeze; docs/API_CONTRACT.md for payloads; docs/ARCHITECTURE.md for runtime; docs/PR_WORKFLOW.md for ownership/reviews.

- Product is **Ohmni**. Do not reintroduce CircuitScout into branding.
- Judges: multimodel integration, differentiation, production/economics, E2E demo, paying-user pain.
- Feature isolation: one branch + one reviewed PR per feature to **main**. Never edit someone else's files, directly push main, or silently change types.
- Claude Opus 5.5 integrates; ChatGPT Work submits independent UI PR.
- **Canonical graph**, not breadboard coordinates, drives mathematics.
- **Gemini 3.8 free-tier project access is unverified** until a real image/JSON smoke test. No paid billing without authorization. Jev receives structured state, not pixels.
- No fake provider traces, results, deployments or cost savings; clearly label fixtures, predictions, and hypotheses.
- Server-only secrets, upload/timeouts, safe DC scope, manual confirmation before solving.
- Feature freeze: P0 fixes only, with regression and deployed evidence.
- Handoffs must include PR URL, SHA, files touched, commands/results and blockers.
