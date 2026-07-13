import { supabase } from './supabase';

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const PRIVATE_CHAT_BUCKET = 'private-chat-files';
const SIGNED_ATTACHMENT_TTL_SECONDS = 60 * 60;
const MESSAGE_ACTION_SCHEMA_PATTERN = /\b(reply_to_message_id|edited_at|deleted_at)\b/i;
let privateMessageActionsSupported = true;

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  return supabase;
}

function normalizeUsername(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 24);
}

function normalizeProfile(row = {}) {
  return {
    userId: row.user_id || '',
    username: row.username || '',
    displayName: row.display_name || row.username || '',
    avatarUrl: row.avatar_url || '',
  };
}

function normalizeConversationPreference(row = {}) {
  return {
    isPinned: Boolean(row.is_pinned),
    isMuted: Boolean(row.is_muted),
    isArchived: Boolean(row.is_archived),
  };
}

function isParticipant(conversation, userId) {
  return conversation?.participant_a === userId || conversation?.participant_b === userId;
}

function getOtherUserId(conversation, userId) {
  if (!conversation || !userId) {
    return '';
  }
  return conversation.participant_a === userId ? conversation.participant_b : conversation.participant_a;
}

function sortPair(userId, otherUserId) {
  return [userId, otherUserId].sort((a, b) => a.localeCompare(b));
}

function isReadByOtherParticipant(row, otherReadAt) {
  if (!row?.created_at || !otherReadAt) {
    return false;
  }

  return new Date(row.created_at).getTime() <= new Date(otherReadAt).getTime();
}

function mapMessage(row, userId, { otherReadAt = '' } = {}) {
  const outbound = row.sender_id === userId;
  const deletedAt = row.deleted_at || '';
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    direction: outbound ? 'outbound' : 'inbound',
    text: deletedAt ? '' : (row.body || ''),
    rawText: row.body || '',
    createdAt: row.created_at,
    editedAt: row.edited_at || '',
    deletedAt,
    replyToMessageId: row.reply_to_message_id || '',
    replyTo: null,
    attachment: row.attachment_path
      ? {
          path: row.attachment_path,
          name: row.attachment_name || 'Attachment',
          type: row.attachment_type || 'application/octet-stream',
          size: Number(row.attachment_size || 0),
          url: row.attachment_url || '',
        }
      : null,
    deliveryStatus: outbound
      ? (isReadByOtherParticipant(row, otherReadAt) ? 'read' : 'sent')
      : '',
  };
}

function attachmentColumns({ includeActions = privateMessageActionsSupported } = {}) {
  const columns = 'id, conversation_id, sender_id, body, attachment_path, attachment_name, attachment_type, attachment_size';
  return includeActions
    ? `${columns}, reply_to_message_id, edited_at, deleted_at, created_at`
    : `${columns}, created_at`;
}

function isMissingMessageActionSchema(error) {
  return MESSAGE_ACTION_SCHEMA_PATTERN.test(String(error?.message || error?.details || ''));
}

function messageActionsMigrationError() {
  return new Error('Message actions need the latest private-chat database update.');
}

async function selectPrivateMessages(buildQuery) {
  let response = await buildQuery(attachmentColumns());
  if (response.error && privateMessageActionsSupported && isMissingMessageActionSchema(response.error)) {
    privateMessageActionsSupported = false;
    response = await buildQuery(attachmentColumns({ includeActions: false }));
  }
  return response;
}

function linkMessageReplies(messages = [], replyTargets = []) {
  const byId = new Map([...replyTargets, ...messages].map((message) => [message.id, message]));
  return messages.map((message) => {
    if (!message.replyToMessageId) {
      return message;
    }
    const replied = byId.get(message.replyToMessageId);
    if (!replied) {
      return message;
    }
    return {
      ...message,
      replyTo: {
        id: replied.id,
        senderId: replied.senderId,
        direction: replied.direction,
        text: replied.deletedAt ? 'Deleted message' : (replied.text || replied.attachment?.name || 'Attachment'),
        attachmentName: replied.attachment?.name || '',
      },
    };
  });
}

async function hydrateMessageReplies(messages = [], userId) {
  const existingIds = new Set(messages.map((message) => message.id));
  const missingIds = [...new Set(
    messages
      .map((message) => message.replyToMessageId)
      .filter((messageId) => messageId && !existingIds.has(messageId)),
  )];
  if (!missingIds.length) {
    return linkMessageReplies(messages);
  }

  const client = requireClient();
  const { data, error } = await selectPrivateMessages((columns) => client
    .from('private_messages')
    .select(columns)
    .in('id', missingIds));
  if (error) {
    throw mapError(error);
  }

  return linkMessageReplies(
    messages,
    (data || []).map((row) => mapMessage(row, userId)),
  );
}

