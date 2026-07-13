'use strict';

const crypto = require('crypto');
const { google } = require('googleapis');

const FCM_SCOPE = ['https://www.googleapis.com/auth/firebase.messaging'];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
const MOBILE_APP_SCHEME = process.env.MOBILE_APP_SCHEME || 'explore';
const ALERT_WORKER_NAME = 'priority_alert_dispatch';
const DEFAULT_AI_RELEASE_WATCH_COMPANIES = ['anthropic', 'openai', 'google', 'xai'];
const DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE = 'important';
const DEFAULT_DIRECT_NEWS_WATCH_SOURCES = ['anthropic'];
const DEFAULT_DIRECT_NEWS_WATCH_REASON = 'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.';
const AI_RELEASE_IMPORTANCE_ORDER = {
  important: 1,
  major: 2,
};
const POLITICAL_EVENT_PATTERNS = [
  /\belection(?:s|ing)?\b/i,
  /\bvot(?:e|ing|er|ers)\b/i,
  /\bparliament\b/i,
  /\bcongress\b/i,
  /\bsenate\b/i,
  /\bgovernment\b/i,
  /\bcabinet\b/i,
  /\bprime minister\b/i,
  /\bpresident\b/i,
  /\bminister\b/i,
  /\bresign(?:s|ed|ation)?\b/i,
  /\bimpeach(?:ment|ed|s)?\b/i,
  /\bassassinat(?:e|ed|ion)\b/i,
  /\bcoup\b/i,
  /\bprotest(?:s|ers|ing)?\b/i,
  /\bcrackdown\b/i,
  /\bcoalition\b/i,
  /\bpolicy\b/i,
  /\bcourt\b/i,
];

function hasPushCredentials() {
  return Boolean(FIREBASE_PROJECT_ID && FIREBASE_SERVICE_ACCOUNT_JSON);
}

function buildGoogleAuth() {
  const credentials = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: FCM_SCOPE,
  });
}

function summarizeAlert(alert) {
  if (alert.category === 'geo' || alert.category === 'political') {
    const geoLabel = isPoliticalAlert(alert) ? 'Political alert' : 'Regional alert';
    const threatPrefix = alert.threatLevel ? `${alert.threatLevel} ` : '';
    return {
      title: `eXplore radar: ${threatPrefix}${geoLabel}`.trim(),
      body: alert.title,
    };
  }

  const releaseLabel = String(alert.release_classification_label || '').trim();
  return {
    title: releaseLabel
      ? `eXplore radar: ${releaseLabel}`
      : `eXplore radar: ${(alert.importance || 'important').toUpperCase()} AI alert`,
    body: alert.title,
  };
}

function buildPriorityRadarDeepLink(alertId = '') {
  if (!alertId) {
    return `${MOBILE_APP_SCHEME}://radar`;
  }

  return `${MOBILE_APP_SCHEME}://radar/${encodeURIComponent(alertId)}`;
}

function normalizeAiReleaseWatchCompany(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'anthropic';
  }

  if (normalized.includes('openai') || normalized.includes('gpt')) {
    return 'openai';
  }

  if (normalized.includes('google') || normalized.includes('deepmind') || normalized.includes('gemini') || normalized.includes('gemma')) {
    return 'google';
  }

  if (normalized.includes('x.ai') || normalized.includes('xai') || normalized.includes('grok')) {
    return 'xai';
  }

  if (normalized.includes('meta') || normalized.includes('llama')) {
    return 'meta';
  }

  if (normalized.includes('microsoft') || normalized.includes('copilot')) {
    return 'microsoft';
  }

  if (normalized.includes('amazon') || normalized.includes('aws') || normalized.includes('bedrock') || normalized.includes('nova')) {
    return 'amazon';
  }

  if (normalized.includes('hugging face') || normalized.includes('huggingface') || normalized.includes('hf')) {
    return 'hugging_face';
  }

  return normalized.replace(/\s+/g, '_');
}

