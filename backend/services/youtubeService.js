// YouTube Data Fetcher - production implementation.
// Uses YouTube Data API v3 for metadata, discovery, and channel lookups.
const { google } = require('googleapis');
const { fetchPublicTranscript } = require('../src/services/transcriptService');
const ContentSourceAdapter = require('../src/services/contentSourceAdapter');
const embeddingProvider = require('../src/services/embeddingProvider');
const llmProvider = require('../src/services/llmProvider');

const GOOGLE_API_KEY_PATTERN = /^AIza[0-9A-Za-z\-_]{20,}$/;
const YOUTUBE_ROTATE_STATUSES = new Set([403, 429, 500, 503]);
const MAX_YOUTUBE_KEYS_PER_REQUEST = Math.max(
  1,
  Math.min(Number(process.env.YOUTUBE_MAX_KEYS_PER_REQUEST || 2), 10)
);
const YOUTUBE_KEY_COOLDOWN_BASE_MS = {
  403: 15 * 60 * 1000,
  429: 5 * 60 * 1000,
  500: 60 * 1000,
  503: 60 * 1000,
  default: 5 * 60 * 1000,
};
const YOUTUBE_KEY_COOLDOWN_MAX_MS = 6 * 60 * 60 * 1000;
const youtubeKeyCooldowns = new Map();
let youtubeRoundRobinCursor = 0;

function isDevMocksEnabled() {
  return String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true';
}

function isUsableYouTubeApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  if (/YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO/i.test(normalized)) {
    return false;
  }

  if (/^(?:x|y|z|null|none|undefined|test)$/i.test(normalized)) {
    return false;
  }

  return GOOGLE_API_KEY_PATTERN.test(normalized);
}

function getYouTubeApiKeys() {
  const envKeys = [process.env.YOUTUBE_API_KEY];
  const pooledKeys = String(process.env.YOUTUBE_API_KEYS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  for (let index = 1; index <= 10; index += 1) {
    envKeys.push(process.env[`YOUTUBE_API_KEY_${index}`]);
  }

  return [...new Set(
    [...envKeys, ...pooledKeys]
      .map((value) => String(value || '').trim())
      .filter((value) => isUsableYouTubeApiKey(value))
  )];
}

function getYouTubeCooldownStatus(errorOrStatus) {
  const status = Number(
    errorOrStatus?.code
      || errorOrStatus?.status
      || errorOrStatus?.response?.status
      || errorOrStatus?.cause?.status
      || errorOrStatus
      || 0
  );

  return Number.isFinite(status) ? status : 0;
}

function markYouTubeKeyCooldown(apiKey, errorOrStatus) {
  const normalizedKey = String(apiKey || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const status = getYouTubeCooldownStatus(errorOrStatus) || 429;
  const previousState = youtubeKeyCooldowns.get(normalizedKey);
  const failureCount = Number(previousState?.failureCount || 0);
  const base = YOUTUBE_KEY_COOLDOWN_BASE_MS[status] || YOUTUBE_KEY_COOLDOWN_BASE_MS.default;
  const cooldownUntil = Date.now() + Math.min(YOUTUBE_KEY_COOLDOWN_MAX_MS, base * (2 ** failureCount));
  const nextState = {
    status,
    failureCount: failureCount + 1,
    cooldownUntil,
    updatedAt: new Date().toISOString(),
  };
  youtubeKeyCooldowns.set(normalizedKey, nextState);
  return nextState;
}

function clearYouTubeKeyCooldown(apiKey) {
  const normalizedKey = String(apiKey || '').trim();
  if (normalizedKey) {
    youtubeKeyCooldowns.delete(normalizedKey);
  }
}

function advanceYouTubeRoundRobinCursor(apiKey) {
  const apiKeys = getYouTubeApiKeys();
  const usedIndex = apiKeys.indexOf(apiKey);
  if (usedIndex < 0 || apiKeys.length === 0) {
    youtubeRoundRobinCursor += 1;
    return;
  }

  youtubeRoundRobinCursor = (usedIndex + 1) % apiKeys.length;
}

function getYouTubeKeyRotationOrder({ includeCoolingFallback = false } = {}) {
  const apiKeys = getYouTubeApiKeys();
  const now = Date.now();
  const available = [];
  const cooling = [];

  apiKeys.forEach((apiKey, index) => {
    const state = youtubeKeyCooldowns.get(apiKey);
    if (state && Number(state.cooldownUntil || 0) > now) {
      cooling.push({
        apiKey,
        cooldownUntil: Number(state.cooldownUntil || 0),
        index,
      });
      return;
    }

    if (state && Number(state.cooldownUntil || 0) <= now) {
      youtubeKeyCooldowns.delete(apiKey);
    }

    available.push({ apiKey, index });
  });

  if (available.length > 0) {
    const ordered = available.sort((left, right) => left.index - right.index);
    const normalizedCursor = ((youtubeRoundRobinCursor % apiKeys.length) + apiKeys.length) % apiKeys.length;
    let startIndex = ordered.findIndex((entry) => entry.index >= normalizedCursor);
    if (startIndex < 0) {
      startIndex = 0;
    }
    return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)].map((entry) => entry.apiKey);
  }

  if (!includeCoolingFallback) {
    return [];
  }

  return cooling
    .sort((left, right) => left.cooldownUntil - right.cooldownUntil || left.index - right.index)
    .map((entry) => entry.apiKey);
}

function getYouTubeKeyHealthSummary(apiKeys = getYouTubeApiKeys()) {
  const now = Date.now();
  const cooling = [];

  for (const apiKey of apiKeys) {
    const state = youtubeKeyCooldowns.get(apiKey);
    if (state && Number(state.cooldownUntil || 0) > now) {
      cooling.push(state);
    }
  }

  const cooldownStatuses = {};
  for (const state of cooling) {
    const status = String(state.status || 'unknown');
    cooldownStatuses[status] = (cooldownStatuses[status] || 0) + 1;
  }

  return {
    configuredKeys: apiKeys.length,
    availableKeys: Math.max(0, apiKeys.length - cooling.length),
    coolingKeys: cooling.length,
    cooldownStatuses,
  };
}

function createYoutubeClient(apiKey) {
  return google.youtube({
    version: 'v3',
    auth: apiKey,
  });
}

