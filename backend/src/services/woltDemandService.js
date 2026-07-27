'use strict';

const crypto = require('crypto');
const { persistPriorityAlerts } = require('./priorityAlertStore');

const SUPPLY_STATES = {
  SUPPLY_STATE_OFFERS_FLYING: { key: 'SUPPLY_STATE_OFFERS_FLYING', label: 'Offers Flying (High)', level: 3, badge: '🔥' },
  SUPPLY_STATE_EXPECT_SOON:   { key: 'SUPPLY_STATE_EXPECT_SOON',   label: 'Expect Soon (Medium)', level: 2, badge: '⚡' },
  SUPPLY_STATE_SLOWER:        { key: 'SUPPLY_STATE_SLOWER',        label: 'Slower (Low)',          level: 1, badge: '🐢' },
  SUPPLY_STATE_HIDE:          { key: 'SUPPLY_STATE_HIDE',          label: 'Unavailable / Hidden',  level: 0, badge: '🙈' },
};

// Short aliases (UI uses these) → canonical SUPPLY_STATE_ keys
const MIN_LEVEL_ALIAS_MAP = {
  EXPECT_SOON:          'SUPPLY_STATE_EXPECT_SOON',
  OFFERS_FLYING:        'SUPPLY_STATE_OFFERS_FLYING',
  SLOWER:               'SUPPLY_STATE_SLOWER',
  HIDE:                 'SUPPLY_STATE_HIDE',
};

// Max snapshot rows to keep per user (7 days × 720 rows/day = 5040 max)
const SNAPSHOT_PRUNE_KEEP_DAYS = 7;

function resolveMinLevelKey(raw) {
  if (!raw) return 'SUPPLY_STATE_EXPECT_SOON';
  if (SUPPLY_STATES[raw]) return raw;
  return MIN_LEVEL_ALIAS_MAP[raw] || 'SUPPLY_STATE_EXPECT_SOON';
}

function getTodayFormatted() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  const year  = d.getFullYear();
  return `${month}/${day}/${year}`;
}

function getWoltConfig(db, userId = 'default_user') {
  const row = db.prepare(`
    SELECT * FROM wolt_monitor_configs WHERE user_id = ?
  `).get(userId);

  if (!row) {
    return {
      user_id: userId,
      enabled: false,
      auth_token: '',
      city_id: '',
      venue_id: '',
      check_interval_minutes: 2,
      min_notify_level: 'SUPPLY_STATE_EXPECT_SOON',
      notify_hotspots: true,
      sound_enabled: true,
      vibration_enabled: true,
    };
  }

  return {
    ...row,
    enabled: Boolean(row.enabled),
    notify_hotspots: Boolean(row.notify_hotspots),
    sound_enabled: Boolean(row.sound_enabled),
    vibration_enabled: Boolean(row.vibration_enabled),
    // Always normalise to full canonical key
    min_notify_level: resolveMinLevelKey(row.min_notify_level),
  };
}

