'use strict';

const { getPriorityAlerts } = require('./alertRadarService');

const MAX_FEED_ITEMS = 80;
const RETENTION_DAYS = 120;
const REVIEW_RETENTION_DAYS = 120;

function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getHostname(value = '') {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function normalizeSlug(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildFingerprint(alert = {}) {
  if (alert.fingerprint) {
    return String(alert.fingerprint);
  }

  const host = getHostname(alert.url || '');
  const useTitleFingerprint = host === 'news.google.com';
  const slug = useTitleFingerprint
    ? normalizeSlug(`${alert.source || ''}-${alert.title || ''}`)
    : normalizeSlug(alert.url || alert.title || '');
  return `${alert.category || 'unknown'}:${host || 'no-host'}:${slug || normalizeTitle(alert.title)}`;
}

function mapAlertRow(row) {
  if (!row) {
    return null;
  }

  let raw = null;
  if (row.raw_json) {
    try {
      raw = JSON.parse(row.raw_json);
    } catch (error) {
      raw = null;
    }
  }

  return {
    id: row.id,
    category: row.category,
    title: row.title,
    url: row.url || '',
    source: row.source || '',
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    summary: row.summary || '',
    whyItMatters: row.why_it_matters || '',
    importance: row.importance || null,
    threatLevel: row.threat_level || null,
    source_type: row.source_type || 'unknown',
    official_source: Boolean(row.official_source),
    qualified_reason: row.qualified_reason || '',
    rejected_reason: row.rejected_reason || '',
    sourceType: row.source_type || 'unknown',
    officialSource: Boolean(row.official_source),
    qualifiedReason: row.qualified_reason || '',
    rejectedReason: row.rejected_reason || '',
    releaseWatchCompany: raw?.release_watch_company || '',
    releaseWatchCompanyLabel: raw?.release_watch_company_label || '',
    releaseWatchSignal: raw?.release_watch_signal || '',
    releaseWatchReason: raw?.release_watch_reason || '',
    release_watch_company: raw?.release_watch_company || '',
    release_watch_company_label: raw?.release_watch_company_label || '',
    release_watch_signal: raw?.release_watch_signal || '',
    release_watch_reason: raw?.release_watch_reason || '',
    why_notified: raw?.why_notified || raw?.whyNotified || '',
    whyNotified: raw?.whyNotified || raw?.why_notified || '',
    direct_notification_rule_id: raw?.direct_notification_rule_id || '',
    direct_notification_label: raw?.direct_notification_label || '',
    direct_notification_source_id: raw?.direct_notification_source_id || '',
    direct_notification_source_label: raw?.direct_notification_source_label || '',
    direct_notification_reason: raw?.direct_notification_reason || '',
    direct_notification_source_requirement: raw?.direct_notification_source_requirement || '',
    source_reference: raw?.source_reference || null,
    source_reference_points: Array.isArray(raw?.source_reference_points) ? raw.source_reference_points : [],
    score: Number(row.score || 0),
    seenAt: row.seen_at || null,
    openedAt: row.opened_at || null,
    unread: !row.opened_at,
    aiInterpretation: raw?.aiInterpretation || '',
    raw,
  };
}

function balanceStoredAlerts(alerts = []) {
  const aiAlerts = [];
  const geoAlerts = [];
  const otherAlerts = [];

  for (const alert of alerts) {
    if (alert.category === 'ai') {
      aiAlerts.push(alert);
    } else if (alert.category === 'geo') {
      geoAlerts.push(alert);
    } else {
      otherAlerts.push(alert);
    }
  }

  const balanced = [];
  const leadCategory = (
    !geoAlerts.length
      ? 'ai'
      : !aiAlerts.length
        ? 'geo'
        : Number(aiAlerts[0]?.score || 0) >= Number(geoAlerts[0]?.score || 0)
          ? 'ai'
          : 'geo'
  );

  if (leadCategory === 'ai') {
    if (aiAlerts.length > 0) {
      balanced.push(aiAlerts.shift());
    }
    if (geoAlerts.length > 0) {
      balanced.push(geoAlerts.shift());
    }
  } else {
    if (geoAlerts.length > 0) {
      balanced.push(geoAlerts.shift());
    }
    if (aiAlerts.length > 0) {
      balanced.push(aiAlerts.shift());
    }
  }

  return balanced.concat(aiAlerts, geoAlerts, otherAlerts);
}

function dedupeStoredAlerts(alerts = []) {
  const byFingerprint = new Map();

  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const fingerprint = buildFingerprint(alert);
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, alert);
      continue;
    }

    const existingRank = Number(existing.score || 0) + (existing.official_source ? 20 : 0);
    const nextRank = Number(alert.score || 0) + (alert.official_source ? 20 : 0);
    const existingTime = new Date(existing.publishedAt || 0).getTime();
    const nextTime = new Date(alert.publishedAt || 0).getTime();

    if (nextRank > existingRank || (nextRank === existingRank && nextTime > existingTime)) {
      byFingerprint.set(fingerprint, alert);
    }
  }

  return [...byFingerprint.values()];
}

