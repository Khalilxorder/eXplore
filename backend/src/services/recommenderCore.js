'use strict';

const fs = require('fs');
const path = require('path');

// Load config file
const configPath = path.join(__dirname, 'recommenderConfig.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  // Fallback default configuration if file read fails
  config = {
    version: "1.0.0",
    weights: {
      semanticRelevance: 0.35,
      goalRelevance: 0.25,
      credibility: 0.15,
      difficulty: 0.10,
      freshness: 0.15
    },
    penalties: {
      negativeInteraction: -0.20,
      clickbait: -0.15,
      distractionRisk: -0.25
    },
    bandit: {
      activeModel: "thompson",
      explorationBudget: 0.15,
      linUcb: {
        alpha: 0.2
      },
      thompsonSampling: {
        defaultAlpha: 1.0,
        defaultBeta: 1.0
      }
    },
    diversity: {
      mmr: {
        lambda: 0.7
      },
      topicCapping: {
        maxItemsPerTopic: 3
      }
    }
  };
}

function safeParseJson(str, fallback = []) {
  try {
    return JSON.parse(str || '[]');
  } catch (e) {
    return fallback;
  }
}

/**
 * Normalizes text to lowercase, punctuation-free tokens, removing standard stopwords.
 */
function tokenize(value) {
  return [...new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .filter((token) => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'your'].includes(token))
  )];
}

/**
 * Computes Jaccard similarity / text overlap between two strings.
 */
function computeTextOverlapScore(text1, text2) {
  if (!text1 || !text2) return 0;
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }
  const union = new Set([...tokens1, ...tokens2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Computes cosine similarity between two vector arrays of the same length.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Solves a linear system Ax = b using Gaussian elimination.
 * Used for LinUCB ridge regression coefficients theta = A^-1 * b.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = [];
  for (let i = 0; i < n; i++) {
    M[i] = [...A[i], b[i]];
  }
  for (let i = 0; i < n; i++) {
    // Find pivot row
    let maxEl = Math.abs(M[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxEl) {
        maxEl = Math.abs(M[k][i]);
        maxRow = k;
      }
    }
    // Swap rows
    const tmp = M[maxRow];
    M[maxRow] = M[i];
    M[i] = tmp;

    // Eliminate column below pivot
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[i][i]) < 1e-12) continue;
      const c = -M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        if (i === j) {
          M[k][j] = 0;
        } else {
          M[k][j] += c * M[i][j];
        }
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) {
      x[i] = 0;
    } else {
      x[i] = M[i][n] / M[i][i];
    }
    for (let k = i - 1; k >= 0; k--) {
      M[k][n] -= M[k][i] * x[i];
    }
  }
  return x;
}

/**
 * Vector dot product helper.
 */
function dotProduct(v1, v2) {
  return v1.reduce((sum, val, idx) => sum + val * (v2[idx] || 0), 0);
}

/**
 * Standard Marsaglia polar method for sampling from a normal distribution.
 */
function normalRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Marsaglia and Tsang method for Gamma(alpha, 1) sampling.
 */
