'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const intelligenceRoutes = require('../src/routes/intelligence');
const recommenderCore = require('../src/services/recommenderCore');
const valueHierarchySync = require('../src/services/valueHierarchySync');
const youtubeService = require('../services/youtubeService');

function createMockDb() {
  const db = new Database(':memory:');
  
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      depth_pref REAL DEFAULT 0.5,
      rarity_pref REAL DEFAULT 0.5,
      length_pref REAL DEFAULT 0.5,
      onboarding INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      slug TEXT,
      embedding_json TEXT
    );

    CREATE TABLE interests (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      topic_id TEXT,
      weight REAL DEFAULT 1.0
    );

    CREATE TABLE user_interests (
      user_id TEXT,
      interest_name TEXT,
      weight REAL DEFAULT 1.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, interest_name)
    );

    CREATE TABLE user_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      goal_text TEXT,
      status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'medium',
      target_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE family_goals (
      id TEXT PRIMARY KEY,
      family_id TEXT,
      goal_text TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE family_members (
      family_id TEXT,
      user_id TEXT,
      PRIMARY KEY (family_id, user_id)
    );

    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      platform TEXT,
      name TEXT,
      url TEXT,
      trust_tier INTEGER DEFAULT 3
    );

    CREATE TABLE creators (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      name TEXT,
      trust_score REAL DEFAULT 0.5
    );

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      creator_id TEXT,
      external_id TEXT UNIQUE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      publish_date DATETIME,
      view_count INTEGER DEFAULT 0,
      summary TEXT,
      embedding_json TEXT,
      rarity_score REAL DEFAULT 0,
      depth_score REAL DEFAULT 0,
      trust_score REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      clickbait_score REAL DEFAULT 0,
      topic_tags_json TEXT,
      content_type TEXT DEFAULT 'video',
      channel_type TEXT DEFAULT 'socialVideo',
      life_impact REAL DEFAULT 0,
      decision_usefulness REAL DEFAULT 0,
      distraction_risk REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      creator_id TEXT,
      trusted INTEGER DEFAULT 1,
      UNIQUE(user_id, creator_id)
    );

    CREATE TABLE user_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      content_id TEXT,
      action TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_preference_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT,
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

    CREATE TABLE recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
      score REAL DEFAULT 0.0,
      reason_json TEXT,
      seen INTEGER DEFAULT 0,
      clicked INTEGER DEFAULT 0,
      model_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, content_item_id)
    );

    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      content_text TEXT NOT NULL,
      importance_score REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE memory_questions (
      id TEXT PRIMARY KEY,
      memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      answer_text TEXT,
      last_asked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE interaction_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      content_item_id TEXT,
      event_type TEXT,
      event_data_json TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  recommenderCore.initializeBanditState(db);
  valueHierarchySync.ensureTables(db);
  return db;
}

async function setupApp(db, options = {}) {
  const fastify = Fastify();

  if (options.user) {
    fastify.addHook('onRequest', async (request) => {
      request.user = options.user;
    });
  }

  await fastify.register(intelligenceRoutes, { db });
  return fastify;
}

