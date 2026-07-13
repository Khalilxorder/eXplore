'use strict';

const crypto = require('crypto');
const {
  sendFcmNotification,
  shouldDeliverPriorityAlert,
} = require('./pushDeliveryService');

function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''),
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.url && config.key);
}

async function request(tablePath, options = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    return null;
  }

  const response = await fetch(`${config.url}/rest/v1/${tablePath}`, {
    method: options.method || 'GET',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase runtime store ${response.status}: ${body.slice(0, 300)}`);
  }

  if (response.status === 204) {
    return [];
  }

  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

async function upsertWorkerStatus(workerName, changes = {}) {
  if (!isConfigured()) return null;
  const now = new Date().toISOString();
  const rows = await request('worker_runtime_status?on_conflict=worker_name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      worker_name: workerName,
      loop_mode: changes.loop_mode || 'scheduled',
      last_status: changes.last_status || 'running',
      last_started_at: changes.last_started_at || null,
      last_completed_at: changes.last_completed_at || null,
      last_error: changes.last_error || '',
      last_summary_json: changes.last_summary_json || null,
      heartbeat_at: changes.heartbeat_at || now,
      updated_at: now,
    }],
  });
  return rows?.[0] || null;
}

async function listWorkerStatuses(workerNames = []) {
  if (!isConfigured()) return [];
  const names = [...new Set(workerNames.map((name) => String(name || '').trim()).filter(Boolean))];
  const filter = names.length
    ? `&worker_name=in.(${names.map((name) => encodeURIComponent(name)).join(',')})`
    : '';
  return request(`worker_runtime_status?select=*${filter}`) || [];
}

function mapAlert(alert = {}) {
  return {
    id: String(alert.id || crypto.randomUUID()),
    fingerprint: String(alert.fingerprint || alert.id || crypto.randomUUID()),
    category: String(alert.category || 'news'),
    title: String(alert.title || 'Untitled event'),
    url: alert.url || null,
    source: alert.source || null,
    published_at: alert.publishedAt || alert.published_at || null,
    summary: alert.summary || null,
    why_it_matters: alert.whyItMatters || alert.why_it_matters || null,
    importance: alert.importance || null,
    threat_level: alert.threatLevel || alert.threat_level || null,
    source_type: alert.source_type || alert.sourceType || 'unknown',
    official_source: toBoolean(alert.official_source ?? alert.officialSource, false),
    qualified_reason: alert.qualified_reason || alert.qualifiedReason || null,
    rejected_reason: alert.rejected_reason || alert.rejectedReason || null,
    score: Math.round(Number(alert.score || 0)),
    raw_json: alert.raw || alert,
    updated_at: new Date().toISOString(),
  };
}

async function upsertPriorityAlerts(alerts = []) {
  if (!isConfigured() || !Array.isArray(alerts) || !alerts.length) return [];
  return request('priority_alerts?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: alerts.map(mapAlert),
  });
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function mapContentRow(row = {}) {
  const mapped = {
    external_id: String(row.external_id || row.url || row.id),
    title: String(row.title || 'Untitled'),
    url: String(row.url || ''),
    thumbnail_url: row.thumbnail_url || null,
    publish_date: row.publish_date || null,
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds || 0),
    language: row.language || 'en',
    view_count: row.view_count === null ? null : Number(row.view_count || 0),
    transcript: row.transcript || null,
    summary: row.summary || null,
    rarity_score: Number(row.rarity_score || 0),
    depth_score: Number(row.depth_score || 0),
    trust_score: Number(row.trust_score || 0),
    freshness_score: Number(row.freshness_score || 0),
    timeless_score: Number(row.timeless_score || 0),
    clickbait_score: Number(row.clickbait_score || 0),
    ingest_status: row.ingest_status || 'ready',
    transcript_status: row.transcript_status || 'missing',
    transcript_provider: row.transcript_provider || null,
    analysis_provider: row.analysis_provider || null,
    analysis_model: row.analysis_model || null,
    analysis_error: row.analysis_error || null,
    embedding_provider: row.embedding_provider || null,
    embedding_model: row.embedding_model || null,
    embedding_error: row.embedding_error || null,
    topic_tags: (() => {
      try { return JSON.parse(row.topic_tags_json || '[]'); } catch (error) { return []; }
    })(),
    content_type: row.content_type || 'article',
    indexed_at: row.indexed_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (isUuid(row.id)) mapped.id = row.id;
  return mapped;
}

async function mirrorRecentContentItems(db, limit = 500) {
  if (!isConfigured()) return [];
  const rows = db.prepare(`
    SELECT * FROM content_items
    WHERE COALESCE(publish_date, updated_at, created_at) >= datetime('now', '-30 days')
    ORDER BY datetime(COALESCE(publish_date, updated_at, created_at)) DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 500, 1000)));
  const mirrored = [];
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100).map(mapContentRow);
    const result = await request('content_items?on_conflict=external_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: batch,
    });
    mirrored.push(...(result || []));
  }
  return mirrored;
}