function sampleGamma(alpha) {
  if (alpha < 1) {
    return sampleGamma(alpha + 1) * Math.pow(Math.random(), 1.0 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = normalRandom();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Samples from a Beta(alpha, beta) distribution.
 */
function sampleBeta(alpha, beta) {
  const u = sampleGamma(alpha);
  const v = sampleGamma(beta);
  if (u + v === 0) return 0.5;
  return u / (u + v);
}

/**
 * Computes publication recency score.
 */
function computeRecencyScore(item) {
  const timestamp = new Date(item.publish_date || item.created_at || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0.5;
  const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
  return Math.exp(-ageHours / 72); // decay half-life ~50 hours
}

/**
 * Local TF-IDF similarity calculator across the retrieved candidates.
 */
function computeTfIdfSimilarities(items, userProfileText) {
  const tokenizedItems = items.map(item => {
    const text = [
      item.title,
      item.summary,
      safeParseJson(item.topic_tags_json, []).join(' ')
    ].filter(Boolean).join(' ');
    return { id: item.id, tokens: tokenize(text) };
  });
  
  const userTokens = tokenize(userProfileText);
  
  // Calculate Document Frequency (DF)
  const df = {};
  const allDocs = [...tokenizedItems.map(d => d.tokens), userTokens];
  const numDocs = allDocs.length;
  
  for (const docTokens of allDocs) {
    const uniqueTokens = new Set(docTokens);
    for (const token of uniqueTokens) {
      df[token] = (df[token] || 0) + 1;
    }
  }
  
  // Calculate Inverse Document Frequency (IDF)
  const idf = {};
  for (const token in df) {
    idf[token] = Math.log(numDocs / (df[token] + 1)) + 1;
  }
  
  // Helper to construct term vectors
  function getTfIdfVector(tokens) {
    const tf = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }
    const vector = {};
    for (const token in tf) {
      if (idf[token]) {
        vector[token] = tf[token] * idf[token];
      }
    }
    return vector;
  }
  
  const userVector = getTfIdfVector(userTokens);
  const similarities = {};
  
  for (const doc of tokenizedItems) {
    const docVector = getTfIdfVector(doc.tokens);
    
    // Cosine similarity calculation
    let dotProduct = 0;
    for (const token in userVector) {
      if (docVector[token]) {
        dotProduct += userVector[token] * docVector[token];
      }
    }
    
    let magUser = 0;
    for (const token in userVector) {
      magUser += userVector[token] * userVector[token];
    }
    
    let magDoc = 0;
    for (const token in docVector) {
      magDoc += docVector[token] * docVector[token];
    }
    
    if (magUser === 0 || magDoc === 0) {
      similarities[doc.id] = 0;
    } else {
      similarities[doc.id] = dotProduct / (Math.sqrt(magUser) * Math.sqrt(magDoc));
    }
  }
  
  return similarities;
}

/**
 * Initializes sqlite database bandit tracking tables.
 */
function initializeBanditState(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS recommender_bandit_state (
      user_id TEXT NOT NULL,
      arm_key TEXT NOT NULL,
      alpha REAL DEFAULT 1.0,
      beta REAL DEFAULT 1.0,
      matrix_a_json TEXT, -- LinUCB A matrix
      vector_b_json TEXT, -- LinUCB b vector
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, arm_key)
    )
  `).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_corrections_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content_item_id TEXT NOT NULL,
      rating INTEGER,
      feedback_type TEXT NOT NULL, -- 'valuable', 'wrong_explanation', 'written_correction'
      written_correction TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_topic_multipliers (
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      multiplier REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, topic)
    );
  `);
}

/**
 * Loads LinUCB state from database.
 */
function getLinUcbState(db, userId, armKey) {
  const row = db.prepare(`
    SELECT matrix_a_json, vector_b_json FROM recommender_bandit_state
    WHERE user_id = ? AND arm_key = ?
  `).get(userId, armKey);

  let A, b;
  if (row && row.matrix_a_json) {
    A = JSON.parse(row.matrix_a_json);
    b = JSON.parse(row.vector_b_json);
  } else {
    // 7x7 identity matrix and 7x1 zero vector
    A = Array(7).fill(0).map((_, i) => {
      const rowVec = Array(7).fill(0);
      rowVec[i] = 1.0;
      return rowVec;
    });
    b = Array(7).fill(0);
  }
  return { A, b };
}

/**
 * Persists LinUCB state to database.
 */
function saveLinUcbState(db, userId, armKey, A, b) {
  db.prepare(`
    INSERT INTO recommender_bandit_state (user_id, arm_key, matrix_a_json, vector_b_json, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, arm_key) DO UPDATE SET
      matrix_a_json = excluded.matrix_a_json,
      vector_b_json = excluded.vector_b_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, armKey, JSON.stringify(A), JSON.stringify(b));
}

/**
 * Loads Thompson Sampling state from database.
 */
function getThompsonState(db, userId, armKey) {
  const row = db.prepare(`
    SELECT alpha, beta FROM recommender_bandit_state
    WHERE user_id = ? AND arm_key = ?
  `).get(userId, armKey);

  if (row) {
    return { alpha: row.alpha, beta: row.beta };
  } else {
    return {
      alpha: config.bandit.thompsonSampling.defaultAlpha || 1.0,
      beta: config.bandit.thompsonSampling.defaultBeta || 1.0
    };
  }
}

/**
 * Persists Thompson Sampling state to database.
 */
function saveThompsonState(db, userId, armKey, alpha, beta) {
  db.prepare(`
    INSERT INTO recommender_bandit_state (user_id, arm_key, alpha, beta, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, arm_key) DO UPDATE SET
      alpha = excluded.alpha,
      beta = excluded.beta,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, armKey, alpha, beta);
}

/**
 * Records a user interaction with an item and updates bandit coefficients.
 */
function recordInteraction(db, userId, contentId, action) {
  initializeBanditState(db);

  // Retrieve item details
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(contentId);
  if (!item) return;

  const tags = safeParseJson(item.topic_tags_json, []);
  const armKey = tags[0] || item.channel_type || 'general';

  const isPositive = ['click', 'save', 'share', 'open_source', 'valuable', 'rate_high'].includes(action) ||
    (typeof action === 'string' && action.startsWith('rate:') && Number(action.split(':')[1]) >= 7);
  const reward = isPositive ? 1.0 : 0.0;

  // Record interaction in user_interactions table
  db.prepare(`
    INSERT INTO user_interactions (id, user_id, content_id, action, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(`${userId}_${contentId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, userId, contentId, action);

  // Update Thompson Sampling parameters (Alpha & Beta counts)
  const tState = getThompsonState(db, userId, armKey);
  if (isPositive) {
    tState.alpha += 1.0;
  } else {
    tState.beta += 1.0;
  }
  saveThompsonState(db, userId, armKey, tState.alpha, tState.beta);

  // Update LinUCB parameters (A and b)
  const lState = getLinUcbState(db, userId, armKey);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || {};
  
  const depthPref = user.depth_pref ?? 0.5;
  const rarityPref = user.rarity_pref ?? 0.5;
  const lengthPref = user.length_pref ?? 0.5;
  const recency = computeRecencyScore(item);

  // Calculate local relevance attributes for update step context
  let interestNames = [];
  try {
    const rows = db.prepare('SELECT interest_name FROM user_interests WHERE user_id = ?').all(userId);
    interestNames = rows.map(r => r.interest_name);
  } catch (e) {}

  let goals = [];
  try {
    goals = db.prepare('SELECT goal_text FROM user_goals WHERE user_id = ? AND status = \'active\'').all(userId);
  } catch (e) {}

  const userProfileText = [...interestNames, ...goals.map(g => g.goal_text)].join(' ');
  const itemText = [item.title, item.summary].filter(Boolean).join(' ');
  const semanticRelevance = computeTextOverlapScore(userProfileText, itemText);

  let goalRelevance = 0;
  if (goals.length > 0) {
    let maxGoalSim = 0;
    const itemTextLower = itemText.toLowerCase();
    for (const goal of goals) {
      const goalTokens = tokenize(goal.goal_text);
      let matchCount = 0;
      for (const token of goalTokens) {
        if (itemTextLower.includes(token)) matchCount++;
      }
      const sim = goalTokens.length > 0 ? matchCount / goalTokens.length : 0;
      if (sim > maxGoalSim) maxGoalSim = sim;
    }
    goalRelevance = maxGoalSim;
  }

  // Construct context vector (x)
  const x = [
    depthPref,
    rarityPref,
    lengthPref,
    item.trust_score ?? 0.5,
    recency,
    semanticRelevance,
    goalRelevance
  ];

  // A <- A + x * x^T
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      lState.A[i][j] += x[i] * x[j];
    }
  }
  // b <- b + reward * x
  for (let i = 0; i < 7; i++) {
    lState.b[i] += reward * x[i];
  }

  saveLinUcbState(db, userId, armKey, lState.A, lState.b);
}

