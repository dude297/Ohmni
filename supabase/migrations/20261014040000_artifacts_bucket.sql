-- Private bucket for saved schematic images. No storage.objects policies: clients cannot read or write it directly.
-- The API uploads/signs with the service role after the caller's RLS-checked access to the artifacts row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artifacts', 'artifacts', false, 6291456, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