test('Intelligence API Endpoints Verification', async (t) => {
  const db = createMockDb();
  const app = await setupApp(db);

  // Setup mock data
  db.prepare(`
    INSERT INTO users (id, email, name, depth_pref, rarity_pref, length_pref)
    VALUES ('guest', 'guest@explore.local', 'Guest User', 0.5, 0.5, 0.5)
  `).run();

  db.prepare(`
    INSERT INTO content_items (
      id, external_id, title, url, summary, rarity_score, depth_score, trust_score, topic_tags_json, content_type
    ) VALUES (
      'item_ai', 'ext_ai', 'Advancements in Artificial Intelligence models', 'https://example.com/ai',
      'This research article reviews new neural architecture models.', 0.8, 0.9, 0.8, '["AI", "Neural Network"]', 'written'
    )
  `).run();

  db.prepare(`
    INSERT INTO content_items (
      id, external_id, title, url, summary, rarity_score, depth_score, trust_score, topic_tags_json, content_type
    ) VALUES (
      'item_scholarship', 'ext_schol', 'Scholarship opportunity for computer science', 'https://example.com/schol',
      'Apply today for AI scholarships.', 0.7, 0.8, 0.9, '["Scholarship", "AI"]', 'written'
    )
  `).run();

  // Test 1: GET /api/v1/intelligence/feed
  await t.test('GET /api/v1/intelligence/feed returns scored and explained recommendations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/feed?mode=growth&limit=5'
    });

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.payload);
    assert.equal(payload.success, true);
    assert.equal(payload.mode, 'growth');
    assert.ok(payload.items.length > 0);

    // Verify recommendations were stored
    const recommendations = db.prepare("SELECT * FROM recommendations WHERE user_id = 'guest'").all();
    assert.ok(recommendations.length > 0);
  });

  // Test 2: GET /api/v1/intelligence/explanation/:recommendationId
  await t.test('GET /api/v1/intelligence/explanation/:id returns details', async () => {
    const recRow = db.prepare("SELECT id FROM recommendations WHERE user_id = 'guest' LIMIT 1").get();
    assert.ok(recRow);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/explanation/${recRow.id}`
    });

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.payload);
    assert.equal(payload.success, true);
    assert.ok(payload.explanation);
    assert.ok(payload.baselineScore !== undefined);
  });

  // Test 3: GET /api/v1/intelligence/search
  await t.test('GET /api/v1/intelligence/search returns hybrid query results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/search?q=scholarship&minDepth=0.5'
    });

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.payload);
    assert.equal(payload.success, true);
    assert.ok(payload.results.length > 0);
    assert.equal(payload.results[0].id, 'item_scholarship');
  });

  // Test 4: GET /api/v1/intelligence/profile
  await t.test('GET /api/v1/intelligence/profile returns user preferences, interests, and goals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/profile'
    });

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.payload);
    assert.equal(payload.success, true);
    assert.ok(payload.profile);
    assert.ok(payload.profile.explicitInterests);
    assert.ok(payload.profile.goals);
  });

  // Test 4b: POST & PATCH /api/v1/intelligence/profile
  await t.test('POST & PATCH /api/v1/intelligence/profile updates preferences, values, and psychometrics', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/intelligence/profile',
      payload: {
        depthPreference: 0.9,
        values: ['Value A', 'Value B'],
        psychometricProfile: { personality: { openness: 95 } }
      }
    });

    assert.equal(patchRes.statusCode, 200);
    const payload = JSON.parse(patchRes.payload);
    assert.equal(payload.success, true);
    assert.equal(payload.profile.depthPreference, 0.9);
    assert.deepEqual(payload.profile.values, ['Value A', 'Value B']);
    assert.equal(payload.profile.psychometricProfile.personality.openness, 95);
  });

  // Test 4c: 1-to-10 scoring feedback loop and corrections/multipliers GET
  await t.test('POST /api/v1/intelligence/feedback with rating adjusts multipliers and records corrections', async () => {
    const feedbackRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/feedback',
      payload: {
        content_item_id: 'item_ai',
        rating: 9,
        feedback_type: 'valuable',
        written_correction: 'Excellent article detailing Claude and GPT advancements.'
      }
    });

    assert.equal(feedbackRes.statusCode, 200);
    const feedbackPayload = JSON.parse(feedbackRes.payload);
    assert.equal(feedbackPayload.success, true);

    const correctionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/corrections'
    });
    assert.equal(correctionsRes.statusCode, 200);
    const correctionsPayload = JSON.parse(correctionsRes.payload);
    assert.ok(correctionsPayload.corrections.length > 0);
    assert.equal(correctionsPayload.corrections[0].rating, 9);
    assert.equal(correctionsPayload.corrections[0].written_correction, 'Excellent article detailing Claude and GPT advancements.');

    const multipliersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/multipliers'
    });
    assert.equal(multipliersRes.statusCode, 200);
    const multipliersPayload = JSON.parse(multipliersRes.payload);
    assert.ok(multipliersPayload.multipliers.length > 0);
    assert.equal(multipliersPayload.multipliers[0].multiplier, 9);
  });

  // Test 5: POST & PATCH Interests
  await t.test('POST & PATCH Interests creates and updates explicit interests', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/interests',
      payload: { interest_name: 'Robotics', weight: 0.9 }
    });

    assert.equal(postRes.statusCode, 200);
    const postPayload = JSON.parse(postRes.payload);
    assert.equal(postPayload.success, true);
    assert.equal(postPayload.interest.interest_name, 'Robotics');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/intelligence/interests/Robotics',
      payload: { weight: 0.95 }
    });

    assert.equal(patchRes.statusCode, 200);
    const patchPayload = JSON.parse(patchRes.payload);
    assert.equal(patchPayload.success, true);
    assert.equal(patchPayload.interest.weight, 0.95);
  });

  // Test 6: POST & PATCH Goals
  await t.test('POST & PATCH Goals manages user learning goals', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/goals',
      payload: { goal_text: 'Learn vector algebra', priority: 'high' }
    });

    assert.equal(postRes.statusCode, 200);
    const postPayload = JSON.parse(postRes.payload);
    assert.equal(postPayload.success, true);
    const goalId = postPayload.goal.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/intelligence/goals/${goalId}`,
      payload: { status: 'completed' }
    });

    assert.equal(patchRes.statusCode, 200);
    const patchPayload = JSON.parse(patchRes.payload);
    assert.equal(patchPayload.success, true);

    const goal = db.prepare('SELECT status FROM user_goals WHERE id = ?').get(goalId);
    assert.equal(goal.status, 'completed');
  });

  // Test 7: GET, POST, & PATCH Memories
  await t.test('GET, POST, & PATCH Memories manages memory statements', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/memories/propose',
      payload: { content_text: 'The user prefers reading about quantum physics in the morning', importance_score: 0.8 }
    });

    assert.equal(postRes.statusCode, 200);
    const postPayload = JSON.parse(postRes.payload);
    assert.equal(postPayload.success, true);
    const memoryId = postPayload.memory.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/intelligence/memories/${memoryId}`,
      payload: { importance_score: 0.9 }
    });

    assert.equal(patchRes.statusCode, 200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/memories'
    });

    assert.equal(getRes.statusCode, 200);
    const getPayload = JSON.parse(getRes.payload);
    assert.ok(getPayload.memories.length > 0);
  });

  // Test 8: GET & POST Clarification Questions
  await t.test('GET & POST Clarification Questions manages clarifications', async () => {
    const memId = 'mock_mem_1';
    db.prepare(`
      INSERT INTO memories (id, user_id, content_text, importance_score)
      VALUES (?, 'guest', 'Prefers tech news', 0.5)
    `).run(memId);

    const qId = 'mock_q_1';
    db.prepare(`
      INSERT INTO memory_questions (id, memory_id, question_text)
      VALUES (?, ?, 'Which tech topics exactly?')
    `).run(qId, memId);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/intelligence/memory-questions'
    });

    assert.equal(getRes.statusCode, 200);
    const getPayload = JSON.parse(getRes.payload);
    assert.ok(getPayload.questions.length > 0);

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intelligence/memory-questions/answers',
      payload: { question_id: qId, answer_text: 'Artificial Intelligence and robotics' }
    });

    assert.equal(postRes.statusCode, 200);
    const postPayload = JSON.parse(postRes.payload);
    assert.equal(postPayload.success, true);
  });

  // Test 9: Admin routes reject non-admin users
  await t.test('admin routes return 403 for authenticated non-admin users', async () => {
    const previousAdminUsers = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = 'admin-user';

    try {
      const adminApp = await setupApp(db, { user: { id: 'regular-user', email: 'user@example.com' } });
      const denied = await adminApp.inject({
        method: 'POST',
        url: '/api/v1/admin/recommender/train',
        payload: { epochs: 5 },
      });

      assert.equal(denied.statusCode, 403);
      const deniedPayload = JSON.parse(denied.payload);
      assert.equal(deniedPayload.admin_required, true);
      await adminApp.close();
    } finally {
      process.env.ADMIN_USER_IDS = previousAdminUsers;
    }
  });

  // Test 9b: PyTorch Recommendation Service Proxy
  await t.test('PyTorch Recommendation Service train & status proxies fallback gracefully for admins', async () => {
    const previousAdminUsers = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = 'admin-user';

    try {
      const adminApp = await setupApp(db, { user: { id: 'admin-user', email: 'admin@example.com' } });
      const trainRes = await adminApp.inject({
        method: 'POST',
        url: '/api/v1/admin/recommender/train',
        payload: { epochs: 5 },
      });

      assert.equal(trainRes.statusCode, 200);
      const trainPayload = JSON.parse(trainRes.payload);
      assert.equal(trainPayload.success, true);

      const statusRes = await adminApp.inject({
        method: 'GET',
        url: '/api/v1/admin/recommender/status',
      });

      assert.equal(statusRes.statusCode, 200);
      const statusPayload = JSON.parse(statusRes.payload);
      assert.equal(statusPayload.success, true);
      await adminApp.close();
    } finally {
      process.env.ADMIN_USER_IDS = previousAdminUsers;
    }
  });

  // Test 10: Ingest YouTube URL Queue Fallback
  await t.test('POST /api/v1/admin/content/ingest/youtube falls back to direct async on offline queue', async () => {
    const previousAdminUsers = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = 'admin-user';

    const originalProcess = youtubeService.youtubeAdapter.process;
    youtubeService.youtubeAdapter.process = async () => {};
    try {
      const adminApp = await setupApp(db, { user: { id: 'admin-user', email: 'admin@example.com' } });
      const res = await adminApp.inject({
        method: 'POST',
        url: '/api/v1/admin/content/ingest/youtube',
        payload: { url: 'https://youtube.com/watch?v=mockvid1234' },
      });

      assert.equal(res.statusCode, 200);
      const payload = JSON.parse(res.payload);
      assert.equal(payload.success, true);
      assert.ok(payload.jobId);

      // The route intentionally schedules direct fallback work after the response.
      // Let that callback observe the stub before restoring the real adapter.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await adminApp.close();
    } finally {
      youtubeService.youtubeAdapter.process = originalProcess;
      process.env.ADMIN_USER_IDS = previousAdminUsers;
    }
  });

  await app.close();
  db.close();
});