/**
 * Records a user feedback rating/correction, updates bandit/recommendation weights,
 * saves the correction history, and adjusts personalized scoring multipliers.
 */
function saveFeedFeedback(db, userId, contentItemId, rating, feedbackType, writtenCorrection) {
  initializeBanditState(db);

  const id = `${userId}_${contentItemId}_${Date.now()}`;
  db.prepare(`
    INSERT INTO user_corrections_history (id, user_id, content_item_id, rating, feedback_type, written_correction)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rating = excluded.rating,
      feedback_type = excluded.feedback_type,
      written_correction = excluded.written_correction
  `).run(id, userId, contentItemId, rating || null, feedbackType, writtenCorrection || null);

  // Determine bandit action string based on rating and feedbackType
  // Supported types (plan Part 5): valuable, not_valuable, more_like, less_like,
  // wrong_explanation, wrong_source, wrong_priority, not_relevant, already_knew, written_correction
  let banditAction = 'dislike';
  const positiveTypes = new Set(['valuable', 'more_like', 'more-like', 'value_score']);
  const negativeTypes = new Set([
    'not_valuable', 'less_like', 'less-like', 'wrong_explanation', 'wrong_source',
    'wrong_priority', 'not_relevant', 'already_knew', 'written_correction',
  ]);
  if (rating >= 7 || positiveTypes.has(feedbackType)) {
    banditAction = 'rate_high';
  } else if (rating <= 4 || negativeTypes.has(feedbackType)) {
    banditAction = 'dislike';
  }

  // Record bandit/recommendation interaction
  recordInteraction(db, userId, contentItemId, banditAction);

  // Retrieve item details to get its topics for multiplier adjustment
  const item = db.prepare('SELECT topic_tags_json, channel_type FROM content_items WHERE id = ?').get(contentItemId);
  if (item) {
    let topics = [];
    try {
      topics = JSON.parse(item.topic_tags_json || '[]');
    } catch (e) {}
    if (!Array.isArray(topics)) topics = [];
    if (item.channel_type) topics.push(item.channel_type);

    // Calculate multiplier adjustment
    let multiplierVal = 1.0;
    if (rating != null) {
      const r = Number(rating);
      if (r >= 7) {
        multiplierVal = r;
      } else if (r <= 4) {
        multiplierVal = Math.max(0.1, r / 10.0);
      } else {
        multiplierVal = 1.0;
      }
    } else {
      if (feedbackType === 'valuable' || feedbackType === 'more_like' || feedbackType === 'more-like') {
        multiplierVal = feedbackType === 'more_like' || feedbackType === 'more-like' ? 8.0 : 10.0;
      } else if (feedbackType === 'not_valuable' || feedbackType === 'less_like' || feedbackType === 'less-like') {
        multiplierVal = 0.25;
      } else if (feedbackType === 'wrong_explanation' || feedbackType === 'wrong_source' || feedbackType === 'wrong_priority') {
        multiplierVal = 0.2;
      } else if (feedbackType === 'not_relevant' || feedbackType === 'already_knew') {
        multiplierVal = 0.35;
      } else if (feedbackType === 'written_correction') {
        multiplierVal = 0.5;
      }
    }

    for (const topic of topics) {
      if (!topic) continue;
      db.prepare(`
        INSERT INTO user_topic_multipliers (user_id, topic, multiplier, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, topic) DO UPDATE SET
          multiplier = excluded.multiplier,
          updated_at = CURRENT_TIMESTAMP
      `).run(userId, topic, multiplierVal);
    }
  }
}

