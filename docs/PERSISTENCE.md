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
- `scripts/rls-check.mjs`: runs **pending** migrations + the matrix in one rolled-back transaction, so a schema PR is checked before it is applied (shown to fail on a leaky test migration). CI: `.github/workflows/rls.yml` on PRs touching `supabase/**`; skipped until the owner adds secret `SUPABASE_ACCESS_TOKEN` and variable `SUPABASE_PROJECT_REF=oyiwnfcbdiakzmqpufaf`. Applying migrations stays manual (`supabase db push`).
- `scripts/persistence-e2e.mjs`: two throwaway users against a running app; confirm → measure (bridge C=0, A=7.533, B=5.22 → R6 open) → reload → repair → verify (off-target and on-target) → isolation (outsider gets 404/403 on every route) → membership (viewer reads but cannot write, editor writes, non-owners cannot manage, last owner protected, leaving revokes access) → close. Deletes everything it created and fails if cleanup fails. `node --env-file=.env.local scripts/persistence-e2e.mjs http://localhost:3000`.
- `tests/server/v1.test.ts`: network-free checks (503 when unconfigured, 401 token shapes, shared rate rule, tier).
- Supabase advisors (security + performance): no issues.

## Enabling on a deployment (owner)
Set server-only env vars (never `NEXT_PUBLIC_` for the service key): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY`. The CLI masks the new `sb_secret_` key; use the legacy `service_role` key or copy the secret key from the dashboard. Supabase Auth settings: enable the sign-in method the UI will use (email magic link is the lowest-friction), and add the production URL to the redirect allow-list.

## UI handoff (ChatGPT Work)
- **Use `src/lib/client/ohmni.ts`** (ready, typed from the server functions): `supabaseBrowser()` (null when the `NEXT_PUBLIC_SUPABASE_*` vars are unset → hide saving), `signInWithEmail(email)` (magic link), and `ohmni.workspaces / members / projects / investigations / proposals` wrappers that attach the session token and throw `OhmniApiError { status, code, requestId }`. The browser never talks to the tables directly. CSP: browser sign-in needs `https://*.supabase.co` in `connect-src`, which #83 adds; main's current report-only policy does not block it, but merge #83 (or add the origin) before enforcing.
- Flow: after the user confirms a circuit in `/lab` → `POST /projects/:id/revisions` (this replaces the `userConfirmed` flag) → `POST /investigations` → each reading `POST /investigations/:id/measurements` (render `probe` from the response; when `probe.next.kind === 'resistance'`, ask for a power-off ohmmeter reading and post `{ kind: 'resistance', a, b, ohms }`) → `POST .../repair` → `POST /proposals/:id/verify`. Reload = `GET /investigations/:id`.
- Show `probe.fit === 'poor'` / `unmodeled` as "no modeled fault fits"; `stored` is empty in that case.
- Export: `GET /investigations/:id/report` (markdown download) or `?format=json` (`ohmni.report.v1`). `/teams` currently reads the browser-only `ohmni.evidence.v1` packet; importing the server report there is a UI follow-up.

## Demo data
`node --env-file=.env.local scripts/seed-demo.mjs <baseUrl> [--reset]` signs in as `DEMO_EMAIL`/`DEMO_PASSWORD` (created if missing) and builds the workspace "Ohmni demo bench" through the real API: loaded bridge revision, investigation "C reads 0 V" with C=0 / A=7.533 / B=5.22 → R6 open (done), a stored repair proposal and a verified check. Idempotent; `--reset` deletes and rebuilds it. Seeded in the `ohmni` dev project on 2026-10-14 (credentials only in the owner's local `.env.local`).

## Saved images
Opt-in per upload: `POST /projects/:id/artifacts` stores the schematic in the private `artifacts` bucket (`<workspace>/<project>/<sha256>.<ext>`, migration `20261014040000_artifacts_bucket.sql`, no `storage.objects` policies) and records an `artifacts` row; revisions can point to it (`sourceArtifactId`, same-workspace FK). Members get 60 s signed URLs; viewers can download but not upload. Workspace deletion removes the files before the row cascade. The workspace export lists artifact rows, not file bytes.

## Data lifecycle
Owners and editors can download a full workspace export (`/workspaces/:id/export`, includes the member list); viewers read in the app but cannot bulk-export. Owners delete a workspace permanently by typing its exact name (`/workspaces/:id/delete`); the UI should offer the export first. Deletion cascades through every table (`20261014010000_cascade_intra_workspace_fks.sql`).

## Usage metering
Signed-in calls to `/api/extract` / `/api/explain` with a `projectId` store trace metadata in `model_traces`; `GET /api/v1/workspaces/:id/usage` aggregates it. First measured point (2026-10-14, local dev against Gemini free tier): one `/api/explain` = 570 input + 349 output tokens on `gemini-3.5-flash-lite`, 1.7 s. `scripts/persistence-e2e.mjs --with-model` repeats this check (one model call).

## Known gaps
- No invitation emails (members must have signed in once), no artifact (file) upload yet; the `reports` table is unused (reports are generated on demand).
- Account deletion (`POST /api/v1/account/delete`, migration `20261015000000_account_deletion.sql`): policy = delete solo workspaces, refuse while sole owner of a shared one, keep shared evidence with the author cleared. Change it if a customer contract needs reassignment instead.
- Hypothesis snapshots store the top 12 hypotheses (plus any ≥ 1 %) per reading; the full posterior is recomputable from stored evidence.
