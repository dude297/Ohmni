# Ohmni — Operations Runbook

Production: https://multimodal-hackathon-sage.vercel.app (Vercel project `ohmni`, auto-deploys `main`). Database: Supabase project `ohmni` (`oyiwnfcbdiakzmqpufaf`, us-west-2). Items marked *(after merge)* depend on open PRs listed in HANDOFF_PHASE1.md.

## Is production healthy?
1. `curl -s <prod>/api/health` → `status: ok`, `build` = the short SHA of `main`, providers `configured: true`, `persistence.configured` *(after #85)*.
2. GitHub Actions `postdeploy` on every push to `main` waits for that SHA, then checks the solver, bad-JSON handling, tier and security headers (enforcing CSP *(after #83)*). A red `postdeploy` means the deploy is wrong or not live.
3. Logs: one JSON line per API request (`requestId, route, status, ms, code`). A user quoting `error.requestId` maps to exactly one line. Bodies, images, keys and IPs are never logged.

## Required environment (Vercel, server-only unless noted)
| Variable | Purpose | If missing |
|---|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `BEATAPI_API_KEY` | Vision, tutor, Jev routing | That provider reports `configured: false`; fallbacks apply |
| `GEMINI_MODEL`, `GROQ_VISION_MODEL`, `BEATAPI_JEV_MODEL`, `VISION_PRIMARY`, `EXPLAIN_MODEL` | Model choice | Code defaults |
| `REQUIRE_AI_CONSENT=1` | Consent gate | Gate off (set only once the UI sends `aiConsent`) |
| `OHMNI_DISABLED_TIERS` | Turn off `experimental` / `demo` routes (404) | Everything served |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Saved investigations, shared rate limits | `/api/v1/*` → 503 `PERSISTENCE_DISABLED`; shared limits off |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design) | Browser sign-in | Saving hidden in the UI |
| `RATE_SALT`, `RATE_SHARED`, `RATE_*_PER_MIN` | Limiter tuning | Safe defaults |

## Rollback (app)
1. Vercel dashboard → Deployments → previous green production deployment → **Promote** (instant rollback; no rebuild).
2. Confirm `/api/health` `build` shows the old SHA and `postdeploy` checks pass when re-run manually against it.
3. Revert the bad commit on `main` with a PR (never force-push `main`); the next deploy replaces the promoted one.
4. **Rehearse once before the private alpha** (release gate) and record the date and timings here.

## Database changes
- Migrations are forward-only files in `supabase/migrations/`. Before applying, run `node scripts/rls-check.mjs` (pending migrations + RLS matrix in one rolled-back transaction); CI runs it on PRs touching `supabase/**` once `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` are set.
- Apply with `supabase db push --linked` from a checkout of the merged commit, then re-run `rls-check` (expects `pending migrations: none`, `ALL PASS`) and `supabase db advisors --linked`.
- To undo a migration, write a new forward migration; never edit an applied file.
- Live end-to-end check against any environment with the API + database: `node --env-file=.env.local scripts/persistence-e2e.mjs <baseUrl>` (self-cleaning; `--with-model` adds one model call).

## Backups and deletion
- Supabase backups follow the plan (Free: daily, short retention; Pro adds point-in-time recovery). Not yet restore-tested: do one restore into a scratch project before paid beta.
- Workspace deletion is permanent (owner + typed name), removes stored images first, then cascades through every table *(after #86/#89)*. Offer the export first.

## Incidents
| Symptom | First check | Mitigation |
|---|---|---|
| 429 `MODEL_BUDGET` / `RATE_LIMITED` spikes | Logs by `code`; provider dashboards | Raise `RATE_*` only if quota allows; abuse → Vercel firewall rule |
| Extraction failing | `/api/health` providers; trace events in responses | Fallback provider is automatic; `VISION_PRIMARY` to switch order |
| `/api/v1` 502 `DB_ERROR` / 503 | Supabase status page, project health | Shared limits fail open automatically; persistence can be disabled by unsetting `SUPABASE_*` (core analysis unaffected) |
| Bad deploy | `postdeploy` red, `/api/health` build | Rollback above |
| Suspected data exposure | Which route/tenant; RLS matrix | `OHMNI_DISABLED_TIERS=experimental` disables `/api/v1`; rotate keys in Supabase; run `rls-check` |
