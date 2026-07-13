'use client';

import { Capacitor } from '@capacitor/core';
import { fetchFilteredPriorityRadarFeed, fetchPublicPriorityRadarFeed, resolveApiBase } from './api';
import { getNotificationState, requestNotificationAccess, sendPriorityNotification } from './notifications';
import { performNativeRadarCheck, syncNativeRadarConfig } from './nativeRadar';
import { buildPriorityRadarDeepLink } from './priorityRadarRouting';

export const PRIORITY_RADAR_SETTINGS_KEY = 'explore-priority-radar-settings';
export const PRIORITY_RADAR_SEEN_KEY = 'explore-priority-radar-seen';
export const PRIORITY_RADAR_EVENT = 'explore-priority-radar-updated';
const PRIORITY_RADAR_SETTINGS_VERSION = 7;
export const PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE = ['important', 'major'];
const RELEASE_WATCH_IMPORTANCE_RANK = {
  important: 1,
  major: 2,
};
export const PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE_OPTIONS = [
  {
    value: 'major',
    label: 'Major only',
    description: 'Only the biggest official launches notify you.',
  },
  {
    value: 'important',
    label: 'Important and up',
    description: 'Important launches still notify you, not just the very biggest ones.',
  },
];

export const PRIORITY_RADAR_REFERENCE_POINTS = [
  {
    id: 'openai-official',
    companyId: 'openai',
    label: 'OpenAI News',
    publisher: 'OpenAI',
    sourceType: 'official',
    url: 'https://openai.com/news/',
  },
  {
    id: 'anthropic-official',
    companyId: 'anthropic',
    label: 'Anthropic News',
    publisher: 'Anthropic',
    sourceType: 'official',
    url: 'https://www.anthropic.com/news',
  },
  {
    id: 'google-ai-official',
    companyId: 'google',
    label: 'Google AI Blog',
    publisher: 'Google / Gemini / DeepMind',
    sourceType: 'official',
    url: 'https://blog.google/technology/ai/',
  },
  {
    id: 'xai-official',
    companyId: 'xai',
    label: 'xAI News',
    publisher: 'xAI',
    sourceType: 'official',
    url: 'https://x.ai/news',
  },
  {
    id: 'jordan-moe-king-abdullah-schools',
    companyId: 'king_abdullah_schools',
    label: 'Jordan Ministry of Education',
    publisher: 'Jordan Ministry of Education',
    sourceType: 'official',
    url: 'https://www.moe.gov.jo/ar/news',
  },
];

export const PRIORITY_RADAR_DIRECT_NEWS_REASON =
  'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.';

const PRIORITY_RADAR_RELEASE_WATCH_COMPANIES = {
  anthropic: {
    label: 'Anthropic',
    patterns: [/\banthropic\b/i, /\bclaude\b/i, /\bmythos\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i],
  },
  openai: {
    label: 'OpenAI',
    patterns: [/\bopenai\b/i, /\bgpt\b/i, /\bchatgpt\b/i, /\bo[1-9]\b/i, /\bsora\b/i],
  },
  google: {
    label: 'Gemini / DeepMind',
    patterns: [/\bgemini\b/i, /\bdeepmind\b/i, /\bgoogle\s+ai\b/i, /\bveo\b/i, /\bimagen\b/i],
  },
  meta: {
    label: 'Meta / Llama',
    patterns: [/\bmeta\b/i, /\bllama\b/i],
  },
  xai: {
    label: 'Grok / xAI',
    patterns: [/\bgrok\b/i, /\bxai\b/i, /\bx\.ai\b/i],
  },
  microsoft: {
    label: 'Microsoft / Copilot',
    patterns: [/\bmicrosoft\b/i, /\bcopilot\b/i, /\bphi\b/i],
  },
  mistral: {
    label: 'Mistral AI',
    patterns: [/\bmistral\b/i, /\bmixtral\b/i, /\bcodal\b/i, /\bministral\b/i],
  },
  amazon: {
    label: 'Amazon / AWS',
    patterns: [/\bamazon\b/i, /\baws\b/i, /\bbedrock\b/i, /\bnova\b/i],
  },
  hugging_face: {
    label: 'Hugging Face',
    patterns: [/\bhugging\s*face\b/i],
  },
};

