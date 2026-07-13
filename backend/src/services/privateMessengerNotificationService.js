'use strict';

const crypto = require('node:crypto');
const {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  isUsableSupabaseServiceKey,
} = require('../auth/supabaseAuth');
const {
  listActiveDeviceTokens,
  recordNotificationDelivery,
  sendPrivateMessageFcmNotification,
} = require('./pushDeliveryService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_MESSAGE_CHANNEL_PREFIX = 'private_message:fcm:';
const DEFAULT_PUSH_EVIDENCE = Object.freeze({
  configured: false,
  token_lookup_ready: false,
  token_lookup_source: 'not_checked',
  token_lookup_checked_at: null,
  active_token_sample_count: 0,
  fcm_accepted: false,
  fcm_accepted_at: null,
  fcm_provider_message_id: null,
  device_confirmed: false,
  device_confirmed_at: null,
  lookup_error: '',
  evidence_error: '',
});

let lastPushEvidence = { ...DEFAULT_PUSH_EVIDENCE };

function requireUuid(value, label) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function hasPrivateMessengerPushConfig() {
  return Boolean(SUPABASE_URL && isUsableSupabaseServiceKey(SUPABASE_SERVICE_ROLE_KEY));
}

function buildRequestSignal(timeoutMs) {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }
  return AbortSignal.timeout(Math.max(250, Number(timeoutMs || 5000)));
}

