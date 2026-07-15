'use strict';

const crypto = require('crypto');
const aiService = require('../../services/aiService');
const alertRadarService = require('./alertRadarService');
const { getEventSourceMap } = require('./eventSourceMapService');
const {
  fetchWithTimeout: fetchWrittenFeedWithTimeout,
  getWrittenNewsCoverageState,
  isLowSignalWrittenItem,
  parseFeedItems,
} = require('./writtenNewsService');
const youtubeService = require('../../services/youtubeService');

const PUBLIC_SCOPE = 'public';
const DISCOVERY_REFRESH_TTL_MS = 15 * 60 * 1000;
const DISCOVERY_RETENTION_DAYS = 14;
const MAX_TRACKED_CHANNEL_VIDEOS = 6;
const MAX_TOPIC_QUERY_VIDEOS = 6;
// Keep scheduled refreshes inside provider quotas. Deterministic scoring still
// handles every candidate; live AI is reserved for the strongest new items.
const MAX_ANALYSIS_PER_REFRESH = Math.max(
  0,
  Math.min(Number(process.env.DISCOVERY_AI_ANALYSIS_BUDGET || 2), 10)
);
const MAX_FALLBACK_AI_ALERTS = 12;
const MAX_ACTIVE_DISCOVERY_CANDIDATES = 72;
const MAX_SOURCE_PACK_SOURCES_PER_REFRESH = 6;
const MAX_SOURCE_PACK_ITEMS_PER_SOURCE = 4;
const SOURCE_PACK_FETCH_TIMEOUT_MS = 6000;
const MAX_DISCOVERY_CANDIDATE_AGE_HOURS = 72;
const MAX_PEOPLE_OF_INTEREST = 3;
const MAX_PEOPLE_QUERIES_PER_PERSON = 5;
const POSITIVE_ACTIONS = new Set(['click', 'save', 'share', 'open_source']);
const NEGATIVE_ACTIONS = new Set(['dismiss']);
const STOPWORDS = new Set([
  'about', 'after', 'again', 'around', 'because', 'before', 'being', 'between', 'company',
  'feature', 'features', 'from', 'have', 'into', 'latest', 'major', 'more', 'most', 'news',
  'only', 'over', 'platform', 'product', 'release', 'releases', 'their', 'these', 'they',
  'this', 'those', 'through', 'today', 'tool', 'tools', 'update', 'updates', 'video', 'videos',
  'what', 'when', 'with', 'your',
]);

const SYSTEM_TRACKED_CHANNELS = [
  { query: 'OpenAI', channelId: 'UCXZCJLdBC09xxGZ6gcdrc6A', lane: 'tracked', trustTier: 5 },
  { query: 'Anthropic', channelId: 'UCrDwWp7EBBv4NwvScIpBDOA', lane: 'tracked', trustTier: 5 },
  { query: 'Google DeepMind', channelId: 'UCP7jMXSY2xbc3KCAE0MHQ-A', lane: 'tracked', trustTier: 5 },
  { query: 'Microsoft Developer', channelId: 'UCsMica-v34Irf9KVTh6xx-g', lane: 'tracked', trustTier: 4 },
  { query: 'Hugging Face', channelId: 'UCHlNU7kIZhRgSbhHvFoy72w', lane: 'tracked', trustTier: 4 },
  { query: 'AI Explained', channelId: 'UCNJ1Ymd5yFuUPtn21xtRbbw', lane: 'tracked', trustTier: 4 },
  { query: 'Two Minute Papers', channelId: 'UCbfYPyITQ-7l4upoX8nvctg', lane: 'tracked', trustTier: 4 },
  { query: 'المواطن سعيد', channelId: 'UChc0Yw9NkSb8Thy53MsM3gw', lane: 'tracked', trustTier: 3 },
];

const SYSTEM_PEOPLE_OF_INTEREST = [
  {
    name: 'Sheikh Mohammed bin Rashid Al Maktoum',
    aliases: ['Mohammed bin Rashid', 'محمد بن راشد آل مكتوم', 'MBR', 'Ruler of Dubai', 'UAE Prime Minister'],
    topics: ['Dubai leadership', 'personality', 'governance', 'innovation', 'official statement'],
    trustTier: 5,
  },
  {
    name: 'Dario Amodei',
    aliases: ['Dario'],
    topics: ['Anthropic', 'Claude', 'AI safety'],
    trustTier: 5,
  },
];

const SYSTEM_TOPIC_MONITORS = [
  { query: 'OpenAI model release', intent: 'fresh_signal', weight: 0.78 },
  { query: 'Anthropic Claude update', intent: 'fresh_signal', weight: 0.76 },
  { query: 'Google Gemini release', intent: 'fresh_signal', weight: 0.76 },
  { query: 'Hugging Face new model', intent: 'fresh_signal', weight: 0.7 },
];

const SUPPLEMENTAL_SOURCE_PACK_SOURCES = {
  ai_discounts: [
    {
      id: 'g2-ai-software',
      label: 'G2 AI Software',
      url: 'https://www.g2.com/categories/artificial-intelligence',
      sourceType: 'directory',
      monitorType: 'landing_page',
      priority: 'high',
      watchFor: ['free plans', 'discounts', 'user reviews', 'cheap alternatives'],
    },
    {
      id: 'product-hunt-ai',
      label: 'Product Hunt AI',
      url: 'https://www.producthunt.com/topics/artificial-intelligence',
      sourceType: 'directory',
      monitorType: 'landing_page',
      priority: 'high',
      watchFor: ['new tools', 'launch offers', 'early access'],
    },
    {
      id: 'futurepedia',
      label: 'Futurepedia',
      url: 'https://www.futurepedia.io/',
      sourceType: 'directory',
      monitorType: 'landing_page',
      priority: 'medium',
      watchFor: ['AI tool categories', 'pricing filters', 'free tools'],
    },
    {
      id: 'theres-an-ai-for-that',
      label: "There's An AI For That",
      url: 'https://theresanaiforthat.com/',
      sourceType: 'directory',
      monitorType: 'landing_page',
      priority: 'medium',
      watchFor: ['tool discovery', 'use-case alternatives', 'pricing shifts'],
    },
  ],
};

const DEFAULT_INTERPRETATION_LENSES = [
  {
    id: 'jung-symbolic-pattern',
    label: 'Jung',
    readsFor: 'symbols, shadow, collective mood, archetypal tension',
  },
  {
    id: 'peterson-order-chaos',
    label: 'Peterson',
    readsFor: 'order, chaos, competence, sacrifice, narrative direction',
  },
  {
    id: 'nietzsche-value-creation',
    label: 'Nietzsche',
    readsFor: 'will, decadence, value creation, strength, resentment',
  },
  {
    id: 'jobs-taste-product',
    label: 'Jobs',
    readsFor: 'taste, simplicity, product meaning, cultural timing',
  },
  {
    id: 'self-final-theory',
    label: 'Self',
    readsFor: 'your life story, current goals, avoided noise, 1-10 feedback',
  },
];

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function parseJsonList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeScopeKey(userId) {
  return normalizeText(userId) || PUBLIC_SCOPE;
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function ensureColumn(db, tableName, columnName, definition) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
    }
  } catch (error) {
    // Some tests intentionally create partial schemas. Callers handle missing tables.
  }
}

function ensureWatchedSourcePackColumns(db) {
  ensureColumn(db, 'watched_source_packs', 'spider_policy_json', "TEXT DEFAULT '{}'");
  ensureColumn(db, 'watched_source_packs', 'interpretation_lenses_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'watched_source_packs', 'gap_awareness_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'watched_source_packs', 'final_theory_feedback_json', "TEXT DEFAULT '{}'");
}

function tokenize(value) {
  return [...new Set(
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  )];
}

function overlapScore(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(leftTokens.length, rightTokens.length);
}

function hoursSince(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? (Date.now() - parsed) / (1000 * 60 * 60) : 999;
}

function computeFreshnessScore(publishedAt) {
  const hours = hoursSince(publishedAt);
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.9;
  if (hours <= 72) return 0.76;
  if (hours <= 168) return 0.58;
  return 0.32;
}

function normalizeSourceUrl(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (error) {
    return normalized.replace(/\/+$/, '');
  }
}

function maxTimestamp(values = []) {
  const parsed = values
    .map((value) => Date.parse(value || ''))
    .filter((value) => Number.isFinite(value));

  if (!parsed.length) {
    return '';
  }

  return new Date(Math.max(...parsed)).toISOString();
}

function freshnessHoursFromTimestamp(value = '') {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60)).toFixed(1));
}

function freshnessHoursFromItems(items = [], fields = ['publishDate', 'publishedAt', 'updatedAt', 'createdAt']) {
  const timestamps = [];
  for (const item of Array.isArray(items) ? items : []) {
    for (const field of fields) {
      const parsed = Date.parse(item?.[field] || '');
      if (Number.isFinite(parsed)) {
        timestamps.push(parsed);
        break;
      }
    }
  }

  if (!timestamps.length) {
    return null;
  }

  return Number(Math.max(0, (Date.now() - Math.max(...timestamps)) / (1000 * 60 * 60)).toFixed(1));
}

function isCandidateWithinDiscoveryWindow(candidate = {}) {
  const publishedAt = Date.parse(candidate?.publishDate || candidate?.publishedAt || '');
  if (!Number.isFinite(publishedAt)) {
    return false;
  }

  const ageMs = Date.now() - publishedAt;
  return ageMs <= (MAX_DISCOVERY_CANDIDATE_AGE_HOURS * 60 * 60 * 1000) && ageMs >= -(6 * 60 * 60 * 1000);
}