function normalizeDirectNewsSourceId(value = '') {
  const normalized = normalizeAiReleaseWatchCompany(value);
  return normalized
    .replace(/[^a-z0-9_:]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeAiReleaseWatchCompanies(value = []) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) {
            return [];
          }

          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : trimmed.split(/[\n,]/);
          } catch (error) {
            return trimmed.split(/[\n,]/);
          }
        })()
      : [];

  const unique = new Set();
  for (const item of rawValues) {
    const normalized = normalizeAiReleaseWatchCompany(item);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique];
}

function getAiReleaseWatchCompanies(preferences = {}) {
  return normalizeAiReleaseWatchCompanies(
    preferences.ai_release_watch_companies_json
      ?? preferences.ai_release_watch_companies
      ?? DEFAULT_AI_RELEASE_WATCH_COMPANIES
  );
}

function getDirectNewsWatchSources(preferences = {}) {
  const raw = preferences.direct_news_watch_sources_json
    ?? preferences.direct_news_watch_sources
    ?? DEFAULT_DIRECT_NEWS_WATCH_SOURCES;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          const trimmed = raw.trim();
          if (!trimmed) {
            return [];
          }

          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : trimmed.split(/[\n,]/);
          } catch (error) {
            return trimmed.split(/[\n,]/);
          }
        })()
      : [];

  return [...new Set(values.map(normalizeDirectNewsSourceId).filter(Boolean))];
}

function normalizeAiReleaseWatchMinImportance(value = DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE) {
  const normalized = String(value || DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AI_RELEASE_IMPORTANCE_ORDER, normalized)
    ? normalized
    : DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE;
}

function meetsAiReleaseWatchImportance(alert = {}, minimumImportance = DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE) {
  const requiredRank = AI_RELEASE_IMPORTANCE_ORDER[normalizeAiReleaseWatchMinImportance(minimumImportance)] || 0;
  const alertRank = AI_RELEASE_IMPORTANCE_ORDER[String(alert.importance || 'important').trim().toLowerCase()] || 0;
  return alertRank >= requiredRank;
}

function inferAiReleaseWatchCompanies(alert = {}) {
  const explicitMatch = normalizeAiReleaseWatchCompany(
    alert.release_watch_company
      || alert.release_watch_company_label
  );
  if (explicitMatch) {
    return [explicitMatch];
  }

  const text = [
    alert.title || '',
    alert.summary || '',
    alert.source || '',
    alert.url || '',
    alert.source_label || '',
    alert.sourceLabel || '',
  ].join(' ').toLowerCase();

  const matches = new Set();

  if (text.includes('anthropic') || text.includes('claude')) {
    matches.add('anthropic');
  }

  if (text.includes('openai') || /\bgpt[-\s]?\d/i.test(text)) {
    matches.add('openai');
  }

  if (text.includes('google') || text.includes('deepmind') || text.includes('gemini') || text.includes('gemma')) {
    matches.add('google');
  }

  if (text.includes('x.ai') || text.includes('xai') || text.includes('grok')) {
    matches.add('xai');
  }

  if (text.includes('meta') || text.includes('llama')) {
    matches.add('meta');
  }

  if (text.includes('microsoft') || text.includes('copilot')) {
    matches.add('microsoft');
  }

  if (text.includes('amazon') || text.includes('aws') || text.includes('bedrock') || text.includes('nova')) {
    matches.add('amazon');
  }

  if (text.includes('hugging face') || text.includes('huggingface') || text.includes('hf')) {
    matches.add('hugging_face');
  }

  return [...matches];
}

function inferDirectNewsSourceIds(alert = {}) {
  const sourceIds = [
    alert.direct_notification_source_id,
    alert.direct_news_source_id,
    alert.source_id,
    alert.release_watch_company,
    alert.release_watch_company_label,
    alert.source,
    alert.source_label,
    alert.sourceLabel,
    alert.publisher,
  ].map(normalizeDirectNewsSourceId).filter(Boolean);

  return [...new Set([
    ...sourceIds,
    ...inferAiReleaseWatchCompanies(alert).map(normalizeDirectNewsSourceId),
  ])];
}

function getAlertText(alert = {}) {
  return [
    alert.title || '',
    alert.summary || '',
    alert.reason || '',
    alert.source || '',
    alert.source_label || '',
    alert.sourceLabel || '',
    alert.publisher || '',
  ].join(' ').toLowerCase();
}

