'use strict';

const crypto = require('crypto');

const TOPIC_FIELDS = [
  ['owner_user_id', 'TEXT'],
  ['instruction', 'TEXT'],
  ['intended_outcome', 'TEXT'],
  ['included_concepts_json', "TEXT DEFAULT '[]'"],
  ['excluded_concepts_json', "TEXT DEFAULT '[]'"],
  ['entities_json', "TEXT DEFAULT '[]'"],
  ['locations_json', "TEXT DEFAULT '[]'"],
  ['languages_json', "TEXT DEFAULT '[\\\"en\\\"]'"],
  ['content_types_json', "TEXT DEFAULT '[\\\"written\\\",\\\"video\\\"]'"],
  ['importance_threshold', 'TEXT DEFAULT \'important\''],
  ['notification_policy_json', "TEXT DEFAULT '{}'"],
  ['search_queries_json', "TEXT DEFAULT '[]'"],
  ['source_discovery_queries_json', "TEXT DEFAULT '[]'"],
  ['linked_goals_json', "TEXT DEFAULT '[]'"],
  ['linked_story_layers_json', "TEXT DEFAULT '[]'"],
  ['coverage_status', "TEXT DEFAULT 'unavailable'"],
  ['last_sweep_at', 'DATETIME'],
  ['next_sweep_at', 'DATETIME'],
  ['updated_at', 'DATETIME'],
];