function freshestNumericValue(rows = [], field = 'freshness_hours') {
  const values = rows
    .map((row) => Number(row?.[field]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  return Number(Math.min(...values).toFixed(1));
}

function summarizeHealthRows(rows = []) {
  const normalized = Array.isArray(rows) ? rows : [];
  const liveRows = normalized.filter((row) => String(row?.status || '').toLowerCase() === 'live');
  const errorRows = normalized.filter((row) => String(row?.status || '').toLowerCase() === 'error');
  const staleRows = normalized.filter((row) => String(row?.status || '').toLowerCase() === 'stale');
  const candidateCount = normalized.reduce((total, row) => total + Number(row?.produced_items || 0), 0);
  const sourceCount = normalized.length;
  const lastCheckedAt = maxTimestamp(normalized.map((row) => row?.last_checked_at));
  const lastSuccessAt = maxTimestamp(normalized.map((row) => row?.last_success_at));
  const freshnessHours = freshestNumericValue(normalized)
    ?? freshnessHoursFromTimestamp(lastSuccessAt)
    ?? (liveRows.length ? 0 : null);

  const status = liveRows.length > 0
    ? 'live'
    : errorRows.length > 0
      ? (candidateCount > 0 ? 'partial' : 'error')
      : staleRows.length > 0
        ? (candidateCount > 0 ? 'partial' : 'stale')
        : sourceCount > 0
          ? 'partial'
          : 'unavailable';

  let message = 'No sources are configured for this pipeline yet.';
  if (status === 'live' && errorRows.length > 0) {
    message = 'This pipeline is live, but some sources are failing.';
  } else if (status === 'live') {
    message = 'This pipeline is live.';
  } else if (status === 'partial' && liveRows.length > 0) {
    message = 'This pipeline is partly live, with some sources failing or stale.';
  } else if (status === 'partial' && candidateCount > 0) {
    message = 'This pipeline has cached results, but some sources are failing or stale.';
  } else if (status === 'error') {
    message = 'This pipeline is failing right now.';
  } else if (status === 'stale') {
    message = 'This pipeline is stale right now.';
  }

  return {
    status,
    source_count: sourceCount,
    live_source_count: liveRows.length,
    stale_source_count: staleRows.length,
    error_source_count: errorRows.length,
    candidate_count: candidateCount,
    freshness_hours: freshnessHours,
    last_checked_at: lastCheckedAt,
    last_success_at: lastSuccessAt,
    message,
    source_health: normalized,
  };
}

function buildWrittenNewsPipelineHealth(db) {
  const coverage = getWrittenNewsCoverageState(db);
  const freshnessHours = Number.isFinite(Number(coverage.latest_article_age_hours))
    ? Number(coverage.latest_article_age_hours)
    : null;
  let status = 'unavailable';

  if (coverage.all_feeds_failed && coverage.article_count === 0) {
    status = 'error';
  } else if (coverage.article_count > 0 && coverage.latest_article_is_stale) {
    status = coverage.reachable_feed_count > 0 ? 'partial' : 'stale';
  } else if (coverage.reachable_feed_count > 0 && coverage.article_count > 0) {
    status = 'live';
  } else if (coverage.article_count > 0) {
    status = 'live';
  } else if (coverage.failure_count > 0) {
    status = 'partial';
  }

  return {
    status,
    source_count: Number(coverage.feed_count || 0),
    live_source_count: Number(coverage.reachable_feed_count || 0),
    stale_source_count: coverage.article_count > 0 && coverage.latest_article_is_stale ? 1 : 0,
    error_source_count: Number(coverage.failure_count || 0),
    candidate_count: Number(coverage.article_count || 0),
    freshness_hours: freshnessHours,
    last_checked_at: coverage.checked_at || '',
    last_success_at: coverage.latest_article_at || coverage.checked_at || '',
    message: coverage.message,
    coverage,
  };
}

function buildDiscoveryPipelineHealth(db, userId = '') {
  const sourcePacks = listWatchedSourcePacks(db, userId).filter((pack) => pack.active);
  const sourceHealth = filterRelevantSourceHealthEntries(
    listSourceHealth(db, userId),
    listTrackedChannels(db, userId),
    listTopicMonitors(db, userId),
    sourcePacks,
  );

  const officialReleaseHealth = summarizeHealthRows(
    sourceHealth.filter((row) => row.platform === 'radar' && row.lane === 'fresh_signal' && row.source_key === 'official_ai_release_watch')
  );
  officialReleaseHealth.label = 'Official releases';

  const trackedChannelHealth = summarizeHealthRows(
    sourceHealth.filter((row) => row.platform === 'youtube' && row.lane === 'tracked')
  );
  trackedChannelHealth.label = 'Tracked channels';

  const peopleOfInterestHealth = summarizeHealthRows(
    sourceHealth.filter((row) => row.platform === 'youtube' && row.lane === 'interview_signal')
  );
  peopleOfInterestHealth.label = 'People of interest';

  const writtenNewsHealth = buildWrittenNewsPipelineHealth(db);
  writtenNewsHealth.label = 'Written news';

  const sourcePackHealth = summarizeHealthRows(
    sourceHealth.filter((row) => row.platform === 'source_pack')
  );
  sourcePackHealth.label = 'Source packs';

  return {
    official_releases: officialReleaseHealth,
    tracked_channels: trackedChannelHealth,
    people_of_interest: peopleOfInterestHealth,
    source_packs: sourcePackHealth,
    written_news: writtenNewsHealth,
  };
}

function computeDepthScore(video) {
  const durationSeconds = Number(video.durationSeconds || 0);
  const descriptionLength = normalizeText(video.description).length;
  let score = 0.36;
  if (durationSeconds >= 1200) score += 0.34;
  else if (durationSeconds >= 480) score += 0.24;
  else if (durationSeconds >= 180) score += 0.12;
  if (descriptionLength >= 1000) score += 0.12;
  else if (descriptionLength >= 300) score += 0.06;
  if (video.transcript) score += 0.18;
  return clamp01(score, 0.42);
}

function computeTimelessScore(video) {
  return /\b(history|explained|guide|framework|strategy|research|architecture|tutorial)\b/i.test(`${video.title} ${video.description}`)
    ? 0.68
    : 0.42;
}

function computeClickbaitPenalty(video) {
  const title = normalizeText(video.title);
  let score = 0.08;
  if (/[!?]{2,}/.test(title)) score += 0.18;
  if (/\b(shocking|insane|crazy|must watch|won't believe|destroys|game changer)\b/i.test(title)) score += 0.26;
  if (/\b(top \d+|best .* tools?|every .* needs)\b/i.test(title)) score += 0.18;
  return clamp01(score, 0.08);
}

function computeSourceTrust(video, channelRow, lane) {
  let score = clamp01(Number(channelRow?.trust_tier || 3) / 5, 0.55);
  const sourceText = `${video.channelTitle || ''} ${channelRow?.channel_name || ''}`.toLowerCase();
  if (/\b(openai|anthropic|deepmind|google|microsoft|hugging face)\b/.test(sourceText)) score += 0.2;
  if (lane === 'tracked') score += 0.08;
  return clamp01(score, 0.62);
}

function getLanePriority(lane = '') {
  const normalized = normalizeText(lane).toLowerCase();
  if (normalized === 'tracked') return 4;
  if (normalized === 'interview_signal') return 3;
  if (normalized === 'fresh_signal') return 2;
  if (normalized === 'personal_match') return 1;
  if (normalized === 'exploration') return 0;
  return -1;
}

function shouldReplaceCandidate(existing = null, candidate = null) {
  if (!candidate) {
    return false;
  }

  if (!existing) {
    return true;
  }

  const candidateFreshness = computeFreshnessScore(candidate.publishDate);
  const existingFreshness = computeFreshnessScore(existing.publishDate);
  if (candidateFreshness !== existingFreshness) {
    return candidateFreshness > existingFreshness;
  }

  const candidateLanePriority = getLanePriority(candidate.lane);
  const existingLanePriority = getLanePriority(existing.lane);
  if (candidateLanePriority !== existingLanePriority) {
    return candidateLanePriority > existingLanePriority;
  }

  const candidateHasTranscript = Boolean(candidate.transcript);
  const existingHasTranscript = Boolean(existing.transcript);
  if (candidateHasTranscript !== existingHasTranscript) {
    return candidateHasTranscript && !existingHasTranscript;
  }

  return false;
}

function buildChannelKey(channelId, channelQuery) {
  return normalizeText(channelId) ? `channel:${normalizeText(channelId)}` : `query:${slugify(channelQuery)}`;
}

function buildQueryKey(query) {
  return slugify(query);
}

function classifySourcePackLane(topic = '') {
  const text = normalizeText(topic).toLowerCase();
  if (/\b(iran|iraq|israel|qatar|jordan|ukraine|russia|war|strike|missile|airspace|escalation|ceasefire|invasion|attack)\b/.test(text)) {
    return 'war';
  }
  if (/\b(stock|market|shares|invest|investment|ipo|s-1|filing|ticker|earnings|rates|inflation|valuation)\b/.test(text)) {
    return 'markets';
  }
  if (/\b(art|arts|culture|music|film|beauty|meaning|religion|psychology|identity|design|narrative|philosophy)\b/.test(text)) {
    return 'art_meaning';
  }
  if (/\b(job|jobs|scholarship|scholarships|internship|lab|labs|research role|phd|masters|fully funded|remote work|opportunity)\b/.test(text)) {
    return 'personal_opportunities';
  }
  return 'ai_advantage';
}

function buildSourcePackQuestions(topic = '', lane = 'ai_advantage') {
  const cleanTopic = normalizeText(topic, 'this topic');
  const laneQuestions = {
    war: [
      `What changed now in ${cleanTopic}?`,
      'Is it confirmed by official or high-trust sources?',
      'Does it affect Jordan, Qatar, Hungary, Europe, travel, energy, or safety?',
      'What decision or action should change because of it?',
    ],
    markets: [
      `What market-moving fact changed in ${cleanTopic}?`,
      'Is there a filing, earnings report, official statement, or trusted market report?',
      'Does it affect investable access, AI infrastructure, public tech, or timing?',
      'Should this be watched, saved, compared, or ignored?',
    ],
    art_meaning: [
      `What is meaningful or creatively useful inside ${cleanTopic}?`,
      'Does it reveal taste, attention, identity, beauty, psychology, or worldview?',
      'Is the source durable rather than viral commentary?',
      'Should this shape writing, design, research, or personal direction?',
    ],
    personal_opportunities: [
      `Is ${cleanTopic} currently open and suitable?`,
      'What are the eligibility gate, deadline, funding, location, and application burden?',
      'Does it match AI, psychology, cognitive science, research, scholarships, or remote work?',
      'What is the next concrete application action?',
    ],
    ai_advantage: [
      `What useful edge does ${cleanTopic} create?`,
      'Did access, cost, model capability, workflow speed, or pricing change?',
      'Is the source official, developer-verifiable, or corroborated by trusted users?',
      'Should this be tried, watched, saved, or ignored this week?',
    ],
  };

  return laneQuestions[lane] || laneQuestions.ai_advantage;
}

function buildSourcePackSpiderPolicy(topic = '', lane = 'ai_advantage', priority = 'watch') {
  const cleanTopic = normalizeText(topic, 'this topic');
  const normalizedPriority = normalizeText(priority, 'watch').toLowerCase();
  const cadenceHours = normalizedPriority === 'direct'
    ? 1
    : normalizedPriority === 'important'
      ? 6
      : 24;

  return {
    mode: 'reference_net',
    cadence_hours: cadenceHours,
    event_triggered: true,
    trigger_words: [
      'release',
      'launch',
      'filing',
      'breakthrough',
      'war',
      'attack',
      'funding',
      'discount',
      'new tool',
    ],
    trigger_rule: `Wake this net when ${cleanTopic} has a release, shock, offer, or high-signal change.`,
    lane,
  };
}

function buildSourcePackInterpretationLenses(topic = '', lane = 'ai_advantage') {
  const cleanTopic = normalizeText(topic, 'this topic');
  const laneLens = lane === 'art_meaning'
    ? {
        id: 'art-meaning-trend',
        label: 'Art meaning',
        readsFor: 'style shifts, scene energy, symbolic resonance, useful creative openings',
      }
    : lane === 'war'
      ? {
          id: 'home-safety',
          label: 'Home safety',
          readsFor: 'regional danger, spillover risk, airspace, energy, diplomacy',
        }
      : {
          id: 'advantage',
          label: 'Advantage',
          readsFor: 'tools, leverage, offers, capabilities, first-mover edge',
        };

  return [laneLens, ...DEFAULT_INTERPRETATION_LENSES].map((lens) => ({
    ...lens,
    topic: cleanTopic,
  }));
}

function buildSourcePackGapAwareness(topic = '', sources = []) {
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  return [
    {
      id: 'digital-only',
      label: 'Digital only',
      status: 'known_gap',
      detail: 'This net watches configured digital sources; offline context is not proven.',
    },
    {
      id: 'source-count',
      label: sourceCount >= 20 ? '20-source net' : 'Source net growing',
      status: sourceCount >= 20 ? 'ready' : 'partial',
      detail: `${sourceCount} references are attached to ${normalizeText(topic, 'this topic')}.`,
    },
    {
      id: 'private-context',
      label: 'Profile fit',
      status: 'partial',
      detail: 'Ranking uses saved goals where available; private browser/history import is not automatic yet.',
    },
    {
      id: 'api-coverage',
      label: 'API coverage',
      status: 'partial',
      detail: 'X, Reddit, paywalled data, and private platform signals depend on configured credentials.',
    },
  ];
}

function normalizeFinalTheoryFeedback(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const hasRating = source.rating !== null && source.rating !== undefined && source.rating !== '';
  const rating = hasRating ? Number(source.rating) : NaN;
  return {
    rating: Number.isFinite(rating) ? Math.max(1, Math.min(10, Math.round(rating))) : null,
    note: normalizeText(source.note),
    updated_at: normalizeText(source.updated_at),
  };
}

function shouldAddAiDiscountSources(topic = '') {
  return /\b(free|cheap|discount|deal|offer|pricing|price|coupon|account|accounts|subscription|plan|g2|g2g|alternative|alternatives)\b/i.test(topic);
}

function buildGeneratedSourcePack(topic = '', options = {}) {
  const cleanTopic = normalizeText(topic);
  const lane = normalizeText(options.lane) || classifySourcePackLane(cleanTopic);
  const sourceMap = getEventSourceMap();
  const laneEntry = sourceMap.lanes.find((entry) => entry.id === lane) || sourceMap.lanes.find((entry) => entry.id === 'ai_advantage');
  const baseSources = Array.isArray(laneEntry?.sources) ? laneEntry.sources : [];
  const supplementalSources = lane === 'ai_advantage' && shouldAddAiDiscountSources(cleanTopic)
    ? SUPPLEMENTAL_SOURCE_PACK_SOURCES.ai_discounts
    : [];
  const sourceById = new Map();
  const priority = normalizeText(options.priority, 'watch').toLowerCase();

  for (const source of [...supplementalSources, ...baseSources]) {
    if (!source?.id || sourceById.has(source.id)) {
      continue;
    }
    sourceById.set(source.id, {
      id: source.id,
      label: source.label,
      url: source.url,
      sourceType: source.sourceType || 'reference',
      monitorType: source.monitorType || 'landing_page',
      priority: source.priority || 'medium',
      watchFor: Array.isArray(source.watchFor) ? source.watchFor : [],
    });
  }

  return {
    topic: cleanTopic,
    topic_key: buildQueryKey(cleanTopic),
    lane,
    priority,
    why: normalizeText(options.why) || `Watch ${cleanTopic} through ${laneEntry?.label || 'AI Advantage'} references.`,
    watchQuestions: buildSourcePackQuestions(cleanTopic, lane),
    generatedSources: [...sourceById.values()],
    spiderPolicy: buildSourcePackSpiderPolicy(cleanTopic, lane, priority),
    interpretationLenses: buildSourcePackInterpretationLenses(cleanTopic, lane),
    gapAwareness: buildSourcePackGapAwareness(cleanTopic, [...sourceById.values()]),
    finalTheoryFeedback: normalizeFinalTheoryFeedback(options.finalTheoryFeedback),
  };
}

function applySourcePackSelection(pack = {}, payload = {}) {
  const selectedIds = new Set(
    (Array.isArray(payload.selected_source_ids) ? payload.selected_source_ids : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );
  const selectedUrls = new Set(
    (Array.isArray(payload.selected_source_urls) ? payload.selected_source_urls : [])
      .map((value) => normalizeSourceUrl(value))
      .filter(Boolean)
  );
  const hasSelection = selectedIds.size > 0 || selectedUrls.size > 0;
  const generatedSources = hasSelection
    ? (pack.generatedSources || []).filter((source) => (
        selectedIds.has(normalizeText(source.id))
        || selectedUrls.has(normalizeSourceUrl(source.url || source.feedUrl || ''))
      ))
    : (pack.generatedSources || []);

  return {
    ...pack,
    generatedSources,
    gapAwareness: buildSourcePackGapAwareness(pack.topic, generatedSources),
  };
}

async function generateSourcePackWithAI(topic, options = {}) {
  const cleanTopic = normalizeText(topic);
  const lane = normalizeText(options.lane) || classifySourcePackLane(cleanTopic);
  const priority = normalizeText(options.priority, 'watch').toLowerCase();

  let aiResult = null;
  try {
    const systemPrompt = `You are a Topic Decomposer for "eXplore". Your job is to decompose a natural language topic into:
1. subquestions: Array of 3-5 specific questions that need to be answered to monitor this topic effectively.
2. primary_sources: Array of 3-5 official or high-trust primary source channels (organizations, websites, or registries) relevant to the topic. For each source, provide a JSON object with:
   - "label": Name of the source (e.g., "Reuters", "OpenAI blog")
   - "url": Homepage or RSS URL if known (e.g., "https://reuters.com", "https://openai.com/news")
   - "sourceType": "official" or "press" or "reference"
   - "watchFor": Array of 2-4 keywords or phrases to watch for (e.g., ["GPT-5", "safety report"])

Return ONLY a JSON object with these keys: "subquestions", "primary_sources".`;

    const userPrompt = `Topic: "${cleanTopic}"`;

    const response = await aiService.generateStructuredJson({
      systemPrompt,
      userPrompt,
      temperature: 0.2
    });

    if (response && Array.isArray(response.subquestions) && Array.isArray(response.primary_sources)) {
      aiResult = response;
    }
  } catch (error) {
    console.warn('[AI] Topic decomposition failed, falling back to deterministic template:', error.message);
  }

  const deterministicPack = buildGeneratedSourcePack(topic, options);

  if (!aiResult) {
    return deterministicPack;
  }

  const watchQuestions = aiResult.subquestions.map(q => normalizeText(q)).filter(Boolean);
  const generatedSources = [];
  const sourceById = new Map();

  if (lane === 'ai_advantage' && shouldAddAiDiscountSources(cleanTopic)) {
    for (const source of SUPPLEMENTAL_SOURCE_PACK_SOURCES.ai_discounts) {
      sourceById.set(source.id, {
        id: source.id,
        label: source.label,
        url: source.url,
        sourceType: source.sourceType || 'reference',
        monitorType: source.monitorType || 'landing_page',
        priority: source.priority || 'medium',
        watchFor: Array.isArray(source.watchFor) ? source.watchFor : [],
      });
    }
  }

  for (const src of aiResult.primary_sources) {
    const label = normalizeText(src.label);
    if (!label) continue;
    const id = slugify(label);
    if (sourceById.has(id)) continue;

    sourceById.set(id, {
      id,
      label,
      url: normalizeSourceUrl(src.url) || `https://news.google.com/rss/search?q=${encodeURIComponent(label)}`,
      sourceType: src.sourceType || 'reference',
      monitorType: 'landing_page',
      priority: 'high',
      watchFor: Array.isArray(src.watchFor) ? src.watchFor.map(w => normalizeText(w)) : [],
    });
  }

  if (sourceById.size === 0) {
    for (const source of deterministicPack.generatedSources) {
      sourceById.set(source.id, source);
    }
  }

  return {
    topic: cleanTopic,
    topic_key: buildQueryKey(cleanTopic),
    lane,
    priority,
    why: normalizeText(options.why) || `Watch ${cleanTopic} through ${lane} references.`,
    watchQuestions: watchQuestions.length > 0 ? watchQuestions : deterministicPack.watchQuestions,
    generatedSources: [...sourceById.values()],
    spiderPolicy: buildSourcePackSpiderPolicy(cleanTopic, lane, priority),
    interpretationLenses: buildSourcePackInterpretationLenses(cleanTopic, lane),
    gapAwareness: buildSourcePackGapAwareness(cleanTopic, [...sourceById.values()]),
    finalTheoryFeedback: normalizeFinalTheoryFeedback(options.finalTheoryFeedback),
  };
}

async function previewWatchedSourcePack(payload = {}) {
  const topic = normalizeText(payload.topic);
  if (!topic) {
    throw new Error('Topic is required');
  }

  const pack = await generateSourcePackWithAI(topic, {
    lane: payload.lane,
    priority: payload.priority,
    why: payload.why,
    finalTheoryFeedback: payload.finalTheoryFeedback,
  });

  return applySourcePackSelection(pack, payload);
}

function getSourcePackHost(source = {}) {
  try {
    return new URL(source.feedUrl || source.url || '').hostname.replace(/^www\./, '');
  } catch (error) {
    return '';
  }
}

function buildGoogleNewsSourcePackFeedUrl(pack = {}, source = {}) {
  const host = getSourcePackHost(source);
  if (!host) {
    return '';
  }

  const watchFor = Array.isArray(source.watchFor) ? source.watchFor.slice(0, 3).join(' ') : '';
  const query = [`site:${host}`, pack.topic, watchFor]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');
  const params = new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function buildSourcePackFeedUrl(pack = {}, source = {}) {
  const explicitFeedUrl = normalizeText(source.feedUrl || source.feed_url);
  if (explicitFeedUrl) {
    return explicitFeedUrl;
  }

  const url = normalizeText(source.url);
  const monitorType = normalizeText(source.monitorType || source.monitor_type).toLowerCase();
  if (monitorType === 'rss' || /\.(rss|xml)$/i.test(url) || /\/feed\/?$/i.test(url)) {
    return url;
  }

  return buildGoogleNewsSourcePackFeedUrl(pack, source);
}

function normalizeSourcePackDate(value = '') {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildSourcePackCandidate(pack = {}, source = {}, item = {}) {
  const itemUrl = normalizeSourceUrl(item.url);
  const externalHash = crypto
    .createHash('sha1')
    .update(`${pack.topic_key}:${source.id}:${itemUrl || item.title}`)
    .digest('hex')
    .slice(0, 18);
  const sourceLabel = normalizeText(item.sourceLabel) || normalizeText(source.label) || getSourcePackHost(source) || 'Source Pack';
  const trustTier = source.priority === 'high' || source.sourceType === 'official' ? 4 : 3;
  const body = normalizeText(item.body || item.summary || item.description);
  const tags = [
    normalizeText(pack.topic),
    normalizeText(pack.lane),
    normalizeText(source.sourceType),
    ...(Array.isArray(source.watchFor) ? source.watchFor : []),
  ].filter(Boolean);

  return {
    videoId: `source-pack:${externalHash}`,
    platform: 'source_pack',
    contentType: 'article',
    lane: normalizeText(pack.lane, 'ai_advantage'),
    sourceRef: `${pack.topic_key}:${source.id}`,
    sourceLabel,
    sourceUrl: normalizeSourceUrl(source.url),
    canonicalUrl: normalizeSourceUrl(source.url),
    sourceCategory: 'Source Pack',
    channelTitle: sourceLabel,
    title: normalizeText(item.title),
    url: itemUrl,
    thumbnailUrl: item.thumbnailUrl || '',
    publishDate: normalizeSourcePackDate(item.publishDate),
    durationSeconds: 0,
    viewCount: 0,
    description: body,
    body,
    transcript: '',
    ingestStatus: 'ready',
    transcriptStatus: 'not_applicable',
    tags,
    channelRow: {
      platform: 'source_pack',
      channel_name: sourceLabel,
      channel_url: normalizeSourceUrl(source.url),
      trust_tier: trustTier,
    },
    sourcePack: {
      pack_id: pack.id,
      topic: pack.topic,
      topic_key: pack.topic_key,
      source_id: source.id,
      source_label: source.label,
    },
  };
}

async function fetchSourcePackCandidatesForSource(pack = {}, source = {}) {
  const feedUrl = buildSourcePackFeedUrl(pack, source);
  if (!feedUrl) {
    return {
      source,
      feedUrl: '',
      candidates: [],
      error: 'No fetchable RSS or source-constrained feed URL could be built.',
    };
  }

  try {
    const response = await fetchWrittenFeedWithTimeout(feedUrl, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.7',
      },
    }, SOURCE_PACK_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Source pack feed returned HTTP ${response.status}.`);
    }

    const xml = await response.text();
    const items = parseFeedItems(xml, MAX_SOURCE_PACK_ITEMS_PER_SOURCE)
      .filter((item) => !isLowSignalWrittenItem(item))
      .map((item) => buildSourcePackCandidate(pack, source, item))
      .filter((candidate) => candidate.title && candidate.url);

    return {
      source,
      feedUrl,
      candidates: items,
      error: '',
    };
  } catch (error) {
    return {
      source,
      feedUrl,
      candidates: [],
      error: error.message || 'Source pack feed fetch failed.',
    };
  }
}

function buildSystemChannelSeedKey(lane, label) {
  return `${normalizeText(lane, 'tracked')}::${slugify(label)}`;
}

function isQuotaLikeErrorMessage(value = '') {
  return /\bquota\b|rate limit|user rate limit|dailyLimitExceeded|quotaExceeded/i.test(String(value || ''));
}

function getWorkspaceMemory(templateState = {}) {
  return templateState?.workspace?.workspaceMemory
    || templateState?.workspaceMemory
    || {};
}

function buildTemplateSignals(templateState = {}) {
  const workspaceMemory = getWorkspaceMemory(templateState);
  const interests = Array.isArray(templateState?.interests)
    ? templateState.interests.map((entry) => entry?.name || entry?.topic_name || entry?.topic || entry)
    : [];
  const priorityTopics = Array.isArray(workspaceMemory?.priorityTopics)
    ? workspaceMemory.priorityTopics
    : [];
  const peopleOfInterest = Array.isArray(templateState?.peopleOfInterest || workspaceMemory?.peopleOfInterest)
    ? (templateState?.peopleOfInterest || workspaceMemory?.peopleOfInterest).flatMap((entry) => {
      if (typeof entry === 'string') {
        return [entry];
      }

      return [
        entry?.name,
        ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
      ];
    })
    : [];
  return [
    templateState?.objective,
    templateState?.higherOrderRule,
    templateState?.hierarchy?.currentGoal,
    ...interests,
    ...priorityTopics,
    ...peopleOfInterest,
  ].map((entry) => normalizeText(entry)).filter(Boolean);
}

function normalizePeopleOfInterestEntry(entry = {}) {
  if (typeof entry === 'string') {
    const parts = entry.split('|').map((part) => normalizeText(part)).filter(Boolean);
    if (parts.length > 1) {
      const topics = parts.slice(1)
        .flatMap((part) => part.split(/[;,]/g).map((topic) => normalizeText(topic)))
        .filter(Boolean);
      return {
        name: parts[0],
        aliases: [],
        topics,
        trustTier: 4,
      };
    }

    return {
      name: normalizeText(entry),
      aliases: [],
      topics: [],
      trustTier: 4,
    };
  }

  return {
    name: normalizeText(entry?.name),
    aliases: Array.isArray(entry?.aliases) ? entry.aliases.map((alias) => normalizeText(alias)).filter(Boolean) : [],
    topics: Array.isArray(entry?.topics) ? entry.topics.map((topic) => normalizeText(topic)).filter(Boolean) : [],
    trustTier: Math.max(1, Math.min(Number(entry?.trustTier || 4), 5)),
  };
}

function buildPeopleOfInterestMonitors(templateState = {}) {
  const workspaceMemory = getWorkspaceMemory(templateState);
  const configuredEntries = Array.isArray(templateState?.peopleOfInterest || workspaceMemory?.peopleOfInterest)
    ? (templateState?.peopleOfInterest || workspaceMemory?.peopleOfInterest)
    : [];
  const people = [...SYSTEM_PEOPLE_OF_INTEREST, ...configuredEntries]
    .map(normalizePeopleOfInterestEntry)
    .filter((entry) => entry.name)
    .filter((entry, index, entries) => entries.findIndex((candidate) => slugify(candidate.name) === slugify(entry.name)) === index)
    .slice(0, MAX_PEOPLE_OF_INTEREST);

  const generated = [];

  for (const person of people) {
    const subject = person.name;
    const focusTopics = person.topics.slice(0, 2);
    const personQueries = [
      { query: `${subject} latest news`, intent: 'personal_match', weight: 0.82 },
      { query: `${subject} official statement`, intent: 'personal_match', weight: 0.8 },
      { query: `${subject} interview`, intent: 'interview_signal', weight: 0.8 },
      ...(focusTopics[0]
        ? [{ query: `${subject} ${focusTopics[0]}`, intent: 'personal_match', weight: 0.78 }]
        : []),
      ...(focusTopics[1]
        ? [{ query: `${subject} ${focusTopics[1]} interview`, intent: 'interview_signal', weight: 0.74 }]
        : []),
    ];

    for (const entry of personQueries.slice(0, MAX_PEOPLE_QUERIES_PER_PERSON)) {
      generated.push({
        ...entry,
        personName: person.name,
        trustTier: person.trustTier,
      });
    }
  }

  return generated
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.query === entry.query) === index)
    .slice(0, MAX_PEOPLE_OF_INTEREST * MAX_PEOPLE_QUERIES_PER_PERSON);
}

function buildSystemManagedQueries(templateState = {}) {
  const templateSignals = buildTemplateSignals(templateState);
  const dynamicQueries = templateSignals
    .flatMap((signal) => {
      const tokens = tokenize(signal).slice(0, 4);
      if (!tokens.length) return [];
      const phrase = tokens.join(' ');
      return [
        { query: `${phrase} youtube`, intent: 'personal_match', weight: 0.72 },
        { query: `${phrase} latest analysis`, intent: 'exploration', weight: 0.58 },
      ];
    })
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.query === entry.query) === index)
    .slice(0, 6);
  return [...SYSTEM_TOPIC_MONITORS, ...buildPeopleOfInterestMonitors(templateState), ...dynamicQueries]
    .slice(0, 22);
}

function getSystemDiscoveryBlueprint() {
  const peopleOfInterest = buildPeopleOfInterestMonitors();
  return {
    trackedChannels: SYSTEM_TRACKED_CHANNELS.map((entry) => ({
      query: entry.query,
      channelId: entry.channelId,
      lane: entry.lane,
      trustTier: Number(entry.trustTier || 3),
    })),
    topicMonitors: SYSTEM_TOPIC_MONITORS.map((entry) => ({
      query: entry.query,
      intent: entry.intent,
      weight: Number(entry.weight || 0.6),
    })),
    peopleOfInterest: peopleOfInterest.map((entry) => ({
      query: entry.query,
      intent: entry.intent,
      weight: Number(entry.weight || 0.7),
      personName: entry.personName || null,
      trustTier: Number(entry.trustTier || 4),
    })),
  };
}

function buildDiscoveryFallbackCandidatesFromAlerts(alerts = [], templateState = {}) {
  const templateSignals = buildTemplateSignals(templateState);
  const labelBoost = templateSignals.length
    ? templateSignals.slice(0, 4).join(' ')
    : '';

  return (Array.isArray(alerts) ? alerts : [])
    .filter((alert) => {
      const publishedAt = normalizeAlertPublishedAt(alert);
      return (alert?.category === 'ai' || alert?.category === 'science')
        && normalizeText(alert.title)
        && normalizeText(alert.url)
        && Boolean(publishedAt)
        && isCandidateWithinDiscoveryWindow({ publishDate: publishedAt });
    })
    .sort((left, right) => {
      const rightPublishedAt = Date.parse(normalizeAlertPublishedAt(right));
      const leftPublishedAt = Date.parse(normalizeAlertPublishedAt(left));
      return (Number.isFinite(rightPublishedAt) ? rightPublishedAt : 0) - (Number.isFinite(leftPublishedAt) ? leftPublishedAt : 0);
    })
    .slice(0, MAX_FALLBACK_AI_ALERTS)
    .map((alert, index) => {
      const companyLabel = normalizeText(alert.release_watch_company_label || alert.release_watch_company || alert.source || alert.sourceLabel || 'AI release watch');
      const sourceLabel = normalizeText(alert.source || alert.sourceLabel || companyLabel || 'AI release watch');
      const sourceHint = normalizeText(alert.source_type || alert.sourceHint || (alert.official_source ? 'official' : 'press')) || 'official';
      const publishedAt = normalizeAlertPublishedAt(alert);
      const summary = normalizeText(
        alert.summary
          || alert.whyItMatters
          || alert.release_watch_reason
          || alert.qualified_reason
          || alert.description
          || sourceLabel
      );
      const topicSeed = `${alert.title} ${summary} ${companyLabel} ${sourceLabel} ${labelBoost}`;
      const tags = [...new Set([
        ...(Array.isArray(alert.topics) ? alert.topics : []),
        ...tokenize(topicSeed).slice(0, 8),
      ])].slice(0, 8);
      const slugSeed = alert.fingerprint || alert.id || `${alert.url || alert.title || 'fallback'}-${index}`;
      const trustTier = alert.official_source ? 5 : (sourceHint === 'official' ? 5 : 4);

      return {
        videoId: `radar:${slugify(slugSeed)}`,
        platform: 'radar',
        contentType: 'article',
        lane: alert.official_source || sourceHint === 'official' ? 'fresh_signal' : 'exploration',
        sourceRef: `radar:${slugify(alert.release_watch_company || alert.source_type || alert.sourceLabel || 'ai')}`,
        sourceUrl: normalizeText(alert.source_url || alert.sourceUrl || alert.publisherUrl || '') || null,
        sourceLabel: companyLabel,
        sourceType: sourceHint,
        title: alert.title,
        url: alert.url,
        thumbnailUrl: alert.thumbnailUrl || alert.thumbnail_url || null,
        publishDate: publishedAt,
        durationSeconds: 0,
        viewCount: 0,
        description: summary,
        transcript: '',
        tags,
        ingestStatus: 'ready',
        transcriptStatus: 'not_requested',
        transcriptProvider: null,
        channelRow: {
          channel_name: sourceLabel,
          channel_url: alert.url,
          trust_tier: trustTier,
          platform: 'radar',
          source_type: sourceHint,
        },
      };
    });
}

function normalizeAlertPublishedAt(alert = {}) {
  const parsed = Date.parse(alert?.publishedAt || alert?.published_at || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function mergeDiscoveryCandidates(dedupedCandidates, candidates = []) {
  for (const candidate of candidates) {
    const existing = dedupedCandidates.get(candidate.videoId);
    if (shouldReplaceCandidate(existing, candidate)) {
      dedupedCandidates.set(candidate.videoId, candidate);
    }
  }
}

function buildFallbackAnalysis(video, scorePack) {
  return {
    summary: normalizeText(video.description || '').slice(0, 220) || `New video from ${video.channelTitle || 'a tracked source'}.`,
    topics: [...new Set([...(video.tags || []), ...tokenize(`${video.title} ${video.description}`).slice(0, 5)])].slice(0, 6),
    scores: {
      depth: scorePack.depthScore,
      rarity: scorePack.rarityScore,
      freshness: scorePack.freshnessScore,
      clickbait: scorePack.clickbaitPenalty,
      timeless: scorePack.timelessScore,
    },
    analysis_provider: null,
    analysis_model: null,
    analysis_error: null,
  };
}

function canUseLiveDiscoveryAi() {
  try {
    const status = aiService.getSafeModelPoolDiagnostics();
    return Number(status.availableKeyCount || 0) > 0 || Boolean(status.openaiConfigured);
  } catch (error) {
    return false;
  }
}

async function buildAnalysisForVideo(video, scorePack) {
  const fallback = buildFallbackAnalysis(video, scorePack);
  if (!canUseLiveDiscoveryAi()) {
    return { ...fallback, analysis_error: 'Live AI provider unavailable; used deterministic fallback.' };
  }
  try {
    const analysis = await aiService.analyzeContent(video.title, video.transcript || '', video.description || '');
    return {
      ...fallback,
      ...analysis,
      scores: { ...fallback.scores, ...(analysis?.scores || {}) },
      topics: Array.isArray(analysis?.topics) && analysis.topics.length ? analysis.topics : fallback.topics,
    };
  } catch (error) {
    return { ...fallback, analysis_error: error.message };
  }
}

function listTrackedChannels(db, userId = '') {
  const scopeKey = normalizeScopeKey(userId);
  try {
    return db.prepare(`
      SELECT *
      FROM youtube_tracked_channels
      WHERE scope_key = ? AND active = 1
      ORDER BY system_managed DESC, trust_tier DESC, channel_name ASC, channel_query ASC
    `).all(scopeKey).map((row) => ({ ...row, active: Boolean(row.active), system_managed: Boolean(row.system_managed), trust_tier: Number(row.trust_tier || 3) }));
  } catch (error) {
    return [];
  }
}

function listTopicMonitors(db, userId = '') {
  const scopeKey = normalizeScopeKey(userId);
  try {
    return db.prepare(`
      SELECT *
      FROM youtube_topic_monitors
      WHERE scope_key = ? AND active = 1
      ORDER BY system_managed DESC, weight DESC, query ASC
    `).all(scopeKey).map((row) => ({ ...row, active: Boolean(row.active), system_managed: Boolean(row.system_managed), weight: Number(row.weight || 0.6) }));
  } catch (error) {
    return [];
  }
}

function listSourceHealth(db, userId = '') {
  const scopeKey = normalizeScopeKey(userId);
  try {
    return db.prepare(`
      SELECT *
      FROM source_health_status
      WHERE scope_key = ?
      ORDER BY platform ASC, lane ASC, updated_at DESC
    `).all(scopeKey).map((row) => ({ ...row, produced_items: Number(row.produced_items || 0), freshness_hours: Number(row.freshness_hours || 999) }));
  } catch (error) {
    return [];
  }
}

function listFeedCandidates(db, userId = '', limit = 60) {
  const scopeKey = normalizeScopeKey(userId);
  try {
    return db.prepare(`
      SELECT *
      FROM feed_candidates
      WHERE scope_key = ?
        AND stale = 0
        AND published_at IS NOT NULL
        AND datetime(published_at) >= datetime('now', ?)
      ORDER BY overall_score DESC, datetime(published_at) DESC
      LIMIT ?
    `).all(
      scopeKey,
      `-${MAX_DISCOVERY_CANDIDATE_AGE_HOURS} hours`,
      Math.max(1, Math.min(Number(limit) || 60, 200))
    );
  } catch (error) {
    return [];
  }
}

function addTrackedChannel(db, userId = '', payload = {}) {
  const scopeKey = normalizeScopeKey(userId);
  const channelQuery = normalizeText(payload.channel_query || payload.channel_name || payload.query);
  const channelId = normalizeText(payload.channel_id);
  const channelKey = buildChannelKey(channelId, channelQuery);
  db.prepare(`
    INSERT INTO youtube_tracked_channels (
      id, scope_key, channel_key, channel_id, channel_query, channel_name, channel_url, lane, trust_tier, active, system_managed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key, channel_key, lane) DO UPDATE SET
      channel_id = COALESCE(excluded.channel_id, youtube_tracked_channels.channel_id),
      channel_query = COALESCE(excluded.channel_query, youtube_tracked_channels.channel_query),
      channel_name = COALESCE(excluded.channel_name, youtube_tracked_channels.channel_name),
      channel_url = COALESCE(excluded.channel_url, youtube_tracked_channels.channel_url),
      trust_tier = excluded.trust_tier,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    scopeKey,
    channelKey,
    channelId || null,
    channelQuery || null,
    normalizeText(payload.channel_name) || null,
    normalizeText(payload.channel_url) || null,
    normalizeText(payload.lane, 'tracked'),
    Math.max(1, Math.min(Number(payload.trust_tier) || 3, 5))
  );
  return listTrackedChannels(db, userId).find((row) => row.channel_key === channelKey) || null;
}

function addTopicMonitor(db, userId = '', payload = {}) {
  const scopeKey = normalizeScopeKey(userId);
  const query = normalizeText(payload.query);
  const queryKey = buildQueryKey(query);
  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key, query_key) DO UPDATE SET
      query = excluded.query,
      intent = excluded.intent,
      weight = excluded.weight,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    scopeKey,
    queryKey,
    query,
    normalizeText(payload.intent, 'personal_match'),
    clamp01(payload.weight, 0.62)
  );
  return listTopicMonitors(db, userId).find((row) => row.query_key === queryKey) || null;
}

function findExistingSystemManagedTrackedChannel(db, scopeKey, lane, label) {
  return db.prepare(`
    SELECT *
    FROM youtube_tracked_channels
    WHERE scope_key = ?
      AND lane = ?
      AND system_managed = 1
      AND active = 1
      AND (
        LOWER(COALESCE(channel_name, '')) = LOWER(?)
        OR LOWER(COALESCE(channel_query, '')) = LOWER(?)
      )
    ORDER BY
      CASE
        WHEN channel_id IS NULL OR channel_id = '' THEN 1
        ELSE 0
      END ASC,
      trust_tier DESC,
      datetime(updated_at) DESC
    LIMIT 1
  `).get(scopeKey, lane, label, label);
}

function findTrackedChannelByKey(db, scopeKey, lane, channelKey, excludeId = '') {
  return db.prepare(`
    SELECT *
    FROM youtube_tracked_channels
    WHERE scope_key = ?
      AND lane = ?
      AND channel_key = ?
      AND (? = '' OR id != ?)
    ORDER BY system_managed DESC, trust_tier DESC, datetime(updated_at) DESC
    LIMIT 1
  `).get(scopeKey, lane, channelKey, excludeId, excludeId);
}

function deactivateTrackedChannelIds(db, ids = []) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!normalizedIds.length) {
    return;
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  db.prepare(`
    UPDATE youtube_tracked_channels
    SET active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(...normalizedIds);
}

function dedupeSystemManagedTrackedChannels(db, scopeKey) {
  const rows = db.prepare(`
    SELECT *
    FROM youtube_tracked_channels
    WHERE scope_key = ? AND system_managed = 1 AND active = 1
    ORDER BY
      CASE
        WHEN channel_id IS NULL OR channel_id = '' THEN 1
        ELSE 0
      END ASC,
      trust_tier DESC,
      datetime(updated_at) DESC
  `).all(scopeKey);

  const seen = new Set();
  const duplicateIds = [];

  for (const row of rows) {
    const key = buildSystemChannelSeedKey(row.lane, row.channel_query || row.channel_name || row.channel_key || row.id);
    if (seen.has(key)) {
      duplicateIds.push(row.id);
      continue;
    }

    seen.add(key);
  }

  deactivateTrackedChannelIds(db, duplicateIds);
}

function deactivateObsoleteSystemManagedTopicMonitors(db, scopeKey, monitors = []) {
  const activeKeys = [...new Set(
    (Array.isArray(monitors) ? monitors : [])
      .map((monitor) => buildQueryKey(monitor?.query))
      .filter(Boolean)
  )];

  if (!activeKeys.length) {
    db.prepare(`
      UPDATE youtube_topic_monitors
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE scope_key = ? AND system_managed = 1 AND active = 1
    `).run(scopeKey);
    return;
  }

  const placeholders = activeKeys.map(() => '?').join(', ');
  db.prepare(`
    UPDATE youtube_topic_monitors
    SET active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE scope_key = ?
      AND system_managed = 1
      AND active = 1
      AND query_key NOT IN (${placeholders})
  `).run(scopeKey, ...activeKeys);
}

function filterRelevantSourceHealthEntries(sourceHealth = [], trackedChannels = [], topicMonitors = [], sourcePacks = []) {
  const sourcePackKeys = sourcePacks.flatMap((pack) => {
    if (!pack.active) {
      return [];
    }
    return (pack.generated_sources || [])
      .filter((source) => source?.id)
      .map((source) => `${pack.lane}:${pack.topic_key}:${source.id}`);
  });
  const activeKeys = new Set([
    ...trackedChannels.map((row) => `${row.lane}:${row.channel_key}`),
    ...topicMonitors.map((row) => `${row.intent}:${row.query_key}`),
    ...sourcePackKeys,
    'fresh_signal:official_ai_release_watch',
  ]);

  const filtered = sourceHealth.filter((row) => activeKeys.has(`${row.lane}:${row.source_key}`));
  return filtered.length ? filtered : sourceHealth;
}

function ensureSeedData(db, userId = '', templateState = {}) {
  const scopeKey = normalizeScopeKey(userId);
  if (scopeKey === PUBLIC_SCOPE) {
    dedupeSystemManagedTrackedChannels(db, scopeKey);

    for (const channel of SYSTEM_TRACKED_CHANNELS) {
      const existing = findExistingSystemManagedTrackedChannel(db, scopeKey, channel.lane, channel.query);
      if (existing) {
        db.prepare(`
          UPDATE youtube_tracked_channels
          SET
            channel_key = COALESCE(channel_key, ?),
            channel_id = COALESCE(channel_id, ?),
            channel_query = COALESCE(channel_query, ?),
            channel_name = COALESCE(channel_name, ?),
            channel_url = COALESCE(channel_url, ?),
            trust_tier = ?,
            active = 1,
            system_managed = 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          buildChannelKey(channel.channelId, channel.query),
          channel.channelId || null,
          channel.query,
          channel.query,
          channel.channelId ? `https://www.youtube.com/channel/${channel.channelId}` : null,
          channel.trustTier,
          existing.id
        );
      } else {
        addTrackedChannel(db, userId, {
          channel_query: channel.query,
          channel_id: channel.channelId,
          lane: channel.lane,
          trust_tier: channel.trustTier,
          channel_name: channel.query,
        });
        db.prepare(`
          UPDATE youtube_tracked_channels
          SET system_managed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE scope_key = ? AND channel_key = ? AND lane = ?
        `).run(scopeKey, buildChannelKey(channel.channelId, channel.query), channel.lane);
      }
    }
    const systemMonitors = buildSystemManagedQueries(templateState);
    for (const monitor of systemMonitors) {
      addTopicMonitor(db, userId, monitor);
      db.prepare(`UPDATE youtube_topic_monitors SET system_managed = 1, updated_at = CURRENT_TIMESTAMP WHERE scope_key = ? AND query_key = ?`)
        .run(scopeKey, buildQueryKey(monitor.query));
    }
    deactivateObsoleteSystemManagedTopicMonitors(db, scopeKey, systemMonitors);
  }
}