const DEFAULT_SETTINGS = {
  version: PRIORITY_RADAR_SETTINGS_VERSION,
  profile: 'release-watch',
  enabled: false,
  pollMinutes: 3,
  categories: {
    ai: true,
    geo: false,
  },
  releaseWatch: {
    enabled: true,
    minImportance: 'important',
    companies: {
      // Primary vendors (Goal file — default ON)
      anthropic: true,
      openai: true,
      google: true,
      xai: true,
      // Secondary / optional vendors (Goal file — default OFF until user enables)
      meta: false,
      microsoft: false,
      mistral: false,
      amazon: false,
      hugging_face: false,
    },
  },
  directNewsWatch: {
    enabled: true,
    event: 'investment_access',
    reason: PRIORITY_RADAR_DIRECT_NEWS_REASON,
    sources: {
      anthropic: true,
      openai: false,
      google: false,
      xai: false,
      king_abdullah_schools: true,
    },
  },
};

const DEFAULT_PRIORITY_PROFILE = {
  enabled: true,
  summary: 'Major AI tool releases, Iran war relation to Jordan and the world, and very important political events stay in the high-priority lane.',
  priorityTopics: [
    'Major AI tool releases',
    'Iran war relation to Jordan and the world',
    'Very important political events',
  ],
  aiKeywords: [
    'major',
    'important',
    'tool',
    'tools',
    'release',
    'releases',
    'launch',
    'launches',
    'model',
    'models',
    'api',
    'notes',
    'feature',
    'features',
    'announcement',
  ],
  geoKeywords: [
    'iran',
    'jordan',
    'world',
    'war',
    'conflict',
    'risk',
    'escalat',
    'regional',
    'middle east',
  ],
  politicalKeywords: [
    'politic',
    'political',
    'government',
    'election',
    'policy',
    'parliament',
    'minister',
    'diplomacy',
    'summit',
    'assassination',
    'death',
    'leader',
    'state',
  ],
  releaseWatchCompanies: {
    anthropic: true,
    openai: true,
    google: true,
    xai: true,
    // Secondary vendors default OFF per Goal file
    meta: false,
    microsoft: false,
    mistral: false,
    amazon: false,
    hugging_face: false,
  },
  minImportance: 'important',
};

function normalizeReleaseWatchCompanies(companies = {}, useDefaults = false) {
  const normalized = {};
  const aliases = {
    gemini: 'google',
    grok: 'xai',
  };
  // When called with no explicit companies object (empty or missing), fall back
  // to the Goal-aligned defaults rather than enabling everything.
  const hasExplicitValues = companies && typeof companies === 'object' && Object.keys(companies).length > 0;

  for (const key of Object.keys(PRIORITY_RADAR_RELEASE_WATCH_COMPANIES)) {
    if (!hasExplicitValues || useDefaults) {
      // Apply Goal-file defaults: primary vendors ON, secondary vendors OFF
      normalized[key] = Boolean(DEFAULT_SETTINGS.releaseWatch.companies[key]);
    } else {
      normalized[key] = Object.prototype.hasOwnProperty.call(companies, key)
        ? companies[key] !== false
        : Boolean(DEFAULT_SETTINGS.releaseWatch.companies[key]);
    }
  }

  if (hasExplicitValues && !useDefaults) {
    for (const [rawKey, enabled] of Object.entries(companies)) {
      const key = aliases[rawKey] || rawKey;
      if (key in normalized) {
        normalized[key] = enabled !== false;
      }
    }
  }

  // Safety: if somehow every company is off, reset to primary defaults
  if (!Object.values(normalized).some(Boolean)) {
    for (const key of Object.keys(DEFAULT_SETTINGS.releaseWatch.companies)) {
      normalized[key] = Boolean(DEFAULT_SETTINGS.releaseWatch.companies[key]);
    }
  }

  return normalized;
}

function normalizeDirectNewsWatchSources(sources = {}) {
  const normalized = {};
  const hasExplicitValues = sources && typeof sources === 'object' && Object.keys(sources).length > 0;

  for (const reference of PRIORITY_RADAR_REFERENCE_POINTS) {
    normalized[reference.companyId] = hasExplicitValues
      ? sources[reference.companyId] === true
      : Boolean(DEFAULT_SETTINGS.directNewsWatch.sources[reference.companyId]);
  }

  if (!Object.values(normalized).some(Boolean)) {
    normalized.anthropic = true;
    normalized.king_abdullah_schools = true;
  }

  return normalized;
}

function normalizeReleaseWatchMinImportance(value, fallback = DEFAULT_SETTINGS.releaseWatch.minImportance) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE.includes(normalized) ? normalized : fallback;
}

