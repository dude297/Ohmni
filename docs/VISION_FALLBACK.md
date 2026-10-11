# Vision fallback: Groq first (default), Gemini once — order via VISION_PRIMARY

`extractWithFallback` (src/lib/ai/vision.ts) calls Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash`) and, on a fallback-worthy failure, calls Groq `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`) exactly once. Each attempt has a 20 s hard timeout (Promise.race, because the Gemini SDK can hang past its abort signal). Both providers share the same prompt, the same zod normaliser (`toCandidateExtraction`) and `validateGraph`.

## Fallback triggers
| Gemini failure | Falls back? |
|---|---|
| 429 / RESOURCE_EXHAUSTED (`rate_limited`, `quota_exhausted`) | yes |
| 404, 503 UNAVAILABLE "high demand" (`model_unavailable`) | yes |
| timeout / hang >20 s | yes |
| other 5xx (`server_error`) | yes |
| missing GEMINI_API_KEY (`not_configured`) | yes |
| `malformed_output` (non-JSON) | **yes** (Groq is free tier, a second read is cheap) |
| other (401/403/400, config bug) | no, surfaced so it is not masked |

Groq is attempted only if `GROQ_API_KEY` is set; otherwise the trace has a `skipped` groq event with note `GROQ_API_KEY not configured`. If both fail: `graph: null`, warning `Automated extraction unavailable (<reasons>); enter the circuit manually.`, route `ask_user`, Jev skipped (nothing to route). After any successful extraction Jev still runs once.

Trace: one event per attempt with real model id, provider (`google`/`groq`), status, durationMs, usage and a note such as `fallback: gemini model_unavailable (503)`. The HTTP status is in the note; no keys, no image bytes, no SDK error text.

## Groq
Confirmed from console.groq.com/docs/vision: `qwen/qwen3.8-27b` is the only Groq vision model, with JSON mode with images, 20 MB / 3 images per request, and it is a Preview model. The docs/models page lists paid-tier pricing; we use the free tier only and never enable billing. Free-tier limit seen live: 1000 RPM but **8000 tokens/min** (an image call costs about 2.5k), so roughly 3 calls/min; those 429s classify as `rate_limited`.

The model returns `kind: "vsource"` for the source; the normaliser maps vsource/voltage_source/battery etc. to `dc_voltage`.

Groq is also the secondary topology verifier (`verifyTopology` in secondary.ts; the former OpenAI verifier is removed) when Jev picks `verify_topology`. Two models agreeing is NOT proof the circuit was read correctly; the trace note and a warning say so, and `requiresHumanReview` stays true.

## Live comparison (10 fixtures in fixtures/circuits, measured 2026-10-11)
`node scripts/vision-compare.mjs --env <.env.local>`; sequential, one attempt per call, no Jev. Accuracy and latency are over calls that returned a response; API errors are counted separately. Not an exhaustive benchmark: the fixtures are clean synthetic renders.

| model | calls | API errors | invalid output | component acc | node-connectivity exact | median latency | mean tokens in/out |
|---|---|---|---|---|---|---|---|
| gemini-3.8-flash (eval column only) | 3 | 3 (2x timeout >20 s, 1x 503); stopped after 3 consecutive failures | n/a | n/a | n/a | n/a | n/a |
| gemini-3.5-flash (primary) | 10 | 3 (503 UNAVAILABLE on fixtures 03, 05, 08) | 0/7 | 1.00 | 7/7 | 4223 ms | 1310/115 |
| groq qwen/qwen3.8-27b | 10 | 0 | 0/10 | 1.00 | 10/10 | 735 ms | 1208/233 |

An earlier Groq run at a 6 s gap hit the 8k TPM limit (4 of 7 calls 429); the table row is a rerun with a 25 s gap. Gemini 3.5-flash availability is intermittent (3/10 503s in this run; the coordinator later saw sustained 503s), which is exactly what the fallback covers.

## Order decision (2026-10-11)
Owner switched the default order to **Groq primary, Gemini fallback** based on the measured table above (Groq 10/10 exact, 0 API errors, 735 ms median; gemini-3.5-flash 3/10 503s, 4223 ms). `VISION_PRIMARY=gemini` restores Gemini-first. Same normaliser, validation and trace semantics in both orders. Fixtures are synthetic; no general accuracy claim.
