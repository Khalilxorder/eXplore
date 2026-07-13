'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const recommenderCore = require('../src/services/recommenderCore');

// Helper to bootstrap in-memory DB for recommender tests
function createMockDb() {
  const db = new Database(':memory:');
  
  // Create all necessary schema tables
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      depth_pref REAL DEFAULT 0.5,
      rarity_pref REAL DEFAULT 0.5,
      length_pref REAL DEFAULT 0.5,
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
      PRIMARY KEY (user_id, interest_name)
    );

    CREATE TABLE user_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      goal_text TEXT,
      status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'medium'
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
  `);

  recommenderCore.initializeBanditState(db);
  return db;
}

test('recommender core math helper functions', () => {
  const { tokenize, computeTextOverlapScore, cosineSimilarity, solveLinearSystem, sampleBeta } = recommenderCore.__test__;

  // 1. Tokenizer
  const tokens = tokenize('The OpenAI GPT-4o model release was major today!');
  assert.ok(tokens.includes('openai'));
  assert.ok(tokens.includes('gpt'));
  assert.ok(tokens.includes('release'));
  // Stopwords and short words should be filtered
  assert.equal(tokens.includes('the'), false);

  // 2. Text Overlap Similarity
  const score1 = computeTextOverlapScore('artificial intelligence and machine learning', 'machine learning models');
  const score2 = computeTextOverlapScore('completely unrelated subject', 'football game championship');
  assert.ok(score1 > 0);
  assert.equal(score2, 0);

  // 3. Cosine Similarity
  const sim = cosineSimilarity([1, 0, 1], [1, 0, 1]);
  assert.equal(Math.round(sim * 100) / 100, 1.0);
  const ortho = cosineSimilarity([1, 0], [0, 1]);
  assert.equal(ortho, 0.0);

  // 4. solveLinearSystem Ax = b
  // A = [[2, 1], [1, 3]], b = [8, 9] -> x = [3, 2]
  const A = [[2, 1], [1, 3]];
  const b = [8, 9];
  const x = solveLinearSystem(A, b);
  assert.equal(Math.round(x[0]), 3);
  assert.equal(Math.round(x[1]), 2);

  // 5. sampleBeta
  const val = sampleBeta(2, 5);
  assert.ok(val >= 0 && val <= 1);
});

test('recommender local TF-IDF semantic reranking fallback', () => {
  const { computeTfIdfSimilarities } = recommenderCore.__test__;

  const mockItems = [
    { id: '1', title: 'OpenAI releases new Claude rival GPT-5', summary: 'AI models LLM advancement tech', topic_tags_json: '["AI", "LLM"]' },
    { id: '2', title: 'Cooking delicious pasta at home', summary: 'recipes kitchen food preparation ingredients', topic_tags_json: '["cooking", "food"]' },
    { id: '3', title: 'DeepMind AlphaFold protein folding', summary: 'biology science simulation neural network chemistry', topic_tags_json: '["science", "AI"]' }
  ];

  const userProfileQuery = 'AI models LLMs DeepMind neural networks';
  const similarities = computeTfIdfSimilarities(mockItems, userProfileQuery);

  // Item 1 and Item 3 should be highly similar compared to Item 2
  assert.ok(similarities['1'] > similarities['2']);
  assert.ok(similarities['3'] > similarities['2']);
});

test('recommender core complete recommendations pipeline', () => {
  const db = createMockDb();

  try {
    // 1. Insert mock users
    db.prepare(`
      INSERT INTO users (id, email, name, depth_pref, rarity_pref, length_pref)
      VALUES ('user_abc', 'abc@explore.local', 'Test User', 0.8, 0.7, 0.4)
    `).run();

    // 2. Insert user interests & active goals
    db.prepare(`INSERT INTO user_interests (user_id, interest_name, weight) VALUES ('user_abc', 'AI', 1.0)`).run();
    db.prepare(`INSERT INTO user_interests (user_id, interest_name, weight) VALUES ('user_abc', 'Scholarship', 0.8)`).run();
    db.prepare(`INSERT INTO user_goals (id, user_id, goal_text, status) VALUES ('goal_1', 'user_abc', 'Apply for AI university scholarship', 'active')`).run();

    // 3. Insert mock sources and creators
    db.prepare(`INSERT INTO sources (id, platform, name, url, trust_tier) VALUES ('source_1', 'youtube', 'OpenAI Official', 'https://youtube.com/openai', 5)`).run();
    db.prepare(`INSERT INTO creators (id, source_id, name, trust_score) VALUES ('creator_1', 'source_1', 'OpenAI Devs', 0.9)`).run();
    db.prepare(`INSERT INTO user_sources (id, user_id, creator_id, trusted) VALUES ('us_1', 'user_abc', 'creator_1', 1)`).run();

    // 4. Insert mock content items
    const content = [
      { id: 'item_ai_1', title: 'OpenAI GPT-5 Model Release', summary: 'A massive leap in reasoning capabilities.', tags: '["AI", "llm"]', depth: 0.8, rarity: 0.9, trust: 0.9, clickbait: 0.05, distraction: 0.1 },
      { id: 'item_ai_2', title: 'Anthropic Claude 4.5 release notes', summary: 'Detailed review of safety training and prompt optimization.', tags: '["AI", "safety"]', depth: 0.7, rarity: 0.6, trust: 0.8, clickbait: 0.0, distraction: 0.1 },
      { id: 'item_scholarship', title: 'Jordanian PhD Scholarship Application Open', summary: 'Fully funded scholarship in Amman for AI studies.', tags: '["Scholarship", "education"]', depth: 0.9, rarity: 0.8, trust: 0.7, clickbait: 0.1, distraction: 0.0 },
      { id: 'item_distract', title: 'Top 10 shocking cat videos that will make you cry', summary: 'You wont believe what this cat did in the kitchen.', tags: '["cats", "funny"]', depth: 0.1, rarity: 0.1, trust: 0.3, clickbait: 0.9, distraction: 0.9 },
      { id: 'item_general_1', title: 'Cooking local Hungarian goulash stew', summary: 'Simple instructions for making traditional beef stew.', tags: '["cooking", "stew"]', depth: 0.4, rarity: 0.3, trust: 0.6, clickbait: 0.2, distraction: 0.3 },
      { id: 'item_general_2', title: 'Introduction to linear algebra vectors', summary: 'Academic lecture on matrices and orthogonal spaces.', tags: '["math", "algebra"]', depth: 0.9, rarity: 0.7, trust: 0.8, clickbait: 0.0, distraction: 0.1 }
    ];

    for (const c of content) {
      db.prepare(`
        INSERT INTO content_items (
          id, source_id, creator_id, external_id, title, url, publish_date, 
          summary, rarity_score, depth_score, trust_score, freshness_score, 
          clickbait_score, topic_tags_json, channel_type, distraction_risk, decision_usefulness
        ) VALUES (
          ?, 'source_1', 'creator_1', ?, ?, ?, datetime('now', '-1 day'), 
          ?, ?, ?, ?, 0.8, 
          ?, ?, 'written', ?, ?
        )
      `).run(
        c.id, c.id, c.title, `https://example.com/${c.id}`, 
        c.summary, c.rarity, c.depth, c.trust, 
        c.clickbait, c.tags, c.distraction, c.depth
      );
    }

    // 5. Request recommendations using default Thompson Sampling
    const recsThompson = recommenderCore.getRecommendations(db, 'user_abc', { limit: 4 });
    assert.ok(recsThompson.length > 0);
    
    // Low quality clickbait should be penalised and not top item
    assert.notEqual(recsThompson[0].id, 'item_distract');
    // Top recommendation should align with AI / Scholarship interests and active goals
    const topIds = recsThompson.map(r => r.id);
    assert.ok(topIds.includes('item_ai_1') || topIds.includes('item_ai_2') || topIds.includes('item_scholarship'));

    // 6. Request recommendations with LinUCB active
    recommenderCore.config.bandit.activeModel = 'linucb';
    const recsLinUcb = recommenderCore.getRecommendations(db, 'user_abc', { limit: 4 });
    assert.ok(recsLinUcb.length > 0);

  } finally {
    db.close();
  }
});

