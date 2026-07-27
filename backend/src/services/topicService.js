'use strict';

const crypto = require('crypto');
const aiService = require('../../services/aiService');

const MAX_TOPIC_EVENT_AGE_HOURS = 72;
const MAX_SOURCE_SUGGESTIONS = 20;
const TOPIC_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'could', 'from',
  'have', 'into', 'most', 'only', 'other', 'should', 'their', 'there', 'these',
  'they', 'this', 'those', 'through', 'very', 'what', 'when', 'where', 'which',
  'while', 'with', 'would', 'watch', 'important', 'monitor', 'news', 'topic',
]);

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
  } catch {
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
    CREATE TABLE IF NOT EXISTS topic_research_runs (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      provider TEXT,
      model TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_topic_research_runs_topic
      ON topic_research_runs (topic_id, user_id, created_at DESC);
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

function normalizePublicUrl(value) {
  const raw = normalizeText(value);
  if (!raw) {
    throw new Error('A source URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Enter a complete http or https source URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https source URLs are supported.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1'
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private or local source URLs cannot be monitored.');
  }

  parsed.hash = '';
  return parsed.toString();
}

function sourceNameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function topicTerms(topic) {
  const source = [
    topic?.name,
    topic?.instruction,
    topic?.intended_outcome,
    ...(topic?.included_concepts || []),
    ...(topic?.entities || []),
    ...(topic?.locations || []),
    ...(topic?.search_queries || []),
  ].join(' ').toLowerCase();

  return [...new Set(
    source
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !TOPIC_STOP_WORDS.has(term)),
  )].slice(0, 60);
}

function scoreTopicItem(topic, item, approvedSourceIds) {
  const title = normalizeText(item.title).toLowerCase();
  const body = normalizeText([
    item.summary,
    item.article_body,
    item.transcript,
    item.topic_tags_json,
  ].join(' ')).toLowerCase();
  const excluded = (topic.excluded_concepts || [])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  if (excluded.some((entry) => title.includes(entry) || body.includes(entry))) {
    return null;
  }

  const terms = topicTerms(topic);
  const titleMatches = terms.filter((term) => title.includes(term));
  const bodyMatches = terms.filter((term) => !titleMatches.includes(term) && body.includes(term));
  const approvedBoost = approvedSourceIds.has(item.source_id) ? 18 : 0;
  const trust = Number(item.trust_score || 0) * 12;
  const lifeImpact = Number(item.life_impact || 0) * 10;
  const usefulness = Number(item.decision_usefulness || 0) * 12;
  const depth = Number(item.depth_score || 0) * 8;
  const score = (titleMatches.length * 14)
    + (bodyMatches.length * 4)
    + approvedBoost
    + trust
    + lifeImpact
    + usefulness
    + depth;

  if (score < 8) return null;
  return {
    score: Number(score.toFixed(1)),
    matched_terms: [...titleMatches, ...bodyMatches].slice(0, 8),
    approved_source: approvedBoost > 0,
  };
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

function saveSuggestedSource(db, userId, topicId, input = {}) {
  const url = normalizePublicUrl(input.url);
  const source = upsertCatalogSource(db, {
    platform: normalizeText(input.platform || 'web') || 'web',
    name: normalizeText(input.name || sourceNameFromUrl(url)).slice(0, 160),
    url,
    trust_tier: clampInteger(input.trust_tier ?? input.trustTier, 1, 4, 3),
    category: normalizeText(input.category || 'topic_source') || 'topic_source',
  });
  const status = ['approved', 'suggested'].includes(normalizeText(input.status).toLowerCase())
    ? normalizeText(input.status).toLowerCase()
    : 'suggested';
  const role = normalizeText(input.role || input.source_role || source.category || 'source').slice(0, 80);
  const notes = normalizeText(input.reason || input.notes || '').slice(0, 600);

  db.prepare(`
    INSERT INTO topic_sources (
      id, topic_id, source_id, user_id, status, source_role, notes, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic_id, source_id) DO UPDATE SET
      status = CASE
        WHEN topic_sources.status = 'approved' THEN topic_sources.status
        ELSE excluded.status
      END,
      source_role = excluded.source_role,
      notes = excluded.notes,
      approved_at = CASE
        WHEN topic_sources.status = 'approved' THEN topic_sources.approved_at
        ELSE excluded.approved_at
      END,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    topicId,
    source.id,
    userId,
    status,
    role,
    notes,
    status === 'approved' ? new Date().toISOString() : null,
  );

  return {
    ...source,
    status,
    approval_status: status,
    role,
    suggestion_reason: notes,
  };
}

function addTopicSource(db, userId, topicId, input = {}) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  return saveSuggestedSource(db, userId, topicId, {
    ...input,
    status: input.approved === true ? 'approved' : (input.status || 'suggested'),
    reason: input.reason || input.notes || 'Added manually for this topic.',
  });
}

function removeTopicSource(db, userId, topicId, sourceId) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return false;
  const result = db.prepare(`
    DELETE FROM topic_sources
    WHERE topic_id = ? AND source_id = ? AND user_id = ?
  `).run(topicId, sourceId, userId);
  return Number(result.changes || 0) > 0;
}

async function discoverSourcesWithAi(db, userId, topicId, options = {}) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const deterministic = suggestSources(db, userId, topicId) || [];
  const limit = clampInteger(options.limit, 4, MAX_SOURCE_SUGGESTIONS, 12);
  const existing = topic.suggested_sources || [];

  const systemPrompt = [
    'You build a high-trust monitoring map for eXplore.',
    'Return only valid JSON shaped as {"sources":[...]} with at most the requested number of sources.',
    'Each source must contain name, url, role, category, trust_tier, and reason.',
    'Prefer official primary sources, then strong independent corroboration, then specialist sources.',
    'Use canonical public http/https URLs. Do not invent a URL when you are uncertain.',
    'Do not include social search pages, generic homepages with no relevance, duplicates, localhost, or private networks.',
  ].join(' ');
  const userPrompt = JSON.stringify({
    task: 'Suggest valuable source connections for this monitored topic.',
    limit,
    topic: {
      name: topic.name,
      instruction: topic.instruction,
      intended_outcome: topic.intended_outcome,
      entities: topic.entities,
      locations: topic.locations,
      languages: topic.languages,
      search_queries: topic.search_queries,
    },
    already_known_urls: existing.map((source) => source.url).filter(Boolean),
  });

  let generated = [];
  let aiError = '';
  try {
    const result = await aiService.generateStructuredJson({
      systemPrompt,
      userPrompt,
      providerPreference: 'auto',
      temperature: 0.1,
      maxKeyAttempts: 4,
    });
    generated = Array.isArray(result?.sources) ? result.sources : [];
  } catch (error) {
    aiError = aiService.__test__?.sanitizeAiErrorMessage
      ? aiService.__test__.sanitizeAiErrorMessage(error)
      : normalizeText(error?.message || 'AI source discovery failed.');
  }

  const saved = [];
  const seenUrls = new Set(existing.map((source) => source.url).filter(Boolean));
  for (const candidate of generated.slice(0, limit)) {
    try {
      const url = normalizePublicUrl(candidate?.url);
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      saved.push(saveSuggestedSource(db, userId, topicId, {
        ...candidate,
        url,
        status: 'suggested',
        reason: `AI candidate - ${normalizeText(candidate?.reason || 'Potentially valuable connection.')} Verify before approval.`,
      }));
    } catch {
      // Invalid or private candidates are discarded rather than surfaced.
    }
  }

  return {
    suggestions: [...saved, ...deterministic]
      .filter((source, index, rows) => rows.findIndex((entry) => entry.url === source.url) === index)
      .slice(0, MAX_SOURCE_SUGGESTIONS),
    generated_count: saved.length,
    fallback_used: saved.length === 0,
    error: aiError,
    model_pool: aiService.getSafeModelPoolDiagnostics(),
  };
}

function getTopicEvents(db, userId, topicId, options = {}) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const limit = clampInteger(options.limit, 1, 50, 20);
  const ageHours = clampInteger(options.ageHours, 1, MAX_TOPIC_EVENT_AGE_HOURS, MAX_TOPIC_EVENT_AGE_HOURS);
  const approvedSources = db.prepare(`
    SELECT source_id
    FROM topic_sources
    WHERE topic_id = ? AND user_id = ? AND status = 'approved'
  `).all(topicId, userId);
  const approvedSourceIds = new Set(approvedSources.map((row) => row.source_id));
  const rows = db.prepare(`
    SELECT
      ci.id, ci.source_id, ci.title, ci.url, ci.thumbnail_url, ci.publish_date,
      ci.summary, ci.article_body, ci.transcript, ci.topic_tags_json, ci.content_type,
      ci.channel_type, ci.trust_score, ci.depth_score, ci.life_impact,
      ci.decision_usefulness, ci.created_at,
      s.name AS source_name, s.trust_tier AS source_trust_tier
    FROM content_items ci
    LEFT JOIN sources s ON s.id = ci.source_id
    WHERE datetime(COALESCE(ci.publish_date, ci.created_at)) >= datetime('now', ?)
    ORDER BY datetime(COALESCE(ci.publish_date, ci.created_at)) DESC
    LIMIT 500
  `).all(`-${ageHours} hours`);

  return rows
    .map((item) => {
      const match = scoreTopicItem(topic, item, approvedSourceIds);
      if (!match) return null;
      return {
        id: item.id,
        title: item.title,
        url: item.url,
        thumbnail_url: item.thumbnail_url || null,
        published_at: item.publish_date || item.created_at,
        summary: item.summary || '',
        source: item.source_name || 'Unknown source',
        source_trust_tier: item.source_trust_tier || null,
        content_type: item.content_type || item.channel_type || 'article',
        relevance_score: match.score,
        matched_terms: match.matched_terms,
        approved_source: match.approved_source,
        reason: match.approved_source
          ? 'Matches this topic and comes from an approved connection.'
          : `Matches ${match.matched_terms.slice(0, 3).join(', ') || 'the topic instruction'}.`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.relevance_score - a.relevance_score
      || Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0))
    .slice(0, limit);
}

function listResearchRuns(db, userId, topicId, limit = 10) {
  ensureTables(db);
  return db.prepare(`
    SELECT id, topic_id, status, provider, model, result_json, error, created_at
    FROM topic_research_runs
    WHERE topic_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(topicId, userId, clampInteger(limit, 1, 30, 10)).map((row) => ({
    ...row,
    result: parseJson(row.result_json, {}),
  }));
}

async function runDeepResearch(db, userId, topicId) {
  const topic = getTopic(db, userId, topicId);
  if (!topic) return null;
  const events = getTopicEvents(db, userId, topicId, { limit: 20 }) || [];
  const approvedSources = (topic.suggested_sources || []).filter((source) => source.status === 'approved');
  const systemPrompt = [
    'You are the bounded deep-research analyst inside eXplore.',
    'Use only the supplied topic, approved sources, and indexed evidence.',
    'Never claim that a source was read if only its URL was supplied.',
    'Separate evidence, inference, uncertainty, and next research steps.',
    'Return only JSON with summary, important_changes, evidence_map, uncertainties, actions, and next_questions.',
  ].join(' ');
  const userPrompt = JSON.stringify({
    topic: {
      name: topic.name,
      instruction: topic.instruction,
      intended_outcome: topic.intended_outcome,
      priority: topic.importance_threshold,
    },
    approved_sources: approvedSources.map((source) => ({
      name: source.name,
      url: source.url,
      role: source.role,
    })),
    indexed_evidence_last_72_hours: events.map((event) => ({
      title: event.title,
      source: event.source,
      published_at: event.published_at,
      summary: event.summary,
      url: event.url,
      relevance_score: event.relevance_score,
    })),
  });

  const id = crypto.randomUUID();
  let result;
  let status = 'complete';
  let errorText = '';
  try {
    result = await aiService.generateStructuredJson({
      systemPrompt,
      userPrompt,
      providerPreference: 'auto',
      temperature: 0.15,
      maxKeyAttempts: 4,
    });
  } catch (error) {
    status = 'degraded';
    errorText = normalizeText(error?.message || 'AI synthesis unavailable.').slice(0, 500);
    result = {
      summary: events.length
        ? `${events.length} recent items match this topic. AI synthesis was unavailable, so the evidence is listed without added interpretation.`
        : 'No indexed evidence matched this topic in the last 72 hours.',
      important_changes: events.slice(0, 5).map((event) => event.title),
      evidence_map: events.slice(0, 10).map((event) => ({
        claim: event.title,
        source: event.source,
        url: event.url,
      })),
      uncertainties: ['The AI synthesis provider was unavailable for this run.'],
      actions: ['Review the approved sources and the evidence links directly.'],
      next_questions: ['Which approved source should be checked next?'],
    };
  }

  const diagnostics = aiService.getSafeModelPoolDiagnostics();
  db.prepare(`
    INSERT INTO topic_research_runs (
      id, topic_id, user_id, status, provider, model, result_json, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    topicId,
    userId,
    status,
    diagnostics.provider || null,
    diagnostics.model || null,
    JSON.stringify(result || {}),
    errorText || null,
  );

  return listResearchRuns(db, userId, topicId, 1)[0] || null;
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
  discoverSourcesWithAi,
  addTopicSource,
  removeTopicSource,
  setSourceApproval,
  getTopicEvents,
  listResearchRuns,
  runDeepResearch,
  getSourceWeb,
  getSourceSuggestions,
  ensureJordanIranTopic,
  topicRowToJson,
  __test__: {
    slugify,
    topicPayload,
    shouldSuggest,
    normalizePublicUrl,
    topicTerms,
    scoreTopicItem,
  },
};
