-- Member management reads auth.users (emails), which no client role may see. These two functions are callable by the
-- service role only; the API checks the caller's own membership/ownership through RLS before calling them.

create function public.user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

create function public.workspace_member_list(p_workspace uuid)
returns table (user_id uuid, role public.member_role, email text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, u.email::text, m.created_at
  from public.workspace_members m join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace
  order by m.created_at;
$$;

revoke all on function public.user_id_by_email(text), public.workspace_member_list(uuid) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text), public.workspace_member_list(uuid) to service_role;