async function hydrateRecentContentItems(db, limit = 500) {
  if (!isConfigured()) return 0;
  const rows = await request(`content_items?select=*&order=updated_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 500, 1000))}`);
  if (!rows?.length) return 0;
  const upsert = db.prepare(`
    INSERT INTO content_items (
      id, external_id, title, url, thumbnail_url, publish_date, duration_seconds,
      language, view_count, transcript, summary, rarity_score, depth_score,
      trust_score, freshness_score, timeless_score, clickbait_score,
      topic_tags_json, content_type, indexed_at, ingest_status, transcript_status,
      transcript_provider, analysis_provider, analysis_model, analysis_error,
      embedding_provider, embedding_model, embedding_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      thumbnail_url = COALESCE(excluded.thumbnail_url, content_items.thumbnail_url),
      publish_date = COALESCE(excluded.publish_date, content_items.publish_date),
      transcript = COALESCE(excluded.transcript, content_items.transcript),
      summary = COALESCE(excluded.summary, content_items.summary),
      analysis_provider = COALESCE(excluded.analysis_provider, content_items.analysis_provider),
      analysis_model = COALESCE(excluded.analysis_model, content_items.analysis_model),
      analysis_error = excluded.analysis_error,
      topic_tags_json = excluded.topic_tags_json,
      updated_at = excluded.updated_at
  `);
  const transaction = db.transaction((items) => {
    for (const row of items) {
      upsert.run(
        row.id || crypto.randomUUID(), row.external_id, row.title, row.url,
        row.thumbnail_url || null, row.publish_date || null, row.duration_seconds || null,
        row.language || 'en', row.view_count || null, row.transcript || null, row.summary || null,
        Number(row.rarity_score || 0), Number(row.depth_score || 0), Number(row.trust_score || 0),
        Number(row.freshness_score || 0), Number(row.timeless_score || 0), Number(row.clickbait_score || 0),
        JSON.stringify(row.topic_tags || []), row.content_type || 'article', row.indexed_at || null,
        row.ingest_status || 'ready', row.transcript_status || 'missing', row.transcript_provider || null,
        row.analysis_provider || null, row.analysis_model || null, row.analysis_error || null,
        row.embedding_provider || null, row.embedding_model || null, row.embedding_error || null,
        row.created_at || new Date().toISOString(), row.updated_at || new Date().toISOString()
      );
    }
  });
  transaction(rows);
  return rows.length;
}

async function upsertNotificationPreferences(userId, preferences = {}) {
  if (!isConfigured() || !userId) return null;
  const rows = await request('notification_preferences?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      user_id: userId,
      alerts_enabled: toBoolean(preferences.alerts_enabled),
      ai_enabled: toBoolean(preferences.ai_enabled),
      geo_enabled: toBoolean(preferences.geo_enabled, false),
      push_enabled: toBoolean(preferences.push_enabled),
      local_fallback_enabled: toBoolean(preferences.local_fallback_enabled),
      direct_news_watch_enabled: toBoolean(preferences.direct_news_watch_enabled),
      direct_news_watch_sources_json: preferences.direct_news_watch_sources_json || '[]',
      direct_news_watch_reason: preferences.direct_news_watch_reason || null,
      updated_at: new Date().toISOString(),
    }],
  });
  return rows?.[0] || null;
}

async function upsertDeviceToken(userId, payload = {}) {
  if (!isConfigured() || !userId || !payload.token) return null;
  const rows = await request('device_tokens?on_conflict=token', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      user_id: userId,
      token: payload.token,
      platform: payload.platform || 'android',
      device_id: payload.device_id || null,
      app_version: payload.app_version || null,
      active: true,
      last_seen_at: new Date().toISOString(),
    }],
  });
  return rows?.[0] || null;
}

async function deactivateDeviceToken(userId, payload = {}) {
  if (!isConfigured() || !userId) return null;
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (payload.token) {
    filters.push(`token=eq.${encodeURIComponent(payload.token)}`);
  } else if (payload.device_id) {
    filters.push(`device_id=eq.${encodeURIComponent(payload.device_id)}`);
  } else {
    return null;
  }
  return request(`device_tokens?${filters.join('&')}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { active: false, last_seen_at: new Date().toISOString() },
  });
}

async function claimDelivery(userId, alertId, deviceId) {
  const channel = `push:${deviceId}`;
  const dedupeKey = `${userId}:${alertId}:${channel}`;
  const rows = await request('notification_deliveries?on_conflict=dedupe_key', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: [{ user_id: userId, alert_id: alertId, channel, dedupe_key: dedupeKey, status: 'queued' }],
  });
  return rows?.[0] || null;
}

async function finishDelivery(deliveryId, result) {
  return request(`notification_deliveries?id=eq.${encodeURIComponent(deliveryId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: result.ok ? 'sent' : 'failed',
      error_message: result.error || null,
      provider_message_id: result.providerMessageId || null,
    },
  });
}

async function dispatchHostedPush(alerts = []) {
  if (!isConfigured()) {
    return { configured: false, devicesConsidered: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const [devices, preferences] = await Promise.all([
    request('device_tokens?select=id,user_id,token,platform,device_id,app_version&active=eq.true'),
    request('notification_preferences?select=*'),
  ]);
  const prefsByUser = new Map((preferences || []).map((row) => [row.user_id, row]));
  const summary = { configured: true, devicesConsidered: devices?.length || 0, sent: 0, skipped: 0, failed: 0 };

  for (const device of devices || []) {
    const prefs = prefsByUser.get(device.user_id) || {};
    for (const alert of alerts) {
      if (!shouldDeliverPriorityAlert(alert, prefs)) {
        summary.skipped += 1;
        continue;
      }
      const delivery = await claimDelivery(device.user_id, alert.id, device.id);
      if (!delivery) {
        summary.skipped += 1;
        continue;
      }
      const result = await sendFcmNotification(device.token, alert);
      await finishDelivery(delivery.id, result);
      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

module.exports = {
  deactivateDeviceToken,
  dispatchHostedPush,
  hydrateRecentContentItems,
  isConfigured,
  listWorkerStatuses,
  mirrorRecentContentItems,
  upsertDeviceToken,
  upsertNotificationPreferences,
  upsertPriorityAlerts,
  upsertWorkerStatus,
};