function getYouTubeErrorStatus(error) {
  return Number(
    error?.code
      || error?.status
      || error?.response?.status
      || error?.cause?.status
      || 0
  );
}

function isRetryableYouTubeError(error) {
  const status = getYouTubeErrorStatus(error);
  if (YOUTUBE_ROTATE_STATUSES.has(status)) {
    return true;
  }

  const message = String(
    error?.errors?.[0]?.reason
      || error?.response?.data?.error?.message
      || error?.message
      || ''
  ).toLowerCase();

  return message.includes('quota')
    || message.includes('rate limit')
    || message.includes('user rate limit');
}

async function executeYouTubeRequest(executor) {
  const apiKeys = getYouTubeKeyRotationOrder();
  if (apiKeys.length === 0) {
    const configuredKeys = getYouTubeApiKeys();
    if (configuredKeys.length > 0) {
      const health = getYouTubeKeyHealthSummary(configuredKeys);
      throw new Error(`YouTube API keys are temporarily cooling (${health.coolingKeys}/${configuredKeys.length}).`);
    }
    throw new Error('No YouTube API key is configured. Add YOUTUBE_API_KEY, YOUTUBE_API_KEYS, or YOUTUBE_API_KEY_1..10 to backend/.env, or enable ALLOW_DEV_MOCKS=true for local development.');
  }

  let lastError = null;
  const attempts = apiKeys.slice(0, Math.max(1, Math.min(MAX_YOUTUBE_KEYS_PER_REQUEST, apiKeys.length)));

  for (let index = 0; index < attempts.length; index += 1) {
    const apiKey = attempts[index];
    const youtube = createYoutubeClient(apiKey);
    advanceYouTubeRoundRobinCursor(apiKey);

    try {
      const result = await executor(youtube, apiKey, index);
      clearYouTubeKeyCooldown(apiKey);
      return result;
    } catch (error) {
      lastError = error;
      if (isRetryableYouTubeError(error)) {
        markYouTubeKeyCooldown(apiKey, error);
      }
      const shouldRotate = isRetryableYouTubeError(error) && index < attempts.length - 1;
      if (!shouldRotate) {
        throw error;
      }
    }
  }

  throw lastError || new Error('YouTube request failed.');
}

function requireApiKeyForRealUsage() {
  if (getYouTubeApiKeys().length > 0) {
    return;
  }

  if (isDevMocksEnabled()) {
    throw new Error('Real YouTube discovery requires YOUTUBE_API_KEY. Disable the discovery worker or add a key.');
  }

  throw new Error(
    'No YouTube API key is configured. Add YOUTUBE_API_KEY, YOUTUBE_API_KEYS, or YOUTUBE_API_KEY_1..10 to backend/.env, or enable ALLOW_DEV_MOCKS=true for local development.'
  );
}

function buildVideoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = String(url || '').match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function parseDuration(iso) {
  if (!iso) {
    return 0;
  }

  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    return 0;
  }

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseDurationText(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 0;
  }

  if (/^\d+(?::\d+){1,2}$/.test(normalized)) {
    const parts = normalized.split(':').map((entry) => Number(entry || 0));
    if (parts.length === 2) {
      return (parts[0] * 60) + parts[1];
    }
    if (parts.length === 3) {
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }
  }

  const hours = Number((normalized.match(/(\d+)\s*hour/i) || [])[1] || 0);
  const minutes = Number((normalized.match(/(\d+)\s*minute/i) || [])[1] || 0);
  const seconds = Number((normalized.match(/(\d+)\s*second/i) || [])[1] || 0);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function parseCompactCountText(value = '') {
  const normalized = String(value || '').trim().replace(/,/g, '');
  if (!normalized) {
    return 0;
  }

  const match = normalized.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) {
    return 0;
  }

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const suffix = String(match[2] || '').toUpperCase();
  if (suffix === 'K') {
    return Math.round(numeric * 1_000);
  }
  if (suffix === 'M') {
    return Math.round(numeric * 1_000_000);
  }
  if (suffix === 'B') {
    return Math.round(numeric * 1_000_000_000);
  }

  return Math.round(numeric);
}

function normalizeTranscriptText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildTranscriptMetadata(transcriptPayload = {}, fallbackText = '') {
  const rawTranscript = normalizeTranscriptText(
    transcriptPayload.transcript
    || transcriptPayload.transcriptPreview
    || ''
  );
  const fallbackTranscript = normalizeTranscriptText(fallbackText || '');
  const transcriptUpdatedAt = String(
    transcriptPayload.transcriptUpdatedAt
    || transcriptPayload.transcript_updated_at
    || new Date().toISOString()
  ).trim();
  const hasTranscript = Boolean(rawTranscript);
  const hasFallback = !hasTranscript && Boolean(fallbackTranscript);
  const transcriptStatus = hasTranscript
    ? String(transcriptPayload.transcriptStatus || transcriptPayload.transcript_status || 'available')
    : hasFallback
      ? 'description_only'
      : 'unavailable';
  const transcriptSource = hasTranscript
    ? String(transcriptPayload.transcriptSource || transcriptPayload.transcript_source || transcriptPayload.transcriptProvider || transcriptPayload.transcript_provider || 'public_captions')
    : hasFallback
      ? 'description_fallback'
      : 'unavailable';
  const transcriptProvider = hasTranscript
    ? String(transcriptPayload.transcriptProvider || transcriptPayload.transcript_provider || transcriptSource || 'youtube-json3')
    : String(transcriptPayload.transcriptProvider || transcriptPayload.transcript_provider || transcriptSource || 'youtube-watch-page');
  const transcript = hasTranscript ? rawTranscript : (hasFallback ? fallbackTranscript : '');
  const transcriptPreview = normalizeTranscriptText(
    transcriptPayload.transcriptPreview
    || transcript
    || fallbackTranscript
  ).slice(0, 280);

  return {
    transcript,
    transcriptStatus,
    transcriptSource,
    transcriptPreview,
    transcriptUpdatedAt,
    transcriptProvider,
    transcript_status: transcriptStatus,
    transcript_source: transcriptSource,
    transcript_preview: transcriptPreview,
    transcript_updated_at: transcriptUpdatedAt,
    transcript_provider: transcriptProvider,
  };
}

function parseRelativePublishedTime(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(streamed|premiered)\s+/i, '');

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1] || 0);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unitMs = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  }[unit];

  if (!unitMs) {
    return null;
  }

  return new Date(Date.now() - (amount * unitMs)).toISOString();
}

