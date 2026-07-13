'use strict';

const crypto = require('crypto');
const valueHierarchy = require('./valueHierarchySync');

const EXPLANATION_SCHEMA_VERSION = '1.0';

function clamp(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function parseList(value) {
  const parsed = Array.isArray(value) ? value : parseJson(value, []);
  return Array.isArray(parsed)
    ? [...new Set(parsed.map((entry) => normalizeText(entry)).filter(Boolean))]
    : [];
}

function tokens(value) {
  return [...new Set(normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 || token === 'ai'))];
}

function overlap(left, right) {
  const rightTokens = new Set(tokens(right));
  const matched = tokens(left).filter((token) => rightTokens.has(token));
  return {
    score: matched.length ? matched.length / Math.max(tokens(left).length, tokens(right).length) : 0,
    matched,
  };
}

function ensureColumn(db, table, column, sqlType) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`).run();
  } catch (error) {
    if (!/duplicate column|already exists/i.test(String(error.message || ''))) {
      throw error;
    }
  }
}

function ensureTables(db) {
  if (!db) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendation_reasons (
      id TEXT PRIMARY KEY,
      content_id TEXT,
      user_id TEXT,
      reason_type TEXT NOT NULL,
      reason_text TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn(db, 'recommendation_reasons', 'payload_json', 'TEXT');
  ensureColumn(db, 'recommendation_reasons', 'story_layer_id', 'TEXT');
  ensureColumn(db, 'recommendation_reasons', 'topic_refs_json', 'TEXT DEFAULT \'[]\'');
  ensureColumn(db, 'recommendation_reasons', 'source_refs_json', 'TEXT DEFAULT \'[]\'');
  ensureColumn(db, 'recommendation_reasons', 'why_now', 'TEXT');
  ensureColumn(db, 'recommendation_reasons', 'confidence', 'REAL');
  ensureColumn(db, 'recommendation_reasons', 'action_json', 'TEXT');
  ensureColumn(db, 'recommendation_reasons', 'updated_at', 'DATETIME');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_theory_evidence (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_user_theory_evidence_user
      ON user_theory_evidence (user_id, status, updated_at DESC);
  `);
}

