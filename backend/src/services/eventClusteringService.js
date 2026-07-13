'use strict';

/**
 * Deterministic event clustering for news items (plan Part 8).
 * Groups similar titles/URLs into event clusters without inventing sources.
 */

const crypto = require('crypto');

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokens(value = '') {
  return [...new Set(
    normalizeText(value)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 || token === 'ai' || token === 'us')
  )];
}

function jaccard(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) inter += 1;
  }
  // Soft stem match for intercept/interception, escalate/escalation, etc.
  for (const leftToken of a) {
    for (const rightToken of b) {
      if (leftToken === rightToken) continue;
      if (leftToken.length < 5 || rightToken.length < 5) continue;
      if (leftToken.startsWith(rightToken.slice(0, 5)) || rightToken.startsWith(leftToken.slice(0, 5))) {
        inter += 0.5;
      }
    }
  }
  return Math.min(1, inter / (a.size + b.size - Math.min(inter, Math.min(a.size, b.size))));
}

const CLUSTER_KEY_ENTITIES = [
  'jordan', 'iran', 'drone', 'drones', 'missile', 'missiles', 'airspace', 'amman',
  'openai', 'anthropic', 'gemini', 'llama', 'mistral', 'xai',
];

function similarity(left, right) {
  const base = jaccard(left, right);
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  const sharedEntities = CLUSTER_KEY_ENTITIES.filter((entity) => a.has(entity) && b.has(entity));
  if (sharedEntities.length >= 2) {
    return Math.max(base, Math.min(0.95, 0.48 + sharedEntities.length * 0.08));
  }
  return base;
}

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_clusters (
      id TEXT PRIMARY KEY,
      canonical_title TEXT NOT NULL,
      summary TEXT,
      event_time DATETIME,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      member_count INTEGER DEFAULT 1,
      confidence REAL DEFAULT 0.5,
      jordan_material INTEGER DEFAULT 0,
      payload_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_clusters_last_seen
      ON event_clusters (last_seen_at DESC);
    CREATE TABLE IF NOT EXISTS event_cluster_members (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      content_item_id TEXT,
      title TEXT,
      url TEXT,
      source_name TEXT,
      published_at DATETIME,
      similarity REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(cluster_id, content_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_cluster_members_cluster
      ON event_cluster_members (cluster_id, created_at DESC);
  `);
}

function extractClaimsFromItem(item = {}) {
  const text = normalizeText([item.title, item.summary, item.description].join('. '));
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24)
    .slice(0, 5);
  return sentences.map((claimText, index) => ({
    id: `${item.id || 'item'}-claim-${index}`,
    claim_text: claimText,
    status: /official|confirmed|announced|released/i.test(claimText) ? 'confirmed' : 'claimed',
  }));
}

function findBestCluster(db, item, threshold = 0.42) {
  const title = normalizeText(item.title || item.summary || '');
  if (!title) return null;
  const candidates = db.prepare(`
    SELECT id, canonical_title, summary, member_count
    FROM event_clusters
    ORDER BY last_seen_at DESC
    LIMIT 80
  `).all();
  let best = null;
  let bestScore = 0;
  for (const cluster of candidates) {
    const score = Math.max(
      similarity(title, cluster.canonical_title),
      similarity(title, cluster.summary || ''),
    );
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }
  if (best && bestScore >= threshold) {
    return { cluster: best, similarity: bestScore };
  }
  return null;
}

function upsertItemIntoCluster(db, item = {}) {
  ensureTables(db);
  const title = normalizeText(item.title || '');
  const summary = normalizeText(item.summary || item.description || '');
  if (!title && !summary) {
    return null;
  }

  const match = findBestCluster(db, item);
  const publishedAt = item.publishedAt || item.publish_date || item.published_at || item.date || null;
  const contentId = item.id || item.content_item_id || null;
  const url = item.url || null;
  const sourceName = item.source || item.source_name || null;

  let clusterId;
  let similarity = 1;
  if (match) {
    clusterId = match.cluster.id;
    similarity = match.similarity;
    db.prepare(`
      UPDATE event_clusters
      SET member_count = member_count + 1,
          last_seen_at = CURRENT_TIMESTAMP,
          confidence = MIN(0.98, confidence + 0.03),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(clusterId);
  } else {
    clusterId = crypto.randomUUID();
    const jordanHit = /jordan|amman|jordanian/i.test(`${title} ${summary}`);
    db.prepare(`
      INSERT INTO event_clusters (
        id, canonical_title, summary, event_time, member_count, confidence, jordan_material, payload_json
      ) VALUES (?, ?, ?, ?, 1, 0.55, ?, ?)
    `).run(
      clusterId,
      title || summary.slice(0, 180),
      summary || title,
      publishedAt,
      jordanHit ? 1 : 0,
      JSON.stringify({ seed_url: url, claims: extractClaimsFromItem(item) }),
    );
  }

  const memberId = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO event_cluster_members (
        id, cluster_id, content_item_id, title, url, source_name, published_at, similarity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id, content_item_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        similarity = excluded.similarity
    `).run(memberId, clusterId, contentId, title, url, sourceName, publishedAt, similarity);
  } catch (_) {
    // content_item_id may be null; insert without unique constraint conflict path
    db.prepare(`
      INSERT INTO event_cluster_members (
        id, cluster_id, content_item_id, title, url, source_name, published_at, similarity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memberId, clusterId, contentId, title, url, sourceName, publishedAt, similarity);
  }

  return getCluster(db, clusterId);
}

function getCluster(db, clusterId) {
  ensureTables(db);
  const cluster = db.prepare('SELECT * FROM event_clusters WHERE id = ?').get(clusterId);
  if (!cluster) return null;
  const members = db.prepare(`
    SELECT * FROM event_cluster_members
    WHERE cluster_id = ?
    ORDER BY published_at DESC, created_at DESC
  `).all(clusterId);
  let payload = {};
  try {
    payload = JSON.parse(cluster.payload_json || '{}');
  } catch (_) {
    payload = {};
  }
  return {
    id: cluster.id,
    canonical_title: cluster.canonical_title,
    summary: cluster.summary,
    event_time: cluster.event_time,
    first_seen_at: cluster.first_seen_at,
    last_seen_at: cluster.last_seen_at,
    member_count: cluster.member_count,
    confidence: cluster.confidence,
    jordan_material: Boolean(cluster.jordan_material),
    claims: Array.isArray(payload.claims) ? payload.claims : [],
    members,
    source_count: new Set(members.map((row) => row.source_name || row.url).filter(Boolean)).size,
  };
}

function listClusters(db, { limit = 30, jordanOnly = false } = {}) {
  ensureTables(db);
  const rows = jordanOnly
    ? db.prepare(`
        SELECT id FROM event_clusters
        WHERE jordan_material = 1
        ORDER BY last_seen_at DESC
        LIMIT ?
      `).all(limit)
    : db.prepare(`
        SELECT id FROM event_clusters
        ORDER BY last_seen_at DESC
        LIMIT ?
      `).all(limit);
  return rows.map((row) => getCluster(db, row.id)).filter(Boolean);
}

function clusterItems(db, items = []) {
  ensureTables(db);
  const results = [];
  for (const item of Array.isArray(items) ? items : []) {
    const cluster = upsertItemIntoCluster(db, item);
    if (cluster) results.push(cluster);
  }
  // Deduplicate returned clusters by id, keep latest shape
  const byId = new Map();
  for (const cluster of results) {
    byId.set(cluster.id, cluster);
  }
  return [...byId.values()].sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
}

module.exports = {
  ensureTables,
  extractClaimsFromItem,
  upsertItemIntoCluster,
  getCluster,
  listClusters,
  clusterItems,
  __test__: { jaccard, similarity, tokens, normalizeText },
};
