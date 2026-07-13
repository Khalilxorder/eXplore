'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_private_message_notification_key';

const {
  dispatchPrivateMessageNotification,
  persistPrivateMessageDeliveryEvidence,
  probePrivateMessengerPushEvidence,
  resolvePrivateMessageNotification,
} = require('../src/services/privateMessengerNotificationService');

const conversationId = '10000000-0000-4000-8000-000000000001';
const messageId = '20000000-0000-4000-8000-000000000002';
const senderId = '30000000-0000-4000-8000-000000000003';
const recipientId = '40000000-0000-4000-8000-000000000004';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE device_tokens (
      token TEXT,
      user_id TEXT,
      active INTEGER,
      last_seen_at TEXT
    );
  `);
  return db;
}

function createSupabaseFetch({
  acceptedDeliveries = [],
  confirmedDeliveries = [],
  deviceTokens = [],
  failDeviceLookup = false,
  muted = false,
} = {}) {
  return async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const table = url.pathname.split('/').pop();
    if (table === 'device_tokens' && failDeviceLookup) {
      return { ok: false, status: 503, json: async () => [] };
    }
    if (table === 'notification_deliveries') {
      if (String(options.method || 'GET').toUpperCase() === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => JSON.parse(options.body || '[]'),
        };
      }
      const status = url.searchParams.get('status');
      return {
        ok: true,
        status: 200,
        json: async () => (
          status === 'eq.confirmed' ? confirmedDeliveries : acceptedDeliveries
        ),
      };
    }
    const payload = {
      private_conversations: [{
        id: conversationId,
        participant_a: senderId,
        participant_b: recipientId,
      }],
      private_messages: [{
        id: messageId,
        conversation_id: conversationId,
        sender_id: senderId,
        body: 'Private hello',
        attachment_name: null,
        deleted_at: null,
      }],
      private_conversation_preferences: muted ? [{ is_muted: true }] : [],
      private_chat_profiles: [{
        display_name: 'Khalil',
        username: 'khalil',
      }],
      device_tokens: deviceTokens.map((token, index) => ({ id: `device-${index}`, token })),
    }[table] || [];

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };
}

test('resolves a server-verified private-message notification payload', async () => {
  const originalFetch = global.fetch;
  global.fetch = createSupabaseFetch();
  try {
    const notification = await resolvePrivateMessageNotification({
      conversationId,
      messageId,
      senderId,
    });
    assert.equal(notification.recipientId, recipientId);
    assert.equal(notification.senderLabel, 'Khalil');
    assert.equal(notification.preview, 'Private hello');
    assert.equal(notification.muted, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('skips private-message push when the recipient muted the chat', async () => {
  const db = createDb();
  const originalFetch = global.fetch;
  global.fetch = createSupabaseFetch({ muted: true });
  try {
    const result = await dispatchPrivateMessageNotification(db, {
      conversationId,
      messageId,
      senderId,
    });
    assert.deepEqual(result, {
      ok: true,
      fcm_accepted: 0,
      device_confirmed: 0,
      skipped: 'muted',
    });
  } finally {
    global.fetch = originalFetch;
    db.close();
  }
});

test('skips private-message push when the recipient has no registered phone', async () => {
  const db = createDb();
  const originalFetch = global.fetch;
  global.fetch = createSupabaseFetch();
  try {
    const result = await dispatchPrivateMessageNotification(db, {
      conversationId,
      messageId,
      senderId,
    });
    assert.deepEqual(result, {
      ok: true,
      fcm_accepted: 0,
      device_confirmed: 0,
      skipped: 'no_registered_device',
      token_source: 'supabase',
      token_lookup_ready: true,
    });
  } finally {
    global.fetch = originalFetch;
    db.close();
  }
});

test('uses persisted Supabase recipient tokens instead of ephemeral SQLite tokens', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO device_tokens (token, user_id, active, last_seen_at)
    VALUES ('sqlite-token', ?, 1, CURRENT_TIMESTAMP)
  `).run(recipientId);
  const originalFetch = global.fetch;
  const sentTokens = [];
  global.fetch = createSupabaseFetch({ deviceTokens: ['supabase-token'] });

  try {
    const result = await dispatchPrivateMessageNotification(db, {
      conversationId,
      messageId,
      senderId,
    }, {
      sendNotification: async (token) => {
        sentTokens.push(token);
        return { ok: true, providerMessageId: 'projects/test/messages/accepted-1' };
      },
      persistDeliveryEvidence: async () => null,
    });

    assert.deepEqual(sentTokens, ['supabase-token']);
    assert.deepEqual(result, {
      ok: true,
      fcm_accepted: 1,
      device_confirmed: 0,
      failed: 0,
      token_source: 'supabase',
      token_lookup_ready: true,
    });
  } finally {
    global.fetch = originalFetch;
    db.close();
  }
});

