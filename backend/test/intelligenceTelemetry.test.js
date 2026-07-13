const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const Database = require('better-sqlite3');
const intelligenceRoutes = require('../src/routes/intelligence');

function createTestDb() {
  const db = new Database(':memory:');
  
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      onboarding INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      creator_id TEXT,
      external_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      publish_date DATETIME,
      duration_seconds INTEGER,
      language TEXT DEFAULT 'en',
      view_count INTEGER,
      transcript TEXT,
      summary TEXT,
      embedding_json TEXT,
      rarity_score REAL DEFAULT 0,
      depth_score REAL DEFAULT 0,
      trust_score REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      timeless_score REAL DEFAULT 0,
      clickbait_score REAL DEFAULT 0,
      ingest_status TEXT DEFAULT 'ready',
      transcript_status TEXT DEFAULT 'missing',
      transcript_provider TEXT,
      analysis_provider TEXT,
      analysis_model TEXT,
      analysis_error TEXT,
      embedding_provider TEXT,
      embedding_model TEXT,
      embedding_error TEXT,
      topic_tags_json TEXT,
      content_type TEXT DEFAULT 'video',
      article_body TEXT,
      channel_type TEXT DEFAULT 'socialVideo',
      life_impact REAL DEFAULT 0,
      decision_usefulness REAL DEFAULT 0,
      distraction_risk REAL DEFAULT 0,
      template_analysis_json TEXT,
      analysis_updated_at DATETIME,
      visual_meaning_label TEXT,
      visual_meaning_prompt TEXT,
      visual_meaning_status TEXT DEFAULT 'prompt_ready',
      visual_meaning_image_url TEXT,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE interaction_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      event_data_json TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_preference_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL DEFAULT 'default',
      depth_pref REAL DEFAULT 0.5,
      rarity_pref REAL DEFAULT 0.5,
      length_pref REAL DEFAULT 0.5,
      topics_avoid_json TEXT DEFAULT '[]',
      topics_focus_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, profile_name)
    );
  `);

  return db;
}

test('POST /api/events/batch rejects unauthenticated requests', async () => {
  const db = createTestDb();
  const fastify = Fastify();
  await fastify.register(intelligenceRoutes, { db });

  const response = await fastify.inject({
    method: 'POST',
    url: '/api/events/batch',
    payload: {
      events: [{
        id: 'event_1',
        content_item_id: 'item_1',
        event_type: 'visible_2s',
      }],
    },
  });

  assert.equal(response.statusCode, 401);
  await fastify.close();
});

test('POST /api/events/batch should store telemetry events for authenticated users', async () => {
  const db = createTestDb();
  const fastify = Fastify();
  fastify.addHook('onRequest', async (request) => {
    request.user = { id: 'user_1', email: 'user@example.com' };
  });
  await fastify.register(intelligenceRoutes, { db });

  // Seed user_1
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user_1', 'user@example.com', 'Test User')").run();
  
  // Seed a content item
  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, depth_score, topic_tags_json)
    VALUES ('item_1', 'ext_1', 'AI and Future', 'https://example.com/ai', 0.8, '["AI", "Tech"]')
  `).run();

  // Make request
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/events/batch',
    payload: {
      events: [
        {
          id: 'event_1',
          content_item_id: 'item_1',
          event_type: 'visible_2s',
          event_data: { visible: true },
          duration_ms: 2000
        },
        {
          id: 'event_2',
          content_item_id: 'item_1',
          event_type: 'dwell',
          event_data: { heartbeat: 1 },
          duration_ms: 5000
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.success, true);
  assert.equal(data.count, 2);

  // Verify DB contents
  const rows = db.prepare('SELECT * FROM interaction_events ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'event_1');
  assert.equal(rows[0].event_type, 'visible_2s');
  assert.equal(JSON.parse(rows[0].event_data_json).visible, true);
  
  assert.equal(rows[1].id, 'event_2');
  assert.equal(rows[1].event_type, 'dwell');

  await fastify.close();
});

test('POST /api/intelligence/feedback - dislike: too basic', async () => {
  const db = createTestDb();
  const fastify = Fastify();
  fastify.register(intelligenceRoutes, { db });

  db.prepare("INSERT INTO users (id, email, name) VALUES ('guest', 'guest@explore.local', 'Guest')").run();
  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, depth_score, topic_tags_json)
    VALUES ('item_1', 'ext_1', 'Intro to AI', 'https://example.com/ai', 0.2, '["AI"]')
  `).run();

  const response = await fastify.inject({
    method: 'POST',
    url: '/api/intelligence/feedback',
    payload: {
      content_item_id: 'item_1',
      action: 'dislike',
      reason: 'too basic'
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.success, true);
  // depth_pref should increase gradually (default 0.5 -> 0.58); one click must not reshape the profile hard
  assert.equal(data.profile.depth_pref, 0.58);
  // should NOT add to avoid list because it is "too basic", not wrong topic!
  assert.equal(data.profile.topics_avoid.includes('AI'), false);

  // Check that the feedback event is recorded
  const events = db.prepare("SELECT * FROM interaction_events WHERE event_type = 'feedback'").all();
  assert.equal(events.length, 1);
  const eventData = JSON.parse(events[0].event_data_json);
  assert.equal(eventData.action, 'dislike');
  assert.equal(eventData.reason, 'too basic');
});

test('POST /api/intelligence/feedback - dislike: wrong topic', async () => {
  const db = createTestDb();
  const fastify = Fastify();
  fastify.register(intelligenceRoutes, { db });

  db.prepare("INSERT INTO users (id, email, name) VALUES ('guest', 'guest@explore.local', 'Guest')").run();
  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, depth_score, topic_tags_json)
    VALUES ('item_1', 'ext_1', 'Cooking Recipe', 'https://example.com/recipe', 0.2, '["Cooking", "Food"]')
  `).run();

  const response = await fastify.inject({
    method: 'POST',
    url: '/api/intelligence/feedback',
    payload: {
      content_item_id: 'item_1',
      action: 'dislike',
      reason: 'wrong topic'
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.success, true);
  // depth_pref should NOT change
  assert.equal(data.profile.depth_pref, 0.5);
  // should add to avoid list
  assert.deepEqual(data.profile.topics_avoid, ['Cooking', 'Food']);
});

test('POST /api/intelligence/feedback - dislike: format mismatch', async () => {
  const db = createTestDb();
  const fastify = Fastify();
  fastify.register(intelligenceRoutes, { db });

  db.prepare("INSERT INTO users (id, email, name) VALUES ('guest', 'guest@explore.local', 'Guest')").run();
  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, depth_score, topic_tags_json)
    VALUES ('item_1', 'ext_1', 'Podcast AI', 'https://example.com/recipe', 0.2, '["AI"]')
  `).run();

  const response = await fastify.inject({
    method: 'POST',
    url: '/api/intelligence/feedback',
    payload: {
      content_item_id: 'item_1',
      action: 'dislike',
      reason: 'format mismatch'
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.success, true);
  // depth_pref should NOT change
  assert.equal(data.profile.depth_pref, 0.5);
  // should NOT add to avoid list because it is just format mismatch
  assert.equal(data.profile.topics_avoid.includes('AI'), false);
});
