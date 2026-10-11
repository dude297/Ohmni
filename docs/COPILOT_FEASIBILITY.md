# Copilot SDK as a vision provider: feasibility

**Verdict: NO-GO for now. We defer it and do not ship it before the freeze.** No code was written and the app is unchanged.
Sources were accessed 2026-10-11. Package checked: `@github/copilot-sdk@1.0.19` on npm (deps: `vscode-jsonrpc`, `koffi` (native FFI), `zod`).

## Answers

1. **Vision model on Free/Pro/Pro+?** Partly. The SDK needs a Copilot subscription unless you use BYOK (your own provider keys) [1]. Images are accepted only when the model reports `capabilities.supports.vision = true` [3]. The docs **do not name** which models support vision, so this is *unverified* for our plans. Copilot Free covers "limited chat and agent usage with auto mode" [6], so we may not get to choose a vision model on Free (*unverified*).
2. **Image input + structured JSON?** Image input: **yes**. Attachments can be `file` (absolute path) or `blob` (base64), and oversized images are auto-resized [3]. Structured JSON: **not documented** in the SDK image docs [3]. It is a chat/agent session, so we would have to parse free text with our existing `toCandidateExtraction` fallback (*unverified*).
3. **Whose allowance?** For multi-user apps the official model is **per-user GitHub OAuth**. Our app would get each visitor's `gho_`/`ghu_`/`github_pat_` token, "Copilot usage is billed to each user's subscription", and "Each user needs an active Copilot subscription" [2]. The multi-tenancy guide says: "Avoid sharing one service token across users unless your product intentionally uses service-account semantics" and lists "Sharing one `gitHubToken` across users" as a common pitfall [4]. **Serving the public with one developer's subscription goes against official guidance.** It would also be an individual plan used as a shared service account, which we treat as not permitted (*no explicit ToS clause found; conservative reading*).
4. **Vercel serverless?** **Poor fit.** "The SDK manages the CLI process lifecycle", and Node bundles the Copilot CLI [1]. The backend-services guide runs the CLI "as a persistent server process (not spawned per request)" that the backend reaches over TCP. It keeps session state on local disk, has no built-in auth between SDK and CLI, and is a single point of failure [5]. We would have to either spawn a CLI child process for each cold start inside a Vercel function (*untested*; `koffi` native binary, bundle size, timeouts) or run new persistent infrastructure.
5. **Limits/billing.** Since 2026-06-01 every Copilot plan uses **usage-based billing with AI Credits** (1 credit = $0.01) [6][7]. SDK prompts count against the allowance in the same way as the CLI [1][7]. Once credits run out, usage continues **only if a budget for additional usage is set, and that overage is billed automatically** [7]. Legacy annual plans get 300 (Pro) or 1,500 (Pro+) premium requests, with extras at $0.04 each [8]. The docs give no per-request rate limits for the SDK (*unverified*). This conflicts with our zero-usage-billing rule.
6. **Without forcing GitHub sign-in?** **No**, unless we share one token, and #3 rules that out. The only compliant multi-user path needs every visitor to sign in with GitHub **and** hold their own Copilot subscription [2][4]. BYOK avoids GitHub auth but is just another paid provider key, so it adds nothing over Gemini/Groq [1].
7. **Fits `VisionExtractor`?** Technically yes, as a blob attachment plus `toCandidateExtraction` + `validateGraph`, with no change to the CircuitGraph contract. In practice it would need per-request user tokens, which our routes and UI don't have.
8. **Reliability vs Groq?** **Unmeasured.** No authenticated test was run. Groq is already 10/10 exact on our 10 fixtures (median 735 ms, 0 errors), so there is no room left to show a gain. A process-spawning agent runtime adds failure modes (cold start, CLI crash, auth expiry).

## GO criteria check
| Criterion | Result |
|---|---|
| Officially supported path | Pass (official SDK) |
| No sharing one dev subscription with the public | **Fail**: the only no-login path is a shared token, which the docs advise against [4] |
| No usage-based billing / paid escalation | **Fail**: AI-Credit usage billing; overage billed when a budget is set [7] |
| Real image input | Pass [3] |
| App unchanged when Copilot is unavailable | Would pass (flagged off) |
| Manageable Vercel runtime | **Fail/unverified**: persistent CLI server recommended [5] |
| Achievable before 3:30 freeze | **Fail**: needs GitHub OAuth app + login UI, both out of scope |
| No disruption to Gemini/Groq/Jev/prod | Pass (nothing shipped) |

## Blockers
- Per-user OAuth plus a per-user Copilot subscription is the only compliant multi-user model. That means a GitHub login wall for judges and visitors.
- Usage-based AI-Credit billing, with automatic overage once a budget exists.
- Runtime is a bundled CLI subprocess or a persistent CLI server, not a plain HTTPS call.

## Cost / billing exposure if shipped anyway
With a shared dev token, every public upload burns the developer's AI Credits. If a budget is set, overage is charged at $0.01/credit. That breaks the team's zero-usage-billing rule and the shared-token guidance.

## Recommendation
**Defer.** Keep Gemini → Groq → Jev as they are. Revisit only post-hackathon, as an opt-in "Sign in with GitHub to use your own Copilot" feature on non-serverless infra (or a long-lived CLI server), and only after an authenticated vision test that names a vision-capable model.

## Sources (accessed 2026-10-11)
1. https://github.com/github/copilot-sdk (README: auth methods, subscription requirement, billing, bundled CLI)
2. https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth
3. https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/image-input
4. https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy
5. https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/backend-services
6. https://github.blog/changelog/2026-06-01-updates-to-github-copilot-billing-and-plans/ and https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/
7. https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing
8. https://docs.github.com/en/copilot/concepts/billing/copilot-requests (legacy request-based billing)
