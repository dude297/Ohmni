# Ohmni — PR-First Multi-Agent Collaboration

**No integration branch. No direct commits to main.** Claude Opus 5.5 reviews/merges and deploys; Work submits UI PR. Each feature/change gets isolated branch/worktree, nonoverlapping write ownership, one PR to main.

## Process
1. Read ROADMAP/PRD/ARCHITECTURE/API_CONTRACT and inspect live main SHA/open PRs/CURRENT_STATE.
2. Docs+contract PR first. Backend work in parallel only against frozen contract.
3. Agents: circuit graph/MNA/tests (src/lib/circuit + tests), Gemini/Jev adapters (src/lib/ai), route integrator (src/app/api), DevOps/CI (config); Work UI (src/app/page.tsx, src/app/lab, src/components, src/app/globals.css). If actual repo uses app/ rather than src/app/, coordinator explicitly resolves ownership.
4. PR description must have scope, base SHA, dependencies, diff, commands/results, provider/host evidence if relevant, screenshots, security/cost notes, missing tests. No fabricated claims.
5. Claude reviews diff, stale base, validation, model fallbacks, secret leaks, numerical tests, CI/build, unresolved comments and optional Prelint. **Either** leaves actionable review comments and sends author to fix **or** merges only after reliable verification and authorization. Two repair loops max before scope cut.
6. Merge contracts → solver → extractor/Jev → API integration → Work UI → diagnosis → hosting. Rebase/retest dependent branches. No overlapping code rewrites.
7. Update CURRENT_STATE on important merges, provider tests, deployment and freeze.

## Review gate
Actual lint, typecheck, unit tests and build where application exists; if CI absent, say so and show verified local output. Check two known voltage cases, malformed/floating errors, no unsupported topology solved, honest Jev traces, no client keys. Do not treat Prelint approval as functional proof. Prelint/sponsor integrations are optional/nonblocking and may incur cost.

## Freeze
At ROADMAP T+150 stop feature PRs. Only P0 fixes after freeze, with regression and hosted verification. Release sign-off follows FREEZE_CHECKLIST only.
