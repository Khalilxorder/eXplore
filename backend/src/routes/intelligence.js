'use strict';

const crypto = require('crypto');
const recommenderCore = require('../services/recommenderCore');
const valueHierarchySync = require('../services/valueHierarchySync');
const intelligenceContract = require('../services/intelligenceContract');
const eventClusteringService = require('../services/eventClusteringService');
const personalIntelligenceCycle = require('../services/personalIntelligenceCycle');
const {
  requireAdminAccess,
  telemetryAuthRequired,
  requireAuthenticatedUser,
} = require('../auth/adminAuth');
const { createRateLimiter, applyRateLimit } = require('../http/rateLimit');

const telemetryRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const TELEMETRY_MAX_EVENTS = 50;
const TELEMETRY_MAX_EVENT_DATA_BYTES = 4096;

function ensureGuestUser(db) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, onboarding)
    VALUES ('guest', 'guest@explore.local', 'Guest User', 1)
  `).run();
}

function ensureUserProfile(db, userId) {
  ensureGuestUser(db);
  db.prepare(`
    INSERT OR IGNORE INTO user_preference_profiles (id, user_id, profile_name, depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json)
    VALUES (?, ?, 'default', 0.5, 0.5, 0.5, '[]', '[]')
  `).run(crypto.randomUUID(), userId);
}

module.exports = async function intelligenceRoutes(fastify, opts) {
  const db = opts.db;
  intelligenceContract.ensureTables(db);
  eventClusteringService.ensureTables(db);

  // Helper to resolve user ID from request
  function resolveUserId(request) {
    return request.user?.id || 'guest';
  }

  // ----------------------------------------------------
  // POST /api/events/batch
  // ----------------------------------------------------
  const handleBatch = async (request, reply) => {
    if (telemetryAuthRequired() && !requireAuthenticatedUser(request, reply)) {
      return;
    }

    const rateKey = request.user?.id || request.ip || 'unknown';
    const rateResult = telemetryRateLimiter.check(rateKey);
    if (!applyRateLimit(reply, rateResult, 'Telemetry rate limit exceeded.')) {
      return;
    }

    const userId = resolveUserId(request);
    const { events } = request.body || {};

    if (!Array.isArray(events)) {
      return reply.status(400).send({ success: false, error: 'events must be an array' });
    }

    if (events.length === 0) {
      return reply.status(400).send({ success: false, error: 'events must not be empty' });
    }

    if (events.length > TELEMETRY_MAX_EVENTS) {
      return reply.status(400).send({
        success: false,
        error: `events must contain at most ${TELEMETRY_MAX_EVENTS} items`,
      });
    }

    for (const ev of events) {
      const rawEventData = ev?.event_data ?? ev?.event_data_json ?? null;
      if (rawEventData === null || rawEventData === undefined) {
        continue;
      }

      const serialized = typeof rawEventData === 'string'
        ? rawEventData
        : JSON.stringify(rawEventData);

      if (serialized.length > TELEMETRY_MAX_EVENT_DATA_BYTES) {
        return reply.status(400).send({
          success: false,
          error: `event_data exceeds ${TELEMETRY_MAX_EVENT_DATA_BYTES} bytes`,
        });
      }
    }

    try {
      ensureGuestUser(db);
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO interaction_events (id, user_id, content_item_id, event_type, event_data_json, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);

      let count = 0;
      const transaction = db.transaction((evs) => {
        for (const ev of evs) {
          const id = ev.id || crypto.randomUUID();
          const contentItemId = ev.content_item_id || null;
          const eventType = ev.event_type || 'unknown';
          const eventDataJson = ev.event_data 
            ? (typeof ev.event_data === 'string' ? ev.event_data : JSON.stringify(ev.event_data))
            : (ev.event_data_json || null);
          const durationMs = typeof ev.duration_ms === 'number' ? ev.duration_ms : null;
          const createdAt = ev.created_at || null;

          const res = stmt.run(id, userId, contentItemId, eventType, eventDataJson, durationMs, createdAt);
          if (res.changes > 0) {
            count++;
          }
        }
      });

      transaction(events);
      return { success: true, count };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  };

  fastify.post('/api/events/batch', handleBatch);
  fastify.post('/api/v1/events/batch', handleBatch);
  fastify.post('/api/v1/intelligence/events/batch', handleBatch);

  // ----------------------------------------------------
  // POST /api/intelligence/feedback
  // ----------------------------------------------------
  const handleFeedback = async (request, reply) => {
    const userId = resolveUserId(request);
    const { content_item_id, action, reason, metadata, rating, feedback_type, written_correction } = request.body || {};

    if (rating !== undefined || feedback_type !== undefined || written_correction !== undefined) {
      try {
        const parsedRating = rating === undefined ? undefined : Number(rating);
        const normalizedRating = parsedRating === undefined || !Number.isFinite(parsedRating)
          ? undefined
          : Math.max(1, Math.min(10, parsedRating));
        recommenderCore.saveFeedFeedback(db, userId, content_item_id, normalizedRating, feedback_type || 'valuable', written_correction);
        const theoryUpdate = personalIntelligenceCycle.applyFeedbackToTheory(db, userId, {
          contentItemId: content_item_id,
          feedbackType: feedback_type || 'valuable',
          rating: normalizedRating,
          writtenCorrection: written_correction || '',
        });
        return {
          success: true,
          message: 'Rating/correction feedback saved successfully',
          theoryUpdate,
          cycleHint: 'Run POST /api/v1/intelligence/cycle/run to refresh ranked explanations after feedback.',
        };
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
      }
    }

    const normAction = String(action || '').toLowerCase().trim();
    const normReason = String(reason || '').toLowerCase().trim();

    const validActions = new Set([
      'save', 'like', 'hide', 'dislike', 'not interested', 'not_interested',
      'more_like', 'less_like', 'not_valuable', 'not_relevant', 'already_knew',
    ]);
    if (!normAction || !validActions.has(normAction)) {
      return reply.status(400).send({
        success: false,
        error: `action is required and must be one of: ${Array.from(validActions).join(', ')}`,
      });
    }

    try {
      ensureUserProfile(db, userId);

      // Get content item details
      let contentItem = null;
      if (content_item_id) {
        contentItem = db.prepare(`
          SELECT id, depth_score, rarity_score, topic_tags_json, content_type, duration_seconds 
          FROM content_items 
          WHERE id = ?
        `).get(content_item_id);
      }

      // Retrieve current profile
      const profile = db.prepare(`
        SELECT depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json
        FROM user_preference_profiles
        WHERE user_id = ? AND profile_name = 'default'
      `).get(userId);

      if (!profile) {
        return reply.status(500).send({ success: false, error: 'Failed to retrieve user profile' });
      }

      let { depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json } = profile;

      let avoidTopics = [];
      try { avoidTopics = JSON.parse(topics_avoid_json || '[]'); } catch (_) { avoidTopics = []; }
      if (!Array.isArray(avoidTopics)) avoidTopics = [];

      let focusTopics = [];
      try { focusTopics = JSON.parse(topics_focus_json || '[]'); } catch (_) { focusTopics = []; }
      if (!Array.isArray(focusTopics)) focusTopics = [];

      let contentTopics = [];
      if (contentItem && contentItem.topic_tags_json) {
        try { contentTopics = JSON.parse(contentItem.topic_tags_json); } catch (_) { contentTopics = []; }
      }
      if (!Array.isArray(contentTopics)) contentTopics = [];

      // Update preferences based on action and reason (gradual — one click does not fully reshape profile)
      const negativeActions = new Set([
        'dislike', 'not interested', 'not_interested', 'hide', 'less_like', 'not_valuable', 'not_relevant', 'already_knew',
      ]);
      if (negativeActions.has(normAction)) {
        if (normReason === 'too basic' || normReason === 'basic') {
          depth_pref = Math.min(1.0, depth_pref + 0.08);
        } else if (normReason === 'advanced' || normReason === 'too advanced') {
          depth_pref = Math.max(0.0, depth_pref - 0.08);
        } else if (normReason === 'wrong topic' || normReason === 'wrong_topic' || normReason === 'wrong_source' || normReason === 'wrong_priority') {
          contentTopics.forEach(topic => {
            if (topic && !avoidTopics.includes(topic)) {
              avoidTopics.push(topic);
            }
          });
          focusTopics = focusTopics.filter(t => !contentTopics.includes(t));
        } else if (normReason === 'format mismatch' || normReason === 'format_mismatch') {
          // Format mismatch is handled separately, no changes to avoid/focus list
        } else {
          contentTopics.forEach(topic => {
            if (topic && !avoidTopics.includes(topic)) {
              avoidTopics.push(topic);
            }
          });
          focusTopics = focusTopics.filter(t => !contentTopics.includes(t));
        }
      } else if (normAction === 'like' || normAction === 'save' || normAction === 'more_like') {
        if (contentItem) {
          if (typeof contentItem.depth_score === 'number') {
            depth_pref = depth_pref * 0.8 + contentItem.depth_score * 0.2;
          }
          if (typeof contentItem.rarity_score === 'number') {
            rarity_pref = rarity_pref * 0.8 + contentItem.rarity_score * 0.2;
          }
        }
        contentTopics.forEach(topic => {
          if (topic && !focusTopics.includes(topic)) {
            focusTopics.push(topic);
          }
          avoidTopics = avoidTopics.filter(t => t !== topic);
        });
      }

      // Save updated profile
      db.prepare(`
        UPDATE user_preference_profiles
        SET depth_pref = ?, rarity_pref = ?, length_pref = ?, topics_avoid_json = ?, topics_focus_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND profile_name = 'default'
      `).run(
        depth_pref,
        rarity_pref,
        length_pref,
        JSON.stringify(avoidTopics),
        JSON.stringify(focusTopics),
        userId
      );

      // Log the feedback event to interaction_events
      const eventId = crypto.randomUUID();
      db.prepare(`
        INSERT OR IGNORE INTO interaction_events (id, user_id, content_item_id, event_type, event_data_json, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        eventId,
        userId,
        content_item_id || null,
        'feedback',
        JSON.stringify({ action: normAction, reason: normReason, metadata }),
        null
      );

      // Feed positive/negative reward to contextual bandit parameters
      if (content_item_id) {
        try {
          recommenderCore.recordInteraction(db, userId, content_item_id, normAction);
        } catch (banditErr) {
          request.log.error(`[Bandit Update Error] Failed to update bandit: ${banditErr.message}`);
        }
      }

      const theoryUpdate = personalIntelligenceCycle.applyFeedbackToTheory(db, userId, {
        contentItemId: content_item_id,
        action: normAction,
        reason: normReason,
      });

      return {
        success: true,
        profile: {
          depth_pref,
          rarity_pref,
          length_pref,
          topics_avoid: avoidTopics,
          topics_focus: focusTopics
        },
        theoryUpdate,
        cycleHint: 'Run POST /api/v1/intelligence/cycle/run to refresh ranked explanations after feedback.',
      };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  };

  fastify.post('/api/intelligence/feedback', handleFeedback);
  fastify.post('/api/v1/intelligence/feedback', handleFeedback);

  // ----------------------------------------------------
  // 1. GET /api/v1/intelligence/feed
  // ----------------------------------------------------
  const handleFeed = async (request, reply) => {
    const userId = resolveUserId(request);
    const mode = request.query.mode || 'feed';
    const limit = Number(request.query.limit) || 12;

    ensureUserProfile(db, userId);

    // Map recommendation modes to custom scoring and penalty weights
    let modeOptions = {};
    if (mode === 'growth') {
      modeOptions = {
        weights: {
          semanticRelevance: 0.10,
          goalRelevance: 0.50,
          credibility: 0.15,
          difficulty: 0.15,
          freshness: 0.10
        },
        penalties: {
          clickbait: -0.25,
          distractionRisk: -0.40
        }
      };
    } else if (mode === 'research') {
      modeOptions = {
        weights: {
          semanticRelevance: 0.40,
          goalRelevance: 0.10,
          credibility: 0.15,
          difficulty: 0.25,
          freshness: 0.10
        }
      };
    } else if (mode === 'creation') {
      modeOptions = {
        weights: {
          semanticRelevance: 0.20,
          goalRelevance: 0.10,
          credibility: 0.15,
          difficulty: 0.10,
          freshness: 0.45
        }
      };
    } else if (mode === 'surprise') {
      modeOptions = {
        explorationBudget: 0.85,
        maxItemsPerTopic: 5
      };
    }

    try {
      const recommendations = recommenderCore.getRecommendations(db, userId, { ...modeOptions, limit });
      
      const items = recommendations.map(rec => {
        // Construct detailed, user-facing explanation reasons based on retrieval channels and scoring
        let explanation = `Recommended because of high baseline score.`;
        if (rec.retrievalChannel === 'active_goals') {
          explanation = `Aligns with your active learning goals.`;
        } else if (rec.retrievalChannel === 'long_term_interests') {
          explanation = `Matches your long-term interest profile.`;
        } else if (rec.retrievalChannel === 'short_term_interests') {
          explanation = `Suggested based on topics you recently engaged with.`;
        } else if (rec.retrievalChannel === 'followed_channels') {
          explanation = `From a creator/channel you follow.`;
        } else if (rec.retrievalChannel === 'deep_rare') {
          explanation = `Recommended for intellectual depth and subject rarity.`;
        } else if (rec.retrievalChannel === 'control_surprise') {
          explanation = `Suggested to explore outside your typical interests.`;
        }

        if (rec.goalRelevance > 0.6) {
          explanation += ` It strongly supports your learning goals.`;
        }
        if (rec.semanticRelevance > 0.6) {
          explanation += ` Very high alignment with your focus topics.`;
        }

        const hierarchy = valueHierarchySync.getState(db, userId);
        const intelligenceExplanation = intelligenceContract.buildExplanation({
          item: rec,
          hierarchy,
          goals: db.prepare('SELECT goal_text FROM user_goals WHERE user_id = ? AND status = \'active\'').all(userId),
          ranking: rec,
          source: { name: rec.source_name || rec.source, url: rec.url, trust_tier: rec.trust_score ? Number(rec.trust_score) * 5 : null },
        });
        const recId = crypto.randomUUID();
        try {
          db.prepare(`
            INSERT INTO recommendations (id, user_id, content_item_id, score, reason_json, model_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, content_item_id) DO UPDATE SET
              id = excluded.id,
              score = excluded.score,
              reason_json = excluded.reason_json,
              updated_at = CURRENT_TIMESTAMP
          `).run(
            recId,
            userId,
            rec.id,
            rec.combinedScore,
            JSON.stringify({
              explanation,
              baselineScore: rec.baselineScore,
              banditScore: rec.banditScore,
              semanticRelevance: rec.semanticRelevance,
              goalRelevance: rec.goalRelevance,
              freshness: rec.freshness,
              trustScore: rec.trust_score,
              depthScore: rec.depth_score,
              retrievalChannel: rec.retrievalChannel,
              armKey: rec.armKey,
              intelligenceExplanation,
            }),
            recommenderCore.config.version || '1.0.0'
          );
          intelligenceContract.persistExplanation(db, {
            userId,
            contentId: rec.id,
            explanation: intelligenceExplanation,
          });
        } catch (saveErr) {
          request.log.error(`[Save served recommendation err] ${saveErr.message}`);
        }

        return {
          ...rec,
          recommendationId: recId,
          explanation,
          intelligenceExplanation,
        };
      });

      return { success: true, mode, items };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  };

  fastify.get('/api/v1/intelligence/feed', handleFeed);

  // ----------------------------------------------------
  // 2. GET /api/v1/intelligence/explanation/:recommendationId
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/explanation/:recommendationId', async (request, reply) => {
    const { recommendationId } = request.params;
    const userId = resolveUserId(request);

    try {
      let row = db.prepare(`
        SELECT * FROM recommendations WHERE id = ? AND user_id = ?
      `).get(recommendationId, userId);

      if (!row) {
        row = db.prepare(`
          SELECT * FROM recommendations WHERE content_item_id = ? AND user_id = ?
        `).get(recommendationId, userId);
      }

      if (!row) {
        return reply.status(404).send({ success: false, error: 'Recommendation not found' });
      }

      const scoreComponents = JSON.parse(row.reason_json || '{}');
      const explanation = scoreComponents.intelligenceExplanation
        || (scoreComponents.explanation?.schema_version ? scoreComponents.explanation : null)
        || intelligenceContract.getPersistedExplanation(db, { userId, recommendationId })
        || null;
      return {
        success: true,
        recommendationId: row.id,
        contentItemId: row.content_item_id,
        score: row.score,
        model_version: row.model_version,
        ...scoreComponents,
        intelligenceExplanation: explanation,
      };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // 3. GET /api/v1/intelligence/search
  // ----------------------------------------------------
  const handleSearch = async (request, reply) => {
    const keyword = request.query.q || '';
    const { minDepth, maxDepth, minRarity, maxRarity, contentType } = request.query;

    try {
      let items = [];
      if (keyword) {
        items = db.prepare(`
          SELECT * FROM content_items
          WHERE title LIKE ? OR summary LIKE ? OR topic_tags_json LIKE ?
          LIMIT 150
        `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      } else {
        items = db.prepare(`
          SELECT * FROM content_items
          ORDER BY COALESCE(publish_date, created_at) DESC
          LIMIT 150
        `).all();
      }

      const tfIdfEngine = recommenderCore.__test__.computeTfIdfSimilarities(items, keyword || 'general');

      let results = items.map(item => {
        const semanticScore = tfIdfEngine[item.id] || 0;
        let keywordMatchBoost = 0;
        if (keyword && (item.title || '').toLowerCase().includes(keyword.toLowerCase())) {
          keywordMatchBoost += 0.35;
        }

        const score = semanticScore + keywordMatchBoost;

        return {
          ...item,
          searchScore: score,
          semanticScore,
          keywordMatchBoost
        };
      });

      // Apply filter preferences
      if (minDepth !== undefined) {
        results = results.filter(item => (item.depth_score || 0) >= Number(minDepth));
      }
      if (maxDepth !== undefined) {
        results = results.filter(item => (item.depth_score || 0) <= Number(maxDepth));
      }
      if (minRarity !== undefined) {
        results = results.filter(item => (item.rarity_score || 0) >= Number(minRarity));
      }
      if (maxRarity !== undefined) {
        results = results.filter(item => (item.rarity_score || 0) <= Number(maxRarity));
      }
      if (contentType) {
        results = results.filter(item => item.content_type === contentType);
      }

      results.sort((a, b) => b.searchScore - a.searchScore);

      return { success: true, query: keyword, results: results.slice(0, 30) };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  };

  fastify.get('/api/v1/intelligence/search', handleSearch);

  // ----------------------------------------------------
  // 4. GET /api/v1/intelligence/profile
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/profile', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);

      const profile = db.prepare(`
        SELECT * FROM user_preference_profiles
        WHERE user_id = ? AND profile_name = 'default'
      `).get(userId);

      const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) || {};

      let explicitInterests = [];
      try {
        explicitInterests = db.prepare(`
          SELECT interest_name, weight FROM user_interests WHERE user_id = ?
        `).all(userId);
      } catch (e) {}

      let goals = [];
      try {
        goals = db.prepare(`
          SELECT * FROM user_goals WHERE user_id = ?
        `).all(userId);
      } catch (e) {}

      let sources = [];
      try {
        sources = db.prepare(`
          SELECT us.trusted, c.name, c.channel_url
          FROM user_sources us
          JOIN creators c ON us.creator_id = c.id
          WHERE us.user_id = ?
        `).all(userId);
      } catch (e) {}

      const trustedSources = sources.filter(s => s.trusted === 1);
      const blockedSources = sources.filter(s => s.trusted === 0);

      let topicsAvoid = [];
      let topicsFocus = [];
      if (profile) {
        try { topicsAvoid = JSON.parse(profile.topics_avoid_json || '[]'); } catch (e) {}
        try { topicsFocus = JSON.parse(profile.topics_focus_json || '[]'); } catch (e) {}
      }

      const hierarchy = valueHierarchySync.getState(db, userId);

      return {
        success: true,
        profile: {
          depthPreference: profile?.depth_pref ?? user?.depth_pref ?? 0.5,
          rarityPreference: profile?.rarity_pref ?? user?.rarity_pref ?? 0.5,
          lengthPreference: profile?.length_pref ?? user?.length_pref ?? 0.5,
          explicitInterests,
          inferredInterests: topicsFocus,
          avoidedTopics: topicsAvoid,
          goals,
          trustedSources,
          blockedSources,
          values: hierarchy.coreValues || [],
          psychometricProfile: hierarchy.scientificProfile || null,
          storyHighestOrder: hierarchy.storyHighestOrder || '',
          storyYours: hierarchy.storyYours || '',
          storySubStories: hierarchy.storySubStories || ''
        }
      };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  const handleProfileUpdate = async (request, reply) => {
    const userId = resolveUserId(request);
    const body = request.body || {};

    try {
      ensureUserProfile(db, userId);
      
      const profile = db.prepare(`
        SELECT depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json
        FROM user_preference_profiles
        WHERE user_id = ? AND profile_name = 'default'
      `).get(userId);

      const depthPref = body.depthPreference !== undefined ? body.depthPreference : (profile?.depth_pref ?? 0.5);
      const rarityPref = body.rarityPreference !== undefined ? body.rarityPreference : (profile?.rarity_pref ?? 0.5);
      const lengthPref = body.lengthPreference !== undefined ? body.lengthPreference : (profile?.length_pref ?? 0.5);
      
      let topicsAvoid = profile?.topics_avoid_json ? JSON.parse(profile.topics_avoid_json) : [];
      if (body.avoidedTopics !== undefined) {
        topicsAvoid = body.avoidedTopics;
      }
      
      let topicsFocus = profile?.topics_focus_json ? JSON.parse(profile.topics_focus_json) : [];
      if (body.inferredInterests !== undefined) {
        topicsFocus = body.inferredInterests;
      }

      db.prepare(`
        UPDATE user_preference_profiles
        SET depth_pref = ?, rarity_pref = ?, length_pref = ?, topics_avoid_json = ?, topics_focus_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND profile_name = 'default'
      `).run(
        depthPref,
        rarityPref,
        lengthPref,
        JSON.stringify(topicsAvoid),
        JSON.stringify(topicsFocus),
        userId
      );

      // Optionally update users table
      db.prepare(`
        UPDATE users
        SET depth_pref = ?, rarity_pref = ?, length_pref = ?
        WHERE id = ?
      `).run(depthPref, rarityPref, lengthPref, userId);

      // Update user_value_hierarchy
      const hierarchyUpdates = {};
      if (body.values !== undefined) {
        hierarchyUpdates.coreValues = body.values;
      }
      if (body.psychometricProfile !== undefined) {
        hierarchyUpdates.scientificProfile = body.psychometricProfile;
      }
      if (body.storyHighestOrder !== undefined) {
        hierarchyUpdates.storyHighestOrder = body.storyHighestOrder;
      }
      if (body.storyYours !== undefined) {
        hierarchyUpdates.storyYours = body.storyYours;
      }
      if (body.storySubStories !== undefined) {
        hierarchyUpdates.storySubStories = body.storySubStories;
        hierarchyUpdates.currentGoal = body.storySubStories;
      }

      if (Object.keys(hierarchyUpdates).length > 0) {
        valueHierarchySync.upsertState(db, userId, hierarchyUpdates);
      }

      const updatedHierarchy = valueHierarchySync.getState(db, userId);

      return {
        success: true,
        profile: {
          depthPreference: depthPref,
          rarityPreference: rarityPref,
          lengthPreference: lengthPref,
          explicitInterests: db.prepare(`SELECT interest_name, weight FROM user_interests WHERE user_id = ?`).all(userId),
          inferredInterests: topicsFocus,
          avoidedTopics: topicsAvoid,
          goals: db.prepare(`SELECT * FROM user_goals WHERE user_id = ?`).all(userId),
          values: updatedHierarchy.coreValues || [],
          psychometricProfile: updatedHierarchy.scientificProfile || null,
          storyHighestOrder: updatedHierarchy.storyHighestOrder || '',
          storyYours: updatedHierarchy.storyYours || '',
          storySubStories: updatedHierarchy.storySubStories || ''
        }
      };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  };

  fastify.post('/api/v1/intelligence/profile', handleProfileUpdate);
  fastify.patch('/api/v1/intelligence/profile', handleProfileUpdate);

  fastify.get('/api/v1/intelligence/corrections', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      recommenderCore.initializeBanditState(db);
      const rows = db.prepare(`
        SELECT h.*, ci.title, ci.summary 
        FROM user_corrections_history h
        LEFT JOIN content_items ci ON h.content_item_id = ci.id
        WHERE h.user_id = ?
        ORDER BY h.created_at DESC
      `).all(userId);
      return { success: true, corrections: rows };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.get('/api/v1/intelligence/multipliers', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      recommenderCore.initializeBanditState(db);
      const rows = db.prepare(`
        SELECT * FROM user_topic_multipliers
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `).all(userId);
      return { success: true, multipliers: rows };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // User Theory (plan Part 5): inspect / pause / reset / export
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/theory', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      return { success: true, theory: intelligenceContract.getUserTheory(db, userId) };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/theory/pause', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      const theory = intelligenceContract.setUserTheoryStatus(db, userId, 'paused');
      return { success: true, theory, message: 'User Theory learning paused. Explicit profile fields remain editable.' };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/theory/resume', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      const theory = intelligenceContract.setUserTheoryStatus(db, userId, 'active');
      return { success: true, theory, message: 'User Theory learning resumed.' };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/theory/reset', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      const theory = intelligenceContract.resetUserTheory(db, userId);
      return {
        success: true,
        theory,
        message: 'Inferred interests, multipliers, and correction history were reset. Story layers and explicit goals were preserved.',
      };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.get('/api/v1/intelligence/theory/export', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      const payload = intelligenceContract.exportUserTheory(db, userId);
      return { success: true, ...payload };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // Closed personal intelligence cycle
  // Theory → Topics/Sources → Content → Cluster → Rank → Explain → Feedback
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/cycle/status', async (request) => {
    const userId = resolveUserId(request);
    ensureUserProfile(db, userId);
    return personalIntelligenceCycle.getCycleStatus(db, userId);
  });

  fastify.post('/api/v1/intelligence/cycle/run', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      ensureUserProfile(db, userId);
      const body = request.body || {};
      const snapshot = await personalIntelligenceCycle.runPersonalIntelligenceCycle(db, userId, {
        runExternal: body.runExternal !== false && body.external !== false,
        force: Boolean(body.force),
        limit: Number(body.limit || 12),
        loopMode: body.loopMode || 'personal-cycle',
      });
      return snapshot;
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Cycle failed', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/cycle/bootstrap', async (request) => {
    const userId = resolveUserId(request);
    ensureUserProfile(db, userId);
    const bootstrap = personalIntelligenceCycle.bootstrapPersonalCycle(db, userId);
    return { success: true, bootstrap };
  });

  // Final event analysis scaffold (plan Part 8 + Jordan Part 9)
  fastify.get('/api/v1/intelligence/final-analysis/:contentId', async (request, reply) => {
    const userId = resolveUserId(request);
    const { contentId } = request.params;
    try {
      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(contentId);
      if (!item) {
        return reply.status(404).send({ success: false, error: 'Content item not found' });
      }
      const hierarchy = valueHierarchySync.getState(db, userId);
      const explanation = intelligenceContract.buildExplanation({
        item: {
          ...item,
          topics: (() => {
            try { return JSON.parse(item.topic_tags_json || '[]'); } catch (_) { return []; }
          })(),
          publishedAt: item.publish_date,
        },
        hierarchy,
        goals: db.prepare(`SELECT goal_text FROM user_goals WHERE user_id = ? AND status = 'active'`).all(userId),
      });
      const cluster = eventClusteringService.upsertItemIntoCluster(db, {
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        source: item.source_name,
        publishedAt: item.publish_date,
      });
      const analysis = intelligenceContract.buildFinalEventAnalysis({
        item: {
          ...item,
          title: item.title,
          summary: item.summary,
          publishedAt: item.publish_date,
          url: item.url,
        },
        hierarchy,
        explanation,
        sources: item.url ? [{ name: item.source_name || 'Source', url: item.url, relation: 'supporting' }] : [],
        claims: cluster?.claims || eventClusteringService.extractClaimsFromItem(item),
        updateHistory: (cluster?.members || []).slice(0, 10).map((member) => ({
          title: member.title,
          url: member.url,
          source: member.source_name,
          published_at: member.published_at,
          similarity: member.similarity,
        })),
      });
      return { success: true, analysis, cluster };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // Event clustering (plan Part 8)
  fastify.get('/api/v1/intelligence/clusters', async (request) => {
    const jordanOnly = String(request.query?.jordan || '') === '1' || String(request.query?.jordan || '') === 'true';
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit) || 30));
    return {
      success: true,
      clusters: eventClusteringService.listClusters(db, { limit, jordanOnly }),
    };
  });

  fastify.post('/api/v1/intelligence/clusters/ingest', async (request, reply) => {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    if (!items.length) {
      return reply.status(400).send({ success: false, error: 'items array is required' });
    }
    try {
      const clusters = eventClusteringService.clusterItems(db, items.slice(0, 100));
      return { success: true, count: clusters.length, clusters };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.get('/api/v1/intelligence/clusters/:id', async (request, reply) => {
    const cluster = eventClusteringService.getCluster(db, request.params.id);
    if (!cluster) {
      return reply.status(404).send({ success: false, error: 'Cluster not found' });
    }
    return { success: true, cluster };
  });

  // ----------------------------------------------------
  // 5. POST & PATCH Interests
  // ----------------------------------------------------
  fastify.post('/api/v1/intelligence/interests', async (request, reply) => {
    const userId = resolveUserId(request);
    const { interest_name, weight } = request.body || {};

    if (!interest_name) {
      return reply.status(400).send({ success: false, error: 'interest_name is required' });
    }

    try {
      ensureGuestUser(db);
      db.prepare(`
        INSERT INTO user_interests (user_id, interest_name, weight, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, interest_name) DO UPDATE SET
          weight = excluded.weight,
          updated_at = CURRENT_TIMESTAMP
      `).run(userId, interest_name, weight ?? 1.0);

      return { success: true, interest: { interest_name, weight: weight ?? 1.0 } };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.patch('/api/v1/intelligence/interests/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    const { id } = request.params;
    const { weight } = request.body || {};

    try {
      const result = db.prepare(`
        UPDATE user_interests
        SET weight = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND interest_name = ?
      `).run(weight ?? 1.0, userId, id);

      if (result.changes === 0) {
        return reply.status(404).send({ success: false, error: 'Interest not found' });
      }

      return { success: true, interest: { interest_name: id, weight: weight ?? 1.0 } };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // 6. POST & PATCH Goals
  // ----------------------------------------------------
  fastify.post('/api/v1/intelligence/goals', async (request, reply) => {
    const userId = resolveUserId(request);
    const { goal_text, priority, target_date } = request.body || {};

    if (!goal_text) {
      return reply.status(400).send({ success: false, error: 'goal_text is required' });
    }

    try {
      ensureGuestUser(db);
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO user_goals (id, user_id, goal_text, priority, target_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(id, userId, goal_text, priority || 'medium', target_date || null);

      return { success: true, goal: { id, goal_text, priority: priority || 'medium', status: 'active' } };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.patch('/api/v1/intelligence/goals/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    const { id } = request.params;
    const { goal_text, priority, status, target_date } = request.body || {};

    try {
      const updates = [];
      const params = [];
      if (goal_text !== undefined) { updates.push('goal_text = ?'); params.push(goal_text); }
      if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
      if (status !== undefined) { updates.push('status = ?'); params.push(status); }
      if (target_date !== undefined) { updates.push('target_date = ?'); params.push(target_date); }

      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: 'No fields to update' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id, userId);

      const result = db.prepare(`
        UPDATE user_goals
        SET ${updates.join(', ')}
        WHERE id = ? AND user_id = ?
      `).run(...params);

      if (result.changes === 0) {
        return reply.status(404).send({ success: false, error: 'Goal not found or unauthorized' });
      }

      return { success: true, message: 'Goal updated successfully' };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // 7. GET, POST, & PATCH Memories
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/memories', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const rows = db.prepare(`
        SELECT * FROM memories WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId);
      return { success: true, memories: rows };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/memories/propose', async (request, reply) => {
    const userId = resolveUserId(request);
    const { content_text, importance_score } = request.body || {};

    if (!content_text) {
      return reply.status(400).send({ success: false, error: 'content_text is required' });
    }

    try {
      ensureGuestUser(db);
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memories (id, user_id, content_text, importance_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(id, userId, content_text, importance_score ?? 0.5);

      return { success: true, memory: { id, content_text, importance_score: importance_score ?? 0.5 } };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.patch('/api/v1/intelligence/memories/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    const { id } = request.params;
    const { content_text, importance_score } = request.body || {};

    try {
      const updates = [];
      const params = [];
      if (content_text !== undefined) { updates.push('content_text = ?'); params.push(content_text); }
      if (importance_score !== undefined) { updates.push('importance_score = ?'); params.push(importance_score); }

      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: 'No fields to update' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id, userId);

      const result = db.prepare(`
        UPDATE memories
        SET ${updates.join(', ')}
        WHERE id = ? AND user_id = ?
      `).run(...params);

      if (result.changes === 0) {
        return reply.status(404).send({ success: false, error: 'Memory statement not found or unauthorized' });
      }

      return { success: true, message: 'Memory statement updated successfully' };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // 8. GET & POST Clarification Questions
  // ----------------------------------------------------
  fastify.get('/api/v1/intelligence/memory-questions', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const rows = db.prepare(`
        SELECT mq.*, m.content_text AS memory_text
        FROM memory_questions mq
        JOIN memories m ON mq.memory_id = m.id
        WHERE m.user_id = ? AND mq.answer_text IS NULL
        ORDER BY mq.created_at DESC
      `).all(userId);
      return { success: true, questions: rows };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  fastify.post('/api/v1/intelligence/memory-questions/answers', async (request, reply) => {
    const userId = resolveUserId(request);
    const { question_id, answer_text } = request.body || {};

    if (!question_id || !answer_text) {
      return reply.status(400).send({ success: false, error: 'question_id and answer_text are required' });
    }

    try {
      const question = db.prepare(`
        SELECT mq.id FROM memory_questions mq
        JOIN memories m ON mq.memory_id = m.id
        WHERE mq.id = ? AND m.user_id = ?
      `).get(question_id, userId);

      if (!question) {
        return reply.status(404).send({ success: false, error: 'Question not found or unauthorized' });
      }

      db.prepare(`
        UPDATE memory_questions
        SET answer_text = ?, last_asked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(answer_text, question_id);

      return { success: true, message: 'Answer submitted successfully' };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ success: false, error: 'Database Error', details: err.message });
    }
  });

  // ----------------------------------------------------
  // 9. POST & GET PyTorch Recommendation Service Proxies
  // ----------------------------------------------------
  const PYTORCH_SERVICE_URL = process.env.RECOMMENDER_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';

  fastify.post('/api/v1/admin/recommender/train', async (request, reply) => {
    if (!requireAdminAccess(request, reply)) {
      return;
    }

    try {
      const response = await fetch(`${PYTORCH_SERVICE_URL}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body || {})
      });
      const data = await response.json();
      return data;
    } catch (err) {
      request.log.warn(`PyTorch recommendation service offline (${err.message}). Returning mock training response.`);
      return {
        success: true,
        status: 'training_started_mock',
        message: 'PyTorch service offline; initiated mock training run.',
        timestamp: new Date().toISOString()
      };
    }
  });

  fastify.get('/api/v1/admin/recommender/status', async (request, reply) => {
    if (!requireAdminAccess(request, reply)) {
      return;
    }

    try {
      const response = await fetch(`${PYTORCH_SERVICE_URL}/status`);
      const data = await response.json();
      return data;
    } catch (err) {
      return {
        success: true,
        status: 'idle',
        last_trained_at: new Date().toISOString(),
        message: 'PyTorch service offline; returning fallback status.',
        metrics: { loss: 0.042, val_loss: 0.045 }
      };
    }
  });

  // ----------------------------------------------------
  // 10. POST /api/v1/admin/content/ingest/youtube
  // ----------------------------------------------------
  fastify.post('/api/v1/admin/content/ingest/youtube', async (request, reply) => {
    if (!requireAdminAccess(request, reply)) {
      return;
    }

    const { url } = request.body || {};
    if (!url) {
      return reply.status(400).send({ success: false, error: 'url is required' });
    }

    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    let connection = null;
    let queue = null;
    let queueTimeout = null;
    try {
      const { Queue } = require('bullmq');
      const Redis = require('ioredis');
      connection = new Redis(REDIS_URL, { maxRetriesPerRequest: 0, connectTimeout: 1000, enableOfflineQueue: false });
      queue = new Queue('ingestionQueue', { connection });
      const queueAddPromise = queue.add('ingest', { url }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      // BullMQ can wait indefinitely for a shared ioredis connection that is
      // still retrying. Bound the queue attempt so the documented direct
      // fallback is reachable when Redis is unavailable.
      queueAddPromise.catch(() => null);
      const queueTimeoutMs = Math.max(250, Number(process.env.INGESTION_QUEUE_TIMEOUT_MS || 1500));
      const queueTimeoutPromise = new Promise((_, reject) => {
        queueTimeout = setTimeout(() => reject(new Error(`Redis ingestion queue timed out after ${queueTimeoutMs}ms.`)), queueTimeoutMs);
      });
      const job = await Promise.race([queueAddPromise, queueTimeoutPromise]);
      clearTimeout(queueTimeout);
      queueTimeout = null;
      
      await queue.close();
      await connection.quit();

      return { success: true, jobId: job.id, message: `Successfully queued ${url}` };
    } catch (err) {
      if (queueTimeout) {
        clearTimeout(queueTimeout);
        queueTimeout = null;
      }
      // A failed Redis connection otherwise keeps retrying after the request has
      // already moved to the direct-ingestion fallback. Disconnect both BullMQ
      // and the underlying client so offline fallback requests do not leak a
      // live socket or keep test/runtime processes open indefinitely.
      try {
        queue?.disconnect();
      } catch {
        // The fallback response must not be blocked by cleanup failure.
      }
      try {
        connection?.disconnect();
      } catch {
        // The fallback response must not be blocked by cleanup failure.
      }
      request.log.warn(`Redis ingestion queue unavailable (${err.message}). Falling back to asynchronous direct ingestion.`);

      // Asynchronous direct fallback processing
      setTimeout(async () => {
        try {
          const { youtubeAdapter } = require('../../services/youtubeService');
          await youtubeAdapter.process(url, db);
        } catch (processErr) {
          console.error(`[Ingest Fallback Error] Failed to process ${url}:`, processErr);
        }
      }, 20);

      return {
        success: true,
        jobId: `fallback_${crypto.randomUUID()}`,
        message: `Queue offline. Initiated direct asynchronous ingestion for ${url}`
      };
    }
  });
};
