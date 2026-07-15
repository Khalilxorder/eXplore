'use strict';

// The direct news lane is deliberately narrower than discovery. It should
// show original lab releases, not partner marketing or video commentary.
const DIRECT_LATEST_RELEASE_COMPANIES = Object.freeze([
  'openai',
  'anthropic',
  'google',
  'xai',
]);

const DIRECT_LATEST_RELEASE_HOSTS = Object.freeze({
  openai: [/(^|\.)openai\.com$/i],
  anthropic: [/(^|\.)anthropic\.com$/i],
  google: [/(^|\.)(blog\.google|deepmind\.google|ai\.google)$/i],
  xai: [/(^|\.)x\.ai$/i],
});

const VIDEO_CONTENT_TYPES = new Set(['video', 'socialvideo', 'youtube', 'short']);
const PARTNER_MARKETING_PATTERN = /\b(case study|customer stor(?:y|ies)|customer success|success stor(?:y|ies)|built on|powered by|reference architecture|implementation|solution(?:s)?|workload(?:s)?)\b/i;
const PLATFORM_AVAILABILITY_PATTERN = /\b(now generally available|available on|availability on|amazon bedrock|vertex ai|azure ai)\b/i;

function getHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isKnownDirectReleaseCompany(company = '') {
  return DIRECT_LATEST_RELEASE_COMPANIES.includes(String(company || '').trim().toLowerCase());
}

function isDirectOfficialLabReleaseAlert(alert = {}) {
  const company = String(alert.release_watch_company || '').trim().toLowerCase();
  const hostname = getHostname(alert.sourceUrl || alert.url || '');
  const hostPatterns = DIRECT_LATEST_RELEASE_HOSTS[company] || [];

  return Boolean(
    alert.category === 'ai'
    && alert.official_source
    && String(alert.release_watch_signal || '').trim().toLowerCase() === 'official_release'
    && isKnownDirectReleaseCompany(company)
    && hostname
    && hostPatterns.some((pattern) => pattern.test(hostname))
  );
}

function isVideoOnlyNewsItem(item = {}) {
  const contentType = String(item.content_type || item.contentType || item.type || '').trim().toLowerCase();
  const channelType = String(item.channel_type || item.channelType || item.kind || '').trim().toLowerCase();
  const hostname = getHostname(item.url || item.link || '');

  return VIDEO_CONTENT_TYPES.has(contentType)
    || VIDEO_CONTENT_TYPES.has(channelType)
    || hostname === 'youtube.com'
    || hostname.endsWith('.youtube.com')
    || hostname === 'youtu.be';
}

function isPartnerMarketingNewsItem(item = {}) {
  const text = [item.title, item.summary, item.description, item.source, item.source_name]
    .filter(Boolean)
    .join(' ');
  return PARTNER_MARKETING_PATTERN.test(text);
}

function isPlatformAvailabilityNewsItem(item = {}) {
  const text = [item.title, item.summary, item.description, item.source, item.source_name]
    .filter(Boolean)
    .join(' ');
  return PLATFORM_AVAILABILITY_PATTERN.test(text);
}

function isRegionalDirectNewsItem(item = {}) {
  return /urgent regional update/i.test(String(item.reason || item.whyShown || ''));
}

function getRegionalEventKey(item = {}) {
  const text = [item.title, item.summary, item.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\biran\b/.test(text)) {
    if (/\b(trade|shipping|strait|oil|route)\b/.test(text)) return 'iran:trade-shipping';
    if (/\b(missile|air defen[cs]e|shoot down)\b/.test(text)) return 'iran:missiles';
    if (/\b(strike|bomb|bridge|power plant|airstrike)\b/.test(text)) return 'iran:strikes';
    return 'iran:general';
  }
  if (/\bgaza\b/.test(text)) return 'gaza:security';
  if (/\bhouthi\b/.test(text)) return 'houthi:security';
  if (/\blebanon\b/.test(text)) return 'lebanon:security';
  if (/\bjordan\b/.test(text)) return 'jordan:security';

  const normalizedTitle = String(item.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalizedTitle ? `regional:${normalizedTitle}` : 'regional:unknown';
}

function selectDistinctDirectEvents(items = [], { maxItems = 12, maxRegionalItems = 3 } = {}) {
  const selected = [];
  const regionalEventKeys = new Set();
  let regionalCount = 0;

  for (const item of items) {
    if (selected.length >= maxItems) break;

    if (isRegionalDirectNewsItem(item)) {
      const eventKey = getRegionalEventKey(item);
      if (regionalCount >= maxRegionalItems || regionalEventKeys.has(eventKey)) continue;
      regionalEventKeys.add(eventKey);
      regionalCount += 1;
    }

    selected.push(item);
  }

  return selected;
}

module.exports = {
  DIRECT_LATEST_RELEASE_COMPANIES,
  isDirectOfficialLabReleaseAlert,
  isKnownDirectReleaseCompany,
  isPartnerMarketingNewsItem,
  isPlatformAvailabilityNewsItem,
  selectDistinctDirectEvents,
  isVideoOnlyNewsItem,
};
