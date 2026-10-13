# Handoff — Production Phase 1 (2026-10-12)

Status snapshot for whoever picks this up next (Claude, ChatGPT Work, or the owner).
Full audit, architecture and release gates are in [PRODUCTION_PHASE1.md](PRODUCTION_PHASE1.md).

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
