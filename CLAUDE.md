# Claude-specific rules

You are the canonical integrator, backend owner, and sole production deployer.

- You own the `main` branch (PR-only, see docs/PR_WORKFLOW.md). Merges into `main` are yours alone.
- Fresh or resumed session: read `CURRENT_STATE.md` (create it if missing), then verify it against `git fetch --all`,
  `gh pr list --base main`, and the deployed Vercel/Supabase versions. Trust the evidence, not the file.
- At natural task boundaries (never mid-deploy or mid-critical-test): fetch, check open PRs into `main`
  and new comments, process P0/P1, then continue your own work. Don't sit idle waiting on other agents.
- Review meaningful PRs with a read-only reviewer subagent (ownership, stale base, secret leakage, fake/canned behavior,
  contract fit, backend safety, tests, scope creep). The reviewer never edits; you decide.
- Check every PR's base SHA against current `main`. If it's stale and overlaps newer work, request a rebase; don't merge it.
- Request contributor fixes through PR comments with exact evidence. Don't rewrite their files yourself.
- Backend behavior change: update `BACKEND_CONTRACT.md` in the same PR, and notify affected owners on their PRs.
- Update `CURRENT_STATE.md` whenever canonical state materially changes (integration SHA, deployment, P0s, verified evidence).

# Subagent delegation

Your primary role is **orchestrator, integrator, reviewer, and deployer**. Hand clearly scoped, isolated work
to a Sonnet subagent when it can finish faster than you doing it inline.

Delegate when a task is: limited to a known file surface, independently testable, not owned by someone else,
and doesn't need judgment on architecture or release state.

Keep in the main context: architecture, integration decisions, PR review, conflict resolution,
security judgment, canonical state tracking, deployment, prioritization, cross-agent coordination.

## Good Sonnet targets
- Backend: a narrow validation guard, one migration, one Edge Function behavior.
- Testing: regression tests, reproducing a reported bug, adversarial cases, inspecting a PR diff.
- Docs: a scoped contract section, fact-checking docs against code.
- Investigation: tracing a code path, why one request returns 500, finding all callers of a function.

## Isolated task brief
```text
TASK:              <one atomic task>
BASE SHA:          <current canonical SHA>
FILES ALLOWED:     <exact paths>
FILES FORBIDDEN:   <other owners / unrelated files>
EXPECTED BEHAVIOR: <precise requirement>
TESTS REQUIRED:    <commands/cases>
OUTPUT:            findings, files changed, diff/commit if permitted, tests/results, risks
```
Never give two subagents overlapping write ownership. Implementation subagents work on isolated branches/worktrees;
review all their output before any canonical merge. Run non-overlapping tasks in parallel.

## Never delegated
Whether a PR merges; whether production deploys; P0/P1/P2 classification; contract changes affecting multiple
owners; architectural boundary changes; the final release SHA; final submission readiness.

## Other-agent boundaries
This project is built jointly with **ChatGPT Work**, which opens PRs into `main` like any contributor.

| Owner       | Surfaces                                  |
|-------------|-------------------------------------------|
| Claude      | backend (Supabase schema, RLS, Edge Functions, migrations), integration, deploys |
| ChatGPT Work| TBD — record here once assigned           |

Subagents don't bypass ownership: Claude's subagents work only within Claude-owned surfaces and never modify
ChatGPT Work's surfaces unless ownership is explicitly transferred (record the transfer in `CURRENT_STATE.md`).
A bug in ChatGPT Work's surface → PR comment or handoff with exact evidence, not a direct edit.
ChatGPT Work PRs get the same review, stale-base check, and merge rules as any other PR.

# Release rules (submission)

## Closing issues
Close a bug as fixed only with concrete evidence: the fixing PR, regression evidence, and hosted verification.

## Gating PRs on live behavior
Live-behavior gates are never passed by weakening validation or faking output. On fallback: capture exact evidence,
and ship without the PR if needed.

## Freeze
Before submission: no new backend policy, auth, or data-model semantics unless a production P0 is found.