function normalizePriorityProfile(value = {}, releaseWatch = DEFAULT_SETTINGS.releaseWatch, categories = DEFAULT_SETTINGS.categories) {
  const source = value && typeof value === 'object' ? value : {};
  const minImportance = normalizeReleaseWatchMinImportance(
    source.minImportance || DEFAULT_PRIORITY_PROFILE.minImportance,
    DEFAULT_PRIORITY_PROFILE.minImportance,
  );
  const priorityTopics = [...new Set([
    ...DEFAULT_PRIORITY_PROFILE.priorityTopics,
    ...(Array.isArray(source.priorityTopics) ? source.priorityTopics : []),
  ].map((entry) => String(entry || '').trim()).filter(Boolean))];

  return {
    enabled: source.enabled !== false,
    summary: String(source.summary || DEFAULT_PRIORITY_PROFILE.summary).trim(),
    minImportance,
    priorityTopics,
    aiKeywords: [...new Set([
      ...DEFAULT_PRIORITY_PROFILE.aiKeywords,
      ...(Array.isArray(source.aiKeywords) ? source.aiKeywords : []),
    ].map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))],
    geoKeywords: [...new Set([
      ...DEFAULT_PRIORITY_PROFILE.geoKeywords,
      ...(Array.isArray(source.geoKeywords) ? source.geoKeywords : []),
    ].map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))],
    politicalKeywords: [...new Set([
      ...DEFAULT_PRIORITY_PROFILE.politicalKeywords,
      ...(Array.isArray(source.politicalKeywords) ? source.politicalKeywords : []),
    ].map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))],
    releaseWatchCompanies: normalizeReleaseWatchCompanies(source.releaseWatchCompanies || releaseWatch.companies || DEFAULT_PRIORITY_PROFILE.releaseWatchCompanies),
    categories: {
      ai: categories.ai !== false,
      geo: Boolean(categories.geo),
    },
  };
}

function getImportanceRank(value) {
  const normalized = normalizeReleaseWatchMinImportance(value, 'important');
  return RELEASE_WATCH_IMPORTANCE_RANK[normalized] || RELEASE_WATCH_IMPORTANCE_RANK.important;
}

function normalizeSettings(value = {}) {
  const releaseWatch = value.releaseWatch || {};
  const directNewsWatch = value.directNewsWatch || {};
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...value,
    categories: {
      ...DEFAULT_SETTINGS.categories,
      ...(value.categories || {}),
    },
    releaseWatch: {
      ...DEFAULT_SETTINGS.releaseWatch,
      ...releaseWatch,
      minImportance: normalizeReleaseWatchMinImportance(releaseWatch.minImportance, DEFAULT_SETTINGS.releaseWatch.minImportance),
      companies: normalizeReleaseWatchCompanies(releaseWatch.companies || {}),
    },
    directNewsWatch: {
      ...DEFAULT_SETTINGS.directNewsWatch,
      ...directNewsWatch,
      enabled: directNewsWatch.enabled !== false,
      event: 'investment_access',
      reason: String(directNewsWatch.reason || PRIORITY_RADAR_DIRECT_NEWS_REASON).trim(),
      sources: normalizeDirectNewsWatchSources(directNewsWatch.sources || {}),
    },
  };
  normalized.priorityProfile = normalizePriorityProfile(
    value.priorityProfile,
    normalized.releaseWatch,
    normalized.categories,
  );

  if ((Number(normalized.version) || 0) < PRIORITY_RADAR_SETTINGS_VERSION) {
    normalized.version = PRIORITY_RADAR_SETTINGS_VERSION;
    normalized.profile = 'release-watch';
    // Reset to Goal-aligned defaults: primary vendors ON, secondary vendors OFF
    normalized.releaseWatch = {
      enabled: true,
      minImportance: DEFAULT_SETTINGS.releaseWatch.minImportance,
      companies: { ...DEFAULT_SETTINGS.releaseWatch.companies },
    };
    normalized.directNewsWatch = {
      ...DEFAULT_SETTINGS.directNewsWatch,
      sources: { ...DEFAULT_SETTINGS.directNewsWatch.sources },
    };
    normalized.priorityProfile = normalizePriorityProfile({}, normalized.releaseWatch, normalized.categories);
  }

  if (!normalized.categories.ai && !normalized.categories.geo) {
    normalized.categories.ai = true;
  }

  return normalized;
}

function emitRadarSettingsChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(PRIORITY_RADAR_EVENT));
}

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