function isPoliticalAlert(alert = {}) {
  if (String(alert.category || '').toLowerCase() === 'political') {
    return true;
  }

  const text = getAlertText(alert);
  return POLITICAL_EVENT_PATTERNS.some((pattern) => pattern.test(text));
}

function buildNotificationIntentState(preferences = {}) {
  return {
    ai_official_enabled: Boolean(preferences.alerts_enabled && preferences.push_enabled && preferences.ai_enabled && preferences.ai_release_watch_enabled),
    geo_world_enabled: Boolean(preferences.alerts_enabled && preferences.push_enabled && preferences.geo_enabled),
    political_enabled: Boolean(preferences.alerts_enabled && preferences.push_enabled && (preferences.political_enabled ?? preferences.geo_enabled)),
    ai_release_watch_enabled: Boolean(preferences.ai_release_watch_enabled),
    ai_release_watch_companies: getAiReleaseWatchCompanies(preferences),
    ai_release_watch_min_importance: normalizeAiReleaseWatchMinImportance(preferences?.ai_release_watch_min_importance),
    direct_news_watch_enabled: Boolean(preferences.direct_news_watch_enabled),
    direct_news_watch_sources: getDirectNewsWatchSources(preferences),
    direct_news_watch_reason: String(preferences.direct_news_watch_reason || DEFAULT_DIRECT_NEWS_WATCH_REASON),
  };
}

function shouldDeliverPriorityAlert(alert = {}, preferences = {}) {
  if (!preferences?.alerts_enabled || !preferences?.push_enabled) {
    return false;
  }

  if (alert.category === 'geo' || alert.category === 'political') {
    return Boolean(preferences.geo_enabled || preferences.political_enabled);
  }

  if (alert.category !== 'ai') {
    return false;
  }

  if (!preferences.ai_enabled) {
    return false;
  }

  if (String(alert.release_watch_signal || '').toLowerCase() === 'direct_news_notification') {
    if (!preferences.direct_news_watch_enabled) {
      return false;
    }

    const watchedDirectSources = getDirectNewsWatchSources(preferences);
    const directSourceIds = inferDirectNewsSourceIds(alert);
    return !watchedDirectSources.length || directSourceIds.some((sourceId) => watchedDirectSources.includes(sourceId));
  }

  if (
    !alert.official_source
    || String(alert.release_watch_signal || '').toLowerCase() !== 'official_release'
  ) {
    return false;
  }

  if (!preferences.ai_release_watch_enabled) {
    return false;
  }

  const watchedCompanies = getAiReleaseWatchCompanies(preferences);
  if (watchedCompanies.length) {
    const releasedBy = inferAiReleaseWatchCompanies(alert);
    if (!releasedBy.some((company) => watchedCompanies.includes(company))) {
      return false;
    }
  }

  return meetsAiReleaseWatchImportance(alert, preferences.ai_release_watch_min_importance);
}

async function sendFcmPayload(token, { title, body, data = {} }) {
  if (!hasPushCredentials()) {
    return {
      ok: false,
      error: 'Firebase credentials are not configured.',
    };
  }

  const auth = buildGoogleAuth();
  const authClient = await auth.getClient();
  const accessTokenResponse = await authClient.getAccessToken();
  const accessToken = accessTokenResponse?.token || accessTokenResponse;

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title,
            body,
          },
          data,
          android: {
            priority: 'HIGH',
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      error: body || `FCM request failed (${response.status})`,
    };
  }

  const payload = await response.json();
  return {
    ok: true,
    providerMessageId: payload.name || crypto.randomUUID(),
  };
}

async function sendFcmNotification(token, alert) {
  const message = summarizeAlert(alert);
  return sendFcmPayload(token, {
    ...message,
    data: {
      alertId: alert.id,
      category: alert.category,
      url: alert.url || '',
      route: alert.id ? 'priority-radar-detail' : 'priority-radar',
      deepLink: buildPriorityRadarDeepLink(alert.id),
    },
  });
}

