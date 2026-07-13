import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const rootDir = process.cwd();

function parseEnvFile(relativePath) {
  const fullPath = `${rootDir}/${relativePath}`;
  if (!existsSync(fullPath)) {
    return {};
  }

  const output = {};
  const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

function pickFirst(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function redactId(value = '') {
  return `${String(value).slice(0, 8)}...`;
}

async function must(label, promise) {
  const result = await promise;
  if (result?.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result?.data;
}

async function expectBlocked(label, promise) {
  const result = await promise;
  if (result?.error) {
    return true;
  }
  if (Array.isArray(result?.data) && result.data.length === 0) {
    return true;
  }
  if (result?.data == null) {
    return true;
  }
  throw new Error(`${label}: unexpectedly allowed.`);
}

async function cleanup(admin, state) {
  const errors = [];
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };

  if (state.conversationId) {
    await attempt('delete typing', () => admin.from('private_typing_status').delete().eq('conversation_id', state.conversationId));
    await attempt('delete preferences', () => admin.from('private_conversation_preferences').delete().eq('conversation_id', state.conversationId));
    await attempt('delete receipts', () => admin.from('private_read_receipts').delete().eq('conversation_id', state.conversationId));
    await attempt('delete messages', () => admin.from('private_messages').delete().eq('conversation_id', state.conversationId));
    await attempt('delete conversation', () => admin.from('private_conversations').delete().eq('id', state.conversationId));
  }

  for (const userId of state.userIds) {
    await attempt(`delete profile ${redactId(userId)}`, () => admin.from('private_chat_profiles').delete().eq('user_id', userId));
  }

  for (const userId of state.userIds) {
    await attempt(`delete auth user ${redactId(userId)}`, async () => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        throw error;
      }
    });
  }

  return errors;
}