export function loadPriorityRadarSettings() {
  const raw = readJsonStorage(PRIORITY_RADAR_SETTINGS_KEY, DEFAULT_SETTINGS);
  const normalized = normalizeSettings(raw);

  if (typeof window !== 'undefined' && JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeJsonStorage(PRIORITY_RADAR_SETTINGS_KEY, normalized);
  }

  return normalized;
}

export function getSeenPriorityAlertIds() {
  const ids = readJsonStorage(PRIORITY_RADAR_SEEN_KEY, []);
  return Array.isArray(ids) ? ids : [];
}

function setSeenPriorityAlertIds(ids) {
  writeJsonStorage(PRIORITY_RADAR_SEEN_KEY, ids.slice(0, 120));
}

export function markPriorityAlertsSeen(alerts) {
  if (!alerts?.length) {
    return;
  }

  const merged = [...new Set([...alerts.map((alert) => alert.id), ...getSeenPriorityAlertIds()])];
  setSeenPriorityAlertIds(merged);
}

export async function syncPriorityRadarWithNative(settings = loadPriorityRadarSettings()) {
  const selectedCompanies = Object.entries(settings.releaseWatch?.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);
  const effectiveMinImportance = settings.priorityProfile?.minImportance
    || settings.releaseWatch?.minImportance
    || DEFAULT_SETTINGS.releaseWatch.minImportance;
  const selectedDirectNewsSources = Object.entries(settings.directNewsWatch?.sources || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);

  return syncNativeRadarConfig({
    enabled: Boolean(settings.enabled),
    apiBase: resolveApiBase(),
    aiEnabled: Boolean(settings.categories?.ai),
    geoEnabled: Boolean(settings.categories?.geo),
    releaseWatchEnabled: Boolean(settings.categories?.ai && settings.releaseWatch?.enabled),
    releaseWatchCompanies: selectedCompanies.join(','),
    releaseWatchMinImportance: effectiveMinImportance,
    directNewsWatchEnabled: Boolean(settings.directNewsWatch?.enabled),
    directNewsWatchSources: selectedDirectNewsSources.join(','),
    priorityProfile: settings.priorityProfile || DEFAULT_PRIORITY_PROFILE,
  });
}

export async function savePriorityRadarSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  writeJsonStorage(PRIORITY_RADAR_SETTINGS_KEY, normalized);
  emitRadarSettingsChanged();
  await syncPriorityRadarWithNative(normalized);
  return normalized;
}

export async function fetchPriorityAlerts(limit = 6) {
  const settings = loadPriorityRadarSettings();
  const categories = settings.categories || {};
  return fetchPriorityAlertsByCategories(categories, limit);
}

export async function fetchPriorityAlertsByCategories(categories = {}, limit = 6) {
  const settings = loadPriorityRadarSettings();
  const authenticatedPayload = await fetchFilteredPriorityRadarFeed(limit, categories);
  if (authenticatedPayload?.success) {
    return {
      ...authenticatedPayload,
      source: authenticatedPayload.source || 'user-feed',
      alerts: filterAlertsBySettings(authenticatedPayload.alerts || [], settings),
    };
  }

  const publicPayload = await fetchPublicPriorityRadarFeed(limit, categories);
  if (publicPayload?.success) {
    return {
      ...publicPayload,
      alerts: filterAlertsBySettings(publicPayload.alerts || [], settings),
    };
  }

  return {
    success: false,
    error: publicPayload?.error || 'Unable to fetch radar alerts.',
    alerts: [],
  };
}

function normalizeAlertText(alert = {}) {
  return `${alert.title || ''} ${alert.summary || ''} ${alert.whyItMatters || ''} ${alert.source || ''}`.toLowerCase();
}

function matchesProfileKeywords(alert, keywords = []) {
  const text = normalizeAlertText(alert);
  return keywords.some((keyword) => text.includes(String(keyword || '').trim().toLowerCase()));
}

function getReleaseWatchMatches(alert) {
  const explicitCompany = String(
    alert?.releaseWatchCompany
      || alert?.release_watch_company
      || ''
  ).trim().toLowerCase();
  if (explicitCompany && PRIORITY_RADAR_RELEASE_WATCH_COMPANIES[explicitCompany]) {
    return [explicitCompany];
  }

  const text = normalizeAlertText(alert);
  const matches = [];

  for (const [companyKey, definition] of Object.entries(PRIORITY_RADAR_RELEASE_WATCH_COMPANIES)) {
    if (definition.patterns.some((pattern) => pattern.test(text))) {
      matches.push(companyKey);
    }
  }

  return matches;
}

