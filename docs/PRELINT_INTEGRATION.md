# Prelint integration

## Verified repository state — October 11, 2026

The GitHub App is installed and has reviewed Ohmni pull requests. The checked-in [configuration](../prelint.json) uses schema version 1 and `trigger_mode: auto`. This documentation pass does not change that configuration, account settings, credits or billing.

The owner explicitly authorized manual reviews while [PR #67](https://github.com/dude297/Ohmni/pull/67) was draft; it has since merged into integration. On application commit `e1e97dd61ec0a924683e4d128a4dc0241044e05f`, both checks completed successfully: technical review **LGTM**, decision review **Ship with changes**. Three product findings were corrected; remaining recommendations are recorded in [the Living Schematic handoff](ui-review/LIVING_SCHEMATIC.md#prelint-follow-up). Check success does not mean unconditional product approval or hosted-release sign-off, nor does it cover later integration commits.

## Configuration and triggers

The [official configuration reference](https://prelint.com/docs/configuration) documents author filters, trigger mode, ignore patterns, context files, comments/check outputs and custom rules. Automatic reviews normally skip drafts; an explicit `@prelint` comment can review a draft in auto mode. A new commit needs a new explicit tag for an on-demand review. See [how reviews work](https://prelint.com/docs/how-reviews-work), checked October 11, 2026.

Use the existing configured review process. Do not weaken or change review settings as part of an unrelated task. A documentation-only pass does not itself authorize new account charges or require another paid review.

| Repository rule | Review concern |
| --- | --- |
| Runtime model honesty | Actual provider events, evidence-based probabilities and honest failures |
| Required human confirmation | Reviewed graph, server gate and invalidation after edits |
| Math correctness | Deterministic MNA authority and grounded tutor numbers |
| Safe model routing | Groq-first/Gemini fallback, structured Jev routing and pacing |
| Electrical safety scope | Low-voltage DC only; hypotheses and safe physical follow-up |
| API compatibility | Published contracts and canonical graph types |
| Release integrity | Supported claims, secrets, spending authorization and deployment evidence |
| Hosting | Anbaric primary, Vercel fallback and verified deployment changes |

Generated images, recordings, lockfiles and UI review captures are ignored by the existing configuration; product/architecture/contract documents supply context. Prelint review remains advisory and does not replace lint, types, tests, build, browser QA or independent review.

## Billing evidence

Earlier notes inferred that public-repository reviews must cost $0. That inference is not account-specific evidence and is superseded: the release ledger records a credit/subscription dispute and neutral checks on #62. Successful reviews and `trigger_mode` do not establish which credits were consumed or whether auto-recharge is enabled.

For current terms, consult [official billing documentation](https://prelint.com/docs/billing). Actual balance, charges and recharge state require the owner's account evidence; this pass did not inspect or alter them. The owner's explicit review authorization on #67 is separate from any claim that a review is free.

## Historical integration evidence

- [First review on #51](https://github.com/dude297/ohmni/pull/51#pullrequestreview-5484868357): pricing-documentation finding.
- [Automatic review on #51](https://github.com/dude297/ohmni/pull/51#pullrequestreview-5484888002): stale installation-status finding.
- [Dated release ledger](RELEASE_E2E_2026-10-11.md): earlier manual-trigger configuration and #62 credit/subscription limitation. These entries describe their recorded period, not the current checked-in trigger mode.

## Optional MCP and findings

The optional MCP setup is separate from the GitHub reviewer and uses owner OAuth. Follow [official setup](https://prelint.com/docs/mcp); a committed registration does not prove current authentication. No MCP or OAuth setup was performed in this documentation pass.

Verify each finding against the actual code and requirements. Correct valid findings on the owning branch; explain disputed findings or explicit deferrals in the PR. Do not equate a success check with permission to merge or deploy.