function parseRendererText(node) {
  if (!node) {
    return '';
  }

  if (typeof node.simpleText === 'string') {
    return node.simpleText;
  }

  if (Array.isArray(node.runs)) {
    return node.runs.map((run) => run?.text || '').join('').trim();
  }

  return '';
}

function extractYtInitialData(html = '') {
  const patterns = [
    /var ytInitialData = (\{[\s\S]*?\});<\/script>/,
    /window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/,
  ];

  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (!match?.[1]) {
      continue;
    }

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      continue;
    }
  }

  return null;
}

function collectVideoRenderers(node, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectVideoRenderers(entry, results);
    }
    return results;
  }

  if (typeof node !== 'object') {
    return results;
  }

  if (node.videoRenderer) {
    results.push(node.videoRenderer);
    return results;
  }

  for (const value of Object.values(node)) {
    collectVideoRenderers(value, results);
  }

  return results;
}

function mapFallbackSearchRenderer(renderer = {}) {
  const videoId = String(renderer?.videoId || '').trim();
  if (!videoId) {
    return null;
  }

  const title = parseRendererText(renderer.title);
  const description = (
    Array.isArray(renderer.detailedMetadataSnippets)
      ? renderer.detailedMetadataSnippets
          .flatMap((entry) => entry?.snippetText?.runs || [])
          .map((entry) => entry?.text || '')
          .join('')
      : parseRendererText(renderer.descriptionSnippet)
  ).trim();
  const channelTitle = parseRendererText(renderer.longBylineText)
    || parseRendererText(renderer.ownerText)
    || parseRendererText(renderer.shortBylineText);
  const channelId = renderer.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || renderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || renderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || '';
  const thumbnailUrl = Array.isArray(renderer.thumbnail?.thumbnails)
    ? renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1]?.url || null
    : null;
  const publishedText = parseRendererText(renderer.publishedTimeText);
  const durationLabel = parseRendererText(renderer.lengthText)
    || String(renderer.title?.accessibility?.accessibilityData?.label || '');
  const viewCount = parseCompactCountText(parseRendererText(renderer.viewCountText));

  return {
    videoId,
    title,
    description,
    channelTitle,
    channelId,
    thumbnailUrl,
    publishDate: parseRelativePublishedTime(publishedText),
    durationSeconds: parseDurationText(durationLabel),
    viewCount,
    url: buildVideoUrl(videoId),
  };
}

function parseSearchResultsFromHtml(html = '', maxResults = 5) {
  const initialData = extractYtInitialData(html);
  if (!initialData) {
    return [];
  }

  return collectVideoRenderers(initialData)
    .map(mapFallbackSearchRenderer)
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(Number(maxResults) || 5, 10)));
}

async function searchRecentVideosWithoutApiKey(query, maxResults = 5) {
  const response = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || '').trim())}&sp=CAI%253D`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`YouTube search fallback failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseSearchResultsFromHtml(html, maxResults);
}

function parseChannelId(input) {
  const value = String(input || '').trim();
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(value)) {
    return value;
  }

  const channelMatch = value.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
  return channelMatch ? channelMatch[1] : '';
}

function parseHandle(input) {
  const value = String(input || '').trim();
  const handleMatch = value.match(/(?:youtube\.com\/)?(@[a-zA-Z0-9._-]+)/i);
  if (handleMatch) {
    return handleMatch[1];
  }

  return value.startsWith('@') ? value : '';
}

function mapSearchVideoItem(item) {
  const videoId = item?.id?.videoId;
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    channelTitle: item.snippet?.channelTitle || '',
    channelId: item.snippet?.channelId || '',
    thumbnailUrl: item.snippet?.thumbnails?.high?.url
      || item.snippet?.thumbnails?.default?.url
      || null,
    publishDate: item.snippet?.publishedAt || null,
    url: buildVideoUrl(videoId),
  };
}