function getReleaseWatchSummary(settings = loadPriorityRadarSettings()) {
  const releaseWatch = settings.releaseWatch || DEFAULT_SETTINGS.releaseWatch;
  if (!releaseWatch.enabled) {
    return 'Broader AI release signal';
  }

  const selectedCompanies = Object.entries(releaseWatch.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => PRIORITY_RADAR_RELEASE_WATCH_COMPANIES[companyKey]?.label || companyKey);

  if (!selectedCompanies.length) {
    return 'Official AI release watch';
  }

  return `Official releases from ${selectedCompanies.join(', ')}`;
}

function meetsReleaseWatchImportance(alert, minImportance) {
  const requiredRank = getImportanceRank(minImportance);
  const alertRank = getImportanceRank(alert?.importance || 'important');
  return alertRank >= requiredRank;
}

function filterAlertsBySettings(alerts, settings) {
  const releaseWatch = settings.releaseWatch || DEFAULT_SETTINGS.releaseWatch;
  const priorityProfile = settings.priorityProfile || DEFAULT_PRIORITY_PROFILE;
  const effectiveMinImportance = priorityProfile.minImportance || releaseWatch.minImportance;
  const selectedCompanies = Object.entries(releaseWatch.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);
  const directNewsWatch = settings.directNewsWatch || DEFAULT_SETTINGS.directNewsWatch;
  const selectedDirectNewsSources = Object.entries(directNewsWatch.sources || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);

  return alerts.filter((alert) => {
    if (alert.category === 'ai') {
      if (!settings.categories.ai) {
        return false;
      }

      if (String(alert.release_watch_signal || '').toLowerCase() === 'direct_news_notification') {
        if (!directNewsWatch.enabled) {
          return false;
        }

        const sourceId = String(
          alert.direct_notification_source_id
            || alert.release_watch_company
            || ''
        ).trim().toLowerCase();
        return !selectedDirectNewsSources.length || selectedDirectNewsSources.includes(sourceId);
      }

      if (!releaseWatch.enabled) {
        return true;
      }

      if (!selectedCompanies.length) {
        return meetsReleaseWatchImportance(alert, effectiveMinImportance);
      }

      if (
        !alert.official_source
        || String(alert.release_watch_signal || '').toLowerCase() !== 'official_release'
      ) {
        return false;
      }

      const matches = getReleaseWatchMatches(alert);
      if (!matches.some((companyKey) => selectedCompanies.includes(companyKey))) {
        return false;
      }

      return meetsReleaseWatchImportance(alert, effectiveMinImportance);
    }

    if (alert.category === 'geo') {
      if (!settings.categories.geo) {
        return false;
      }

      if (priorityProfile.enabled !== false) {
        const geoMatches = [
          ...(Array.isArray(priorityProfile.geoKeywords) ? priorityProfile.geoKeywords : []),
          ...(Array.isArray(priorityProfile.politicalKeywords) ? priorityProfile.politicalKeywords : []),
        ].filter(Boolean);

        if (geoMatches.length && !matchesProfileKeywords(alert, geoMatches)) {
          return false;
        }
      }

      return true;
    }

    return false;
  });
}

function summarizeAlerts(alerts) {
  if (alerts.length === 1) {
    const [alert] = alerts;
    const label = alert.category === 'geo'
      ? `${alert.threatLevel || 'Elevated'} threat`
      : `${(alert.importance || 'important').toUpperCase()} AI alert`;

    return {
      title: `eXplore radar: ${label}`,
      body: alert.title,
    };
  }

  const preview = alerts
    .slice(0, 2)
    .map((alert) => alert.title)
    .join(' | ');

  return {
    title: `eXplore radar: ${alerts.length} new important alerts`,
    body: preview,
  };
}

function buildNotificationPayload(alerts) {
  if (alerts.length === 1) {
    return {
      alertId: alerts[0].id,
      category: alerts[0].category,
      route: 'priority-radar-detail',
      deepLink: buildPriorityRadarDeepLink(alerts[0].id),
    };
  }

  return {
    route: 'priority-radar',
    deepLink: buildPriorityRadarDeepLink(),
  };
}