async function fetchSupabaseRows(table, params = {}, options = {}) {
  if (!hasPrivateMessengerPushConfig()) {
    throw new Error('Private-message push is not configured.');
  }

  const query = new URLSearchParams(params);
  const response = await fetch(
    `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}${query.size ? `?${query.toString()}` : ''}`,
    {
      method: options.method || 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal || buildRequestSignal(options.timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`Private-message lookup failed (${response.status}).`);
  }
  if (response.status === 204) {
    return [];
  }
  return typeof response.json === 'function' ? response.json() : [];
}

function getPrivateMessengerPushEvidence() {
  return { ...lastPushEvidence };
}

function rememberTokenLookup({ ready, source, tokenCount = 0, error = '' }) {
  lastPushEvidence = {
    ...lastPushEvidence,
    configured: hasPrivateMessengerPushConfig(),
    token_lookup_ready: Boolean(ready),
    token_lookup_source: source,
    token_lookup_checked_at: new Date().toISOString(),
    active_token_sample_count: Math.max(0, Number(tokenCount || 0)),
    lookup_error: String(error || ''),
  };
}

function rememberFcmAcceptance(result = {}) {
  const providerMessageId = String(result.providerMessageId || '').trim();
  if (!result.ok || !providerMessageId) {
    return;
  }

  lastPushEvidence = {
    ...lastPushEvidence,
    fcm_accepted: true,
    fcm_accepted_at: new Date().toISOString(),
    fcm_provider_message_id: providerMessageId,
  };
}

async function listSupabaseRecipientTokens(recipientId, options = {}) {
  const normalizedRecipientId = requireUuid(recipientId, 'recipient_id');
  const rows = await fetchSupabaseRows('device_tokens', {
    select: 'token',
    user_id: `eq.${normalizedRecipientId}`,
    active: 'eq.true',
    order: 'last_seen_at.desc',
    limit: '20',
  }, options);
  return [...new Set((rows || []).map((row) => String(row?.token || '').trim()).filter(Boolean))];
}

async function resolveRecipientDeviceTokens(db, recipientId, options = {}) {
  if (hasPrivateMessengerPushConfig()) {
    try {
      const tokens = await listSupabaseRecipientTokens(recipientId, options);
      rememberTokenLookup({ ready: true, source: 'supabase', tokenCount: tokens.length });
      return {
        tokens,
        source: 'supabase',
        tokenLookupReady: true,
      };
    } catch (error) {
      const localTokens = listActiveDeviceTokens(db, recipientId);
      rememberTokenLookup({
        ready: false,
        source: 'sqlite_fallback',
        tokenCount: localTokens.length,
        error: error?.message || 'Supabase device-token lookup failed.',
      });
      return {
        tokens: localTokens,
        source: 'sqlite_fallback',
        tokenLookupReady: false,
      };
    }
  }

  const localTokens = listActiveDeviceTokens(db, recipientId);
  rememberTokenLookup({
    ready: false,
    source: 'sqlite_local',
    tokenCount: localTokens.length,
    error: 'Supabase service-role lookup is not configured.',
  });
  return {
    tokens: localTokens,
    source: 'sqlite_local',
    tokenLookupReady: false,
  };
}

async function probePrivateMessengerPushEvidence(options = {}) {
  const checkedAt = new Date().toISOString();
  if (!hasPrivateMessengerPushConfig()) {
    lastPushEvidence = {
      ...lastPushEvidence,
      configured: false,
      token_lookup_ready: false,
      token_lookup_source: 'not_configured',
      token_lookup_checked_at: checkedAt,
      active_token_sample_count: 0,
      lookup_error: 'Supabase service-role lookup is not configured.',
    };
    return getPrivateMessengerPushEvidence();
  }

  try {
    const rows = await fetchSupabaseRows('device_tokens', {
      select: 'id',
      active: 'eq.true',
      limit: '2',
    }, options);
    rememberTokenLookup({ ready: true, source: 'supabase_probe', tokenCount: rows?.length || 0 });
  } catch (error) {
    rememberTokenLookup({
      ready: false,
      source: 'supabase_probe_failed',
      error: error?.message || 'Supabase device-token probe failed.',
    });
  }

  try {
    const [acceptedRows, confirmedRows] = await Promise.all([
      fetchSupabaseRows('notification_deliveries', {
        select: 'provider_message_id,created_at',
        channel: `like.${PRIVATE_MESSAGE_CHANNEL_PREFIX}*`,
        status: 'eq.accepted',
        provider_message_id: 'not.is.null',
        order: 'created_at.desc',
        limit: '1',
      }, options),
      fetchSupabaseRows('notification_deliveries', {
        select: 'created_at',
        channel: `like.${PRIVATE_MESSAGE_CHANNEL_PREFIX}*`,
        status: 'eq.confirmed',
        order: 'created_at.desc',
        limit: '1',
      }, options),
    ]);
    const accepted = acceptedRows?.[0] || null;
    const confirmed = confirmedRows?.[0] || null;
    lastPushEvidence = {
      ...lastPushEvidence,
      fcm_accepted: Boolean(accepted) || lastPushEvidence.fcm_accepted,
      fcm_accepted_at: accepted?.created_at || lastPushEvidence.fcm_accepted_at,
      fcm_provider_message_id: accepted?.provider_message_id || lastPushEvidence.fcm_provider_message_id,
      device_confirmed: Boolean(confirmed) || lastPushEvidence.device_confirmed,
      device_confirmed_at: confirmed?.created_at || lastPushEvidence.device_confirmed_at,
      evidence_error: '',
    };
  } catch (error) {
    lastPushEvidence = {
      ...lastPushEvidence,
      evidence_error: error?.message || 'Private-message delivery evidence lookup failed.',
    };
  }

  return getPrivateMessengerPushEvidence();
}

async function resolvePrivateMessageNotification({ conversationId, messageId, senderId }) {
  const normalizedConversationId = requireUuid(conversationId, 'conversation_id');
  const normalizedMessageId = requireUuid(messageId, 'message_id');
  const normalizedSenderId = requireUuid(senderId, 'sender_id');

  const [conversation] = await fetchSupabaseRows('private_conversations', {
    select: 'id,participant_a,participant_b',
    id: `eq.${normalizedConversationId}`,
    limit: '1',
  });
  if (!conversation) {
    throw new Error('Private conversation was not found.');
  }
  if (conversation.participant_a !== normalizedSenderId && conversation.participant_b !== normalizedSenderId) {
    throw new Error('Only conversation participants can send private-message alerts.');
  }

  const [message] = await fetchSupabaseRows('private_messages', {
    select: 'id,conversation_id,sender_id,body,attachment_name,deleted_at',
    id: `eq.${normalizedMessageId}`,
    conversation_id: `eq.${normalizedConversationId}`,
    sender_id: `eq.${normalizedSenderId}`,
    limit: '1',
  });
  if (!message || message.deleted_at) {
    throw new Error('Private message was not found.');
  }

  const recipientId = conversation.participant_a === normalizedSenderId
    ? conversation.participant_b
    : conversation.participant_a;
  const [[preference], [profile]] = await Promise.all([
    fetchSupabaseRows('private_conversation_preferences', {
      select: 'is_muted',
      conversation_id: `eq.${normalizedConversationId}`,
      user_id: `eq.${recipientId}`,
      limit: '1',
    }),
    fetchSupabaseRows('private_chat_profiles', {
      select: 'display_name,username',
      user_id: `eq.${normalizedSenderId}`,
      limit: '1',
    }),
  ]);

  return {
    conversationId: normalizedConversationId,
    messageId: normalizedMessageId,
    recipientId,
    muted: Boolean(preference?.is_muted),
    senderLabel: String(profile?.display_name || profile?.username || '').trim() || 'New private message',
    preview: String(message.body || message.attachment_name || '').trim() || 'Attachment',
    attachmentName: String(message.attachment_name || '').trim(),
  };
}

function buildPrivateMessageChannel(token) {
  const fingerprint = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 20);
  return `${PRIVATE_MESSAGE_CHANNEL_PREFIX}${fingerprint}`;
}

