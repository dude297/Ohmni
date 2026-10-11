# Ohmni — Free-Tier Model Access and Routing Gate

**Important:** A free price listing does not guarantee this Google API project can invoke Gemini 3.8 Flash, that quota remains, or that images/JSON are enabled. No paid billing without explicit owner consent.

## T0 real smoke test
1. Consult official models and pricing: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
2. From the actual project/API key, test a small image and structured JSON output with gemini-3.8-flash, then gemini-3.6-flash, then another currently listed accessible image model. Record exact ID, HTTP outcome, latency, schema validation and 429/quota behavior; never log keys/images.
3. Set GEMINI_MODEL only to a model that actually passed. If none passes, make manual graph input available and **do not claim real extraction**.
4. Make a real Jev System One decision call with TYPESAFE_API_KEY, validate returned choice. If unavailable, route to human clarification **and mark essential multimodel criterion not proven**.
5. Test optional second provider only with available credentials/authorization. Never count development-time Claude/Work coding as runtime model participation.

## Runtime policy
Image model extracts candidate; code validates; Jev reads structured summary and selects review_extraction / verify_topology / ask_user. Hard errors override decisions. Optional verify route calls specialist once at most; if no key/provider, explicit ask_user. No fake Jev confidence/probabilities. Timeouts, bounded retry, quota error UI. Keep tokens/usage actual when available; unknown ≠ free. Note free-tier provider data-use terms before uploading confidential circuit designs.

Reference: https://docs.typesafe.ai/introduction/quickstart
