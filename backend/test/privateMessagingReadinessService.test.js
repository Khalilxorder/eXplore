'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function loadService() {
  [
    '../src/services/privateMessagingReadinessService',
    '../src/services/privateMessengerNotificationService',
    '../src/services/pushDeliveryService',
    '../src/auth/supabaseAuth',
  ].forEach((modulePath) => {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  });
  const servicePath = require.resolve('../src/services/privateMessagingReadinessService');
  return require('../src/services/privateMessagingReadinessService');
}

function restoreEnv(originalEnv) {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.entries(originalEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function createDb({ includePrivateSchema = false, includeLiveEvidence = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE device_tokens (
      token TEXT,
      user_id TEXT,
      active INTEGER,
      last_seen_at TEXT
    );

    CREATE TABLE notification_deliveries (
      provider_message_id TEXT,
      channel TEXT,
      status TEXT,
      created_at TEXT
    );
  `);

  if (includePrivateSchema) {
    db.exec(`
      CREATE TABLE private_chat_profiles (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        display_name TEXT,
        avatar_url TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE private_conversations (
        id TEXT PRIMARY KEY,
        participant_a TEXT,
        participant_b TEXT,
        created_by TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_message_at TEXT
      );

      CREATE TABLE private_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        sender_id TEXT,
        body TEXT,
        attachment_path TEXT,
        attachment_name TEXT,
        attachment_type TEXT,
        attachment_size INTEGER,
        reply_to_message_id TEXT,
        edited_at TEXT,
        deleted_at TEXT,
        created_at TEXT
      );

      CREATE TABLE private_read_receipts (
        conversation_id TEXT,
        user_id TEXT,
        last_read_at TEXT
      );

      CREATE TABLE private_typing_status (
        conversation_id TEXT,
        user_id TEXT,
        is_typing INTEGER,
        updated_at TEXT
      );

      CREATE TABLE private_conversation_preferences (
        conversation_id TEXT,
        user_id TEXT,
        is_pinned INTEGER,
        is_muted INTEGER,
        is_archived INTEGER,
        updated_at TEXT
      );
    `);
  }

  if (includeLiveEvidence) {
    db.exec(`
      INSERT INTO private_conversations (id, participant_a, participant_b, created_by)
      VALUES ('conversation-1', 'user-a', 'user-b', 'user-a');

      INSERT INTO private_messages (id, conversation_id, sender_id, body, created_at)
      VALUES ('message-1', 'conversation-1', 'user-a', 'hello', CURRENT_TIMESTAMP);

      INSERT INTO private_read_receipts (conversation_id, user_id, last_read_at)
      VALUES ('conversation-1', 'user-b', CURRENT_TIMESTAMP);

      INSERT INTO device_tokens (token, user_id, active, last_seen_at)
      VALUES ('token-a', 'user-a', 1, CURRENT_TIMESTAMP),
             ('token-b', 'user-b', 1, CURRENT_TIMESTAMP);

      INSERT INTO notification_deliveries (provider_message_id, channel, status, created_at)
      VALUES ('unrelated-priority-push', 'push:device-1', 'sent', CURRENT_TIMESTAMP);
    `);
  }

  return db;
}

test('private messaging readiness is partial when only Supabase migrations prove the flow', () => {
  const originalEnv = { ...process.env };
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
  process.env.FIREBASE_PROJECT_ID = '';
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';

  const { buildPrivateMessagingReadiness } = loadService();
  const db = createDb();

  try {
    const readiness = buildPrivateMessagingReadiness({ db, user: null });

    assert.equal(readiness.status, 'partial');
    assert.equal(readiness.migration_proof_ready, true);
    assert.equal(readiness.runtime_schema_ready, false);
    assert.deepEqual(readiness.present_tables, []);
    assert.ok(readiness.missing_tables.includes('private_messages'));
    assert.ok(readiness.blockers.some((blocker) => /local runtime/i.test(blocker)));
    assert.ok(readiness.blockers.some((blocker) => /recipient device/i.test(blocker)));
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('aggregate messages, read receipts, devices, and unrelated push rows do not prove delivery', () => {
  const { buildPrivateMessagingReadiness } = loadService();
  const db = createDb({ includePrivateSchema: true, includeLiveEvidence: true });

  try {
    const readiness = buildPrivateMessagingReadiness({
      db,
      user: { id: 'user-a' },
      pushConfiguredOverride: true,
      notificationLookupConfiguredOverride: true,
    });

    assert.equal(readiness.status, 'partial');
    assert.equal(readiness.migration_proof_ready, true);
    assert.equal(readiness.runtime_schema_ready, true);
    assert.equal(readiness.configured, true);
    assert.equal(readiness.notification_lookup_configured, true);
    assert.equal(readiness.push_configured, true);
    assert.equal(readiness.token_lookup_ready, false);
    assert.equal(readiness.fcm_accepted, false);
    assert.equal(readiness.device_confirmed, false);
    assert.equal(readiness.aggregate_counts_are_delivery_evidence, false);
    assert.equal(readiness.registered_device_count, 2);
    assert.equal(readiness.conversation_count, 1);
    assert.equal(readiness.message_count, 1);
    assert.equal(readiness.receipt_count, 1);
    assert.ok(readiness.blockers.some((blocker) => /token lookup/i.test(blocker)));
  } finally {
    db.close();
  }
});

test('FCM acceptance remains partial until recipient-device confirmation exists', () => {
  const { buildPrivateMessagingReadiness } = loadService();
  const db = createDb({ includePrivateSchema: true, includeLiveEvidence: true });

  try {
    const readiness = buildPrivateMessagingReadiness({
      db,
      user: { id: 'user-a' },
      pushConfiguredOverride: true,
      notificationLookupConfiguredOverride: true,
      pushEvidenceOverride: {
        token_lookup_ready: true,
        token_lookup_source: 'supabase_probe',
        fcm_accepted: true,
        fcm_accepted_at: '2026-07-10T10:00:00.000Z',
        device_confirmed: false,
      },
    });

    assert.equal(readiness.status, 'partial');
    assert.equal(readiness.evidence_level, 'fcm_accepted');
    assert.equal(readiness.token_lookup_ready, true);
    assert.equal(readiness.fcm_accepted, true);
    assert.equal(readiness.device_confirmed, false);
    assert.match(readiness.message, /not confirmed/i);
  } finally {
    db.close();
  }
});

test('private messaging readiness becomes live only with device-confirmed evidence', () => {
  const { buildPrivateMessagingReadiness } = loadService();
  const db = createDb({ includePrivateSchema: true, includeLiveEvidence: true });

  try {
    const readiness = buildPrivateMessagingReadiness({
      db,
      user: { id: 'user-a' },
      pushConfiguredOverride: true,
      notificationLookupConfiguredOverride: true,
      pushEvidenceOverride: {
        token_lookup_ready: true,
        fcm_accepted: true,
        device_confirmed: true,
        device_confirmed_at: '2026-07-10T10:01:00.000Z',
      },
    });

    assert.equal(readiness.status, 'live');
    assert.equal(readiness.evidence_level, 'device_confirmed');
    assert.deepEqual(readiness.blockers, []);
  } finally {
    db.close();
  }
});