function buildPrivateMessageDeepLink(conversationId = '') {
  return `${MOBILE_APP_SCHEME}://messages/${encodeURIComponent(conversationId)}`;
}

async function sendPrivateMessageFcmNotification(token, message = {}) {
  const conversationId = String(message.conversationId || '').trim();
  const senderLabel = String(message.senderLabel || 'New private message').trim();
  const body = String(message.preview || message.attachmentName || 'Attachment').trim().slice(0, 160);
  return sendFcmPayload(token, {
    title: senderLabel,
    body,
    data: {
      route: 'private-message',
      conversationId,
      messageId: String(message.messageId || ''),
      deepLink: buildPrivateMessageDeepLink(conversationId),
    },
  });
}

function getNotificationPreferences(db, userId) {
  const defaults = {
    user_id: userId,
    alerts_enabled: 1,
    ai_enabled: 1,
    geo_enabled: 0,
    push_enabled: 1,
    local_fallback_enabled: 1,
    ai_release_watch_enabled: 1,
    ai_release_watch_companies_json: JSON.stringify(DEFAULT_AI_RELEASE_WATCH_COMPANIES),
    ai_release_watch_min_importance: DEFAULT_AI_RELEASE_WATCH_MIN_IMPORTANCE,
    direct_news_watch_enabled: 1,
    direct_news_watch_sources_json: JSON.stringify(DEFAULT_DIRECT_NEWS_WATCH_SOURCES),
    direct_news_watch_reason: DEFAULT_DIRECT_NEWS_WATCH_REASON,
  };

  try {
    const row = db.prepare(`
      SELECT *
      FROM notification_preferences
      WHERE user_id = ?
    `).get(userId) || defaults;

    return {
      ...row,
      ai_release_watch_enabled: Boolean(row?.ai_release_watch_enabled),
      ai_release_watch_companies_json: row?.ai_release_watch_companies_json || '[]',
      ai_release_watch_companies: getAiReleaseWatchCompanies(row),
      ai_release_watch_min_importance: normalizeAiReleaseWatchMinImportance(row?.ai_release_watch_min_importance),
      direct_news_watch_enabled: Boolean(row?.direct_news_watch_enabled),
      direct_news_watch_sources_json: row?.direct_news_watch_sources_json || '[]',
      direct_news_watch_sources: getDirectNewsWatchSources(row),
      direct_news_watch_reason: String(row?.direct_news_watch_reason || DEFAULT_DIRECT_NEWS_WATCH_REASON),
      political_enabled: Boolean(row?.political_enabled ?? row?.geo_enabled),
    };
  } catch (error) {
    return {
      ...defaults,
      ai_release_watch_enabled: Boolean(defaults.ai_release_watch_enabled),
      ai_release_watch_companies: getAiReleaseWatchCompanies(defaults),
      ai_release_watch_min_importance: normalizeAiReleaseWatchMinImportance(defaults.ai_release_watch_min_importance),
      direct_news_watch_enabled: Boolean(defaults.direct_news_watch_enabled),
      direct_news_watch_sources: getDirectNewsWatchSources(defaults),
      direct_news_watch_reason: DEFAULT_DIRECT_NEWS_WATCH_REASON,
      political_enabled: Boolean(defaults.geo_enabled),
    };
  }
}

