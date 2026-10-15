-- Account deletion: deleting an auth user must not be blocked by rows they authored in workspaces that live on.
-- Authorship columns become nullable and are cleared on user deletion (the evidence stays, the author becomes
-- "deleted account"). Inserts still require the column to equal auth.uid() via the existing RLS policies, so new
-- rows are always attributed. Workspaces where the user is the only member are deleted by the API first.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('workspaces', 'created_by'), ('projects', 'created_by'), ('artifacts', 'created_by'),
      ('design_revisions', 'confirmed_by'), ('investigations', 'opened_by'), ('measurements', 'entered_by'),
      ('repair_proposals', 'approved_by'), ('reports', 'created_by')
    ) v(tbl, col)
  loop
    execute format('alter table public.%I alter column %I drop not null', t.tbl, t.col);
    execute format('alter table public.%I drop constraint %I', t.tbl, t.tbl || '_' || t.col || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
      t.tbl, t.tbl || '_' || t.col || '_fkey', t.col);
  end loop;
end $$;