function mapSearchChannelItem(item) {
  const channelId = item?.id?.channelId;
  if (!channelId) {
    return null;
  }

  return {
    channelId,
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || null,
    publishDate: item.snippet?.publishedAt || null,
  };
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripXmlTags(value = '') {
  return decodeXmlEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseXmlTag(block = '', tagName = '') {
  const match = String(block || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? stripXmlTags(match[1]) : '';
}

function parseXmlAttribute(block = '', tagName = '', attributeName = '') {
  const tagMatch = String(block || '').match(new RegExp(`<${tagName}\\b([^>]*)\\/?>`, 'i'));
  const attributeMatch = String(tagMatch?.[1] || '').match(new RegExp(`${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return attributeMatch?.[2] ? decodeXmlEntities(attributeMatch[2]).trim() : '';
}

function parseYoutubeRssFeed(xml = '', channelId = '', maxResults = 5) {
  const entries = String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  return entries.slice(0, Math.max(1, Math.min(Number(maxResults) || 5, 10))).map((entry) => {
    const videoId = parseXmlTag(entry, 'yt:videoId') || extractVideoId(parseXmlAttribute(entry, 'link', 'href'));
    const link = parseXmlAttribute(entry, 'link', 'href') || (videoId ? buildVideoUrl(videoId) : '');

    return {
      videoId,
      title: parseXmlTag(entry, 'title'),
      description: parseXmlTag(entry, 'media:description'),
      channelTitle: parseXmlTag(entry, 'name') || parseXmlTag(entry, 'author'),
      channelId: parseXmlTag(entry, 'yt:channelId') || channelId,
      thumbnailUrl: parseXmlAttribute(entry, 'media:thumbnail', 'url') || null,
      publishDate: parseXmlTag(entry, 'published') || parseXmlTag(entry, 'updated') || null,
      url: link,
    };
  }).filter((item) => item.videoId && item.url);
}

async function fetchRecentChannelVideosViaRss(channelId, maxResults = 5) {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube RSS fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseYoutubeRssFeed(xml, channelId, maxResults);
}

async function searchChannels(query, maxResults = 5) {
  requireApiKeyForRealUsage();

  const response = await executeYouTubeRequest((youtube) => youtube.search.list({
    part: ['snippet'],
    q: String(query || '').trim(),
    type: ['channel'],
    order: 'relevance',
    maxResults: Math.max(1, Math.min(Number(maxResults) || 5, 10)),
  }));

  return (response.data.items || []).map(mapSearchChannelItem).filter(Boolean);
}

async function resolveChannelInput(input) {
  requireApiKeyForRealUsage();

  const explicitChannelId = parseChannelId(input);
  if (explicitChannelId) {
    const details = await exports.fetchChannelData(explicitChannelId);
    if (!details) {
      return null;
    }

    return {
      channelId: explicitChannelId,
      title: details.name,
      description: details.description,
      channelUrl: `https://www.youtube.com/channel/${explicitChannelId}`,
      thumbnailUrl: details.thumbnailUrl || null,
      subscriberCount: details.subscriberCount || 0,
    };
  }

  const query = parseHandle(input) || String(input || '').trim();
  if (!query) {
    return null;
  }

  const matches = await searchChannels(query, 1);
  const match = matches[0];
  if (!match) {
    return null;
  }

  const details = await exports.fetchChannelData(match.channelId);
  return {
    channelId: match.channelId,
    title: details?.name || match.title,
    description: details?.description || match.description,
    channelUrl: match.channelUrl,
    thumbnailUrl: details?.thumbnailUrl || match.thumbnailUrl || null,
    subscriberCount: details?.subscriberCount || 0,
  };
}

async function fetchRecentChannelVideos(channelId, maxResults = 5) {
  requireApiKeyForRealUsage();

  const response = await executeYouTubeRequest((youtube) => youtube.search.list({
    part: ['snippet'],
    channelId,
    type: ['video'],
    order: 'date',
    maxResults: Math.max(1, Math.min(Number(maxResults) || 5, 10)),
  }));

  return (response.data.items || []).map(mapSearchVideoItem).filter(Boolean);
}

async function searchRecentVideos(query, maxResults = 5) {
  const targetMaxResults = Math.max(1, Math.min(Number(maxResults) || 5, 10));
  if (getYouTubeApiKeys().length === 0) {
    return searchRecentVideosWithoutApiKey(query, targetMaxResults);
  }

  try {
    const response = await executeYouTubeRequest((youtube) => youtube.search.list({
      part: ['snippet'],
      q: String(query || '').trim(),
      type: ['video'],
      order: 'date',
      maxResults: targetMaxResults,
    }));

    return (response.data.items || []).map(mapSearchVideoItem).filter(Boolean);
  } catch (error) {
    if (!isRetryableYouTubeError(error)) {
      throw error;
    }

    return searchRecentVideosWithoutApiKey(query, targetMaxResults);
  }
}

async function searchRecentVideosWithOptions(options = {}) {
  const params = {
    part: ['snippet'],
    type: ['video'],
    order: options.order || 'date',
    maxResults: Math.max(1, Math.min(Number(options.maxResults) || 5, 10)),
  };

  if (options.channelId) {
    params.channelId = String(options.channelId).trim();
  }

  if (options.query) {
    params.q = String(options.query).trim();
  }

  if (options.publishedAfter) {
    const parsed = new Date(options.publishedAfter);
    if (!Number.isNaN(parsed.getTime())) {
      params.publishedAfter = parsed.toISOString();
    }
  }

  if (!params.channelId && !params.q) {
    return [];
  }

  if (getYouTubeApiKeys().length === 0) {
    if (params.channelId) {
      return fetchRecentChannelVideosViaRss(params.channelId, params.maxResults);
    }

    return searchRecentVideosWithoutApiKey(params.q, params.maxResults);
  }

  try {
    const response = await executeYouTubeRequest((youtube) => youtube.search.list(params));
    return (response.data.items || []).map(mapSearchVideoItem).filter(Boolean);
  } catch (error) {
    if (!isRetryableYouTubeError(error)) {
      throw error;
    }

    if (params.channelId) {
      return fetchRecentChannelVideosViaRss(params.channelId, params.maxResults);
    }

    return searchRecentVideosWithoutApiKey(params.q, params.maxResults);
  }
}

async function fetchVideoData(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    console.error(`[YouTube] Invalid URL: ${url}`);
    return null;
  }

  if (getYouTubeApiKeys().length === 0) {
    if (!isDevMocksEnabled()) {
      throw new Error(
        'No YouTube API key is configured. Add YOUTUBE_API_KEY, YOUTUBE_API_KEYS, or YOUTUBE_API_KEY_1..10 to backend/.env, or enable ALLOW_DEV_MOCKS=true for local development.'
      );
    }

    console.warn('[YouTube] No API key - returning mock data because ALLOW_DEV_MOCKS=true');
    return getMockData(videoId, url);
  }

  try {
    console.log(`[YouTube] Fetching metadata for ${videoId}...`);

    const response = await executeYouTubeRequest((youtube) => youtube.videos.list({
      part: ['snippet', 'contentDetails', 'statistics'],
      id: [videoId],
    }));

    const video = response.data.items?.[0];
    if (!video) {
      console.error(`[YouTube] Video not found: ${videoId}`);
      return null;
    }

    const { snippet, contentDetails, statistics } = video;
    const transcriptPayload = buildTranscriptMetadata(
      await fetchPublicTranscript(videoId),
      snippet.description || ''
    );

    return {
      videoId,
      title: snippet.title,
      description: snippet.description,
      channelTitle: snippet.channelTitle,
      channelId: snippet.channelId,
      thumbnailUrl: snippet.thumbnails?.maxres?.url
        || snippet.thumbnails?.high?.url
        || snippet.thumbnails?.default?.url,
      publishDate: snippet.publishedAt,
      durationSeconds: parseDuration(contentDetails.duration),
      viewCount: parseInt(statistics.viewCount || '0', 10),
      likeCount: parseInt(statistics.likeCount || '0', 10),
      commentCount: parseInt(statistics.commentCount || '0', 10),
      tags: snippet.tags || [],
      categoryId: snippet.categoryId,
      transcript: transcriptPayload.transcript,
      transcriptStatus: transcriptPayload.transcriptStatus,
      transcriptSource: transcriptPayload.transcriptSource,
      transcriptPreview: transcriptPayload.transcriptPreview,
      transcriptUpdatedAt: transcriptPayload.transcriptUpdatedAt,
      transcriptProvider: transcriptPayload.transcriptProvider,
      ingestStatus: transcriptPayload.transcriptStatus === 'available' ? 'ready' : 'partial',
    };
  } catch (error) {
    console.error(`[YouTube] API error: ${error.message}`);
    if (isDevMocksEnabled()) {
      return getMockData(videoId, url);
    }

    throw new Error(`YouTube ingest failed: ${error.message}`);
  }
}

async function fetchChannelData(channelId) {
  if (getYouTubeApiKeys().length === 0) {
    return null;
  }

  try {
    const response = await executeYouTubeRequest((youtube) => youtube.channels.list({
      part: ['snippet', 'statistics'],
      id: [channelId],
    }));

    const channel = response.data.items?.[0];
    if (!channel) {
      return null;
    }

    return {
      channelId,
      name: channel.snippet.title,
      description: channel.snippet.description,
      thumbnailUrl: channel.snippet.thumbnails?.default?.url,
      subscriberCount: parseInt(channel.statistics.subscriberCount || '0', 10),
      videoCount: parseInt(channel.statistics.videoCount || '0', 10),
    };
  } catch (error) {
    console.error(`[YouTube] Channel fetch error: ${error.message}`);
    return null;
  }
}

async function fetchVideosByIds(videoIds = []) {
  requireApiKeyForRealUsage();

  const uniqueIds = [...new Set((Array.isArray(videoIds) ? videoIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) {
    return [];
  }

  const chunkSize = 50;
  const items = [];

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const response = await executeYouTubeRequest((youtube) => youtube.videos.list({
      part: ['snippet', 'contentDetails', 'statistics'],
      id: chunk,
      maxResults: chunk.length,
    }));

    for (const video of response.data.items || []) {
    const { snippet, contentDetails, statistics } = video;
      const transcriptPayload = buildTranscriptMetadata(
        await fetchPublicTranscript(video.id),
        snippet?.description || ''
      );

      items.push({
        videoId: video.id,
        title: snippet?.title || '',
        description: snippet?.description || '',
        channelTitle: snippet?.channelTitle || '',
        channelId: snippet?.channelId || '',
        thumbnailUrl: snippet?.thumbnails?.maxres?.url
          || snippet?.thumbnails?.high?.url
          || snippet?.thumbnails?.default?.url
          || null,
        publishDate: snippet?.publishedAt || null,
        durationSeconds: parseDuration(contentDetails?.duration),
        viewCount: parseInt(statistics?.viewCount || '0', 10),
        likeCount: parseInt(statistics?.likeCount || '0', 10),
        commentCount: parseInt(statistics?.commentCount || '0', 10),
        tags: snippet?.tags || [],
        categoryId: snippet?.categoryId || '',
        transcript: transcriptPayload.transcript,
        transcriptStatus: transcriptPayload.transcriptStatus,
        transcriptSource: transcriptPayload.transcriptSource,
        transcriptPreview: transcriptPayload.transcriptPreview,
        transcriptUpdatedAt: transcriptPayload.transcriptUpdatedAt,
        transcriptProvider: transcriptPayload.transcriptProvider,
        ingestStatus: transcriptPayload.transcriptStatus === 'available' ? 'ready' : 'partial',
        url: buildVideoUrl(video.id),
      });
    }
  }

  return items;
}

async function hydrateSearchResults(searchResults = []) {
  const baseResults = Array.isArray(searchResults) ? searchResults.filter(Boolean) : [];
  if (!baseResults.length) {
    return [];
  }

  if (getYouTubeApiKeys().length === 0) {
    return Promise.all(baseResults.map(async (item) => {
      const transcriptPayload = item?.transcript || item?.transcriptStatus || item?.transcriptPreview || item?.transcriptSource
        ? buildTranscriptMetadata(item, item?.description || '')
        : buildTranscriptMetadata(await fetchPublicTranscript(item.videoId), item?.description || '');

      return {
        ...item,
        transcript: transcriptPayload.transcript || '',
        transcriptStatus: transcriptPayload.transcriptStatus,
        transcriptSource: transcriptPayload.transcriptSource,
        transcriptPreview: transcriptPayload.transcriptPreview,
        transcriptUpdatedAt: transcriptPayload.transcriptUpdatedAt,
        transcriptProvider: transcriptPayload.transcriptProvider,
        ingestStatus: transcriptPayload.transcriptStatus === 'available' ? 'ready' : 'partial',
      };
    }));
  }

  const details = await fetchVideosByIds(baseResults.map((item) => item.videoId));
  const detailMap = new Map(details.map((item) => [item.videoId, item]));

  return baseResults.map((item) => {
    const detail = detailMap.get(item.videoId);
    return {
      ...item,
      ...(detail || {}),
      title: detail?.title || item.title,
      description: detail?.description || item.description,
      channelTitle: detail?.channelTitle || item.channelTitle,
      channelId: detail?.channelId || item.channelId,
      thumbnailUrl: detail?.thumbnailUrl || item.thumbnailUrl || null,
      publishDate: detail?.publishDate || item.publishDate || null,
      url: detail?.url || item.url,
    };
  });
}

async function resolveChannelByQuery(query) {
  const resolved = await resolveChannelInput(query);
  if (!resolved?.channelId) {
    return null;
  }

  return {
    channelId: resolved.channelId,
    name: resolved.title || '',
    description: resolved.description || '',
    url: resolved.channelUrl || `https://www.youtube.com/channel/${resolved.channelId}`,
    thumbnailUrl: resolved.thumbnailUrl || null,
    subscriberCount: Number(resolved.subscriberCount || 0),
  };
}

async function fetchRecentVideosByChannel(channelId, options = {}) {
  const maxResults = typeof options === 'object' ? options.maxResults : options;
  const targetMaxResults = maxResults || 5;

  try {
    const recent = await fetchRecentChannelVideos(channelId, targetMaxResults);
    return hydrateSearchResults(recent);
  } catch (error) {
    const allowRssFallback = getYouTubeApiKeys().length === 0 || isRetryableYouTubeError(error);
    if (!allowRssFallback) {
      throw error;
    }

    const rssItems = await fetchRecentChannelVideosViaRss(channelId, targetMaxResults);
    return Promise.all(rssItems.map(async (item) => {
      const transcriptPayload = buildTranscriptMetadata(
        await fetchPublicTranscript(item.videoId),
        item?.description || ''
      );
      return {
        ...item,
        durationSeconds: 0,
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        tags: [],
        categoryId: '',
        transcript: transcriptPayload.transcript,
        transcriptStatus: transcriptPayload.transcriptStatus,
        transcriptSource: transcriptPayload.transcriptSource,
        transcriptPreview: transcriptPayload.transcriptPreview,
        transcriptUpdatedAt: transcriptPayload.transcriptUpdatedAt,
        transcriptProvider: transcriptPayload.transcriptProvider,
        ingestStatus: transcriptPayload.transcriptStatus === 'available' ? 'ready' : 'partial',
      };
    }));
  }
}

async function searchVideos(query, options = {}) {
  const maxResults = typeof options === 'object' ? options.maxResults : options;
  const recent = await searchRecentVideos(query, maxResults || 5);
  return hydrateSearchResults(recent);
}

function getMockData(videoId, url) {
  return {
    videoId,
    title: 'The Real Reason AI Is Moving Faster Than Anyone Expected',
    description: 'A deep dive into why AI progress has accelerated...',
    channelTitle: 'Lex Fridman',
    channelId: 'mock_channel',
    thumbnailUrl: `https://picsum.photos/seed/${videoId}/640/360`,
    publishDate: new Date().toISOString(),
    durationSeconds: 7820,
    viewCount: 1500000,
    likeCount: 45000,
    commentCount: 3200,
    tags: ['AI', 'technology', 'deep learning'],
    categoryId: '28',
    transcript: 'Mock transcript for development testing.',
    transcriptStatus: 'mock',
    transcriptSource: 'mock',
    transcriptPreview: 'Mock transcript for development testing.',
    transcriptUpdatedAt: new Date().toISOString(),
    transcriptProvider: 'mock',
    ingestStatus: 'partial',
    url,
  };
}

async function fetchFullTranscript(videoId) {
  try {
    const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
      },
    });

    if (!watchResponse.ok) {
      return '';
    }

    const html = await watchResponse.text();
    const match = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (!match) {
      return '';
    }

    const decodeEscapedJson = (value) => {
      return value
        .replace(/\\"/g, '"')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
    };

    const tracks = JSON.parse(decodeEscapedJson(match[1]));
    // Find english tracks or default to first
    const track = tracks.find((t) => t.languageCode === 'en') ||
                  tracks.find((t) => t.languageCode === 'en-US') ||
                  tracks.find((t) => t.kind !== 'asr') ||
                  tracks[0] ||
                  null;

    if (!track?.baseUrl) {
      return '';
    }

    const transcriptResponse = await fetch(`${track.baseUrl}&fmt=json3`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
      },
    });

    if (!transcriptResponse.ok) {
      return '';
    }

    const transcriptPayload = await transcriptResponse.json();
    const stripHtmlEntities = (value) => {
      return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    };

    const events = transcriptPayload?.events || [];
    const text = events
      .flatMap((event) => event.segs || [])
      .map((segment) => stripHtmlEntities(segment.utf8 || ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  } catch (error) {
    console.error(`[YouTube] Failed to fetch full transcript: ${error.message}`);
    return '';
  }
}

function chunkText(text, chunkSize = 1000, overlap = 200) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < normalized.length) {
    const endIndex = Math.min(startIndex + chunkSize, normalized.length);
    const chunkText = normalized.slice(startIndex, endIndex);

    chunks.push({
      text: chunkText,
      startIndex,
      endIndex,
    });

    if (endIndex === normalized.length) {
      break;
    }

    startIndex += (chunkSize - overlap);
  }

  return chunks;
}

