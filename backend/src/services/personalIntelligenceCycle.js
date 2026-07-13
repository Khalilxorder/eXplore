'use strict';

/**
 * Closed personal intelligence cycle (product spine):
 * User Theory → Story Layers → Goals/Topics → Sources → Content →
 * Ranking → Explanation → Feedback → Updated Theory → next rank
 */

const crypto = require('crypto');
const valueHierarchy = require('./valueHierarchySync');
const intelligenceContract = require('./intelligenceContract');
const topicService = require('./topicService');
const eventClusteringService = require('./eventClusteringService');
const recommenderCore = require('./recommenderCore');

const SEED_CONTENT = [
  {
    id: 'cycle-seed-jordan-1',
    external_id: 'cycle-seed-jordan-1',
    title: 'Jordan monitors regional airspace activity amid Iran-related escalation reports',
    summary: 'Official and regional reporting describes airspace and security watchfulness with potential impact on Jordan. Material relevance depends on corroboration and official statements.',
    url: 'https://example.com/seed/jordan-airspace',
    source_name: 'Regional Security Wire',
    topic_tags: ['Jordan', 'Iran', 'security', 'airspace'],
    content_type: 'article',
    trust_score: 0.72,
    depth_score: 0.6,
    rarity_score: 0.55,
  },
  {
    id: 'cycle-seed-ai-1',
    external_id: 'cycle-seed-ai-1',
    title: 'Frontier AI lab announces official availability of a new coding model',
    summary: 'An official release-style announcement describes public or API availability for a major coding model generation, with implications for research and product building.',
    url: 'https://example.com/seed/ai-coding-model',
    source_name: 'AI Newsroom',
    topic_tags: ['AI', 'coding', 'model release', 'tools'],
    content_type: 'article',
    trust_score: 0.88,
    depth_score: 0.7,
    rarity_score: 0.65,
    official_source: 1,
  },
  {
    id: 'cycle-seed-neuro-1',
    external_id: 'cycle-seed-neuro-1',
    title: 'New cognitive neuroscience study on autobiographical memory and narrative identity',
    summary: 'Peer-oriented coverage of research methods linking autobiographical memory, personality, and narrative identity with practical learning implications.',
    url: 'https://example.com/seed/memory-narrative',
    source_name: 'Science Brief',
    topic_tags: ['neuroscience', 'memory', 'psychology', 'research'],
    content_type: 'article',
    trust_score: 0.8,
    depth_score: 0.85,
    rarity_score: 0.7,
  },
  {
    id: 'cycle-seed-scholarship-1',
    external_id: 'cycle-seed-scholarship-1',
    title: 'Graduate research scholarships and US lab opportunities for cognitive science candidates',
    summary: 'A practical roundup of scholarship and research opportunity signals aligned with cognitive science, AI methods, and graduate study planning.',
    url: 'https://example.com/seed/scholarships',
    source_name: 'Opportunity Desk',
    topic_tags: ['scholarship', 'research', 'US', 'graduate'],
    content_type: 'article',
    trust_score: 0.7,
    depth_score: 0.55,
    rarity_score: 0.5,
  },
  {
    id: 'cycle-seed-tool-1',
    external_id: 'cycle-seed-tool-1',
    title: 'Developer tools update: agents and automation features that can change daily research work',
    summary: 'Coverage of material tool and agent capability changes relevant to coding agents, workflows, and productivity without treating rumors as releases.',
    url: 'https://example.com/seed/dev-tools',
    source_name: 'Tools Watch',
    topic_tags: ['AI tools', 'agents', 'coding', 'productivity'],
    content_type: 'article',
    trust_score: 0.74,
    depth_score: 0.6,
    rarity_score: 0.58,
  },
];