async function hydrateAttachmentUrls(messages = []) {
  const client = requireClient();
  return Promise.all(messages.map(async (message) => {
    if (!message?.attachment?.path) {
      return message;
    }

    const { data, error } = await client.storage
      .from(PRIVATE_CHAT_BUCKET)
      .createSignedUrl(message.attachment.path, SIGNED_ATTACHMENT_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      return message;
    }

    return {
      ...message,
      attachment: {
        ...message.attachment,
        url: data.signedUrl,
      },
    };
  }));
}

function mapError(error) {
  const message = String(error?.message || '');
  if (isMissingMessageActionSchema(error)) {
    privateMessageActionsSupported = false;
    return messageActionsMigrationError();
  }
  if (error?.code === '23505' && /private_chat_profiles_username/i.test(message)) {
    return new Error('That username is already taken.');
  }
  if (error?.code === '23505') {
    return new Error('That private chat already exists.');
  }
  return error;
}

export function validatePrivateUsername(username) {
  const normalized = normalizeUsername(username);
  return {
    username: normalized,
    valid: USERNAME_PATTERN.test(normalized),
  };
}

export async function fetchPrivateChatProfile(userId) {
  if (!userId) {
    return null;
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_chat_profiles')
    .select('user_id, username, display_name, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw mapError(error);
  }

  return data ? normalizeProfile(data) : null;
}

export async function savePrivateChatProfile({ userId, username, displayName = '', avatarUrl = '' }) {
  const client = requireClient();
  const normalized = normalizeUsername(username);
  if (!isSafeUsername(normalized)) {
    throw new Error('Use 3-24 lowercase letters, numbers, or underscores.');
  }

  const { data, error } = await client
    .from('private_chat_profiles')
    .upsert({
      user_id: userId,
      username: normalized,
      display_name: String(displayName || normalized).trim().slice(0, 80),
      avatar_url: String(avatarUrl || '').trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('user_id, username, display_name, avatar_url')
    .single();

  if (error) {
    throw mapError(error);
  }

  return normalizeProfile(data);
}

function isSafeUsername(username) {
  return USERNAME_PATTERN.test(username);
}

export async function searchPrivateChatProfiles(query, currentUserId) {
  const normalized = normalizeUsername(query);
  if (!normalized || normalized.length < 2) {
    return [];
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_chat_profiles')
    .select('user_id, username, display_name, avatar_url')
    .ilike('username', `${normalized}%`)
    .neq('user_id', currentUserId)
    .limit(8);

  if (error) {
    throw mapError(error);
  }

  return (data || []).map(normalizeProfile);
}

async function fetchProfilesForUserIds(userIds = []) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_chat_profiles')
    .select('user_id, username, display_name, avatar_url')
    .in('user_id', uniqueIds);

  if (error) {
    throw mapError(error);
  }

  return new Map((data || []).map((profile) => [profile.user_id, normalizeProfile(profile)]));
}

async function fetchLatestMessages(conversationIds = [], userId) {
  const uniqueIds = [...new Set(conversationIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const client = requireClient();
  const latestRows = await Promise.all(uniqueIds.map(async (conversationId) => {
    const { data, error } = await selectPrivateMessages((columns) => client
        .from('private_messages')
        .select(columns)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle());

    if (error) {
      throw mapError(error);
    }

    return data ? [conversationId, mapMessage(data, userId)] : null;
  }));

  return new Map(latestRows.filter(Boolean));
}

async function fetchReadReceipts(conversationIds = [], userId) {
  const uniqueIds = [...new Set(conversationIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_read_receipts')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId)
    .in('conversation_id', uniqueIds);

  if (error) {
    throw mapError(error);
  }

  return new Map((data || []).map((receipt) => [receipt.conversation_id, receipt.last_read_at]));
}

async function fetchConversationReceiptState(conversationId, userId) {
  if (!conversationId || !userId) {
    return { otherUserId: '', otherReadAt: '' };
  }

  const client = requireClient();
  const conversationResponse = await client
    .from('private_conversations')
    .select('participant_a, participant_b')
    .eq('id', conversationId)
    .maybeSingle();

  if (conversationResponse.error) {
    throw mapError(conversationResponse.error);
  }

  const conversation = conversationResponse.data || {};
  const otherUserId = getOtherUserId(conversation, userId);
  if (!otherUserId) {
    return { otherUserId: '', otherReadAt: '' };
  }

  const receiptResponse = await client
    .from('private_read_receipts')
    .select('user_id, last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', otherUserId)
    .maybeSingle();

  if (receiptResponse.error) {
    throw mapError(receiptResponse.error);
  }

  return {
    otherUserId,
    otherReadAt: receiptResponse.data?.last_read_at || '',
  };
}

async function fetchUnreadCounts(conversations = [], userId, receiptMap = new Map()) {
  const conversationIds = conversations.map((conversation) => conversation.id).filter(Boolean);
  if (!conversationIds.length) {
    return new Map();
  }

  const client = requireClient();
  const countRows = await Promise.all(conversationIds.map(async (conversationId) => {
    let query = client
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId);
    const lastReadAt = receiptMap.get(conversationId);
    if (lastReadAt) {
      query = query.gt('created_at', lastReadAt);
    }
    const { count, error } = await query;
    if (error) {
      throw mapError(error);
    }
    return [conversationId, count || 0];
  }));

  return new Map(countRows);
}

async function fetchConversationPreferences(conversationIds = [], userId) {
  const uniqueIds = [...new Set(conversationIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_conversation_preferences')
    .select('conversation_id, is_pinned, is_muted, is_archived')
    .eq('user_id', userId)
    .in('conversation_id', uniqueIds);

  if (error) {
    throw mapError(error);
  }

  return new Map((data || []).map((row) => [row.conversation_id, normalizeConversationPreference(row)]));
}

export async function fetchPrivateConversations(userId) {
  if (!userId) {
    return [];
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_conversations')
    .select('id, participant_a, participant_b, created_by, created_at, updated_at, last_message_at')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw mapError(error);
  }

  const conversations = (data || []).filter((conversation) => isParticipant(conversation, userId));
  const otherIds = conversations.map((conversation) => getOtherUserId(conversation, userId));
  const profileMap = await fetchProfilesForUserIds(otherIds);
  const latestMap = await fetchLatestMessages(conversations.map((conversation) => conversation.id), userId);
  const receiptMap = await fetchReadReceipts(conversations.map((conversation) => conversation.id), userId);
  const unreadMap = await fetchUnreadCounts(conversations, userId, receiptMap);
  const preferenceMap = await fetchConversationPreferences(conversations.map((conversation) => conversation.id), userId);

  return conversations.map((conversation) => {
    const otherUserId = getOtherUserId(conversation, userId);
    const profile = profileMap.get(otherUserId) || {
      userId: otherUserId,
      username: 'private_user',
      displayName: 'Private user',
      avatarUrl: '',
    };
    const latestMessage = latestMap.get(conversation.id) || null;
    const preferences = preferenceMap.get(conversation.id) || normalizeConversationPreference();
    return {
      id: conversation.id,
      participantA: conversation.participant_a,
      participantB: conversation.participant_b,
      otherUserId,
      profile,
      latestMessage,
      unreadCount: unreadMap.get(conversation.id) || 0,
      ...preferences,
      updatedAt: conversation.last_message_at || conversation.updated_at || conversation.created_at,
    };
  }).sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
}

export async function updatePrivateConversationPreference({ conversationId, userId, patch = {} }) {
  if (!conversationId || !userId) {
    return normalizeConversationPreference();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_conversation_preferences')
    .upsert({
      conversation_id: conversationId,
      user_id: userId,
      is_pinned: Boolean(patch.isPinned),
      is_muted: Boolean(patch.isMuted),
      is_archived: Boolean(patch.isArchived),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' })
    .select('is_pinned, is_muted, is_archived')
    .single();

  if (error) {
    throw mapError(error);
  }

  return normalizeConversationPreference(data);
}

export async function fetchPrivateMessages(conversationId, userId, options = {}) {
  if (!conversationId) {
    return [];
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 200));
  const client = requireClient();
  const [{ data, error }, receiptState] = await Promise.all([
    selectPrivateMessages((columns) => {
      let query = client
        .from('private_messages')
        .select(columns)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (options.before) {
        query = query.lt('created_at', options.before);
      }
      return query;
    }),
    fetchConversationReceiptState(conversationId, userId),
  ]);

  if (error) {
    throw mapError(error);
  }

  const hydrated = await hydrateAttachmentUrls((data || []).reverse().map((row) => mapMessage(row, userId, {
    otherReadAt: receiptState.otherReadAt,
  })));
  return hydrateMessageReplies(hydrated, userId);
}

export async function createPrivateConversation(currentUserId, otherUserId) {
  if (!currentUserId || !otherUserId || currentUserId === otherUserId) {
    throw new Error('Choose another eXplore user.');
  }

  const client = requireClient();
  const [participantA, participantB] = sortPair(currentUserId, otherUserId);

  const existingQuery = () => client
    .from('private_conversations')
    .select('id, participant_a, participant_b, created_by, created_at, updated_at, last_message_at')
    .eq('participant_a', participantA)
    .eq('participant_b', participantB)
    .maybeSingle();

  const existing = await existingQuery();
  if (existing.error) {
    throw mapError(existing.error);
  }
  if (existing.data) {
    return existing.data.id;
  }

  const { data, error } = await client
    .from('private_conversations')
    .insert({
      participant_a: participantA,
      participant_b: participantB,
      created_by: currentUserId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const retry = await existingQuery();
      if (retry.data?.id) {
        return retry.data.id;
      }
    }
    throw mapError(error);
  }

  return data.id;
}

export async function uploadPrivateAttachment({ conversationId, senderId, file }) {
  if (!conversationId || !senderId || !file) {
    throw new Error('Choose a file first.');
  }

  const client = requireClient();
  const safeName = String(file.name || 'attachment')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-100);
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${conversationId}/${senderId}/${randomId}-${safeName}`;
  const { error } = await client.storage
    .from(PRIVATE_CHAT_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw mapError(error);
  }

  return {
    path,
    name: safeName,
    type: file.type || 'application/octet-stream',
    size: Number(file.size || 0),
  };
}

export async function sendPrivateMessage({ conversationId, senderId, body, attachment = null, replyToMessageId = '' }) {
  const text = String(body || '').trim();
  if (!text && !attachment?.path) {
    return null;
  }

  const client = requireClient();
  const payload = {
    conversation_id: conversationId,
    sender_id: senderId,
    body: (text || attachment?.name || 'Attachment').slice(0, 4000),
    attachment_path: attachment?.path || null,
    attachment_name: attachment?.name || null,
    attachment_type: attachment?.type || null,
    attachment_size: Number(attachment?.size || 0) || null,
  };
  if (privateMessageActionsSupported) {
    payload.reply_to_message_id = replyToMessageId || null;
  }

  let { data, error } = await client
    .from('private_messages')
    .insert(payload)
    .select(attachmentColumns())
    .single();

  if (error && privateMessageActionsSupported && isMissingMessageActionSchema(error)) {
    privateMessageActionsSupported = false;
    delete payload.reply_to_message_id;
    ({ data, error } = await client
      .from('private_messages')
      .insert(payload)
      .select(attachmentColumns({ includeActions: false }))
      .single());
  }

  if (error) {
    throw mapError(error);
  }

  const [message] = await hydrateAttachmentUrls([mapMessage(data, senderId)]);
  return message;
}

export async function editPrivateMessage({ messageId, body }) {
  const text = String(body || '').trim();
  if (!messageId || !text) {
    throw new Error('Enter a message first.');
  }
  if (!privateMessageActionsSupported) {
    throw messageActionsMigrationError();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_messages')
    .update({
      body: text.slice(0, 4000),
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .is('deleted_at', null)
    .select(attachmentColumns())
    .single();

  if (error) {
    throw mapError(error);
  }

  const [message] = await hydrateAttachmentUrls([mapMessage(data, data.sender_id)]);
  return message;
}

export async function deletePrivateMessage({ messageId }) {
  if (!messageId) {
    return null;
  }
  if (!privateMessageActionsSupported) {
    throw messageActionsMigrationError();
  }

  const client = requireClient();
  const { data, error } = await client
    .from('private_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('deleted_at', null)
    .select(attachmentColumns())
    .single();

  if (error) {
    throw mapError(error);
  }

  return mapMessage(data, data.sender_id);
}

export async function markPrivateConversationRead(conversationId, userId) {
  if (!conversationId || !userId) {
    return;
  }

  const client = requireClient();
  const { error } = await client
    .from('private_read_receipts')
    .upsert({
      conversation_id: conversationId,
      user_id: userId,
      last_read_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' });

  if (error) {
    throw mapError(error);
  }
}

export function subscribeToPrivateMessages({ userId, onChange, onStatus }) {
  if (!supabase || !userId || typeof onChange !== 'function') {
    return () => {};
  }

  const channel = supabase
    .channel(`private-messages-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'private_messages',
      },
      (payload) => onChange(payload)
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'private_read_receipts',
      },
      (payload) => onChange(payload)
    )
    .subscribe((status, error) => {
      onStatus?.({ status, error });
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToPrivateTyping({ conversationId, userId, onTyping, onStatus }) {
  if (!supabase || !conversationId || !userId) {
    return {
      send: () => {},
      unsubscribe: () => {},
    };
  }

  const channel = supabase
    .channel(`private-typing-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'private_typing_status',
        filter: `conversation_id=eq.${conversationId}`,
      },
      ({ new: nextRow = {} }) => {
        if (nextRow.user_id && nextRow.user_id !== userId) {
          const updatedAtMs = new Date(nextRow.updated_at || 0).getTime();
          const stillCurrent = Number.isFinite(updatedAtMs) && (Date.now() - updatedAtMs) < 5000;
          onTyping?.(stillCurrent && Boolean(nextRow.is_typing));
        }
      }
    )
    .subscribe((status, error) => {
      onStatus?.({ status, error });
    });

  return {
    send: (isTyping) => {
      void supabase
        .from('private_typing_status')
        .upsert({
          conversation_id: conversationId,
          user_id: userId,
          is_typing: Boolean(isTyping),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'conversation_id,user_id' });
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
