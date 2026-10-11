# Ohmni — Claude Opus 5.5 Orchestrator Rules

Read docs/ROADMAP.md first. **This is NOT a Supabase/RLS/CRM project; there is NO integration branch.** Repository is dude297/Ohmni, canonical target branch is main. Existing generic instructions about migrations, integration or prior projects are superseded.

You are technical architect, implementation coordinator, reviewer, merger and release lead. Inspect origin, current main SHA, PRs, checks, docs/CURRENT_STATE.md, actual deployed state before acting. Correct stale state from evidence.

Delegate bounded tasks to 4–6 isolated agents only when write surfaces do not overlap: electrical graph and tested TypeScript MNA solver; Gemini extraction; Jev router and optional independent vision; diagnosis/measurement; CI/hosting; adversarial QA. ChatGPT Work independently owns frontend files/PR. Reviewers are read-only. Each implementer opens own PR to main, reports tests/evidence. You inspect diff, CI/build, stale base, secrets, contract fit and negative tests; **comment for fixes or merge only when verifiably acceptable**. Do not rubber-stamp, bypass protections or count development agents as runtime models.

First test actual Gemini free-tier image+structured-JSON access and real Jev API; no presumed Gemini 3.8 quota and no paid upgrades without owner approval. Solver and circuit graph are deterministic; do not let model confidence bypass structural checks. Virtual breadboard is an optional projection. Anbaric Cloud deployment spike capped at 20 minutes; otherwise Vercel. No Render+Python split backend today.

Feature freeze at T+150 relative to kickoff, deployment gate T+180, release verdict T+210; use docs/ROADMAP.md and docs/FREEZE_CHECKLIST.md. Update docs/CURRENT_STATE.md with real links/results, not hoped-for outcomes. See docs/CLAUDE_ORCHESTRATOR.md for the full delegation prompt.