test('falls back to SQLite only when the Supabase token lookup fails', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO device_tokens (token, user_id, active, last_seen_at)
    VALUES ('sqlite-token', ?, 1, CURRENT_TIMESTAMP)
  `).run(recipientId);
  const originalFetch = global.fetch;
  const sentTokens = [];
  global.fetch = createSupabaseFetch({ failDeviceLookup: true });

  try {
    const result = await dispatchPrivateMessageNotification(db, {
      conversationId,
      messageId,
      senderId,
    }, {
      sendNotification: async (token) => {
        sentTokens.push(token);
        return { ok: true, providerMessageId: 'projects/test/messages/accepted-2' };
      },
      persistDeliveryEvidence: async () => null,
    });

    assert.deepEqual(sentTokens, ['sqlite-token']);
    assert.equal(result.token_source, 'sqlite_fallback');
    assert.equal(result.token_lookup_ready, false);
    assert.equal(result.fcm_accepted, 1);
    assert.equal(result.device_confirmed, 0);
  } finally {
    global.fetch = originalFetch;
    db.close();
  }
});

test('persists only private-message FCM acceptance evidence with a hashed token channel', async () => {
  const originalFetch = global.fetch;
  let capturedRequest = null;
  global.fetch = async (url, options) => {
    capturedRequest = { url: String(url), options };
    return {
      ok: true,
      status: 201,
      json: async () => JSON.parse(options.body),
    };
  };

  try {
    await persistPrivateMessageDeliveryEvidence({
      messageId,
      recipientId,
    }, 'secret-device-token', {
      ok: true,
      providerMessageId: 'projects/test/messages/accepted-persisted',
    });

    const [row] = JSON.parse(capturedRequest.options.body);
    assert.match(capturedRequest.url, /notification_deliveries/);
    assert.match(row.channel, /^private_message:fcm:[a-f0-9]{20}$/);
    assert.equal(row.status, 'accepted');
    assert.equal(row.provider_message_id, 'projects/test/messages/accepted-persisted');
    assert.doesNotMatch(capturedRequest.options.body, /secret-device-token/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('probes private-message FCM acceptance separately from device confirmation', async () => {
  const originalFetch = global.fetch;
  global.fetch = createSupabaseFetch({
    deviceTokens: ['supabase-token'],
    acceptedDeliveries: [{
      provider_message_id: 'projects/test/messages/accepted-3',
      created_at: '2026-07-10T10:00:00.000Z',
    }],
  });

  try {
    const evidence = await probePrivateMessengerPushEvidence({ timeoutMs: 1000 });
    assert.equal(evidence.configured, true);
    assert.equal(evidence.token_lookup_ready, true);
    assert.equal(evidence.fcm_accepted, true);
    assert.equal(evidence.device_confirmed, false);
    assert.equal(evidence.fcm_provider_message_id, 'projects/test/messages/accepted-3');
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects malformed private-message notification identifiers before lookup', async () => {
  await assert.rejects(
    resolvePrivateMessageNotification({
      conversationId: 'invalid',
      messageId,
      senderId,
    }),
    /conversation_id is invalid/i,
  );
});