export async function runPriorityRadarCheck(options = {}) {
  const {
    requestPermission = false,
    includeSeen = false,
    force = false,
  } = options;

  const settings = loadPriorityRadarSettings();
  if (!settings.enabled && !force) {
    return { ok: false, message: 'Priority radar is turned off.', alerts: [] };
  }

  let notificationState = await getNotificationState();
  if (!notificationState.supported) {
    return { ok: false, message: 'Notifications are not supported on this device.', alerts: [] };
  }

  if (notificationState.permission !== 'granted' && requestPermission) {
    notificationState = await requestNotificationAccess();
  }

  const payload = await fetchPriorityAlerts(6);
  if (!payload?.success) {
    return {
      ok: false,
      message: payload?.error || 'Unable to fetch radar alerts right now.',
      alerts: [],
      state: notificationState,
    };
  }

  const filteredAlerts = filterAlertsBySettings(payload.alerts || [], settings);
  const seenIds = new Set(getSeenPriorityAlertIds());
  const freshAlerts = includeSeen
    ? filteredAlerts
    : filteredAlerts.filter((alert) => !seenIds.has(alert.id));

  if (!freshAlerts.length) {
    if (Capacitor.isNativePlatform() && settings.enabled) {
      await performNativeRadarCheck();
    }

    return {
      ok: true,
      message: 'No new high-priority alerts right now.',
      alerts: [],
      state: notificationState,
    };
  }

  if (notificationState.permission !== 'granted') {
    return {
      ok: false,
      message: 'Notification permission is still turned off.',
      alerts: freshAlerts,
      state: notificationState,
    };
  }

  const toNotify = freshAlerts.slice(0, 3);
  const summary = summarizeAlerts(toNotify);
  const notificationResult = await sendPriorityNotification({
    ...summary,
    data: buildNotificationPayload(toNotify),
  });

  if (notificationResult.ok) {
    markPriorityAlertsSeen(toNotify);
  }

  return {
    ok: notificationResult.ok,
    message: notificationResult.ok
      ? `Sent ${toNotify.length} priority alert${toNotify.length === 1 ? '' : 's'}.`
      : notificationResult.message,
    alerts: toNotify,
    state: notificationResult.state || notificationState,
  };
}

export function getPriorityRadarReleaseWatchCompanies(settings = loadPriorityRadarSettings()) {
  const releaseWatch = settings.releaseWatch || DEFAULT_SETTINGS.releaseWatch;
  return Object.entries(releaseWatch.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => ({
      key: companyKey,
      label: PRIORITY_RADAR_RELEASE_WATCH_COMPANIES[companyKey]?.label || companyKey,
    }));
}

export function getPriorityRadarReleaseWatchSummary(settings = loadPriorityRadarSettings()) {
  return getReleaseWatchSummary(settings);
}

export function getPriorityRadarReleaseWatchMinImportance(settings = loadPriorityRadarSettings()) {
  return normalizeReleaseWatchMinImportance(
    settings?.priorityProfile?.minImportance || settings?.releaseWatch?.minImportance,
    DEFAULT_SETTINGS.releaseWatch.minImportance,
  );
}

export function describePriorityRadarReleaseWatchMinImportance(minImportance) {
  const normalized = normalizeReleaseWatchMinImportance(minImportance, DEFAULT_SETTINGS.releaseWatch.minImportance);
  const option = PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE_OPTIONS.find((entry) => entry.value === normalized);
  return option?.description || PRIORITY_RADAR_RELEASE_MIN_IMPORTANCE_OPTIONS[0].description;
}

export function isPriorityRadarReleaseWatchAlert(alert, settings = loadPriorityRadarSettings()) {
  const releaseWatch = settings.releaseWatch || DEFAULT_SETTINGS.releaseWatch;
  if (!releaseWatch.enabled || alert?.category !== 'ai') {
    return false;
  }

  const selectedCompanies = Object.entries(releaseWatch.companies || {})
    .filter(([, enabled]) => enabled)
    .map(([companyKey]) => companyKey);

  if (!selectedCompanies.length) {
    return false;
  }

  return getReleaseWatchMatches(alert).some((companyKey) => selectedCompanies.includes(companyKey));
}

export function getPriorityRadarDirectNewsSources(settings = loadPriorityRadarSettings()) {
  const sources = settings.directNewsWatch?.sources || DEFAULT_SETTINGS.directNewsWatch.sources;
  return PRIORITY_RADAR_REFERENCE_POINTS
    .filter((reference) => sources[reference.companyId])
    .map((reference) => ({
      key: reference.companyId,
      label: reference.publisher,
    }));
}

export function getPriorityRadarDirectNewsReason(settings = loadPriorityRadarSettings()) {
  return String(settings.directNewsWatch?.reason || PRIORITY_RADAR_DIRECT_NEWS_REASON).trim();
}
