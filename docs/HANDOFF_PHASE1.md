# Handoff — Production Phase 1 (2026-10-12)

Status snapshot for whoever picks this up next (Claude, ChatGPT Work, or the owner).
Full audit, architecture and release gates are in [PRODUCTION_PHASE1.md](PRODUCTION_PHASE1.md).

## Update 2026-10-14 (day run)

**Merge queue (owner):** #79, #82, #83 in any order; the persistence stack in order #80 → #81 → #85 (usage metering) → #86 (export/delete). Stacked PRs retarget to main as their base merges. #79-#83 verified conflict-free together (typecheck, 712 tests, live persistence e2e); #85 has no conflicts with #79/#83.

**Owner actions to turn on saved investigations:**
1. Vercel env (server-only): `SUPABASE_URL=https://oyiwnfcbdiakzmqpufaf.supabase.co`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (legacy `service_role` or dashboard secret key; the CLI masks `sb_secret_`). Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Supabase Auth: enable email magic link; add the production URL to the redirect allow-list.
3. Vercel connector in this session is logged into a different account, so Claude could not set these.

**UI handoff additions (ChatGPT Work):** `src/lib/client/ohmni.ts` is ready (sign-in + typed `/api/v1` wrappers); flow in docs/PERSISTENCE.md. Optional: `z.config({ jitless: true })` in client code silences Zod's harmless CSP eval probe on /twin, /studio, /teams, /for-the-larp.

## Update 2026-10-14 (overnight run)

- **Merged** (owner-approved): #73 -> `5c90656`, #74 -> `fe74394`, #75 -> `e16a270`. Production serves `e16a270`. Remote force-push is blocked by policy, so branches were updated by merging main, then squash-merged.
- **Remaining P0 #1-#4 implemented and merged 2026-10-14** (owner go-ahead): #76 `1c52178`, #77 `3fea355`, #78 `925f7c6`:
  - #76 `p0/ai-consent`: `REQUIRE_AI_CONSENT=1` -> 422 `CONSENT_REQUIRED` on /api/extract (form `aiConsent=true`), /api/explain and /api/review mentor (JSON `aiConsent: true`); docs/PRIVACY.md.
  - #77 `p0/tiers-headers`: src/lib/features.ts, `x-ohmni-tier`, `OHMNI_DISABLED_TIERS` -> 404 `FEATURE_DISABLED`; nosniff/referrer/XFO DENY/HSTS/Permissions-Policy (mic self); CSP **report-only**; `scripts/postdeploy-smoke.mjs` + `.github/workflows/postdeploy.yml`. Proxy matcher now covers all pages.
  - #78 `p0/observability`: `observe()` wrapper on every API route: `x-request-id`, `error.requestId`, one JSON log line (no bodies/IPs), 500 `INTERNAL` catch-all.
  - All gates are **off by default**: merging changes no user-visible behaviour except headers and the request id.
  - Merge order: any; after the first, the others need main merged in with a docs/API_CONTRACT.md conflict (keep both sections). Verified combined: typecheck clean, 696 tests pass.
- **Next after merge:** turn on `REQUIRE_AI_CONSENT=1` only after the UI sends `aiConsent`; switch CSP to enforcing after a clean console on every route; add `x-request-id` to proxy 429/413.
- **Blocked on UI (ChatGPT Work):** consent checkbox + `aiConsent`; `revisionId` on verify; `fit: poor`/`unmodeled` state on /probe; experimental badges. **Blocked on owner:** merges, Supabase dev project, `GEMINI_MODEL` choice, real-mic Voice Lab test.

## Where things stand