test('recommender core record interaction & update bandit states', () => {
  const db = createMockDb();

  try {
    db.prepare(`
      INSERT INTO users (id, email, name, depth_pref, rarity_pref, length_pref)
      VALUES ('user_123', '123@explore.local', 'Interaction User', 0.5, 0.5, 0.5)
    `).run();

    db.prepare(`
      INSERT INTO content_items (
        id, external_id, title, url, topic_tags_json, trust_score, depth_score
      ) VALUES (
        'item_active_learning', 'ext_al', 'Active learning models in recommenders', 
        'https://example.com/al', '["Machine Learning"]', 0.8, 0.7
      )
    `).run();

    // 1. Update Thompson Sampling bandit state
    recommenderCore.config.bandit.activeModel = 'thompson';
    
    // Initial state check - should return default values
    const beforeThompson = db.prepare("SELECT * FROM recommender_bandit_state WHERE user_id = 'user_123'").get();
    assert.equal(beforeThompson, undefined);

    // Record positive interaction
    recommenderCore.recordInteraction(db, 'user_123', 'item_active_learning', 'click');

    const afterThompson = db.prepare("SELECT * FROM recommender_bandit_state WHERE user_id = 'user_123' AND arm_key = 'Machine Learning'").get();
    assert.ok(afterThompson);
    assert.equal(afterThompson.alpha, 2.0); // 1.0 default + 1.0 positive click
    assert.equal(afterThompson.beta, 1.0);  // 1.0 default

    // Record negative interaction
    recommenderCore.recordInteraction(db, 'user_123', 'item_active_learning', 'dismiss');
    
    const afterThompsonNegative = db.prepare("SELECT * FROM recommender_bandit_state WHERE user_id = 'user_123' AND arm_key = 'Machine Learning'").get();
    assert.equal(afterThompsonNegative.alpha, 2.0);
    assert.equal(afterThompsonNegative.beta, 2.0); // 1.0 default + 1.0 negative dismiss

    // 2. Update LinUCB bandit state
    recommenderCore.config.bandit.activeModel = 'linucb';
    recommenderCore.recordInteraction(db, 'user_123', 'item_active_learning', 'click');

    const linUcbState = db.prepare("SELECT * FROM recommender_bandit_state WHERE user_id = 'user_123' AND arm_key = 'Machine Learning'").get();
    assert.ok(linUcbState.matrix_a_json);
    assert.ok(linUcbState.vector_b_json);
    
    const A = JSON.parse(linUcbState.matrix_a_json);
    const b = JSON.parse(linUcbState.vector_b_json);

    // LinUCB matrix A should be updated from identity
    assert.ok(A[0][0] > 1.0);
    // vector b should have positive values from reward update
    assert.ok(b.some(val => val > 0));

  } finally {
    db.close();
  }
});