function localAnalyzeCredibility(title, description, transcript = '') {
  const combined = `${title} ${description} ${transcript}`.toLowerCase();
  
  // Detect celebrity noise and gossip
  const gossipKeywords = [
    'gossip', 'rumor', 'drama', 'beef', 'expose', 'celebrity', 'dating', 'breakup',
    'relationship', 'hollywood', 'vlog', 'lifestyle', 'reaction', 'insane', 'shocks',
    'kardashian', 'swift', 'prank', 'fight', 'beef', 'diss'
  ];
  
  let celebrity_noise = false;
  for (const word of gossipKeywords) {
    if (combined.includes(word)) {
      celebrity_noise = true;
      break;
    }
  }

  // Extract topics
  const topics = [];
  if (/\b(ai|llm|openai|anthropic|gemini|deep learning|neural|machine learning)\b/.test(combined)) {
    topics.push('Artificial Intelligence');
  }
  if (/\b(market|stock|finance|economics|investment)\b/.test(combined)) {
    topics.push('Markets');
  }
  if (/\b(war|military|attack|conflict|missile|geopolitics)\b/.test(combined)) {
    topics.push('Regional Risk');
  }
  if (/\b(scholarship|deadline|university|study|visa)\b/.test(combined)) {
    topics.push('Scholarships');
  }
  if (!topics.length) {
    topics.push('General');
  }

  // Compute depth score
  const textLength = transcript.length + description.length;
  let depth = 0.35;
  if (textLength > 15000) depth = 0.85;
  else if (textLength > 5000) depth = 0.65;
  else if (textLength > 1000) depth = 0.45;

  return {
    summary: `Local Analysis: ${title.slice(0, 100)}...`,
    topics: topics.slice(0, 5),
    depth,
    clickbait: /shocking|unbelievable|must watch|secrets/i.test(title) ? 0.7 : 0.1,
    rarity: 0.5,
    freshness: 0.5,
    timeless: 0.5,
    celebrity_noise,
    credibility_reasons: [
      celebrity_noise ? 'Flagged as potential celebrity gossip or noise.' : 'Contains informational/technical keywords.',
      depth > 0.6 ? 'Long form content indicating deeper exploration.' : 'Short form / overview content.'
    ],
    provider: 'local',
    model: 'deterministic-rules'
  };
}