function buildExplanation({
  item = {},
  hierarchy = {},
  workspaceMemory = {},
  goals = [],
  topic = null,
  source = null,
  ranking = {},
} = {}) {
  const contentText = normalizeText([
    item.title,
    item.summary,
    item.description,
    item.reason,
    item.source,
    item.topic,
    item.topics,
    item.topic_tags,
  ].flat().join(' '));
  const storyAlignment = valueHierarchy.summarizeStoryLayerAlignment(hierarchy, contentText);
  const itemTopics = parseList(item.topics || item.topic_tags || item.topic_tags_json);
  const preferredTopics = [
    ...parseList(workspaceMemory.priorityTopics),
    ...parseList(workspaceMemory.trackedTopics),
  ];
  const matchedTopics = [...new Set([
    ...itemTopics.filter((itemTopic) => preferredTopics.some((preferred) => overlap(itemTopic, preferred).score > 0)),
    ...(topic?.name ? [topic.name] : []),
    ...preferredTopics.filter((preferred) => overlap(contentText, preferred).score > 0),
  ])].slice(0, 8);
  const normalizedGoals = (Array.isArray(goals) ? goals : [])
    .map((goal) => normalizeText(goal?.goal_text || goal?.text || goal))
    .filter(Boolean);
  if (hierarchy.currentGoal && !normalizedGoals.includes(hierarchy.currentGoal)) {
    normalizedGoals.unshift(hierarchy.currentGoal);
  }
  const matchedGoals = normalizedGoals.filter((goal) => overlap(contentText, goal).score > 0).slice(0, 5);

  const rawTrustScore = item.sourceTrust
    ?? item.source_trust
    ?? item.scores?.sourceTrust;
  const trustScore = clamp(
    rawTrustScore !== undefined && rawTrustScore !== null
      ? rawTrustScore
      : source?.trust_tier
        ? Number(source.trust_tier) / 5
        : 0.5,
    0.5,
  );
  const freshnessScore = clamp(item.scores?.freshness ?? ranking.freshness ?? 0.5, 0.5);
  const relevanceScore = clamp(
    item.goalAlignment
      ?? item.goal_alignment
      ?? ranking.goalAlignment
      ?? ranking.personalFit
      ?? 0.5,
    0.5,
  );
  const storyScore = clamp(storyAlignment.alignmentScore, 0);
  const overallScore = clamp(
    item.ranking?.total ? Number(item.ranking.total) / 200 : item.scores?.relevance ?? ranking.templateScore ?? 0.5,
    0.5,
  );

  const publishedAt = item.publishedAt || item.publish_date || item.date || item.published_at || null;
  const publishedTime = publishedAt ? new Date(publishedAt).getTime() : NaN;
  const ageHours = Number.isFinite(publishedTime)
    ? Math.max(0, (Date.now() - publishedTime) / 3600000)
    : null;
  const freshnessLabel = ageHours === null
    ? 'Timing unavailable'
    : ageHours <= 24
      ? 'Fresh in the last day'
      : ageHours <= 72
        ? 'Recent in the last three days'
        : 'Older or evergreen';
  const sourceName = normalizeText(source?.name || item.source || item.publisher || 'Source not identified');
  const sourceUrl = normalizeText(source?.url || item.url || '');
  const sourceTrustLabel = trustScore >= 0.8 ? 'high-trust source' : trustScore >= 0.55 ? 'moderate-trust source' : 'source trust needs review';
  const bestLayer = storyAlignment.bestLayer;
  const whyShown = matchedGoals.length
    ? `Shown because it connects with ${matchedGoals[0]}.`
    : matchedTopics.length
      ? `Shown because it matches ${matchedTopics.slice(0, 2).join(' and ')}.`
      : bestLayer
        ? `Shown because it aligns with your ${bestLayer.label.toLowerCase()}.`
        : 'Shown as a high-signal item from the active feed rules.';
  const whyNow = ageHours !== null && ageHours <= 72
    ? `${freshnessLabel}; the current ranking gives freshness a meaningful weight.`
    : 'It remains visible because its relevance or lasting value offsets its age.';
  const sourceRole = source?.role || (item.official_source ? 'official' : 'reported');
  const whyTrusted = sourceRole === 'official' || item.official_source
    ? `Trusted as an official or primary source (${sourceName}).`
    : trustScore >= 0.8
      ? `Trusted because ${sourceName} is treated as a high-trust source.`
      : trustScore >= 0.55
        ? `Provisionally trusted as moderate-quality reporting from ${sourceName}.`
        : `Trust is limited for ${sourceName}; corroboration is recommended.`;
  const actionabilityScore = clamp(item.scores?.decisionUsefulness ?? item.decisionUsefulness ?? 0.5, 0.5);
  const confidence = Number(clamp(
    (trustScore * 0.3) + (freshnessScore * 0.15) + (relevanceScore * 0.25) + (Math.max(storyScore, 0.35) * 0.15) + (overallScore * 0.15),
    0.35,
  ).toFixed(3));

  const chips = [];
  if (bestLayer?.label) chips.push({ id: bestLayer.id || 'story', label: bestLayer.label, kind: 'story_layer' });
  if (matchedGoals[0]) chips.push({ id: 'current-goal', label: 'Current Goal', kind: 'goal' });
  if (sourceRole === 'official' || item.official_source) chips.push({ id: 'official', label: 'Official Source', kind: 'trust' });
  else if (trustScore >= 0.55) chips.push({ id: 'trusted', label: 'Trusted Source', kind: 'trust' });
  if (ageHours !== null && ageHours <= 72) chips.push({ id: 'fresh', label: 'Fresh', kind: 'freshness' });
  if (actionabilityScore >= 0.65) chips.push({ id: 'actionable', label: 'Actionable', kind: 'action' });
  if (confidence >= 0.7) chips.push({ id: 'high-confidence', label: 'High Confidence', kind: 'confidence' });
  else if (confidence < 0.45) chips.push({ id: 'needs-verification', label: 'Needs Verification', kind: 'confidence' });
  for (const topicName of matchedTopics.slice(0, 2)) {
    chips.push({ id: `topic-${topicName}`, label: topicName, kind: 'topic' });
  }

  return {
    schema_version: EXPLANATION_SCHEMA_VERSION,
    why_shown: whyShown,
    why_now: whyNow,
    why_trusted: whyTrusted,
    story_layer: bestLayer
      ? {
          id: bestLayer.id,
          label: bestLayer.label,
          score: bestLayer.score,
          alignment_band: bestLayer.alignmentBand,
          matched_terms: bestLayer.matchedTerms || [],
        }
      : { id: null, label: 'Not configured', score: 0, alignment_band: 'none', matched_terms: [] },
    story_layers: storyAlignment.layers || [],
    topics: matchedTopics.map((name) => ({ name, matched: true })),
    goals: matchedGoals.map((text) => ({ text, matched: true })),
    source: {
      name: sourceName,
      url: sourceUrl || null,
      trust_score: Number(trustScore.toFixed(3)),
      trust_label: sourceTrustLabel,
      role: sourceRole,
    },
    freshness: {
      published_at: publishedAt,
      age_hours: ageHours === null ? null : Number(ageHours.toFixed(1)),
      label: freshnessLabel,
    },
    scores: {
      overall: Number(overallScore.toFixed(3)),
      source_trust: Number(trustScore.toFixed(3)),
      freshness: Number(freshnessScore.toFixed(3)),
      personal_relevance: Number(relevanceScore.toFixed(3)),
      story_alignment: Number(storyScore.toFixed(3)),
      actionability: Number(actionabilityScore.toFixed(3)),
    },
    confidence,
    chips,
    action: sourceUrl ? { label: 'Open source', url: sourceUrl } : null,
    evidence: {
      source_ids: source?.id ? [source.id] : [],
      item_id: item.id || null,
      ranking_reason: normalizeText(item.reason || ranking.reason || ''),
      provider: item.analysis_provider || item.analysisProvider || 'deterministic',
    },
  };
}

