-- Move RLS helper functions out of the PostgREST-exposed public schema (advisor 0029).
-- Policies and the trigger reference the functions by OID, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_member(uuid) set schema private;
alter function public.can_edit(uuid) set schema private;
alter function public.add_workspace_owner() set schema private;

alter function private.is_member(uuid) set search_path = public;
alter function private.can_edit(uuid) set search_path = public;
alter function private.add_workspace_owner() set search_path = public;

-- Trigger functions are never called by clients; RLS helpers stay executable by signed-in users (policies call them).
revoke all on function private.add_workspace_owner() from public, anon, authenticated;
