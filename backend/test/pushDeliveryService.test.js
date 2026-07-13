'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  getNotificationPreferences,
  getPushActivationStatus,
  buildNotificationStatusResponse,
  shouldDeliverPriorityAlert,
  summarizeAlert,
  updateNotificationPreferences,
} = require('../src/services/pushDeliveryService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notification_preferences (
      user_id TEXT PRIMARY KEY,
      alerts_enabled INTEGER DEFAULT 1,
      ai_enabled INTEGER DEFAULT 1,
      geo_enabled INTEGER DEFAULT 0,
      push_enabled INTEGER DEFAULT 1,
      local_fallback_enabled INTEGER DEFAULT 1,
      ai_release_watch_enabled INTEGER DEFAULT 1,
      ai_release_watch_companies_json TEXT DEFAULT '["anthropic","openai","google","xai"]',
      ai_release_watch_min_importance TEXT DEFAULT 'major',
      direct_news_watch_enabled INTEGER DEFAULT 1,
      direct_news_watch_sources_json TEXT DEFAULT '["anthropic"]',
      direct_news_watch_reason TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      token TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE worker_runtime_status (
      worker_name TEXT PRIMARY KEY,
      loop_mode TEXT,
      last_status TEXT,
      last_started_at TEXT,
      last_completed_at TEXT,
      last_error TEXT,
      last_summary_json TEXT,
      heartbeat_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      alert_id TEXT,
      channel TEXT,
      dedupe_key TEXT,
      status TEXT,
      error_message TEXT,
      provider_message_id TEXT,
      created_at TEXT
    );
  `);
  return db;
}

test('delivers official AI releases only when the watched company and minimum importance match', () => {
  const alert = {
    category: 'ai',
    official_source: true,
    release_watch_signal: 'official_release',
    release_watch_company: 'anthropic',
    release_watch_company_label: 'Anthropic',
    importance: 'major',
  };

  assert.equal(shouldDeliverPriorityAlert(alert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    ai_release_watch_enabled: 1,
    ai_release_watch_companies: ['anthropic'],
    ai_release_watch_min_importance: 'important',
  }), true);

  assert.equal(shouldDeliverPriorityAlert(alert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    ai_release_watch_enabled: 0,
    ai_release_watch_companies: ['anthropic'],
    ai_release_watch_min_importance: 'important',
  }), false);

  assert.equal(shouldDeliverPriorityAlert(alert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    ai_release_watch_enabled: 1,
    ai_release_watch_companies: ['openai'],
    ai_release_watch_min_importance: 'important',
  }), false);
});

test('delivers direct-news alerts only for selected precision-rule sources', () => {
  const alert = {
    category: 'ai',
    official_source: false,
    release_watch_signal: 'direct_news_notification',
    release_watch_company: 'anthropic',
    direct_notification_source_id: 'anthropic',
    importance: 'major',
  };

  assert.equal(shouldDeliverPriorityAlert(alert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    direct_news_watch_enabled: 1,
    direct_news_watch_sources: ['anthropic'],
  }), true);

  assert.equal(shouldDeliverPriorityAlert(alert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    direct_news_watch_enabled: 1,
    direct_news_watch_sources: ['openai'],
  }), false);

  const sourcePackAlert = {
    category: 'ai',
    official_source: false,
    release_watch_signal: 'direct_news_notification',
    direct_notification_source_id: 'product-hunt-ai',
    source: 'Product Hunt AI',
    importance: 'important',
  };

  assert.equal(shouldDeliverPriorityAlert(sourcePackAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    direct_news_watch_enabled: 1,
    direct_news_watch_sources: ['product_hunt_ai'],
  }), true);

  assert.equal(shouldDeliverPriorityAlert(sourcePackAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    ai_enabled: 1,
    direct_news_watch_enabled: 1,
    direct_news_watch_sources: ['anthropic'],
  }), false);
});

test('delivers geo and political high-priority alerts when the matching intent is enabled', () => {
  const geoAlert = {
    category: 'geo',
    title: 'Missile attack prompts airspace disruption around Iran and Gulf bases',
    summary: 'Reuters reports military response and regional disruption.',
    threatLevel: 'Critical',
  };
  const politicalAlert = {
    category: 'political',
    title: 'Prime minister resigns after election shock',
    summary: 'A major political event reshapes the government.',
  };

  assert.equal(shouldDeliverPriorityAlert(geoAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    geo_enabled: 1,
  }), true);

  assert.equal(shouldDeliverPriorityAlert(geoAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    geo_enabled: 0,
  }), false);

  assert.equal(shouldDeliverPriorityAlert(politicalAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    political_enabled: 1,
  }), true);

  assert.equal(shouldDeliverPriorityAlert(politicalAlert, {
    alerts_enabled: 1,
    push_enabled: 1,
    geo_enabled: 0,
    political_enabled: 0,
  }), false);
});

test('summarizes geo and AI alerts with simple phone-friendly titles', () => {
  const geoMessage = summarizeAlert({
    category: 'geo',
    title: 'Missile attack prompts airspace disruption around Iran and Gulf bases',
    threatLevel: 'Critical',
  });
  const aiMessage = summarizeAlert({
    category: 'ai',
    title: 'Claude Sonnet 4.6 launches with API availability',
    release_classification_label: 'Model release',
  });

  assert.match(geoMessage.title, /eXplore radar: Critical (Political|Regional) alert/);
  assert.equal(aiMessage.title, 'eXplore radar: Model release');
});

test('accepts a political preference flag via the notification preference update path', () => {
  const db = createDb();

  try {
    const updated = updateNotificationPreferences(db, 'user-1', {
      alerts_enabled: 1,
      push_enabled: 1,
      ai_enabled: 1,
      political_enabled: 1,
      ai_release_watch_enabled: 1,
      ai_release_watch_companies: ['anthropic'],
    });

    assert.equal(updated.geo_enabled, 1);
    assert.equal(updated.political_enabled, true);

    const activation = getPushActivationStatus(db, 'user-1', updated);
    assert.equal(activation.political_enabled, true);
    assert.equal(activation.intent.political_enabled, true);
    assert.equal(activation.intent.geo_world_enabled, true);
    assert.equal(activation.intent.ai_official_enabled, true);

    const fetched = getNotificationPreferences(db, 'user-1');
    assert.equal(fetched.political_enabled, true);
    assert.equal(fetched.geo_enabled, 1);
  } finally {
    db.close();
  }
});

test('builds notification status without crashing when Firebase credentials are missing', () => {
  const db = createDb();

  try {
    db.prepare(`
      INSERT INTO device_tokens (id, user_id, token, active)
      VALUES ('device-1', 'user-1', 'token-1', 1)
    `).run();
    db.prepare(`
      INSERT INTO notification_deliveries (
        id, user_id, alert_id, channel, dedupe_key, status, provider_message_id, created_at
      ) VALUES (
        'delivery-1', 'user-1', 'alert-1', 'push:device-1', 'user-1:push:device-1:alert-1', 'sent', 'provider-1', '2026-05-31T10:00:00.000Z'
      )
    `).run();

    const preferences = updateNotificationPreferences(db, 'user-1', {
      alerts_enabled: 1,
      push_enabled: 1,
      ai_enabled: 1,
      ai_release_watch_enabled: 1,
      ai_release_watch_companies: ['anthropic'],
    });
    const status = buildNotificationStatusResponse(db, 'user-1', preferences);

    assert.equal(status.success, true);
    assert.equal(status.push_registered, true);
    assert.equal(status.push_sendable, false);
    assert.equal(status.normalized_status, 'local_fallback_only');
    assert.equal(status.last_successful_delivery_at, '2026-05-31T10:00:00.000Z');
    assert.deepEqual(status.intent.ai_release_watch_companies, ['anthropic']);
  } finally {
    db.close();
  }
});