function persistExplanation(db, { userId = 'guest', contentId, explanation } = {}) {
  if (!db || !contentId || !explanation) {
    return null;
  }

  ensureTables(db);
  const id = crypto.randomUUID();
  const storyLayerId = explanation.story_layer?.id || null;
  const topicRefs = Array.isArray(explanation.topics) ? explanation.topics.map((entry) => entry.name) : [];
  const sourceRefs = explanation.source?.url ? [explanation.source.url] : [];
  db.prepare(`
    INSERT INTO recommendation_reasons (
      id, content_id, user_id, reason_type, reason_text, score, payload_json,
      story_layer_id, topic_refs_json, source_refs_json, why_now, confidence,
      action_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'intelligence_explanation', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    id,
    contentId,
    userId,
    explanation.why_shown,
    explanation.scores?.overall || 0,
    JSON.stringify(explanation),
    storyLayerId,
    JSON.stringify(topicRefs),
    JSON.stringify(sourceRefs),
    explanation.why_now || null,
    explanation.confidence || null,
    JSON.stringify(explanation.action || null),
  );
  return id;
}

function getPersistedExplanation(db, { userId = 'guest', recommendationId = '' } = {}) {
  if (!db || !recommendationId) {
    return null;
  }

  ensureTables(db);
  const row = db.prepare(`
    SELECT *
    FROM recommendation_reasons
    WHERE user_id = ?
      AND (id = ? OR content_id = ?)
      AND reason_type = 'intelligence_explanation'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(userId, recommendationId, recommendationId);

  return row ? parseJson(row.payload_json, null) : null;
}

/**
 * Jordan-focused relevance block for regional monitoring (plan Part 9).
 */
function buildJordanRelevance(item = {}, analysis = {}) {
  const text = normalizeText([
    item.title,
    item.summary,
    item.description,
    analysis.what_happened,
    analysis.why_it_matters,
  ].join(' ')).toLowerCase();

  const jordanHits = [
    'jordan', 'amman', 'jordanian', 'aqaba', 'irbid', 'zarqa', 'mafraq',
    'king abdullah', 'rjaf', 'queen alia',
  ].filter((token) => text.includes(token));
  const regionalHits = [
    'iran', 'missile', 'drone', 'interception', 'debris', 'airspace', 'border',
    'refugee', 'escalation', 'sanctions', 'shipping', 'fuel', 'airport',
  ].filter((token) => text.includes(token));

  const direct = jordanHits.length > 0;
  const indirect = !direct && regionalHits.length > 0;
  const material = direct || (indirect && regionalHits.length >= 2);
  const confidence = material
    ? clamp(0.45 + (jordanHits.length * 0.12) + (regionalHits.length * 0.05), 0.95)
    : 0.2;

  return {
    material_to_jordan: material,
    effect_type: direct ? 'direct' : indirect ? 'indirect' : 'none',
    security_implications: regionalHits.some((t) => /missile|drone|interception|airspace|border|escalation/.test(t))
      ? 'Possible security or airspace implications for Jordan or nearby corridors.'
      : 'No clear security implication identified from available text.',
    economic_implications: regionalHits.some((t) => /sanction|shipping|fuel|trade|energy/.test(t))
      ? 'Possible economic, energy, trade, or supply-chain spillover.'
      : 'No clear economic spillover identified from available text.',
    travel_implications: regionalHits.some((t) => /airport|aviation|travel|tourism/.test(t)) || text.includes('airport')
      ? 'Possible travel or aviation disruption risk.'
      : 'No clear travel disruption identified from available text.',
    aviation_implications: regionalHits.some((t) => /airspace|airport|aviation|drone|missile/.test(t))
      ? 'Monitor airspace and aviation advisories.'
      : 'No aviation signal identified.',
    confidence: Number(confidence.toFixed(3)),
    immediate_action_required: material && confidence >= 0.7,
    monitor_next: material
      ? ['Official Jordanian statements', 'Airspace/airport advisories', 'Credible multi-source corroboration']
      : ['Watch for Jordan-specific official statements'],
    matched_terms: [...jordanHits, ...regionalHits].slice(0, 12),
  };
}

/**
 * Canonical 22-field final event analysis (plan Part 8).
 * Deterministic scaffold; AI may fill fields later without inventing sources.
 */
function buildFinalEventAnalysis({
  item = {},
  hierarchy = {},
  explanation = null,
  sources = [],
  claims = [],
  contradictions = [],
  corrections = [],
  updateHistory = [],
} = {}) {
  const baseExplanation = explanation || buildExplanation({ item, hierarchy });
  const supporting = (Array.isArray(sources) ? sources : [])
    .filter((source) => (source.relation || 'supporting') === 'supporting')
    .map((source) => ({
      name: source.name || source.source_name || null,
      url: source.url || null,
      role: source.role || source.relation || 'supporting',
    }));
  const contradicting = (Array.isArray(contradictions) ? contradictions : sources.filter((s) => s.relation === 'contradicting'))
    .map((source) => ({
      name: source.name || source.source_name || null,
      url: source.url || null,
      role: 'contradicting',
    }));
  const eventTime = item.event_time || item.eventTime || null;
  const publishedAt = item.publishedAt || item.publish_date || item.published_at || item.date || null;
  const jordan = buildJordanRelevance(item, {
    what_happened: item.title,
    why_it_matters: baseExplanation.why_shown,
  });

  return {
    schema_version: 'final-event-analysis-1.0',
    what_happened: normalizeText(item.title || item.summary || 'Event description unavailable.'),
    event_time: eventTime,
    publication_time: publishedAt,
    confirmed: Array.isArray(claims)
      ? claims.filter((claim) => /confirm|official|verified/i.test(String(claim.status || claim.claim_text || claim))).slice(0, 8)
      : [],
    who_confirms: supporting.slice(0, 8),
    claimed: Array.isArray(claims)
      ? claims.filter((claim) => !/confirm|official|verified/i.test(String(claim.status || ''))).slice(0, 8)
      : [],
    not_independently_verified: contradicting.length
      ? 'Some claims lack multi-source independent verification.'
      : 'Independent verification status is incomplete without additional sources.',
    remains_unknown: 'Missing corroboration, exact casualty/impact figures, or official confirmation may still be unknown.',
    why_it_matters: baseExplanation.why_shown,
    why_it_matters_to_user: baseExplanation.goals?.[0]
      ? `Connected to your goal: ${baseExplanation.goals[0].text}`
      : baseExplanation.story_layer?.label
        ? `Connected to your ${baseExplanation.story_layer.label}.`
        : 'Relevance is based on active feed rules and source quality.',
    goal_served: baseExplanation.goals?.[0]?.text || hierarchy.currentGoal || null,
    story_layer_served: baseExplanation.story_layer || null,
    what_changed: baseExplanation.why_now,
    urgency: jordan.immediate_action_required ? 'high' : (baseExplanation.freshness?.age_hours != null && baseExplanation.freshness.age_hours <= 24 ? 'elevated' : 'normal'),
    confidence: baseExplanation.confidence,
    possible_next_developments: jordan.monitor_next || [],
    signals_to_watch: jordan.monitor_next || [],
    suggested_action: baseExplanation.action?.label || 'Review sources and decide whether to monitor, save, or dismiss.',
    supporting_sources: supporting,
    contradicting_evidence: contradicting,
    corrections: Array.isArray(corrections) ? corrections : [],
    update_history: Array.isArray(updateHistory) ? updateHistory : [],
    explanation: baseExplanation,
    jordan_relevance: jordan,
  };
}

function ensureUserTheoryTables(db) {
  if (!db) return;
  ensureTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_theory_state (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      paused_at DATETIME,
      reset_at DATETIME,
      last_export_at DATETIME,
      notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getUserTheory(db, userId = 'guest') {
  ensureUserTheoryTables(db);
  const hierarchy = valueHierarchy.getState(db, userId);
  const profile = db.prepare(`
    SELECT * FROM user_preference_profiles
    WHERE user_id = ? AND profile_name = 'default'
    LIMIT 1
  `).get(userId) || {};
  const state = db.prepare('SELECT * FROM user_theory_state WHERE user_id = ?').get(userId) || {
    user_id: userId,
    status: 'active',
  };

  let interests = [];
  try {
    interests = db.prepare('SELECT interest_name AS name, weight, updated_at FROM user_interests WHERE user_id = ?').all(userId);
  } catch (_) { interests = []; }

  let goals = [];
  try {
    goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  } catch (_) { goals = []; }

  let corrections = [];
  try {
    corrections = db.prepare(`
      SELECT * FROM user_corrections_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(userId);
  } catch (_) { corrections = []; }

  let evidence = [];
  try {
    evidence = db.prepare(`
      SELECT * FROM user_theory_evidence
      WHERE user_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 50
    `).all(userId);
  } catch (_) { evidence = []; }

  let multipliers = [];
  try {
    multipliers = db.prepare(`
      SELECT * FROM user_topic_multipliers
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 50
    `).all(userId);
  } catch (_) { multipliers = []; }

  const inferredInterests = parseList(profile.topics_focus_json).map((name) => ({
    name,
    kind: 'inferred_interest',
    confidence: 0.55,
    evidence_count: evidence.filter((row) => String(row.subject || '').includes(name)).length,
  }));
  const exclusions = parseList(profile.topics_avoid_json).map((name) => ({
    name,
    kind: 'explicit_exclusion',
    confidence: 0.8,
  }));

  return {
    user_id: userId,
    status: state.status || 'active',
    paused_at: state.paused_at || null,
    reset_at: state.reset_at || null,
    last_updated: state.updated_at || profile.updated_at || hierarchy.updatedAt || null,
    story_layers: {
      highest_order: hierarchy.storyHighestOrder || hierarchy.lifeNarrative || '',
      yours: hierarchy.storyYours || hierarchy.futureWish || '',
      sub_stories: hierarchy.storySubStories || hierarchy.currentGoal || '',
      current_goal: hierarchy.currentGoal || '',
      core_values: hierarchy.coreValues || [],
      app_mode: hierarchy.appMode || 'average',
    },
    preferences: {
      depth: profile.depth_pref ?? 0.5,
      rarity: profile.rarity_pref ?? 0.5,
      length: profile.length_pref ?? 0.5,
    },
    explicit_interests: interests,
    inferred_interests: inferredInterests,
    exclusions,
    goals,
    evidence: evidence.map((row) => ({
      id: row.id,
      type: row.evidence_type,
      subject: row.subject,
      confidence: row.confidence,
      payload: parseJson(row.evidence_json, {}),
      updated_at: row.updated_at || row.created_at,
    })),
    correction_history: corrections,
    topic_multipliers: multipliers,
    controls: {
      can_edit: true,
      can_pause: true,
      can_reset: true,
      can_export: true,
      can_delete_inferred: true,
    },
  };
}

function setUserTheoryStatus(db, userId, status) {
  ensureUserTheoryTables(db);
  const pausedAt = status === 'paused' ? new Date().toISOString() : null;
  db.prepare(`
    INSERT INTO user_theory_state (user_id, status, paused_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      status = excluded.status,
      paused_at = excluded.paused_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, status, pausedAt);
  return getUserTheory(db, userId);
}

function resetUserTheory(db, userId) {
  ensureUserTheoryTables(db);
  try {
    db.prepare('DELETE FROM user_topic_multipliers WHERE user_id = ?').run(userId);
  } catch (_) {}
  try {
    db.prepare('DELETE FROM user_corrections_history WHERE user_id = ?').run(userId);
  } catch (_) {}
  try {
    db.prepare(`UPDATE user_theory_evidence SET status = 'reset', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(userId);
  } catch (_) {}
  try {
    db.prepare(`
      UPDATE user_preference_profiles
      SET topics_focus_json = '[]', topics_avoid_json = '[]', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND profile_name = 'default'
    `).run(userId);
  } catch (_) {}
  db.prepare(`
    INSERT INTO user_theory_state (user_id, status, reset_at, paused_at, updated_at)
    VALUES (?, 'active', CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'active',
      reset_at = CURRENT_TIMESTAMP,
      paused_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId);
  return getUserTheory(db, userId);
}

function exportUserTheory(db, userId) {
  const theory = getUserTheory(db, userId);
  ensureUserTheoryTables(db);
  db.prepare(`
    INSERT INTO user_theory_state (user_id, status, last_export_at, updated_at)
    VALUES (?, COALESCE((SELECT status FROM user_theory_state WHERE user_id = ?), 'active'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      last_export_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, userId);
  return {
    exported_at: new Date().toISOString(),
    schema_version: 'user-theory-export-1.0',
    theory,
  };
}

module.exports = {
  EXPLANATION_SCHEMA_VERSION,
  ensureTables,
  ensureUserTheoryTables,
  buildExplanation,
  buildJordanRelevance,
  buildFinalEventAnalysis,
  persistExplanation,
  getPersistedExplanation,
  getUserTheory,
  setUserTheoryStatus,
  resetUserTheory,
  exportUserTheory,
  __test__: { clamp, overlap, parseList },
};