async function main() {
  const env = {
    ...parseEnvFile('.env.local'),
    ...parseEnvFile('backend/.env'),
    ...process.env,
  };

  const supabaseUrl = pickFirst(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = pickFirst(
    env.SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.SUPABASE_PUBLISHABLE_KEY,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const serviceKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw new Error('Missing Supabase URL, anon/publishable key, or service key in local env files.');
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const makeClient = () => createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const stamp = `${Date.now()}${randomBytes(3).toString('hex')}`.toLowerCase();
  const password = `LiveProof-${randomBytes(12).toString('hex')}!Aa1`;
  const state = {
    conversationId: '',
    userIds: [],
  };
  let cleanupErrors = [];

  try {
    const emailA = `explore-live-proof-${stamp}-a@example.invalid`;
    const emailB = `explore-live-proof-${stamp}-b@example.invalid`;
    const emailC = `explore-live-proof-${stamp}-c@example.invalid`;

    const userA = await must('create user A', admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
      user_metadata: { name: 'eXplore Live Proof A' },
    }));
    const userB = await must('create user B', admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
      user_metadata: { name: 'eXplore Live Proof B' },
    }));
    const userC = await must('create user C', admin.auth.admin.createUser({
      email: emailC,
      password,
      email_confirm: true,
      user_metadata: { name: 'eXplore Live Proof C' },
    }));

    const userIdA = userA.user.id;
    const userIdB = userB.user.id;
    const userIdC = userC.user.id;
    state.userIds.push(userIdA, userIdB, userIdC);

    const clientA = makeClient();
    const clientB = makeClient();
    const clientC = makeClient();

    await must('sign in A', clientA.auth.signInWithPassword({ email: emailA, password }));
    await must('sign in B', clientB.auth.signInWithPassword({ email: emailB, password }));
    await must('sign in C', clientC.auth.signInWithPassword({ email: emailC, password }));

    const usernameA = `proofa_${stamp}`.slice(0, 24);
    const usernameB = `proofb_${stamp}`.slice(0, 24);

    await must('profile A', clientA.from('private_chat_profiles').upsert({
      user_id: userIdA,
      username: usernameA,
      display_name: 'Live Proof A',
      avatar_url: '',
    }, { onConflict: 'user_id' }).select('user_id,username').single());

    await must('profile B', clientB.from('private_chat_profiles').upsert({
      user_id: userIdB,
      username: usernameB,
      display_name: 'Live Proof B',
      avatar_url: '',
    }, { onConflict: 'user_id' }).select('user_id,username').single());

    const searchFromB = await must(
      'B searches A',
      clientB.from('private_chat_profiles')
        .select('user_id,username')
        .ilike('username', `${usernameA.slice(0, 8)}%`)
        .neq('user_id', userIdB)
        .limit(8),
    );
    if (!searchFromB.some((profile) => profile.user_id === userIdA)) {
      throw new Error('B could not discover A by username.');
    }

    const [participantA, participantB] = [userIdA, userIdB].sort((a, b) => a.localeCompare(b));
    const conversation = await must('create conversation', clientA
      .from('private_conversations')
      .insert({
        participant_a: participantA,
        participant_b: participantB,
        created_by: userIdA,
      })
      .select('id,participant_a,participant_b,created_by')
      .single());
    state.conversationId = conversation.id;

    await expectBlocked(
      'non-participant cannot read conversation',
      clientC.from('private_conversations')
        .select('id')
        .eq('id', conversation.id),
    );

    const messageA = await must('A sends message', clientA
      .from('private_messages')
      .insert({
        conversation_id: conversation.id,
        sender_id: userIdA,
        body: 'Live proof hello from A',
      })
      .select('id,conversation_id,sender_id,body,created_at,reply_to_message_id,edited_at,deleted_at')
      .single());

    const messagesForB = await must('B reads message', clientB
      .from('private_messages')
      .select('id,sender_id,body,created_at,reply_to_message_id,edited_at,deleted_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true }));
    if (!messagesForB.some((message) => message.id === messageA.id && message.body === 'Live proof hello from A')) {
      throw new Error('B did not receive A message.');
    }

    await must('B read receipt', clientB
      .from('private_read_receipts')
      .upsert({
        conversation_id: conversation.id,
        user_id: userIdB,
        last_read_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id,user_id' })
      .select('conversation_id,user_id,last_read_at')
      .single());

    const receiptSeenByA = await must('A reads B receipt', clientA
      .from('private_read_receipts')
      .select('conversation_id,user_id,last_read_at')
      .eq('conversation_id', conversation.id)
      .eq('user_id', userIdB)
      .maybeSingle());
    if (!receiptSeenByA) {
      throw new Error('A could not see B read receipt.');
    }

    const replyB = await must('B replies', clientB
      .from('private_messages')
      .insert({
        conversation_id: conversation.id,
        sender_id: userIdB,
        body: 'Live proof reply from B',
        reply_to_message_id: messageA.id,
      })
      .select('id,conversation_id,sender_id,body,created_at,reply_to_message_id,edited_at,deleted_at')
      .single());
    if (replyB.reply_to_message_id !== messageA.id) {
      throw new Error('Reply was not linked to the original message.');
    }

    await expectBlocked(
      'non-sender cannot edit message',
      clientB.from('private_messages')
        .update({
          body: 'Unauthorized edit',
          edited_at: new Date().toISOString(),
        })
        .eq('id', messageA.id)
        .select('id'),
    );

    const editedA = await must('sender edits own message', clientA
      .from('private_messages')
      .update({
        body: 'Live proof edited by A',
        edited_at: new Date().toISOString(),
      })
      .eq('id', messageA.id)
      .is('deleted_at', null)
      .select('id,body,edited_at,deleted_at')
      .single());
    if (editedA.body !== 'Live proof edited by A' || !editedA.edited_at) {
      throw new Error('Sender edit did not persist.');
    }

    const deletedA = await must('sender soft deletes own message', clientA
      .from('private_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageA.id)
      .is('deleted_at', null)
      .select('id,deleted_at')
      .single());
    if (!deletedA.deleted_at) {
      throw new Error('Sender delete did not persist.');
    }

    await must('B preference update', clientB
      .from('private_conversation_preferences')
      .upsert({
        conversation_id: conversation.id,
        user_id: userIdB,
        is_pinned: true,
        is_muted: false,
        is_archived: false,
      }, { onConflict: 'conversation_id,user_id' })
      .select('conversation_id,user_id,is_pinned,is_muted,is_archived')
      .single());

    await must('A typing update', clientA
      .from('private_typing_status')
      .upsert({
        conversation_id: conversation.id,
        user_id: userIdA,
        is_typing: true,
      }, { onConflict: 'conversation_id,user_id' })
      .select('conversation_id,user_id,is_typing')
      .single());

    process.env.SUPABASE_URL = supabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    const { resolvePrivateMessageNotification } = require('../backend/src/services/privateMessengerNotificationService.js');
    const notification = await resolvePrivateMessageNotification({
      conversationId: conversation.id,
      messageId: replyB.id,
      senderId: userIdB,
    });
    if (notification.recipientId !== userIdA || notification.preview !== 'Live proof reply from B') {
      throw new Error('Private-message notification lookup resolved the wrong recipient or preview.');
    }

    cleanupErrors = await cleanup(admin, state);
    if (cleanupErrors.length) {
      throw new Error(`Live proof passed, but cleanup had ${cleanupErrors.length} issue(s).`);
    }

    console.log(JSON.stringify({
      passed: true,
      checked: {
        createdTemporaryUsers: 3,
        profileSearch: true,
        oneToOneConversation: true,
        participantRls: true,
        sendReadReply: true,
        readReceipt: true,
        senderOnlyEdit: true,
        senderSoftDelete: true,
        preferences: true,
        typingStatus: true,
        notificationLookup: true,
        cleanup: true,
      },
    }, null, 2));
  } catch (error) {
    cleanupErrors = await cleanup(admin, state);
    const cleanupSuffix = cleanupErrors.length
      ? ` Cleanup issues: ${cleanupErrors.join(' | ')}`
      : '';
    throw new Error(`${error.message}${cleanupSuffix}`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    passed: false,
    error: error.message,
  }, null, 2));
  process.exit(1);
});
