-- Shared fixed-window rate limiter for model-calling routes, so limits hold across serverless instances.
-- Keys carry hashed client IPs only. Callable by the service role only; the app fails open to its in-memory limiter.

create unlogged table private.rate_counters (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
revoke all on private.rate_counters from public, anon, authenticated;

-- Returns 0 when allowed, else seconds until the window resets. Atomic per key (single upsert).
create function public.rate_hit(p_key text, p_window_s integer, p_max integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz;
  n integer;
begin
  insert into private.rate_counters as r (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_s) then now() else r.window_start end,
    count = case when r.window_start <= now() - make_interval(secs => p_window_s) then 1 else r.count + 1 end
  returning window_start, count into w, n;
  if random() < 0.01 then
    delete from private.rate_counters where window_start < now() - interval '1 day';
  end if;
  if n > p_max then
    return greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_s) - now())))::integer);
  end if;
  return 0;
end $$;

revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;