function getExistingContentRow(db, externalId) {
  return db.prepare(`
    SELECT *
    FROM content_items
    WHERE external_id = ?
    LIMIT 1
  `).get(externalId);
}

function getInteractionAdjustment(db, scopeKey, sourceId, topicTags = []) {
  if (scopeKey === PUBLIC_SCOPE) {
    return 0;
  }

  try {
    const sourceRows = db.prepare(`
      SELECT ui.action
      FROM user_interactions ui
      JOIN content_items c ON c.id = ui.content_id
      WHERE ui.user_id = ? AND c.source_id = ?
      ORDER BY ui.created_at DESC
      LIMIT 50
    `).all(scopeKey, sourceId);
    let score = 0;
    for (const row of sourceRows) {
      if (POSITIVE_ACTIONS.has(row.action)) score += 0.05;
      if (NEGATIVE_ACTIONS.has(row.action)) score -= 0.08;
    }

    if (topicTags.length) {
      const topicRows = db.prepare(`
        SELECT ui.action, c.topic_tags_json
        FROM user_interactions ui
        JOIN content_items c ON c.id = ui.content_id
        WHERE ui.user_id = ?
        ORDER BY ui.created_at DESC
        LIMIT 120
      `).all(scopeKey);
      for (const row of topicRows) {
        const hits = topicTags.filter((topic) => String(row.topic_tags_json || '').toLowerCase().includes(String(topic).toLowerCase())).length;
        if (!hits) continue;
        if (POSITIVE_ACTIONS.has(row.action)) score += 0.02 * hits;
        if (NEGATIVE_ACTIONS.has(row.action)) score -= 0.03 * hits;
      }
    }

    return Math.max(-0.18, Math.min(0.18, score));
  } catch (error) {
    return 0;
  }
}

