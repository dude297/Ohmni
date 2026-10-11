# Ohmni — Production Readiness and Unit Economics

**Never claim free-tier API = zero production marginal cost.** Actual cost per successful diagnosis includes image input/output tokens, Jev requests, conditional secondary vision calls, retries and hosting variable cost. Use current *dated* official provider prices. Unknown provider/token accounting remains **unknown**, not $0.

## Calculation
Cost per success = initial multimodal inference + Jev routing + fraction of cases needing a second model × specialist cost + retries/failures amortized + server cost. Track provider model ID, timestamps, tokens if returned, requests/route, elapsed ms, response status and successful cases. Exclude secrets and raw uploaded images from logs.

## Routing theory
Jev might reduce cost/latency by selecting a second expensive provider only on ambiguous inputs instead of universally. **Do not claim savings without a measured same-case baseline.** Include a small held-out comparison clear vs ambiguous and disclose sample size.

## Revenue hypothesis
EE lab/instructor subscription and later engineer/prototyping team licenses. Value = less rework and troubleshooting time, not invented willingness-to-pay. Validate with pilot interviews/time-to-diagnosis and instructor intervention count.

## Current operating mode (hackathon)
All runtime model calls run on free plans: Gemini free tier, Groq free plan, Jev `jev-1.13-free` via BeatAPI ($0, paid `jev-1.13` refused in code). Usage-based API charges for this deployment: **$0 by construction** — this is a free-plan constraint, not a production marginal-cost claim. Free-plan limits (e.g. Jev 1 call/min) cap throughput; production would need paid tiers priced from measured tokens.

Current actual metrics: **not measured**. Current provider costs/quota: **not verified**. Update these only with evidence.

## Measured per-run trace (coordinator, production, 2026-10-11)
| Stage | Model | Status | Latency | Tokens in / out | Source |
|---|---|---|---|---|---|
| Extract | gemini-3.5-flash | ok | 3790 ms | 1310 / 106 | measured, clean divider run |
| Route | jev-1.13-free (BeatAPI) | ok | 440 ms | 475 / 49 | measured, same run |
| Solve | local | ok | ~1 ms | n/a | measured |
| Jev probe | jev-1.13-free | ok | 621 ms | 393 / 49 | measured, earlier probe |
| Gemini probe | gemini-3.5-flash | ok | 3570 ms | 1139 / 85 (+590 thinking) | measured; thinking tokens bill as output on Gemini, absent from the clean run's count |
| Groq probe | qwen/qwen3.8-27b vision+JSON | 200 | 583 ms | not recorded | measured latency only |

Sample size: one clean run plus probes. These are anecdotes, not distributions.

## Listed prices and limits (accessed 2026-10-11)
- Jev: `jev-1.13-free` $0; `jev-1.13` $0.042/1M input, output free; 1 successful call/min before first top-up, 10/min after. https://beatapi.io/jev-api
- Gemini `gemini-3.5-flash`: paid price **not listed** at https://ai.google.dev/gemini-api/docs/pricing (page lists other Flash variants). Free-tier limits **not listed** at https://ai.google.dev/gemini-api/docs/rate-limits (AI Studio only).
- Groq `qwen/qwen3.8-27b`: paid price **not listed** at https://groq.com/pricing. Free plan: 30 RPM, 1K RPD, 8K TPM, 200K TPD, https://console.groq.com/docs/rate-limits

## Free-tier ceiling
Usage charges now: $0 per analysis. Binding limit: Jev 1 call/min, so **1 analysis/min (1440/day)** at one Jev call per analysis. Groq-only fallback, assuming Gemini-like tokens (unmeasured): about 5/min by TPM, 141/day by TPD. Unlocking Jev's 10/min needs a top-up, which this deployment refuses in code.

## Hypothetical paid cost per analysis (`node scripts/cost-model.mjs`)
| Scenario | Jev | Gemini | Groq | Paid total / analysis |
|---|---|---|---|---|
| clear (Gemini+Jev) | $0.0000200 | not listed | - | incomplete (>= $0.0000200, Jev only) |
| ambiguous (Gemini+Jev+Groq verify) | $0.0000200 | not listed | not listed | incomplete (>= $0.0000200, Jev only) |
| Gemini fails (Groq+Jev) | $0.0000200 | - | not listed | incomplete (>= $0.0000200, Jev only) |

Measured: Gemini and Jev tokens. Listed: Jev price. Assumed: Groq tokens (= Gemini's). Gemini and Groq paid cost is unknown until their prices are confirmed; rerun with `--gemini-in= --gemini-out= --groq-in= --groq-out=` ($/1M). Excludes thinking tokens, retries, hosting.

## Jev routing hypothesis
Hypothesis: Jev decides cheaply (475 in tokens, 440 ms, $0.0000200 at paid rate) whether a second, costlier vision call (Groq verify) is needed, so only ambiguous cases pay for it. Not yet measured on a held-out set: no ambiguity rate, no same-case always-verify baseline, so no savings claim.

## Pricing hypothesis for EE labs
Unvalidated. Charge a per-seat or per-course subscription for labs/instructors; value is fewer instructor interventions and shorter time-to-diagnosis. No price is proposed: willingness-to-pay needs pilot interviews. Cost floor: unknown until Gemini and Groq paid prices are confirmed.
