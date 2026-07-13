const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260531_private_messenger.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const attachmentMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260601_private_messenger_attachments.sql');
const attachmentSql = fs.readFileSync(attachmentMigrationPath, 'utf8');
const leastPrivilegeMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260601_private_messenger_least_privilege.sql');
const leastPrivilegeSql = fs.readFileSync(leastPrivilegeMigrationPath, 'utf8');
const messageActionsMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260601_private_messenger_message_actions.sql');
const messageActionsSql = fs.readFileSync(messageActionsMigrationPath, 'utf8');
const typingMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260601_private_messenger_typing_status.sql');
const typingSql = fs.readFileSync(typingMigrationPath, 'utf8');
const conversationPreferencesMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260601_private_messenger_conversation_preferences.sql');
const conversationPreferencesSql = fs.readFileSync(conversationPreferencesMigrationPath, 'utf8');

function includesPattern(pattern, message) {
  assert.match(sql, pattern, message);
}

test('private messenger migration keeps one-to-one conversations ordered and unique', () => {
  includesPattern(
    /private_conversations_pair_order[\s\S]*participant_a\s*=\s*least\(participant_a,\s*participant_b\)[\s\S]*participant_b\s*=\s*greatest\(participant_a,\s*participant_b\)/i,
    'conversation participants must be stored in a stable order',
  );
  includesPattern(
    /private_conversations_creator_is_participant[\s\S]*created_by\s+in\s*\(participant_a,\s*participant_b\)/i,
    'conversation creator must be one of the two participants',
  );
  includesPattern(
    /create unique index if not exists private_conversations_pair_uq[\s\S]*least\(participant_a,\s*participant_b\),\s*greatest\(participant_a,\s*participant_b\)/i,
    'one-to-one conversations must have unordered uniqueness',
  );
});

test('private messenger migration enables RLS and keeps anonymous users out', () => {
  [
    'private_chat_profiles',
    'private_conversations',
    'private_messages',
    'private_read_receipts',
  ].forEach((table) => {
    includesPattern(
      new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      `${table} must have RLS enabled`,
    );
    includesPattern(
      new RegExp(`revoke all on public\\.${table} from anon, public`, 'i'),
      `${table} must not be exposed to anonymous users`,
    );
  });
});

test('private messenger migration limits normal writes to participants', () => {
  includesPattern(
    /create policy "participants send private messages"[\s\S]*sender_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*auth\.uid\(\)\)\s+in\s+\(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'message policy must require sender identity and conversation membership',
  );
  includesPattern(
    /create policy "participants update their private receipts"[\s\S]*user_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*auth\.uid\(\)\)\s+in\s+\(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'receipt update policy must require the current user and conversation membership',
  );
});

