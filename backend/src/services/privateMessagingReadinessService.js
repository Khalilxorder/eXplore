'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hasPushCredentials } = require('./pushDeliveryService');
const {
  PRIVATE_MESSAGE_CHANNEL_PREFIX,
  getPrivateMessengerPushEvidence,
  hasPrivateMessengerPushConfig,
} = require('./privateMessengerNotificationService');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MIGRATION_DIR = path.join(PROJECT_ROOT, 'backend', 'supabase', 'migrations');

const REQUIRED_RUNTIME_TABLES = [
  'private_chat_profiles',
  'private_conversations',
  'private_messages',
  'private_read_receipts',
  'private_typing_status',
  'private_conversation_preferences',
];

const REQUIRED_MESSAGE_COLUMNS = [
  'id',
  'conversation_id',
  'sender_id',
  'body',
  'attachment_path',
  'attachment_name',
  'attachment_type',
  'attachment_size',
  'reply_to_message_id',
  'edited_at',
  'deleted_at',
  'created_at',
];

const MIGRATION_PROOFS = [
  {
    id: 'base_private_messenger',
    file: '20260531_private_messenger.sql',
    patterns: [
      /create table if not exists public\.private_chat_profiles/i,
      /create table if not exists public\.private_conversations/i,
      /create table if not exists public\.private_messages/i,
      /create table if not exists public\.private_read_receipts/i,
      /alter table public\.private_messages enable row level security/i,
      /alter publication supabase_realtime add table public\.private_messages/i,
    ],
  },
  {
    id: 'private_message_attachments',
    file: '20260601_private_messenger_attachments.sql',
    patterns: [
      /private-chat-files/i,
      /participants read private chat files/i,
      /participants upload private chat files/i,
    ],
  },
  {
    id: 'private_message_actions',
    file: '20260601_private_messenger_message_actions.sql',
    patterns: [
      /reply_to_message_id/i,
      /edited_at/i,
      /deleted_at/i,
      /enforce_private_message_reference/i,
      /enforce_private_message_sender_update/i,
    ],
  },
  {
    id: 'private_typing_status',
    file: '20260601_private_messenger_typing_status.sql',
    patterns: [
      /create table if not exists public\.private_typing_status/i,
      /participants read private typing/i,
      /alter publication supabase_realtime add table public\.private_typing_status/i,
    ],
  },
  {
    id: 'private_conversation_preferences',
    file: '20260601_private_messenger_conversation_preferences.sql',
    patterns: [
      /create table if not exists public\.private_conversation_preferences/i,
      /is_pinned boolean not null default false/i,
      /is_muted boolean not null default false/i,
      /is_archived boolean not null default false/i,
    ],
  },
  {
    id: 'least_privilege',
    file: '20260601_private_messenger_least_privilege.sql',
    patterns: [
      /revoke all on public\.private_messages from authenticated/i,
      /grant select, insert on public\.private_messages to authenticated/i,
    ],
  },
];

function getTableNames(db) {
  if (!db?.prepare) {
    return [];
  }

  try {
    return db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all().map((row) => row.name);
  } catch (error) {
    return [];
  }
}

function getColumns(db, tableName) {
  if (!db?.prepare) {
    return [];
  }

  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  } catch (error) {
    return [];
  }
}

