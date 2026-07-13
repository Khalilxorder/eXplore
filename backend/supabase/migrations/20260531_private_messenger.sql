create schema if not exists private;

drop table if exists public.chat_messages cascade;
drop table if exists public.chat_conversation_members cascade;
drop table if exists public.chat_conversations cascade;
drop table if exists public.chat_profiles cascade;
drop function if exists private.is_chat_member(uuid, uuid) cascade;
drop function if exists private.can_add_direct_chat_member(uuid, uuid) cascade;
drop function if exists private.enforce_direct_chat_size() cascade;
drop function if exists private.touch_chat_conversation() cascade;
drop function if exists private.enforce_private_message_participant() cascade;
drop function if exists private.enforce_private_receipt_participant() cascade;

create table if not exists public.private_chat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_chat_profiles_username_format check (
    username = lower(username)
    and username ~ '^[a-z0-9_]{3,24}$'
  ),
  constraint private_chat_profiles_display_name_length check (char_length(display_name) <= 80)
);

create table if not exists public.private_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references auth.users(id) on delete cascade,
  participant_b uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint private_conversations_distinct_members check (participant_a <> participant_b)
);

update public.private_conversations
set
  participant_a = least(participant_a, participant_b),
  participant_b = greatest(participant_a, participant_b)
where participant_a <> least(participant_a, participant_b);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'private_conversations_pair_order'
      and conrelid = 'public.private_conversations'::regclass
  ) then
    alter table public.private_conversations
      add constraint private_conversations_pair_order check (
        participant_a = least(participant_a, participant_b)
        and participant_b = greatest(participant_a, participant_b)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'private_conversations_creator_is_participant'
      and conrelid = 'public.private_conversations'::regclass
  ) then
    alter table public.private_conversations
      add constraint private_conversations_creator_is_participant check (
        created_by in (participant_a, participant_b)
      );
  end if;
end;
$$;

create unique index if not exists private_conversations_pair_uq
  on public.private_conversations (least(participant_a, participant_b), greatest(participant_a, participant_b));

create index if not exists private_conversations_participant_a_idx
  on public.private_conversations(participant_a, last_message_at desc nulls last, created_at desc);

create index if not exists private_conversations_participant_b_idx
  on public.private_conversations(participant_b, last_message_at desc nulls last, created_at desc);

create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint private_messages_body_length check (
    char_length(trim(body)) between 1 and 4000
  )
);

create index if not exists private_messages_conversation_idx
  on public.private_messages(conversation_id, created_at desc);

create index if not exists private_messages_sender_idx
  on public.private_messages(sender_id, created_at desc);

create table if not exists public.private_read_receipts (
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function private.touch_private_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_conversations
  set
    updated_at = new.created_at,
    last_message_at = new.created_at
  where id = new.conversation_id;

  return new;
end;
$$;

create or replace function private.enforce_private_message_participant()
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
      and new.sender_id in (conversation.participant_a, conversation.participant_b)
  ) then
    raise exception 'private message sender must be a conversation participant'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_private_receipt_participant()
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
    raise exception 'private receipt user must be a conversation participant'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists touch_private_conversation on public.private_messages;
create trigger touch_private_conversation
  after insert on public.private_messages
  for each row execute function private.touch_private_conversation();

drop trigger if exists enforce_private_message_participant on public.private_messages;
create trigger enforce_private_message_participant
  before insert on public.private_messages
  for each row execute function private.enforce_private_message_participant();

drop trigger if exists enforce_private_receipt_participant on public.private_read_receipts;
create trigger enforce_private_receipt_participant
  before insert or update on public.private_read_receipts
  for each row execute function private.enforce_private_receipt_participant();

alter table public.private_chat_profiles enable row level security;
alter table public.private_conversations enable row level security;
alter table public.private_messages enable row level security;
alter table public.private_read_receipts enable row level security;

revoke all on public.private_chat_profiles from anon, public;
revoke all on public.private_conversations from anon, public;
revoke all on public.private_messages from anon, public;
revoke all on public.private_read_receipts from anon, public;
revoke all on function private.touch_private_conversation() from public;
revoke all on function private.enforce_private_message_participant() from public;
revoke all on function private.enforce_private_receipt_participant() from public;

grant select, insert, update on public.private_chat_profiles to authenticated;
grant select, insert on public.private_conversations to authenticated;
grant select, insert on public.private_messages to authenticated;
grant select, insert, update on public.private_read_receipts to authenticated;

drop policy if exists "authenticated users discover private chat profiles" on public.private_chat_profiles;
create policy "authenticated users discover private chat profiles"
  on public.private_chat_profiles
  for select
  to authenticated
  using (true);

drop policy if exists "users create their private chat profile" on public.private_chat_profiles;
create policy "users create their private chat profile"
  on public.private_chat_profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "users update their private chat profile" on public.private_chat_profiles;
create policy "users update their private chat profile"
  on public.private_chat_profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "participants read private conversations" on public.private_conversations;
create policy "participants read private conversations"
  on public.private_conversations
  for select
  to authenticated
  using ((select auth.uid()) in (participant_a, participant_b));

drop policy if exists "participants create private conversations" on public.private_conversations;
create policy "participants create private conversations"
  on public.private_conversations
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (select auth.uid()) in (participant_a, participant_b)
  );

drop policy if exists "participants read private messages" on public.private_messages;
create policy "participants read private messages"
  on public.private_messages
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

drop policy if exists "participants send private messages" on public.private_messages;
create policy "participants send private messages"
  on public.private_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );

drop policy if exists "participants read private receipts" on public.private_read_receipts;
create policy "participants read private receipts"
  on public.private_read_receipts
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

drop policy if exists "participants create their private receipts" on public.private_read_receipts;
create policy "participants create their private receipts"
  on public.private_read_receipts
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

drop policy if exists "participants update their private receipts" on public.private_read_receipts;
create policy "participants update their private receipts"
  on public.private_read_receipts
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
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime drop table public.chat_messages;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_conversation_members'
  ) then
    alter publication supabase_realtime drop table public.chat_conversation_members;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_messages'
  ) then
    alter publication supabase_realtime add table public.private_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_read_receipts'
  ) then
    alter publication supabase_realtime add table public.private_read_receipts;
  end if;
end;
$$;
