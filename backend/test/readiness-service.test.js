const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// Readiness reflects whether a live Gemini key is configured, and getGeminiApiKeys()
// also reads an on-disk key pool (~/.dev-config/gemini-key-pool.json by default).
// On a developer machine those real keys would leak into tests that intentionally
// configure placeholder/empty keys, flipping "blocked"/"partial" assertions. Force
// the pool file to a non-existent path so readiness only sees each test's env.
const MISSING_KEY_POOL_FILE = path.join(os.tmpdir(), 'explore-missing-gemini-key-pool.json');
let originalKeyPoolFile;

test.beforeEach(() => {
  originalKeyPoolFile = process.env.GEMINI_KEY_POOL_FILE;
  process.env.GEMINI_KEY_POOL_FILE = MISSING_KEY_POOL_FILE;
});

test.afterEach(() => {
  if (originalKeyPoolFile === undefined) {
    delete process.env.GEMINI_KEY_POOL_FILE;
  } else {
    process.env.GEMINI_KEY_POOL_FILE = originalKeyPoolFile;
  }
});

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      content_type TEXT,
      channel_type TEXT
    );

    CREATE TABLE device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      token TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE notification_preferences (
      user_id TEXT PRIMARY KEY,
      alerts_enabled INTEGER DEFAULT 1,
      ai_enabled INTEGER DEFAULT 1,
      geo_enabled INTEGER DEFAULT 1,
      push_enabled INTEGER DEFAULT 1,
      local_fallback_enabled INTEGER DEFAULT 1
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

    CREATE TABLE meta_channel_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      channel_type TEXT,
      status TEXT
    );
  `);
  return db;
}

function loadReadinessService() {
  const authModule = path.resolve(__dirname, '../src/auth/supabaseAuth.js');
  const aiModule = path.resolve(__dirname, '../services/aiService.js');
  const authProviderModule = path.resolve(__dirname, '../src/services/authProviderReadinessService.js');
  const readinessModule = path.resolve(__dirname, '../src/services/readinessService.js');

  delete require.cache[authModule];
  delete require.cache[aiModule];
  delete require.cache[authProviderModule];
  delete require.cache[readinessModule];

  return require(readinessModule);
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, snapshot);
}

test('buildSystemReadiness reports truthful runtime status when postgres is requested but sqlite is still active', () => {
  const originalEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.GOOGLE_AI_API_KEY = 'AIzaValidGeminiKey1234567890';
  process.env.FIREBASE_PROJECT_ID = 'explore-98397';
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"explore-98397"}';
  process.env.META_APP_ID = 'meta-app-id';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.META_LOGIN_CONFIG_ID = 'login-config';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token';
  process.env.BACKEND_PUBLIC_URL = 'http://localhost:8080';
  process.env.META_CONNECTION_SECRET = 'meta-connection-secret';
  process.env.YOUTUBE_API_KEY = 'youtube-key';
  process.env.APIFY_API_TOKEN = 'apify-key';
  process.env.X_BEARER_TOKEN = 'x-token';
  process.env.REDDIT_CLIENT_ID = 'reddit-id';
  process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';

  const { buildSystemReadiness } = loadReadinessService();
  const db = createDb();

  try {
    const now = Date.now();
    const lastStartedAt = new Date(now - (2 * 60 * 1000)).toISOString();
    const lastCompletedAt = new Date(now - (60 * 1000)).toISOString();
    const heartbeatAt = new Date(now).toISOString();

    db.prepare(`
      INSERT INTO content_items (id, content_type, channel_type)
      VALUES ('article-1', 'article', 'written')
    `).run();
    db.prepare(`
      INSERT INTO device_tokens (id, user_id, token, active)
      VALUES ('device-1', 'user-1', 'push-token', 1)
    `).run();
    db.prepare(`
      INSERT INTO notification_preferences (
        user_id,
        alerts_enabled,
        ai_enabled,
        geo_enabled,
        push_enabled,
        local_fallback_enabled
      ) VALUES ('user-1', 1, 1, 1, 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO worker_runtime_status (
        worker_name,
        loop_mode,
        last_status,
        last_started_at,
        last_completed_at,
        last_error,
        last_summary_json,
        heartbeat_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'priority_alert_dispatch',
      'loop',
      'success',
      lastStartedAt,
      lastCompletedAt,
      '',
      '{"alertsChecked":1}',
      heartbeatAt,
      heartbeatAt,
    );
    db.prepare(`
      INSERT INTO meta_channel_connections (id, user_id, channel_type, status)
      VALUES ('meta-1', 'user-1', 'instagram', 'ready')
    `).run();

    const readiness = buildSystemReadiness({
      db,
      dataBackend: 'postgres',
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });

    assert.equal(readiness.status, 'partial');
    assert.equal(readiness.runtime.status, 'partial');
    assert.equal(readiness.runtime.runtime_adapter, 'sqlite');
    assert.equal(readiness.runtime.deployment_mode, 'postgres_requested_sqlite_runtime_active');
    assert.equal(readiness.auth.status, 'live');
    assert.equal(readiness.written_news.status, 'live');
    assert.equal(readiness.push.status, 'live');
    assert.equal(readiness.meta.status, 'live');
    assert.equal(readiness.sources.status, 'live');
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('buildSourceReadiness marks missing credentials unavailable and keeps podcasts ready', () => {
  const originalEnv = { ...process.env };
  process.env.YOUTUBE_API_KEY = '';
  process.env.APIFY_API_TOKEN = '';
  process.env.REDDIT_CLIENT_ID = '';
  process.env.REDDIT_CLIENT_SECRET = '';
  process.env.X_BEARER_TOKEN = '';

  const { buildSourceReadiness } = loadReadinessService();

  try {
    const readiness = buildSourceReadiness();
    const youtube = readiness.items.find((item) => item.id === 'youtube');
    const podcasts = readiness.items.find((item) => item.id === 'podcasts');

    assert.equal(youtube.readiness, 'unavailable');
    assert.equal(podcasts.readiness, 'live');
    assert.equal(podcasts.status, 'configured');
  } finally {
    restoreEnv(originalEnv);
  }
});

test('buildSystemReadiness does not treat placeholder AI keys as live summarization', () => {
  const originalEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.GOOGLE_AI_API_KEY = 'YOUR_PROD_GOOGLE_AI_KEY';
  process.env.OPENAI_API_KEY = 'y';

  const { buildSystemReadiness } = loadReadinessService();
  const db = createDb();

  try {
    db.prepare(`
      INSERT INTO content_items (id, content_type, channel_type)
      VALUES ('article-1', 'article', 'written')
    `).run();

    const readiness = buildSystemReadiness({
      db,
      dataBackend: 'sqlite',
      user: null,
    });

    assert.equal(readiness.written_news.ai_summary_ready, false);
    assert.equal(readiness.written_news.status, 'partial');
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('buildVisionReadiness exposes external blockers instead of marking the whole vision live', () => {
  const originalEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.GOOGLE_AI_API_KEY = 'AIzaValidGeminiKey1234567890';
  process.env.GOOGLE_OAUTH_CLIENT_ID = '';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = '';
  process.env.SUPABASE_AUTH_GOOGLE_ENABLED = '';
  process.env.FIREBASE_PROJECT_ID = 'explore-98397';
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"explore-98397"}';

  const { buildVisionReadiness } = loadReadinessService();
  const db = createDb();

  try {
    db.prepare(`
      INSERT INTO content_items (id, content_type, channel_type)
      VALUES ('article-1', 'article', 'written')
    `).run();

    const vision = buildVisionReadiness({
      db,
      dataBackend: 'sqlite',
      user: null,
    });

    const byId = Object.fromEntries(vision.requirements.map((requirement) => [requirement.id, requirement]));

    assert.equal(vision.status, 'partial');
    assert.equal(byId.source_reference_map.status, 'live');
    assert.equal(byId.google_sign_in.status, 'partial');
    assert.equal(byId.direct_notifications.status, 'partial');
    assert.equal(byId.gemini_interpretation.status, 'partial');
    assert.ok(vision.blockers.some((entry) => entry.requirement === 'google_sign_in'));
    assert.ok(vision.blockers.some((entry) => entry.requirement === 'direct_notifications'));
    assert.ok(vision.blockers.some((entry) => entry.requirement === 'private_messages'));
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('buildActivationReadiness reports exact external setup gaps', () => {
  const originalEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.SUPABASE_SECRET_KEY = '';
  process.env.SUPABASE_ACCESS_TOKEN = '';
  process.env.GOOGLE_OAUTH_CLIENT_ID = '';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = '';
  process.env.SUPABASE_AUTH_GOOGLE_ENABLED = '';
  process.env.OPENAI_API_KEY = '';
  process.env.GOOGLE_AI_API_KEY = '';
  process.env.GOOGLE_GEMINI_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.GOOGLE_AI_API_KEYS = '';
  for (let index = 1; index <= 10; index += 1) {
    process.env[`GOOGLE_AI_API_KEY_${index}`] = '';
    process.env[`GOOGLE_GEMINI_API_KEY_${index}`] = '';
    process.env[`GEMINI_API_KEY_${index}`] = '';
  }
  process.env.FIREBASE_PROJECT_ID = 'explore-98397';
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"explore-98397"}';

  const { buildActivationReadiness } = loadReadinessService();
  const db = createDb();

  try {
    const readiness = buildActivationReadiness({ db, user: null });
    const byId = Object.fromEntries(readiness.items.map((item) => [item.id, item]));

    assert.equal(readiness.status, 'blocked');
    assert.equal(byId.gemini_live_key.status, 'blocked');
    assert.equal(byId.gemini_live_key.evidence.available_keys, 0);
    assert.equal(byId.supabase_google_oauth.status, 'blocked');
    assert.equal(byId.supabase_google_oauth.evidence.google_client_configured, false);
    assert.equal(byId.supabase_google_oauth.evidence.supabase_management_token_configured, false);
    assert.equal(byId.firebase_push_device.status, 'blocked');
    assert.equal(byId.firebase_push_device.evidence.firebase_credentials_configured, true);
    assert.equal(byId.private_message_delivery.evidence.supabase_service_role_configured, false);
    assert.ok(byId.gemini_live_key.actions[0].includes('fresh valid Gemini key'));
    assert.ok(byId.firebase_push_device.actions[0].includes('Install the current APK'));
  } finally {
    db.close();
    restoreEnv(originalEnv);
  }
});

test('buildVisionReadiness marks Gemini live only after a successful live probe', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.GOOGLE_AI_API_KEY = 'AIzaValidGeminiProbe1234567890';

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"ok":true,"label":"live"}' },
            ],
          },
        },
      ],
    }),
  });

  const { buildVisionReadiness } = loadReadinessService();
  const aiService = require('../services/aiService');
  const db = createDb();

  try {
    await aiService.probeLiveProvider({ providerPreference: 'gemini', timeoutMs: 1000 });

    const vision = buildVisionReadiness({
      db,
      dataBackend: 'sqlite',
      user: null,
    });
    const gemini = vision.requirements.find((requirement) => requirement.id === 'gemini_interpretation');

    assert.equal(gemini.status, 'live');
    assert.equal(gemini.blockers.length, 0);
    assert.equal(gemini.evidence.live_probe.status, 'live');
  } finally {
    db.close();
    aiService.__test__.resetLiveProbe();
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test('buildVisionReadiness marks Google sign-in live after Supabase provider probe succeeds', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ external: { google: true } }),
  });

  const { buildVisionReadiness } = loadReadinessService();
  const authProvider = require('../src/services/authProviderReadinessService');
  const db = createDb();

  try {
    await authProvider.probeGoogleAuthProvider({ timeoutMs: 1000 });

    const vision = buildVisionReadiness({
      db,
      dataBackend: 'sqlite',
      user: null,
    });
    const google = vision.requirements.find((requirement) => requirement.id === 'google_sign_in');

    assert.equal(google.status, 'live');
    assert.equal(google.blockers.length, 0);
    assert.equal(google.evidence.google_provider_probe.status, 'live');
  } finally {
    db.close();
    authProvider.resetGoogleAuthProbe();
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});