function ensureGuestUser(db, userId = 'guest') {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, onboarding)
    VALUES (?, ?, ?, 1)
  `).run(userId, `${userId}@explore.local`, userId === 'guest' ? 'Guest User' : userId);

  db.prepare(`
    INSERT OR IGNORE INTO user_preference_profiles (
      id, user_id, profile_name, depth_pref, rarity_pref, length_pref, topics_avoid_json, topics_focus_json
    ) VALUES (?, ?, 'default', 0.55, 0.55, 0.5, '[]', ?)
  `).run(
    crypto.randomUUID(),
    userId,
    JSON.stringify(['AI', 'Jordan', 'neuroscience', 'research', 'scholarships']),
  );
}

function ensureDefaultHierarchy(db, userId) {
  const state = valueHierarchy.getState(db, userId);
  const needsSeed = !state?.storyHighestOrder && !state?.storyYours && !state?.currentGoal;
  if (!needsSeed) {
    return state;
  }
  return valueHierarchy.upsertState(db, userId, {
    storyHighestOrder: 'Seek truth, responsibility, and long-term human flourishing through serious learning.',
    storyYours: 'Build a life as a researcher/builder at the intersection of psychology, AI, and meaningful work.',
    storySubStories: 'Track Jordan security risks, frontier AI tools, cognitive science research, and funded study routes.',
    currentGoal: 'Stay informed on Jordan risks, frontier AI tools, and research/scholarship opportunities.',
    coreValues: ['truth', 'responsibility', 'competence', 'care'],
    appMode: 'average',
  });
}

function ensureSeedContent(db) {
  let inserted = 0;
  for (const item of SEED_CONTENT) {
    const existing = db.prepare('SELECT id FROM content_items WHERE id = ? OR external_id = ? LIMIT 1').get(item.id, item.external_id);
    if (existing) continue;
    try {
      db.prepare(`
        INSERT INTO content_items (
          id, external_id, title, url, summary, publish_date, topic_tags_json, content_type,
          trust_score, depth_score, rarity_score, channel_type, ingest_status, created_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
      `).run(
        item.id,
        item.external_id,
        item.title,
        item.url,
        item.summary,
        JSON.stringify(item.topic_tags || []),
        item.content_type || 'article',
        item.trust_score ?? 0.7,
        item.depth_score ?? 0.5,
        item.rarity_score ?? 0.5,
        item.official_source ? 'official' : 'article',
      );
      inserted += 1;
    } catch (error) {
      // Schema variants: try minimal insert
      try {
        db.prepare(`
          INSERT INTO content_items (id, external_id, title, url, summary, topic_tags_json, content_type)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id,
          item.external_id,
          item.title,
          item.url,
          item.summary,
          JSON.stringify(item.topic_tags || []),
          item.content_type || 'article',
        );
        inserted += 1;
      } catch (_) {
        // ignore seed failure for partial schemas
      }
    }
  }
  return inserted;
}

