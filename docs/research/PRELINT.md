# Prelint GitHub integration: evaluation and proposed config

**Status:** research. **Nothing is installed, and no `prelint.json` is committed.** The config below is a proposal only.

**Sources** (official, accessed 2026-10-11; no page carries a "last updated" date):
- https://prelint.com
- https://prelint.com/pricing
- https://prelint.com/docs
- https://prelint.com/docs/configuration
- https://prelint.com/docs/how-reviews-work
- https://prelint.com/docs/billing

Repo facts: `gh repo view dude297/Ohmni` → **PUBLIC** (2026-10-11). `docs/PR_WORKFLOW.md` and `docs/CLAUDE_ORCHESTRATOR.md` only call Prelint "optional/nonblocking, may incur cost". I found **no** existing `prelint.json` or `tag_only` mention in this repo.

## What it is
A GitHub App that reviews each PR against the repo's own written specs, not generic lint.
- It reads markdown in the repo as context, in priority order: org specs, project specs, repo markdown, then READMEs/docs, within an **80K-character budget**. Lower-priority files are truncated first.
- `context_files` lets us force the important specs in.
- Output:
  - a summary comment, updated in place;
  - inline comments with severity;
  - finding categories (Documentation / Product / Security / Tooling);
  - a GitHub **check run**: Success = review posted, Neutral = skipped.
- It blocks merges only if branch protection requires that check. The docs don't say it blocks by itself.
- It re-reviews on new commits and auto-resolves stale findings.
- There is also an MCP server (Claude/Cursor/VS Code/ChatGPT) so agents can query specs. The docs list no CLI.

## Trigger modes (`trigger_mode`)
- **`"auto"` (default):** reviews on PR open, reopen-from-draft and **every new commit**. Each push to a busy PR is another review.
- **`"tag_only"`:** "nothing starts by itself". A review runs only when someone with **write access** comments `@prelint` on a PR (this works on drafts) or presses Run review in the dashboard.
- **Filters:**
  - `exclude_authors` defaults to dependabot, renovate, github-actions and snyk bots.
  - `include_authors` is an allowlist.
  - `ignore_patterns` are globs, with `!` to re-include.

## Pricing and cost exposure (documented)
- **$1 per completed review**, prepaid. Failed, timed-out and cancelled reviews are free. Re-reviews (new commits, force-push) cost $1 each.
- **$10 free credits** for each new org, with no card required.
- **Public repositories: "Reviews on public repositories are free."** Ohmni is public today, so expected cost is **$0**. This holds only while the repo stays public; making it private turns on $1 per review.
- **Auto-recharge is ON by default:** when the balance drops below $10, it adds $20. The minimum top-up is $10 and the maximum $1,000. Turn it off in Settings → Billing, and set a **monthly spending limit** there; reviews pause when the limit is hit.
- **Worst case:**
  - With auto-recharge off and no card, exposure is capped at the $10 free credit.
  - With a card and auto-recharge on, in `auto` mode on a private repo, cost is roughly $1 × pushes. Our multi-agent PRs often see 5–15 pushes, so about $5–15 per PR.

## Recommendation
**Install, but only in `tag_only` mode, only on `dude297/Ohmni`, with auto-recharge OFF and no card.**
- Use it as an *advisory* spec reviewer: the reviewer comments `@prelint` once a PR is ready for merge review.
- Do **not** make its check required. Per PR_WORKFLOW, "Do not treat Prelint approval as functional proof"; tests, build and hosted checks remain the gate.
- Before the 3:30 PM freeze, do not install at all; it adds review noise during a freeze.

## Owner actions (exact)
1. (After step 4.) Go to https://app.prelint.com → **Connect GitHub** and sign in as the repo owner.
2. Install the GitHub App on account `dude297` and choose **"Only select repositories" → Ohmni**. Review the permission list on GitHub's install screen. The Prelint docs I read don't enumerate the permissions (**unverified**); expect PR read/write, comments and checks.
3. **Settings → Billing:** turn **auto-recharge off**, set the **monthly spending limit** to the lowest value allowed, and add no payment card.
4. **Merge the `prelint.json` below to `main` first, then install.** Without the config, the app runs in **auto** mode and reviews every push. That is free while the repo is public, but it is noisy. It is also unverified whether Prelint reads the config from the base branch or the PR branch, so merging to `main` first covers both.
5. On a PR, comment `@prelint`. Treat findings as review input only.
6. To remove it: GitHub → Settings → Applications → Prelint → Uninstall.

