-- Workspace deletion is enforced by the database, not only the API: only owners may delete, through their own
-- RLS-scoped client. The FK cascade then removes every child row.
create function private.is_owner(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = 'owner');
$$;
revoke all on function private.is_owner(uuid) from public, anon;
grant execute on function private.is_owner(uuid) to authenticated, service_role;

create policy d on workspaces for delete to authenticated using (private.is_owner(id));