function ensureDefaultInterestsAndGoals(db, userId) {
  const defaults = [
    ['AI', 1.0],
    ['Jordan', 1.0],
    ['neuroscience', 0.9],
    ['research', 0.9],
    ['scholarships', 0.8],
  ];
  for (const [name, weight] of defaults) {
    try {
      db.prepare(`
        INSERT INTO user_interests (user_id, interest_name, weight, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, interest_name) DO NOTHING
      `).run(userId, name, weight);
    } catch (_) {}
  }

  const existingGoals = db.prepare(`SELECT COUNT(*) AS c FROM user_goals WHERE user_id = ? AND status = 'active'`).get(userId);
  if (!existingGoals || Number(existingGoals.c) === 0) {
    try {
      db.prepare(`
        INSERT INTO user_goals (id, user_id, goal_text, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, 'high', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        crypto.randomUUID(),
        userId,
        'Stay informed on Jordan risks, frontier AI tools, and research/scholarship opportunities.',
      );
    } catch (_) {}
  }
}

function bootstrapPersonalCycle(db, userId = 'guest') {
  ensureGuestUser(db, userId);
  intelligenceContract.ensureTables(db);
  intelligenceContract.ensureUserTheoryTables(db);
  eventClusteringService.ensureTables(db);
  topicService.ensureTables(db);
  recommenderCore.initializeBanditState(db);

  const hierarchy = ensureDefaultHierarchy(db, userId);
  ensureDefaultInterestsAndGoals(db, userId);
  const jordanTopic = topicService.ensureJordanIranTopic(db, userId);
  // Auto-approve top suggested sources for Jordan topic so monitoring is usable
  let approvedSources = 0;
  if (jordanTopic?.id) {
    const suggestions = topicService.suggestSources(db, userId, jordanTopic.id) || [];
    for (const source of suggestions.slice(0, 5)) {
      try {
        topicService.setSourceApproval(db, userId, jordanTopic.id, source.id, true, source.suggestion_reason || 'Cycle bootstrap approval', 'approved');
        approvedSources += 1;
      } catch (_) {}
    }
  }

  const contentCountBefore = db.prepare('SELECT COUNT(*) AS c FROM content_items').get()?.c || 0;
  const seeded = Number(contentCountBefore) < 3 ? ensureSeedContent(db) : 0;

  return {
    userId,
    hierarchy: {
      currentGoal: hierarchy.currentGoal || null,
      appMode: hierarchy.appMode || 'average',
      hasStoryLayers: Boolean(hierarchy.storyHighestOrder || hierarchy.storyYours || hierarchy.storySubStories),
    },
    topics: {
      jordanTopicId: jordanTopic?.id || null,
      approvedSources,
    },
    content: {
      seeded,
      total: db.prepare('SELECT COUNT(*) AS c FROM content_items').get()?.c || 0,
    },
  };
}

function clusterRecentContent(db, limit = 40) {
  const rows = db.prepare(`
    SELECT id, title, summary, url, publish_date, topic_tags_json, channel_type
    FROM content_items
    ORDER BY COALESCE(publish_date, created_at) DESC
    LIMIT ?
  `).all(limit);

  const clusters = eventClusteringService.clusterItems(db, rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.channel_type || null,
    publishedAt: row.publish_date,
  })));

  return {
    inputCount: rows.length,
    clusterCount: clusters.length,
    clusters: clusters.slice(0, 10),
  };
}

function rankAndExplain(db, userId, limit = 12) {
  const theory = intelligenceContract.getUserTheory(db, userId);
  const learningPaused = theory.status === 'paused';
  const hierarchy = valueHierarchy.getState(db, userId);
  const goals = db.prepare(`SELECT goal_text FROM user_goals WHERE user_id = ? AND status = 'active'`).all(userId);

  const recommendations = recommenderCore.getRecommendations(db, userId, { limit });
  const items = recommendations.map((rec) => {
    const explanation = intelligenceContract.buildExplanation({
      item: {
        ...rec,
        topics: (() => {
          try { return JSON.parse(rec.topic_tags_json || '[]'); } catch (_) { return []; }
        })(),
        sourceTrust: rec.trust_score,
        official_source: rec.official_source,
        publishedAt: rec.publish_date,
      },
      hierarchy,
      goals,
      ranking: rec,
      source: {
        name: rec.source_name || rec.source,
        url: rec.url,
        trust_tier: rec.trust_score ? Number(rec.trust_score) * 5 : null,
        role: rec.official_source ? 'official' : 'reported',
      },
    });

    try {
      intelligenceContract.persistExplanation(db, {
        userId,
        contentId: rec.id,
        explanation,
      });
    } catch (_) {}

    const analysis = intelligenceContract.buildFinalEventAnalysis({
      item: {
        id: rec.id,
        title: rec.title,
        summary: rec.summary,
        url: rec.url,
        publishedAt: rec.publish_date,
      },
      hierarchy,
      explanation,
      sources: rec.url ? [{ name: rec.source_name || 'Source', url: rec.url, relation: 'supporting' }] : [],
    });

    return {
      id: rec.id,
      title: rec.title,
      summary: rec.summary,
      url: rec.url,
      score: rec.combinedScore ?? rec.baselineScore ?? null,
      retrievalChannel: rec.retrievalChannel || null,
      intelligenceExplanation: explanation,
      finalAnalysis: {
        what_happened: analysis.what_happened,
        why_it_matters_to_user: analysis.why_it_matters_to_user,
        goal_served: analysis.goal_served,
        story_layer_served: analysis.story_layer_served,
        urgency: analysis.urgency,
        confidence: analysis.confidence,
        jordan_relevance: analysis.jordan_relevance,
        suggested_action: analysis.suggested_action,
      },
    };
  });

  return {
    learningPaused,
    theoryStatus: theory.status,
    itemCount: items.length,
    items,
  };
}

/**
 * Apply feedback into the theory layer (evidence + optional recompute markers).
 * Respects paused theory for automatic inference writes, but always records explicit corrections.
 */
function applyFeedbackToTheory(db, userId, {
  contentItemId = null,
  action = null,
  feedbackType = null,
  rating = null,
  reason = null,
  writtenCorrection = null,
} = {}) {
  intelligenceContract.ensureUserTheoryTables(db);
  const theory = intelligenceContract.getUserTheory(db, userId);
  const explicitType = feedbackType || action || 'feedback';
  const confidence = rating != null
    ? Math.max(0.4, Math.min(0.95, Number(rating) / 10))
    : /like|valuable|more_like|save/i.test(String(explicitType))
      ? 0.75
      : 0.6;

  // Explicit correction history always recorded through recommender path by caller.
  // Theory evidence records the "what changed" trail for inspectability.
  const evidenceId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO user_theory_evidence (id, user_id, evidence_type, subject, evidence_json, confidence, status, created_at, updated_at)
    VALUES (?, ?, 'explicit_feedback', ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    evidenceId,
    userId,
    contentItemId || 'unknown-content',
    JSON.stringify({
      action,
      feedback_type: feedbackType,
      rating,
      reason,
      written_correction: writtenCorrection || '',
      theory_was_paused: theory.status === 'paused',
      cycle: 'personal_intelligence',
    }),
    confidence,
  );

  return {
    evidenceId,
    theoryStatus: theory.status,
    learningApplied: theory.status !== 'paused',
  };
}

async function runPersonalIntelligenceCycle(db, userId = 'guest', options = {}) {
  const startedAt = new Date().toISOString();
  const bootstrap = bootstrapPersonalCycle(db, userId);

  // Optional external ingest; never fail the closed cycle if providers are offline.
  let external = { ran: false, ok: false, error: null };
  if (options.runExternal !== false) {
    try {
      const { runIntelligenceCycle } = require('./intelligenceCycleService');
      const summary = await runIntelligenceCycle(db, {
        loopMode: options.loopMode || 'personal-cycle',
        force: Boolean(options.force),
        alertLimit: Number(options.alertLimit || 20),
      });
      external = { ran: true, ok: true, summary };
    } catch (error) {
      external = { ran: true, ok: false, error: error?.message || String(error) };
      // Ensure seed content if external failed and catalog is empty
      ensureSeedContent(db);
    }
  } else {
    ensureSeedContent(db);
  }

  const clustering = clusterRecentContent(db, Number(options.clusterLimit || 50));
  const ranked = rankAndExplain(db, userId, Number(options.limit || 12));
  const theory = intelligenceContract.getUserTheory(db, userId);

  const completedAt = new Date().toISOString();
  const snapshot = {
    success: true,
    cycle: 'personal_intelligence_v1',
    startedAt,
    completedAt,
    bootstrap,
    external,
    clustering: {
      inputCount: clustering.inputCount,
      clusterCount: clustering.clusterCount,
    },
    ranking: {
      learningPaused: ranked.learningPaused,
      itemCount: ranked.itemCount,
    },
    theory: {
      status: theory.status,
      inferredInterestCount: (theory.inferred_interests || []).length,
      exclusionCount: (theory.exclusions || []).length,
      evidenceCount: (theory.evidence || []).length,
      correctionCount: (theory.correction_history || []).length,
      currentGoal: theory.story_layers?.current_goal || null,
    },
    items: ranked.items,
    loop: [
      'user_theory',
      'story_layers',
      'goals_topics',
      'sources',
      'content',
      'clustering',
      'ranking',
      'explanations',
      'ready_for_feedback',
    ],
  };

  // Persist last cycle summary on theory state notes for status endpoint
  try {
    db.prepare(`
      INSERT INTO user_theory_state (user_id, status, notes, updated_at)
      VALUES (?, COALESCE((SELECT status FROM user_theory_state WHERE user_id = ?), 'active'), ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, userId, JSON.stringify({
      last_cycle_at: completedAt,
      item_count: ranked.itemCount,
      cluster_count: clustering.clusterCount,
      external_ok: external.ok,
    }));
  } catch (_) {}

  return snapshot;
}

function getCycleStatus(db, userId = 'guest') {
  intelligenceContract.ensureUserTheoryTables(db);
  const theory = intelligenceContract.getUserTheory(db, userId);
  const contentCount = db.prepare('SELECT COUNT(*) AS c FROM content_items').get()?.c || 0;
  const topicCount = db.prepare(`
    SELECT COUNT(*) AS c FROM topics
    WHERE owner_user_id IS NULL OR owner_user_id = ?
  `).get(userId)?.c || 0;
  let clusterCount = 0;
  try {
    clusterCount = db.prepare('SELECT COUNT(*) AS c FROM event_clusters').get()?.c || 0;
  } catch (_) {}
  let lastCycle = null;
  try {
    const row = db.prepare('SELECT notes, updated_at FROM user_theory_state WHERE user_id = ?').get(userId);
    if (row?.notes) {
      lastCycle = JSON.parse(row.notes);
      lastCycle.updated_at = row.updated_at;
    }
  } catch (_) {}

  return {
    success: true,
    ready: Number(contentCount) > 0 && theory != null,
    theoryStatus: theory.status,
    contentCount: Number(contentCount),
    topicCount: Number(topicCount),
    clusterCount: Number(clusterCount),
    evidenceCount: (theory.evidence || []).length,
    correctionCount: (theory.correction_history || []).length,
    lastCycle,
    nextActions: [
      'POST /api/v1/intelligence/cycle/run',
      'Review items[].intelligenceExplanation',
      'POST /api/v1/intelligence/feedback',
      'POST /api/v1/intelligence/cycle/run again to see updated ranking',
    ],
  };
}

module.exports = {
  SEED_CONTENT,
  bootstrapPersonalCycle,
  runPersonalIntelligenceCycle,
  applyFeedbackToTheory,
  getCycleStatus,
  rankAndExplain,
  ensureSeedContent,
};