/**
 * Core multi-channel retrieval & scorer algorithm.
 */
function getRecommendations(db, userId, options = {}) {
  const limit = options.limit || 12;
  initializeBanditState(db);

  // 1. Get user profile preferences
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || {};
  const depthPref = user.depth_pref ?? 0.5;
  const rarityPref = user.rarity_pref ?? 0.5;
  const lengthPref = user.length_pref ?? 0.5;

  // 2. Fetch User Interests
  let interestNames = [];
  try {
    const rows = db.prepare('SELECT interest_name FROM user_interests WHERE user_id = ?').all(userId);
    interestNames = rows.map(r => r.interest_name);
  } catch (e) {}

  if (interestNames.length === 0) {
    try {
      const rows = db.prepare(`
        SELECT t.name FROM interests i
        JOIN topics t ON i.topic_id = t.id
        WHERE i.user_id = ?
      `).all(userId);
      interestNames = rows.map(r => r.name);
    } catch (e) {}
  }

  if (interestNames.length === 0) {
    interestNames = ['AI', 'Tech', 'Innovation', 'Education'];
  }

  // 3. Fetch User Goals
  let goals = [];
  try {
    goals = db.prepare('SELECT goal_text FROM user_goals WHERE user_id = ? AND status = \'active\'').all(userId);
  } catch (e) {}
  try {
    const fGoals = db.prepare(`
      SELECT fg.goal_text FROM family_goals fg
      JOIN family_members fm ON fg.family_id = fm.family_id
      WHERE fm.user_id = ? AND fg.active = 1
    `).all(userId);
    goals.push(...fGoals);
  } catch (e) {}

  // ----------------------------------------------------
  // Channel 1: Long-term Interests
  // ----------------------------------------------------
  const ltiCandidates = [];
  for (const interest of interestNames) {
    const rows = db.prepare(`
      SELECT * FROM content_items 
      WHERE title LIKE ? OR summary LIKE ? OR topic_tags_json LIKE ? 
      LIMIT 6
    `).all(`%${interest}%`, `%${interest}%`, `%${interest}%`);
    ltiCandidates.push(...rows);
  }

  // ----------------------------------------------------
  // Channel 2: Short-term Interests (recent clicks)
  // ----------------------------------------------------
  const stiCandidates = [];
  try {
    const recentInteractions = db.prepare(`
      SELECT ci.topic_tags_json, ci.title, ci.summary
      FROM user_interactions ui
      JOIN content_items ci ON ui.content_id = ci.id
      WHERE ui.user_id = ? AND ui.action IN ('click', 'save', 'share', 'open_source')
      ORDER BY ui.created_at DESC
      LIMIT 5
    `).all(userId);
    
    const recentTags = new Set();
    for (const row of recentInteractions) {
      const tags = safeParseJson(row.topic_tags_json, []);
      tags.forEach(t => recentTags.add(t));
    }
    
    for (const tag of Array.from(recentTags).slice(0, 4)) {
      const rows = db.prepare(`
        SELECT * FROM content_items
        WHERE topic_tags_json LIKE ?
        LIMIT 6
      `).all(`%${tag}%`);
      stiCandidates.push(...rows);
    }
  } catch (e) {}

  // ----------------------------------------------------
  // Channel 3: Active Goals
  // ----------------------------------------------------
  const goalCandidates = [];
  for (const goal of goals) {
    const keywords = tokenize(goal.goal_text).slice(0, 3);
    for (const kw of keywords) {
      const rows = db.prepare(`
        SELECT * FROM content_items
        WHERE title LIKE ? OR summary LIKE ?
        LIMIT 6
      `).all(`%${kw}%`, `%${kw}%`);
      goalCandidates.push(...rows);
    }
  }

  // ----------------------------------------------------
  // Channel 4: Contextual Cues (Time of day + preferences)
  // ----------------------------------------------------
  const hour = new Date().getHours();
  let contextQuery = '';
  if (hour >= 5 && hour < 12) {
    contextQuery = 'ORDER BY decision_usefulness DESC';
  } else if (hour >= 18 || hour < 5) {
    contextQuery = 'ORDER BY depth_score DESC';
  } else {
    contextQuery = 'ORDER BY rarity_score DESC';
  }
  const ccCandidates = db.prepare(`
    SELECT * FROM content_items
    ${contextQuery}
    LIMIT 20
  `).all();

  // ----------------------------------------------------
  // Channel 5: Followed Channels
  // ----------------------------------------------------
  let fcCandidates = [];
  try {
    fcCandidates = db.prepare(`
      SELECT ci.* FROM content_items ci
      JOIN user_sources us ON ci.creator_id = us.creator_id
      WHERE us.user_id = ? AND us.trusted = 1
      LIMIT 20
    `).all(userId);
  } catch (e) {}
  if (fcCandidates.length === 0) {
    try {
      fcCandidates = db.prepare(`
        SELECT ci.* FROM content_items ci
        JOIN creators cr ON ci.creator_id = cr.id
        WHERE cr.trust_score >= 0.6
        LIMIT 20
      `).all();
    } catch (e) {}
  }

  // ----------------------------------------------------
  // Channel 6: Control/Surprise (Serendipity exploration)
  // ----------------------------------------------------
  const csCandidates = db.prepare(`
    SELECT * FROM content_items
    ORDER BY RANDOM()
    LIMIT 20
  `).all();

  // ----------------------------------------------------
  // Channel 7: Freshness / Trending
  // ----------------------------------------------------
  const ftCandidates = db.prepare(`
    SELECT * FROM content_items
    ORDER BY COALESCE(publish_date, created_at) DESC, view_count DESC
    LIMIT 20
  `).all();

  // ----------------------------------------------------
  // Channel 8: High Credibility / Trust
  // ----------------------------------------------------
  const hctCandidates = db.prepare(`
    SELECT * FROM content_items
    WHERE trust_score >= 0.6 OR rarity_score >= 0.5
    ORDER BY trust_score DESC
    LIMIT 20
  `).all();

  // ----------------------------------------------------
  // Channel 9: Semantic Similarity Search (tags matching)
  // ----------------------------------------------------
  const tagsPlaceholder = interestNames.map(() => 'topic_tags_json LIKE ?').join(' OR ');
  const ssCandidates = tagsPlaceholder ? db.prepare(`
    SELECT * FROM content_items
    WHERE ${tagsPlaceholder}
    LIMIT 20
  `).all(...interestNames.map(name => `%${name}%`)) : [];

  // ----------------------------------------------------
  // Channel 10: Deep & Rare
  // ----------------------------------------------------
  const drCandidates = db.prepare(`
    SELECT * FROM content_items
    WHERE depth_score >= 0.5 AND rarity_score >= 0.5
    LIMIT 20
  `).all();

  // Merge and deduplicate candidates
  const candidateMap = new Map();
  const addCandidates = (items, channelName) => {
    for (const item of items) {
      if (!candidateMap.has(item.id)) {
        item.retrievalChannel = channelName;
        candidateMap.set(item.id, item);
      }
    }
  };

  addCandidates(ltiCandidates, 'long_term_interests');
  addCandidates(stiCandidates, 'short_term_interests');
  addCandidates(goalCandidates, 'active_goals');
  addCandidates(ccCandidates, 'contextual_cues');
  addCandidates(fcCandidates, 'followed_channels');
  addCandidates(csCandidates, 'control_surprise');
  addCandidates(ftCandidates, 'freshness_trending');
  addCandidates(hctCandidates, 'high_credibility');
  addCandidates(ssCandidates, 'semantic_similarity');
  addCandidates(drCandidates, 'deep_rare');

  // If no candidates gathered, pull generic fallback
  if (candidateMap.size === 0) {
    const fallbackItems = db.prepare('SELECT * FROM content_items LIMIT 50').all();
    addCandidates(fallbackItems, 'global_fallback');
  }

  const candidates = Array.from(candidateMap.values());

  // 4. Fallback Semantic Similarity Setup (TF-IDF engine)
  const userProfileText = [...interestNames, ...goals.map(g => g.goal_text)].join(' ');
  const tfIdfSimilarities = computeTfIdfSimilarities(candidates, userProfileText);

  // Load personalized scoring multipliers (1-10)
  const multiplierRows = db.prepare(`
    SELECT topic, multiplier FROM user_topic_multipliers WHERE user_id = ?
  `).all(userId);
  const multipliers = {};
  for (const row of multiplierRows) {
    multipliers[row.topic.toLowerCase()] = row.multiplier;
  }

  // Load value hierarchy state
  const valueHierarchy = require('./valueHierarchySync');
  const hierarchyState = valueHierarchy.getState(db, userId);

  // Average vector for user interest embeddings if present
  let userEmbedding = null;
  try {
    const embeds = db.prepare(`
      SELECT embedding_json FROM topics
      WHERE id IN (SELECT topic_id FROM interests WHERE user_id = ?)
      AND embedding_json IS NOT NULL
    `).all(userId).map(r => JSON.parse(r.embedding_json)).filter(Boolean);
    
    if (embeds.length > 0) {
      const dim = embeds[0].length;
      userEmbedding = Array(dim).fill(0);
      for (const e of embeds) {
        for (let i = 0; i < dim; i++) {
          userEmbedding[i] += e[i] || 0;
        }
      }
      for (let i = 0; i < dim; i++) {
        userEmbedding[i] /= embeds.length;
      }
    }
  } catch (e) {}

  // 5. Score Candidates
  const scoredCandidates = candidates.map(item => {
    // 5a. Semantic Relevance (Cosine embedding or TF-IDF fallback)
    let semanticRelevance = 0;
    let embeddingSuccess = false;
    if (userEmbedding && item.embedding_json) {
      try {
        const itemVec = JSON.parse(item.embedding_json);
        if (itemVec && itemVec.length === userEmbedding.length) {
          semanticRelevance = cosineSimilarity(userEmbedding, itemVec);
          embeddingSuccess = true;
        }
      } catch (e) {}
    }
    if (!embeddingSuccess) {
      // Fallback: TF-IDF cosine similarity
      semanticRelevance = tfIdfSimilarities[item.id] || 0;
    }

    // 5b. Goal Relevance
    let goalRelevance = 0;
    if (goals.length > 0) {
      let maxGoalSim = 0;
      const itemTextLower = [item.title, item.summary].filter(Boolean).join(' ').toLowerCase();
      for (const goal of goals) {
        const goalTokens = tokenize(goal.goal_text);
        let matchCount = 0;
        for (const token of goalTokens) {
          if (itemTextLower.includes(token)) matchCount++;
        }
        const sim = goalTokens.length > 0 ? matchCount / goalTokens.length : 0;
        if (sim > maxGoalSim) maxGoalSim = sim;
      }
      goalRelevance = maxGoalSim;
    }

    // Hook up three-story hierarchy overlap
    let narrativeOverlap = 0;
    let wishOverlap = 0;
    let goalOverlap = 0;
    let hierarchyOverlap = 0;

    if (hierarchyState && hierarchyState.hasSignal) {
      const itemText = [item.title, item.summary].filter(Boolean).join(' ');
      if (hierarchyState.storyHighestOrder) {
        narrativeOverlap = computeTextOverlapScore(itemText, hierarchyState.storyHighestOrder);
      }
      if (hierarchyState.storyYours) {
        wishOverlap = computeTextOverlapScore(itemText, hierarchyState.storyYours);
      }
      const goalText = hierarchyState.storySubStories || hierarchyState.currentGoal;
      if (goalText) {
        goalOverlap = computeTextOverlapScore(itemText, goalText);
      }
      hierarchyOverlap = Math.max(narrativeOverlap, wishOverlap, goalOverlap);
      if (hierarchyOverlap > 0) {
        goalRelevance = Math.max(goalRelevance, hierarchyOverlap);
      }
    }

    // 5c. Credibility, Difficulty (depth_score), Freshness
    const credibility = item.trust_score ?? 0.5;
    const difficulty = item.depth_score ?? 0.5;
    const freshness = computeRecencyScore(item);

    // 5d. Negative Penalties (clickbait & distraction risk)
    const penalties = options.penalties || config.penalties || {};
    const penalty = 
      (item.clickbait_score || 0) * (penalties.clickbait || -0.15) +
      (item.distraction_risk || 0) * (penalties.distractionRisk || -0.25);

    // Combine into Baseline Score
    const w = options.weights || config.weights || {};
    const baselineScore = 
      (w.semanticRelevance ?? 0.35) * semanticRelevance +
      (w.goalRelevance ?? 0.25) * goalRelevance +
      (w.credibility ?? 0.15) * credibility +
      (w.difficulty ?? 0.10) * difficulty +
      (w.freshness ?? 0.15) * freshness +
      penalty;

    // 6. Contextual Bandit Exploration Score
    const tags = safeParseJson(item.topic_tags_json, []);
    const armKey = tags[0] || item.channel_type || 'general';
    let banditScore = 0.5;

    const activeModel = options.activeModel || (config.bandit && config.bandit.activeModel) || 'thompson';
    if (activeModel === 'linucb') {
      const { A, b } = getLinUcbState(db, userId, armKey);
      const x = [
        depthPref,
        rarityPref,
        lengthPref,
        credibility,
        freshness,
        semanticRelevance,
        goalRelevance
      ];
      try {
        const theta = solveLinearSystem(A, b);
        const v = solveLinearSystem(A, x);
        const variance = dotProduct(x, v);
        const linUcbAlpha = options.linUcbAlpha !== undefined ? options.linUcbAlpha : ((config.bandit && config.bandit.linUcb && config.bandit.linUcb.alpha) || 0.2);
        banditScore = dotProduct(theta, x) + linUcbAlpha * Math.sqrt(Math.max(0, variance));
      } catch (err) {
        // Fallback to random/default on matrix error
        banditScore = Math.random();
      }
    } else {
      // Default: Thompson Sampling (sampling from Beta distribution)
      const { alpha, beta } = getThompsonState(db, userId, armKey);
      banditScore = sampleBeta(alpha, beta);
    }

    // Blended score combines exploitation (baseline) and exploration (bandit)
    const budget = options.explorationBudget !== undefined ? options.explorationBudget : ((config.bandit && config.bandit.explorationBudget) ?? 0.15);
    const combinedScore = (1 - budget) * baselineScore + budget * banditScore;

    // Apply personalized scoring multiplier
    let itemMultiplier = 1.0;
    const itemTopics = safeParseJson(item.topic_tags_json, []);
    if (item.channel_type) itemTopics.push(item.channel_type);
    
    let matchedMultipliers = [];
    for (const t of itemTopics) {
      if (multipliers[t.toLowerCase()] !== undefined) {
        matchedMultipliers.push(multipliers[t.toLowerCase()]);
      }
    }
    if (matchedMultipliers.length > 0) {
      itemMultiplier = Math.max(...matchedMultipliers);
    }
    
    const finalCombinedScore = combinedScore * itemMultiplier;

    return {
      ...item,
      baselineScore,
      banditScore,
      combinedScore: finalCombinedScore,
      semanticRelevance,
      goalRelevance,
      freshness,
      armKey,
      narrativeOverlap,
      wishOverlap,
      goalOverlap,
      hierarchyOverlap,
      itemMultiplier
    };
  });

  // Sort candidates by combined score DESC
  scoredCandidates.sort((a, b) => b.combinedScore - a.combinedScore);

  // 7. Apply Topic Capping filter to avoid topic fatigue
  const cappedCandidates = [];
  const topicCounts = {};
  const maxTopicCount = options.maxItemsPerTopic || (config.diversity && config.diversity.topicCapping && config.diversity.topicCapping.maxItemsPerTopic) || 3;

  for (const item of scoredCandidates) {
    const topic = item.armKey;
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    if (topicCounts[topic] <= maxTopicCount) {
      cappedCandidates.push(item);
    }
  }

  // 8. Apply MMR (Maximal Marginal Relevance) Diversity Filter
  const finalRecommendations = [];
  const remaining = [...cappedCandidates];
  const targetCount = Math.min(limit, remaining.length);
  const lambda = options.mmrLambda !== undefined ? options.mmrLambda : ((config.diversity && config.diversity.mmr && config.diversity.mmr.lambda) ?? 0.7);

  while (finalRecommendations.length < targetCount && remaining.length > 0) {
    if (finalRecommendations.length === 0) {
      // Select the top-ranked item first
      finalRecommendations.push(remaining.shift());
      continue;
    }

    let bestIndex = -1;
    let maxMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      
      // Calculate max similarity with already selected items
      let maxSimilarity = 0;
      for (const selected of finalRecommendations) {
        let similarity = 0;
        let embedsExist = false;

        // Try embedding cosine similarity
        if (candidate.embedding_json && selected.embedding_json) {
          try {
            const vecC = JSON.parse(candidate.embedding_json);
            const vecS = JSON.parse(selected.embedding_json);
            if (vecC && vecS && vecC.length === vecS.length) {
              similarity = cosineSimilarity(vecC, vecS);
              embedsExist = true;
            }
          } catch (e) {}
        }

        // Fallback to text overlap similarity
        if (!embedsExist) {
          const textC = [candidate.title, candidate.summary].filter(Boolean).join(' ');
          const textS = [selected.title, selected.summary].filter(Boolean).join(' ');
          similarity = computeTextOverlapScore(textC, textS);
        }

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      // MMR Score = lambda * relevance - (1 - lambda) * max_similarity
      const mmrScore = lambda * candidate.combinedScore - (1 - lambda) * maxSimilarity;
      if (mmrScore > maxMmrScore) {
        maxMmrScore = mmrScore;
        bestIndex = i;
      }
    }

    if (bestIndex !== -1) {
      finalRecommendations.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    } else {
      break;
    }
  }

  return finalRecommendations;
}

module.exports = {
  getRecommendations,
  recordInteraction,
  saveFeedFeedback,
  initializeBanditState,
  config,
  __test__: {
    tokenize,
    computeTextOverlapScore,
    cosineSimilarity,
    solveLinearSystem,
    sampleBeta,
    computeRecencyScore,
    computeTfIdfSimilarities
  }
};