function getActiveDeviceCount(db, userId) {
  if (!userId) {
    return 0;
  }

  try {
    return Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM device_tokens
        WHERE user_id = ? AND active = 1
      `).get(userId)?.count || 0
    );
  } catch (error) {
    return 0;
  }
}

function listActiveDeviceTokens(db, userId) {
  if (!userId) {
    return [];
  }

  try {
    return db.prepare(`
      SELECT token
      FROM device_tokens
      WHERE user_id = ? AND active = 1
      ORDER BY datetime(last_seen_at) DESC, last_seen_at DESC
    `).all(userId).map((row) => row.token).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function getPushActivationStatus(db, userId, preferences = null) {
  const prefs = preferences || getNotificationPreferences(db, userId);
  const activeDeviceCount = getActiveDeviceCount(db, userId);
  const pushConfigured = hasPushCredentials();
  const intent = buildNotificationIntentState(prefs);

  return {
    alerts_enabled: Boolean(prefs?.alerts_enabled),
    ai_enabled: Boolean(prefs?.ai_enabled),
    geo_enabled: Boolean(prefs?.geo_enabled),
    political_enabled: Boolean(prefs?.political_enabled ?? prefs?.geo_enabled),
    push_enabled: Boolean(prefs?.push_enabled),
    local_fallback_enabled: Boolean(prefs?.local_fallback_enabled),
    ai_release_watch_enabled: Boolean(prefs?.ai_release_watch_enabled),
    ai_release_watch_companies: getAiReleaseWatchCompanies(prefs),
    ai_release_watch_min_importance: normalizeAiReleaseWatchMinImportance(prefs?.ai_release_watch_min_importance),
    direct_news_watch_enabled: Boolean(prefs?.direct_news_watch_enabled),
    direct_news_watch_sources: getDirectNewsWatchSources(prefs),
    direct_news_watch_reason: String(prefs?.direct_news_watch_reason || DEFAULT_DIRECT_NEWS_WATCH_REASON),
    push_registered: activeDeviceCount > 0,
    push_configured: pushConfigured,
    active_device_count: activeDeviceCount,
    intent,
  };
}

function getLatestNotificationDelivery(db, userId, status = null) {
  if (!userId) {
    return null;
  }

  try {
    const statusFilter = status ? 'AND status = ?' : '';
    const params = status ? [userId, status] : [userId];
    return db.prepare(`
      SELECT alert_id, channel, status, error_message, provider_message_id, created_at
      FROM notification_deliveries
      WHERE user_id = ?
      ${statusFilter}
      ORDER BY datetime(created_at) DESC, created_at DESC
      LIMIT 1
    `).get(...params) || null;
  } catch (error) {
    return null;
  }
}

function buildNotificationStatusResponse(db, userId, preferences = null) {
  const prefs = preferences || getNotificationPreferences(db, userId);
  const activation = getPushActivationStatus(db, userId, prefs);
  const worker = getWorkerRuntimeStatus(db, ALERT_WORKER_NAME);
  const latestDelivery = getLatestNotificationDelivery(db, userId);
  const latestSuccess = getLatestNotificationDelivery(db, userId, 'sent');
  const latestFailure = getLatestNotificationDelivery(db, userId, 'failed');
  const pushSendable = Boolean(
    activation.push_configured
      && activation.alerts_enabled
      && activation.push_enabled
      && activation.push_registered
  );

  let normalizedStatus = 'needs_registration';
  let statusLabel = 'Needs registration';

  if (!activation.alerts_enabled || !activation.push_enabled) {
    normalizedStatus = 'disabled';
    statusLabel = 'Alerts disabled';
  } else if (pushSendable) {
    normalizedStatus = 'live';
    statusLabel = 'Hosted push ready';
  } else if (activation.push_registered && !activation.push_configured) {
    normalizedStatus = activation.local_fallback_enabled ? 'local_fallback_only' : 'push_credentials_missing';
    statusLabel = activation.local_fallback_enabled ? 'Local fallback only' : 'Firebase missing';
  } else if (!activation.push_registered) {
    normalizedStatus = 'needs_registration';
    statusLabel = 'Needs registration';
  } else {
    normalizedStatus = 'partial';
    statusLabel = 'Partly configured';
  }

  return {
    ...prefs,
    success: true,
    backend_reachable: true,
    backend_state: normalizedStatus,
    normalized_status: normalizedStatus,
    status: normalizedStatus,
    status_label: statusLabel,
    alerts_enabled: activation.alerts_enabled,
    ai_enabled: activation.ai_enabled,
    geo_enabled: activation.geo_enabled,
    political_enabled: activation.political_enabled,
    push_enabled: activation.push_enabled,
    local_fallback_enabled: activation.local_fallback_enabled,
    ai_release_watch_enabled: activation.ai_release_watch_enabled,
    ai_release_watch_companies: activation.ai_release_watch_companies,
    ai_release_watch_min_importance: activation.ai_release_watch_min_importance,
    direct_news_watch_enabled: activation.direct_news_watch_enabled,
    direct_news_watch_sources: activation.direct_news_watch_sources,
    direct_news_watch_reason: activation.direct_news_watch_reason,
    push_configured: activation.push_configured,
    push_registered: activation.push_registered,
    active_device_count: activation.active_device_count,
    registered_device_count: activation.active_device_count,
    push_token_present: activation.push_registered,
    token_present: activation.push_registered,
    token_state: activation.push_registered ? 'registered' : 'missing',
    registration_state: activation.push_registered ? 'registered' : 'missing',
    push_sendable: pushSendable,
    delivery_mode: pushSendable ? 'hosted_push_primary' : (activation.local_fallback_enabled ? 'local_fallback_only' : 'disabled'),
    intent: activation.intent,
    worker: {
      name: worker.worker_name,
      loop_mode: worker.loop_mode,
      last_status: worker.last_status,
      last_started_at: worker.last_started_at,
      last_completed_at: worker.last_completed_at,
      last_error: worker.last_error || '',
      heartbeat_at: worker.heartbeat_at,
      updated_at: worker.updated_at,
    },
    last_delivery_at: latestDelivery?.created_at || '',
    last_delivery_status: latestDelivery?.status || '',
    last_successful_delivery_at: latestSuccess?.created_at || '',
    last_failed_delivery_at: latestFailure?.created_at || '',
    last_delivery_error: latestFailure?.error_message || '',
  };
}

function updateNotificationPreferences(db, userId, changes = {}) {
  const existing = getNotificationPreferences(db, userId);
  const aiReleaseWatchEnabled = changes.ai_release_watch_enabled ?? existing.ai_release_watch_enabled ?? 0;
  const nextGeoEnabled = Boolean(changes.geo_enabled ?? existing.geo_enabled ?? 1)
    || Boolean(changes.political_enabled ?? existing.political_enabled ?? existing.geo_enabled ?? 0);
  const aiReleaseWatchCompanies = changes.ai_release_watch_companies !== undefined
    ? normalizeAiReleaseWatchCompanies(changes.ai_release_watch_companies)
    : changes.ai_release_watch_companies_json !== undefined
      ? normalizeAiReleaseWatchCompanies(changes.ai_release_watch_companies_json)
      : getAiReleaseWatchCompanies(existing);
  const aiReleaseWatchMinImportance = normalizeAiReleaseWatchMinImportance(
    changes.ai_release_watch_min_importance ?? existing.ai_release_watch_min_importance
  );
  const directNewsWatchSources = changes.direct_news_watch_sources !== undefined
    ? getDirectNewsWatchSources({ direct_news_watch_sources: changes.direct_news_watch_sources })
    : changes.direct_news_watch_sources_json !== undefined
      ? getDirectNewsWatchSources({ direct_news_watch_sources_json: changes.direct_news_watch_sources_json })
      : getDirectNewsWatchSources(existing);
  const next = {
    alerts_enabled: changes.alerts_enabled ?? existing.alerts_enabled ?? 1,
    ai_enabled: changes.ai_enabled ?? existing.ai_enabled ?? 1,
    geo_enabled: Number(Boolean(nextGeoEnabled)),
    push_enabled: changes.push_enabled ?? existing.push_enabled ?? 1,
    local_fallback_enabled: changes.local_fallback_enabled ?? existing.local_fallback_enabled ?? 1,
    ai_release_watch_enabled: aiReleaseWatchEnabled,
    ai_release_watch_companies_json: JSON.stringify(aiReleaseWatchCompanies),
    ai_release_watch_min_importance: aiReleaseWatchMinImportance,
    direct_news_watch_enabled: changes.direct_news_watch_enabled ?? existing.direct_news_watch_enabled ?? 1,
    direct_news_watch_sources_json: JSON.stringify(directNewsWatchSources),
    direct_news_watch_reason: String(changes.direct_news_watch_reason ?? existing.direct_news_watch_reason ?? DEFAULT_DIRECT_NEWS_WATCH_REASON).trim(),
  };

  db.prepare(`
    INSERT INTO notification_preferences (
      user_id,
      alerts_enabled,
      ai_enabled,
      geo_enabled,
      push_enabled,
      local_fallback_enabled,
      ai_release_watch_enabled,
      ai_release_watch_companies_json,
      ai_release_watch_min_importance,
      direct_news_watch_enabled,
      direct_news_watch_sources_json,
      direct_news_watch_reason,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      alerts_enabled = excluded.alerts_enabled,
      ai_enabled = excluded.ai_enabled,
      geo_enabled = excluded.geo_enabled,
      push_enabled = excluded.push_enabled,
      local_fallback_enabled = excluded.local_fallback_enabled,
      ai_release_watch_enabled = excluded.ai_release_watch_enabled,
      ai_release_watch_companies_json = excluded.ai_release_watch_companies_json,
      ai_release_watch_min_importance = excluded.ai_release_watch_min_importance,
      direct_news_watch_enabled = excluded.direct_news_watch_enabled,
      direct_news_watch_sources_json = excluded.direct_news_watch_sources_json,
      direct_news_watch_reason = excluded.direct_news_watch_reason,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    Number(Boolean(next.alerts_enabled)),
    Number(Boolean(next.ai_enabled)),
    Number(Boolean(next.geo_enabled)),
    Number(Boolean(next.push_enabled)),
    Number(Boolean(next.local_fallback_enabled)),
    Number(Boolean(next.ai_release_watch_enabled)),
    next.ai_release_watch_companies_json,
    next.ai_release_watch_min_importance,
    Number(Boolean(next.direct_news_watch_enabled)),
    next.direct_news_watch_sources_json,
    next.direct_news_watch_reason
  );

  return getNotificationPreferences(db, userId);
}

function upsertDeviceToken(db, userId, payload = {}) {
  const recordId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO device_tokens (
      id,
      user_id,
      token,
      platform,
      device_id,
      app_version,
      active,
      created_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      device_id = excluded.device_id,
      app_version = excluded.app_version,
      active = 1,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(
    recordId,
    userId,
    payload.token,
    payload.platform || 'android',
    payload.device_id || null,
    payload.app_version || null
  );

  return db.prepare(`
    SELECT id, user_id, token, platform, device_id, app_version, active, created_at, last_seen_at
    FROM device_tokens
    WHERE token = ?
  `).get(payload.token);
}

function deactivateDeviceToken(db, userId, payload = {}) {
  if (!userId) {
    return {
      success: false,
      deactivated: 0,
    };
  }

  const token = String(payload.token || '').trim();
  const deviceId = String(payload.device_id || '').trim();
  if (!token && !deviceId) {
    return {
      success: false,
      deactivated: 0,
    };
  }

  const filters = [];
  const params = [userId];

  if (token) {
    filters.push('token = ?');
    params.push(token);
  }

  if (deviceId) {
    filters.push('device_id = ?');
    params.push(deviceId);
  }

  try {
    const result = db.prepare(`
      UPDATE device_tokens
      SET
        active = 0,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND active = 1 AND (${filters.join(' OR ')})
    `).run(...params);

    return {
      success: true,
      deactivated: Number(result.changes || 0),
    };
  } catch (error) {
    return {
      success: false,
      deactivated: 0,
      error: error?.message || 'Failed to deactivate device token.',
    };
  }
}

function recordNotificationDelivery(db, userId, alert, channel, status, errorMessage = '', providerMessageId = '') {
  const deliveryId = crypto.randomUUID();
  const dedupeKey = `${userId}:${channel}:${alert.id}`;

  db.prepare(`
    INSERT OR REPLACE INTO notification_deliveries (
      id,
      user_id,
      alert_id,
      channel,
      dedupe_key,
      status,
      error_message,
      provider_message_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    deliveryId,
    userId,
    alert.id,
    channel,
    dedupeKey,
    status,
    errorMessage || null,
    providerMessageId || null
  );
}

function alreadyDelivered(db, userId, alertId, channel = 'push') {
  return Boolean(
    db.prepare(`
      SELECT id
      FROM notification_deliveries
      WHERE user_id = ? AND alert_id = ? AND channel = ? AND status = 'sent'
      LIMIT 1
    `).get(userId, alertId, channel)
  );
}

function updateWorkerRuntimeStatus(db, workerName = ALERT_WORKER_NAME, changes = {}) {
  const nowIso = new Date().toISOString();
  const current = getWorkerRuntimeStatus(db, workerName);
  const next = {
    worker_name: workerName,
    loop_mode: changes.loop_mode ?? current.loop_mode ?? 'oneshot',
    last_status: changes.last_status ?? current.last_status ?? 'idle',
    last_started_at: changes.last_started_at ?? current.last_started_at ?? null,
    last_completed_at: changes.last_completed_at ?? current.last_completed_at ?? null,
    last_error: changes.last_error ?? current.last_error ?? '',
    last_summary_json: changes.last_summary_json ?? current.last_summary_json ?? '',
    heartbeat_at: changes.heartbeat_at ?? nowIso,
  };

  try {
    db.prepare(`
      INSERT INTO worker_runtime_status (
        worker_name,
        loop_mode,
        last_status,
        last_started_at,
        last_completed_at,
        last_error,
        last_summary_json,
        heartbeat_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(worker_name) DO UPDATE SET
        loop_mode = excluded.loop_mode,
        last_status = excluded.last_status,
        last_started_at = excluded.last_started_at,
        last_completed_at = excluded.last_completed_at,
        last_error = excluded.last_error,
        last_summary_json = excluded.last_summary_json,
        heartbeat_at = excluded.heartbeat_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      next.worker_name,
      next.loop_mode,
      next.last_status,
      next.last_started_at,
      next.last_completed_at,
      next.last_error,
      next.last_summary_json,
      next.heartbeat_at
    );
  } catch (error) {
    // Keep runtime resilient when the table is missing in legacy setups.
  }

  return next;
}

function getWorkerRuntimeStatus(db, workerName = ALERT_WORKER_NAME) {
  try {
    const row = db.prepare(`
      SELECT
        worker_name,
        loop_mode,
        last_status,
        last_started_at,
        last_completed_at,
        last_error,
        last_summary_json,
        heartbeat_at,
        updated_at
      FROM worker_runtime_status
      WHERE worker_name = ?
      LIMIT 1
    `).get(workerName);

    if (!row) {
      return {
        worker_name: workerName,
        loop_mode: 'unknown',
        last_status: 'never_run',
        last_started_at: null,
        last_completed_at: null,
        last_error: '',
        last_summary_json: '',
        heartbeat_at: null,
        updated_at: null,
      };
    }

    return {
      worker_name: row.worker_name,
      loop_mode: row.loop_mode || 'unknown',
      last_status: row.last_status || 'unknown',
      last_started_at: row.last_started_at || null,
      last_completed_at: row.last_completed_at || null,
      last_error: row.last_error || '',
      last_summary_json: row.last_summary_json || '',
      heartbeat_at: row.heartbeat_at || null,
      updated_at: row.updated_at || null,
    };
  } catch (error) {
    return {
      worker_name: workerName,
      loop_mode: 'unknown',
      last_status: 'unavailable',
      last_started_at: null,
      last_completed_at: null,
      last_error: '',
      last_summary_json: '',
      heartbeat_at: null,
      updated_at: null,
    };
  }
}

module.exports = {
  ALERT_WORKER_NAME,
  alreadyDelivered,
  deactivateDeviceToken,
  getActiveDeviceCount,
  getNotificationPreferences,
  getPushActivationStatus,
  getWorkerRuntimeStatus,
  hasPushCredentials,
  inferAiReleaseWatchCompanies,
  buildNotificationIntentState,
  buildNotificationStatusResponse,
  buildPrivateMessageDeepLink,
  listActiveDeviceTokens,
  normalizeAiReleaseWatchCompanies,
  recordNotificationDelivery,
  shouldDeliverPriorityAlert,
  sendFcmNotification,
  sendPrivateMessageFcmNotification,
  summarizeAlert,
  buildPriorityRadarDeepLink,
  updateWorkerRuntimeStatus,
  updateNotificationPreferences,
  upsertDeviceToken,
};