const Database = require('better-sqlite3');
const path = require('path');
let localDb = null;
function resolveDb(dbInstance) {
  if (dbInstance) {
    return dbInstance;
  }
  if (!localDb) {
    localDb = new Database(path.join(__dirname, '..', 'explore.db'));
  }
  return localDb;
}

function saveProcessedVideo(dbInstance, { videoData, analysis, chunks, chunkEmbeddings, itemEmbedding }) {
  const db = resolveDb(dbInstance);

  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO sources (id, platform, name, url)
    VALUES (?, 'youtube', ?, ?)
  `);
  
  const sourceId = 'src_' + Buffer.from(videoData.channelTitle).toString('base64').substring(0, 8);
  insertSource.run(
    sourceId,
    videoData.channelTitle,
    videoData.channelId ? `https://www.youtube.com/channel/${videoData.channelId}` : null
  );
  
  const creatorId = 'cr_' + Buffer.from(videoData.channelTitle).toString('base64').substring(0, 8);
  const insertCreator = db.prepare(`
    INSERT OR IGNORE INTO creators (id, source_id, name, channel_url)
    VALUES (?, ?, ?, ?)
  `);
  insertCreator.run(
    creatorId,
    sourceId,
    videoData.channelTitle,
    videoData.channelId ? `https://www.youtube.com/channel/${videoData.channelId}` : null
  );

  const upsertItem = db.prepare(`
    INSERT INTO content_items (
      id, source_id, creator_id, external_id, title, url, thumbnail_url,
      publish_date, duration_seconds, view_count, transcript, summary,
      embedding_json, rarity_score, depth_score, freshness_score, timeless_score,
      clickbait_score, ingest_status, transcript_status, transcript_provider,
      analysis_provider, analysis_model, analysis_error, embedding_provider,
      embedding_model, embedding_error, topic_tags_json, content_type, distraction_risk
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 'video', ?
    )
    ON CONFLICT(external_id) DO UPDATE SET
      title = excluded.title,
      thumbnail_url = excluded.thumbnail_url,
      publish_date = excluded.publish_date,
      duration_seconds = excluded.duration_seconds,
      view_count = excluded.view_count,
      transcript = excluded.transcript,
      summary = excluded.summary,
      embedding_json = excluded.embedding_json,
      rarity_score = excluded.rarity_score,
      depth_score = excluded.depth_score,
      freshness_score = excluded.freshness_score,
      timeless_score = excluded.timeless_score,
      clickbait_score = excluded.clickbait_score,
      ingest_status = excluded.ingest_status,
      transcript_status = excluded.transcript_status,
      analysis_provider = excluded.analysis_provider,
      analysis_model = excluded.analysis_model,
      analysis_error = excluded.analysis_error,
      embedding_provider = excluded.embedding_provider,
      embedding_model = excluded.embedding_model,
      embedding_error = excluded.embedding_error,
      topic_tags_json = excluded.topic_tags_json,
      distraction_risk = excluded.distraction_risk,
      updated_at = CURRENT_TIMESTAMP
  `);

  const itemId = crypto.randomUUID();
  const distractionRisk = analysis.celebrity_noise ? 1.0 : 0.0;
  const ingestStatus = analysis.celebrity_noise ? 'filtered' : 'ready';

  upsertItem.run(
    itemId,
    sourceId,
    creatorId,
    videoData.videoId,
    videoData.title,
    videoData.url || `https://www.youtube.com/watch?v=${videoData.videoId}`,
    videoData.thumbnailUrl,
    videoData.publishDate,
    videoData.durationSeconds,
    videoData.viewCount || 0,
    videoData.fullTranscript || videoData.transcript || '',
    analysis.summary,
    JSON.stringify(itemEmbedding.values),
    analysis.rarity || 0.5,
    analysis.depth || 0.5,
    analysis.freshness || 0.5,
    analysis.timeless || 0.5,
    analysis.clickbait || 0.1,
    ingestStatus,
    videoData.fullTranscript ? 'available' : 'description_only',
    videoData.transcriptProvider || 'youtube-watch-page',
    analysis.provider || 'mock',
    analysis.model || 'mock-model',
    analysis.error || null,
    itemEmbedding.provider || 'mock',
    itemEmbedding.model || 'mock-model',
    itemEmbedding.error || null,
    JSON.stringify(analysis.topics),
    distractionRisk
  );

  const finalItemRow = db.prepare('SELECT id FROM content_items WHERE external_id = ?').get(videoData.videoId);
  const finalItemId = finalItemRow ? finalItemRow.id : itemId;

  // Clear existing chunks and embeddings
  db.prepare('DELETE FROM content_chunks WHERE content_item_id = ?').run(finalItemId);
  db.prepare('DELETE FROM content_item_embeddings WHERE content_item_id = ?').run(finalItemId);

  // Insert item level embedding
  const insertEmbedding = db.prepare(`
    INSERT INTO content_item_embeddings (id, content_item_id, chunk_id, embedding_json, model_version)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertEmbedding.run(
    crypto.randomUUID(),
    finalItemId,
    null,
    JSON.stringify(itemEmbedding.values),
    `${itemEmbedding.provider}/${itemEmbedding.model}`
  );

  // Insert chunks and chunk-level embeddings
  const insertChunk = db.prepare(`
    INSERT INTO content_chunks (id, content_item_id, chunk_index, content_text, start_time_seconds, end_time_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = `chk_${finalItemId}_${i}`;
    insertChunk.run(
      chunkId,
      finalItemId,
      i,
      chunk.text,
      chunk.startTime || null,
      chunk.endTime || null
    );

    const chunkEmbed = chunkEmbeddings[i];
    if (chunkEmbed) {
      insertEmbedding.run(
        crypto.randomUUID(),
        finalItemId,
        chunkId,
        JSON.stringify(chunkEmbed.values),
        `${chunkEmbed.provider}/${chunkEmbed.model}`
      );
    }
  }

  // Insert recommendation reason
  const insertReason = db.prepare(`
    INSERT OR REPLACE INTO recommendation_reasons (id, content_id, reason_type, reason_text)
    VALUES (?, ?, ?, ?)
  `);
  
  const reasonText = analysis.credibility_reasons?.[0] || 'High quality content matching your interests.';
  const reasonType = analysis.depth > 0.7 ? 'deep' : 'care';
  insertReason.run(
    `rsn_${finalItemId}`,
    finalItemId,
    reasonType,
    reasonText
  );

  return finalItemId;
}

