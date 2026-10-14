# Ohmni — Privacy and AI Data Flows

Plain statement of what leaves the browser, who receives it, and what Ohmni keeps. Where a provider policy was not checked, this page says **not verified** rather than guessing.

## What goes to third-party AI providers

| Route | What is sent | Provider (model) | When |
|---|---|---|---|
| `POST /api/extract` | The uploaded image (png/jpeg/webp, after magic-byte check) | Google Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash`) | As fallback when Groq fails (default), or first when `VISION_PRIMARY=gemini` |
| `POST /api/extract` | The uploaded image | Groq (`qwen/qwen3.8-27b`) | First reader by default (`VISION_PRIMARY` unset), fallback when `VISION_PRIMARY=gemini`, and the `verify_topology` second reader |
| `POST /api/extract` | A text summary of the extracted circuit: component ids, kinds, values, node names, warnings, validation errors. **Not the image.** | Jev `jev-1.13-free` via BeatAPI | After a successful extraction (paced, may be skipped) |
| `POST /api/explain` | The confirmed circuit graph and solver results | Google Gemini (`EXPLAIN_MODEL`, default `gemini-3.5-flash-lite`) | Every call, if `GEMINI_API_KEY` is set |
| `POST /api/review` with `mentor` | The circuit graph and the selected finding | Google Gemini (`EXPLAIN_MODEL`) | Only when the mentor is requested; the deterministic review is local |

All other routes (`/api/solve`, `/api/probe`, `/api/probe-multi`, `/api/repair`, `/api/repair/verify`, `/api/twin`, `/api/topology`, `/api/ac`, `/api/firmware/adc`) run locally on the server (MNA solver, ngspice) and send nothing to an AI provider.

## Provider retention and training

- All runtime model calls use **free plans** (docs/UNIT_ECONOMICS.md). Free tiers of AI APIs commonly allow the provider to use inputs to improve their models.
- Gemini, Groq and BeatAPI retention periods and training use for this deployment's keys: **not verified**. Ohmni has not reviewed or recorded these providers' current terms.
- **No-training guarantee: none.** Do not upload confidential or proprietary circuit designs. A paid tier with contractual no-training terms is a precondition for paid beta (docs/HANDOFF_PHASE1.md, owner item).

## What Ohmni itself stores

- **Analysis routes store nothing.** `/api/extract`, `/api/solve`, `/api/probe` and the other analysis routes process images and graphs in memory for the request only.
- **Saved investigations (opt-in, signed-in users, `/api/v1/*`):** when a signed-in user saves work, Ohmni stores in Supabase Postgres (project region us-west-2): workspace and project names, confirmed circuit graphs, measurements (with any provenance the client sends, e.g. a voice transcript), and the engine's hypotheses, repair proposals and verification verdicts. Rows are isolated per workspace by row-level security (`supabase/tests/rls_matrix.sql`). Images are **not** stored. Deleting a workspace deletes all of its rows. Supabase backup retention follows the project's plan and is **not verified** here.
- **Rate limiter:** in-memory counters per route and client IP (`src/lib/server/rateLimit.ts`), per server instance, expiring with their window. Lost on restart.
- **Jev pacing:** an in-memory timestamp of the last Jev call; no content.
- **Browser only:** `/build` keeps the current evidence packet in `sessionStorage` (`ohmni.evidence.v1`) so `/teams` can read it in the same tab. It never leaves the browser unless the user exports it.
- **Application logs:** Ohmni code does not log request bodies, images or keys. The hosting platform (Vercel/Netlify) keeps its own request logs (path, status, IP, timing); their retention follows the host's plan and is **not verified** here.

## Consent gate

Set `REQUIRE_AI_CONSENT=1` on the server to require explicit consent before any user content is sent to an AI provider:

- `/api/extract` (multipart): form field `aiConsent=true`.
- `/api/explain`, `/api/review` with `mentor` (JSON): `"aiConsent": true` (boolean).
- Missing or anything else → `422 { error: { code: "CONSENT_REQUIRED", message } }`, and no provider is called.

Unset (default) keeps the previous behaviour so the deployed UI keeps working until it sends the flag. Turn it on only after the UI ships the consent checkbox.
