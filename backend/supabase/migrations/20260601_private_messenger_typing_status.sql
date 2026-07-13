create table if not exists public.private_typing_status (
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_typing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function private.enforce_private_typing_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.private_conversations conversation
    where conversation.id = new.conversation_id
      and new.user_id in (conversation.participant_a, conversation.participant_b)
  ) then
    raise exception 'private typing user must be a conversation participant'
      using errcode = '42501';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists enforce_private_typing_participant on public.private_typing_status;
create trigger enforce_private_typing_participant
  before insert or update on public.private_typing_status
  for each row execute function private.enforce_private_typing_participant();

alter table public.private_typing_status enable row level security;
revoke all on public.private_typing_status from anon, public;
revoke all on public.private_typing_status from authenticated;
revoke all on function private.enforce_private_typing_participant() from public;
grant select, insert, update on public.private_typing_status to authenticated;

drop policy if exists "participants read private typing" on public.private_typing_status;
create policy "participants read private typing"
  on public.private_typing_status
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "participants create their private typing" on public.private_typing_status;
create policy "participants create their private typing"
  on public.private_typing_status
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "participants update their private typing" on public.private_typing_status;
create policy "participants update their private typing"
  on public.private_typing_status
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_typing_status'
  ) then
    alter publication supabase_realtime add table public.private_typing_status;
  end if;
end;
$$;
