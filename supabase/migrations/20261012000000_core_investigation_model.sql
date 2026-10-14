-- Ohmni core investigation model (phase 1).
-- Project -> Design Revision -> Circuit Graph -> Measurement -> Hypothesis -> Repair Proposal -> Verification -> Report
-- Tenancy: every row carries workspace_id; RLS admits members only. Composite foreign keys pin each child's
-- workspace_id (and revision_id) to its parent's, so a row can never be attached across tenants or revisions.
-- Evidence rows are append-only. Server-computed rows (hypotheses, repair_proposals, verifications, model_traces,
-- reports) have NO client insert policy: only server routes write them (service role) after checking membership.
-- RLS test matrix: supabase/tests/rls_matrix.sql.

create extension if not exists pgcrypto;

create type member_role as enum ('owner', 'editor', 'viewer');
create type revision_source as enum ('image_extraction', 'netlist_import', 'manual', 'fixture');
create type measurement_method as enum ('typed', 'voice', 'csv', 'instrument');
create type investigation_status as enum ('open', 'resolved', 'abandoned');
create type proposal_status as enum ('proposed', 'approved', 'verified', 'not_verified', 'rejected');
create type artifact_kind as enum ('schematic_image', 'netlist', 'csv', 'report');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

-- Membership checks used by every policy. security definer so policies on workspace_members don't recurse.
create function is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;
create function can_edit(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'editor'));
$$;

-- The creator becomes owner; clients have no insert policy on workspace_members (invites go through the server).
create function add_workspace_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into workspace_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger workspace_owner after insert on workspaces for each row execute function add_workspace_owner();

revoke all on function is_member(uuid), can_edit(uuid), add_workspace_owner() from public, anon;
grant execute on function is_member(uuid), can_edit(uuid) to authenticated, service_role;

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 4000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id)
);

-- Uploaded/derived files live in Supabase Storage; this row is the provenance record.
create table artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  kind artifact_kind not null,
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes > 0),
  mime text not null,
  ai_processing_consent boolean not null default false, -- explicit consent before any third-party model sees it
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references projects (workspace_id, id) on delete cascade
);

-- Immutable confirmed circuit. revision_hash = 'rev_' + sha256(canonical graph)[0:16] (src/lib/circuit/revision.ts).
create table design_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  parent_id uuid,
  revision_hash text not null check (revision_hash ~ '^rev_[0-9a-f]{16}$'),
  source revision_source not null,
  source_artifact_id uuid,
  graph jsonb not null,
  confirmed_by uuid not null references auth.users (id), -- human confirmation is a recorded fact, not a request flag
  confirmed_at timestamptz not null default now(),
  unique (project_id, revision_hash),
  unique (workspace_id, id),
  unique (project_id, id),
  foreign key (workspace_id, project_id) references projects (workspace_id, id) on delete cascade,
  foreign key (project_id, parent_id) references design_revisions (project_id, id),
  foreign key (workspace_id, source_artifact_id) references artifacts (workspace_id, id)
);

create table investigations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  revision_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  status investigation_status not null default 'open',
  opened_by uuid not null references auth.users (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (workspace_id, id),
  unique (id, revision_id),
  foreign key (workspace_id, project_id) references projects (workspace_id, id) on delete cascade,
  foreign key (project_id, revision_id) references design_revisions (project_id, id)
);

-- Append-only observations with provenance. Corrections supersede; nothing is overwritten.
create table measurements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  revision_id uuid not null,
  node text not null check (char_length(node) between 1 and 32),
  reference_node text not null default 'GND',
  quantity text not null default 'voltage' check (quantity in ('voltage', 'resistance', 'current')),
  value double precision not null check (value = value and abs(value) < 1e9), -- rejects NaN and absurd values
  unit text not null check (unit in ('V', 'Ω', 'A')),
  method measurement_method not null,
  instrument text check (char_length(instrument) <= 120),
  powered boolean not null default true,
  measured_at timestamptz not null default now(),
  entered_by uuid not null references auth.users (id),
  supersedes uuid,
  provenance jsonb not null default '{}'::jsonb, -- e.g. voice transcript + confirmation, CSV row, file artifact id
  unique (workspace_id, id),
  unique (investigation_id, id),
  foreign key (workspace_id, investigation_id) references investigations (workspace_id, id) on delete cascade,
  foreign key (investigation_id, revision_id) references investigations (id, revision_id),
  foreign key (investigation_id, supersedes) references measurements (investigation_id, id)
);

-- Engine output snapshot: what was believed, from which evidence, by which engine version, on which revision.
create table hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  revision_id uuid not null,
  engine text not null,          -- 'probe' | 'probe-multi'
  engine_version text not null,  -- git SHA of the deployed build
  hypothesis_key text not null,  -- e.g. 'R6:open', 'unmodeled'
  probability double precision not null check (probability between 0 and 1),
  fit text not null check (fit in ('good', 'poor')),
  evidence_measurement_ids uuid[] not null,
  computed_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, investigation_id) references investigations (workspace_id, id) on delete cascade,
  foreign key (investigation_id, revision_id) references investigations (id, revision_id)
);