function normalizeAlertCategories(categories = {}) {
  const normalized = {
    ai: categories.ai !== false,
    geo: categories.geo !== false,
  };

  if (!normalized.ai && !normalized.geo) {
    normalized.ai = true;
  }

  return normalized;
}

function filterAlertsByCategories(alerts = [], categories = {}) {
  const normalized = normalizeAlertCategories(categories);
  return (Array.isArray(alerts) ? alerts : []).filter((alert) => {
    if (alert.category === 'ai') {
      return normalized.ai;
    }

    if (alert.category === 'geo') {
      return normalized.geo;
    }

    return true;
  });
}

function pruneOldAlerts(db) {
  db.prepare(`
    DELETE FROM priority_alerts
    WHERE COALESCE(published_at, updated_at, created_at) < datetime('now', ?)
  `).run(`-${RETENTION_DAYS} days`);
}

function pruneOldReviews(db) {
  db.prepare(`
    DELETE FROM priority_alert_reviews
    WHERE reviewed_at < datetime('now', ?)
  `).run(`-${REVIEW_RETENTION_DAYS} days`);
}

function persistPriorityAlerts(db, alerts = []) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  const insert = db.prepare(`
    INSERT INTO priority_alerts (
      id,
      fingerprint,
      category,
      title,
      url,
      source,
      published_at,
      summary,
      why_it_matters,
      importance,
      threat_level,
      source_type,
      official_source,
      qualified_reason,
      rejected_reason,
      score,
      raw_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      category = excluded.category,
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      published_at = excluded.published_at,
      summary = excluded.summary,
      why_it_matters = excluded.why_it_matters,
      importance = excluded.importance,
      threat_level = excluded.threat_level,
      source_type = excluded.source_type,
      official_source = excluded.official_source,
      qualified_reason = excluded.qualified_reason,
      rejected_reason = excluded.rejected_reason,
      score = excluded.score,
      raw_json = excluded.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const findByFingerprint = db.prepare(`
    SELECT id
    FROM priority_alerts
    WHERE fingerprint = ?
    LIMIT 1
  `);

  const transaction = db.transaction((items) => {
    for (const alert of items) {
      const fingerprint = buildFingerprint(alert);
      const existing = findByFingerprint.get(fingerprint);
      const stableId = existing?.id || alert.id;
      alert.id = stableId;

      insert.run(
        stableId,
        fingerprint,
        alert.category,
        alert.title,
        alert.url || null,
        alert.source || null,
        alert.publishedAt || null,
        alert.summary || null,
        alert.whyItMatters || null,
        alert.importance || null,
        alert.threatLevel || null,
        alert.source_type || null,
        Number(Boolean(alert.official_source)),
        alert.qualified_reason || null,
        alert.rejected_reason || null,
        Number(alert.score || 0),
        JSON.stringify(alert)
      );
    }
  });

  transaction(alerts);
  pruneOldAlerts(db);
  return alerts;
}

function persistPriorityAlertReviews(db, reviewLog = []) {
  if (!Array.isArray(reviewLog) || reviewLog.length === 0) {
    return 0;
  }

  const insert = db.prepare(`
    INSERT INTO priority_alert_reviews (
      id,
      category,
      title,
      url,
      source,
      published_at,
      source_type,
      official_source,
      score,
      qualified_reason,
      rejected_reason,
      reviewed_at,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      published_at = excluded.published_at,
      source_type = excluded.source_type,
      official_source = excluded.official_source,
      score = excluded.score,
      qualified_reason = excluded.qualified_reason,
      rejected_reason = excluded.rejected_reason,
      reviewed_at = excluded.reviewed_at,
      raw_json = excluded.raw_json
  `);

  const transaction = db.transaction((rows) => {
    for (const review of rows) {
      insert.run(
        review.id,
        review.category || null,
        review.title || null,
        review.url || null,
        review.source || null,
        review.publishedAt || null,
        review.source_type || 'unknown',
        Number(Boolean(review.official_source)),
        Number(review.score || 0),
        review.qualified_reason || null,
        review.rejected_reason || null,
        review.reviewed_at || new Date().toISOString(),
        JSON.stringify(review.raw || {})
      );
    }
  });

  transaction(reviewLog);
  pruneOldReviews(db);
  return reviewLog.length;
}

function listPriorityAlerts(db, userId, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, MAX_FEED_ITEMS));
  const queryWindow = Math.max(limit, Math.min(limit * 4, MAX_FEED_ITEMS));
  // Only surface alerts from the last 30 days in fallback — prevents stale items
  // (e.g. months-old Opus/Sonnet) from persisting in the feed after the live fetch fails.
  const rows = db.prepare(`
    SELECT
      a.*,
      state.seen_at,
      state.opened_at
    FROM priority_alerts a
    LEFT JOIN user_alert_states state
      ON state.alert_id = a.id AND state.user_id = ?
    WHERE COALESCE(a.published_at, a.updated_at, a.created_at) >= datetime('now', '-30 days')
    ORDER BY
      a.official_source DESC,
      a.score DESC,
      CASE
        WHEN a.published_at IS NULL THEN 1
        ELSE 0
      END ASC,
      datetime(COALESCE(a.published_at, a.updated_at, a.created_at)) DESC
    LIMIT ?
  `).all(userId, queryWindow);

  return balanceStoredAlerts(
    dedupeStoredAlerts(filterAlertsByCategories(rows.map(mapAlertRow), options.categories))
  ).slice(0, limit);
}

function listPriorityAlertsByIds(db, userId, alertIds = []) {
  const normalizedIds = [...new Set((Array.isArray(alertIds) ? alertIds : []).filter(Boolean))];
  if (normalizedIds.length === 0) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      a.*,
      state.seen_at,
      state.opened_at
    FROM priority_alerts a
    LEFT JOIN user_alert_states state
      ON state.alert_id = a.id AND state.user_id = ?
    WHERE a.id IN (${placeholders})
  `).all(userId, ...normalizedIds);

  const rowById = new Map(rows.map((row) => [row.id, mapAlertRow(row)]));
  return normalizedIds
    .map((id) => rowById.get(id))
    .filter(Boolean);
}