const SOURCE_CATALOG = [
  {
    key: 'openai-news', name: 'OpenAI News', url: 'https://openai.com/news/', platform: 'web', category: 'official_ai', trustTier: 1, role: 'official', keywords: ['ai', 'openai', 'model', 'frontier'],
  },
  {
    key: 'anthropic-news', name: 'Anthropic News', url: 'https://www.anthropic.com/news', platform: 'web', category: 'official_ai', trustTier: 1, role: 'official', keywords: ['ai', 'anthropic', 'claude', 'model'],
  },
  {
    key: 'google-ai-blog', name: 'Google AI Blog', url: 'https://blog.google/technology/ai/', platform: 'web', category: 'official_ai', trustTier: 1, role: 'official', keywords: ['ai', 'google', 'gemini', 'deepmind', 'model'],
  },
  {
    key: 'deepmind-blog', name: 'Google DeepMind', url: 'https://deepmind.google/discover/blog/', platform: 'web', category: 'official_ai', trustTier: 1, role: 'official', keywords: ['ai', 'deepmind', 'research', 'model'],
  },
  {
    key: 'meta-ai-blog', name: 'Meta AI Blog', url: 'https://ai.meta.com/blog/', platform: 'web', category: 'official_ai', trustTier: 1, role: 'official', keywords: ['ai', 'meta', 'llama', 'model'],
  },
  {
    key: 'jordan-moe', name: 'Jordan Ministry of Education', url: 'https://moe.gov.jo/', platform: 'web', category: 'official_jordan', trustTier: 1, role: 'official', keywords: ['jordan', 'education', 'scholarship', 'school'],
  },
  {
    key: 'jordan-times', name: 'The Jordan Times', url: 'https://www.jordantimes.com/', platform: 'web', category: 'jordan_reporting', trustTier: 2, role: 'independent_reporting', keywords: ['jordan', 'amman', 'regional', 'iran', 'conflict'],
  },
  {
    key: 'reuters-world', name: 'Reuters World', url: 'https://www.reuters.com/world/', platform: 'web', category: 'independent_reporting', trustTier: 2, role: 'independent_reporting', keywords: ['jordan', 'iran', 'conflict', 'regional', 'world'],
  },
  {
    key: 'nature-neuroscience', name: 'Nature Neuroscience', url: 'https://www.nature.com/neuroscience/', platform: 'web', category: 'research', trustTier: 1, role: 'specialist', keywords: ['neuroscience', 'memory', 'cognitive', 'research'],
  },
  {
    key: 'ninds', name: 'National Institute of Neurological Disorders and Stroke', url: 'https://www.ninds.nih.gov/', platform: 'web', category: 'official_research', trustTier: 1, role: 'official', keywords: ['neuroscience', 'memory', 'clinical', 'research'],
  },
  {
    key: 'nsf', name: 'U.S. National Science Foundation', url: 'https://www.nsf.gov/', platform: 'web', category: 'official_research', trustTier: 1, role: 'official', keywords: ['research', 'science', 'opportunity', 'scholarship'],
  },
];

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeList(value) {
  const entries = Array.isArray(value) ? value : parseJson(value, []);
  return [...new Set(entries.map((entry) => normalizeText(entry)).filter(Boolean))].slice(0, 50);
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `topic-${crypto.randomUUID().slice(0, 8)}`;
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

  TOPIC_FIELDS.forEach(([name, sqlType]) => ensureColumn(db, 'topics', name, sqlType));
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_instruction_versions (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_topic_instruction_versions_topic
      ON topic_instruction_versions (topic_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS topic_sources (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested',
      source_role TEXT,
      notes TEXT,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(topic_id, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_topic_sources_topic ON topic_sources (topic_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS source_checks (
      id TEXT PRIMARY KEY,
      topic_id TEXT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'never_checked',
      retrieval_method TEXT,
      last_checked_at DATETIME,
      last_success_at DATETIME,
      last_error TEXT,
      freshness_hours REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_source_checks_source ON source_checks (source_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS source_web_claims (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uncertain',
      event_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS source_web_evidence (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      source_id TEXT,
      relation TEXT NOT NULL DEFAULT 'supporting',
      url TEXT,
      excerpt TEXT,
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function topicPayload(input = {}) {
  const instruction = normalizeText(input.instruction || input.description || input.query || input.name);
  const name = normalizeText(input.name || instruction).slice(0, 160);
  return {
    name,
    slug: normalizeText(input.slug) || slugify(name),
    instruction,
    intendedOutcome: normalizeText(input.intended_outcome || input.intendedOutcome || ''),
    includedConcepts: normalizeList(input.included_concepts || input.includedConcepts),
    excludedConcepts: normalizeList(input.excluded_concepts || input.excludedConcepts),
    entities: normalizeList(input.entities),
    locations: normalizeList(input.locations),
    languages: normalizeList(input.languages || ['en']),
    contentTypes: normalizeList(input.content_types || input.contentTypes || ['written', 'video']),
    importanceThreshold: normalizeText(input.importance_threshold || input.importanceThreshold || 'important') || 'important',
    notificationPolicy: input.notification_policy || input.notificationPolicy || {},
    searchQueries: normalizeList(input.search_queries || input.searchQueries),
    sourceDiscoveryQueries: normalizeList(input.source_discovery_queries || input.sourceDiscoveryQueries),
    linkedGoals: normalizeList(input.linked_goals || input.linkedGoals),
    linkedStoryLayers: normalizeList(input.linked_story_layers || input.linkedStoryLayers),
  };
}

function topicRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id || null,
    name: row.name,
    slug: row.slug,
    instruction: row.instruction || row.name,
    intended_outcome: row.intended_outcome || '',
    included_concepts: parseJson(row.included_concepts_json, []),
    excluded_concepts: parseJson(row.excluded_concepts_json, []),
    entities: parseJson(row.entities_json, []),
    locations: parseJson(row.locations_json, []),
    languages: parseJson(row.languages_json, ['en']),
    content_types: parseJson(row.content_types_json, ['written', 'video']),
    importance_threshold: row.importance_threshold || 'important',
    notification_policy: parseJson(row.notification_policy_json, {}),
    search_queries: parseJson(row.search_queries_json, []),
    source_discovery_queries: parseJson(row.source_discovery_queries_json, []),
    linked_goals: parseJson(row.linked_goals_json, []),
    linked_story_layers: parseJson(row.linked_story_layers_json, []),
    coverage_status: row.coverage_status || 'unavailable',
    last_sweep_at: row.last_sweep_at || null,
    next_sweep_at: row.next_sweep_at || null,
    updated_at: row.updated_at || row.created_at || null,
  };
}

function shouldSuggest(source, instruction) {
  const text = normalizeText(instruction).toLowerCase();
  return source.keywords.some((keyword) => text.includes(keyword))
    || source.category === 'independent_reporting';
}

function getSourceSuggestions(instruction = '') {
  return SOURCE_CATALOG
    .filter((source) => shouldSuggest(source, instruction))
    .map(({ key, name, url, platform, category, trustTier, role }) => ({
      key,
      name,
      url,
      platform,
      category,
      trust_tier: trustTier,
      role,
      approval_status: 'suggested',
      suggestion_reason: role === 'official'
        ? 'Primary or official source for this monitoring lane.'
        : 'Independent or specialist coverage used to corroborate official claims.',
    }));
}

function upsertCatalogSource(db, source) {
  const existing = db.prepare('SELECT * FROM sources WHERE url = ? LIMIT 1').get(source.url);
  if (existing) return existing;
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sources (id, platform, name, url, trust_tier, category, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `).run(id, source.platform, source.name, source.url, source.trust_tier, source.category);
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

function getTopic(db, userId, topicId) {
  ensureTables(db);
  const row = db.prepare(`
    SELECT * FROM topics
    WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)
    LIMIT 1
  `).get(topicId, userId);
  const topic = topicRowToJson(row);
  if (!topic) return null;
  topic.suggested_sources = db.prepare(`
    SELECT ts.source_id AS id, ts.status, ts.source_role AS role, ts.notes,
      s.name, s.url, s.platform, s.category, s.trust_tier
    FROM topic_sources ts
    JOIN sources s ON s.id = ts.source_id
    WHERE ts.topic_id = ? AND ts.user_id = ?
    ORDER BY ts.status ASC, s.trust_tier ASC, s.name ASC
  `).all(topicId, userId).map((source) => ({
    ...source,
    approval_status: source.status,
    suggestion_reason: source.notes || '',
  }));
  return topic;
}

function listTopics(db, userId) {
  ensureTables(db);
  return db.prepare(`
    SELECT * FROM topics
    WHERE owner_user_id IS NULL OR owner_user_id = ?
    ORDER BY updated_at DESC, name ASC
  `).all(userId).map((row) => {
    const topic = topicRowToJson(row);
    topic.suggested_sources = db.prepare(`
      SELECT ts.source_id AS id, ts.status, ts.source_role AS role, ts.notes,
        s.name, s.url, s.platform, s.category, s.trust_tier
      FROM topic_sources ts
      JOIN sources s ON s.id = ts.source_id
      WHERE ts.topic_id = ? AND ts.user_id = ?
      ORDER BY ts.status ASC, s.trust_tier ASC, s.name ASC
    `).all(row.id, userId).map((source) => ({
      ...source,
      approval_status: source.status,
      suggestion_reason: source.notes || '',
    }));
    return topic;
  });
}

function createTopic(db, userId, input = {}) {
  ensureTables(db);
  const payload = topicPayload(input);
  if (!payload.name || !payload.instruction) {
    throw new Error('name or instruction is required');
  }
  const existing = db.prepare('SELECT * FROM topics WHERE slug = ? OR name = ? LIMIT 1').get(payload.slug, payload.name);
  if (existing && existing.owner_user_id && existing.owner_user_id !== userId) {
    throw new Error('A topic with this name already exists. Choose a different name.');
  }
  const id = existing?.id || crypto.randomUUID();
  db.prepare(`
    INSERT INTO topics (
      id, owner_user_id, name, slug, instruction, intended_outcome,
      included_concepts_json, excluded_concepts_json, entities_json, locations_json,
      languages_json, content_types_json, importance_threshold, notification_policy_json,
      search_queries_json, source_discovery_queries_json, linked_goals_json,
      linked_story_layers_json, coverage_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      instruction = excluded.instruction,
      intended_outcome = excluded.intended_outcome,
      included_concepts_json = excluded.included_concepts_json,
      excluded_concepts_json = excluded.excluded_concepts_json,
      entities_json = excluded.entities_json,
      locations_json = excluded.locations_json,
      languages_json = excluded.languages_json,
      content_types_json = excluded.content_types_json,
      importance_threshold = excluded.importance_threshold,
      notification_policy_json = excluded.notification_policy_json,
      search_queries_json = excluded.search_queries_json,
      source_discovery_queries_json = excluded.source_discovery_queries_json,
      linked_goals_json = excluded.linked_goals_json,
      linked_story_layers_json = excluded.linked_story_layers_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    id,
    userId,
    payload.name,
    payload.slug,
    payload.instruction,
    payload.intendedOutcome || null,
    JSON.stringify(payload.includedConcepts),
    JSON.stringify(payload.excludedConcepts),
    JSON.stringify(payload.entities),
    JSON.stringify(payload.locations),
    JSON.stringify(payload.languages),
    JSON.stringify(payload.contentTypes),
    payload.importanceThreshold,
    JSON.stringify(payload.notificationPolicy),
    JSON.stringify(payload.searchQueries.length ? payload.searchQueries : [payload.instruction]),
    JSON.stringify(payload.sourceDiscoveryQueries.length ? payload.sourceDiscoveryQueries : [payload.instruction]),
    JSON.stringify(payload.linkedGoals),
    JSON.stringify(payload.linkedStoryLayers),
  );
  db.prepare(`
    INSERT INTO topic_instruction_versions (id, topic_id, user_id, instruction, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), id, userId, payload.instruction, JSON.stringify(payload));
  return getTopic(db, userId, id);
}

function updateTopic(db, userId, topicId, input = {}) {
  const current = getTopic(db, userId, topicId);
  if (!current) return null;
  const next = topicPayload({ ...current, ...input, name: input.name || current.name });
  db.prepare(`
    UPDATE topics SET
      name = ?, instruction = ?, intended_outcome = ?, included_concepts_json = ?,
      excluded_concepts_json = ?, entities_json = ?, locations_json = ?, languages_json = ?,
      content_types_json = ?, importance_threshold = ?, notification_policy_json = ?,
      search_queries_json = ?, source_discovery_queries_json = ?, linked_goals_json = ?,
      linked_story_layers_json = ?, coverage_status = 'partial', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_user_id = ?
  `).run(
    next.name,
    next.instruction,
    next.intendedOutcome || null,
    JSON.stringify(next.includedConcepts),
    JSON.stringify(next.excludedConcepts),
    JSON.stringify(next.entities),
    JSON.stringify(next.locations),
    JSON.stringify(next.languages),
    JSON.stringify(next.contentTypes),
    next.importanceThreshold,
    JSON.stringify(next.notificationPolicy),
    JSON.stringify(next.searchQueries),
    JSON.stringify(next.sourceDiscoveryQueries),
    JSON.stringify(next.linkedGoals),
    JSON.stringify(next.linkedStoryLayers),
    topicId,
    userId,
  );
  if (next.instruction !== current.instruction) {
    db.prepare(`
      INSERT INTO topic_instruction_versions (id, topic_id, user_id, instruction, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), topicId, userId, next.instruction, JSON.stringify(next));
  }
  return getTopic(db, userId, topicId);
}

function suggestSources(db, userId, topicId) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const suggestions = getSourceSuggestions(`${topic.name} ${topic.instruction}`);
  const rows = suggestions.map((suggestion) => {
    const source = upsertCatalogSource(db, suggestion);
    db.prepare(`
      INSERT INTO topic_sources (id, topic_id, source_id, user_id, status, source_role, notes)
      VALUES (?, ?, ?, ?, 'suggested', ?, ?)
      ON CONFLICT(topic_id, source_id) DO UPDATE SET
        source_role = excluded.source_role,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      crypto.randomUUID(),
      topicId,
      source.id,
      userId,
      suggestion.role,
      suggestion.suggestion_reason,
    );
    return { ...suggestion, id: source.id };
  });
  return rows;
}

function setSourceApproval(db, userId, topicId, sourceId, approved, notes = '', statusOverride = null) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const source = db.prepare('SELECT * FROM sources WHERE id = ? LIMIT 1').get(sourceId);
  if (!source) return null;
  const normalizedOverride = normalizeText(statusOverride).toLowerCase();
  const status = ['approved', 'rejected', 'blocked', 'suggested'].includes(normalizedOverride)
    ? normalizedOverride
    : (approved ? 'approved' : 'rejected');
  db.prepare(`
    INSERT INTO topic_sources (id, topic_id, source_id, user_id, status, source_role, notes, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic_id, source_id) DO UPDATE SET
      status = excluded.status,
      notes = excluded.notes,
      approved_at = excluded.approved_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    topicId,
    sourceId,
    userId,
    status,
    source.category || 'source',
    normalizeText(notes),
    status === 'approved' ? new Date().toISOString() : null,
  );
  return { ...source, status, approval_status: status };
}

function getSourceWeb(db, userId, topicId) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const sources = db.prepare(`
    SELECT ts.*, s.name, s.url, s.platform, s.category, s.trust_tier, s.active,
      sc.status AS check_status, sc.last_checked_at, sc.last_success_at, sc.last_error, sc.freshness_hours
    FROM topic_sources ts
    JOIN sources s ON s.id = ts.source_id
    LEFT JOIN source_checks sc ON sc.source_id = ts.source_id AND (sc.topic_id = ts.topic_id OR sc.topic_id IS NULL)
    WHERE ts.topic_id = ? AND ts.user_id = ?
    ORDER BY ts.status ASC, s.trust_tier ASC, s.name ASC
  `).all(topicId, userId);
  const claims = db.prepare(`
    SELECT c.*, COUNT(e.id) AS evidence_count
    FROM source_web_claims c
    LEFT JOIN source_web_evidence e ON e.claim_id = c.id
    WHERE c.topic_id = ?
    GROUP BY c.id
    ORDER BY COALESCE(c.event_time, c.created_at) DESC
  `).all(topicId);
  const evidence = db.prepare(`
    SELECT e.*, s.name AS source_name, s.url AS source_url
    FROM source_web_evidence e
    LEFT JOIN sources s ON s.id = e.source_id
    JOIN source_web_claims c ON c.id = e.claim_id
    WHERE c.topic_id = ?
    ORDER BY e.created_at DESC
  `).all(topicId);
  const approved = sources.filter((row) => row.status === 'approved');
  const checked = approved.filter((row) => row.check_status === 'ok' || row.last_success_at);
  return {
    topic,
    sources,
    claims,
    evidence,
    coverage: {
      suggested: sources.filter((row) => row.status === 'suggested').length,
      approved: approved.length,
      rejected: sources.filter((row) => row.status === 'rejected').length,
      checked: checked.length,
      missing_evidence: approved.length === 0 ? ['Approve at least one source.'] : checked.length === 0 ? ['No approved source has a successful check yet.'] : [],
    },
  };
}

/**
 * High-priority monitored topic from the product plan (Part 9).
 * Idempotent: creates once, then returns existing.
 */
function ensureJordanIranTopic(db, userId = 'guest') {
  ensureTables(db);
  const instruction = 'Important developments affecting Jordan in relation to the Iran conflict and wider regional escalation. Prioritise material effects on Jordanian territory, airspace, border security, refugees, aviation, energy, infrastructure, diplomacy, and official Jordanian statements. Do not prioritise items merely because Jordan or Iran is mentioned.';
  const name = 'Jordan × Iran regional escalation';
  const slug = 'jordan-iran-regional-escalation';
  const existing = db.prepare('SELECT id FROM topics WHERE slug = ? OR name = ? LIMIT 1').get(slug, name);
  if (existing?.id) {
    return getTopic(db, userId, existing.id);
  }
  return createTopic(db, userId, {
    name,
    slug,
    instruction,
    intended_outcome: 'Alert only on material, credible, novel developments with consequence for Jordan.',
    included_concepts: [
      'Jordan', 'Jordanian airspace', 'missiles', 'drones', 'interceptions', 'debris',
      'border security', 'refugees', 'aviation', 'airport disruption', 'energy supply',
      'infrastructure', 'official Jordanian statements', 'regional escalation',
    ],
    excluded_concepts: ['generic Middle East commentary without Jordan effect', 'rumour without credible sources'],
    entities: ['Jordan', 'Iran', 'King Abdullah II', 'Royal Jordanian Air Force'],
    locations: ['Jordan', 'Amman', 'Aqaba', 'Syria border', 'Iraq border', 'Israel border'],
    languages: ['en', 'ar'],
    content_types: ['written', 'official', 'video'],
    importance_threshold: 'direct',
    notification_policy: { priority: 'direct', require_material_jordan_effect: true },
    search_queries: [
      'Jordan airspace interception',
      'Jordan drones missiles debris',
      'Jordan Iran conflict official statement',
      'Jordan airport disruption',
      'Jordan border security refugees',
    ],
    source_discovery_queries: [
      'Jordan official government news',
      'Jordan Times regional security',
      'Reuters Jordan Iran',
    ],
    linked_story_layers: ['current_sub_stories', 'highest_order'],
    linked_goals: ['Stay informed on risks affecting Jordan'],
  });
}

module.exports = {
  ensureTables,
  getTopic,
  listTopics,
  createTopic,
  updateTopic,
  suggestSources,
  setSourceApproval,
  getSourceWeb,
  getSourceSuggestions,
  ensureJordanIranTopic,
  topicRowToJson,
  __test__: { slugify, topicPayload, shouldSuggest },
};
