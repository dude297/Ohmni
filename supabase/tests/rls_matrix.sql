-- RLS test matrix for 20261012000000_core_investigation_model.sql.
-- Runs in one transaction and ROLLS BACK: leaves no users or rows behind.
-- Run: supabase db query --linked -f supabase/tests/rls_matrix.sql   (any failure aborts with the failing check's name)
-- Users: A owner of w1, E editor of w1, V viewer of w1, B owner of w2 and non-member of w1, anon.
begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.expect_count(name text, q text, n bigint) returns void language plpgsql as $$
declare got bigint;
begin
  execute q into got;
  if got is distinct from n then raise exception 'FAIL % : expected %, got %', name, n, got; end if;
end $$;
create function pg_temp.expect_err(name text, q text, codes text[]) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'FAIL % : expected error %, statement succeeded', name, codes;
exception when others then
  if sqlstate like 'P0001' or not (sqlstate = any (codes)) then raise exception 'FAIL % : % (%)', name, sqlerrm, sqlstate; end if;
end $$;
create function pg_temp.expect_rows(name text, q text, n bigint) returns void language plpgsql as $$
declare got bigint;
begin
  execute q;
  get diagnostics got = row_count;
  if got <> n then raise exception 'FAIL % : expected % affected rows, got %', name, n, got; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-00000000000a', 'rls-a@test.invalid'),
  ('00000000-0000-4000-a000-00000000000b', 'rls-b@test.invalid'),
  ('00000000-0000-4000-a000-00000000000e', 'rls-e@test.invalid'),
  ('00000000-0000-4000-a000-00000000000f', 'rls-v@test.invalid');

-- A builds w1 as an authenticated client would (insert ... returning must work for the creator).
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.expect_rows('A creates workspace w1 with returning',
  $q$insert into workspaces (id, name, created_by) values ('10000000-0000-4000-a000-000000000001', 'w1', '00000000-0000-4000-a000-00000000000a') returning id$q$, 1);
select pg_temp.expect_count('A is owner of w1', $q$select count(*) from workspace_members where workspace_id = '10000000-0000-4000-a000-000000000001' and role = 'owner'$q$, 1);
insert into projects (id, workspace_id, name, created_by) values ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'p1', '00000000-0000-4000-a000-00000000000a');
insert into design_revisions (id, workspace_id, project_id, revision_hash, source, graph, confirmed_by) values
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'rev_00000000000000a1', 'fixture', '{}', '00000000-0000-4000-a000-00000000000a'),
  ('30000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'rev_00000000000000a2', 'fixture', '{}', '00000000-0000-4000-a000-00000000000a');
insert into investigations (id, workspace_id, project_id, revision_id, title, opened_by) values
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'i1', '00000000-0000-4000-a000-00000000000a');
insert into measurements (id, workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values
  ('50000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'A', 7.533, 'V', 'typed', '00000000-0000-4000-a000-00000000000a');
select pg_temp.expect_err('A measurement bound to a different revision than its investigation',
  $q$insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002', 'A', 1, 'V', 'typed', '00000000-0000-4000-a000-00000000000a')$q$, array['23503']);
select pg_temp.expect_err('A cannot write server-only hypotheses',
  $q$insert into hypotheses (workspace_id, investigation_id, revision_id, engine, engine_version, hypothesis_key, probability, fit, evidence_measurement_ids) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'probe', 'x', 'R6:open', 0.9, 'good', '{}')$q$, array['42501']);
select pg_temp.expect_err('A cannot add members directly',
  $q$insert into workspace_members (workspace_id, user_id, role) values ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000b', 'editor')$q$, array['42501']);
select pg_temp.expect_rows('measurements are append-only (update)', $q$update measurements set value = 0$q$, 0);
select pg_temp.expect_rows('measurements are append-only (delete)', $q$delete from measurements$q$, 0);
reset role;

-- Server (service role / postgres) side: memberships and engine output.
insert into workspace_members (workspace_id, user_id, role) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000e', 'editor'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000f', 'viewer');
insert into hypotheses (id, workspace_id, investigation_id, revision_id, engine, engine_version, hypothesis_key, probability, fit, evidence_measurement_ids) values
  ('60000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'probe', 'test', 'R6:open', 0.885, 'good', '{50000000-0000-4000-a000-000000000001}');

-- B: owns w2, sees nothing of w1, cannot write into it, cannot graft rows across tenants.
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
insert into workspaces (id, name, created_by) values ('10000000-0000-4000-a000-000000000002', 'w2', '00000000-0000-4000-a000-00000000000b');
insert into projects (id, workspace_id, name, created_by) values ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002', 'p2', '00000000-0000-4000-a000-00000000000b');
select pg_temp.expect_count('B workspaces (only w2)', 'select count(*) from workspaces', 1);
select pg_temp.expect_count('B members (only own)', 'select count(*) from workspace_members', 1);
select pg_temp.expect_count('B projects (only p2)', 'select count(*) from projects', 1);
select pg_temp.expect_count('B design_revisions', 'select count(*) from design_revisions', 0);
select pg_temp.expect_count('B investigations', 'select count(*) from investigations', 0);
select pg_temp.expect_count('B measurements', 'select count(*) from measurements', 0);
select pg_temp.expect_count('B hypotheses', 'select count(*) from hypotheses', 0);
select pg_temp.expect_count('B artifacts', 'select count(*) from artifacts', 0);
select pg_temp.expect_count('B repair_proposals', 'select count(*) from repair_proposals', 0);
select pg_temp.expect_count('B verifications', 'select count(*) from verifications', 0);
select pg_temp.expect_count('B model_traces', 'select count(*) from model_traces', 0);
select pg_temp.expect_count('B reports', 'select count(*) from reports', 0);
select pg_temp.expect_err('B cannot create a project in w1',
  $q$insert into projects (workspace_id, name, created_by) values ('10000000-0000-4000-a000-000000000001', 'x', '00000000-0000-4000-a000-00000000000b')$q$, array['42501']);
select pg_temp.expect_err('B cannot graft a w2 measurement onto w1 investigation',
  $q$insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values ('10000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'A', 1, 'V', 'typed', '00000000-0000-4000-a000-00000000000b')$q$, array['23503']);
select pg_temp.expect_err('B cannot graft a w2 revision onto w1 project',
  $q$insert into design_revisions (workspace_id, project_id, revision_hash, source, graph, confirmed_by) values ('10000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', 'rev_00000000000000b1', 'manual', '{}', '00000000-0000-4000-a000-00000000000b')$q$, array['23503']);
select pg_temp.expect_err('B cannot open a w2 investigation on a w1 revision',
  $q$insert into investigations (workspace_id, project_id, revision_id, title, opened_by) values ('10000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000001', 'x', '00000000-0000-4000-a000-00000000000b')$q$, array['23503']);
select pg_temp.expect_rows('B cannot update w1 project', $q$update projects set name = 'pwned' where workspace_id = '10000000-0000-4000-a000-000000000001'$q$, 0);
select pg_temp.expect_err('B cannot look up users by email', $q$select public.user_id_by_email('rls-a@test.invalid')$q$, array['42501']);
select pg_temp.expect_err('B cannot list another workspace''s member emails', $q$select count(*) from public.workspace_member_list('10000000-0000-4000-a000-000000000001')$q$, array['42501']);
select pg_temp.expect_err('B cannot call the shared rate limiter', $q$select public.rate_hit('x', 60, 1)$q$, array['42501']);
select pg_temp.expect_err('B cannot read rate counters', 'select count(*) from private.rate_counters', array['42501']);
select pg_temp.expect_err('B cannot create a workspace as someone else',
  $q$insert into workspaces (name, created_by) values ('x', '00000000-0000-4000-a000-00000000000a')$q$, array['42501']);
reset role;

-- V (viewer): reads w1, writes nothing.
select pg_temp.as_user('00000000-0000-4000-a000-00000000000f');
set local role authenticated;
select pg_temp.expect_count('V reads w1 measurements', 'select count(*) from measurements', 1);
select pg_temp.expect_count('V reads w1 hypotheses', 'select count(*) from hypotheses', 1);
select pg_temp.expect_err('V cannot add a measurement',
  $q$insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'B', 1, 'V', 'typed', '00000000-0000-4000-a000-00000000000f')$q$, array['42501']);
select pg_temp.expect_rows('V cannot update project', $q$update projects set name = 'v'$q$, 0);
reset role;

-- E (editor): adds own evidence, cannot impersonate or write engine output.
select pg_temp.as_user('00000000-0000-4000-a000-00000000000e');
set local role authenticated;
insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values
  ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'B', 5.22, 'V', 'typed', '00000000-0000-4000-a000-00000000000e');
select pg_temp.expect_err('E cannot enter a measurement as A',
  $q$insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'B', 5.22, 'V', 'typed', '00000000-0000-4000-a000-00000000000a')$q$, array['42501']);
select pg_temp.expect_err('E cannot store NaN', $q$insert into measurements (workspace_id, investigation_id, revision_id, node, value, unit, method, entered_by) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'B', 'NaN', 'V', 'typed', '00000000-0000-4000-a000-00000000000e')$q$, array['23514']);
select pg_temp.expect_err('E cannot write repair proposals',
  $q$insert into repair_proposals (workspace_id, investigation_id, revision_id, hypothesis_id, patch, predicted_before, predicted_after, verification_node, expect_value, tolerance) values ('10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', '{}', '{}', '{}', 'B', 5, 0.1)$q$, array['42501']);
select pg_temp.expect_count('E sees both w1 measurements', 'select count(*) from measurements', 2);
reset role;

-- anon: no privileges on any table.
set local role anon;
select pg_temp.expect_err('anon cannot read projects', 'select count(*) from projects', array['42501']);
select pg_temp.expect_err('anon cannot read measurements', 'select count(*) from measurements', array['42501']);
select pg_temp.expect_err('anon cannot create workspaces', $q$insert into workspaces (name, created_by) values ('x', '00000000-0000-4000-a000-00000000000a')$q$, array['42501']);
reset role;

-- Server-side workspace deletion cascades through every table (verification -> measurement -> proposal -> hypothesis).
insert into repair_proposals (id, workspace_id, investigation_id, revision_id, hypothesis_id, patch, predicted_before, predicted_after, verification_node, expect_value, tolerance) values
  ('70000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', '{}', '{}', '{}', 'B', 4.087, 0.09);
insert into verifications (workspace_id, repair_proposal_id, measurement_id, revision_id, verified, delta, engine_version) values
  ('10000000-0000-4000-a000-000000000001', '70000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', true, 0, 'test');
delete from workspaces where id = '10000000-0000-4000-a000-000000000001';
select pg_temp.expect_count('workspace delete cascades', $q$select (select count(*) from projects where workspace_id = '10000000-0000-4000-a000-000000000001') + (select count(*) from measurements where workspace_id = '10000000-0000-4000-a000-000000000001') + (select count(*) from verifications where workspace_id = '10000000-0000-4000-a000-000000000001')$q$, 0);

select 'RLS MATRIX: ALL PASS' as result;
rollback;