function getPriorityAlertById(db, userId, alertId) {
  const row = db.prepare(`
    SELECT
      a.*,
      state.seen_at,
      state.opened_at
    FROM priority_alerts a
    LEFT JOIN user_alert_states state
      ON state.alert_id = a.id AND state.user_id = ?
    WHERE a.id = ?
    LIMIT 1
  `).get(userId, alertId);

  return mapAlertRow(row);
}

function ensureSqliteUserRecord(db, userId) {
  if (!userId) {
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO users (
      id,
      email,
      onboarding,
      created_at,
      updated_at
    ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(userId, `${userId}@explore.local`);
}

function markPriorityAlertOpened(db, userId, alertId) {
  ensureSqliteUserRecord(db, userId);

  db.prepare(`
    INSERT INTO user_alert_states (
      user_id,
      alert_id,
      seen_at,
      opened_at,
      created_at,
      updated_at
    ) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, alert_id) DO UPDATE SET
      seen_at = COALESCE(user_alert_states.seen_at, excluded.seen_at),
      opened_at = COALESCE(user_alert_states.opened_at, excluded.opened_at),
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, alertId);

  return getPriorityAlertById(db, userId, alertId);
}

function saveAlertInterpretation(db, alertId, interpretation) {
  db.prepare(`
    UPDATE priority_alerts
    SET raw_json = json_set(COALESCE(raw_json, '{}'), '$.aiInterpretation', ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(interpretation, alertId);
}

async function refreshPriorityAlertCache(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, MAX_FEED_ITEMS));
  const categories = normalizeAlertCategories(options.categories);

  try {
    const payload = await getPriorityAlerts();
    persistPriorityAlerts(db, payload.alerts || []);
    const reviewCount = persistPriorityAlertReviews(db, payload.reviewLog || []);
    const liveAlertIds = filterAlertsByCategories(payload.alerts || [], categories)
      .slice(0, limit)
      .map((alert) => alert.id);

    return {
      checkedAt: payload.checkedAt,
      cacheAgeMs: payload.cacheAgeMs,
      alerts: listPriorityAlertsByIds(db, options.userId || '', liveAlertIds),
      source: 'live',
      reviewCount,
    };
  } catch (error) {
    const alerts = listPriorityAlerts(db, options.userId || '', { limit, categories });
    if (!alerts.length) {
      throw error;
    }

    return {
      checkedAt: null,
      cacheAgeMs: null,
      alerts,
      source: 'stored',
      degraded: true,
      reviewCount: 0,
    };
  }
}

module.exports = {
  filterAlertsByCategories,
  getPriorityAlertById,
  listPriorityAlerts,
  markPriorityAlertOpened,
  normalizeAlertCategories,
  persistPriorityAlerts,
  persistPriorityAlertReviews,
  refreshPriorityAlertCache,
  saveAlertInterpretation,
};