function saveWoltConfig(db, userId = 'default_user', config = {}) {
  const existing = getWoltConfig(db, userId);
  const updated = {
    id: existing.id || `wolt_cfg_${crypto.randomUUID()}`,
    user_id: userId,
    enabled: config.enabled !== undefined ? (config.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    auth_token: config.auth_token !== undefined ? String(config.auth_token).trim() : (existing.auth_token || ''),
    city_id: config.city_id !== undefined ? String(config.city_id).trim() : (existing.city_id || ''),
    venue_id: config.venue_id !== undefined ? String(config.venue_id).trim() : (existing.venue_id || ''),
    check_interval_minutes: Number(config.check_interval_minutes || existing.check_interval_minutes || 2),
    // Normalise short aliases to canonical full keys on save
    min_notify_level: resolveMinLevelKey(config.min_notify_level || existing.min_notify_level),
    notify_hotspots: config.notify_hotspots !== undefined ? (config.notify_hotspots ? 1 : 0) : (existing.notify_hotspots ? 1 : 0),
    sound_enabled: config.sound_enabled !== undefined ? (config.sound_enabled ? 1 : 0) : (existing.sound_enabled ? 1 : 0),
    vibration_enabled: config.vibration_enabled !== undefined ? (config.vibration_enabled ? 1 : 0) : (existing.vibration_enabled ? 1 : 0),
    updated_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO wolt_monitor_configs (
      id, user_id, enabled, auth_token, city_id, venue_id,
      check_interval_minutes, min_notify_level, notify_hotspots,
      sound_enabled, vibration_enabled, updated_at
    ) VALUES (
      @id, @user_id, @enabled, @auth_token, @city_id, @venue_id,
      @check_interval_minutes, @min_notify_level, @notify_hotspots,
      @sound_enabled, @vibration_enabled, @updated_at
    ) ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      auth_token = excluded.auth_token,
      city_id = excluded.city_id,
      venue_id = excluded.venue_id,
      check_interval_minutes = excluded.check_interval_minutes,
      min_notify_level = excluded.min_notify_level,
      notify_hotspots = excluded.notify_hotspots,
      sound_enabled = excluded.sound_enabled,
      vibration_enabled = excluded.vibration_enabled,
      updated_at = excluded.updated_at
  `).run(updated);

  return getWoltConfig(db, userId);
}

/**
 * Returns the latest snapshot with camelCase fields mapped so it matches
 * the in-memory result shape returned by fetchLiveWoltDemand().
 * Critically, `level` is derived from supply_state so previousLevel is correct.
 */
function getLatestSnapshot(db, userId = 'default_user') {
  const row = db.prepare(`
    SELECT * FROM wolt_demand_snapshots
    WHERE user_id = ?
    ORDER BY fetched_at DESC
    LIMIT 1
  `).get(userId);

  if (!row) return null;

  try {
    const stateMeta = SUPPLY_STATES[row.supply_state] || { level: 1 };
    return {
      ...row,
      // camelCase aliases so evaluateAndTriggerAlert can read both DB rows and live results
      supplyState: row.supply_state,
      hotspotsCount: Number(row.hotspots_count || 0),
      demandLevelLabel: row.demand_level_label,
      level: stateMeta.level,
      fetchedAt: row.fetched_at,
      forecast: JSON.parse(row.forecast_json || '[]'),
      raw_response: JSON.parse(row.raw_response_json || '{}'),
    };
  } catch {
    return row;
  }
}

async function fetchLiveWoltDemand({ authToken, cityId, venueId }) {
  if (!authToken) {
    return {
      ok: false,
      error: 'Wolt authentication token is required',
      statusCode: 400,
    };
  }

  const cleanToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
  const dateStr = getTodayFormatted();
  const demandUrl  = `https://courier-gateway.wolt.com/v2/forecast/demand/intraday/${dateStr}`;
  const hotspotUrl = `https://courier-gateway.wolt.com/performance/hotspotsCount/v1/hotspotsData`;

  const headers = {
    'Authorization': cleanToken,
    'User-Agent': 'WoltPartner/2.190.10 (Android; SDK 34)',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (cityId) headers['Wolt-City-ID'] = cityId;
  if (venueId) headers['Wolt-Venue-ID'] = venueId;

  let demandData = null;
  let hotspotData = null;
  let rawResponseJson = {};
  let demandError = null;

  try {
    const res = await fetch(demandUrl, { method: 'GET', headers });
    rawResponseJson.demandStatus = res.status;
    rawResponseJson.demandStatusText = res.statusText;

    if (res.ok) {
      demandData = await res.json();
      rawResponseJson.demandBody = demandData;
    } else {
      const errText = await res.text();
      demandError = `Demand request failed (${res.status} ${res.statusText}): ${errText.slice(0, 300)}`;
      rawResponseJson.demandError = errText;
    }
  } catch (err) {
    demandError = `Network error fetching demand: ${err.message}`;
    rawResponseJson.demandError = err.message;
  }

  try {
    const resHotspots = await fetch(hotspotUrl, { method: 'GET', headers });
    rawResponseJson.hotspotsStatus = resHotspots.status;
    if (resHotspots.ok) {
      hotspotData = await resHotspots.json();
      rawResponseJson.hotspotsBody = hotspotData;
    }
  } catch (err) {
    rawResponseJson.hotspotsError = err.message;
  }

  if (demandError && !demandData) {
    return {
      ok: false,
      error: demandError,
      rawResponse: rawResponseJson,
    };
  }

  const rawState  = demandData?.supplyState || demandData?.state || demandData?.demandState || 'SUPPLY_STATE_SLOWER';
  const stateMeta = SUPPLY_STATES[rawState] || { key: rawState, label: rawState, level: 1, badge: '📊' };
  const hotspotsCount = Number(hotspotData?.count || hotspotData?.hotspotsCount || demandData?.hotspotsCount || 0);
  const forecast = Array.isArray(demandData?.forecast) ? demandData.forecast : (demandData?.intraday || []);

  return {
    ok: true,
    supplyState: stateMeta.key,
    demandLevelLabel: stateMeta.label,
    level: stateMeta.level,
    badge: stateMeta.badge,
    hotspotsCount,
    forecast,
    rawResponse: rawResponseJson,
    fetchedAt: new Date().toISOString(),
  };
}

function recordSnapshot(db, userId = 'default_user', snapshotData = {}) {
  const snapshotId = `wolt_snap_${crypto.randomUUID()}`;
  const now = snapshotData.fetchedAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO wolt_demand_snapshots (
      id, user_id, supply_state, hotspots_count, demand_level_label,
      forecast_json, raw_response_json, transition_event, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId,
    userId,
    snapshotData.supplyState || 'SUPPLY_STATE_SLOWER',
    snapshotData.hotspotsCount || 0,
    snapshotData.demandLevelLabel || 'Slower',
    JSON.stringify(snapshotData.forecast || []),
    JSON.stringify(snapshotData.rawResponse || {}),
    snapshotData.transitionEvent || null,
    now
  );

  // Prune old snapshots — keep last SNAPSHOT_PRUNE_KEEP_DAYS days to prevent unbounded growth
  try {
    db.prepare(`
      DELETE FROM wolt_demand_snapshots
      WHERE user_id = ?
        AND fetched_at < datetime('now', '-${SNAPSHOT_PRUNE_KEEP_DAYS} days')
    `).run(userId);
  } catch (pruneErr) {
    console.warn('[woltDemandService] snapshot pruning failed:', pruneErr.message);
  }

  return snapshotId;
}

/**
 * Evaluates whether a demand state change warrants alerting.
 * Does NOT mutate the `current` object — returns transitionEvent as a separate value.
 */
function evaluateAndTriggerAlert(db, userId, current, previous, config) {
  if (!config.enabled) return null;

  const currentLevel  = current.level || 0;
  const previousLevel = previous?.level || 0;   // correctly populated now via getLatestSnapshot
  const minLevelKey   = resolveMinLevelKey(config.min_notify_level);
  const minRequiredLevel = (SUPPLY_STATES[minLevelKey] || SUPPLY_STATES.SUPPLY_STATE_EXPECT_SOON).level;

  let transitionReason = null;

  if (currentLevel > previousLevel && currentLevel >= minRequiredLevel) {
    transitionReason = `Demand upgraded to ${current.demandLevelLabel} (${current.badge})`;
  } else if (
    config.notify_hotspots
    && currentLevel >= minRequiredLevel         // only alert on hotspots when demand is meaningful
    && current.hotspotsCount > (previous?.hotspotsCount || 0)
  ) {
    transitionReason = `${current.hotspotsCount} Wolt hotspots detected nearby 🔥`;
  }

  if (!transitionReason) return null;

  const alertItem = {
    id: `wolt_alert_${crypto.randomUUID()}`,
    category: 'wolt_demand',
    title: `Wolt Alert: ${current.demandLevelLabel}`,
    summary: transitionReason,
    why_it_matters: `Real-time Wolt intraday demand monitor: ${transitionReason}. Active hotspots: ${current.hotspotsCount}.`,
    importance: currentLevel >= 3 ? 'critical' : 'major',
    threat_level: 'low',
    source: 'Wolt Partner Courier Monitor',
    source_type: 'official_api',
    official_source: 1,
    url: 'https://courier-gateway.wolt.com',
    published_at: current.fetchedAt || new Date().toISOString(),
    score: 95,
  };

  const persisted = persistPriorityAlerts(db, [alertItem]);

  if (!persisted || persisted.length === 0) {
    console.warn('[woltDemandService] evaluateAndTriggerAlert: alert was not persisted (possibly filtered by time window). transitionReason:', transitionReason);
  }

  return {
    alert: persisted?.[0] || alertItem,
    transitionReason,
  };
}

async function runWoltDemandCheck(db, userId = 'default_user') {
  const config = getWoltConfig(db, userId);
  if (!config.enabled || !config.auth_token) {
    return {
      skipped: true,
      reason: 'Wolt Demand Monitor is disabled or missing authentication token',
    };
  }

  const previousSnapshot = getLatestSnapshot(db, userId);
  const result = await fetchLiveWoltDemand({
    authToken: config.auth_token,
    cityId: config.city_id,
    venueId: config.venue_id,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      rawResponse: result.rawResponse,
    };
  }

  const transitionInfo = evaluateAndTriggerAlert(db, userId, result, previousSnapshot, config);
  // Record snapshot AFTER alert evaluation — do not pass transitionReason via mutation
  recordSnapshot(db, userId, {
    ...result,
    transitionEvent: transitionInfo?.transitionReason || null,
  });

  return {
    ok: true,
    snapshot: result,
    transition: transitionInfo?.transitionReason || null,
    alertCreated: Boolean(transitionInfo?.alert),
  };
}

module.exports = {
  SUPPLY_STATES,
  MIN_LEVEL_ALIAS_MAP,
  resolveMinLevelKey,
  getWoltConfig,
  saveWoltConfig,
  getLatestSnapshot,
  fetchLiveWoltDemand,
  recordSnapshot,
  evaluateAndTriggerAlert,
  runWoltDemandCheck,
};