function countRows(db, tableName, where = '') {
  if (!db?.prepare) {
    return 0;
  }

  try {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} ${where}`).get()?.count || 0);
  } catch (error) {
    return 0;
  }
}

function getLatestPrivatePushEvidence(db, status) {
  if (!db?.prepare) {
    return null;
  }

  try {
    return db.prepare(`
      SELECT provider_message_id, created_at
      FROM notification_deliveries
      WHERE channel LIKE ? AND status = ?
      ORDER BY datetime(created_at) DESC, created_at DESC
      LIMIT 1
    `).get(`${PRIVATE_MESSAGE_CHANNEL_PREFIX}%`, status) || null;
  } catch (error) {
    return null;
  }
}

function getDeliveryEvidenceLevel({ configured, tokenLookupReady, fcmAccepted, deviceConfirmed }) {
  if (deviceConfirmed) return 'device_confirmed';
  if (fcmAccepted) return 'fcm_accepted';
  if (tokenLookupReady) return 'token_lookup_ready';
  if (configured) return 'configured';
  return 'unconfigured';
}

function migrationProofStatus() {
  const proofs = MIGRATION_PROOFS.map((proof) => {
    const fullPath = path.join(MIGRATION_DIR, proof.file);
    let ok = false;
    try {
      const sql = fs.readFileSync(fullPath, 'utf8');
      ok = proof.patterns.every((pattern) => pattern.test(sql));
    } catch (error) {
      ok = false;
    }

    return {
      id: proof.id,
      file: `backend/supabase/migrations/${proof.file}`,
      ok,
    };
  });

  return {
    ok: proofs.every((proof) => proof.ok),
    proofs,
  };
}

function buildPrivateMessagingReadiness({
  db,
  user = null,
  pushConfiguredOverride,
  notificationLookupConfiguredOverride,
  pushEvidenceOverride,
} = {}) {
  const tableNames = getTableNames(db);
  const presentTables = REQUIRED_RUNTIME_TABLES.filter((tableName) => tableNames.includes(tableName));
  const missingTables = REQUIRED_RUNTIME_TABLES.filter((tableName) => !tableNames.includes(tableName));
  const messageColumns = getColumns(db, 'private_messages');
  const presentMessageColumns = REQUIRED_MESSAGE_COLUMNS.filter((column) => messageColumns.includes(column));
  const missingMessageColumns = REQUIRED_MESSAGE_COLUMNS.filter((column) => !messageColumns.includes(column));
  const migrations = migrationProofStatus();
  const conversationCount = countRows(db, 'private_conversations');
  const messageCount = countRows(db, 'private_messages');
  const receiptCount = countRows(db, 'private_read_receipts');
  const activeDeviceCount = countRows(db, 'device_tokens', 'WHERE active = 1');
  const localAcceptedEvidence = getLatestPrivatePushEvidence(db, 'accepted');
  const localConfirmedEvidence = getLatestPrivatePushEvidence(db, 'confirmed');
  const signedIn = Boolean(user?.id);
  const runtimeSchemaReady = missingTables.length === 0 && missingMessageColumns.length === 0;
  const pushConfigured = typeof pushConfiguredOverride === 'boolean'
    ? pushConfiguredOverride
    : hasPushCredentials();
  const serverVerifiedNotificationConfigured = typeof notificationLookupConfiguredOverride === 'boolean'
    ? notificationLookupConfiguredOverride
    : hasPrivateMessengerPushConfig();
  const configured = pushConfigured && serverVerifiedNotificationConfigured;
  const runtimePushEvidence = pushEvidenceOverride || getPrivateMessengerPushEvidence();
  const tokenLookupReady = Boolean(runtimePushEvidence?.token_lookup_ready);
  const fcmAccepted = Boolean(runtimePushEvidence?.fcm_accepted || localAcceptedEvidence);
  const deviceConfirmed = Boolean(runtimePushEvidence?.device_confirmed || localConfirmedEvidence);
  const evidenceLevel = getDeliveryEvidenceLevel({
    configured,
    tokenLookupReady,
    fcmAccepted,
    deviceConfirmed,
  });

  const blockers = [];
  if (!migrations.ok) {
    blockers.push('Private messenger Supabase migrations are incomplete.');
  }
  if (!runtimeSchemaReady) {
    blockers.push('Local runtime does not expose every private messenger table/action column.');
  }
  if (!signedIn) {
    blockers.push('A signed-in user is required to prove the client message flow.');
  }
  if (!configured) {
    blockers.push('Firebase push and Supabase service-role lookup must both be configured for private-message push.');
  }
  if (configured && !tokenLookupReady) {
    blockers.push('The server-only Supabase device-token lookup has not succeeded yet.');
  }
  if (tokenLookupReady && !fcmAccepted) {
    blockers.push('No private-message notification has FCM acceptance evidence yet.');
  }
  if (fcmAccepted && !deviceConfirmed) {
    blockers.push('FCM accepted a private-message notification, but a recipient device has not confirmed receipt.');
  } else if (!deviceConfirmed) {
    blockers.push('A real recipient device still needs to confirm private-message notification receipt.');
  }

  let status = 'unavailable';
  if (migrations.ok && runtimeSchemaReady && signedIn && configured && tokenLookupReady && fcmAccepted && deviceConfirmed) {
    status = 'live';
  } else if (migrations.ok || runtimeSchemaReady || configured) {
    status = 'partial';
  }

  const message = status === 'live'
    ? 'Private-message push has recipient-device confirmation evidence.'
    : fcmAccepted
      ? 'FCM accepted a private-message notification, but recipient-device receipt is not confirmed.'
      : tokenLookupReady
        ? 'Server-only recipient token lookup is ready; private-message FCM acceptance is not proven yet.'
        : configured
          ? 'Private-message push is configured, but the recipient token lookup has not been proven.'
          : 'Private messaging is migration-backed, but private-message push is not fully configured.';

  return {
    status,
    message,
    signed_in: signedIn,
    migration_proof_ready: migrations.ok,
    runtime_schema_ready: runtimeSchemaReady,
    configured,
    notification_lookup_configured: serverVerifiedNotificationConfigured,
    push_configured: pushConfigured,
    token_lookup_ready: tokenLookupReady,
    fcm_accepted: fcmAccepted,
    device_confirmed: deviceConfirmed,
    evidence_level: evidenceLevel,
    token_lookup_source: runtimePushEvidence?.token_lookup_source || 'not_checked',
    token_lookup_checked_at: runtimePushEvidence?.token_lookup_checked_at || null,
    fcm_accepted_at: runtimePushEvidence?.fcm_accepted_at || localAcceptedEvidence?.created_at || null,
    device_confirmed_at: runtimePushEvidence?.device_confirmed_at || localConfirmedEvidence?.created_at || null,
    active_token_sample_count: Number(runtimePushEvidence?.active_token_sample_count || 0),
    aggregate_counts_are_delivery_evidence: false,
    registered_device_count: activeDeviceCount,
    local_registered_device_count: activeDeviceCount,
    conversation_count: conversationCount,
    message_count: messageCount,
    receipt_count: receiptCount,
    present_tables: presentTables,
    missing_tables: missingTables,
    present_message_columns: presentMessageColumns,
    missing_message_columns: missingMessageColumns,
    migration_proofs: migrations.proofs,
    delivery_evidence: {
      configured,
      token_lookup_ready: tokenLookupReady,
      fcm_accepted: fcmAccepted,
      device_confirmed: deviceConfirmed,
      level: evidenceLevel,
    },
    blockers: status === 'live' ? [] : blockers,
  };
}

module.exports = {
  REQUIRED_MESSAGE_COLUMNS,
  REQUIRED_RUNTIME_TABLES,
  buildPrivateMessagingReadiness,
  migrationProofStatus,
};