function recordLocalDeliveryEvidence(db, notification, token, result) {
  if (!db?.prepare) {
    return;
  }
  try {
    recordNotificationDelivery(
      db,
      notification.recipientId,
      { id: notification.messageId },
      buildPrivateMessageChannel(token),
      result.ok ? 'accepted' : 'failed',
      result.error || '',
      result.providerMessageId || '',
    );
  } catch (error) {
    // Local SQLite evidence is optional on hosted/serverless runtimes.
  }
}

async function persistPrivateMessageDeliveryEvidence(notification, token, result, options = {}) {
  if (!hasPrivateMessengerPushConfig()) {
    return null;
  }
  const channel = buildPrivateMessageChannel(token);
  const dedupeKey = `${notification.recipientId}:${notification.messageId}:${channel}`;
  const rows = await fetchSupabaseRows('notification_deliveries', {
    on_conflict: 'dedupe_key',
  }, {
    ...options,
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      user_id: notification.recipientId,
      alert_id: notification.messageId,
      channel,
      dedupe_key: dedupeKey,
      status: result.ok ? 'accepted' : 'failed',
      error_message: result.error || null,
      provider_message_id: result.providerMessageId || null,
    }],
  });
  return rows?.[0] || null;
}

async function dispatchPrivateMessageNotification(db, input = {}, dependencies = {}) {
  if (!hasPrivateMessengerPushConfig()) {
    return {
      ok: true,
      fcm_accepted: 0,
      device_confirmed: 0,
      skipped: 'push_lookup_not_configured',
    };
  }

  const notification = await resolvePrivateMessageNotification(input);
  if (notification.muted) {
    return {
      ok: true,
      fcm_accepted: 0,
      device_confirmed: 0,
      skipped: 'muted',
    };
  }

  const tokenLookup = await resolveRecipientDeviceTokens(db, notification.recipientId);
  if (!tokenLookup.tokens.length) {
    return {
      ok: true,
      fcm_accepted: 0,
      device_confirmed: 0,
      skipped: 'no_registered_device',
      token_source: tokenLookup.source,
      token_lookup_ready: tokenLookup.tokenLookupReady,
    };
  }

  const sendNotification = dependencies.sendNotification || sendPrivateMessageFcmNotification;
  const persistDeliveryEvidence = dependencies.persistDeliveryEvidence || persistPrivateMessageDeliveryEvidence;
  const results = await Promise.all(tokenLookup.tokens.map(async (token) => {
    let result;
    try {
      result = await sendNotification(token, notification);
    } catch (error) {
      result = { ok: false, error: error?.message || 'FCM request failed.' };
    }

    rememberFcmAcceptance(result);
    recordLocalDeliveryEvidence(db, notification, token, result);
    try {
      await persistDeliveryEvidence(notification, token, result);
    } catch (error) {
      lastPushEvidence = {
        ...lastPushEvidence,
        evidence_error: error?.message || 'Could not persist private-message delivery evidence.',
      };
    }
    return result;
  }));

  const acceptedCount = results.filter((result) => result.ok && result.providerMessageId).length;
  return {
    ok: acceptedCount > 0,
    fcm_accepted: acceptedCount,
    device_confirmed: 0,
    failed: results.length - acceptedCount,
    token_source: tokenLookup.source,
    token_lookup_ready: tokenLookup.tokenLookupReady,
  };
}

module.exports = {
  PRIVATE_MESSAGE_CHANNEL_PREFIX,
  dispatchPrivateMessageNotification,
  getPrivateMessengerPushEvidence,
  hasPrivateMessengerPushConfig,
  listSupabaseRecipientTokens,
  persistPrivateMessageDeliveryEvidence,
  probePrivateMessengerPushEvidence,
  resolvePrivateMessageNotification,
  resolveRecipientDeviceTokens,
};
