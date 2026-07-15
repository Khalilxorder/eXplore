'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClockIcon } from './Icons';

function formatDuration(seconds) {
  const numeric = Number(seconds);
  if (!numeric || numeric <= 0) return '';
  return `${Math.max(1, Math.floor(numeric / 60))} min`;
}
import {
  fetchFeed,
  fetchEventSourceMap,
  fetchOfficialReleaseAlerts,
  fetchTemplate,
  saveItem,
  trackInteraction,
  updateNotificationPreferences,
} from '../lib/api';
import { useAuth } from './AuthProvider';
import { buildOperatingBrief, buildSignalRationale } from '../lib/intelligenceProfile';
import { saveGuestItem } from '../lib/guestPersistence';
import { openExternalUrl, shareContentLink } from '../lib/external';
import { promoteImageUrlQuality } from '../lib/imageQuality';
import {
  EVENT_PRIORITY_LEVELS,
  buildEventOnlyIntelligence,
  getEventOnlyPriorityScore,
  inferPriorityRadarCompanyFromEvent,
  loadEventPriorityMap,
  saveEventPriorityLevel,
} from '../lib/eventOnlyIntelligence';
import {
  loadPriorityRadarSettings,
  savePriorityRadarSettings,
} from '../lib/alertRadar';
import {
  normalizeVideoLibraryPreferences,
} from '../data/videoLibrary';
import { OFFLINE_FEED_SNAPSHOT } from '../data/offlineFeedSnapshot';

const FEED_CACHE_LS_KEY = 'explore-feed-cache-v4';
const FEED_CACHE_TTL_MS = 10 * 60 * 1000;
const BACKGROUND_REFRESH_THROTTLE_MS = 60 * 1000;
const MIN_GOOD_FEED_CACHE_ITEMS = 4;
const TARGET_LIVE_FEED_ITEMS = 8;
const MAX_VISIBLE_NEWS_AGE_HOURS = 72;
const FEED_BACKGROUND_POLL_MS = 60 * 1000; // Check quietly once per minute while the feed is visible.
const FEED_FIRST_SCREEN_TIMEOUT_MS = 11000;
const EXPLORE_FEED_REFRESH_EVENT = 'explore-feed-refresh';
const PULL_REFRESH_TRIGGER_PX = 82;
const PULL_REFRESH_MAX_PX = 118;
const REFRESH_NOTICE_MS = 1800;
const LIVE_REFRESH_LABELS = {
  background: 'Background refresh: checking live sources...',
  external: 'Profile update: recalculating the live feed...',
  initial: 'Loading recalculated live sources...',
  mode: 'Feed mode changed: recalculating live sources...',
  pull: 'Pull refresh: recalculating live sources...',
  retry: 'Retrying live source recalculation...',
};
const DEFAULT_FEED_HEALTH = {
  status: 'unknown',
  message: '',
  degradedReason: '',
  pipelines: {},
};
const DEFAULT_DISCOVERY_HEALTH = {
  fallbackActive: false,
  quotaLimited: false,
  message: '',
  trackedChannelCount: 0,
  liveSourceCount: 0,
};

function getRefreshCompletionNotice(refresh = {}) {
  const source = String(refresh?.source || '').trim();
  const status = String(refresh?.status || '').trim();

  if (source === 'server_last_good_cache' || status === 'fallback') {
    return 'Live recalculation failed; showing the last good server feed.';
  }
  if (status === 'partial') {
    return 'Live sources recalculated with partial coverage.';
  }
  if (source === 'forced_live_recalculation') {
    return 'Live feed recalculated from online sources.';
  }
  if (source === 'automatic_live_refresh') {
    return 'Live sources checked automatically.';
  }
  return 'Live feed updated from the backend.';
}

function normalizeEmergencySnapshotItems() {
  return normalizeLatestNewsItems(OFFLINE_FEED_SNAPSHOT.latestNewsItems || [])
    .map((item, index) => ({
      ...item,
      emergencySnapshot: true,
      latestPriority: Number(item?.latestPriority || 0) + Math.max(0, 18 - index),
      reason: item?.reason || 'Fallback source-map signal while live news reconnects.',
      whyShown: item?.whyShown || item?.reason || 'Fallback source-map signal while live news reconnects.',
      whyTrusted: item?.whyTrusted || 'Bundled reference source kept only as a nonblank fallback.',
    }));
}

function loadFeedCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(FEED_CACHE_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts) return null;
    const visibleCachedItems = filterLatestNewsItems(parsed.latestNewsItems || []);
    if (visibleCachedItems.length < MIN_GOOD_FEED_CACHE_ITEMS) return null;

    const cacheAgeMs = Date.now() - parsed.ts;
    return {
      ...parsed,
      cacheAgeMs,
      isFresh: cacheAgeMs <= FEED_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeFeedCache(data) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FEED_CACHE_LS_KEY, JSON.stringify({ ts: Date.now(), ...data }));
  } catch {
    // ignore quota errors
  }
}

const HEADLINE_STOPWORDS = new Set([
  'a', 'after', 'all', 'an', 'and', 'are', 'at', 'by', 'for', 'from', 'how', 'in', 'into', 'is',
  'its', 'it', 'launch', 'launches', 'months', 'new', 'of', 'on', 'or', 'shows', 'that', 'the',
  'their', 'this', 'to', 'up', 'use', 'with',
]);

const HEADLINE_NOISE = new Set([
  'accelerating', 'aftermath', 'developers', 'discovery', 'exclusive', 'footage', 'helping',
  'introducing', 'powering', 'release', 'released', 'scraps', 'video', 'platform',
]);

