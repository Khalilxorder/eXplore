alter table public.private_messages
  add column if not exists reply_to_message_id uuid references public.private_messages(id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists private_messages_reply_to_idx
  on public.private_messages(reply_to_message_id)
  where reply_to_message_id is not null;

create or replace function private.enforce_private_message_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to_message_id is not null and not exists (
    select 1
    from public.private_messages replied
    where replied.id = new.reply_to_message_id
      and replied.conversation_id = new.conversation_id
  ) then
    raise exception 'private message replies must reference the same conversation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_private_message_sender_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.conversation_id <> new.conversation_id
    or old.sender_id <> new.sender_id
    or old.created_at <> new.created_at
    or old.attachment_path is distinct from new.attachment_path
    or old.attachment_name is distinct from new.attachment_name
    or old.attachment_type is distinct from new.attachment_type
    or old.attachment_size is distinct from new.attachment_size
    or old.reply_to_message_id is distinct from new.reply_to_message_id then
    raise exception 'private message identity and attachment fields cannot be changed'
      using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'deleted private messages cannot be restored'
      using errcode = '42501';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at = coalesce(new.deleted_at, now());
  end if;

  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at = coalesce(new.edited_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_private_message_reference on public.private_messages;
create trigger enforce_private_message_reference
  before insert or update on public.private_messages
  for each row execute function private.enforce_private_message_reference();

drop trigger if exists enforce_private_message_sender_update on public.private_messages;
create trigger enforce_private_message_sender_update
  before update on public.private_messages
  for each row execute function private.enforce_private_message_sender_update();

revoke all on function private.enforce_private_message_reference() from public;
revoke all on function private.enforce_private_message_sender_update() from public;

grant update on public.private_messages to authenticated;

drop policy if exists "senders update private messages" on public.private_messages;
create policy "senders update private messages"
  on public.private_messages
  for update
  to authenticated
  using (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  )
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.private_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.participant_a, conversation.participant_b)
    )
  );
