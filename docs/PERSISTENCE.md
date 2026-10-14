# Saved Investigations (Supabase persistence)

Status 2026-10-14: schema applied to the Supabase project **`ohmni`** (`oyiwnfcbdiakzmqpufaf`, us-west-2, a separate org from the other projects). The API (`/api/v1/*`) passes the live e2e locally. **Not yet enabled on Vercel**: the three env vars below are unset there, so production answers 503 `PERSISTENCE_DISABLED`. No UI calls it yet.

## Model
Workspace → Project → Design Revision (immutable confirmed graph) → Investigation → Measurement (append-only) → Hypothesis snapshot → Repair Proposal → Verification. Schema: `supabase/migrations/`. Contract: API_CONTRACT.md "Saved investigations".

## Invariants (enforced in the database, not only in code)
- **Tenancy:** RLS admits workspace members only. Composite foreign keys pin each child's `workspace_id` and `revision_id` to its parent, so a row cannot be attached to another tenant's investigation even by a member of both.
- **Confirmation is data:** `design_revisions.confirmed_by` is the authenticated caller; there is no client flag.
- **Append-only evidence:** no client update/delete on measurements; corrections use `supersedes`.
- **Server authority:** hypotheses, proposals and verifications have no client insert policy. The server recomputes them from **stored** evidence and writes them with the service role only after the caller's own RLS-scoped read/insert succeeded. Verification readings are stored as evidence (`provenance.kind = 'verification'`) but excluded from diagnosis.
- **Roles:** owner/editor write evidence, viewer reads. Owners manage members through `/api/v1/workspaces/:id/members` (existing accounts only, by email; no invitation emails). Email lookup and member listing use service-role-only SQL functions; a workspace always keeps at least one owner.

## Verification
- `supabase/tests/rls_matrix.sql`: owner / editor / viewer / outsider / anon across all 12 tables, cross-tenant grafting, append-only, server-only tables and cascading workspace deletion. Runs in a rolled-back transaction: `supabase db query --linked -f supabase/tests/rls_matrix.sql` → `RLS MATRIX: ALL PASS`. Shown to fail when a policy is loosened or the cascade migration is missing.
- `scripts/persistence-e2e.mjs`: two throwaway users against a running app; confirm → measure (bridge C=0, A=7.533, B=5.22 → R6 open) → reload → repair → verify (off-target and on-target) → isolation (outsider gets 404/403 on every route) → membership (viewer reads but cannot write, editor writes, non-owners cannot manage, last owner protected, leaving revokes access) → close. Deletes everything it created and fails if cleanup fails. `node --env-file=.env.local scripts/persistence-e2e.mjs http://localhost:3000`.
- `tests/server/v1.test.ts`: network-free checks (503 when unconfigured, 401 token shapes, shared rate rule, tier).
- Supabase advisors (security + performance): no issues.

## Enabling on a deployment (owner)
Set server-only env vars (never `NEXT_PUBLIC_` for the service key): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY`. The CLI masks the new `sb_secret_` key; use the legacy `service_role` key or copy the secret key from the dashboard. Supabase Auth settings: enable the sign-in method the UI will use (email magic link is the lowest-friction), and add the production URL to the redirect allow-list.

## UI handoff (ChatGPT Work)
- Client auth: `@supabase/supabase-js` in the browser with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key; safe to expose). Sign in, then send `Authorization: Bearer ${session.access_token}` to `/api/v1/*`. The browser never talks to the tables directly.
- Flow: after the user confirms a circuit in `/lab` → `POST /projects/:id/revisions` (this replaces the `userConfirmed` flag) → `POST /investigations` → each reading `POST /investigations/:id/measurements` (render `probe` from the response) → `POST .../repair` → `POST /proposals/:id/verify`. Reload = `GET /investigations/:id`.
- Show `probe.fit === 'poor'` / `unmodeled` as "no modeled fault fits"; `stored` is empty in that case.
- Export: `GET /investigations/:id/report` (markdown download) or `?format=json` (`ohmni.report.v1`). `/teams` currently reads the browser-only `ohmni.evidence.v1` packet; importing the server report there is a UI follow-up.

## Known gaps
- No invitation emails (members must have signed in once), no workspace delete API, no artifact (file) upload yet; `reports` and `model_traces` tables are unused.
- Deleting an auth user who authored rows in a workspace that still exists fails (`created_by`/`entered_by` reference `auth.users`): account deletion needs a policy decision (reassign vs delete workspaces).
- Hypothesis snapshots store the top 12 hypotheses (plus any ≥ 1 %) per reading; the full posterior is recomputable from stored evidence.