class YoutubeAdapter extends ContentSourceAdapter {
  canHandle(url) {
    return !!extractVideoId(url);
  }

  async fetchMetadata(url) {
    return fetchVideoData(url);
  }

  async extractTranscript(videoId, metadata = {}) {
    const rawTranscript = await fetchPublicTranscript(videoId);
    return buildTranscriptMetadata(rawTranscript, metadata?.description || '');
  }

  async process(url, dbInstance, options = {}) {
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL: ${url}`);
    }

    console.log(`[YouTubeAdapter] Fetching metadata for ${videoId}...`);
    const videoData = await fetchVideoData(url);
    if (!videoData) {
      throw new Error(`Failed to fetch metadata for video ID: ${videoId}`);
    }

    console.log(`[YouTubeAdapter] Fetching full transcript for ${videoId}...`);
    const fullTranscript = await fetchFullTranscript(videoId);
    videoData.fullTranscript = fullTranscript || videoData.transcript || '';

    console.log(`[YouTubeAdapter] Running credibility analysis for ${videoId}...`);
    let analysis;
    const credibilitySchema = {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2-3 sentences summary' },
        topics: { type: 'array', items: { type: 'string' } },
        depth: { type: 'number', minimum: 0, maximum: 1 },
        clickbait: { type: 'number', minimum: 0, maximum: 1 },
        rarity: { type: 'number', minimum: 0, maximum: 1 },
        freshness: { type: 'number', minimum: 0, maximum: 1 },
        timeless: { type: 'number', minimum: 0, maximum: 1 },
        celebrity_noise: { type: 'boolean' },
        credibility_reasons: { type: 'array', items: { type: 'string' } }
      },
      required: ['summary', 'topics', 'depth', 'clickbait', 'rarity', 'freshness', 'timeless', 'celebrity_noise', 'credibility_reasons']
    };

    try {
      const textForAnalysis = `Title: ${videoData.title}\nDescription: ${videoData.description}\nTranscript Excerpt: ${videoData.fullTranscript.slice(0, 5000)}`;
      const result = await llmProvider.generateStructuredJson({
        systemPrompt: 'You are an elite content quality and credibility checker. Identify topics, depth (0.0 to 1.0), and celebrity gossip/noise flags.',
        userPrompt: textForAnalysis,
        schema: credibilitySchema,
        temperature: 0.2
      });

      analysis = {
        ...result,
        provider: process.env.LLM_PROVIDER || 'openai',
        model: process.env.LLM_MODEL || 'gpt-4o-mini'
      };
    } catch (err) {
      console.warn(`[YouTubeAdapter] LLM analysis failed: ${err.message}. Falling back to deterministic analysis.`);
      analysis = localAnalyzeCredibility(videoData.title, videoData.description, videoData.fullTranscript);
      analysis.error = err.message;
    }

    console.log(`[YouTubeAdapter] Chunking transcript for ${videoId}...`);
    const textToChunk = videoData.fullTranscript || videoData.description || videoData.title;
    const chunks = chunkText(textToChunk, options.chunkSize || 1000, options.overlap || 200);

    console.log(`[YouTubeAdapter] Generating item-level embedding...`);
    let itemEmbedding;
    try {
      itemEmbedding = await embeddingProvider.generateEmbeddingWithMetadata(
        `${videoData.title}. ${analysis.summary}`,
        { provider: options.embeddingProvider, model: options.embeddingModel }
      );
    } catch (err) {
      console.error(`[YouTubeAdapter] Item embedding failed: ${err.message}`);
      itemEmbedding = {
        values: embeddingProvider.getMockEmbedding(1536),
        provider: 'mock-fallback',
        model: 'failed',
        error: err.message
      };
    }

    console.log(`[YouTubeAdapter] Generating chunk-level embeddings (${chunks.length} chunks)...`);
    const chunkEmbeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunkEmbed = await embeddingProvider.generateEmbeddingWithMetadata(
          chunks[i].text,
          { provider: options.embeddingProvider, model: options.embeddingModel }
        );
        chunkEmbeddings.push(chunkEmbed);
      } catch (err) {
        console.error(`[YouTubeAdapter] Chunk ${i} embedding failed: ${err.message}`);
        const dim = options.embeddingModel === 'bge-m3' ? 1024 : 1536;
        chunkEmbeddings.push({
          values: embeddingProvider.getMockEmbedding(dim),
          provider: 'mock-fallback',
          model: 'failed',
          error: err.message
        });
      }
    }

    console.log(`[YouTubeAdapter] Saving ingested data for ${videoId} to SQLite database...`);
    const resolvedDb = resolveDb(dbInstance);
    const finalItemId = saveProcessedVideo(resolvedDb, {
      videoData,
      analysis,
      chunks,
      chunkEmbeddings,
      itemEmbedding
    });

    console.log(`[YouTubeAdapter] Completed ingestion for ${videoId}. Item ID: ${finalItemId}`);
    return finalItemId;
  }
}

const crypto = require('crypto');
const youtubeAdapterInstance = new YoutubeAdapter();

exports.buildVideoUrl = buildVideoUrl;
exports.extractVideoId = extractVideoId;
exports.fetchVideoData = fetchVideoData;
exports.fetchChannelData = fetchChannelData;
exports.fetchRecentChannelVideos = fetchRecentChannelVideos;
exports.fetchRecentVideosByChannel = fetchRecentVideosByChannel;
exports.fetchVideosByIds = fetchVideosByIds;
exports.hydrateSearchResults = hydrateSearchResults;
exports.resolveChannelByQuery = resolveChannelByQuery;
exports.resolveChannelInput = resolveChannelInput;
exports.searchChannels = searchChannels;
exports.searchRecentVideos = searchRecentVideos;
exports.searchRecentVideosWithOptions = searchRecentVideosWithOptions;
exports.searchVideos = searchVideos;
exports.hasConfiguredYouTubeApiKey = () => getYouTubeApiKeys().length > 0;
exports.youtubeAdapter = youtubeAdapterInstance;
exports.__test__ = {
  collectVideoRenderers,
  executeYouTubeRequest,
  extractYtInitialData,
  fetchRecentChannelVideosViaRss,
  getYouTubeApiKeys,
  getYouTubeKeyHealthSummary,
  getYouTubeKeyRotationOrder,
  getYouTubeErrorStatus,
  isRetryableYouTubeError,
  isUsableYouTubeApiKey,
  mapFallbackSearchRenderer,
  parseCompactCountText,
  parseRelativePublishedTime,
  parseSearchResultsFromHtml,
  parseYoutubeRssFeed,
  buildTranscriptMetadata,
  normalizeTranscriptText,
  fetchFullTranscript,
  chunkText,
  localAnalyzeCredibility,
  saveProcessedVideo,
  resetYouTubeKeyCooldowns: () => {
    youtubeKeyCooldowns.clear();
    youtubeRoundRobinCursor = 0;
  },
};

