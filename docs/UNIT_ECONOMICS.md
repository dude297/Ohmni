# Ohmni — Production Readiness and Unit Economics

**Never claim free-tier API = zero production marginal cost.** Actual cost per successful diagnosis includes image input/output tokens, Jev requests, conditional secondary vision calls, retries and hosting variable cost. Use current *dated* official provider prices. Unknown provider/token accounting remains **unknown**, not $0.

## Calculation
Cost per success = initial multimodal inference + Jev routing + fraction of cases needing a second model × specialist cost + retries/failures amortized + server cost. Track provider model ID, timestamps, tokens if returned, requests/route, elapsed ms, response status and successful cases. Exclude secrets and raw uploaded images from logs.

## Routing theory
Jev might reduce cost/latency by selecting a second expensive provider only on ambiguous inputs instead of universally. **Do not claim savings without a measured same-case baseline.** Include a small held-out comparison clear vs ambiguous and disclose sample size.

## Revenue hypothesis
EE lab/instructor subscription and later engineer/prototyping team licenses. Value = less rework and troubleshooting time, not invented willingness-to-pay. Validate with pilot interviews/time-to-diagnosis and instructor intervention count.

Current actual metrics: **not measured**. Current provider costs/quota: **not verified**. Update these only with evidence.