## Proposed `prelint.json` (NOT committed)
```json
{
  "version": 1,
  "trigger_mode": "tag_only",
  "exclude_authors": ["dependabot[bot]", "renovate[bot]", "github-actions[bot]", "snyk-bot"],
  "include_authors": [],
  "ignore_patterns": ["package-lock.json", "fixtures/**", "public/**", "docs/demo/**", "**/*.png"],
  "context_files": [
    "docs/API_CONTRACT.md", "docs/ARCHITECTURE.md", "docs/MODEL_ACCESS.md", "docs/PRD.md",
    "docs/PR_WORKFLOW.md", "docs/QA_ACCEPTANCE.md", "CLAUDE.md", "AGENTS.md"
  ],
  "output": { "comments": true, "check_run": true },
  "rules": [
    { "name": "No fabricated model traces or probabilities",
      "description": "ModelTraceEvent entries (provider, model, durationMs, status, confidence, usage) must come from a real call result or be status 'skipped'/'error' with a note. Flag hard-coded, randomised or default confidence/probability values, invented token usage, traces emitted when no call was made, and UI text that shows a model's self-reported confidence as a calibrated probability. Probabilities shown to users may only come from the measurement-based probe posterior or from a cited labelled-set evaluation." },
    { "name": "Human confirmation before solving",
      "description": "/api/solve, /api/probe and /api/explain must reject requests unless userConfirmed === true and validateGraph passes. Flag any removal or weakening of this gate, any client code that sets userConfirmed without an explicit user action, and any path that solves a model-extracted graph the user has not confirmed." },
    { "name": "No unsupported electrical-safety claims",
      "description": "Ohmni supports low-voltage DC resistor/source circuits only. Flag copy or code that claims something is 'safe', guides mains/high-voltage/high-energy work, tells users to power a circuit whose candidate topology shorts the supply, or drops the existing SAFETY text. Measurements are hypotheses, not confirmed faults." },
    { "name": "Model roles must match docs/MODEL_ACCESS.md",
      "description": "Vision models (Groq qwen, Gemini) read images; Jev only chooses a route from a structured summary and never receives pixels; all voltages/currents/resistances come from the local MNA solver (solveDC), never from an LLM. Flag an LLM computing circuit values, Jev being sent images, or a model's numeric output used as a solved result." },
    { "name": "No paid-model or billing escalation",
      "description": "Flag any use of jev-1.13 (paid; only jev-1.13-free is allowed), any OpenAI/Anthropic/other paid API call or SDK, enabling Gemini billing, auto top-up, raised spend limits, or new keys, unless the PR links explicit owner approval. Secrets must stay server-side: no API keys in NEXT_PUBLIC_* or client bundles, no logging of keys or uploaded images." },
    { "name": "CircuitGraph and solver contract stability",
      "description": "src/lib/circuit/types.ts mirrors docs/API_CONTRACT.md v1 (schemaVersion 1, kinds resistor|dc_voltage, groundNode 'GND', SI units). Flag changes to these types, validateGraph or solveDC behaviour without a matching API_CONTRACT.md update and tests covering both known voltage cases (10k/10k divider at 5 V gives 2.5 V) and malformed/floating-graph errors." },
    { "name": "New dependencies need justification",
      "description": "Flag any added dependency in package.json unless the PR description states why existing code, the standard library or an installed package cannot do it, plus its licence and bundle/runtime impact." },
    { "name": "Claims must not exceed implementation",
      "description": "Flag README, docs, UI copy or PR descriptions that claim features, accuracy figures, provider participation or test results that the diff and repo do not implement or evidence (e.g. 'verifies topology' when no independent check runs, 'calibrated' without a labelled-set result, research code under docs/research or src/lib/topology described as shipped)." }
  ]
}
```
**Unverified:** whether `rules` accepts fields beyond `name` and `description` (the docs show only those two), and whether `context_files` counts toward the 80K budget ahead of auto-indexed docs.