| Ref | State |
|---|---|
| `main` | `d6bc997` (moonshots integrated via #69, #71). Vercel auto-deploys it. |
| Frozen release | `release/frozen-2026-10-11-1600-pdt` @ `d4b97d2`. **Never modify.** |
| Vercel (production host) | `multimodal-hackathon-sage.vercel.app` → `d6bc997` |
| Netlify `ohmni.netlify.app` | Production switch to main did **not** take; still serves `build:"dev"` (frozen). Low priority now that Vercel is production. |
| Netlify branch deploy | `integration-demo-ready--ohmni.netlify.app` verified at `149365c` |
| Anbaric | `ohmni.cloud.anbaric.ai`, login-gated |

## Open PRs (all MERGEABLE, none merged — merges need owner approval)

| PR | Branch @ head | What | Tests |
|---|---|---|---|
| #72 (draft) | `docs/production-phase1` | Audit (P0/P1/P2), investigation data model, **unapplied** Supabase migration, ops, alpha/beta/GA gates, this handoff | docs only |
| #73 | `p0/verify-server-authoritative` @ `c32bb69` | `/api/repair/verify` recomputes expectation server-side, binds to `revisionId` (409 `REVISION_MISMATCH`, 422 `UNKNOWN_HYPOTHESIS`/`UNKNOWN_NODE`); client expectation ignored | 646 pass |
| #74 | `p0/workload-ceilings` @ `7f42f26` | 60-component cap, streamed body caps (256 KB JSON / 6 MB image), magic-byte image sniff, limiter key cap, global model budget (`MODEL_BUDGET`), AC 20 s deadline, host-specific trusted IP header, `docs/SECURITY.md` | 654 pass |
| #75 | `p0/diagnosis-honesty` @ `1443eac` | `unmodeled` hypothesis + 5% tolerance, `fit`/`outOfModelProbability`, grounding claim checks, solver conditioning warnings, `bench/` harness, repair blocked on `poor_fit` | 657 pass + 7 expected-fail + 3 skipped |

**Merge order:** #73 → rebase #74 → merge → rebase #75 → merge (#74/#75 touch files #73 edits). Rerun CI after each rebase. #72 last, after updating it with the final numbers.

### #75 measured results (fixed seeds, `bench/`)

| Metric | Before | After | Target |
|---|---|---|---|
| Out-of-model confident-wrong | 70.5% | **7.4%** | < 5% — **missed**; residual cases are indistinguishable with ≤ 3 probed nodes |
| In-model top-1 (equivalence-aware) | 99.55% | 98.4% | ≥ 98% |
| Ungrounded tutor claims accepted | 17/22 | **0/22** | 0 |
| Silent KCL violations (2000 circuits) | 331 | **0** | 0 |

**Behaviour change:** bridge demo (`LOADED_BRIDGE_12V`) — C=0, A=7.533 now gives R6 open ≈ 0.886 (was ≈ 0.94); the guide asks for B before concluding. Update demo scripts.

## Remaining P0 work (Claude-owned, not started)

1. **AI consent gate** — server-side `aiConsent` required on `/api/extract` (env-gated), plus `docs/PRIVACY.md` (data flows to Groq / Gemini / BeatAPI, retention, no-training status).
2. **Observability** — request id, JSON logs (no secrets/tokens/images), uniform error shape, catch-all 500.
3. **Feature registry** — `src/lib/features.ts` (core / experimental / demo per PRODUCTION_PHASE1.md), proxy enforcement, `x-ohmni-tier` header.
4. **Security headers** (P1-7) and **post-deploy smoke** comparing `/api/health` SHA to the deployed commit.
5. **Supabase** — needs owner go-ahead to create a dev project (free tier). Then apply `supabase/migrations/20261012000000_core_investigation_model.sql`, run an RLS test matrix (member/non-member/viewer × each table), wire auth.

## UI handoff to ChatGPT Work (owns `src/app/page.tsx`, `src/app/lab/**`, `src/components/**`)

- Consent checkbox on `/lab` upload; send `aiConsent: true` once #1 lands.
- Experimental badge + nav treatment for experimental/demo routes (list in PRODUCTION_PHASE1.md).
- `/probe`: "no modeled fault fits" state when `fit === 'poor'` or top hypothesis is `unmodeled`; show `outOfModelProbability`.
- Verify calls must send `hypothesisId` + `revisionId` (from `/api/repair` response).
- Ownership unclear, decide before editing: `src/app/build/build-client.tsx:73` and Voice Lab `repair.ts:76` need the same `fit !== 'poor'` check and verify payload change.

## Owner-only items

- Approve merges (#73 → #74 → #75 → #72).
- Go-ahead for Supabase dev project.
- Real microphone test of Voice Lab (only tested with a fake recognizer — never describe as physically validated).
- Vercel Pro before any paid use (Hobby forbids commercial use).
- Price paid no-training AI tiers before paid beta.
- Netlify production branch: check Deploys page/log if it still matters.
- `GEMINI_MODEL` drift: Netlify `flash`, Vercel `flash-lite` — pick one.
- Optional cleanup of merged worktrees.

## Rules that still apply

- No secrets in commits; service-role key never in the browser; no private keys in `NEXT_PUBLIC_*`; never log tokens/passwords.
- No force-push to main, no edits to the frozen release, no paid services/billing without approval; never select paid `jev-1.13`.
- Don't claim deployed functionality until the public URL is tested. Don't call simulated repairs or mocked voice tests physical validation.
- Machine has ~16 GB with little free: ≤ 3 agents, serial `next build`, never mass-kill node.