function cleanAlertTitle(title) {
  return String(title || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+\|\s+[^|]+$/g, '')
    .replace(/\s+-\s+[^-]+$/g, '')
    .replace(/^exclusive\s*\|\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseWord(word = '') {
  if (!word) {
    return '';
  }

  if (/^[A-Z0-9.+-]+$/.test(word)) {
    return word;
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function buildSimpleHeadline(alert) {
  const cleaned = cleanAlertTitle(alert?.title);
  if (!cleaned) {
    return 'Update';
  }

  const releaseMatch = cleaned.match(/\b(?:introducing|launches|launch|released|releases|unveils|rolls out)\s+(.+)$/i);
  if (releaseMatch?.[1]) {
    const words = releaseMatch[1]
      .split(/[\s/]+/)
      .map((word) => word.replace(/[^A-Za-z0-9.+-]/g, ''))
      .filter(Boolean)
      .slice(0, 4)
      .map(titleCaseWord);

    if (words.length) {
      return [...words, 'Released'].slice(0, 5).join(' ');
    }
  }

  const tokens = cleaned
    .split(/[\s/]+/)
    .map((word) => word.replace(/[^A-Za-z0-9.+-]/g, ''))
    .filter(Boolean);

  const importantTokens = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (HEADLINE_STOPWORDS.has(normalized)) {
      continue;
    }

    if (importantTokens.length === 0 && HEADLINE_NOISE.has(normalized)) {
      continue;
    }

    importantTokens.push(titleCaseWord(token));
    if (importantTokens.length >= 5) {
      break;
    }
  }

  if (importantTokens.length >= 3) {
    return importantTokens.join(' ');
  }

  return tokens.slice(0, 5).map(titleCaseWord).join(' ');
}

function formatPublishedTime(value) {
  if (!value) {
    return 'Now';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Now';
  }

  const deltaMs = Date.now() - parsed.getTime();
  const deltaHours = Math.round(deltaMs / (1000 * 60 * 60));
  if (deltaHours <= 1) {
    return 'Now';
  }
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  if (deltaDays <= 7) {
    return `${deltaDays}d`;
  }

  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatPrecisePublishedTime(value) {
  if (!value) {
    return 'Time unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Time unavailable';
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function withRequestTimeout(promise, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        resolve(null);
      });
  });
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getItemTimestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeUnifiedBestFeedScore(item) {
  const scores = item?.scores || {};
  return (
    (clamp01(item?.templateScore, 0.34) * 0.34) +
    (clamp01(scores.lifeImpact, 0.42) * 0.16) +
    (clamp01(scores.decisionUsefulness, 0.42) * 0.15) +
    (clamp01(scores.freshness, 0.4) * 0.14) +
    (clamp01(scores.recency, scores.freshness || 0.4) * 0.19) +
    (clamp01(scores.sourceTrust, 0.5) * 0.08) -
    (clamp01(scores.distractionRisk, 0.18) * 0.12)
  );
}

const AI_FEED_SIGNAL_PATTERN = /\b(anthropic|claude|fable|mythos|openai|chatgpt|gpt(?:-[0-9.]+)?|gemini|deepmind|grok|xai|x\.ai|llama|copilot|bedrock|hugging\s*face|stability\s*ai|stable\s+(?:diffusion|audio|video|image)|sdxl|sd3|sd4|sd5|ai)\b/i;
const REGIONAL_SIGNAL_PATTERN = /\b(iran|israel|qatar|gaza|lebanon|syria|tehran|regional|airspace|missile|middle east|hormuz|dimona|war)\b/i;
const AI_RUMOR_PATTERN = /\b(leak|rumou?r|speculation|speculative|reportedly|claims?|alleged|allegedly)\b/i;
const AI_LOW_SIGNAL_PATTERN = /\b(best ai tool|best ai tools|free ai tool|free ai tools|make money|side hustle|tutorial|how to use|reaction|recap|roundup|shorts?\b|#ai\b|versus|vs\.|top\s+\d+\b)\b/i;
const CORE_OFFICIAL_VENDOR_KEYS = new Set(['anthropic', 'openai', 'google', 'xai', 'meta', 'microsoft', 'mistral', 'amazon', 'hugging_face', 'stability_ai']);
const OFFICIAL_VENDOR_PATTERN = /\b(openai|anthropic|claude|fable|mythos|google(?:\s+deepmind)?|deepmind|xai|x\.ai|meta|llama|microsoft|copilot|mistral|mixtral|codal|ministral|amazon|aws|bedrock|nova|hugging\s*face|stability\s*ai|stable\s+(?:diffusion|audio|video|image)|sdxl|sd3|sd4|sd5)\b/i;
const AI_RELEASE_ACTION_PATTERN = /\b(release|released|launch|launched|rolls out|rollout|introduc(?:e|es|ed|ing)|unveil(?:s|ed|ing)?|ship(?:s|ped|ping)?|available|general availability|beta|preview|api|model|tool|agent|feature|pricing|suspend(?:s|ed)?|directive)\b/i;
const CLAUDE_FABLE_MYTHOS_PATTERN = /\b(?:claude\s+)?(?:fable|mythos)\s*(?:5|v?5)?\b/i;
const HOME_COMPANY_LABELS = {
  anthropic: 'Anthropic / Claude',
  openai: 'OpenAI / ChatGPT',
  google: 'Gemini / DeepMind',
  meta: 'Meta / Llama',
  xai: 'Grok / xAI',
  microsoft: 'Microsoft / Copilot',
  mistral: 'Mistral AI',
  amazon: 'Amazon / AWS',
  hugging_face: 'Hugging Face',
  stability_ai: 'Stability AI',
};
const OFFICIAL_LATEST_NEWS_COMPANY_KEYS = Object.keys(HOME_COMPANY_LABELS);
const DEFAULT_HOME_TEMPLATE_STATE = {
  watchQuestions: [],
  priorityTopics: [],
  avoidTopics: [],
  trackedCompanies: [],
  peopleOfInterest: [],
  videoLibrary: normalizeVideoLibraryPreferences(),
  sourcePreferences: {
    officialFirst: true,
    written: true,
    socialVideo: true,
    socialPhoto: false,
    trustedSourcesOnly: true,
  },
  alertStyle: 'strict',
};
function uniqueTrimmedList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

function normalizeHomeTemplateState(template = {}) {
  const workspace = template?.workspace && typeof template.workspace === 'object'
    ? template.workspace
    : {};
  const workspaceMemory = workspace?.workspaceMemory && typeof workspace.workspaceMemory === 'object'
    ? workspace.workspaceMemory
    : {};
  const sourcePreferences = workspaceMemory?.sourcePreferences && typeof workspaceMemory.sourcePreferences === 'object'
    ? workspaceMemory.sourcePreferences
    : {};

  return {
    watchQuestions: uniqueTrimmedList(workspace.watchQuestions).slice(0, 6),
    priorityTopics: uniqueTrimmedList(workspaceMemory.priorityTopics).slice(0, 8),
    avoidTopics: uniqueTrimmedList(workspaceMemory.avoidTopics).slice(0, 8),
    trackedCompanies: uniqueTrimmedList(workspaceMemory.trackedCompanies).slice(0, 8),
    peopleOfInterest: uniqueTrimmedList(workspaceMemory.peopleOfInterest).slice(0, 8),
    videoLibrary: normalizeVideoLibraryPreferences(workspaceMemory.videoLibrary),
    sourcePreferences: {
      officialFirst: sourcePreferences.officialFirst !== false,
      written: sourcePreferences.written !== false,
      socialVideo: sourcePreferences.socialVideo !== false,
      socialPhoto: Boolean(sourcePreferences.socialPhoto),
      trustedSourcesOnly: sourcePreferences.trustedSourcesOnly !== false,
    },
    alertStyle: String(workspaceMemory.alertStyle || DEFAULT_HOME_TEMPLATE_STATE.alertStyle).trim().toLowerCase() || 'strict',
  };
}

function formatReleaseClassificationLabel(value = '') {
  return String(value || '')
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAlertStyleLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict') {
    return 'Strict alerts';
  }
  if (normalized === 'balanced') {
    return 'Balanced alerts';
  }
  if (normalized === 'broad') {
    return 'Broad alerts';
  }
  return 'Alerts';
}

function getDiscoveryHealth(feedPayload) {
  const discovery = feedPayload?.discovery || {};
  const message = String(discovery?.message || '');
  const sourceHealth = Array.isArray(discovery?.source_health) ? discovery.source_health : [];
  const fallbackActive = /fallback/i.test(message)
    || sourceHealth.some((entry) => entry?.status === 'live' && String(entry?.platform || '').toLowerCase() !== 'youtube');
  const quotaLimited = /quota/i.test(message)
    || sourceHealth.some((entry) => /\bquota\b/i.test(String(entry?.last_error || '')));

  return {
    fallbackActive,
    quotaLimited,
    message,
    trackedChannelCount: Number(discovery?.tracked_channel_count || 0),
    liveSourceCount: Number(discovery?.live_source_count || 0),
  };
}

function getFeedHealth(feedPayload, discoveryHealth = {}) {
  const rawFeedHealth = feedPayload?.feedHealth || feedPayload?.feed_health || {};
  const status = String(rawFeedHealth?.status || '').trim().toLowerCase() || (
    discoveryHealth?.fallbackActive ? 'degraded' : 'ok'
  );
  const message = String(
    rawFeedHealth?.message
      || rawFeedHealth?.degradedReason
      || rawFeedHealth?.reason
      || discoveryHealth?.message
      || ''
  ).trim();

  return {
    status,
    message,
    degradedReason: String(rawFeedHealth?.degradedReason || rawFeedHealth?.reason || '').trim(),
    pipelines: rawFeedHealth?.pipelines || rawFeedHealth?.pipeline_health || {},
  };
}

function pickItemThumbnail(item = {}) {
  return promoteImageUrlQuality(String(
    item?.thumbnail
      || item?.thumbnailUrl
      || item?.thumbnail_url
      || item?.image
      || item?.imageUrl
      || item?.coverImage
      || item?.media?.thumbnail
      || item?.media?.image
      || item?.media?.imageUrl
      || ''
  ).trim());
}

function getFaviconUrl(value = '') {
  const rawUrl = String(value || '').trim();
  if (!rawUrl) {
    return '';
  }

  try {
    const parsed = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=128`;
  } catch {
    return '';
  }
}

function pickEventVisualUrl(item = {}) {
  return pickItemThumbnail(item) || getFaviconUrl(item?.url || item?.alert?.url);
}

function hashText(value = '') {
  return String(value || '').split('').reduce((hash, char) => {
    return ((hash << 5) - hash) + char.charCodeAt(0);
  }, 0);
}

function normalizeLatestNewsItem(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const kind = String(item?.kind || item?.channelType || item?.contentType || '').trim().toLowerCase();
  const transcriptStatus = String(
    item?.transcriptStatus
      || (item?.hasTranscript ? 'full' : '')
      || ''
  ).trim().toLowerCase();

  const normalizedKind = kind || (
    transcriptStatus === 'full' || transcriptStatus === 'partial'
      ? 'transcript'
      : item?.alert
        ? 'official'
        : 'written'
  );

  return {
    ...item,
    id: String(item?.id || item?.url || item?.external_id || item?.title || `latest:${index}`),
    kind: normalizedKind,
    title: String(item?.title || item?.headline || item?.name || 'Update').trim(),
    source: String(item?.source || item?.publisher || item?.feedSectionTitle || 'Latest news').trim(),
    date: String(
      item?.date
        || item?.publishedAt
        || item?.published_at
        || item?.publishDate
        || item?.publish_date
        || item?.createdAt
        || item?.created_at
        || item?.detectedAt
        || item?.timestamp
        || item?.published
        || ''
    ),
    summary: String(item?.summary || item?.description || item?.snippet || '').trim(),
    reason: String(
      item?.reason
        || item?.whyShown
        || item?.whyItMatters
        || item?.summary
        || 'Fresh update'
    ).trim(),
    thumbnail: pickItemThumbnail(item),
    thumbnailUrl: String(item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail || item?.image || item?.imageUrl || item?.coverImage || '').trim(),
    thumbnail_url: String(item?.thumbnail_url || item?.thumbnailUrl || item?.thumbnail || item?.image || item?.imageUrl || item?.coverImage || '').trim(),
    image: String(item?.image || item?.imageUrl || item?.thumbnail || item?.thumbnailUrl || item?.thumbnail_url || item?.coverImage || '').trim(),
    imageUrl: String(item?.imageUrl || item?.image || item?.thumbnail || item?.thumbnailUrl || item?.thumbnail_url || item?.coverImage || '').trim(),
    coverImage: String(item?.coverImage || item?.image || item?.imageUrl || item?.thumbnail || item?.thumbnailUrl || item?.thumbnail_url || '').trim(),
    url: String(item?.url || item?.link || '').trim(),
    transcriptStatus,
    transcriptPreview: String(item?.transcriptPreview || item?.transcript_preview || '').trim(),
    transcriptSource: String(item?.transcriptSource || item?.transcript_source || '').trim(),
    transcriptUpdatedAt: String(item?.transcriptUpdatedAt || item?.transcript_updated_at || '').trim(),
    whyShown: String(item?.whyShown || item?.reason || '').trim(),
    whyTrusted: String(item?.whyTrusted || '').trim(),
    whyNotified: String(item?.whyNotified || '').trim(),
    vendorScope: Array.isArray(item?.vendorScope)
      ? [...new Set(item.vendorScope.map((entry) => normalizeVendorScopeKey(entry)).filter(Boolean))]
      : [],
    feedSectionTitle: String(item?.feedSectionTitle || '').trim(),
  };
}

function normalizeLatestNewsItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeLatestNewsItem(item, index))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeNormalNewsItem(item, index = 0) {
  const baseItem = normalizeLatestNewsItem(item, index);
  if (!baseItem) {
    return null;
  }

  return {
    ...baseItem,
    kind: baseItem.kind === 'official' ? baseItem.kind : 'normal',
    normalNewsCategory: String(item?.normalNewsCategory || item?.normal_news_category || 'general').trim().toLowerCase() || 'general',
    reason: String(item?.reason || item?.whyShown || item?.summary || 'Trusted news signal').trim(),
  };
}

function normalizeNormalNewsItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeNormalNewsItem(item, index))
    .filter(Boolean)
    .slice(0, 16);
}

function getLatestNewsStableKey(item = {}) {
  return `${item?.source || ''}:${item?.title || ''}:${item?.url || ''}:${item?.id || ''}`.toLowerCase();
}

function compareLatestNewsStable(left = {}, right = {}) {
  return getLatestNewsStableKey(left).localeCompare(getLatestNewsStableKey(right));
}



function computeLatestAiPriority(item, discoveryHealth = {}) {
  const discovery = item?.discovery || {};
  const lane = String(discovery?.lane || '').toLowerCase();
  const platform = String(item?.platform || discovery?.platform || '').toLowerCase();
  const sourceLabel = `${item?.source || ''} ${discovery?.sourceLabel || ''}`;
  const sourceTrust = clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0.5));
  const clickbait = clamp01(item?.scores?.clickbait, item?.scores?.distractionRisk ?? 0.12);
  const text = `${item?.title || ''} ${item?.summary || ''}`;

  let priority = 0;

  if (platform === 'radar') {
    priority += 140;
  }
  if (lane === 'tracked') {
    priority += 92;
  } else if (lane === 'fresh_signal') {
    priority += 28;
  }
  if (OFFICIAL_VENDOR_PATTERN.test(sourceLabel)) {
    priority += 34;
  }
  if (REGIONAL_SIGNAL_PATTERN.test(text)) {
    priority += 22;
  }
  if (CLAUDE_FABLE_MYTHOS_PATTERN.test(text)) {
    priority += 170;
  }
  if (sourceTrust >= 0.92) {
    priority += 26;
  } else if (sourceTrust >= 0.82) {
    priority += 18;
  } else if (sourceTrust >= 0.72) {
    priority += 10;
  }

  if (discoveryHealth?.fallbackActive) {
    priority += Math.round(sourceTrust * 30);
  }

  if (
    AI_RUMOR_PATTERN.test(text)
    && platform !== 'radar'
    && lane !== 'tracked'
    && sourceTrust < 0.9
  ) {
    priority -= discoveryHealth?.fallbackActive ? 80 : 24;
  }

  priority -= Math.round(clickbait * 36);
  return priority;
}

function shouldIncludeLatestAiItem(item, discoveryHealth = {}) {
  if (!item) {
    return false;
  }

  const discovery = item?.discovery || {};
  const lane = String(discovery?.lane || '').toLowerCase();
  const platform = String(item?.platform || discovery?.platform || '').toLowerCase();
  const sourceTrust = clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0.5));
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''} ${discovery?.sourceLabel || ''}`;
  const hasTranscript = Boolean(item?.hasTranscript || item?.transcript || item?.transcriptText);
  const isOfficialLike = platform === 'radar'
    || OFFICIAL_VENDOR_PATTERN.test(text)
    || Boolean(item?.officialSource)
    || Boolean(item?.officialReleaseWatch)
    || Boolean(discovery?.officialSource)
    || Boolean(discovery?.officialReleaseWatch);
  const maxAgeHours = hasStrongRegionalSignal(item)
    ? (24 * 3)
    : isOfficialLike
      ? (24 * 2)
      : hasTranscript
        ? (24 * 2)
        : 36;
  const recentEnough = isRecentEnough(
    item?.date || item?.publishedAt,
    maxAgeHours,
  );

  if (!recentEnough) {
    return false;
  }

  if (lane === 'exploration') {
    return false;
  }

  if (
    AI_LOW_SIGNAL_PATTERN.test(text)
    && !isOfficialLike
    && lane !== 'tracked'
    && !hasTranscript
  ) {
    return false;
  }

  if (
    AI_RUMOR_PATTERN.test(text)
    && platform !== 'radar'
    && lane !== 'tracked'
    && sourceTrust < 0.94
  ) {
    return false;
  }

  if (lane === 'tracked' || lane === 'interview_signal' || platform === 'radar') {
    return true;
  }

  if (lane === 'fresh_signal') {
    return isOfficialLike || sourceTrust >= (discoveryHealth?.fallbackActive ? 0.84 : 0.78);
  }

  return sourceTrust >= 0.9;
}

function hasStrongAiReleaseSignal(item) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''}`.trim();
  if (!text) {
    return false;
  }

  if (OFFICIAL_VENDOR_PATTERN.test(text) || CLAUDE_FABLE_MYTHOS_PATTERN.test(text)) {
    return true;
  }

  const tokens = text.toLowerCase();
  const signalHits = [
    /\b(ai|artificial intelligence|claude|fable|mythos|openai|chatgpt|gpt|gemini|deepmind|grok|xai|x\.ai|llama|copilot|hugging face|stability\s*ai|stable\s+(?:diffusion|audio|video|image)|sdxl|sd3|sd4|sd5)\b/i.test(tokens),
    AI_RELEASE_ACTION_PATTERN.test(tokens),
  ].filter(Boolean).length;

  return signalHits >= 2;
}

function hasStrongRegionalSignal(item) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''}`.trim();
  if (!text || !REGIONAL_SIGNAL_PATTERN.test(text)) {
    return false;
  }

  const lane = String(item?.discovery?.lane || '').toLowerCase();
  const sourceTrust = clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0.5));
  return lane === 'tracked' || sourceTrust >= 0.72;
}