test('private messenger migration hardens admin and service-role writes', () => {
  includesPattern(
    /create or replace function private\.enforce_private_message_participant\(\)[\s\S]*new\.sender_id in \(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'message trigger must reject non-participant senders even outside client RLS',
  );
  includesPattern(
    /create trigger enforce_private_message_participant[\s\S]*before insert on public\.private_messages/i,
    'message participant trigger must run before insert',
  );
  includesPattern(
    /create or replace function private\.enforce_private_receipt_participant\(\)[\s\S]*new\.user_id in \(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'receipt trigger must reject non-participant users even outside client RLS',
  );
  includesPattern(
    /create trigger enforce_private_receipt_participant[\s\S]*before insert or update on public\.private_read_receipts/i,
    'receipt participant trigger must run before insert or update',
  );
});

test('private messenger migration exposes realtime only for chat events intentionally', () => {
  includesPattern(
    /alter publication supabase_realtime add table public\.private_messages/i,
    'private messages must be available for realtime delivery',
  );
  includesPattern(
    /alter publication supabase_realtime add table public\.private_read_receipts/i,
    'private read receipts must be available for live read status',
  );
  assert.doesNotMatch(
    sql,
    /alter publication supabase_realtime add table public\.private_conversations/i,
    'conversation rows should not be added to realtime publication',
  );
});

test('private messenger attachments remain private and participant-scoped', () => {
  assert.match(
    attachmentSql,
    /values \('private-chat-files', 'private-chat-files', false, 26214400\)/i,
    'chat attachment bucket must stay private and enforce the 25 MB limit',
  );
  assert.match(
    attachmentSql,
    /create policy "participants read private chat files"[\s\S]*auth\.uid\(\)\)\s+in\s+\(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'only conversation participants may read chat files',
  );
  assert.match(
    attachmentSql,
    /create policy "participants upload private chat files"[\s\S]*storage\.foldername\(name\)\)\[2\]\s*=\s*\(select auth\.uid\(\)\)::text/i,
    'upload paths must be scoped to the signed-in participant',
  );
});

test('private messenger removes stale authenticated privileges before narrow grants', () => {
  [
    'private_chat_profiles',
    'private_conversations',
    'private_messages',
    'private_read_receipts',
  ].forEach((table) => {
    assert.match(
      leastPrivilegeSql,
      new RegExp(`revoke all on public\\.${table} from authenticated`, 'i'),
      `${table} must clear stale authenticated privileges before granting the intended commands`,
    );
  });
  assert.doesNotMatch(
    leastPrivilegeSql,
    /grant[^;]*delete[^;]*to authenticated/i,
    'normal authenticated users must not receive delete privileges on messenger tables',
  );
});

test('private messenger message actions add reply, edit, and soft-delete metadata', () => {
  assert.match(
    messageActionsSql,
    /add column if not exists reply_to_message_id uuid references public\.private_messages\(id\) on delete set null[\s\S]*add column if not exists edited_at timestamptz[\s\S]*add column if not exists deleted_at timestamptz/i,
    'message action metadata must support replies, edit state, and soft deletion',
  );
});

test('private messenger replies cannot cross conversations', () => {
  assert.match(
    messageActionsSql,
    /create or replace function private\.enforce_private_message_reference\(\)[\s\S]*replied\.id = new\.reply_to_message_id[\s\S]*replied\.conversation_id = new\.conversation_id/i,
    'reply references must stay inside the current private conversation',
  );
  assert.match(
    messageActionsSql,
    /create trigger enforce_private_message_reference[\s\S]*before insert or update on public\.private_messages/i,
    'reply reference validation must run before inserts and updates',
  );
});

test('private messenger updates remain sender-only and immutable', () => {
  assert.match(
    messageActionsSql,
    /create policy "senders update private messages"[\s\S]*sender_id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*auth\.uid\(\)\)\s+in\s+\(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'only participant senders may edit or soft-delete their own messages',
  );
  assert.match(
    messageActionsSql,
    /create or replace function private\.enforce_private_message_sender_update\(\)[\s\S]*old\.conversation_id <> new\.conversation_id[\s\S]*old\.attachment_path is distinct from new\.attachment_path[\s\S]*old\.reply_to_message_id is distinct from new\.reply_to_message_id/i,
    'updates must not rewrite message ownership, attachments, or reply identity',
  );
});

test('private messenger typing status stays participant-scoped and realtime', () => {
  assert.match(
    typingSql,
    /create table if not exists public\.private_typing_status[\s\S]*primary key \(conversation_id, user_id\)/i,
    'typing state must be stored once per user and conversation',
  );
  assert.match(
    typingSql,
    /create policy "participants read private typing"[\s\S]*auth\.uid\(\)\)\s+in\s+\(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'only participants may receive private typing state',
  );
  assert.match(
    typingSql,
    /create policy "participants update their private typing"[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*with check[\s\S]*user_id = \(select auth\.uid\(\)\)/i,
    'users may update only their own typing state',
  );
  assert.match(
    typingSql,
    /alter publication supabase_realtime add table public\.private_typing_status/i,
    'typing state must publish realtime changes',
  );
});

test('private messenger conversation preferences stay per-user and participant-scoped', () => {
  assert.match(
    conversationPreferencesSql,
    /create table if not exists public\.private_conversation_preferences[\s\S]*is_pinned boolean not null default false[\s\S]*is_muted boolean not null default false[\s\S]*is_archived boolean not null default false[\s\S]*primary key \(conversation_id, user_id\)/i,
    'conversation preferences must be per-user and support pin, mute, and archive state',
  );
  assert.match(
    conversationPreferencesSql,
    /create or replace function private\.enforce_private_conversation_preference_participant\(\)[\s\S]*new\.user_id in \(conversation\.participant_a,\s*conversation\.participant_b\)/i,
    'conversation preference trigger must reject non-participants',
  );
  assert.match(
    conversationPreferencesSql,
    /create policy "users update their private conversation preferences"[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*with check[\s\S]*user_id = \(select auth\.uid\(\)\)/i,
    'users may update only their own conversation preferences',
  );
});
