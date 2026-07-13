const crypto = require('crypto');
const aiService = require('../../services/aiService');

const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';
function buildGoogleNewsSiteFeed(site, extraQuery = 'Jordan') {
  const params = new URLSearchParams({
    q: `site:${site} ${extraQuery}`.trim(),
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });

  return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

const DEFAULT_FEED_DEFINITIONS = [
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', label: 'BBC Technology RSS' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', label: 'BBC World RSS' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', label: 'BBC Business RSS' },
];
const MAX_WRITTEN_AI_ANALYSES_PER_REFRESH = Math.max(
  0,
  Math.min(Number(process.env.WRITTEN_AI_ANALYSIS_BUDGET || 4), 16)
);
const MAX_WRITTEN_EMBEDDINGS_PER_REFRESH = Math.max(
  0,
  Math.min(Number(process.env.WRITTEN_AI_EMBEDDING_BUDGET || 2), 8)
);
const AI_TOOL_SIGNAL_QUERY = [
  '(AI OR Claude OR ChatGPT OR Gemini OR Copilot OR Llama OR Mistral OR "Hugging Face" OR Perplexity OR Cursor OR v0)',
  '(tool OR agent OR agents OR app OR workspace OR API OR automation OR "computer use" OR browser OR coding OR release OR launch OR feature)',
  '-jobs',
  '-hiring',
  '-stock',
].join(' ');
const AI_TOOL_FEED_DEFINITIONS = [
  { url: 'https://openai.com/news/rss.xml', label: 'OpenAI official RSS' },
  { url: 'https://blog.google/technology/ai/rss/', label: 'Google AI official RSS' },
  { url: 'https://huggingface.co/blog/feed.xml', label: 'Hugging Face blog RSS' },
  { url: 'https://blogs.microsoft.com/ai/feed/', label: 'Microsoft AI blog RSS' },
  { url: 'https://aws.amazon.com/blogs/machine-learning/feed/', label: 'AWS Machine Learning RSS' },
  { url: 'https://github.blog/ai-and-ml/feed/', label: 'GitHub AI and ML RSS' },
  { url: buildGoogleNewsSiteFeed('anthropic.com/news', AI_TOOL_SIGNAL_QUERY), label: 'Anthropic official via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('mistral.ai/news', AI_TOOL_SIGNAL_QUERY), label: 'Mistral official via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('cursor.com/blog', AI_TOOL_SIGNAL_QUERY), label: 'Cursor blog via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('perplexity.ai/hub/blog', AI_TOOL_SIGNAL_QUERY), label: 'Perplexity blog via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('vercel.com/blog', AI_TOOL_SIGNAL_QUERY), label: 'Vercel AI tooling via Google News RSS' },
];
const SUPPLEMENTAL_JORDAN_SIGNAL_QUERY = [
  '(Jordan OR Amman)',
  '(Iran OR Israel OR Gaza OR Lebanon OR Syria OR Iraq OR security OR government OR economy OR energy OR airspace OR border OR war OR ceasefire OR peace OR sanctions OR oil)',
  '-weather',
  '-forecast',
  '-sports',
].join(' ');
const SUPPLEMENTAL_FEED_DEFINITIONS = [
  { url: buildGoogleNewsSiteFeed('jordantimes.com', SUPPLEMENTAL_JORDAN_SIGNAL_QUERY), label: 'Jordan Times via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('jordannews.jo', SUPPLEMENTAL_JORDAN_SIGNAL_QUERY), label: 'Jordan News via Google News RSS' },
  { url: buildGoogleNewsSiteFeed('petra.gov.jo', SUPPLEMENTAL_JORDAN_SIGNAL_QUERY), label: 'PETRA Jordan via Google News RSS' },
];
const DEFAULT_FEEDS = [
  ...AI_TOOL_FEED_DEFINITIONS.map((entry) => entry.url),
  ...DEFAULT_FEED_DEFINITIONS.map((entry) => entry.url),
];
const WRITTEN_SOURCE_OVERRIDES = [
  { match: /openai\.com$/i, label: 'OpenAI', trustTier: 5 },
  { match: /anthropic\.com$/i, label: 'Anthropic', trustTier: 5 },
  { match: /blog\.google$/i, label: 'Google AI', trustTier: 5 },
  { match: /google\.com$/i, label: 'Google AI', trustTier: 5 },
  { match: /huggingface\.co$/i, label: 'Hugging Face', trustTier: 5 },
  { match: /blogs\.microsoft\.com$/i, label: 'Microsoft AI', trustTier: 5 },
  { match: /microsoft\.com$/i, label: 'Microsoft AI', trustTier: 5 },
  { match: /aws\.amazon\.com$/i, label: 'AWS Machine Learning', trustTier: 5 },
  { match: /github\.blog$/i, label: 'GitHub AI', trustTier: 4 },
  { match: /mistral\.ai$/i, label: 'Mistral AI', trustTier: 5 },
  { match: /cursor\.com$/i, label: 'Cursor', trustTier: 4 },
  { match: /perplexity\.ai$/i, label: 'Perplexity', trustTier: 4 },
  { match: /vercel\.com$/i, label: 'Vercel AI', trustTier: 4 },
  { match: /(?:^|\.)bbci\.co\.uk$/i, label: 'BBC News', trustTier: 5 },
  { match: /bbc\.co\.uk$/i, label: 'BBC News', trustTier: 5 },
  { match: /reuters\.com$/i, label: 'Reuters', trustTier: 5 },
  { match: /apnews\.com$/i, label: 'Associated Press', trustTier: 5 },
  { match: /theguardian\.com$/i, label: 'The Guardian', trustTier: 4 },
  { match: /nytimes\.com$/i, label: 'The New York Times', trustTier: 4 },
  { match: /washingtonpost\.com$/i, label: 'The Washington Post', trustTier: 4 },
  { match: /bloomberg\.com$/i, label: 'Bloomberg', trustTier: 4 },
  { match: /ft\.com$/i, label: 'Financial Times', trustTier: 4 },
  { match: /jordantimes\.com$/i, label: 'Jordan Times', trustTier: 4 },
  { match: /jordannews\.jo$/i, label: 'Jordan News', trustTier: 3 },
  { match: /petra\.gov\.jo$/i, label: 'PETRA Jordan', trustTier: 4 },
];
const ALLOW_DEV_MOCKS = ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase());
const LATEST_WRITTEN_STALE_MS = 8 * 60 * 60 * 1000;
const WRITTEN_FETCH_TIMEOUT_MS = 6000;
const LOW_SIGNAL_WRITTEN_PATTERNS = [
  /\bpleasant weather\b/i,
  /\bweather today\b/i,
  /\bweather forecast\b/i,
  /\bforecast\b/i,
  /\bturning (?:warm|hot|cold|cool)\b/i,
  /\btemperatures?\b/i,
  /\brains?\b/i,
  /\brainfall\b/i,
  /\bthunderstorms?\b/i,
  /\bhumidity\b/i,
  /\bsports?\b/i,
  /\bfootball\b/i,
  /\bcelebrity\b/i,
  /\bhoroscope\b/i,
  /\blottery\b/i,
];
const HIGH_SIGNAL_WRITTEN_RESCUE_PATTERNS = [
  /\bwar\b/i,
  /\bceasefire\b/i,
  /\bpeace deal\b/i,
  /\bmissile\b/i,
  /\battack\b/i,
  /\bsecurity\b/i,
  /\bevacuat(?:e|ion)\b/i,
  /\bflood(?:s|ing)?\b/i,
  /\bdeadly\b/i,
  /\bdeath toll\b/i,
  /\bemergency\b/i,
  /\bclimate\b/i,
  /\bextreme weather\b/i,
  /\bpower grid\b/i,
  /\boil\b/i,
  /\benergy\b/i,
  /\binfrastructure\b/i,
];
const AI_TOOL_RESCUE_PATTERNS = [
  /\b(openai|anthropic|claude|chatgpt|gpt(?:-[0-9.]+)?|gemini|deepmind|grok|xai|x\.ai|llama|copilot|mistral|hugging\s*face|perplexity|cursor|vercel|github|aws|bedrock)\b/i,
  /\b(agent|agents|tool|tools|api|workspace|desktop|browser|coding|automation|computer use|release|launch|rollout|feature|model|assistant|operator|codex|canvas|v0|rag|voice|multimodal)\b/i,
];

let lastRefreshAt = 0;
let refreshPromise = null;
let lastCoverageState = {
  checked_at: '',
  feed_count: DEFAULT_FEEDS.length,
  reachable_feed_count: 0,
  failure_count: 0,
  failures: [],
  article_count: 0,
  all_feeds_failed: false,
  message: 'Written feeds have not been checked yet.',
};

function getConfiguredFeeds() {
  const configured = String(process.env.WRITTEN_NEWS_FEEDS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const baseFeeds = configured.length ? configured : DEFAULT_FEEDS;
  return [...new Set([
    ...AI_TOOL_FEED_DEFINITIONS.map((entry) => entry.url),
    ...baseFeeds,
    ...SUPPLEMENTAL_FEED_DEFINITIONS.map((entry) => entry.url),
  ])];
}

function getConfiguredFeedDefinitions() {
  const configuredFeeds = getConfiguredFeeds();
  return configuredFeeds.map((feedUrl) => {
    const knownDefinition = [...AI_TOOL_FEED_DEFINITIONS, ...DEFAULT_FEED_DEFINITIONS, ...SUPPLEMENTAL_FEED_DEFINITIONS]
      .find((entry) => entry.url === feedUrl);

    return {
      url: feedUrl,
      label: knownDefinition?.label || normalizeWrittenSourceLabel(feedUrl, knownDefinition?.label || ''),
      host: getHostName(feedUrl),
    };
  });
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowSignalWrittenItem(entry = {}) {
  const text = [
    entry.title,
    entry.body,
    entry.summary,
    entry.article_body,
    entry.sourceLabel,
    entry.source_name,
  ].filter(Boolean).join(' ');

  const rescuedAiToolSignal = AI_TOOL_RESCUE_PATTERNS.every((pattern) => pattern.test(text));
  if (rescuedAiToolSignal) {
    return false;
  }

  if (!LOW_SIGNAL_WRITTEN_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }

  return !HIGH_SIGNAL_WRITTEN_RESCUE_PATTERNS.some((pattern) => pattern.test(text));
}

function extractFeedTitle(xml) {
  const rawXml = String(xml || '');
  const rssMatch = rawXml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  if (rssMatch?.[1]) {
    return stripHtml(rssMatch[1]);
  }

  const atomMatch = rawXml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  if (atomMatch?.[1]) {
    return stripHtml(atomMatch[1]);
  }

  return '';
}

function normalizeWrittenSourceLabel(feedUrl, feedTitle = '') {
  const host = getHostName(feedUrl);
  const override = WRITTEN_SOURCE_OVERRIDES.find((entry) => entry.match.test(host));
  if (override?.label) {
    return override.label;
  }

  const title = normalizeText(feedTitle);
  if (title) {
    return title.split(/\s+[|:-]\s+/)[0] || title;
  }

  return host;
}

function getWrittenSourceTrustTier(feedUrl, feedTitle = '') {
  const host = getHostName(feedUrl);
  const override = WRITTEN_SOURCE_OVERRIDES.find((entry) => entry.match.test(host));
  if (override?.trustTier) {
    return override.trustTier;
  }

  const title = normalizeText(feedTitle);
  if (/\b(BBC News|Reuters|Associated Press|AP News|The Guardian|The New York Times|The Washington Post|Bloomberg|Financial Times)\b/i.test(title)) {
    return 4;
  }

  return 3;
}

function countWrittenArticles(db) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM content_items
    WHERE content_type = 'article' OR channel_type = 'written'
  `).get()?.count || 0);
}

function getLatestWrittenArticleState(db) {
  let row = null;
  try {
    row = db.prepare(`
      SELECT publish_date, created_at
      FROM content_items
      WHERE content_type = 'article' OR channel_type = 'written'
      ORDER BY COALESCE(publish_date, created_at) DESC
      LIMIT 1
    `).get();
  } catch (error) {
    return {
      latest_article_at: '',
      latest_article_age_hours: null,
      latest_article_is_stale: false,
    };
  }

  const latestArticleAt = String(row?.publish_date || row?.created_at || '').trim();
  const latestArticleMs = latestArticleAt ? Date.parse(latestArticleAt) : NaN;
  if (!latestArticleAt || Number.isNaN(latestArticleMs)) {
    return {
      latest_article_at: '',
      latest_article_age_hours: null,
      latest_article_is_stale: false,
    };
  }

  const ageMs = Math.max(0, Date.now() - latestArticleMs);
  return {
    latest_article_at: new Date(latestArticleMs).toISOString(),
    latest_article_age_hours: Number((ageMs / (60 * 60 * 1000)).toFixed(1)),
    latest_article_is_stale: ageMs > LATEST_WRITTEN_STALE_MS,
  };
}

function buildCoverageMessage(coverage) {
  if (coverage.all_feeds_failed && coverage.article_count === 0) {
    return 'All configured written feeds failed on the last check, so no live written articles are available right now.';
  }

  if (coverage.article_count > 0 && coverage.latest_article_is_stale) {
    if (coverage.reachable_feed_count > 0) {
      return 'Written feeds are reachable, but the newest cached written article is stale, so latest coverage may be lagging.';
    }

    return 'Written articles are cached, but the newest cached written article is stale, so latest coverage may be lagging.';
  }

  if (coverage.reachable_feed_count > 0 && coverage.failure_count > 0 && coverage.article_count > 0) {
    return 'Some written feeds are reachable and cached articles are available, but part of the feed set is currently failing.';
  }

  if (coverage.reachable_feed_count > 0 && coverage.article_count > 0) {
    return 'Written feeds are reachable and live written coverage is available.';
  }

  if (coverage.reachable_feed_count > 0 && coverage.article_count === 0) {
    return 'Written feeds are reachable, but no live written articles have been cached yet.';
  }

  if (coverage.failure_count > 0) {
    return 'Written feed checks are failing right now, so coverage may be empty or stale.';
  }

  if (coverage.article_count > 0) {
    return 'Written articles are cached, but live feed health has not been checked recently.';
  }

  return 'Written feeds are configured, but no live written coverage is ready yet.';
}

function buildCoverageState(db, overrides = {}) {
  const feed_count = Number(overrides.feed_count || getConfiguredFeeds().length || 0);
  const reachable_feed_count = Number(
    overrides.reachable_feed_count ?? lastCoverageState.reachable_feed_count ?? 0
  );
  const failures = Array.isArray(overrides.failures)
    ? overrides.failures.slice(0, 10)
    : Array.isArray(lastCoverageState.failures)
      ? lastCoverageState.failures
      : [];
  const failure_count = Number(
    overrides.failure_count ?? failures.length ?? lastCoverageState.failure_count ?? 0
  );
  const article_count = Number(overrides.article_count ?? countWrittenArticles(db));
  const checked_at = overrides.checked_at || lastCoverageState.checked_at || '';
  const latestArticleState = getLatestWrittenArticleState(db);
  if (
    overrides.latest_article_at !== undefined ||
    overrides.latest_article_age_hours !== undefined ||
    overrides.latest_article_is_stale !== undefined
  ) {
    latestArticleState.latest_article_at = overrides.latest_article_at ?? latestArticleState.latest_article_at;
    latestArticleState.latest_article_age_hours = overrides.latest_article_age_hours ?? latestArticleState.latest_article_age_hours;
    latestArticleState.latest_article_is_stale = overrides.latest_article_is_stale ?? latestArticleState.latest_article_is_stale;
  }
  const all_feeds_failed = feed_count > 0 && reachable_feed_count === 0 && failure_count >= feed_count;

  const coverage = {
    checked_at,
    feed_count,
    reachable_feed_count,
    failure_count,
    failures,
    article_count,
    all_feeds_failed,
    ...latestArticleState,
  };

  return {
    ...coverage,
    message: buildCoverageMessage(coverage),
  };
}

function recordCoverageState(db, overrides = {}) {
  lastCoverageState = buildCoverageState(db, overrides);
  return lastCoverageState;
}

function getWrittenNewsCoverageState(db) {
  return buildCoverageState(db);
}

function buildSourceId(platform, name) {
  const safeName = Buffer.from(String(name || 'unknown'))
    .toString('base64')
    .replace(/[+/=]/g, '')
    .slice(0, 12);

  return `src_${platform}_${safeName}`;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gis, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function extractRawTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractSourceMeta(block) {
  const match = String(block || '').match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
  if (!match) {
    return { label: '', url: '' };
  }

  return {
    label: stripHtml(match[2]),
    url: normalizeUrl(decodeHtmlEntities(extractAttribute(match[1] || '', 'url'))),
  };
}

function extractAttribute(tag, attributeName) {
  const match = String(tag || '').match(new RegExp(`${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match?.[2] ? match[2].trim() : '';
}

function normalizeUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }

  try {
    const parsed = new URL(candidate);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function normalizeUrlAgainstBase(value, baseUrl = '') {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }

  try {
    const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function getThumbnailWidth(url) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return 0;
  }

  const bbcStandardMatch = normalizedUrl.match(/:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/(\d+)\//i);
  if (bbcStandardMatch?.[1]) {
    return Number(bbcStandardMatch[1]) || 0;
  }

  const bbcImageMatch = normalizedUrl.match(/:\/\/ichef\.bbci\.co\.uk\/images\/ic\/(\d+)x(\d+)\//i);
  if (bbcImageMatch?.[1]) {
    return Number(bbcImageMatch[1]) || 0;
  }

  const googleMatch = normalizedUrl.match(/:\/\/[^/]*googleusercontent\.com\/.+?=([^#\s]+)$/i);
  if (googleMatch?.[1]) {
    const widthFlag = String(googleMatch[1] || '')
      .split('-')
      .map((part) => part.trim())
      .find((part) => /^w\d+$/i.test(part));
    if (widthFlag) {
      return Number(widthFlag.slice(1)) || 0;
    }
  }

  return 0;
}

function isLowResolutionThumbnailUrl(url, minWidth = 640) {
  const width = getThumbnailWidth(url);
  return width > 0 && width < Number(minWidth || 640);
}

function promoteWrittenThumbnailUrl(url, targetWidth = 1600) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return '';
  }

  if (/:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/\d+\//i.test(normalizedUrl)) {
    return normalizedUrl.replace(/(:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/)(\d+)(\/)/i, (_, prefix, width, suffix) => {
      const nextWidth = Math.max(Number(width) || 0, targetWidth);
      return `${prefix}${nextWidth}${suffix}`;
    });
  }

  if (/:\/\/ichef\.bbci\.co\.uk\/images\/ic\/\d+x\d+\//i.test(normalizedUrl)) {
    return normalizedUrl.replace(/(:\/\/ichef\.bbci\.co\.uk\/images\/ic\/)(\d+)x(\d+)(\/)/i, (_, prefix, width, height, suffix) => {
      const currentWidth = Number(width) || 0;
      const currentHeight = Number(height) || 0;
      const nextWidth = Math.max(currentWidth, targetWidth);
      const ratio = currentWidth > 0 && currentHeight > 0 ? currentHeight / currentWidth : (9 / 16);
      const nextHeight = Math.max(1, Math.round(nextWidth * ratio));
      return `${prefix}${nextWidth}x${nextHeight}${suffix}`;
    });
  }

  if (/:\/\/[^/]*googleusercontent\.com\/.+?=([^#\s]+)$/i.test(normalizedUrl)) {
    return normalizedUrl.replace(/(=)([^#\s]+)$/i, (_, equalsSign, flags) => {
      const nextFlags = String(flags || '')
        .split('-')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !/^w\d+$/i.test(part))
        .concat(`w${targetWidth}`);
      return `${equalsSign}${nextFlags.join('-')}`;
    });
  }

  return normalizedUrl;
}

function pickPreferredThumbnailUrl(currentUrl, incomingUrl) {
  const current = promoteWrittenThumbnailUrl(currentUrl);
  const incoming = promoteWrittenThumbnailUrl(incomingUrl);

  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  const currentWidth = getThumbnailWidth(current);
  const incomingWidth = getThumbnailWidth(incoming);

  if (incomingWidth > currentWidth) {
    return incoming;
  }

  if (isLowResolutionThumbnailUrl(current) && incoming) {
    return incoming;
  }

  return current;
}

function extractThumbnailUrl(block) {
  const rawBlock = String(block || '');
  const candidates = [];
  const tagPatterns = [
    /<media:thumbnail\b[^>]*url=(['"])(.*?)\1[^>]*\/?>/i,
    /<media:content\b[^>]*url=(['"])(.*?)\1[^>]*medium=(['"])image\3[^>]*\/?>/i,
    /<enclosure\b[^>]*url=(['"])(.*?)\1[^>]*type=(['"])image\/[^'"]+\3[^>]*\/?>/i,
    /<img\b[^>]*src=(['"])(.*?)\1[^>]*\/?>/i,
  ];

  for (const pattern of tagPatterns) {
    const match = rawBlock.match(pattern);
    if (match?.[2]) {
      candidates.push(match[2]);
    }
  }

  return candidates
    .map((value) => normalizeUrl(decodeHtmlEntities(value)))
    .find(Boolean) || '';
}

function extractMetaImageUrl(html, pageUrl = '') {
  const rawHtml = String(html || '');
  const metaPatterns = [
    /<meta\b[^>]*property=(['"])og:image\1[^>]*content=(['"])(.*?)\2[^>]*>/i,
    /<meta\b[^>]*content=(['"])(.*?)\1[^>]*property=(['"])og:image\3[^>]*>/i,
    /<meta\b[^>]*name=(['"])twitter:image(?::src)?\1[^>]*content=(['"])(.*?)\2[^>]*>/i,
    /<meta\b[^>]*content=(['"])(.*?)\1[^>]*name=(['"])twitter:image(?::src)?\3[^>]*>/i,
    /<link\b[^>]*rel=(['"])image_src\1[^>]*href=(['"])(.*?)\2[^>]*>/i,
    /<link\b[^>]*href=(['"])(.*?)\1[^>]*rel=(['"])image_src\3[^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = rawHtml.match(pattern);
    const candidate = match?.[3] || match?.[2] || '';
    const normalized = promoteWrittenThumbnailUrl(
      normalizeUrlAgainstBase(decodeHtmlEntities(candidate), pageUrl)
    );
    if (normalized) {
      return normalized;
    }
  }

  return promoteWrittenThumbnailUrl(extractThumbnailUrl(rawHtml)) || '';
}

async function fetchArticleImageUrl(articleUrl) {
  const normalizedUrl = normalizeUrl(articleUrl);
  if (!normalizedUrl) {
    return '';
  }

  try {
    const response = await fetchWithTimeout(normalizedUrl, {
      headers: {
        'User-Agent': 'eXplore/1.0 (+written-image-enrichment)',
      },
    }, 2000);

    if (!response.ok) {
      return '';
    }

    const html = await response.text();
    return extractMetaImageUrl(html, normalizedUrl);
  } catch (error) {
    return '';
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = WRITTEN_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker())
  );
  return results;
}

function extractLink(block) {
  const mediaMatch = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (mediaMatch?.[1]) {
    return mediaMatch[1].trim();
  }

  const textMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  return textMatch?.[1] ? stripHtml(textMatch[1]) : '';
}

function getFeedItemSortTime(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function parseFeedItems(xml, limit = 6) {
  const blocks = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const entryMatches = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  blocks.push(...itemMatches, ...entryMatches);

  return blocks.map((block, index) => {
    const title = extractTag(block, 'title');
    const url = extractLink(block);
    const rawDescription = extractRawTag(block, 'description') || extractRawTag(block, 'summary') || extractRawTag(block, 'content');
    const description = stripHtml(rawDescription);
    const publishDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    const thumbnailUrl = extractThumbnailUrl(block) || extractThumbnailUrl(rawDescription);
    const sourceMeta = extractSourceMeta(block);

    return {
      title,
      url,
      body: description,
      publishDate,
      thumbnailUrl,
      sourceLabel: sourceMeta.label,
      sourceUrl: sourceMeta.url,
      _sortIndex: index,
      _sortTime: getFeedItemSortTime(publishDate),
    };
  }).filter((item) => item.title && item.url)
    .sort((left, right) => {
      if (right._sortTime !== left._sortTime) {
        return right._sortTime - left._sortTime;
      }

      return left._sortIndex - right._sortIndex;
    })
    .slice(0, limit)
    .map(({ _sortIndex, _sortTime, ...item }) => item);
}

function normalizeDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function getHostName(feedUrl) {
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, '');
  } catch (error) {
    return 'written-news';
  }
}

function resolveWrittenSourceDetails(feedUrl, feedTitle = '', sourceMeta = {}) {
  const sourceUrl = normalizeUrl(sourceMeta?.url) || feedUrl;
  const sourceLabel = normalizeText(sourceMeta?.label) || normalizeWrittenSourceLabel(sourceUrl, feedTitle);
  const sourceTrustTier = getWrittenSourceTrustTier(sourceUrl, sourceLabel || feedTitle);

  return {
    sourceKey: getHostName(sourceUrl),
    sourceLabel,
    sourceTrustTier,
    sourceUrl,
  };
}

function isLikelyFeedDocument(xml) {
  return /<(rss|feed|rdf:RDF)\b/i.test(String(xml || ''));
}

function getFeedFailureReason(xml, items = []) {
  if (!isLikelyFeedDocument(xml)) {
    return 'Feed payload is not a valid RSS or Atom document.';
  }

  if (!Array.isArray(items) || items.length === 0) {
    return 'Feed is reachable but contains no parseable items.';
  }

  return '';
}

function backfillWrittenSourceMetadata(db) {
  const writtenSources = db.prepare(`
    SELECT id, url, name, trust_tier
    FROM sources
    WHERE platform = 'written'
  `).all();

  for (const source of writtenSources) {
    const nextLabel = normalizeWrittenSourceLabel(source.url, source.name);
    const nextTrustTier = getWrittenSourceTrustTier(source.url, source.name);
    const currentTrustTier = Number(source.trust_tier || 0);

    if (nextLabel && (nextLabel !== source.name || currentTrustTier !== nextTrustTier)) {
      db.prepare(`
        UPDATE sources
        SET name = ?,
            trust_tier = ?,
            category = COALESCE(category, 'Written News'),
            active = 1
        WHERE id = ?
      `).run(nextLabel, nextTrustTier, source.id);
    }

    const trustScore = nextTrustTier / 5;
    db.prepare(`
      UPDATE content_items
      SET trust_score = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ?
        AND channel_type = 'written'
        AND COALESCE(trust_score, 0) < ?
    `).run(trustScore, source.id, trustScore);
  }
}

function backfillWrittenThumbnailQuality(db) {
  const rows = db.prepare(`
    SELECT id, thumbnail_url
    FROM content_items
    WHERE channel_type = 'written'
      AND COALESCE(thumbnail_url, '') != ''
  `).all();

  for (const row of rows) {
    const promotedUrl = promoteWrittenThumbnailUrl(row.thumbnail_url);
    if (promotedUrl && promotedUrl !== row.thumbnail_url) {
      db.prepare(`
        UPDATE content_items
        SET thumbnail_url = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(promotedUrl, row.id);
    }
  }
}

function purgeSeededWrittenArticles(db) {
  db.prepare(`
    DELETE FROM content_items
    WHERE channel_type = 'written'
      AND url LIKE 'https://example.com/written-brief/%'
  `).run();

  db.prepare(`
    DELETE FROM sources
    WHERE platform = 'written'
      AND url = 'https://example.com/written-brief'
      AND id NOT IN (
        SELECT DISTINCT source_id
        FROM content_items
        WHERE source_id IS NOT NULL
      )
  `).run();
}

function insertArticle(db, entry) {
  const sourceId = buildSourceId('written', entry.sourceKey);
  const sourceTrustTier = Math.max(1, Math.min(5, Number(entry.sourceTrustTier) || 3));
  const sourceTrustScore = sourceTrustTier / 5;
  const externalId = `article_${crypto.createHash('sha1').update(entry.url).digest('hex').slice(0, 16)}`;
  const normalizedPublishDate = normalizeDate(entry.publishDate);
  const fallbackSummary = entry.body.slice(0, 220);
  const existing = db.prepare(`
    SELECT id, thumbnail_url, summary, article_body, publish_date, trust_score
    FROM content_items
    WHERE external_id = ?
    LIMIT 1
  `).get(externalId);
  const incomingThumbnailUrl = promoteWrittenThumbnailUrl(entry.thumbnailUrl);
  const nextThumbnailUrl = pickPreferredThumbnailUrl(existing?.thumbnail_url, incomingThumbnailUrl);

  db.prepare(`
    INSERT INTO sources (id, platform, name, url, trust_tier, category, active)
    VALUES (?, 'written', ?, ?, ?, 'Written News', 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      url = COALESCE(excluded.url, sources.url),
      trust_tier = excluded.trust_tier,
      category = COALESCE(excluded.category, sources.category),
      active = 1
  `).run(sourceId, entry.sourceLabel, entry.sourceUrl, sourceTrustTier);

  if (existing) {
    db.prepare(`
      UPDATE content_items
      SET trust_score = CASE
            WHEN COALESCE(trust_score, 0) < ? THEN ?
            ELSE trust_score
          END,
          thumbnail_url = COALESCE(?, thumbnail_url),
          publish_date = CASE
            WHEN ? IS NOT NULL AND COALESCE(publish_date, '') = '' THEN ?
            WHEN ? IS NOT NULL AND publish_date < ? THEN ?
            ELSE publish_date
          END,
          transcript = CASE
            WHEN COALESCE(transcript, '') = '' THEN ?
            ELSE transcript
          END,
          article_body = CASE
            WHEN COALESCE(article_body, '') = '' THEN ?
            ELSE article_body
          END,
          summary = CASE
            WHEN COALESCE(summary, '') = '' THEN ?
            ELSE summary
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      sourceTrustScore,
      sourceTrustScore,
      nextThumbnailUrl || null,
      normalizedPublishDate,
      normalizedPublishDate,
      normalizedPublishDate,
      normalizedPublishDate,
      normalizedPublishDate,
      entry.body,
      entry.body,
      fallbackSummary,
      existing.id,
    );
    return false;
  }

  const budget = entry.aiBudget || createWrittenAiBudget();
  const analysis = budget.takeAnalysis()
    ? aiService.analyzeContent(entry.title, entry.body, entry.body).catch(() => null)
    : Promise.resolve(null);
  const embedding = budget.takeEmbedding()
    ? aiService.generateEmbedding(`${entry.title}. ${entry.body}`, {
      providerPreference: 'gemini',
    }).catch(() => [])
    : Promise.resolve([]);

  return Promise.all([analysis, embedding]).then(([contentAnalysis, vector]) => {
    const scores = contentAnalysis?.scores || {};
    const topics = Array.isArray(contentAnalysis?.topics) ? contentAnalysis.topics : [];

    db.prepare(`
      INSERT INTO content_items (
        id,
        source_id,
        external_id,
        title,
        url,
        thumbnail_url,
        publish_date,
        transcript,
        summary,
        embedding_json,
        rarity_score,
        depth_score,
        freshness_score,
        timeless_score,
        clickbait_score,
        trust_score,
        topic_tags_json,
        content_type,
        article_body,
        channel_type,
        created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'article', ?, 'written', CURRENT_TIMESTAMP
      )
    `).run(
      crypto.randomUUID(),
      sourceId,
      externalId,
      entry.title,
      entry.url,
      nextThumbnailUrl || null,
      normalizedPublishDate,
      entry.body,
      contentAnalysis?.summary || fallbackSummary,
      JSON.stringify(vector || []),
      Number(scores.rarity || 0.4),
      Number(scores.depth || 0.65),
      Number(scores.freshness || 0.7),
      Number(scores.timeless || 0.45),
      Number(scores.clickbait || 0.08),
      sourceTrustScore,
      JSON.stringify(topics),
      entry.body,
    );

    return true;
  });
}

function createWrittenAiBudget() {
  let remainingAnalyses = MAX_WRITTEN_AI_ANALYSES_PER_REFRESH;
  let remainingEmbeddings = MAX_WRITTEN_EMBEDDINGS_PER_REFRESH;

  function diagnostics() {
    try {
      return aiService.getSafeModelPoolDiagnostics();
    } catch (error) {
      return {
        provider: 'mock',
        availableKeyCount: 0,
        openaiConfigured: false,
      };
    }
  }

  return {
    takeAnalysis() {
      if (remainingAnalyses <= 0) {
        return false;
      }
      const status = diagnostics();
      const liveProviderAvailable = Number(status.availableKeyCount || 0) > 0 || Boolean(status.openaiConfigured);
      if (!liveProviderAvailable) {
        return false;
      }
      remainingAnalyses -= 1;
      return true;
    },
    takeEmbedding() {
      if (remainingEmbeddings <= 0) {
        return false;
      }
      const status = diagnostics();
      if (Number(status.availableKeyCount || 0) <= 1) {
        return false;
      }
      remainingEmbeddings -= 1;
      return true;
    },
  };
}

async function refreshWrittenFeeds(db) {
  const feeds = getConfiguredFeeds();
  const articleImageCache = new Map();
  const aiBudget = createWrittenAiBudget();
  const feedStates = await mapWithConcurrency(feeds, 4, async (feedUrl) => {
    try {
      const response = await fetchWithTimeout(feedUrl, {
        headers: {
          'User-Agent': 'eXplore/1.0 (+written-feed-refresh)',
        },
      });

      if (!response.ok) {
        return { inserted: 0, reachable: false, failure: { feed: feedUrl, reason: `HTTP ${response.status}` } };
      }

      const xml = await response.text();
      const feedTitle = extractFeedTitle(xml);
      const items = parseFeedItems(xml, 8);
      const failureReason = getFeedFailureReason(xml, items);
      if (failureReason) {
        return { inserted: 0, reachable: false, failure: { feed: feedUrl, reason: failureReason } };
      }

      const insertStates = await mapWithConcurrency(items, 3, async (item) => {
        const sourceDetails = resolveWrittenSourceDetails(feedUrl, feedTitle || normalizeWrittenSourceLabel(feedUrl, feedTitle), {
          label: item.sourceLabel,
          url: item.sourceUrl,
        });
        const preliminaryEntry = {
          ...item,
          ...sourceDetails,
        };
        if (isLowSignalWrittenItem(preliminaryEntry)) {
          return false;
        }

        let thumbnailUrl = promoteWrittenThumbnailUrl(item.thumbnailUrl);
        if ((!thumbnailUrl || isLowResolutionThumbnailUrl(thumbnailUrl)) && item.url) {
          if (!articleImageCache.has(item.url)) {
            articleImageCache.set(item.url, fetchArticleImageUrl(item.url));
          }
          thumbnailUrl = pickPreferredThumbnailUrl(
            thumbnailUrl,
            await articleImageCache.get(item.url),
          );
        }

        const entry = {
          ...preliminaryEntry,
          thumbnailUrl,
          aiBudget,
        };
        return insertArticle(db, entry);
      });

      return {
        inserted: insertStates.filter(Boolean).length,
        reachable: true,
        failure: null,
      };
    } catch (error) {
      return {
        inserted: 0,
        reachable: false,
        failure: {
          feed: feedUrl,
          reason: error?.message || 'Network request failed',
        },
      };
    }
  });

  const failures = feedStates.map((state) => state.failure).filter(Boolean);

  return {
    inserted: feedStates.reduce((sum, state) => sum + state.inserted, 0),
    checked_at: new Date().toISOString(),
    feed_count: feeds.length,
    reachable_feed_count: feedStates.filter((state) => state.reachable).length,
    failure_count: failures.length,
    failures,
  };
}

async function ensureWrittenNewsCoverage(db, options = {}) {
  const force = Boolean(options.force);

  if (!ALLOW_DEV_MOCKS) {
    purgeSeededWrittenArticles(db);
  }

  backfillWrittenSourceMetadata(db);
  backfillWrittenThumbnailQuality(db);

  const articleCount = countWrittenArticles(db);
  const latestArticleState = getLatestWrittenArticleState(db);
  const now = Date.now();
  const needsRefresh = force
    || articleCount < 12
    || latestArticleState.latest_article_is_stale
    || now - lastRefreshAt > 30 * 60 * 1000;

  if (!needsRefresh) {
    const coverage = recordCoverageState(db, { article_count: articleCount, ...latestArticleState });
    return { refreshed: false, articleCount: coverage.article_count, coverage };
  }

  if (refreshPromise) {
    await refreshPromise;
    const coverage = getWrittenNewsCoverageState(db);
    return { refreshed: true, articleCount: coverage.article_count, coverage };
  }

  refreshPromise = (async () => {
    try {
      const refreshState = await refreshWrittenFeeds(db);
      lastRefreshAt = Date.now();
      return recordCoverageState(db, refreshState);
    } catch (error) {
      const feeds = getConfiguredFeeds();
      lastRefreshAt = Date.now();
      return recordCoverageState(db, {
        checked_at: new Date().toISOString(),
        feed_count: feeds.length,
        reachable_feed_count: 0,
        failure_count: feeds.length,
        failures: feeds.map((feed) => ({
          feed,
          reason: error?.message || 'Written feed refresh failed',
        })),
      });
    }
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }

  const coverage = getWrittenNewsCoverageState(db);
  return {
    refreshed: true,
    articleCount: coverage.article_count,
    coverage,
  };
}

async function buildWrittenNewsBrief(items, templateState, userId, forceRefresh) {
  const workspaceMemory = templateState?.workspace?.workspaceMemory || {};
  const priorityTopics = workspaceMemory.priorityTopics || [];
  const avoidTopics = workspaceMemory.avoidTopics || [];
  const trackedCompanies = workspaceMemory.trackedCompanies || [];
  const peopleOfInterest = workspaceMemory.peopleOfInterest || [];

  // Format the articles list to pass to the AI model
  const articlesText = items.map((item, index) => {
    return `[Article #${index + 1}]
Title: ${item.title}
Source: ${item.source || item.source_name || 'Unknown'}
URL: ${item.url}
Published: ${item.publish_date || item.created_at || 'Unknown'}
Summary/Body: ${item.summary || item.transcript || item.body || ''}
---------------------------------------------`;
  }).join('\n\n');

  const systemPrompt = `You are an elite, tactical intelligence editor. Your task is to compile a highly curated, surgical, and premium intelligence daily brief summarizing EXACTLY 10 of the most critical news developments of the day, specifically aligned with the user's target intelligence profile.

The user's intelligence profile is:
- Priority Topics: ${JSON.stringify(priorityTopics)}
- Tracked Companies: ${JSON.stringify(trackedCompanies)}
- Key People: ${JSON.stringify(peopleOfInterest)}
- Avoid Topics/Filters (SUPPRESS THESE AGGRESSIVELY!): ${JSON.stringify(avoidTopics)}

Your output MUST be a valid JSON object matching the following structure:
{
  "brief_title": "Daily Tactical Intelligence Brief",
  "summary": "A concise 2-3 sentence executive summary of the overarching macro dynamics, themes, and significant shifts of the last 24 hours.",
  "stories": [
    {
      "headline": "Surgical, premium title for the development",
      "summary": "A crisp, extremely detailed, information-dense 3-4 sentence paragraph synthesizing the development, citing relevant numbers, actions, or direct quotes where applicable. Do not use generic filler.",
      "themes": ["Primary Theme", "Secondary Theme"],
      "whyNow": "Why this matters today and what makes it a critical turning point or development.",
      "watchFor": "Specific milestones, announcements, or metrics to monitor in the coming days/weeks.",
      "actionSignals": "Tactical implications or key decisions/insights for the user based on their profile.",
      "source": "Name of the original reporting source",
      "url": "Original article URL"
    }
  ]
}

Make sure there are EXACTLY 10 stories in the "stories" array. 
If there are fewer than 10 total input articles provided, summarize all of them but ensure they are rich, distinct, and detailed (e.g. if only 8 articles are provided, return exactly 8 stories, or return 10 by finding distinct critical sub-facets or details within those articles). 
If there are more, select exactly the 10 most critical ones based on relevance to the user's interests and importance of the news, keeping avoidTopics filters strictly out of the brief. No commentary outside the JSON structure.`;

  const userPrompt = `Here are the articles harvested for today:

${articlesText}

Synthesize these into exactly 10 high-signal intelligence briefs in the requested JSON structure, heavily prioritizing matches to the user's tracked companies and priority topics while avoiding all suppressed topics.`;

  try {
    const brief = await aiService.generateStructuredJson({
      systemPrompt,
      userPrompt,
      providerPreference: 'auto',
      model: 'gemini-3.5-flash',
      temperature: 0.2,
    });
    return brief;
  } catch (error) {
    console.error('Failed to generate structured daily news brief:', error);
    // Fallback in case generation fails
    return {
      brief_title: "Daily Tactical Intelligence Brief (Fallback)",
      summary: "A fallback summary generated due to an AI processing error.",
      stories: items.slice(0, 10).map((item, idx) => ({
        headline: item.title,
        summary: item.summary || item.body || "Detail summary unavailable.",
        themes: ["News"],
        whyNow: "Synthesized due to primary AI brief generator failure.",
        watchFor: "Updates on the original source.",
        actionSignals: "Review original article.",
        source: item.source || item.source_name || "Unknown",
        url: item.url,
      })),
    };
  }
}

module.exports = {
  ensureWrittenNewsCoverage,
  fetchWithTimeout,
  getConfiguredFeedDefinitions,
  getHostName,
  getWrittenNewsCoverageState,
  isLowSignalWrittenItem,
  parseFeedItems,
  buildWrittenNewsBrief,
  __test__: {
    getFeedFailureReason,
    getLatestWrittenArticleState,
    isLikelyFeedDocument,
    getThumbnailWidth,
    isLowResolutionThumbnailUrl,
    isLowSignalWrittenItem,
    promoteWrittenThumbnailUrl,
    pickPreferredThumbnailUrl,
  },
};