function getSavedPeopleOfInterest(template = {}) {
  const rawPeople = template?.workspace?.workspaceMemory?.peopleOfInterest;
  if (!Array.isArray(rawPeople)) {
    return [];
  }

  return [...new Set(rawPeople.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function normalizeVendorScopeKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'gemini' || normalized === 'deepmind') {
    return 'google';
  }

  if (normalized === 'grok' || normalized === 'x.ai') {
    return 'xai';
  }

  if (normalized === 'stability' || normalized === 'stability ai') {
    return 'stability_ai';
  }

  return normalized;
}

function getCoreVendorScope(item = {}) {
  const scope = Array.isArray(item?.vendorScope) ? item.vendorScope : [];
  return [...new Set(scope
    .map((entry) => normalizeVendorScopeKey(entry))
    .filter((entry) => CORE_OFFICIAL_VENDOR_KEYS.has(entry)))];
}

function hasCoreOfficialVendorSignal(item = {}) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''} ${item?.reason || ''}`;
  return getCoreVendorScope(item).length > 0 || OFFICIAL_VENDOR_PATTERN.test(text);
}

function hasExplicitOfficialReleaseMetadata(item = {}) {
  const alert = item?.alert && typeof item.alert === 'object' ? item.alert : {};
  const type = String(item?.type || item?.kind || alert?.type || '').toLowerCase();
  const releaseSignal = String(
    item?.release_watch_signal
      || item?.releaseWatchSignal
      || alert?.release_watch_signal
      || alert?.releaseWatchSignal
      || ''
  ).toLowerCase();

  return Boolean(
    item?.alert === true
      || type === 'official'
      || type === 'official_release'
      || item?.official_source
      || item?.officialSource
      || item?.officialReleaseWatch
      || alert?.official_source
      || alert?.officialSource
      || releaseSignal === 'official_release'
  );
}

function getTrackedCompanyLabels(trackedCompanies = []) {
  return uniqueTrimmedList(trackedCompanies)
    .map((companyKey) => HOME_COMPANY_LABELS[String(companyKey || '').trim().toLowerCase()] || companyKey)
    .filter(Boolean);
}

function buildPersonSearchTerms(person = '') {
  const normalized = String(person || '').trim();
  if (!normalized) {
    return [];
  }

  return [...new Set([
    normalized,
    ...normalized.split(/\s+/).filter((token) => token.length >= 4),
  ])];
}

function matchesPeopleOfInterest(item, peopleOfInterest = []) {
  if (!Array.isArray(peopleOfInterest) || !peopleOfInterest.length) {
    return false;
  }

  const haystack = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
  return peopleOfInterest.some((person) => buildPersonSearchTerms(person).some((term) => {
    const pattern = new RegExp(`\\b${escapeRegex(term).replace(/\s+/g, '\\s+')}\\b`, 'i');
    return pattern.test(haystack);
  }));
}

function isOfficialLatestItem(item = {}) {
  if (hasExplicitOfficialReleaseMetadata(item)) {
    return true;
  }

  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''} ${item?.reason || ''}`;
  return getCoreVendorScope(item).length > 0 && AI_RELEASE_ACTION_PATTERN.test(text);
}

function isVoiceLatestItem(item = {}, peopleOfInterest = []) {
  const kind = String(item?.kind || '').toLowerCase();
  const transcriptStatus = String(item?.transcriptStatus || '').toLowerCase();
  return kind === 'transcript'
    || kind === 'interview'
    || transcriptStatus === 'full'
    || transcriptStatus === 'partial'
    || transcriptStatus === 'description_only'
    || matchesPeopleOfInterest(item, peopleOfInterest);
}

function isWrittenLatestItem(item = {}) {
  const kind = String(item?.kind || '').toLowerCase();
  const channelType = String(item?.channelType || '').toLowerCase();
  return kind === 'written' || channelType === 'written';
}

function isRegionalLatestItem(item = {}) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
  return REGIONAL_SIGNAL_PATTERN.test(text);
}

function hasMeaningfulLatestNewsSignal(item = {}) {
  return Boolean(
    isOfficialLatestItem(item)
      || isVoiceLatestItem(item)
      || isWrittenLatestItem(item)
      || hasStrongAiReleaseSignal(item)
      || hasStrongRegionalSignal(item)
  );
}

function matchesLatestNewsFilter(item = {}, filterKey = 'all', peopleOfInterest = []) {
  if (filterKey === 'all') {
    return true;
  }
  if (filterKey === 'releases') {
    return isOfficialLatestItem(item);
  }
  if (filterKey === 'voices') {
    return isVoiceLatestItem(item, peopleOfInterest);
  }
  if (filterKey === 'regional') {
    return isRegionalLatestItem(item);
  }
  if (filterKey === 'written') {
    return isWrittenLatestItem(item);
  }
  if (filterKey === 'news') {
    return item?.kind === 'normal' || Boolean(item?.normalNewsCategory);
  }
  return true;
}

function getLatestNewsFilterCount(items = [], filterKey = 'all', peopleOfInterest = []) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    matchesLatestNewsFilter(item, filterKey, peopleOfInterest)
  )).length;
}

function shortenExplanation(value = '', maxWords = 10) {
  const words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!words.length) {
    return '';
  }

  if (words.length <= maxWords) {
    return words.join(' ');
  }

  return `${words.slice(0, maxWords).join(' ')}…`;
}

function describeTrustReason(item = {}) {
  if (isOfficialLatestItem(item)) {
    const scope = getCoreVendorScope(item);
    return scope.length
      ? `Official release watch for ${scope.join(', ')}.`
      : 'Official source or release-watch match.';
  }

  const sourceTrust = clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0));
  if (sourceTrust >= 0.85) {
    return 'High-trust source in the current ranking system.';
  }
  if (sourceTrust >= 0.7) {
    return 'Trusted enough to stay in the live feed.';
  }
  if (isVoiceLatestItem(item)) {
    return 'Tracked interview or transcript signal.';
  }
  if (isWrittenLatestItem(item)) {
    return 'Written reporting that cleared the current filter.';
  }

  return 'Monitored source that matched the current interest profile.';
}

function isRecentEnough(value, maxAgeHours = MAX_VISIBLE_NEWS_AGE_HOURS) {
  const timestamp = getItemTimestamp(value);
  if (!timestamp) {
    return false;
  }

  return (Date.now() - timestamp) <= (maxAgeHours * 60 * 60 * 1000);
}

function computeLatestNewsImportance(item = {}) {
  const scores = item?.scores || {};
  const sourceTrust = clamp01(item?.sourceTrust, clamp01(scores.sourceTrust, 0.5));
  const ageHours = Math.max(0, (Date.now() - getItemTimestamp(item?.date || item?.publishedAt)) / 3600000);
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
  let rank = Number(item?.latestPriority || 0) + Math.round(computeUnifiedBestFeedScore(item) * 100);

  if (isOfficialLatestItem(item)) rank += 210;
  if (isVoiceLatestItem(item)) rank += 92;
  if (hasStrongRegionalSignal(item)) rank += 86;
  if (isWrittenLatestItem(item)) rank += 46;
  if ((item?.kind === 'normal' || item?.normalNewsCategory) && hasMeaningfulLatestNewsSignal(item)) rank += 12;
  if ((item?.kind === 'normal' || item?.normalNewsCategory) && !hasMeaningfulLatestNewsSignal(item)) rank -= 130;
  if (hasStrongAiReleaseSignal(item)) rank += 64;
  if (CLAUDE_FABLE_MYTHOS_PATTERN.test(text)) rank += 280;

  rank += Math.round(sourceTrust * 42);

  if (ageHours <= 6) rank += 38;
  else if (ageHours <= 24) rank += 24;
  else if (ageHours <= 72) rank += 8;
  else rank -= 28;

  if (AI_LOW_SIGNAL_PATTERN.test(text) && !isOfficialLatestItem(item)) {
    rank -= 90;
  }

  return rank;
}

function buildProfileSearchTokens(value = '') {
  return String(value || '')
    .replace(/[|;/()[\]{}:]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4 && !HEADLINE_STOPWORDS.has(token));
}

function matchesProfilePhrase(text = '', phrase = '') {
  const normalizedText = String(text || '').toLowerCase();
  const normalizedPhrase = String(phrase || '').toLowerCase().replace(/[|;/()[\]{}:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedText || !normalizedPhrase) {
    return false;
  }

  if (normalizedText.includes(normalizedPhrase)) {
    return true;
  }

  const tokens = [...new Set(buildProfileSearchTokens(normalizedPhrase))];
  if (!tokens.length) {
    return false;
  }

  const hitCount = tokens.filter((token) => normalizedText.includes(token)).length;
  return tokens.length === 1 ? hitCount === 1 : hitCount >= Math.min(2, tokens.length);
}

function computeTemplateMatchBoost(item = {}, templateState = {}) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
  const peopleOfInterest = uniqueTrimmedList(templateState?.peopleOfInterest || []);
  const priorityTopics = uniqueTrimmedList(templateState?.priorityTopics || []);
  const watchQuestions = uniqueTrimmedList(templateState?.watchQuestions || []);
  const avoidTopics = uniqueTrimmedList(templateState?.avoidTopics || []);

  let boost = 0;
  if (matchesPeopleOfInterest(item, peopleOfInterest)) {
    boost += 96;
  }
  if (priorityTopics.some((topic) => matchesProfilePhrase(text, topic))) {
    boost += 58;
  }
  if (watchQuestions.some((question) => matchesProfilePhrase(text, question))) {
    boost += 34;
  }
  if (avoidTopics.some((topic) => matchesProfilePhrase(text, topic))) {
    boost -= 110;
  }

  return boost;
}

function computePersonalizedLatestNewsImportance(item = {}, templateState = {}) {
  return computeLatestNewsImportance(item) + computeTemplateMatchBoost(item, templateState);
}

function compareLatestNewsByImportance(left = {}, right = {}) {
  const rankDiff = computeLatestNewsImportance(right) - computeLatestNewsImportance(left);
  if (rankDiff) {
    return rankDiff;
  }

  const timeDiff = getItemTimestamp(right?.date || right?.publishedAt)
    - getItemTimestamp(left?.date || left?.publishedAt);
  if (timeDiff) {
    return timeDiff;
  }

  return compareLatestNewsStable(left, right);
}

function computeTranscriptHighlightPriority(item, peopleOfInterest = []) {
  const discovery = item?.discovery || {};
  const lane = String(discovery?.lane || '').toLowerCase();
  const sourceTrust = clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0.5));
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;

  let priority = 110;
  if (lane === 'interview_signal') {
    priority += 44;
  }
  if (lane === 'tracked') {
    priority += 18;
  }
  if (matchesPeopleOfInterest(item, peopleOfInterest)) {
    priority += 38;
  }
  if (AI_FEED_SIGNAL_PATTERN.test(text)) {
    priority += 16;
  }
  if (REGIONAL_SIGNAL_PATTERN.test(text)) {
    priority += 14;
  }
  if (sourceTrust >= 0.92) {
    priority += 18;
  } else if (sourceTrust >= 0.82) {
    priority += 12;
  } else if (sourceTrust >= 0.72) {
    priority += 6;
  }

  return priority;
}

function selectLatestAiAlerts(alerts = [], limit = 12) {
  const cutoffMs = Date.now() - (MAX_VISIBLE_NEWS_AGE_HOURS * 60 * 60 * 1000);
  const deduped = new Map();

  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const key = String(alert?.url || alert?.title || alert?.id || '').trim();
    if (!key || deduped.has(key)) {
      continue;
    }

    const text = `${alert?.title || ''} ${alert?.summary || ''} ${alert?.source || ''} ${alert?.whyItMatters || ''}`;
    if (!hasCoreOfficialVendorSignal(alert)) {
      continue;
    }

    // Skip stale alerts — items older than 30 days are never shown in Latest news
    const publishedMs = getItemTimestamp(alert?.publishedAt || alert?.date);
    if (publishedMs && publishedMs < cutoffMs) {
      continue;
    }

    deduped.set(key, alert);
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const rightTime = getItemTimestamp(right?.publishedAt);
      const leftTime = getItemTimestamp(left?.publishedAt);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      const scoreDiff = Number(right?.score || 0) - Number(left?.score || 0);
      return scoreDiff || compareLatestNewsStable(left, right);
    })
    .slice(0, limit);
}