function buildCanonicalSourceUrl(candidate = {}, channelRow = {}) {
  const candidatePlatform = normalizeText(candidate.platform, 'youtube').toLowerCase();
  const explicitUrl = normalizeSourceUrl(
    candidate.sourceUrl
      || candidate.channelUrl
      || candidate.canonicalUrl
      || channelRow?.channel_url
      || ''
  );
  if (explicitUrl) {
    return explicitUrl;
  }

  if (candidatePlatform === 'youtube' && normalizeText(candidate.channelId)) {
    return `https://www.youtube.com/channel/${normalizeText(candidate.channelId)}`;
  }

  if (candidatePlatform === 'radar') {
    const radarUrl = normalizeSourceUrl(candidate.url || channelRow?.channel_url || '');
    if (radarUrl) {
      return radarUrl;
    }
  }

  return normalizeSourceUrl(candidate.url || '');
}

function ensureSourceAndCreator(db, candidate, channelRow) {
  const platform = slugify(candidate.platform || channelRow?.platform || 'youtube');
  const sourceSeed = candidate.sourceRef || candidate.channelId || channelRow?.channel_id || candidate.sourceLabel || channelRow?.channel_name || candidate.title || 'unknown';
  const safeKey = slugify(sourceSeed);
  const requestedSourceId = candidate.sourceId || `source_${platform}_${safeKey}`;
  const creatorId = candidate.creatorId || `creator_${platform}_${safeKey}`;
  const channelUrl = buildCanonicalSourceUrl(candidate, channelRow) || null;
  const channelName = candidate.channelTitle || candidate.sourceLabel || channelRow?.channel_name || normalizeText(candidate.title) || 'Discovery source';
  const contentType = normalizeText(candidate.contentType, 'video').toLowerCase();
  const category = normalizeText(
    candidate.sourceCategory || (contentType === 'article' ? 'AI Release Watch' : 'Long-form video'),
    contentType === 'article' ? 'AI Release Watch' : 'Long-form video'
  );
  const existingSource = db.prepare(`
    SELECT *
    FROM sources
    WHERE id = ?
      OR (? IS NOT NULL AND url = ?)
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(requestedSourceId, channelUrl, channelUrl, requestedSourceId);
  let sourceId = existingSource?.id || requestedSourceId;

  try {
    db.prepare(`
      INSERT INTO sources (id, platform, name, url, trust_tier, category, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        name = excluded.name,
        url = COALESCE(excluded.url, sources.url),
        trust_tier = excluded.trust_tier,
        category = COALESCE(excluded.category, sources.category),
        active = 1
    `).run(sourceId, platform, channelName, channelUrl, Number(channelRow?.trust_tier || 3), category);
  } catch (error) {
    if (/UNIQUE constraint failed:\s*sources\.url/i.test(String(error?.message || '')) && channelUrl) {
      const urlCollision = db.prepare(`
        SELECT *
        FROM sources
        WHERE url = ?
        LIMIT 1
      `).get(channelUrl);

      if (urlCollision) {
        db.prepare(`
          UPDATE sources
          SET
            platform = ?,
            name = ?,
            trust_tier = ?,
            category = COALESCE(?, category),
            active = 1
          WHERE id = ?
        `).run(platform, channelName, Number(channelRow?.trust_tier || 3), category, urlCollision.id);
        sourceId = urlCollision.id;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  db.prepare(`
    INSERT INTO creators (id, source_id, name, channel_url, subscriber_count, trust_score, expertise_topics_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      name = excluded.name,
      channel_url = COALESCE(excluded.channel_url, creators.channel_url),
      subscriber_count = COALESCE(excluded.subscriber_count, creators.subscriber_count),
      trust_score = excluded.trust_score,
      expertise_topics_json = COALESCE(excluded.expertise_topics_json, creators.expertise_topics_json)
  `).run(
    creatorId,
    sourceId,
    channelName,
    channelUrl,
    Number(candidate.subscriberCount || 0),
    clamp01(Number(channelRow?.trust_tier || 3) / 5, 0.6),
    JSON.stringify(candidate.tags || [])
  );

  return { sourceId, creatorId };
}

function buildCandidateScorePack(db, candidate, lane, templateState, scopeKey, sourceId, channelRow, analysis) {
  const signals = buildTemplateSignals(templateState);
  const text = `${candidate.title} ${candidate.description} ${(candidate.tags || []).join(' ')}`;
  const personalBase = signals.length
    ? Math.max(...signals.map((signal) => overlapScore(text, signal)))
    : overlapScore(text, 'artificial intelligence productivity business tools strategy');
  const sourceTrust = computeSourceTrust(candidate, channelRow, lane);
  const freshnessScore = computeFreshnessScore(candidate.publishDate);
  const depthScore = computeDepthScore(candidate);
  const timelessScore = computeTimelessScore(candidate);
  const clickbaitPenalty = computeClickbaitPenalty(candidate);
  const interactionAdjustment = getInteractionAdjustment(db, scopeKey, sourceId, analysis?.topics || candidate.tags || []);
  const personalMatchScore = clamp01(personalBase + interactionAdjustment, 0.36);
  const decisionScore = clamp01(
    analysis
      ? ((Number(analysis.scores?.depth || depthScore) + (1 - Number(analysis.scores?.clickbait || clickbaitPenalty))) / 2)
      : ((depthScore + sourceTrust) / 2),
    0.46
  );
  const explorationScore = lane === 'exploration'
    ? 1
    : lane === 'interview_signal'
      ? 0.62
      : lane === 'fresh_signal'
        ? 0.44
        : 0.24;
  const rarityScore = clamp01(1 - Math.min(1, Number(candidate.viewCount || 0) / 600000), 0.24);
  const overallScore = clamp01(
    (0.60 * ((personalMatchScore * 0.62) + (sourceTrust * 0.38)))
    + (0.25 * ((freshnessScore * 0.52) + (decisionScore * 0.48)))
    + (0.15 * explorationScore)
    - (clickbaitPenalty * 0.22),
    0.28
  );

  return {
    sourceTrust,
    freshnessScore,
    depthScore,
    timelessScore,
    clickbaitPenalty,
    personalMatchScore,
    decisionScore,
    explorationScore,
    rarityScore,
    overallScore,
  };
}

function upsertContentItem(db, candidate, analysis, scorePack, channelRow) {
  const existing = getExistingContentRow(db, candidate.videoId);
  const contentId = existing?.id || crypto.randomUUID();
  const { sourceId, creatorId } = ensureSourceAndCreator(db, candidate, channelRow);
  const contentType = normalizeText(candidate.contentType, 'video').toLowerCase();
  const channelType = contentType === 'article'
    || ['radar', 'source_pack'].includes(normalizeText(candidate.platform).toLowerCase())
    ? 'written'
    : 'socialVideo';

  db.prepare(`
    INSERT INTO content_items (
      id, source_id, creator_id, external_id, title, url, thumbnail_url, publish_date,
      duration_seconds, language, view_count, transcript, summary,
      rarity_score, depth_score, trust_score, freshness_score, timeless_score, clickbait_score,
      ingest_status, transcript_status, transcript_provider,
      analysis_provider, analysis_model, analysis_error,
      topic_tags_json, content_type, channel_type, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(external_id) DO UPDATE SET
      source_id = excluded.source_id,
      creator_id = excluded.creator_id,
      title = excluded.title,
      url = excluded.url,
      thumbnail_url = COALESCE(excluded.thumbnail_url, content_items.thumbnail_url),
      publish_date = excluded.publish_date,
      duration_seconds = excluded.duration_seconds,
      view_count = excluded.view_count,
      transcript = COALESCE(excluded.transcript, content_items.transcript),
      summary = COALESCE(excluded.summary, content_items.summary),
      rarity_score = excluded.rarity_score,
      depth_score = excluded.depth_score,
      trust_score = excluded.trust_score,
      freshness_score = excluded.freshness_score,
      timeless_score = excluded.timeless_score,
      clickbait_score = excluded.clickbait_score,
      ingest_status = excluded.ingest_status,
      transcript_status = excluded.transcript_status,
      transcript_provider = excluded.transcript_provider,
      analysis_provider = COALESCE(excluded.analysis_provider, content_items.analysis_provider),
      analysis_model = COALESCE(excluded.analysis_model, content_items.analysis_model),
      analysis_error = excluded.analysis_error,
      topic_tags_json = excluded.topic_tags_json,
      content_type = excluded.content_type,
      channel_type = excluded.channel_type,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    contentId,
    sourceId,
    creatorId,
    candidate.videoId,
    candidate.title,
    candidate.url,
    candidate.thumbnailUrl || null,
    candidate.publishDate || null,
    Number(candidate.durationSeconds || 0),
    Number(candidate.viewCount || 0),
    candidate.transcript || null,
    analysis.summary || null,
    scorePack.rarityScore,
    scorePack.depthScore,
    scorePack.sourceTrust,
    scorePack.freshnessScore,
    scorePack.timelessScore,
    scorePack.clickbaitPenalty,
    candidate.ingestStatus || (candidate.transcript ? 'ready' : 'partial'),
    candidate.transcriptStatus || (candidate.transcript ? 'available' : 'not_requested'),
    candidate.transcriptProvider || null,
    analysis.analysis_provider || null,
    analysis.analysis_model || null,
    analysis.analysis_error || null,
    JSON.stringify(analysis.topics || []),
    contentType,
    channelType
  );

  return contentId;
}

function normalizeWrittenArticleChannels(db) {
  try {
    const result = db.prepare(`
      UPDATE content_items
      SET channel_type = 'written', updated_at = CURRENT_TIMESTAMP
      WHERE content_type = 'article'
        AND COALESCE(channel_type, '') != 'written'
        AND source_id IN (
          SELECT id
          FROM sources
          WHERE platform IN ('radar', 'source_pack', 'written')
        )
    `).run();
    return Number(result.changes || 0);
  } catch (error) {
    return 0;
  }
}

function upsertFeedCandidate(db, scopeKey, contentId, candidate, scorePack, whySelected) {
  const platform = normalizeText(candidate.platform, 'youtube').toLowerCase() || 'youtube';
  db.prepare(`
    INSERT INTO feed_candidates (
      id, scope_key, content_id, external_id, platform, lane, source_ref, source_label, title, url, thumbnail_url,
      published_at, duration_seconds, view_count, source_trust, freshness_score, personal_match_score,
      decision_score, exploration_score, clickbait_penalty, overall_score, why_selected, stale, raw_json, last_seen_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(scope_key, external_id, lane) DO UPDATE SET
      content_id = excluded.content_id,
      source_ref = excluded.source_ref,
      source_label = excluded.source_label,
      title = excluded.title,
      url = excluded.url,
      thumbnail_url = excluded.thumbnail_url,
      published_at = excluded.published_at,
      duration_seconds = excluded.duration_seconds,
      view_count = excluded.view_count,
      source_trust = excluded.source_trust,
      freshness_score = excluded.freshness_score,
      personal_match_score = excluded.personal_match_score,
      decision_score = excluded.decision_score,
      exploration_score = excluded.exploration_score,
      clickbait_penalty = excluded.clickbait_penalty,
      overall_score = excluded.overall_score,
      why_selected = excluded.why_selected,
      stale = 0,
      raw_json = excluded.raw_json,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    scopeKey,
    contentId,
    candidate.videoId,
    platform,
    candidate.lane,
    candidate.sourceRef || candidate.channelId || '',
    candidate.sourceLabel || candidate.channelTitle || '',
    candidate.title,
    candidate.url,
    candidate.thumbnailUrl || null,
    candidate.publishDate || null,
    Number(candidate.durationSeconds || 0),
    Number(candidate.viewCount || 0),
    scorePack.sourceTrust,
    scorePack.freshnessScore,
    scorePack.personalMatchScore,
    scorePack.decisionScore,
    scorePack.explorationScore,
    scorePack.clickbaitPenalty,
    scorePack.overallScore,
    whySelected,
    JSON.stringify(candidate)
  );
}

function upsertSourceHealth(db, scopeKey, {
  lane,
  sourceKey,
  sourceLabel,
  producedItems = 0,
  errorMessage = '',
  metadata = {},
  platform = 'youtube',
  freshnessHours = null,
  lastSuccessAt = null,
}) {
  const hasMeasuredFreshness = freshnessHours !== null
    && freshnessHours !== undefined
    && freshnessHours !== ''
    && Number.isFinite(Number(freshnessHours));
  const resolvedFreshnessHours = hasMeasuredFreshness
    ? Number(Math.max(0, Number(freshnessHours)).toFixed(1))
    : (producedItems > 0 ? 0 : 999);
  const hasFreshDatedItems = Number(producedItems || 0) > 0
    && hasMeasuredFreshness
    && resolvedFreshnessHours <= MAX_DISCOVERY_CANDIDATE_AGE_HOURS;
  db.prepare(`
    INSERT INTO source_health_status (
      id, scope_key, platform, lane, source_key, source_label, status, produced_items, freshness_hours,
      last_checked_at, last_success_at, last_error, metadata_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(scope_key, platform, source_key, lane) DO UPDATE SET
      source_label = excluded.source_label,
      status = excluded.status,
      produced_items = excluded.produced_items,
      freshness_hours = excluded.freshness_hours,
      last_checked_at = CURRENT_TIMESTAMP,
      last_success_at = excluded.last_success_at,
      last_error = excluded.last_error,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    scopeKey,
    platform,
    lane,
    sourceKey,
    sourceLabel || sourceKey,
    errorMessage ? 'error' : (hasFreshDatedItems ? 'live' : 'stale'),
    Number(producedItems || 0),
    resolvedFreshnessHours,
    errorMessage ? null : (lastSuccessAt || new Date().toISOString()),
    errorMessage || null,
    JSON.stringify(metadata || {})
  );
}

function hasTable(db, tableName) {
  try {
    return Boolean(db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(tableName));
  } catch (error) {
    return false;
  }
}

function syncWatchedSourcePackHealth(db, userId = '') {
  if (!hasTable(db, 'source_health_status') || !hasTable(db, 'watched_source_packs')) {
    return { synced: false, sourceCount: 0, packCount: 0 };
  }

  const scopeKey = normalizeScopeKey(userId);
  const packs = listWatchedSourcePacks(db, userId).filter((pack) => pack.active);
  let sourceCount = 0;

  db.prepare(`
    DELETE FROM source_health_status
    WHERE scope_key = ? AND platform = 'source_pack'
  `).run(scopeKey);

  for (const pack of packs) {
    for (const source of pack.generated_sources || []) {
      if (!source?.id) {
        continue;
      }
      sourceCount += 1;
      upsertSourceHealth(db, scopeKey, {
        lane: pack.lane,
        sourceKey: `${pack.topic_key}:${source.id}`,
        sourceLabel: `${pack.topic}: ${source.label || source.id}`,
        producedItems: 0,
        freshnessHours: 999,
        platform: 'source_pack',
        metadata: {
          pack_id: pack.id,
          topic: pack.topic,
          priority: pack.priority,
          source_id: source.id,
          source_url: source.url || null,
          source_type: source.sourceType || null,
          monitor_type: source.monitorType || null,
          watch_for: source.watchFor || [],
          watch_questions: pack.watch_questions || [],
          spider_policy: pack.spider_policy || {},
          interpretation_lenses: pack.interpretation_lenses || [],
          gap_awareness: pack.gap_awareness || [],
          final_theory_feedback: pack.final_theory_feedback || {},
        },
      });
    }
  }

  return { synced: true, sourceCount, packCount: packs.length };
}

function getDiscoveryStatus(db, userId = '') {
  const scopeKey = normalizeScopeKey(userId);
  const trackedChannels = listTrackedChannels(db, userId);
  const topicMonitors = listTopicMonitors(db, userId);
  const sourcePacks = listWatchedSourcePacks(db, userId).filter((pack) => pack.active);
  const sourceHealth = filterRelevantSourceHealthEntries(
    listSourceHealth(db, userId),
    trackedChannels,
    topicMonitors,
    sourcePacks,
  );
  const pipelineHealth = buildDiscoveryPipelineHealth(db, userId);
  let candidateCount = 0;
  let lastRefresh = null;
  try {
    candidateCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM feed_candidates
      WHERE scope_key = ? AND stale = 0
    `).get(scopeKey)?.count || 0);
  } catch (error) {
    candidateCount = 0;
  }
  const liveSources = sourceHealth.filter((entry) => entry.status === 'live').length;
  const staleSources = sourceHealth.filter((entry) => entry.status !== 'live').length;
  const errorSources = sourceHealth.filter((entry) => entry.status === 'error').length;
  const fallbackLiveSources = sourceHealth.filter((entry) => {
    const platform = String(entry.platform || '').toLowerCase();
    return entry.status === 'live' && platform !== 'youtube' && platform !== 'source_pack';
  }).length;
  try {
    lastRefresh = db.prepare(`
      SELECT MAX(updated_at) AS value
      FROM feed_candidates
      WHERE scope_key = ?
    `).get(scopeKey)?.value || null;
  } catch (error) {
    lastRefresh = null;
  }
  const livePipelineCount = Object.entries(pipelineHealth)
    .filter(([key, entry]) => key !== 'source_packs' && entry?.status === 'live')
    .length;
  const hasAnyPipelineData = Object.values(pipelineHealth).some((entry) => {
    if (!entry) {
      return false;
    }

    if (Number(entry.source_count || 0) > 0 || Number(entry.candidate_count || 0) > 0) {
      return true;
    }

    if (entry.coverage && Number(entry.coverage.article_count || 0) > 0) {
      return true;
    }

    return false;
  });
  const hasUsableDiscoveryData = candidateCount > 0 || livePipelineCount > 0 || fallbackLiveSources > 0;
  const hasSourceDegradation = staleSources > 0 || errorSources > 0;

  return {
    scope_key: scopeKey,
    status: hasUsableDiscoveryData
      ? (hasSourceDegradation ? 'partial' : 'live')
      : (trackedChannels.length || topicMonitors.length || sourcePacks.length || hasAnyPipelineData ? 'partial' : 'unavailable'),
    tracked_channel_count: trackedChannels.length,
    topic_monitor_count: topicMonitors.length,
    source_pack_count: sourcePacks.length,
    live_source_count: liveSources,
    stale_source_count: staleSources,
    error_source_count: errorSources,
    candidate_count: candidateCount,
    last_refresh_at: lastRefresh,
    tracked_channels: trackedChannels,
    topic_monitors: topicMonitors,
    source_packs: sourcePacks,
    source_health: sourceHealth,
    pipeline_health: pipelineHealth,
    pipelines: pipelineHealth,
    message: fallbackLiveSources > 0
      ? 'Discovery is refreshing through non-YouTube fallbacks while YouTube searches recover.'
      : sourceHealth.length > 0 && sourceHealth.every((entry) => entry.status === 'error' && /\bquota\b/i.test(entry.last_error || ''))
        ? (candidateCount > 0
            ? 'Discovery is showing cached candidates because the current YouTube quota is exhausted.'
            : 'Discovery is blocked because the current YouTube quota is exhausted.')
        : hasUsableDiscoveryData && hasSourceDegradation
          ? 'Discovery has fresh candidates, but some configured sources are stale or unavailable.'
        : candidateCount > 0 && liveSources > 0
          ? 'YouTube-first discovery is generating ranked candidates.'
          : candidateCount > 0
            ? 'Discovery has cached candidates, but current YouTube source refreshes are failing.'
            : 'Discovery lanes exist, but they have not produced fresh candidates yet.',
  };
}

function buildWhySelected(candidate, scorePack) {
  if (candidate.lane === 'tracked') {
    return 'Tracked channel, high trust, and a strong fit with your current goals.';
  }
  if (candidate.lane === 'fresh_signal') {
    return 'Fresh high-signal discovery with strong timeliness.';
  }
  if (candidate.lane === 'interview_signal') {
    return 'People-of-interest interview discovery with transcript-aware analysis.';
  }
  if (candidate.lane === 'exploration') {
    return 'Exploration pick added to widen coverage without overwhelming the feed.';
  }
  if (candidate.platform === 'source_pack') {
    return 'Matched a watched reference pack and produced a source-constrained event.';
  }
  return 'Matched the current discovery rules and cleared the clickbait filter.';
}

async function resolveTrackedChannel(db, userId, row) {
  if (normalizeText(row.channel_id)) {
    return row;
  }

  const resolved = await youtubeService.resolveChannelByQuery(row.channel_query || row.channel_name || '');
  if (!resolved?.channelId) {
    db.prepare(`UPDATE youtube_tracked_channels SET last_checked_at = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('Unable to resolve channel from YouTube.', row.id);
    return row;
  }

  const channelKey = buildChannelKey(resolved.channelId, row.channel_query || row.channel_name);
  const scopeKey = normalizeScopeKey(userId);
  const collision = findTrackedChannelByKey(db, scopeKey, row.lane, channelKey, row.id);

  if (collision) {
    db.prepare(`
      UPDATE youtube_tracked_channels
      SET
        channel_name = COALESCE(channel_name, ?),
        channel_query = COALESCE(channel_query, ?),
        channel_url = COALESCE(channel_url, ?),
        trust_tier = MAX(trust_tier, ?),
        active = 1,
        last_checked_at = CURRENT_TIMESTAMP,
        last_success_at = CURRENT_TIMESTAMP,
        last_error = '',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      resolved.name || row.channel_name,
      row.channel_query || row.channel_name,
      resolved.url || row.channel_url,
      Number(row.trust_tier || collision.trust_tier || 3),
      collision.id
    );

    db.prepare(`
      UPDATE youtube_tracked_channels
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(row.id);

    return {
      ...collision,
      active: true,
      channel_key: channelKey,
      channel_id: resolved.channelId,
      channel_name: collision.channel_name || resolved.name || row.channel_name,
      channel_query: collision.channel_query || row.channel_query || row.channel_name,
      channel_url: collision.channel_url || resolved.url || row.channel_url,
      trust_tier: Math.max(Number(collision.trust_tier || 3), Number(row.trust_tier || 3)),
      last_error: '',
    };
  }

  db.prepare(`
    UPDATE youtube_tracked_channels
    SET channel_key = ?, channel_id = ?, channel_name = ?, channel_url = ?, last_checked_at = CURRENT_TIMESTAMP,
        last_success_at = CURRENT_TIMESTAMP, last_error = '', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(channelKey, resolved.channelId, resolved.name || row.channel_name, resolved.url || row.channel_url, row.id);

  return { ...row, channel_key: channelKey, channel_id: resolved.channelId, channel_name: resolved.name || row.channel_name, channel_url: resolved.url || row.channel_url };
}

function pruneScope(db, scopeKey) {
  db.prepare(`
    UPDATE feed_candidates
    SET stale = 1, updated_at = CURRENT_TIMESTAMP
    WHERE scope_key = ?
      AND stale = 0
      AND (
        published_at IS NULL
        OR datetime(published_at) < datetime('now', ?)
      )
  `).run(scopeKey, `-${MAX_DISCOVERY_CANDIDATE_AGE_HOURS} hours`);
  db.prepare(`
    DELETE FROM feed_candidates
    WHERE scope_key = ?
      AND (
        (published_at IS NOT NULL AND datetime(published_at) < datetime('now', ?))
        OR (published_at IS NULL AND datetime(created_at) < datetime('now', ?))
      )
  `).run(scopeKey, `-${DISCOVERY_RETENTION_DAYS} days`, `-${DISCOVERY_RETENTION_DAYS} days`);
}

function sanitizeUndatedRadarDerivedContent(db) {
  try {
    const invalidRows = db.prepare(`
      SELECT DISTINCT fc.id AS candidate_id, fc.content_id
      FROM feed_candidates fc
      JOIN priority_alerts pa
        ON pa.title = fc.title
        AND COALESCE(pa.url, '') = COALESCE(fc.url, '')
      WHERE fc.platform = 'radar'
        AND (pa.published_at IS NULL OR TRIM(pa.published_at) = '')
    `).all();

    if (!invalidRows.length) {
      return { candidatesRetired: 0, contentDatesCleared: 0 };
    }

    const candidateIds = invalidRows.map((row) => row.candidate_id).filter(Boolean);
    const contentIds = [...new Set(invalidRows.map((row) => row.content_id).filter(Boolean))];
    const candidatePlaceholders = candidateIds.map(() => '?').join(', ');
    const contentPlaceholders = contentIds.map(() => '?').join(', ');

    const candidateResult = db.prepare(`
      UPDATE feed_candidates
      SET stale = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${candidatePlaceholders})
        AND stale = 0
    `).run(...candidateIds);
    const contentResult = contentIds.length
      ? db.prepare(`
        UPDATE content_items
        SET publish_date = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${contentPlaceholders})
          AND external_id LIKE 'radar:%'
      `).run(...contentIds)
      : { changes: 0 };

    return {
      candidatesRetired: Number(candidateResult.changes || 0),
      contentDatesCleared: Number(contentResult.changes || 0),
    };
  } catch (error) {
    // Partial schemas are used by focused tests; ordinary discovery can continue.
    return { candidatesRetired: 0, contentDatesCleared: 0 };
  }
}

async function refreshDiscoveryForScope(db, { userId = '', templateState = {}, force = false } = {}) {
  const scopeKey = normalizeScopeKey(userId);
  sanitizeUndatedRadarDerivedContent(db);
  normalizeWrittenArticleChannels(db);
  ensureSeedData(db, userId, templateState);
  syncWatchedSourcePackHealth(db, userId);
  const youtubeApiConfigured = youtubeService.hasConfiguredYouTubeApiKey();
  let usedFallbackDiscovery = false;
  let topicRefreshFailed = false;

  let lastRefreshAt = null;
  try {
    lastRefreshAt = db.prepare(`SELECT MAX(updated_at) AS value FROM feed_candidates WHERE scope_key = ?`).get(scopeKey)?.value;
  } catch (error) {
    lastRefreshAt = null;
  }
  if (!force && lastRefreshAt) {
    const lastRefreshMs = Date.parse(lastRefreshAt);
    if (Number.isFinite(lastRefreshMs) && (Date.now() - lastRefreshMs) < DISCOVERY_REFRESH_TTL_MS) {
      const existingStatus = getDiscoveryStatus(db, userId);
      return {
        scope_key: scopeKey,
        refreshed: false,
        candidateCount: existingStatus.candidate_count,
        status: existingStatus.status,
        pipeline_health: existingStatus.pipeline_health,
        pipelines: existingStatus.pipeline_health,
        message: 'Discovery cache is still fresh.',
      };
    }
  }

  const trackedChannels = listTrackedChannels(db, userId);
  const topicMonitors = listTopicMonitors(db, userId);
  const sourcePacks = listWatchedSourcePacks(db, userId).filter((pack) => pack.active);
  const dedupedCandidates = new Map();

  for (const row of trackedChannels) {
    try {
      const resolved = await resolveTrackedChannel(db, userId, row);
      if (!resolved.channel_id) {
        upsertSourceHealth(db, scopeKey, {
          lane: row.lane,
          sourceKey: row.channel_key,
          sourceLabel: row.channel_name || row.channel_query,
          producedItems: 0,
          errorMessage: 'Channel could not be resolved.',
          platform: 'youtube',
        });
        continue;
      }
      const videos = await youtubeService.fetchRecentVideosByChannel(resolved.channel_id, {
        maxResults: MAX_TRACKED_CHANNEL_VIDEOS,
        query: resolved.channel_name || resolved.channel_query || row.channel_name || row.channel_query,
      });
      upsertSourceHealth(db, scopeKey, {
        lane: row.lane,
        sourceKey: resolved.channel_key,
        sourceLabel: resolved.channel_name || resolved.channel_query,
        producedItems: videos.length,
        metadata: { channel_id: resolved.channel_id },
        platform: 'youtube',
        freshnessHours: freshnessHoursFromItems(videos),
      });
      for (const video of videos) {
        dedupedCandidates.set(video.videoId, { ...video, lane: row.lane, sourceRef: resolved.channel_id, sourceLabel: resolved.channel_name || resolved.channel_query || video.channelTitle, channelRow: resolved });
      }
    } catch (error) {
      upsertSourceHealth(db, scopeKey, {
        lane: row.lane,
        sourceKey: row.channel_key,
        sourceLabel: row.channel_name || row.channel_query,
        producedItems: 0,
        errorMessage: error.message,
        platform: 'youtube',
      });
    }
  }

  for (const row of topicMonitors) {
    try {
      const videos = await youtubeService.searchVideos(row.query, { maxResults: MAX_TOPIC_QUERY_VIDEOS });
      upsertSourceHealth(db, scopeKey, {
        lane: row.intent,
        sourceKey: row.query_key,
        sourceLabel: row.query,
        producedItems: videos.length,
        metadata: { query: row.query },
        platform: 'youtube',
        freshnessHours: freshnessHoursFromItems(videos),
      });
      for (const video of videos) {
        const existing = dedupedCandidates.get(video.videoId);
        const candidate = {
          ...video,
          lane: row.intent,
          sourceRef: row.query_key,
          sourceLabel: row.query,
          channelRow: existing?.channelRow || { channel_name: video.channelTitle, trust_tier: row.intent === 'fresh_signal' ? 4 : 3 },
        };
        if (shouldReplaceCandidate(existing, candidate)) {
          dedupedCandidates.set(video.videoId, candidate);
        }
      }
    } catch (error) {
      upsertSourceHealth(db, scopeKey, {
        lane: row.intent,
        sourceKey: row.query_key,
        sourceLabel: row.query,
        producedItems: 0,
        errorMessage: error.message,
        platform: 'youtube',
      });
      topicRefreshFailed = true;
    }
  }

  const sourcePackSources = [];
  for (const pack of sourcePacks) {
    for (const source of pack.generated_sources || []) {
      if (!source?.id || !source?.url) {
        continue;
      }
      sourcePackSources.push({ pack, source });
    }
  }

  for (const entry of sourcePackSources.slice(0, MAX_SOURCE_PACK_SOURCES_PER_REFRESH)) {
    const sourceKey = `${entry.pack.topic_key}:${entry.source.id}`;
    const result = await fetchSourcePackCandidatesForSource(entry.pack, entry.source);
    if (result.candidates.length) {
      upsertSourceHealth(db, scopeKey, {
        lane: entry.pack.lane,
        sourceKey,
        sourceLabel: `${entry.pack.topic}: ${entry.source.label || entry.source.id}`,
        producedItems: result.candidates.length,
        metadata: {
          pack_id: entry.pack.id,
          topic: entry.pack.topic,
          source_id: entry.source.id,
          source_url: entry.source.url || null,
          feed_url: result.feedUrl || null,
          platform: 'source_pack',
        },
        platform: 'source_pack',
        freshnessHours: freshnessHoursFromItems(result.candidates),
      });
      for (const candidate of result.candidates) {
        const existing = dedupedCandidates.get(candidate.videoId);
        if (shouldReplaceCandidate(existing, candidate)) {
          dedupedCandidates.set(candidate.videoId, candidate);
        }
      }
    } else {
      upsertSourceHealth(db, scopeKey, {
        lane: entry.pack.lane,
        sourceKey,
        sourceLabel: `${entry.pack.topic}: ${entry.source.label || entry.source.id}`,
        producedItems: 0,
        errorMessage: result.error || '',
        metadata: {
          pack_id: entry.pack.id,
          topic: entry.pack.topic,
          source_id: entry.source.id,
          source_url: entry.source.url || null,
          feed_url: result.feedUrl || null,
          platform: 'source_pack',
        },
        platform: 'source_pack',
      });
    }
  }

  if (!youtubeApiConfigured || topicRefreshFailed || dedupedCandidates.size === 0) {
    try {
      const radar = await alertRadarService.getPriorityAlerts();
      const fallbackCandidates = buildDiscoveryFallbackCandidatesFromAlerts(radar.alerts || [], templateState);
      if (fallbackCandidates.length) {
        mergeDiscoveryCandidates(dedupedCandidates, fallbackCandidates);
        upsertSourceHealth(db, scopeKey, {
          lane: 'fresh_signal',
          sourceKey: 'official_ai_release_watch',
          sourceLabel: 'Official AI release watch',
          producedItems: fallbackCandidates.length,
          metadata: {
            source: 'alert_radar',
            checkedAt: radar.checkedAt || null,
            cacheAgeMs: radar.cacheAgeMs || 0,
            fallback: true,
            reason: !youtubeApiConfigured ? 'youtube_api_unavailable' : 'youtube_topic_query_failed',
          },
          platform: 'radar',
          freshnessHours: freshnessHoursFromItems(fallbackCandidates),
          lastSuccessAt: radar.checkedAt || null,
        });
        usedFallbackDiscovery = true;
      } else {
        upsertSourceHealth(db, scopeKey, {
          lane: 'fresh_signal',
          sourceKey: 'official_ai_release_watch',
          sourceLabel: 'Official AI release watch',
          producedItems: 0,
          errorMessage: 'Radar fallback did not return any qualifying AI alerts.',
          metadata: {
            source: 'alert_radar',
            checkedAt: radar?.checkedAt || null,
            cacheAgeMs: radar?.cacheAgeMs || 0,
            fallback: true,
            reason: 'no_qualifying_ai_alerts',
          },
          platform: 'radar',
        });
      }
    } catch (error) {
      upsertSourceHealth(db, scopeKey, {
        lane: 'fresh_signal',
        sourceKey: 'official_ai_release_watch',
        sourceLabel: 'Official AI release watch',
        producedItems: 0,
        errorMessage: error.message,
        metadata: {
          source: 'alert_radar',
          fallback: true,
          reason: 'radar_fetch_failed',
        },
        platform: 'radar',
      });
    }
  }

  const candidates = [...dedupedCandidates.values()]
    .filter((candidate) => isCandidateWithinDiscoveryWindow(candidate))
    .sort((left, right) => Date.parse(right.publishDate || 0) - Date.parse(left.publishDate || 0))
    .slice(0, MAX_ACTIVE_DISCOVERY_CANDIDATES);

  let remainingAnalyses = MAX_ANALYSIS_PER_REFRESH;
  for (const candidate of candidates) {
    try {
      const channelRow = candidate.channelRow || {};
      const sourceIds = ensureSourceAndCreator(db, candidate, channelRow);
      let analysis = null;
      const existing = getExistingContentRow(db, candidate.videoId);

      if (existing?.summary) {
        analysis = {
          summary: existing.summary,
          topics: parseJsonList(existing.topic_tags_json, []),
          scores: {
            depth: clamp01(existing.depth_score, 0.5),
            rarity: clamp01(existing.rarity_score, 0.4),
            freshness: clamp01(existing.freshness_score, 0.6),
            clickbait: clamp01(existing.clickbait_score, 0.1),
            timeless: clamp01(existing.timeless_score, 0.4),
          },
          analysis_provider: existing.analysis_provider || null,
          analysis_model: existing.analysis_model || null,
          analysis_error: existing.analysis_error || null,
        };
      }

      let scorePack = buildCandidateScorePack(db, candidate, candidate.lane, templateState, scopeKey, sourceIds.sourceId, channelRow, analysis);
      if (!analysis && remainingAnalyses > 0 && canUseLiveDiscoveryAi()) {
        analysis = await buildAnalysisForVideo(candidate, scorePack);
        remainingAnalyses -= 1;
        scorePack = buildCandidateScorePack(db, candidate, candidate.lane, templateState, scopeKey, sourceIds.sourceId, channelRow, analysis);
      } else if (!analysis) {
        analysis = buildFallbackAnalysis(candidate, scorePack);
      }

      const contentId = upsertContentItem(db, candidate, analysis, scorePack, channelRow);
      upsertFeedCandidate(db, scopeKey, contentId, candidate, scorePack, buildWhySelected(candidate, scorePack));
    } catch (candidateError) {
      // Skip bad candidates — one failing item must not crash the whole cycle
      console.warn(`[discovery] Skipping candidate "${candidate.title || candidate.videoId}": ${candidateError.message}`);
    }
  }

  pruneScope(db, scopeKey);
  const status = getDiscoveryStatus(db, userId);
  return {
    scope_key: scopeKey,
    refreshed: true,
    candidateCount: status.candidate_count,
    trackedChannelCount: status.tracked_channel_count,
    topicMonitorCount: status.topic_monitor_count,
    liveSourceCount: status.live_source_count,
    staleSourceCount: status.stale_source_count,
    errorSourceCount: status.error_source_count,
    status: status.status,
    pipeline_health: status.pipeline_health,
    pipelines: status.pipeline_health,
    used_fallback_discovery: usedFallbackDiscovery,
    message: usedFallbackDiscovery && !/fallback/i.test(status.message || '')
      ? 'Discovery refreshed through non-YouTube fallbacks while YouTube searches were unavailable.'
      : status.message,
  };
}

async function refreshDiscoveryForAllScopes(db, options = {}) {
  const resolveTemplateState = typeof options.resolveTemplateState === 'function'
    ? options.resolveTemplateState
    : () => ({});
  const scopeKeys = new Set([PUBLIC_SCOPE]);
  for (const row of db.prepare(`SELECT id FROM users ORDER BY created_at DESC`).all()) {
    if (normalizeText(row.id)) scopeKeys.add(normalizeText(row.id));
  }

  const results = [];
  for (const scopeKey of scopeKeys) {
    const userId = scopeKey === PUBLIC_SCOPE ? '' : scopeKey;
    const templateState = userId ? await Promise.resolve(resolveTemplateState(userId)) : (options.publicTemplateState || {});
    results.push(await refreshDiscoveryForScope(db, { userId, templateState: templateState || {} }));
  }
  return results;
}

function listWatchedSourcePacks(db, userId = '') {
  const scopeKey = normalizeScopeKey(userId);
  try {
    ensureWatchedSourcePackColumns(db);
    return db.prepare(`
      SELECT *
      FROM watched_source_packs
      WHERE scope_key = ?
      ORDER BY active DESC, updated_at DESC
    `).all(scopeKey).map((row) => ({
      ...row,
      active: Boolean(row.active),
      system_managed: Boolean(row.system_managed),
      watch_questions: parseJsonList(row.watch_questions_json, []),
      generated_sources: parseJsonList(row.generated_sources_json, []),
      spider_policy: parseJsonObject(row.spider_policy_json, buildSourcePackSpiderPolicy(row.topic, row.lane, row.priority)),
      interpretation_lenses: parseJsonList(row.interpretation_lenses_json, buildSourcePackInterpretationLenses(row.topic, row.lane)),
      gap_awareness: parseJsonList(row.gap_awareness_json, buildSourcePackGapAwareness(row.topic, parseJsonList(row.generated_sources_json, []))),
      final_theory_feedback: normalizeFinalTheoryFeedback(parseJsonObject(row.final_theory_feedback_json, {})),
    }));
  } catch (error) {
    return [];
  }
}

async function addWatchedSourcePack(db, userId = '', payload = {}) {
  const scopeKey = normalizeScopeKey(userId);
  ensureWatchedSourcePackColumns(db);
  const topic = normalizeText(payload.topic);
  if (!topic) {
    throw new Error('Topic is required');
  }
  const generatedPack = await generateSourcePackWithAI(topic, {
    lane: payload.lane,
    priority: payload.priority,
    why: payload.why,
    finalTheoryFeedback: payload.finalTheoryFeedback,
  });
  const pack = applySourcePackSelection(generatedPack, payload);

  db.prepare(`
    INSERT INTO watched_source_packs (
      id, scope_key, topic_key, topic, lane, priority, why, watch_questions_json, generated_sources_json,
      spider_policy_json, interpretation_lenses_json, gap_awareness_json, final_theory_feedback_json,
      active, system_managed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key, topic_key) DO UPDATE SET
      topic = excluded.topic,
      lane = excluded.lane,
      priority = excluded.priority,
      why = excluded.why,
      watch_questions_json = excluded.watch_questions_json,
      generated_sources_json = excluded.generated_sources_json,
      spider_policy_json = excluded.spider_policy_json,
      interpretation_lenses_json = excluded.interpretation_lenses_json,
      gap_awareness_json = excluded.gap_awareness_json,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    crypto.randomUUID(),
    scopeKey,
    pack.topic_key,
    pack.topic,
    pack.lane,
    pack.priority,
    pack.why,
    JSON.stringify(pack.watchQuestions),
    JSON.stringify(pack.generatedSources),
    JSON.stringify(pack.spiderPolicy),
    JSON.stringify(pack.interpretationLenses),
    JSON.stringify(pack.gapAwareness),
    JSON.stringify(pack.finalTheoryFeedback),
    payload.active !== undefined ? (payload.active ? 1 : 0) : 1
  );

  syncWatchedSourcePackHealth(db, userId);
  return listWatchedSourcePacks(db, userId).find((row) => row.topic_key === pack.topic_key) || null;
}

function updateWatchedSourcePack(db, userId = '', packId, updates = {}) {
  const scopeKey = normalizeScopeKey(userId);
  ensureWatchedSourcePackColumns(db);
  const existing = db.prepare(`SELECT * FROM watched_source_packs WHERE id = ? AND scope_key = ?`).get(packId, scopeKey);
  if (!existing) {
    throw new Error('Watched source pack not found or access denied');
  }

  const active = updates.active !== undefined ? (updates.active ? 1 : 0) : existing.active;
  const priority = updates.priority !== undefined ? normalizeText(updates.priority).toLowerCase() : existing.priority;
  const why = updates.why !== undefined ? normalizeText(updates.why) : existing.why;
  const existingSources = parseJsonList(existing.generated_sources_json, []);
  const spiderPolicy = updates.priority !== undefined
    ? buildSourcePackSpiderPolicy(existing.topic, existing.lane, priority)
    : parseJsonObject(existing.spider_policy_json, buildSourcePackSpiderPolicy(existing.topic, existing.lane, priority));
  const finalTheoryFeedback = updates.final_theory_feedback !== undefined
    ? normalizeFinalTheoryFeedback({
        ...parseJsonObject(existing.final_theory_feedback_json, {}),
        ...parseJsonObject(updates.final_theory_feedback, updates.final_theory_feedback),
        updated_at: new Date().toISOString(),
      })
    : normalizeFinalTheoryFeedback(parseJsonObject(existing.final_theory_feedback_json, {}));
  const gapAwareness = buildSourcePackGapAwareness(existing.topic, existingSources);

  db.prepare(`
    UPDATE watched_source_packs
    SET active = ?, priority = ?, why = ?, spider_policy_json = ?, gap_awareness_json = ?, final_theory_feedback_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND scope_key = ?
  `).run(
    active,
    priority,
    why,
    JSON.stringify(spiderPolicy),
    JSON.stringify(gapAwareness),
    JSON.stringify(finalTheoryFeedback),
    packId,
    scopeKey
  );

  syncWatchedSourcePackHealth(db, userId);
  return listWatchedSourcePacks(db, userId).find((row) => row.id === packId) || null;
}

module.exports = {
  PUBLIC_SCOPE,
  addTopicMonitor,
  addTrackedChannel,
  getDiscoveryStatus,
  getSystemDiscoveryBlueprint,
  listFeedCandidates,
  listSourceHealth,
  listTopicMonitors,
  listTrackedChannels,
  refreshDiscoveryForAllScopes,
  refreshDiscoveryForScope,
  sanitizeUndatedRadarDerivedContent,
  normalizeWrittenArticleChannels,
  listWatchedSourcePacks,
  addWatchedSourcePack,
  previewWatchedSourcePack,
  updateWatchedSourcePack,
  syncWatchedSourcePackHealth,
  __test__: {
    buildPeopleOfInterestMonitors,
    buildSystemManagedQueries,
    buildDiscoveryFallbackCandidatesFromAlerts,
    ensureSeedData,
    mergeDiscoveryCandidates,
    normalizeWrittenArticleChannels,
    isQuotaLikeErrorMessage,
    isCandidateWithinDiscoveryWindow,
    listFeedCandidates,
    pruneScope,
    sanitizeUndatedRadarDerivedContent,
    upsertSourceHealth,
    upsertContentItem,
  },
};
