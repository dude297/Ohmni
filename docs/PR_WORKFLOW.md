# PR-first Multi-Agent Engineering Workflow

## Control plane
Claude Opus 5.5 = coordinating lead. It delegates to bounded agents/parallel sessions with isolated Git worktrees and task-specific branches. ChatGPT Work is a separate frontend contributor, NOT a direct committer to main. Main is always releasable. Every feature, including docs, ships via one PR.

## Mandatory process
1. Coordinator reads docs/PRD.md, docs/ARCHITECTURE.md, docs/API_CONTRACT.md and this file. Inspect current main before work.
2. Establish code skeleton/contracts as the first PR. Assign independent worktree + branch for each feature (`feat/solver`, `feat/extraction`, `feat/jev-router`, `feat/diagnostics`, `feat/ui-workspace`, `chore/deployment`). Agents may not edit overlapping file paths.
3. Each agent commits, runs relevant tests/build checks, opens a PR to main, and reports PR URL plus evidence.
4. Coordinator reviews code diff, PR description, test output and Prelint feedback when installed. It either **comments with specific findings/tests to add** and requests a revision, or **merges** after gates clear. No rubber-stamp merging.
5. Merge order follows dependency graph: contracts -> solver -> extraction -> Jev routing -> workspace UI -> diagnosis -> deployment. Rebase branches before merge. Reviewers never change main directly.
6. Coordinator posts concise integration status regularly; stop spawning tasks after feature freeze.

## Merge gate (all required)
- CI lint/typecheck/unit tests/build green, or verified local equivalent if hosted CI is unavailable (never represent red/missing CI as green).
- Scope matches PRD and no uncontrolled API contract drift.
- Review comments addressed (or explicitly explained and accepted by coordinator), Prelint checks considered if configured.
- Security: no credentials, unsafe client-side model calls, uncontrolled upload size, missing error handling.
- Math tests known-correct incl 5V divider and malformed circuits for relevant PRs.
- Runtime traces not simulated or hardcoded as real outputs.
- Coordinator authorizes merge only after verification; if branch protection disallows, request the repository owner's help.

## Limits
Use up to 4-6 meaningful concurrent implementers (not 15 agents competing for dependencies). Split further only when worktree/tool capacity genuinely allows it. No uncontrolled nested subagents, no repeated expensive provider calls without caps. Max two repair rounds per PR before escalation/cut. Time budget dominates elegance.

## Prelint
Prelint GitHub App can review product/architecture drift from docs. The provided prelint.json uses `tag_only` to control per-review spend: mention `@prelint` once when each PR is review-ready, after initial tests. It is optional and may have per-review charges (verify billing); do not make setup a hard blocker. A clean Prelint result does not replace test/security review.