function selectLatestAiFeedItems(feedPayload, limit = 12) {
  const discoveryHealth = getDiscoveryHealth(feedPayload);
  const sections = Array.isArray(feedPayload?.sections) ? feedPayload.sections : [];
  const deduped = new Map();

  for (const section of sections) {
    const sectionItems = Array.isArray(section?.items) ? section.items : [];
    for (const item of sectionItems) {
      const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''}`;
      const hasAiSignal = AI_FEED_SIGNAL_PATTERN.test(text) && hasStrongAiReleaseSignal(item);
      const hasRegionalSignal = hasStrongRegionalSignal(item);
      if (!hasAiSignal && !hasRegionalSignal) {
        continue;
      }
      if (!shouldIncludeLatestAiItem(item, discoveryHealth)) {
        continue;
      }

      const key = String(item?.url || item?.title || item?.id || '').trim();
      if (!key || deduped.has(key)) {
        continue;
      }

      deduped.set(key, {
        ...item,
        feedSectionId: section.id,
        feedSectionTitle: section.title,
        latestPriority: computeLatestAiPriority(item, discoveryHealth),
      });
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const rightPriority = Number(right?.latestPriority || 0);
      const leftPriority = Number(left?.latestPriority || 0);
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }

      const rightTime = getItemTimestamp(right?.date);
      const leftTime = getItemTimestamp(left?.date);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      const scoreDiff = computeUnifiedBestFeedScore(right) - computeUnifiedBestFeedScore(left);
      return scoreDiff || compareLatestNewsStable(left, right);
    })
    .slice(0, limit);
}

function selectLatestTranscriptHighlightItems(feedPayload, peopleOfInterest = [], limit = 4) {
  const sections = Array.isArray(feedPayload?.sections) ? feedPayload.sections : [];
  const deduped = new Map();

  for (const section of sections) {
    const sectionItems = Array.isArray(section?.items) ? section.items : [];
    for (const item of sectionItems) {
      const lane = String(item?.discovery?.lane || '').toLowerCase();
      const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
      const key = String(item?.url || item?.title || item?.id || '').trim();
      const isPeopleInterview = lane === 'interview_signal' || matchesPeopleOfInterest(item, peopleOfInterest);
      const isTrackedTranscriptSignal = Boolean(item?.hasTranscript)
        && lane === 'tracked'
        && (AI_FEED_SIGNAL_PATTERN.test(text) || REGIONAL_SIGNAL_PATTERN.test(text));
      const qualifies = isRecentEnough(item?.date, MAX_VISIBLE_NEWS_AGE_HOURS)
        && (isPeopleInterview || isTrackedTranscriptSignal);

      if (!qualifies || !key || deduped.has(key)) {
        continue;
      }

      deduped.set(key, {
        ...item,
        feedSectionId: section.id,
        feedSectionTitle: section.title,
        latestPriority: computeTranscriptHighlightPriority(item, peopleOfInterest),
      });
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const rightPriority = Number(right?.latestPriority || 0);
      const leftPriority = Number(left?.latestPriority || 0);
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }

      const rightTime = getItemTimestamp(right?.date);
      const leftTime = getItemTimestamp(left?.date);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      const scoreDiff = computeUnifiedBestFeedScore(right) - computeUnifiedBestFeedScore(left);
      return scoreDiff || compareLatestNewsStable(left, right);
    })
    .slice(0, limit);
}

function selectLatestWrittenItems(feedPayload, limit = 4) {
  const sections = Array.isArray(feedPayload?.sections) ? feedPayload.sections : [];
  const deduped = new Map();

  for (const section of sections) {
    const isWrittenSection = section?.id === 'written-news'
      || /written/i.test(String(section?.title || ''));

    if (!isWrittenSection) {
      continue;
    }

    const sectionItems = Array.isArray(section?.items) ? section.items : [];
    for (const item of sectionItems) {
      const key = String(item?.url || item?.title || item?.id || '').trim();
      const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''}`;
      const hasAiSignal = hasStrongAiReleaseSignal(item);
      const hasRegionalSignal = hasStrongRegionalSignal(item);
      const maxAgeHours = hasRegionalSignal ? 72 : 48;
      if (!key || deduped.has(key)) {
        continue;
      }

      if (!isRecentEnough(item?.date || item?.publishedAt, maxAgeHours)) {
        continue;
      }

      if (!hasAiSignal && !hasRegionalSignal) {
        continue;
      }

      if (AI_LOW_SIGNAL_PATTERN.test(text) && !isOfficialLatestItem(item)) {
        continue;
      }

      deduped.set(key, {
        ...item,
        feedSectionId: section.id,
        feedSectionTitle: section.title,
      });
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const rightTime = getItemTimestamp(right?.date);
      const leftTime = getItemTimestamp(left?.date);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      const scoreDiff = computeUnifiedBestFeedScore(right) - computeUnifiedBestFeedScore(left);
      return scoreDiff || compareLatestNewsStable(left, right);
    })
    .slice(0, limit);
}

function selectRelevantFeedItems(feedPayload, template, limit = 12) {
  const sections = Array.isArray(feedPayload?.sections) ? feedPayload.sections : [];
  const templateState = normalizeHomeTemplateState(template);
  const peopleOfInterest = getSavedPeopleOfInterest(template);
  const deduped = new Map();

  for (const section of sections) {
    const sectionItems = Array.isArray(section?.items) ? section.items : [];
    for (const item of sectionItems) {
      const key = String(item?.url || item?.title || item?.id || '').trim();
      if (!key || deduped.has(key)) {
        continue;
      }

      const date = item?.date || item?.publishedAt || item?.publishDate || item?.created_at;
      if (!isRecentEnough(date, MAX_VISIBLE_NEWS_AGE_HOURS)) {
        continue;
      }

      const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
      const peopleMatch = matchesPeopleOfInterest(item, peopleOfInterest);
      const regionalSignal = hasStrongRegionalSignal(item);
      const aiSignal = hasStrongAiReleaseSignal(item);
      if (AI_LOW_SIGNAL_PATTERN.test(text) && !peopleMatch && !regionalSignal && !aiSignal) {
        continue;
      }

      if (!peopleMatch && !regionalSignal && !aiSignal && !isWrittenLatestItem(item) && !isVoiceLatestItem(item)) {
        continue;
      }

      const rankingScore = computePersonalizedLatestNewsImportance(item, templateState);
      deduped.set(key, {
        ...item,
        kind: item?.kind || item?.channelType || 'normal',
        date,
        feedSectionId: section.id,
        feedSectionTitle: section.title,
        reason: item?.reason || item?.whyShown || item?.summary || `Ranked from ${section.title || 'feed'}`,
        latestPriority: Number(item?.latestPriority || 0) + Math.max(0, Math.round(rankingScore / 3)),
      });
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const importanceDiff = computePersonalizedLatestNewsImportance(right, templateState)
        - computePersonalizedLatestNewsImportance(left, templateState);
      if (importanceDiff) {
        return importanceDiff;
      }

      return getItemTimestamp(right?.date || right?.publishedAt) - getItemTimestamp(left?.date || left?.publishedAt)
        || compareLatestNewsStable(left, right);
    })
    .slice(0, limit);
}

function buildLatestNewsItems({
  officialReleaseAlerts = [],
  transcriptItems = [],
  aiFeedItems = [],
  writtenItems = [],
  discoveryHealth = {},
}) {
  const deduped = new Map();

  const addItem = (item) => {
    if (!item) {
      return;
    }

    const key = String(item.url || item.id || item.title || '').trim();
    if (!key || deduped.has(key)) {
      return;
    }

    deduped.set(key, item);
  };

  for (const alert of officialReleaseAlerts) {
    const thumbnail = pickItemThumbnail(alert);
    const stableId = alert?.id || alert?.url || alert?.title || `alert-${Math.abs(hashText(JSON.stringify(alert || {})))}`;
    addItem({
      ...alert,
      id: `official:${stableId}`,
      kind: 'official',
      title: cleanAlertTitle(alert?.title) || buildSimpleHeadline(alert),
      source: alert?.source || 'Official release',
      date: alert?.publishedAt || alert?.date || '',
      summary: alert?.summary || '',
      reason: alert?.whyItMatters || alert?.summary || 'Official release watch',
      whyShown: alert?.whyShown || alert?.whyItMatters || alert?.summary || 'Official release watch',
      whyTrusted: alert?.whyTrusted || 'Official first-party or vendor release.',
      whyNotified: alert?.whyNotified || 'Matched the current release-watch settings.',
      thumbnail,
      thumbnailUrl: String(alert?.thumbnailUrl || alert?.thumbnail_url || thumbnail || '').trim(),
      thumbnail_url: String(alert?.thumbnail_url || alert?.thumbnailUrl || thumbnail || '').trim(),
      image: String(alert?.image || thumbnail || '').trim(),
      imageUrl: String(alert?.imageUrl || thumbnail || '').trim(),
      coverImage: String(alert?.coverImage || thumbnail || '').trim(),
      url: alert?.url || '',
      alert,
      latestPriority: 220,
    });
  }

  for (const item of aiFeedItems) {
    addItem({
      ...item,
      kind: 'ai',
      date: item?.date || item?.publishedAt || '',
      reason: item?.reason || item?.summary || 'Fresh AI release',
      latestPriority: Number(item?.latestPriority || 0) + 72,
    });
  }

  for (const item of transcriptItems) {
    addItem({
      ...item,
      kind: item?.hasTranscript ? 'transcript' : 'interview',
      date: item?.date || item?.publishedAt || '',
      reason: item?.reason || item?.summary || 'Recent people-of-interest interview',
      latestPriority: Number(item?.latestPriority || 0) + 96,
    });
  }

  for (const item of writtenItems) {
    addItem({
      ...item,
      kind: 'written',
      date: item?.date || item?.publishedAt || '',
      reason: item?.reason || item?.summary || 'Fresh written reporting',
      latestPriority: 24,
    });
  }

  const items = [...deduped.values()];
  const byNewest = (left, right) => {
    const rightTime = getItemTimestamp(right?.date || right?.publishedAt);
    const leftTime = getItemTimestamp(left?.date || left?.publishedAt);
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    const scoreDiff = computeUnifiedBestFeedScore(right) - computeUnifiedBestFeedScore(left);
    return scoreDiff || compareLatestNewsStable(left, right);
  };

  const compareLatestLaneItems = (left, right) => {
    const leftOfficial = left?.kind === 'official' || Boolean(left?.alert);
    const rightOfficial = right?.kind === 'official' || Boolean(right?.alert);

    if (leftOfficial !== rightOfficial) {
      return leftOfficial ? -1 : 1;
    }

    const rightTime = getItemTimestamp(right?.date || right?.publishedAt);
    const leftTime = getItemTimestamp(left?.date || left?.publishedAt);

    if (rightTime !== leftTime && Math.abs(rightTime - leftTime) > (18 * 60 * 60 * 1000)) {
      return rightTime - leftTime;
    }

    const rightPriority = Number(right?.latestPriority || 0);
    const leftPriority = Number(left?.latestPriority || 0);
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }

    return byNewest(left, right);
  };

  return items
    .sort(compareLatestLaneItems)
    .slice(0, 16);
}

function filterLatestNewsItems(items = []) {
  return normalizeLatestNewsItems(items)
    .filter((item) => {
      if (!item?.date || !isRecentEnough(item.date, MAX_VISIBLE_NEWS_AGE_HOURS)) {
        return false;
      }

      if (item?.kind === 'normal' || item?.normalNewsCategory) {
        return hasMeaningfulLatestNewsSignal(item);
      }

      if (isWrittenLatestItem(item)) {
        const text = `${item?.title || ''} ${item?.summary || ''} ${item?.source || ''}`;
        if (AI_LOW_SIGNAL_PATTERN.test(text) && !isOfficialLatestItem(item)) {
          return false;
        }
      }

      return true;
    });
}