create table repair_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  revision_id uuid not null,
  hypothesis_id uuid not null,
  patch jsonb not null,
  predicted_before jsonb not null,
  predicted_after jsonb not null,
  verification_node text not null,
  expect_value double precision not null,
  tolerance double precision not null check (tolerance >= 0),
  status proposal_status not null default 'proposed',
  approved_by uuid references auth.users (id), -- approving a plan; Ohmni performs no physical change
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, investigation_id) references investigations (workspace_id, id) on delete cascade,
  foreign key (investigation_id, revision_id) references investigations (id, revision_id),
  foreign key (workspace_id, hypothesis_id) references hypotheses (workspace_id, id)
);

-- Server-recomputed verdict for one post-repair measurement. Never derived from client-supplied expectations.
create table verifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  repair_proposal_id uuid not null,
  measurement_id uuid not null,
  revision_id uuid not null,
  verified boolean not null,
  delta double precision not null,
  engine_version text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, repair_proposal_id) references repair_proposals (workspace_id, id) on delete cascade,
  foreign key (workspace_id, measurement_id) references measurements (workspace_id, id)
);

-- Metadata only: never prompts, images or model text.
create table model_traces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid,
  request_id text not null,
  route text not null,
  step text not null,
  provider text not null,
  model text not null,
  status text not null,
  duration_ms integer not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references projects (workspace_id, id) on delete cascade
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  artifact_id uuid not null,
  revision_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id) references investigations (workspace_id, id) on delete cascade,
  foreign key (investigation_id, revision_id) references investigations (id, revision_id),
  foreign key (workspace_id, artifact_id) references artifacts (workspace_id, id)
);

create index on projects (workspace_id);
create index on design_revisions (project_id);
create index on investigations (project_id);
create index on measurements (investigation_id, measured_at);
create index on hypotheses (investigation_id, computed_at);
create index on repair_proposals (investigation_id);
create index on verifications (repair_proposal_id);
create index on model_traces (workspace_id, created_at);

-- RLS. Anonymous callers get no policies at all (and no table privileges).
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table artifacts enable row level security;
alter table design_revisions enable row level security;
alter table investigations enable row level security;
alter table measurements enable row level security;
alter table hypotheses enable row level security;
alter table repair_proposals enable row level security;
alter table verifications enable row level security;
alter table model_traces enable row level security;
alter table reports enable row level security;

revoke all on all tables in schema public from anon;

-- created_by clause: the creator can read the row returned by insert ... returning before the owner trigger's row is visible.
create policy ws_read on workspaces for select to authenticated using (is_member(id) or created_by = (select auth.uid()));
create policy ws_create on workspaces for insert to authenticated with check (created_by = (select auth.uid()));
create policy members_read on workspace_members for select to authenticated using (is_member(workspace_id));

-- Member-readable everywhere.
create policy r on projects for select to authenticated using (is_member(workspace_id));
create policy r on artifacts for select to authenticated using (is_member(workspace_id));
create policy r on design_revisions for select to authenticated using (is_member(workspace_id));
create policy r on investigations for select to authenticated using (is_member(workspace_id));
create policy r on measurements for select to authenticated using (is_member(workspace_id));
create policy r on hypotheses for select to authenticated using (is_member(workspace_id));
create policy r on repair_proposals for select to authenticated using (is_member(workspace_id));
create policy r on verifications for select to authenticated using (is_member(workspace_id));
create policy r on model_traces for select to authenticated using (is_member(workspace_id));
create policy r on reports for select to authenticated using (is_member(workspace_id));

-- Editors create user-authored evidence. Append-only: no update/delete policies on evidence tables.
create policy w on projects for insert to authenticated with check (can_edit(workspace_id) and created_by = (select auth.uid()));
create policy u on projects for update to authenticated using (can_edit(workspace_id)) with check (can_edit(workspace_id));
create policy w on artifacts for insert to authenticated with check (can_edit(workspace_id) and created_by = (select auth.uid()));
create policy w on design_revisions for insert to authenticated with check (can_edit(workspace_id) and confirmed_by = (select auth.uid()));
create policy w on investigations for insert to authenticated with check (can_edit(workspace_id) and opened_by = (select auth.uid()));
create policy u on investigations for update to authenticated using (can_edit(workspace_id)) with check (can_edit(workspace_id));
create policy w on measurements for insert to authenticated with check (can_edit(workspace_id) and entered_by = (select auth.uid()));
-- hypotheses, repair_proposals, verifications, model_traces, reports: server (service role) writes only.
