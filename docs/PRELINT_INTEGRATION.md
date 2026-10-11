# Prelint integration

Status (2026-10-11 13:45 PDT): **GitHub App installed** on dude297/Ohmni by the owner; `trigger_mode: auto` (temporarily tag_only 14:55–15:55 PDT while the credit balance was exhausted; owner restored credits — 250 reviews — and re-enabled auto reviews) verified — Prelint reviewed PR #51 on @prelint and again automatically on the next push (see Evidence).

## Install (owner, interactive OAuth - cannot be done by an agent; completed 2026-10-11)

1. Open https://app.prelint.com and Sign in with GitHub.
2. Install the Prelint GitHub App on the `dude297` account.
3. Choose **Only select repositories** -> `dude297/Ohmni` -> Install.
4. Billing -> Settings -> Billing: turn **auto-recharge OFF**; do not add a card.
5. On the PR "chore: Prelint integration (config v1 + docs)", comment `@prelint`.

## Config (`prelint.json`, schema v1)

Fields used, per https://prelint.com/docs/configuration (accessed 2026-10-11): `version`, `trigger_mode`, `exclude_authors`, `include_authors`, `ignore_patterns`, `context_files`, `output.comments`, `output.check_run`, `rules[{name,description}]`. No published JSON-schema file; validated against the documented field table plus `JSON.parse`.

- `trigger_mode: "auto"`: every PR event triggers a review. Chosen because public-repo reviews are free (see Pricing). `"tag_only"` is the alternative (only `@prelint` or the Run review button); switch back if the repo ever goes private.
- `output`: inline comments + GitHub check run summary.
- `ignore_patterns`: lockfile and generated assets (png, webm, demo/ui-review captures, samples, `.next`).
- `context_files`: product/architecture/contract docs and agent instructions (all verified to exist).

| Rule | Why |
|---|---|
| Runtime model honesty | Product credibility: traces/confidence must be real. |
| Required human confirmation | Solver must never run on unreviewed extraction; edits invalidate results. |
| Math correctness | Local MNA solver is authoritative; LLM explanations grounded in its values. |
| Safe model routing | Groq-first/Gemini fallback, real Jev routing, free-tier pacing, honest failures. |
| Electrical safety scope | Low-voltage DC resistive only; no fault certainty or energized resistance measurement. |
| API compatibility | `/api/extract|solve|probe|explain` match `docs/API_CONTRACT.md` and `types.ts`. |
| Release integrity | No fake demos/unsupported claims/hidden paid escalation/undocumented prod migrations. |
| Hosting | Anbaric primary, Vercel fallback; changes need deployment evidence. |

Prelint's own docs say it targets the product layer (spec/decision compliance, scope drift), not style, bugs, security scanning or types. Rules are written in that spirit.

## Triggering

- Auto: opens/updates of a PR by non-excluded authors.
- On demand: comment `@prelint` on a PR (or use the Run review button in the app). Use this if auto is ever switched to `tag_only`, or to re-run.

## MCP (optional)

```
claude mcp add --transport http --scope project prelint https://app.prelint.com/mcp
```

Docs give `claude mcp add --transport http prelint https://app.prelint.com/mcp` (https://prelint.com/docs/mcp); `--scope project` writes a shared `.mcp.json`. Auth is OAuth only (no API key), so `.mcp.json` contains no secrets, but the owner must complete the interactive sign-in. The MCP server exposes the decision ledger (search/ingest/curate statements); it is not the PR reviewer. Not run by this PR.

## Pricing verification

Source https://prelint.com/docs/billing, accessed 2026-10-11:

- "Reviews on public repositories are free."
- "You pay $1 per completed review from a prepaid credit balance. No seats, no subscription."
- "Every new organization gets $10 in credits, with no credit card required."
- "Auto-recharge is enabled by default. The system automatically adds $20 when your balance drops below $10 ... or disable auto-recharge entirely through Settings -> Billing."

How these reconcile: the $1-per-review credit charge applies to **private** repositories; the same page states public-repository reviews are free, and `gh repo view dude297/Ohmni --json visibility` -> `PUBLIC`, so Ohmni's reviews are expected to cost $0. The owner should still confirm the credit balance is unchanged after the first reviews (not yet checked by an agent) and keep auto-recharge OFF so no charge is possible if the repo ever became private.

## Evidence

- Installation confirmed: owner installed the Prelint GitHub App on dude297/Ohmni (2026-10-11); Prelint check runs and a review appear on PR #51.
- First Prelint review (PR #51, commit a5b607a, 2026-10-11 20:39 UTC = 13:39 PDT): https://github.com/dude297/ohmni/pull/51#pullrequestreview-5484868357 — 1 finding (WARNING, `docs/PRELINT_INTEGRATION.md:50`): pricing quotes not reconciled. Valid; fixed in the following commit by the "How these reconcile" paragraph above.
- Second, automatic review (trigger_mode auto, commit 4390c5f): https://github.com/dude297/ohmni/pull/51#pullrequestreview-5484888002 — 1 finding: stale "NOT installed" status lines; valid, fixed in the next commit.
- Prelint check runs on a5b607a: "Prelint" success https://github.com/dude297/ohmni/runs/114569525836 ; "Prelint: Decision Review" success https://github.com/dude297/ohmni/runs/114569527153
- MCP: registered at project scope (`.mcp.json`); OAuth sign-in pending owner (`/mcp` in Claude Code).
- Checked 2026-10-11: `gh api repos/dude297/Ohmni/commits/main/check-runs` shows only `github-actions`; no Prelint check runs. `gh api repos/dude297/Ohmni/installation` returned 401 (needs app JWT), so install state was inferred only from the absence of check runs.

## How agents handle Prelint findings

- Treat as advisory review input, not ground truth.
- Verify each finding against the code and docs; fix valid ones in the PR.
- Never auto-dismiss; reply with a reason when a finding is wrong.
- Prelint never replaces CI (`npm run lint`, tests, build).

## Outstanding blockers

1. ~~Install the GitHub App~~ - done.
2. Owner to confirm auto-recharge is OFF and the credit balance is unchanged after reviews (not verifiable by an agent).
3. Optional: owner OAuth sign-in for the MCP server (`/mcp` in Claude Code); `.mcp.json` is committed.
