alter table public.private_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

insert into storage.buckets (id, name, public, file_size_limit)
values ('private-chat-files', 'private-chat-files', false, 26214400)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "participants read private chat files" on storage.objects;
create policy "participants read private chat files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'private-chat-files'
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id::text = (storage.foldername(name))[1]
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "participants upload private chat files" on storage.objects;
create policy "participants upload private chat files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'private-chat-files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id::text = (storage.foldername(name))[1]
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "senders delete private chat files" on storage.objects;
create policy "senders delete private chat files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'private-chat-files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
