create table if not exists public.private_conversation_preferences (
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_pinned boolean not null default false,
  is_muted boolean not null default false,
  is_archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function private.enforce_private_conversation_preference_participant()
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
    raise exception 'private conversation preference user must be a participant'
      using errcode = '42501';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists enforce_private_conversation_preference_participant on public.private_conversation_preferences;
create trigger enforce_private_conversation_preference_participant
  before insert or update on public.private_conversation_preferences
  for each row execute function private.enforce_private_conversation_preference_participant();

alter table public.private_conversation_preferences enable row level security;
revoke all on public.private_conversation_preferences from anon, public;
revoke all on public.private_conversation_preferences from authenticated;
revoke all on function private.enforce_private_conversation_preference_participant() from public;
grant select, insert, update on public.private_conversation_preferences to authenticated;

drop policy if exists "users read their private conversation preferences" on public.private_conversation_preferences;
create policy "users read their private conversation preferences"
  on public.private_conversation_preferences
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "users create their private conversation preferences" on public.private_conversation_preferences;
create policy "users create their private conversation preferences"
  on public.private_conversation_preferences
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

drop policy if exists "users update their private conversation preferences" on public.private_conversation_preferences;
create policy "users update their private conversation preferences"
  on public.private_conversation_preferences
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
