# Ohmni — Free-Tier Model Access and Routing Gate

**Important:** A free price listing does not guarantee this Google API project can invoke Gemini 3.8 Flash, that quota remains, or that images/JSON are enabled. No paid billing without explicit owner consent.

## T0 real smoke test
1. Consult official models and pricing: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
2. From the actual project/API key, test a small image and structured JSON output with gemini-3.8-flash, then gemini-3.6-flash, then another currently listed accessible image model. Record exact ID, HTTP outcome, latency, schema validation and 429/quota behavior; never log keys/images.
3. Set GEMINI_MODEL only to a model that actually passed. If none passes, make manual graph input available and **do not claim real extraction**.
4. Make a real Jev decision call via BeatAPI (`POST https://api.beatapi.io/v1/systemone`, `BEATAPI_API_KEY`, model `jev-1.13-free`), validate returned choice. If unavailable, route to human clarification **and mark essential multimodel criterion not proven**.
5. Test optional second provider only with available credentials/authorization. Never count development-time Claude/Work coding as runtime model participation.

## Runtime policy
Image model extracts candidate; code validates; Jev reads structured summary and selects review_extraction / verify_topology / ask_user. Hard errors override decisions. Optional verify route calls specialist once at most; if no key/provider, explicit ask_user. No fake Jev confidence/probabilities. Timeouts, bounded retry, quota error UI. Keep tokens/usage actual when available; unknown ≠ free. Note free-tier provider data-use terms before uploading confidential circuit designs.

## Locked free-plan providers (zero usage-based charges)
| Role | Provider / model | Key | Free-plan limit | Paid fallback |
|---|---|---|---|---|
| Primary vision | Google Gemini `gemini-3.8-flash` (free tier) | GEMINI_API_KEY | per Google free-tier quota | none — never enable billing |
| Vision fallback + topology verifier | GroqCloud `qwen/qwen3.8-27b` | GROQ_API_KEY | Groq free plan limits | none |
| Routing decision | Jev `jev-1.13-free` via BeatAPI | BEATAPI_API_KEY | 1 successful call/min before any top-up | `jev-1.13` is paid → **refused in code** |
| Electrical math | Local TypeScript MNA | — | — | — |

Jev policy: one decision per analysis; in-process pacing (60s after a success; waits ≤8s for a near slot, else skips with an honest `skipped` trace); HTTP 429 honours `Retry-After` and blocks further calls until then. Pacing is per server instance; 429 handling covers parallel instances. Never top up, enable billing, or select a paid model id.

## Verified evidence
- 2026-10-11 Jev via BeatAPI, `jev-1.13-free`, real `choice` question: HTTP 200, 621 ms, choice=review_extraction, confidence 0.94, probabilities {review_extraction 0.96, verify_topology 0.03, ask_user 0.01}, usage 393 in / 49 out tokens.
- Gemini and Groq vision: see docs/VISION_FALLBACK.md (measured results only).

References: https://beatapi.io/jev-api · https://docs.typesafe.ai/introduction/quickstart