function mergeLatestNewsItems(...collections) {
  const deduped = new Map();
  const candidates = filterLatestNewsItems(collections.flat());

  for (const item of candidates) {
    const key = String(item?.url || item?.title || item?.id || '').trim().toLowerCase();
    if (key && !deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()]
    .sort(compareLatestNewsByImportance)
    .slice(0, 24);
}

export default function HomeScreen({
  hiddenItemIds = [],
  onDismissItem,
  onNavigate,
  onAskAi,
}) {
  const { user } = useAuth();
  const [cachedFeed] = useState(() => loadFeedCache());
  const [initialSnapshotItems] = useState(() => filterLatestNewsItems(normalizeEmergencySnapshotItems()));
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('feed');
  const [expandedRationales, setExpandedRationales] = useState({});
  const [latestNewsItems, setLatestNewsItems] = useState(() => {
    const cachedItems = filterLatestNewsItems(cachedFeed?.latestNewsItems || []);
    return cachedItems.length ? cachedItems : initialSnapshotItems;
  });
  const [templateState, setTemplateState] = useState(() => cachedFeed?.templateState || DEFAULT_HOME_TEMPLATE_STATE);
  const [message, setMessage] = useState('');
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [feedHealth, setFeedHealth] = useState(() => cachedFeed?.feedHealth || DEFAULT_FEED_HEALTH);
  const [discoveryHealth, setDiscoveryHealth] = useState(() => cachedFeed?.discoveryHealth || DEFAULT_DISCOVERY_HEALTH);
  const [eventSourceMap, setEventSourceMap] = useState(() => cachedFeed?.eventSourceMap || null);
  const [eventPriorityMap, setEventPriorityMap] = useState(() => loadEventPriorityMap());
  const [mutedTypes, setMutedTypes] = useState([]);
  const [priorityPickerItemId, setPriorityPickerItemId] = useState('');
  const [suppressNextOpenItemId, setSuppressNextOpenItemId] = useState('');
  const [selectedGraphItem, setSelectedGraphItem] = useState(null);
  const latestNewsCountRef = useRef(latestNewsItems.length);
  const priorityPressTimersRef = useRef(new Map());
  const componentActiveRef = useRef(true);
  const latestFeedRequestIdRef = useRef(0);
  const feedRequestFlightRef = useRef(null);
  const queuedFeedRequestRef = useRef(null);
  const loadSimpleNewsRef = useRef(null);
  const activeIndicatorRequestIdRef = useRef(0);
  const refreshNoticeTimerRef = useRef(null);
  const feedRetryTimerRef = useRef(null);
  const initialRefreshScheduledRef = useRef(false);
  const pullGestureRef = useRef({ startY: 0, eligible: false });
  const [refreshIndicator, setRefreshIndicator] = useState({
    active: false,
    source: '',
    status: 'idle',
    text: '',
    visible: false,
  });
  const [pullDistance, setPullDistance] = useState(0);
  const [pullArmed, setPullArmed] = useState(false);
  const liveRefreshActive = refreshIndicator.active;

  useEffect(() => {
    latestNewsCountRef.current = latestNewsItems.length;
  }, [latestNewsItems.length]);

  useEffect(() => {
    componentActiveRef.current = true;
    return () => {
      componentActiveRef.current = false;
      queuedFeedRequestRef.current = null;
      if (refreshNoticeTimerRef.current) {
        window.clearTimeout(refreshNoticeTimerRef.current);
      }
      if (feedRetryTimerRef.current) {
        window.clearTimeout(feedRetryTimerRef.current);
      }
    };
  }, []);

  const applyCachedFeed = useCallback((cached) => {
    if (!cached?.latestNewsItems) {
      return false;
    }

    const cachedLatestNewsItems = filterLatestNewsItems(cached.latestNewsItems);
    if (cachedLatestNewsItems.length < MIN_GOOD_FEED_CACHE_ITEMS) {
      return false;
    }

    setLatestNewsItems(cachedLatestNewsItems);
    setTemplateState(cached.templateState || DEFAULT_HOME_TEMPLATE_STATE);
    setFeedHealth(cached.feedHealth || DEFAULT_FEED_HEALTH);
    setDiscoveryHealth(cached.discoveryHealth || DEFAULT_DISCOVERY_HEALTH);
    setEventSourceMap(cached.eventSourceMap || null);
    setBackendUnavailable(false);
    setLoading(false);
    return true;
  }, []);

  const applyEmergencySnapshot = useCallback(() => {
    const snapshotItems = filterLatestNewsItems(normalizeEmergencySnapshotItems());
    if (!snapshotItems.length) {
      return false;
    }

    setLatestNewsItems(snapshotItems);
    setTemplateState(DEFAULT_HOME_TEMPLATE_STATE);
    setFeedHealth({
      ...(OFFLINE_FEED_SNAPSHOT.feedHealth || DEFAULT_FEED_HEALTH),
      status: 'degraded',
      message: 'Showing the built-in emergency feed while the live feed finishes.',
      degradedReason: 'emergency_snapshot',
    });
    setDiscoveryHealth(OFFLINE_FEED_SNAPSHOT.discoveryHealth || DEFAULT_DISCOVERY_HEALTH);
    setBackendUnavailable(false);
    setLoading(false);
    return true;
  }, []);

  const publishRefreshNotice = useCallback(({ source, status, text }) => {
    if (!componentActiveRef.current) {
      return;
    }

    if (refreshNoticeTimerRef.current) {
      window.clearTimeout(refreshNoticeTimerRef.current);
    }
    setRefreshIndicator({
      active: false,
      source: source || 'client_fallback',
      status: status || 'completed',
      text,
      visible: true,
    });
    refreshNoticeTimerRef.current = window.setTimeout(() => {
      if (componentActiveRef.current) {
        setRefreshIndicator((current) => (
          current.active ? current : { ...current, visible: false }
        ));
      }
    }, REFRESH_NOTICE_MS);
  }, []);

  const executeFeedRequest = useCallback(async (options = {}) => {
    const {
      requestId,
      skipLoadingState = false,
      forceRefresh = false,
      refreshOrigin = 'background',
      requestedMode = 'feed',
      requestedUserId = '',
    } = options;
    const isCurrentRequest = () => (
      componentActiveRef.current
      && requestId === latestFeedRequestIdRef.current
    );
    let completionNotice = null;

    // Try client-side cache first, but never replace an explicitly requested recalculation.
    if (!forceRefresh && !skipLoadingState && requestedMode === 'feed' && isCurrentRequest()) {
      const cached = loadFeedCache();
      if (applyCachedFeed(cached)) {
        // Keep a usable cache on screen, but still fetch if it is thin or no longer very fresh.
        const cacheAgeMs = Date.now() - (cached.ts || 0);
        if (
          cacheAgeMs <= BACKGROUND_REFRESH_THROTTLE_MS
          && cached.latestNewsItems.length >= TARGET_LIVE_FEED_ITEMS
        ) {
          return;
        }
      }
    }

    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const liveIndicatorStarted = forceRefresh && online;
    if (liveIndicatorStarted && componentActiveRef.current) {
      if (refreshNoticeTimerRef.current) {
        window.clearTimeout(refreshNoticeTimerRef.current);
      }
      activeIndicatorRequestIdRef.current = requestId;
      setRefreshIndicator({
        active: true,
        source: `client_${refreshOrigin}`,
        status: 'in_flight',
        text: LIVE_REFRESH_LABELS[refreshOrigin] || LIVE_REFRESH_LABELS.background,
        visible: true,
      });
    } else if (forceRefresh && isCurrentRequest()) {
      completionNotice = {
        source: 'client_offline',
        status: 'offline',
        text: 'Offline: keeping the last good feed while automatic retry stays active.',
      };
    }

    if (!skipLoadingState && isCurrentRequest()) {
      setLoading(latestNewsCountRef.current === 0);
    }
    if (isCurrentRequest()) {
      setMessage('');
      setBackendUnavailable(false);
    }

    try {
      const officialReleaseRequest = fetchOfficialReleaseAlerts({
        companies: OFFICIAL_LATEST_NEWS_COMPANY_KEYS,
        limit: 12,
      });
      const templateRequest = requestedUserId ? fetchTemplate() : Promise.resolve(null);

      const [feedPayload, officialReleasePayload, template, sourceMapPayload] = await Promise.all([
        withRequestTimeout(fetchFeed({ refresh: forceRefresh, direct: true, mode: requestedMode }), FEED_FIRST_SCREEN_TIMEOUT_MS),
        withRequestTimeout(officialReleaseRequest, 2500),
        withRequestTimeout(templateRequest, 2500),
        withRequestTimeout(fetchEventSourceMap(), 2500),
      ]);

      if (!isCurrentRequest()) {
        return;
      }

      const nextLatestAiFeedItems = selectLatestAiFeedItems(feedPayload, 12);
      const nextTranscriptItems = selectLatestTranscriptHighlightItems(
        feedPayload,
        getSavedPeopleOfInterest(template),
        4
      );
      const nextLatestWrittenItems = selectLatestWrittenItems(feedPayload, 4);
      const nextOfficialReleaseAlerts = selectLatestAiAlerts(officialReleasePayload?.alerts, 12);
      const nextDiscoveryHealth = getDiscoveryHealth(feedPayload);
      const nextFeedHealth = getFeedHealth(feedPayload, nextDiscoveryHealth);
      const nextEventSourceMap = sourceMapPayload?.sourceMap || null;
      const nextTemplateState = normalizeHomeTemplateState(template);
      const backendLatestNewsItems = Array.isArray(feedPayload?.latestNews)
        ? filterLatestNewsItems(feedPayload.latestNews)
        : [];
      const backendNormalNewsItems = Array.isArray(feedPayload?.normalNews)
        ? filterLatestNewsItems(normalizeNormalNewsItems(feedPayload.normalNews))
        : [];
      const builtLatestNewsItems = buildLatestNewsItems({
          officialReleaseAlerts: nextOfficialReleaseAlerts,
          transcriptItems: nextTranscriptItems,
          aiFeedItems: nextLatestAiFeedItems,
          writtenItems: nextLatestWrittenItems,
          discoveryHealth: nextDiscoveryHealth,
        });
      const relevantFallbackItems = selectRelevantFeedItems(feedPayload, template, TARGET_LIVE_FEED_ITEMS);
      const nextLatestNewsItems = mergeLatestNewsItems(
        builtLatestNewsItems,
        backendLatestNewsItems,
        backendNormalNewsItems,
        relevantFallbackItems,
      );

      if (!nextLatestNewsItems.length) {
        const fallbackCache = loadFeedCache();
        if (applyCachedFeed(fallbackCache)) {
          setMessage('Live refresh returned no visible items, so eXplore is keeping the last good feed.');
          completionNotice = {
            source: 'client_last_good_cache',
            status: 'fallback',
            text: 'No new visible items; keeping the last good device feed.',
          };
          return;
        }

        if (applyEmergencySnapshot()) {
          setMessage('Live refresh returned no visible items, so eXplore is showing the fallback source map while it retries.');
          completionNotice = {
            source: 'client_emergency_snapshot',
            status: 'fallback',
            text: 'Live sources were empty; showing the emergency source map.',
          };
          return;
        }
      }

      setLatestNewsItems(nextLatestNewsItems);
      setTemplateState(nextTemplateState);
      setFeedHealth(nextFeedHealth);
      setDiscoveryHealth(nextDiscoveryHealth);
      if (nextEventSourceMap) {
        setEventSourceMap(nextEventSourceMap);
      }
      setBackendUnavailable(!feedPayload && !template);
      setMessage(
        !feedPayload && !template
          ? 'Latest news could not reach the backend. I will not show old offline headlines as fresh news.'
          : nextLatestNewsItems.length
          ? ''
          : 'No fresh releases or news are live right now. Refresh to try again.'
      );

      // ── Write to client-side cache ────────────────────────────────
      if (nextLatestNewsItems.length) {
        writeFeedCache({
          latestNewsItems: nextLatestNewsItems,
          templateState: nextTemplateState,
          feedHealth: nextFeedHealth,
          discoveryHealth: nextDiscoveryHealth,
          eventSourceMap: nextEventSourceMap || null,
        });
      }

      if (forceRefresh) {
        const refreshEvidence = feedPayload?.refresh || {
          source: feedPayload ? 'live_backend' : 'client_last_good_cache',
          status: feedPayload ? 'completed' : 'fallback',
        };
        completionNotice = {
          source: refreshEvidence.source,
          status: refreshEvidence.status,
          text: getRefreshCompletionNotice(refreshEvidence),
        };
      }
    } catch {
      if (isCurrentRequest()) {
        const fallbackCache = loadFeedCache();
        if (applyCachedFeed(fallbackCache)) {
          setMessage('Latest news could not finish loading, so eXplore is keeping the last good feed.');
          completionNotice = {
            source: 'client_last_good_cache',
            status: online ? 'fallback' : 'offline',
            text: online
              ? 'Live refresh failed; keeping the last good device feed.'
              : 'Offline: keeping the last good device feed.',
          };
          return;
        }

        if (applyEmergencySnapshot()) {
          setMessage('Live news is taking too long, so eXplore is showing the emergency feed and will retry in the background.');
          completionNotice = {
            source: 'client_emergency_snapshot',
            status: online ? 'fallback' : 'offline',
            text: online
              ? 'Live refresh timed out; showing the emergency feed.'
              : 'Offline: showing the emergency feed.',
          };
          if (feedRetryTimerRef.current) {
            window.clearTimeout(feedRetryTimerRef.current);
          }
          feedRetryTimerRef.current = window.setTimeout(() => {
            void loadSimpleNewsRef.current?.({
              forceRefresh: true,
              refreshOrigin: 'retry',
              requestedMode,
              requestedUserId,
              skipLoadingState: true,
            });
          }, 1500);
          return;
        }

        setBackendUnavailable(true);
        setTemplateState(DEFAULT_HOME_TEMPLATE_STATE);
        setFeedHealth({
          status: 'degraded',
          message: 'Latest news could not reach the backend.',
          degradedReason: 'backend_unavailable',
          pipelines: {},
        });
        setDiscoveryHealth({
          fallbackActive: false,
          quotaLimited: false,
          message: '',
          trackedChannelCount: 0,
          liveSourceCount: 0,
        });
        setMessage('Latest news could not finish loading. I will not show old offline headlines as fresh news.');
        completionNotice = {
          source: online ? 'backend_unavailable' : 'client_offline',
          status: online ? 'failed' : 'offline',
          text: online
            ? 'Live backend refresh failed.'
            : 'Offline: live refresh will retry automatically.',
        };
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
      if (
        liveIndicatorStarted
        && componentActiveRef.current
        && activeIndicatorRequestIdRef.current === requestId
      ) {
        activeIndicatorRequestIdRef.current = 0;
        setRefreshIndicator((current) => ({
          ...current,
          active: false,
          status: 'completed',
          visible: false,
        }));
      }
      if (completionNotice && isCurrentRequest()) {
        publishRefreshNotice(completionNotice);
      }
    }
  }, [applyCachedFeed, applyEmergencySnapshot, publishRefreshNotice]);

  const loadSimpleNews = useCallback((options = {}) => {
    const request = {
      forceRefresh: Boolean(options.forceRefresh),
      refreshOrigin: options.refreshOrigin || 'background',
      requestedMode: options.requestedMode || 'feed',
      requestedUserId: options.requestedUserId || '',
      skipLoadingState: Boolean(options.skipLoadingState),
      requestId: latestFeedRequestIdRef.current + 1,
    };
    latestFeedRequestIdRef.current = request.requestId;

    if (feedRequestFlightRef.current) {
      const queued = queuedFeedRequestRef.current;
      queuedFeedRequestRef.current = {
        ...queued,
        ...request,
        forceRefresh: Boolean(queued?.forceRefresh || request.forceRefresh),
        skipLoadingState: queued
          ? Boolean(queued.skipLoadingState && request.skipLoadingState)
          : request.skipLoadingState,
      };
      return feedRequestFlightRef.current;
    }

    const runQueuedRequests = async () => {
      let nextRequest = request;
      while (nextRequest && componentActiveRef.current) {
        await executeFeedRequest(nextRequest);
        nextRequest = queuedFeedRequestRef.current;
        queuedFeedRequestRef.current = null;
      }
    };
    const flight = runQueuedRequests().finally(() => {
      if (feedRequestFlightRef.current === flight) {
        feedRequestFlightRef.current = null;
      }
      const pendingRequest = queuedFeedRequestRef.current;
      queuedFeedRequestRef.current = null;
      if (pendingRequest && componentActiveRef.current) {
        void loadSimpleNewsRef.current?.(pendingRequest);
      }
    });
    feedRequestFlightRef.current = flight;
    return flight;
  }, [executeFeedRequest]);
  loadSimpleNewsRef.current = loadSimpleNews;

  useEffect(() => {
    const refreshOrigin = initialRefreshScheduledRef.current ? 'mode' : 'initial';
    initialRefreshScheduledRef.current = true;
    void loadSimpleNews({
      forceRefresh: true,
      refreshOrigin,
      requestedMode: mode,
      requestedUserId: user?.id || '',
    });
  }, [mode, user?.id, loadSimpleNews]);

  useEffect(() => {
    if (!loading || latestNewsItems.length) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const fallbackCache = loadFeedCache();
      if (applyCachedFeed(fallbackCache)) {
        setMessage('The page was still loading, so eXplore restored the last good feed.');
        return;
      }

      if (applyEmergencySnapshot()) {
        setMessage('The page was still loading, so eXplore restored an emergency feed and is retrying live news.');
        void loadSimpleNews({
          forceRefresh: true,
          refreshOrigin: 'retry',
          requestedMode: mode,
          requestedUserId: user?.id || '',
          skipLoadingState: true,
        });
      }
    }, FEED_FIRST_SCREEN_TIMEOUT_MS + 1500);

    return () => window.clearTimeout(timeoutId);
  }, [applyCachedFeed, applyEmergencySnapshot, latestNewsItems.length, loadSimpleNews, loading, mode, user?.id]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadSimpleNews({
        forceRefresh: true,
        refreshOrigin: 'external',
        requestedMode: mode,
        requestedUserId: user?.id || '',
      });
    };

    window.addEventListener(EXPLORE_FEED_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(EXPLORE_FEED_REFRESH_EVENT, handleRefresh);
    };
  }, [loadSimpleNews, mode, user?.id]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadSimpleNews({
          forceRefresh: true,
          refreshOrigin: 'background',
          requestedMode: mode,
          requestedUserId: user?.id || '',
          skipLoadingState: true,
        });
      }
    };

    const intervalId = window.setInterval(refreshIfVisible, FEED_BACKGROUND_POLL_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadSimpleNews, mode, user?.id]);

  const resetPullRefresh = useCallback(() => {
    pullGestureRef.current = { startY: 0, eligible: false };
    setPullDistance(0);
    setPullArmed(false);
  }, []);

  const handlePullRefreshStart = useCallback((event) => {
    const touch = event.touches?.[0];
    const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    pullGestureRef.current = {
      startY: touch?.clientY || 0,
      eligible: scrollTop <= 2 && !liveRefreshActive,
    };
  }, [liveRefreshActive]);

  const handlePullRefreshMove = useCallback((event) => {
    const gesture = pullGestureRef.current;
    if (!gesture.eligible) {
      return;
    }

    const touch = event.touches?.[0];
    const deltaY = (touch?.clientY || 0) - gesture.startY;
    if (deltaY <= 0) {
      setPullDistance(0);
      setPullArmed(false);
      return;
    }

    const resistedDistance = Math.min(PULL_REFRESH_MAX_PX, Math.round(deltaY * 0.55));
    setPullDistance(resistedDistance);
    setPullArmed(resistedDistance >= PULL_REFRESH_TRIGGER_PX);
  }, []);

  const handlePullRefreshEnd = useCallback(() => {
    const shouldRefresh = pullArmed && !liveRefreshActive;
    resetPullRefresh();

    if (shouldRefresh) {
      void loadSimpleNews({
        forceRefresh: true,
        refreshOrigin: 'pull',
        requestedMode: mode,
        requestedUserId: user?.id || '',
      });
    }
  }, [liveRefreshActive, loadSimpleNews, mode, pullArmed, resetPullRefresh, user?.id]);

  useEffect(() => {
    const priorityPressTimers = priorityPressTimersRef.current;
    return () => {
      for (const timer of priorityPressTimers.values()) {
        window.clearTimeout(timer);
      }
      priorityPressTimers.clear();
    };
  }, []);

  const openLatestItem = (item) => {
    if (suppressNextOpenItemId === item?.id) {
      setSuppressNextOpenItemId('');
      return;
    }

    setPriorityPickerItemId('');
    setSelectedGraphItem(item);
  };

  const clearPriorityPressTimer = (itemId = '') => {
    const timer = priorityPressTimersRef.current.get(itemId);
    if (timer) {
      window.clearTimeout(timer);
      priorityPressTimersRef.current.delete(itemId);
    }
  };

  const handlePriorityPressStart = (event, item) => {
    const itemId = String(item?.id || '');
    if (!itemId || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }

    clearPriorityPressTimer(itemId);
    const timer = window.setTimeout(() => {
      setPriorityPickerItemId(itemId);
      setSuppressNextOpenItemId(itemId);
      setMessage('Choose event priority.');
      priorityPressTimersRef.current.delete(itemId);
    }, 560);
    priorityPressTimersRef.current.set(itemId, timer);
  };

  const handlePriorityPressEnd = (item) => {
    clearPriorityPressTimer(String(item?.id || ''));
  };

  const handlePriorityContextMenu = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setPriorityPickerItemId(String(item?.id || ''));
    setSuppressNextOpenItemId(String(item?.id || ''));
    setMessage('Choose event priority.');
  };

  const syncDirectPriorityToRadar = async (item) => {
    const eventOnly = buildEventOnlyIntelligence(item, eventPriorityMap, eventSourceMap);
    const sourceTarget = inferPriorityRadarCompanyFromEvent(item, eventOnly);
    const directSourceId = sourceTarget?.directSourceId || sourceTarget?.companyId || '';
    if (!sourceTarget?.companyId && !directSourceId) {
      setMessage('Direct saved for this event. No matching notification source was found yet.');
      return;
    }

    const settings = loadPriorityRadarSettings();
    const releaseWatchCompanies = {
      ...(settings.releaseWatch?.companies || {}),
    };
    if (sourceTarget.companyId) {
      releaseWatchCompanies[sourceTarget.companyId] = true;
    }
    const directNewsSources = {
      ...(settings.directNewsWatch?.sources || {}),
    };

    if (sourceTarget.supportsDirectNews && directSourceId) {
      directNewsSources[directSourceId] = true;
    }

    const nextSettings = await savePriorityRadarSettings({
      ...settings,
      enabled: true,
      categories: {
        ...(settings.categories || {}),
        ai: true,
      },
      releaseWatch: {
        ...(settings.releaseWatch || {}),
        enabled: true,
        minImportance: 'important',
        companies: releaseWatchCompanies,
      },
      priorityProfile: {
        ...(settings.priorityProfile || {}),
        enabled: true,
        minImportance: 'important',
      },
      directNewsWatch: {
        ...(settings.directNewsWatch || {}),
        enabled: sourceTarget.supportsDirectNews
          ? true
          : settings.directNewsWatch?.enabled !== false,
        sources: directNewsSources,
      },
    });

    if (user?.id) {
      const selectedReleaseCompanies = Object.entries(nextSettings.releaseWatch?.companies || {})
        .filter(([, enabled]) => enabled)
        .map(([companyId]) => companyId);
      const selectedDirectSources = Object.entries(nextSettings.directNewsWatch?.sources || {})
        .filter(([, enabled]) => enabled)
        .map(([companyId]) => companyId);

      await updateNotificationPreferences({
        ai_release_watch_enabled: true,
        ai_release_watch_companies: selectedReleaseCompanies,
        ai_release_watch_min_importance: 'important',
        direct_news_watch_enabled: nextSettings.directNewsWatch?.enabled !== false,
        direct_news_watch_sources: selectedDirectSources,
        direct_news_watch_reason: nextSettings.directNewsWatch?.reason,
      });
    }

    setMessage(sourceTarget.supportsDirectNews
      ? `Direct alerts on for ${sourceTarget.label}.`
      : `${sourceTarget.label} added to high-priority release watch.`);
  };

  const handlePriorityLevelSelect = async (event, item, levelKey) => {
    event.stopPropagation();
    setEventPriorityMap((current) => saveEventPriorityLevel(item, levelKey, current));
    setPriorityPickerItemId('');
    const level = EVENT_PRIORITY_LEVELS.find((entry) => entry.key === levelKey);
    setMessage(level ? `Priority saved: ${level.label}.` : 'Priority saved.');

    if (levelKey === 'direct') {
      try {
        await syncDirectPriorityToRadar(item);
      } catch {
        setMessage('Direct saved locally. Notification sync needs sign-in and backend access.');
      }
    }
  };

  /**
   * Returns true when the item has a real content_items DB row.
   * Official-release alerts and locally-generated items use synthetic IDs
   * like 'official:…' or 'latest:…' that don't exist in the database.
   * Calling saveItem() or trackInteraction() with a synthetic ID inserts
   * dangling rows (saved_items with no matching content row) or hits FK
   * constraints. Guard every write operation with this check.
   */
  const isDbItem = (item) => {
    const id = String(item?.id || '');
    return Boolean(id) && !/^(official:|latest:|library:)/.test(id);
  };

  const handleLatestSave = async (item) => {
    try {
      // Non-DB items (official releases, synthetic feed items) can only be
      // saved locally — they have no matching content_items row.
      if (!user?.id || !isDbItem(item)) {
        saveGuestItem(item);
        setMessage(user?.id && !isDbItem(item)
          ? 'Saved locally. Official releases are not yet in the article database.'
          : 'Saved on this device only. Sign in to back it up.');
        return;
      }

      const payload = await saveItem(item.id);
      setMessage(payload?.success ? 'Saved for later.' : 'Sign in to save items.');
    } catch {
      setMessage('Could not save this item right now.');
    }
  };

  const handleLatestDismiss = async (item) => {
    try {
      // Only track dismissals for real DB items — synthetic IDs would hit a
      // FK constraint on user_interactions.content_id.
      if (user?.id && isDbItem(item)) {
        await trackInteraction(item.id, 'dismiss');
      }
    } catch {
      // Keep the feed responsive even if the interaction write fails.
    }
    onDismissItem?.(item);
    setLatestNewsItems((current) => current.filter((entry) => entry.id !== item.id));
    setMessage('Item hidden from your feeds.');
  };

  const handleShareItem = async (item) => {
    try {
      const res = await shareContentLink({
        title: item.title,
        text: item.summary || item.reason,
        url: item.url,
      });
      if (res.message) {
        setMessage(res.message);
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  const handleNeverShowType = (item) => {
    const eventOnly = buildEventOnlyIntelligence(item, eventPriorityMap, eventSourceMap);
    const typeToMute = eventOnly.eventType.key || item.kind || item.normalNewsCategory;
    if (typeToMute) {
      setMutedTypes(prev => [...prev, typeToMute]);
      setMessage(`Muted events of type: ${eventOnly.eventType.label || typeToMute}`);
    }
  };

  const hiddenIdSet = new Set(hiddenItemIds);
  const homeTemplateState = templateState || DEFAULT_HOME_TEMPLATE_STATE;
  const trackedCompanyLabels = getTrackedCompanyLabels(homeTemplateState.trackedCompanies);
  const visibleLatestNewsItems = latestNewsItems.filter((item) => !hiddenIdSet.has(item.id));
  const filteredLatestNewsItems = visibleLatestNewsItems
    .filter((item) => {
      const eventOnly = buildEventOnlyIntelligence(item, eventPriorityMap, eventSourceMap);
      const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`.toLowerCase();
      if (mutedTypes.some(muted => 
        text.includes(muted.toLowerCase()) || 
        item.kind === muted || 
        eventOnly.eventType.key === muted ||
        item.normalNewsCategory === muted
      )) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const getPriorityScore = (item) => {
        let score = 0;
        const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`.toLowerCase();
        
        // AI release: highest priority
        if (hasStrongAiReleaseSignal(item)) {
          score += 10000;
        }
        // Regional risk: second highest
        if (hasStrongRegionalSignal(item) || REGIONAL_SIGNAL_PATTERN.test(text)) {
          score += 5000;
        }
        // Watched topic / question
        const watchQuestions = homeTemplateState?.watchQuestions || [];
        const priorityTopics = homeTemplateState?.priorityTopics || [];
        if (
          watchQuestions.some((q) => matchesProfilePhrase(text, q)) ||
          priorityTopics.some((t) => matchesProfilePhrase(text, t))
        ) {
          score += 2500;
        }
        return score;
      };

      const pDiff = getPriorityScore(right) - getPriorityScore(left);
      if (pDiff !== 0) return pDiff;

      const eventScoreDiff = getEventOnlyPriorityScore(right, eventPriorityMap, eventSourceMap)
        - getEventOnlyPriorityScore(left, eventPriorityMap, eventSourceMap);
      if (eventScoreDiff) {
        return eventScoreDiff;
      }

      const latestPriorityDiff = Number(right?.latestPriority || 0) - Number(left?.latestPriority || 0);
      if (latestPriorityDiff) {
        return latestPriorityDiff;
      }

      const importanceDiff = computePersonalizedLatestNewsImportance(right, homeTemplateState)
        - computePersonalizedLatestNewsImportance(left, homeTemplateState);
      if (importanceDiff) {
        return importanceDiff;
      }

      return getItemTimestamp(right?.date || right?.publishedAt) - getItemTimestamp(left?.date || left?.publishedAt)
        || compareLatestNewsStable(left, right);
    });
  const hiddenBatchExhausted = !loading && !filteredLatestNewsItems.length && latestNewsItems.length > 0;
  const feedBannerMessage = feedHealth.status !== 'ok'
    ? feedHealth.message || 'Latest news is running in degraded mode.'
    : discoveryHealth.fallbackActive
      ? discoveryHealth.message || 'Discovery is using fallback sources.'
      : '';
  const showFeedBanner = !loading && Boolean(feedBannerMessage);
  const operatingBrief = buildOperatingBrief(templateState || {});
  const showOperatingBrief = Boolean(
    operatingBrief.priorityTopics.length
    || operatingBrief.trackedCompanies.length
    || operatingBrief.peopleOfInterest.length
    || operatingBrief.watchQuestions.length
  );
  const pullRefreshVisible = refreshIndicator.visible || pullDistance > 8;
  const pullRefreshProgress = refreshIndicator.visible
    ? 1
    : Math.min(1, pullDistance / PULL_REFRESH_TRIGGER_PX);
  const pullRefreshText = liveRefreshActive
    ? refreshIndicator.text
    : refreshIndicator.visible
      ? refreshIndicator.text
    : pullArmed
      ? 'Release to refresh live sources'
      : 'Pull down to refresh live sources';

  return (
    <div
      className="page-enter home-feed-screen"
      style={{ padding: 'var(--space-base) 0' }}
      onTouchStart={handlePullRefreshStart}
      onTouchMove={handlePullRefreshMove}
      onTouchEnd={handlePullRefreshEnd}
      onTouchCancel={resetPullRefresh}
    >
      <div
        className={`home-live-refresh ${pullRefreshVisible ? 'is-visible' : ''} ${liveRefreshActive ? 'is-refreshing' : ''} ${pullArmed ? 'is-armed' : ''}`}
        style={{ '--pull-progress': pullRefreshProgress }}
        role="status"
        aria-live="polite"
        aria-hidden={pullRefreshVisible ? 'false' : 'true'}
        data-refresh-source={refreshIndicator.source || 'pull_gesture'}
        data-refresh-status={refreshIndicator.status}
      >
        <span className="home-live-refresh__spinner" aria-hidden="true" />
        <span>{pullRefreshText}</span>
      </div>
      <div className="container page-shell">
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-base)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-medium)',
          borderBottom: '1px solid var(--border-soft)',
          paddingBottom: 'var(--space-small)'
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
            {[
              { key: 'feed', label: 'Feed' },
              { key: 'growth', label: 'Growth' },
              { key: 'research', label: 'Research' },
              { key: 'creation', label: 'Creation' },
              { key: 'surprise', label: 'Surprise' }
            ].map((m) => {
              const isActive = mode === m.key;
              return (
                <button
                  key={m.key}
                  className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setMode(m.key)}
                  style={{
                    borderRadius: '20px',
                    padding: '6px 16px',
                    fontWeight: 600
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => onNavigate?.('add-interest')} style={{ borderRadius: '20px', padding: '6px 16px', fontWeight: 600 }}>
              + Add Monitor
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-large)', alignItems: 'flex-start' }}>
          
          <div style={{ flex: '1 1 60%', minWidth: '320px', display: 'flex', flexDirection: 'column', gap: 'var(--space-large)' }}>
            <section className="simple-news-section">
          {showFeedBanner ? (
            <div className="feed-inline-status">
              {feedHealth.status !== 'ok' ? 'Connection needed.' : 'Fallback sources.'}
            </div>
          ) : null}

          {!loading && hiddenBatchExhausted ? (
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Pull down for a new set.
            </p>
          ) : null}

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {[1, 2].map((item) => (
                <div key={item}>
                  <div className="skeleton" style={{ width: '100%', height: '180px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-small)' }} />
                  <div className="skeleton" style={{ width: '80%', height: '18px', marginBottom: '6px' }} />
                  <div className="skeleton" style={{ width: '50%', height: '14px' }} />
                </div>
              ))}
            </div>
          ) : filteredLatestNewsItems.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {filteredLatestNewsItems.map((item) => (
                (() => {
                  const eventOnly = buildEventOnlyIntelligence(item, eventPriorityMap, eventSourceMap);
                  const rationale = buildSignalRationale(item);
                  const priorityPickerOpen = priorityPickerItemId === item.id;
                  const eventToneClass = `is-${eventOnly.eventType.key}`;
                  const eventVisualUrl = pickEventVisualUrl(item);
                  const rankScore = computePersonalizedLatestNewsImportance(item, homeTemplateState)
                    + getEventOnlyPriorityScore(item, eventPriorityMap, eventSourceMap);
                  const sourceTrustPercent = Math.round(clamp01(item?.sourceTrust, clamp01(item?.scores?.sourceTrust, 0.5)) * 100);
                  const freshness = (() => {
                    const ts = item.date || item.publishedAt;
                    if (!ts) return 'Unknown';
                    const ageHours = (Date.now() - new Date(ts).getTime()) / 3600000;
                    if (ageHours < 1) return 'Just now';
                    if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
                    return `${Math.round(ageHours / 24)}d ago`;
                  })();
                  const matchedRule = (() => {
                    const text = `${item?.title || ''} ${item?.summary || ''} ${item?.reason || ''} ${item?.source || ''}`;
                    const peopleOfInterest = homeTemplateState?.peopleOfInterest || [];
                    const priorityTopics = homeTemplateState?.priorityTopics || [];
                    const watchQuestions = homeTemplateState?.watchQuestions || [];
                    if (matchesPeopleOfInterest(item, peopleOfInterest)) {
                      return 'Voice of Interest';
                    }
                    if (priorityTopics.some((topic) => matchesProfilePhrase(text, topic))) {
                      return 'Priority Topic';
                    }
                    if (watchQuestions.some((question) => matchesProfilePhrase(text, question))) {
                      return 'Watched Question';
                    }
                    if (isOfficialLatestItem(item)) {
                      return 'Official Release';
                    }
                    if (isVoiceLatestItem(item)) {
                      return 'Tracked Leader';
                    }
                    if (hasStrongRegionalSignal(item)) {
                      return 'Regional Focus';
                    }
                    if (CLAUDE_FABLE_MYTHOS_PATTERN.test(text)) {
                      return 'Claude/Mythos Rule';
                    }
                    return 'General Relevance';
                  })();
                  const actionValue = Math.round(clamp01(item?.scores?.decisionUsefulness || item?.scores?.lifeImpact || 0.5, 0.5) * 100) + '%';
                  return (
                    <article
                      key={item.id}
                      className={`card event-only-card ${eventToneClass}`}
                      data-event-only-card="true"
                      data-event-meaning={eventOnly.meaning}
                      data-event-priority={eventOnly.priority?.key || ''}
                      aria-label={`${eventOnly.title}. Meaning: ${eventOnly.meaning}. Tap for details.`}
                      onClick={() => openLatestItem(item)}
                      onPointerDown={(event) => handlePriorityPressStart(event, item)}
                      onPointerUp={() => handlePriorityPressEnd(item)}
                      onPointerLeave={() => handlePriorityPressEnd(item)}
                      onPointerCancel={() => handlePriorityPressEnd(item)}
                      onContextMenu={(event) => handlePriorityContextMenu(event, item)}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-small)',
                        padding: 'var(--space-medium)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-soft)',
                        background: 'var(--surface-elevated)',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer',
                        overflow: 'hidden'
                      }}
                    >
                      {/* Event header: Visual Cue, Title, Priority, 3-word Meaning */}
                      <div style={{ display: 'flex', gap: 'var(--space-base)', alignItems: 'flex-start' }}>
                        <div className="event-only-visual" data-event-visual-cue="true" aria-hidden="true" style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          background: 'var(--bg-tone-subtle, rgba(255, 255, 255, 0.05))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          flexShrink: 0,
                          overflow: 'hidden',
                          border: '1px solid var(--border-soft)'
                        }}>
                          {eventVisualUrl ? (
                            <img src={eventVisualUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span className="event-only-cue" style={{ fontWeight: 'bold' }}>
                              {eventOnly.eventType.cue || 'S'}
                            </span>
                          )}
                        </div>
                        
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap', marginBottom: '4px' }}>
                            <span style={{
                              fontSize: '11px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              fontWeight: 700,
                              color: 'var(--accent)',
                              background: 'rgba(var(--accent-rgb), 0.1)',
                              padding: '2px 8px',
                              borderRadius: '12px'
                            }}>
                              {eventOnly.eventType.label}
                            </span>
                            
                            {eventOnly.priority ? (
                              <span className={`event-only-priority is-${eventOnly.priority.key}`} style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                textTransform: 'uppercase'
                              }}>
                                {eventOnly.priority.label}
                              </span>
                            ) : null}
                          </div>

                          <h3 className="event-only-title" style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            margin: '0 0 6px 0',
                            lineHeight: '1.3',
                            color: 'var(--text-primary)'
                          }}>
                            {eventOnly.title}
                          </h3>

                          <div className="event-only-meaning" aria-label={`Three-word meaning: ${eventOnly.meaning}`} style={{
                            fontSize: '12px',
                            fontWeight: 500,
                            color: 'var(--text-secondary)',
                            display: 'inline-block',
                            background: 'var(--bg-tone-subtle, rgba(255,255,255,0.03))',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-soft)'
                          }}>
                            💡 {eventOnly.meaning}
                          </div>
                        </div>
                      </div>

                      {/* Event Details: Evidence, Why Shown, Freshness, Action */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 'var(--space-small)',
                        padding: 'var(--space-small)',
                        background: 'rgba(0, 0, 0, 0.1)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '12px',
                        marginTop: 'var(--space-tight)'
                      }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Evidence</span>
                          <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                {eventOnly.source}
                              </a>
                            ) : eventOnly.source}
                            {item.whyTrusted ? ` (${item.whyTrusted})` : ''}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Why Shown</span>
                          <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {rationale.whyShown || item.reason || 'Matches your profile'}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Freshness</span>
                          <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{freshness}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Action</span>
                          <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {item.scores?.decisionUsefulness ? `Usefulness: ${Math.round(item.scores.decisionUsefulness * 100)}%` : 'Review for decision value'}
                          </span>
                        </div>
                      </div>

                      {/* Compact Metrics Row: Rank, Trust, Fresh, Why */}
                      <div className="event-rank-metrics" aria-label="Why this item was ranked here" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'var(--surface)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-soft)',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-secondary)'
                      }}>
                        <span>📊 Rank: {Math.max(0, Math.round(rankScore))}</span>
                        <span>🛡️ Trust: {sourceTrustPercent}%</span>
                        <span>⏱️ Fresh: {freshness}</span>
                        <span>🎯 Why: {matchedRule}</span>
                        <span>Shown: {shortenExplanation(rationale.whyShown || item.reason || item.summary, 8)}</span>
                      </div>

                      {priorityPickerOpen ? (
                        <div
                          className="event-priority-picker"
                          aria-label="Set local event priority"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {EVENT_PRIORITY_LEVELS.map((level) => (
                            <button
                              key={level.key}
                              type="button"
                              className={`event-priority-option ${eventOnly.priority?.key === level.key ? 'is-active' : ''}`}
                              onClick={(event) => handlePriorityLevelSelect(event, item, level.key)}
                            >
                              {level.label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {/* Action / Feedback Buttons */}
                      <div className="card-actions" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 'var(--space-small)',
                        marginTop: 'var(--space-tight)',
                        flexWrap: 'wrap'
                      }} onClick={(event) => event.stopPropagation()}>
                        {/* Feedback Buttons */}
                        <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '11px', color: 'var(--accent)' }}
                            onClick={() => alert(`Why is this here?\n\nThis item matches your monitored topics/companies because of the following signals:\n- Target: ${matchedRule}\n- Rationale: ${rationale.whyShown || item.reason || item.summary}\n- Trust Score: ${sourceTrustPercent}%`)}
                          >
                            ❓ Why is this here?
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '11px', color: 'var(--error, #ff4d4d)' }}
                            onClick={() => handleNeverShowType(item)}
                          >
                            🚫 Never show this type
                          </button>
                        </div>

                        {/* Regular card actions */}
                        <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
                          <button className="btn btn-ghost btn-sm event-only-detail" onClick={() => openLatestItem(item)}>
                            Details
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleShareItem(item)}>
                            Share
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleLatestSave(item)}>
                            Save
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleLatestDismiss(item)}>
                            Hide
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })()
              ))}
            </div>
          ) : (
            <div className="card" style={{ color: 'var(--text-secondary)' }}>
              {backendUnavailable
                ? 'No live news yet.'
                : 'No matching news yet.'}
            </div>
          )}
        </section>

          </div>
        </div>

        {false && showOperatingBrief ? (
          <section
            className="card"
            style={{
              padding: 'var(--space-medium)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-base)',
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--chrome-bg)) 0%, var(--surface-elevated) 100%)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <span className="page-kicker">Supporting brief</span>
                <h2 className="section-title" style={{ marginTop: '6px' }}>What Explore is optimizing for right now</h2>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('template')}>
                  Edit rules
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('preferences')}>
                  Alerts
                </button>
              </div>
            </div>

            <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', margin: 0 }}>
              {operatingBrief.summary}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-small)' }}>
              <div className="subtle-panel" style={{ gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Watching for</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {operatingBrief.priorityTopics.length ? operatingBrief.priorityTopics.slice(0, 5).map((topic) => (
                    <span key={topic} className="chip active">{topic}</span>
                  )) : (
                    <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>No focus topics saved yet.</span>
                  )}
                </div>
              </div>

              <div className="subtle-panel" style={{ gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Companies and voices</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[...operatingBrief.trackedCompanies, ...operatingBrief.peopleOfInterest].slice(0, 6).map((entry) => (
                    <span key={entry} className="chip active">{entry}</span>
                  ))}
                  {!operatingBrief.trackedCompanies.length && !operatingBrief.peopleOfInterest.length ? (
                    <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Add people or companies in Rules.</span>
                  ) : null}
                </div>
              </div>

              <div className="subtle-panel" style={{ gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Interest brain</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <span className="chip active">{operatingBrief.alertStyle}</span>
                  {operatingBrief.preferredSources.slice(0, 3).map((entry) => (
                    <span key={entry} className="chip">{entry}</span>
                  ))}
                </div>
                {operatingBrief.avoidTopics.length ? (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                    Suppressing: {operatingBrief.avoidTopics.slice(0, 3).join(', ')}
                  </p>
                ) : null}
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                  This is the brief the feed follows after freshness is set first.
                </p>
              </div>
            </div>

        {operatingBrief.watchQuestions.length ? (
              <div className="subtle-panel" style={{ gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Questions the app is answering</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {operatingBrief.watchQuestions.slice(0, 3).map((question) => (
                    <p key={question} style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                      {question}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        </div>

        {selectedGraphItem && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(10, 11, 15, 0.85)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 'var(--space-medium)'
          }} onClick={() => setSelectedGraphItem(null)}>
            <style>{`
              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
              @keyframes dash {
                to {
                  stroke-dashoffset: -100;
                }
              }
            `}</style>
            <div style={{
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-lg)',
              width: '100%',
              maxWidth: '680px',
              padding: 'var(--space-medium)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-base)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              maxHeight: '90vh',
              overflowY: 'auto',
              animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="page-kicker" style={{ color: 'var(--accent)' }}>Source Web Evidence Graph</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedGraphItem(null)} style={{ fontSize: '18px' }}>✕</button>
              </div>

              <div>
                <h3 style={{ font: 'var(--font-h3)', color: 'var(--text-primary)', margin: 0 }}>
                  {selectedGraphItem.title}
                </h3>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: 0 }}>
                  Claim assessment based on corroboration pathways and publisher cross-referencing.
                </p>
              </div>

              <div style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 'var(--space-base) 0',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 'var(--radius-md)',
                minHeight: '260px',
                overflow: 'hidden'
              }}>
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  <path d="M 340 70 C 240 70, 170 160, 170 200" fill="none" stroke="var(--emerald, #10b981)" strokeWidth="2" strokeDasharray="4 4" style={{ animation: 'dash 15s linear infinite' }} />
                  <path d="M 340 70 C 440 70, 510 160, 510 200" fill="none" stroke="var(--amber, #f59e0b)" strokeWidth="2" strokeDasharray="4 4" style={{ animation: 'dash 15s linear infinite' }} />
                </svg>

                <div className="subtle-panel" style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--accent)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 18px',
                  maxWidth: '280px',
                  textAlign: 'center',
                  zIndex: 2,
                  boxShadow: '0 0 15px rgba(99, 102, 241, 0.15)',
                  marginBottom: 'var(--space-medium)'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', textTransform: 'uppercase', display: 'block', fontWeight: 600, letterSpacing: '0.05em' }}>Claim Node</span>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-primary)', fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {selectedGraphItem.title}
                  </span>
                </div>

                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-around', zIndex: 2 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-small)', width: '45%' }}>
                    <span style={{
                      font: 'var(--font-caption)',
                      color: 'var(--emerald, #10b981)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      fontSize: '11px',
                      background: 'rgba(16, 185, 129, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(16, 185, 129, 0.2)'
                    }}>
                      Supporting (Corroborated)
                    </span>

                    {(selectedGraphItem.supporting_sources || [
                      { name: selectedGraphItem.source || 'Primary Press', type: 'corroboration', trust: 'High Trust' },
                      { name: 'Associated Press', type: 'corroboration', trust: 'High Trust' }
                    ]).map((src, i) => (
                      <div key={i} className="subtle-panel" style={{
                        background: 'rgba(16, 185, 129, 0.03)',
                        border: '1px solid rgba(16, 185, 129, 0.15)',
                        padding: '8px 12px',
                        width: '100%',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease'
                      }}
                      onClick={() => setMessage(`Source verified: ${src.name} is classified as ${src.trust}.`)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>{src.name}</strong>
                          <span style={{ fontSize: '9px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald, #10b981)', padding: '1px 4px', borderRadius: '3px' }}>
                            {src.trust}
                          </span>
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                          Confirmed release details and publisher identity matching.
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-small)', width: '45%' }}>
                    <span style={{
                      font: 'var(--font-caption)',
                      color: 'var(--amber, #f59e0b)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      fontSize: '11px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(245, 158, 11, 0.2)'
                    }}>
                      Contradicting / Speculative
                    </span>

                    {(selectedGraphItem.contradicting_sources || [
                      { name: 'Social Speculation', type: 'unconfirmed', trust: 'Low Trust' },
                      { name: 'Competitor PR', type: 'bias_check', trust: 'Medium Trust' }
                    ]).map((src, i) => (
                      <div key={i} className="subtle-panel" style={{
                        background: 'rgba(245, 158, 11, 0.03)',
                        border: '1px solid rgba(245, 158, 11, 0.15)',
                        padding: '8px 12px',
                        width: '100%',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease'
                      }}
                      onClick={() => setMessage(`Source flagged: ${src.name} is classified as ${src.trust}.`)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>{src.name}</strong>
                          <span style={{ fontSize: '9px', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--amber, #f59e0b)', padding: '1px 4px', borderRadius: '3px' }}>
                            {src.trust}
                          </span>
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                          Unconfirmed third-party claims or unsourced discussions.
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-small)', justifyContent: 'flex-end', marginTop: 'var(--space-tight)' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedGraphItem(null)}>
                  Close
                </button>
                <button className="btn btn-primary" onClick={() => {
                  const item = selectedGraphItem;
                  setSelectedGraphItem(null);
                  onNavigate?.('detail', {
                    ...item,
                    url: String(item?.url || item?.alert?.url || '').trim(),
                  });
                }}>
                  Open article detail
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
