const path = require('path');
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.LAMBDA_TASK_ROOT) {
  require('dotenv').config({ path: path.join(__dirname, ['.', 'env'].join('')) });
}
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const rankingEngine = require('./services/rankingEngine');
const youtubeService = require('./services/youtubeService');
const podcastService = require('./services/podcastService');
const redditService = require('./services/redditService');
const xService = require('./services/xService');
const aiService = require('./services/aiService');
const { scrapeInstagramPosts } = require('./src/services/scraperService');
const templateService = require('./src/services/newsTemplateService');
const templateRankingService = require('./src/services/templateRankingService');
const valueHierarchyService = require('./src/services/valueHierarchySync');
const intelligenceContract = require('./src/services/intelligenceContract');
const templateRoutes = require('./src/routes/template');
const alertRoutes = require('./src/routes/alerts');
const discoveryRoutes = require('./src/routes/discovery');
const hierarchyRoutes = require('./src/routes/hierarchy');
const metaInboxRoutes = require('./src/routes/metaInbox');
const anomalyRoutes = require('./src/routes/anomalies');
const radarApiRoutes = require('./src/routes/radarApi');
const cultureRoutes = require('./src/routes/culture');
const opportunitiesRoutes = require('./src/routes/opportunities');
const mailRoutes = require('./src/routes/mail');
const profileVariantsRoutes = require('./src/routes/profileVariants');
const sitesRoutes = require('./src/routes/sites');
const formulationRoutes = require('./src/routes/formulation');
const experienceRoutes = require('./src/routes/experience');
const experimentRoutes = require('./src/routes/experiment');
const musicStatsRoutes = require('./src/routes/musicStats');
const intelligenceRoutes = require('./src/routes/intelligence');
const sharedExperienceRoutes = require('./src/routes/sharedExperience');
const topicRoutes = require('./src/routes/topics');

const {
  getPriorityAlerts,
  selectLatestOfficialReleaseAlerts,
} = require('./src/services/alertRadarService');
const {
  DIRECT_LATEST_RELEASE_COMPANIES,
  isDirectOfficialLabReleaseAlert,
  isPartnerMarketingNewsItem,
  isPlatformAvailabilityNewsItem,
  selectDistinctDirectEvents,
  isVideoOnlyNewsItem,
} = require('./src/services/directFeedQualityService');
const {
  getDiscoveryStatus,
  refreshDiscoveryForScope,
  sanitizeUndatedRadarDerivedContent,
} = require('./src/services/feedDiscoveryService');
const {
  refreshPriorityAlertCache,
} = require('./src/services/priorityAlertStore');
const { runIntelligenceCycle } = require('./src/services/intelligenceCycleService');
const supabaseRuntimeStore = require('./src/services/supabaseRuntimeStore');
const {
  ensureWrittenNewsCoverage,
  getWrittenNewsCoverageState,
  buildWrittenNewsBrief,
} = require('./src/services/writtenNewsService');
const {
  buildActivationReadiness,
  buildSourceReadiness,
  buildSystemReadiness,
  buildVisionReadiness,
} = require('./src/services/readinessService');
const { buildPrivateMessagingReadiness } = require('./src/services/privateMessagingReadinessService');
const {
  probeGoogleAuthProvider,
} = require('./src/services/authProviderReadinessService');
const { validateMetaRuntimeConfig } = require('./src/services/metaInboxService');
const subscriptionService = require('./services/subscriptionService');
const familyService = require('./services/familyService');
const referralService = require('./services/referralService');
const affiliateService = require('./services/affiliateService');
const { startContinuousLoop: startDiscoveryContinuousLoop } = require('./discoveryWorker');
const { ensureSqliteIdealState, syncSqliteUser } = require('./src/db/sqliteBootstrap');
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getBearerToken,
  verifySupabaseAccessToken,
  buildUnauthorizedResponse,
} = require('./src/auth/supabaseAuth');
const { isProtectedRequest } = require('./src/http/routeProtection');
const {
  isAuthorizedAdminRequest,
  feedRefreshAuthRequired,
} = require('./src/auth/adminAuth');
const { createRateLimiter, resolveClientIp, applyRateLimit } = require('./src/http/rateLimit');
const {
  ALERT_WORKER_NAME,
  alreadyDelivered,
  deactivateDeviceToken,
  getNotificationPreferences,
  getPushActivationStatus,
  getWorkerRuntimeStatus,
  hasPushCredentials,
  recordNotificationDelivery,
  sendFcmNotification,
  shouldDeliverPriorityAlert,
  buildNotificationIntentState,
  buildNotificationStatusResponse,
  updateNotificationPreferences,
  updateWorkerRuntimeStatus,
  upsertDeviceToken,
} = require('./src/services/pushDeliveryService');
const {
  dispatchPrivateMessageNotification,
  probePrivateMessengerPushEvidence,
} = require('./src/services/privateMessengerNotificationService');

const fastify = Fastify({
  logger: true,
  trustProxy: false,
  bodyLimit: 1024 * 1024,
});
const DATA_BACKEND = String(process.env.DATA_BACKEND || 'sqlite').toLowerCase();
const PROTECTED_ROUTE_PREFIXES = [
  '/api/v1/interactions',
  '/api/v1/history',
  '/api/v1/saved',
  '/api/v1/alerts/feed',
  '/api/v1/ingest',
  '/api/v1/preferences',
  '/api/v1/sources',
  '/api/v1/collections',
  '/api/v1/subscription',
  '/api/v1/family',
  '/api/v1/referral',
  '/api/v1/affiliate/click',
  '/api/v1/digest',
  '/api/v1/devices',
  '/api/v1/meta',
  '/api/v1/discovery',
  '/api/v1/template',
  '/api/v1/hierarchy',
  '/api/v1/opportunities/saved',
  '/api/v1/opportunities/save',
  '/api/v1/opportunities/unsave',
  '/api/v1/opportunities/labs',
  '/api/v1/mail',
  '/api/v1/profile-variants',
  '/api/v1/sites',
  '/api/v1/formulation',
  '/api/v1/experience',
  '/api/v1/experiment',
  '/api/v1/music',
  '/api/v1/intelligence',
  '/api/v1/topics',
  '/api/v1/source-web',
  '/api/v1/admin',
  '/api/intelligence',
  '/api/events',
  '/api/v1/events',
];
const PUBLIC_EXACT_ROUTES = new Set([
  '/api/v1/health',
  '/api/v1/readiness',
  '/api/v1/sources/status',
  '/api/v1/discovery/source-packs/preview',
  '/api/v1/subscription/tiers',
  '/api/v1/news/brief',
  '/api/v1/automation/news-cycle',
  '/api/v1/meta/oauth/callback',
  '/api/v1/meta/webhook',
  '/api/v1/mail/callback',
]);
const WRITTEN_BRIEF_CACHE_TTL_MS = 15 * 60 * 1000;
const writtenNewsBriefCache = new Map();
const FEED_CACHE_TTL_MS = Number(process.env.FEED_CACHE_TTL_MS || 60 * 1000);
const feedCache = new Map();
// Chat rate limiter: max 20 requests per minute per IP
const chatRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
const feedRefreshRateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 3 });
const newsBriefRefreshRateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 2 });
const PRIMARY_AI_RELEASE_COMPANIES = DIRECT_LATEST_RELEASE_COMPANIES;
// Default companies used when frontend sends no company filter — matches Goal-file primary vendors
const DEFAULT_RELEASE_WATCH_COMPANIES = [...PRIMARY_AI_RELEASE_COMPANIES];
const STRICT_META_RUNTIME = ['1', 'true', 'yes', 'on'].includes(String(process.env.META_STRICT || '').toLowerCase())
  || process.env.NODE_ENV === 'production'
  || DATA_BACKEND === 'postgres';
const EMBED_ALERT_WORKER = ['1', 'true', 'yes', 'on'].includes(String(process.env.EMBED_ALERT_WORKER || '').toLowerCase())
  || (DATA_BACKEND === 'sqlite' && String(process.env.EMBED_ALERT_WORKER || '').toLowerCase() !== 'false');
const EMBED_DISCOVERY_WORKER = ['1', 'true', 'yes', 'on'].includes(String(process.env.EMBED_DISCOVERY_WORKER || '').toLowerCase())
  || (DATA_BACKEND === 'sqlite' && String(process.env.EMBED_DISCOVERY_WORKER || '').toLowerCase() !== 'false');
const EXPOSE_API_ERROR_DETAILS = ['1', 'true', 'yes', 'on'].includes(String(process.env.EXPOSE_API_ERROR_DETAILS || '').toLowerCase());
const API_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
});

function normalizeCorsOrigin(origin = '') {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function buildAllowedCorsOrigins() {
  const configuredOrigins = String(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
    .split(',')
    .map((entry) => normalizeCorsOrigin(entry))
    .filter(Boolean);
  const defaults = [
    normalizeCorsOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    'https://explore-two-rho.vercel.app',
    'https://localhost',
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
    'capacitor://localhost',
    'ionic://localhost',
  ].filter(Boolean);

  return [...new Set([...configuredOrigins, ...defaults])];
}

const allowedCorsOrigins = buildAllowedCorsOrigins();
const allowAnyCorsOrigin = allowedCorsOrigins.length === 0 && process.env.NODE_ENV !== 'production';

function isCorsOriginAllowed(origin = '') {
  const normalizedOrigin = normalizeCorsOrigin(origin);
  return Boolean(normalizedOrigin && allowedCorsOrigins.includes(normalizedOrigin));
}

// Configure CORS
fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin || origin === 'null') {
      callback(null, true);
      return;
    }

    if (allowAnyCorsOrigin || isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
});



function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
}

function resolveWritableBackendPath(fileName) {
  const configuredRoot = process.env.EXPLORE_RUNTIME_DIR || process.env.XDG_RUNTIME_DIR || '';
  const runtimeRoot = configuredRoot || (isServerlessRuntime() ? path.join('/tmp', 'explore-backend') : __dirname);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return path.join(runtimeRoot, fileName);
}

function resolveSqliteDatabasePath() {
  const configuredPath = process.env.SQLITE_DB_PATH || process.env.EXPLORE_SQLITE_DB_PATH || '';
  if (configuredPath) {
    fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
    return configuredPath;
  }

  if (!isServerlessRuntime()) {
    return path.join(__dirname, ['explore', 'db'].join('.'));
  }

  return resolveWritableBackendPath(['explore', 'db'].join('.'));
}

// SQLite Database connection
const db = new Database(resolveSqliteDatabasePath());
db.pragma(isServerlessRuntime() ? 'journal_mode = DELETE' : 'journal_mode = WAL');
ensureSqliteIdealState(db);
sanitizeUndatedRadarDerivedContent(db);
templateService.ensureTables(db);
templateRankingService.ensureContentAnalysisColumns(db);
valueHierarchyService.ensureTables(db);
require('./src/services/intelligenceContract').ensureTables(db);
require('./src/services/topicService').ensureTables(db);
fs.mkdirSync(resolveWritableBackendPath(path.join('uploads', 'visuals')), { recursive: true });

// ─── Global Request Hook: Authentication ─────────────────────────────
fastify.addHook('onRequest', async (request, reply) => {
  const authHeader = request.headers.authorization || '';
  const token = getBearerToken(authHeader);

  request.user = null;

  if (token) {
    try {
      const user = await verifySupabaseAccessToken(token);
      if (user) {
        request.user = user;
        syncSqliteUser(db, user);
      }
    } catch (err) {
      request.log.error(err, 'Token verification failed');
    }
  }

  const isProtected = isProtectedRequest(request.url, PROTECTED_ROUTE_PREFIXES, PUBLIC_EXACT_ROUTES);

  if (isProtected && !request.user) {
    return buildUnauthorizedResponse(reply, 'Authentication required.');
  }
});

// ─── Plugin Route Registrations (require db) ─────────────────────────
fastify.register(alertRoutes,     { prefix: '/api/v1/alerts',    db });
fastify.register(templateRoutes,  { prefix: '/api/v1/template',  db });
fastify.register(cultureRoutes,   { prefix: '/api/v1/culture',   db });
fastify.register(discoveryRoutes, { prefix: '/api/v1/discovery', db });
fastify.register(anomalyRoutes,   { prefix: '/api/v1/anomalies', db });
fastify.register(hierarchyRoutes, { prefix: '/api/v1/hierarchy', db });
fastify.register(metaInboxRoutes, { prefix: '/api/v1/meta',      db });
fastify.register(opportunitiesRoutes, { prefix: '/api/v1/opportunities', db });
fastify.register(mailRoutes, { prefix: '/api/v1/mail', db });
fastify.register(profileVariantsRoutes, { prefix: '/api/v1/profile-variants', db });
fastify.register(sitesRoutes, { prefix: '/api/v1/sites', db });
fastify.register(formulationRoutes, { prefix: '/api/v1/formulation', db });
fastify.register(experienceRoutes, { prefix: '/api/v1/experience', db });
fastify.register(experimentRoutes, { prefix: '/api/v1/experiment', db });
fastify.register(musicStatsRoutes, { prefix: '/api/v1/music', db });
fastify.register(sharedExperienceRoutes, { prefix: '/api/v1/shared', db });
fastify.register(intelligenceRoutes, { db });
fastify.register(topicRoutes, { db });

function getConfiguredPublicAppUrl() {
  const raw = String(
    process.env.EXPLORE_PUBLIC_APP_URL
    || process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || ''
  ).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.origin + url.pathname.replace(/\/$/, '');
  } catch (_) { return ''; }
}

function buildInstagramCaption(post) {
  const caption = post.caption || post.text || '';
  if (caption) return caption.split('\n')[0].slice(0, 120);
  const username = post.ownerUsername ? ('@' + post.ownerUsername) : post.ownerFullName || 'Instagram creator';
  return 'Instagram post by ' + username;
}

function buildFallbackAnalysis(title, body, fallbackTopics) {
  body = body || '';
  fallbackTopics = fallbackTopics || [];
  const safeBody = String(body).trim();
  return {
    summary: safeBody.slice(0, 220) || title,
    reason: 'Imported into your feed.',
    topics: Array.isArray(fallbackTopics) ? fallbackTopics.slice(0, 6) : [],
    scores: { rarity: 0.42, depth: 0.52, freshness: 0.7, timeless: 0.48, clickbait: 0.12 },
    analysis_provider: null,
    analysis_model: null,
    analysis_error: null,
  };
}

async function analyzeImportedContent(title, body, fallbackTopics) {
  body = body || '';
  fallbackTopics = fallbackTopics || [];
  const fallback = buildFallbackAnalysis(title, body, fallbackTopics);
  try {
    const analysis = await aiService.analyzeContent(title, body, body);
    return {
      ...fallback,
      ...analysis,
      reason: analysis?.reason || fallback.reason,
      topics: Array.isArray(analysis?.topics) && analysis.topics.length ? analysis.topics : fallback.topics,
      scores: {
        ...fallback.scores,
        ...(analysis?.scores || {}),
      },
    };
  } catch (error) {
    return {
      ...fallback,
      analysis_error: error.message,
    };
  }
}

async function buildImportedEmbedding(title, summary = '') {
  try {
    return await aiService.generateEmbeddingWithMetadata(`${title}. ${summary}`.trim());
  } catch (error) {
    return {
      values: [],
      embedding_provider: null,
      embedding_model: null,
      embedding_error: error.message,
    };
  }
}

function getReasonType(scores) {
  if (!scores) return 'general';
  let maxType = 'general';
  let maxVal = -1;
  for (const [key, val] of Object.entries(scores)) {
    const num = Number(val || 0);
    if (num > maxVal) {
      maxVal = num;
      maxType = key;
    }
  }
  return maxType;
}

function buildSourceId(platform, name) {
  const cleanPlatform = String(platform || '').toLowerCase().trim();
  const cleanName = String(name || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
  return `${cleanPlatform}_${cleanName}`;
}

function normalizeDate(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}

function buildInstagramTitle(post) {
  const name = post.ownerFullName || post.ownerUsername || 'Instagram Post';
  const caption = String(post.caption || '').trim();
  const truncated = caption ? (caption.length > 50 ? caption.slice(0, 47) + '...' : caption) : 'Photo/Video';
  return `${name}: ${truncated}`;
}

function pickFirstCount(...args) {
  for (const arg of args) {
    const val = Number(arg);
    if (Number.isFinite(val) && val >= 0) {
      return Math.round(val);
    }
  }
  return null;
}

function buildTranscriptPreview(text, maxChars = 420) {
  if (!text) return '';
  const clean = text.replace(/\[\d+:\d+\]\s*/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars) + '...';
}

function normalizeNullableId(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const str = String(value).trim();
  if (!str || str.toLowerCase() === 'null') return null;
  return str;
}

function assertOwnedCollection(userId, collectionId) {
  if (!collectionId) return;
  const row = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(collectionId);
  if (!row) {
    const err = new Error('Collection not found.');
    err.statusCode = 404;
    throw err;
  }
  if (row.user_id !== userId) {
    const err = new Error('Access denied to collection.');
    err.statusCode = 403;
    throw err;
  }
}

function insertRecommendationReason(contentId, analysis) {
  db.prepare(`
    INSERT INTO recommendation_reasons (id, content_id, user_id, reason_type, reason_text, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `rsn_${contentId}`,
    contentId,
    null,
    getReasonType(analysis?.scores || {}),
    analysis?.reason || 'Imported into your feed.',
    Math.max(
      Number(analysis?.scores?.depth || 0),
      Number(analysis?.scores?.rarity || 0),
      Number(analysis?.scores?.freshness || 0),
      Number(analysis?.scores?.timeless || 0),
    ),
  );
}

function storeImportedContentItem({
  platform,
  sourceName,
  sourceUrl,
  externalId,
  title,
  url,
  thumbnailUrl = null,
  publishDate = '',
  durationSeconds = null,
  viewCount = null,
  transcript = '',
  analysis,
  embedding,
  topicTags = [],
  contentType = 'video',
  transcriptStatus = 'summary_only',
  transcriptProvider = null,
}) {
  const sourceId = buildSourceId(platform, sourceName);
  const contentId = crypto.randomUUID();
  const ingestStatus = embedding?.embedding_error ? 'partial' : 'ready';

  db.prepare(`
    INSERT OR IGNORE INTO sources (id, platform, name, url)
    VALUES (?, ?, ?, ?)
  `).run(sourceId, platform, sourceName, sourceUrl);

  db.prepare(`
    INSERT INTO content_items (
      id, source_id, external_id, title, url, thumbnail_url, publish_date,
      duration_seconds, view_count, transcript, summary, embedding_json,
      rarity_score, depth_score, freshness_score, timeless_score, clickbait_score,
      ingest_status, transcript_status, transcript_provider,
      analysis_provider, analysis_model, analysis_error,
      embedding_provider, embedding_model, embedding_error,
      topic_tags_json, content_type, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).run(
    contentId,
    sourceId,
    externalId,
    title,
    url,
    thumbnailUrl,
    normalizeDate(publishDate),
    durationSeconds,
    viewCount,
    transcript,
    analysis?.summary || title,
    JSON.stringify(embedding?.values || []),
    Number(analysis?.scores?.rarity || 0.42),
    Number(analysis?.scores?.depth || 0.52),
    Number(analysis?.scores?.freshness || 0.7),
    Number(analysis?.scores?.timeless || 0.48),
    Number(analysis?.scores?.clickbait || 0.12),
    ingestStatus,
    transcriptStatus,
    transcriptProvider,
    analysis?.analysis_provider || null,
    analysis?.analysis_model || null,
    analysis?.analysis_error || null,
    embedding?.embedding_provider || null,
    embedding?.embedding_model || null,
    embedding?.embedding_error || null,
    JSON.stringify(topicTags),
    contentType,
  );

  insertRecommendationReason(contentId, analysis);
  return contentId;
}

async function ingestPodcastFeed(url) {
  const payload = await podcastService.fetchPodcastFeed(url, 8);
  const items = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const episode of payload.items) {
    const externalId = `pod_${crypto.createHash('sha1').update(episode.url).digest('hex').slice(0, 16)}`;
    const existingRow = getContentRowByIdOrExternalId(externalId);
    if (existingRow) {
      existingCount += 1;

      if (items.length < 3) {
        const existingItem = mapItem(existingRow);
        existingItem.reason = rankingEngine.generateReason(existingItem);
        items.push(existingItem);
      }
      continue;
    }

    const analysis = await analyzeImportedContent(episode.title, episode.description, [payload.sourceName, 'podcast']);
    const embedding = await buildImportedEmbedding(episode.title, analysis.summary);
    const contentId = storeImportedContentItem({
      platform: 'podcast',
      sourceName: payload.sourceName,
      sourceUrl: payload.sourceUrl,
      externalId,
      title: episode.title,
      url: episode.canonicalUrl || episode.url,
      thumbnailUrl: episode.imageUrl || payload.imageUrl || null,
      publishDate: episode.publishDate,
      durationSeconds: null,
      transcript: episode.description || '',
      analysis,
      embedding,
      topicTags: analysis.topics,
      contentType: 'video',
      transcriptStatus: episode.description ? 'description_only' : 'missing',
      transcriptProvider: 'podcast-rss',
    });

    createdCount += 1;

    if (items.length < 3) {
      const row = getContentRowByIdOrExternalId(contentId);
      if (row) {
        const item = mapItem(row);
        item.reason = analysis.reason;
        items.push(item);
      }
    }
  }

  return {
    created: createdCount > 0,
    createdCount,
    existingCount,
    items,
  };
}

async function ingestRedditSource(input) {
  const payload = await redditService.fetchSubredditPosts(input, 10);
  const items = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const post of payload.posts) {
    const externalId = `reddit_${post.id}`;
    const existingRow = getContentRowByIdOrExternalId(externalId);
    if (existingRow) {
      existingCount += 1;

      if (items.length < 3) {
        const existingItem = mapItem(existingRow);
        existingItem.reason = rankingEngine.generateReason(existingItem);
        items.push(existingItem);
      }
      continue;
    }

    const analysis = await analyzeImportedContent(post.title, post.body, [post.subreddit, 'reddit']);
    const embedding = await buildImportedEmbedding(post.title, analysis.summary);
    const contentType = post.imageUrl ? 'image' : 'video';
    const contentId = storeImportedContentItem({
      platform: 'reddit',
      sourceName: `r/${post.subreddit}`,
      sourceUrl: payload.target.canonicalUrl,
      externalId,
      title: post.title,
      url: post.outboundUrl || post.permalink,
      thumbnailUrl: post.imageUrl || post.thumbnailUrl || null,
      publishDate: post.publishDate,
      viewCount: Math.max(post.score, post.commentCount),
      transcript: post.body,
      analysis,
      embedding,
      topicTags: analysis.topics,
      contentType,
      transcriptStatus: post.body ? 'body_only' : 'missing',
      transcriptProvider: 'reddit-api',
    });

    createdCount += 1;

    if (items.length < 3) {
      const row = getContentRowByIdOrExternalId(contentId);
      if (row) {
        const item = mapItem(row);
        item.reason = analysis.reason;
        items.push(item);
      }
    }
  }

  return {
    created: createdCount > 0,
    createdCount,
    existingCount,
    items,
  };
}

async function ingestXSource(input) {
  const payload = await xService.fetchProfilePosts(input, 10);
  const items = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const post of payload.posts) {
    const externalId = `x_${post.id}`;
    const existingRow = getContentRowByIdOrExternalId(externalId);
    if (existingRow) {
      existingCount += 1;

      if (items.length < 3) {
        const existingItem = mapItem(existingRow);
        existingItem.reason = rankingEngine.generateReason(existingItem);
        items.push(existingItem);
      }
      continue;
    }

    const analysis = await analyzeImportedContent(post.text, post.text, [payload.username, 'x']);
    const embedding = await buildImportedEmbedding(post.text, analysis.summary);
    const contentType = post.imageUrl ? 'image' : 'video';
    const contentId = storeImportedContentItem({
      platform: 'x',
      sourceName: `@${payload.username}`,
      sourceUrl: payload.profileUrl,
      externalId,
      title: post.text.split('\n')[0].slice(0, 140) || `Post by @${payload.username}`,
      url: post.profileUrl,
      thumbnailUrl: post.imageUrl || payload.profileImageUrl || null,
      publishDate: post.publishDate,
      transcript: post.text,
      analysis,
      embedding,
      topicTags: analysis.topics,
      contentType,
      transcriptStatus: post.text ? 'text_only' : 'missing',
      transcriptProvider: 'x-api',
    });

    createdCount += 1;

    if (items.length < 3) {
      const row = getContentRowByIdOrExternalId(contentId);
      if (row) {
        const item = mapItem(row);
        item.reason = analysis.reason;
        items.push(item);
      }
    }
  }

  return {
    created: createdCount > 0,
    createdCount,
    existingCount,
    items,
  };
}

async function ingestYouTubeUrl(url) {
  const videoData = await youtubeService.fetchVideoData(url);
  if (!videoData) {
    throw new Error('Unable to fetch YouTube metadata for that URL.');
  }

  const existingRow = getContentRowByIdOrExternalId(videoData.videoId);
  if (existingRow) {
    const existingItem = mapItem(existingRow);
    existingItem.reason = rankingEngine.generateReason(existingItem);
    return { created: false, item: existingItem };
  }

  const analysis = await aiService.analyzeContent(
    videoData.title,
    videoData.transcript,
    videoData.description
  );
  const embedding = await aiService.generateEmbeddingWithMetadata(`${videoData.title}. ${analysis.summary}`);
  const sourceId = buildSourceId('youtube', videoData.channelTitle);
  const contentId = crypto.randomUUID();
  const ingestStatus = embedding.embedding_error
    ? 'partial'
    : (videoData.ingestStatus || (videoData.transcript ? 'ready' : 'partial'));

  db.prepare(`
    INSERT OR IGNORE INTO sources (id, platform, name, url)
    VALUES (?, 'youtube', ?, ?)
  `).run(sourceId, videoData.channelTitle, `https://www.youtube.com/channel/${videoData.channelId}`);

  db.prepare(`
    INSERT INTO content_items (
      id, source_id, external_id, title, url, thumbnail_url, publish_date,
      duration_seconds, view_count, transcript, summary, embedding_json,
      rarity_score, depth_score, freshness_score, timeless_score, clickbait_score,
      ingest_status, transcript_status, transcript_provider,
      analysis_provider, analysis_model, analysis_error,
      embedding_provider, embedding_model, embedding_error,
      topic_tags_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).run(
    contentId,
    sourceId,
    videoData.videoId,
    videoData.title,
    url,
    videoData.thumbnailUrl,
    videoData.publishDate,
    videoData.durationSeconds,
    videoData.viewCount,
    videoData.transcript,
    analysis.summary,
    JSON.stringify(embedding.values || []),
    analysis.scores.rarity,
    analysis.scores.depth,
    analysis.scores.freshness,
    analysis.scores.timeless,
    analysis.scores.clickbait,
    ingestStatus,
    videoData.transcriptStatus || (videoData.transcript ? 'available' : 'missing'),
    videoData.transcriptProvider || null,
    analysis.analysis_provider || null,
    analysis.analysis_model || null,
    analysis.analysis_error || null,
    embedding.embedding_provider || null,
    embedding.embedding_model || null,
    embedding.embedding_error || null,
    JSON.stringify(analysis.topics || [])
  );

  db.prepare(`
    INSERT INTO recommendation_reasons (id, content_id, user_id, reason_type, reason_text, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `rsn_${contentId}`,
    contentId,
    null,
    analysis.scores.freshness > 0.7 ? 'new' : analysis.scores.rarity > 0.7 ? 'old' : analysis.scores.depth > 0.8 ? 'deep' : 'care',
    analysis.reason,
    Math.max(analysis.scores.depth, analysis.scores.rarity, analysis.scores.freshness, analysis.scores.timeless)
  );

  const row = getContentRowByIdOrExternalId(contentId);
  const item = mapItem(row);
  item.reason = analysis.reason;
  return { created: true, item };
}

async function ingestInstagramUrl(url) {
  const posts = await scrapeInstagramPosts(url, 5);
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error('No Instagram posts were found for that URL.');
  }

  const items = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const post of posts) {
    const externalId = post.id ? `ig_${post.id}` : post.shortCode ? `ig_${post.shortCode}` : '';
    if (!externalId) {
      continue;
    }

    const existingRow = getContentRowByIdOrExternalId(externalId);
    if (existingRow) {
      existingCount += 1;

      if (items.length < 3) {
        const existingItem = mapItem(existingRow);
        existingItem.reason = rankingEngine.generateReason(existingItem);
        items.push(existingItem);
      }
      continue;
    }

    const username = post.ownerUsername || post.ownerFullName || 'instagram';
    const sourceId = buildSourceId('instagram', username);
    const title = buildInstagramTitle(post);
    const description = String(post.caption || '').trim();
    const analysis = await aiService.analyzeContent(title, description, description);
    const embedding = await aiService.generateEmbeddingWithMetadata(`${title}. ${description} ${analysis.summary}`);
    const contentId = crypto.randomUUID();
    const postUrl = post.url || post.inputUrl || `https://www.instagram.com/${post.ownerUsername || ''}`.replace(/\/+$/, '/');
    const sourceUrl = post.inputUrl || (post.ownerUsername ? `https://www.instagram.com/${post.ownerUsername}/` : postUrl);
    const topicTags = Array.isArray(analysis.topics) && analysis.topics.length
      ? analysis.topics
      : Array.isArray(post.hashtags)
        ? post.hashtags.slice(0, 5)
        : [];
    const contentType = String(post.type || '').toLowerCase().includes('video') || post.videoUrl ? 'video' : 'image';
    const ingestStatus = embedding.embedding_error ? 'partial' : 'ready';

    db.prepare(`
      INSERT OR IGNORE INTO sources (id, platform, name, url)
      VALUES (?, 'instagram', ?, ?)
    `).run(sourceId, username, sourceUrl);

    db.prepare(`
      INSERT INTO content_items (
        id, source_id, external_id, title, url, thumbnail_url, publish_date,
        duration_seconds, view_count, transcript, summary, embedding_json,
        rarity_score, depth_score, freshness_score, timeless_score, clickbait_score,
        ingest_status, transcript_status, transcript_provider,
        analysis_provider, analysis_model, analysis_error,
        embedding_provider, embedding_model, embedding_error,
        topic_tags_json, content_type, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run(
      contentId,
      sourceId,
      externalId,
      title,
      postUrl,
      post.displayUrl || post.thumbnailUrl || null,
      normalizeDate(post.timestamp),
      Number.isFinite(Number(post.videoDuration)) ? Math.round(Number(post.videoDuration)) : null,
      pickFirstCount(post.videoPlayCount, post.videoViewCount, post.likesCount, post.commentsCount),
      description,
      analysis.summary,
      JSON.stringify(embedding.values || []),
      analysis.scores.rarity,
      analysis.scores.depth,
      analysis.scores.freshness,
      analysis.scores.timeless,
      analysis.scores.clickbait,
      ingestStatus,
      description ? 'caption_only' : 'missing',
      'instagram-caption',
      analysis.analysis_provider || null,
      analysis.analysis_model || null,
      analysis.analysis_error || null,
      embedding.embedding_provider || null,
      embedding.embedding_model || null,
      embedding.embedding_error || null,
      JSON.stringify(topicTags),
      contentType
    );

    db.prepare(`
      INSERT INTO recommendation_reasons (id, content_id, user_id, reason_type, reason_text, score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `rsn_${contentId}`,
      contentId,
      null,
      getReasonType(analysis.scores),
      analysis.reason,
      Math.max(analysis.scores.depth, analysis.scores.rarity, analysis.scores.freshness, analysis.scores.timeless)
    );

    createdCount += 1;

    if (items.length < 3) {
      const row = getContentRowByIdOrExternalId(contentId);
      if (row) {
        const item = mapItem(row);
        item.reason = analysis.reason;
        items.push(item);
      }
    }
  }

  return {
    created: createdCount > 0,
    createdCount,
    existingCount,
    items,
  };
}

function getTemplateContextForRequest(request) {
  const userId = request.user?.id || 'guest';
  const templateState = templateService.getTemplateState(db, userId);
  return { userId, templateState };
}

async function refreshBestFeedForRequest(request, templateState, options = {}) {
  const userId = request.user?.id || 'guest';
  return refreshDiscoveryForScope(db, { userId, templateState, force: options.force });
}

async function refreshLiveFeedInputsForRequest(request, templateState, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 12000);
  const refreshTasks = [
    ensureWrittenNewsCoverage(db, { force: Boolean(options.force) }),
  ];

  // The direct Latest News screen is built from written sources and radar alerts.
  // Do not hold it behind unrelated YouTube/discovery work on a cold start.
  if (options.includeDiscovery !== false) {
    refreshTasks.push(
      refreshBestFeedForRequest(request, templateState, { force: Boolean(options.force) })
    );
  }

  return Promise.race([
    Promise.allSettled(refreshTasks),
    new Promise((resolve) => setTimeout(() => resolve([{ status: 'timed_out' }]), timeoutMs)),
  ]);
}

function buildFeedRefreshEvidence({ mode = 'none', results = null } = {}) {
  const entries = Array.isArray(results) ? results : [];
  const timedOut = entries.some((entry) => entry?.status === 'timed_out');
  const failedTaskCount = entries.filter((entry) => entry?.status === 'rejected').length;
  const completedTaskCount = entries.filter((entry) => entry?.status === 'fulfilled').length;
  const recalculationAttempted = mode === 'forced' || mode === 'automatic';

  return {
    requested: mode === 'forced',
    recalculation_attempted: recalculationAttempted,
    recalculated: recalculationAttempted && !timedOut && completedTaskCount > 0,
    source: mode === 'forced'
      ? 'forced_live_recalculation'
      : mode === 'automatic'
        ? 'automatic_live_refresh'
        : 'live_backend',
    status: timedOut || failedTaskCount > 0 ? 'partial' : 'completed',
    completed_task_count: completedTaskCount,
    failed_task_count: failedTaskCount,
    timed_out: timedOut,
    completed_at: new Date().toISOString(),
  };
}

// ─── API ROUTES ──────────────────────────────────────────────────────

// ─── Helper: parse alert limit from query ────────────────────────────
function parseAlertLimit(raw, defaultVal = 12) {
  const parsed = parseInt(String(raw || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 40) : defaultVal;
}

// ─── Helper: parse company selection from comma-delimited string ─────
function parseCompanySelection(raw = '') {
  return String(raw || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Helper: extract latest-news items from a template feed ──────────
function pickLatestNewsDate(item = {}) {
  return item.date
    || item.publishedAt
    || item.published_at
    || item.publishDate
    || item.publish_date
    || '';
}

function getLatestNewsTime(item = {}) {
  const parsed = Date.parse(String(pickLatestNewsDate(item) || '').trim());
  return Number.isNaN(parsed) ? 0 : parsed;
}

const MAX_VISIBLE_NEWS_AGE_HOURS = 72;

function getLatestNewsAgeHours(item = {}) {
  const timestamp = getLatestNewsTime(item);
  if (!timestamp) return Infinity;
  return Math.max(0, (Date.now() - timestamp) / 36e5);
}

function isVisibleFreshNewsItem(item = {}) {
  return getLatestNewsAgeHours(item) <= MAX_VISIBLE_NEWS_AGE_HOURS;
}

function compareLatestNewsItems(left = {}, right = {}) {
  const timeDiff = getLatestNewsTime(right) - getLatestNewsTime(left);
  if (timeDiff !== 0) return timeDiff;

  const leftStable = `${left.source || ''}:${left.title || ''}:${left.url || ''}`;
  const rightStable = `${right.source || ''}:${right.title || ''}:${right.url || ''}`;
  return leftStable.localeCompare(rightStable);
}

function getPriorityAlertsWithTimeout(timeoutMs = 5000) {
  const fallback = {
    alerts: [],
    checkedAt: new Date().toISOString(),
    cacheAgeMs: null,
    timedOut: true,
  };

  return Promise.race([
    getPriorityAlerts(),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]).catch(() => fallback);
}

const LATEST_AI_TOOL_VENDOR_PATTERN = /\b(openai|anthropic|claude|chatgpt|gpt(?:-[0-9.]+)?|fable|mythos|gemini|deepmind|grok|xai|x\.ai|llama|copilot|mistral|hugging\s*face|perplexity|cursor|vercel|github|aws|bedrock|codex|lovable|replit|runway|midjourney|elevenlabs|suno|luma|krea)\b/i;
const LATEST_AI_TOOL_ACTION_PATTERN = /\b(agent|agents|tool|tools|api|workspace|desktop|browser|coding|automation|computer use|release|launch|rollout|feature|model|assistant|operator|codex|canvas|v0|rag|voice|multimodal|preview|beta|introduc(?:e|es|ed|ing)|unveil(?:s|ed|ing)?)\b/i;
const LATEST_AI_TOOL_UTILITY_PATTERN = /\b(ai|artificial intelligence)\b.{0,80}\b(agent|agents|tool|tools|api|workspace|desktop|browser|coding|automation|computer use|assistant|app|platform|feature|release|launch)\b|\b(agent|agents|tool|tools|api|workspace|desktop|browser|coding|automation|computer use|assistant|app|platform|feature|release|launch)\b.{0,80}\b(ai|artificial intelligence)\b/i;

function isLatestAiToolCandidate(item = {}) {
  const titleText = String(item.title || '');
  const titleSummaryText = [
    titleText,
    item.summary,
    item.description,
    item.reason,
  ].filter(Boolean).join(' ');
  const sourceText = [
    item.source,
    item.source_name,
    item.publisher,
    item.feedSectionTitle,
  ].filter(Boolean).join(' ');
  const text = `${titleSummaryText} ${sourceText}`;

  const hasUsefulAction = LATEST_AI_TOOL_ACTION_PATTERN.test(titleSummaryText);
  const hasVendorSignal = LATEST_AI_TOOL_VENDOR_PATTERN.test(text);
  const hasExplicitAiUtilitySignal = LATEST_AI_TOOL_UTILITY_PATTERN.test(titleSummaryText);
  return hasUsefulAction && (hasVendorSignal || hasExplicitAiUtilitySignal);
}

function getLatestNewsDedupeKey(item = {}) {
  const rawTitle = String(item.title || '');
  const modelMatch = rawTitle.toLowerCase().match(/\b(claude\s+(?:opus|sonnet|haiku)\s+[0-9.]+|gpt-?[0-9][a-z0-9.]*|gemini\s+[0-9.]+|grok\s+[0-9.]+|llama\s+[0-9.]+|mistral\s+\w+)\b/i);
  if (modelMatch) return `model:${modelMatch[1].replace(/\s+/g, ' ').trim().toLowerCase()}`;
  const title = rawTitle
    .toLowerCase()
    .replace(/\s+-\s+(anthropic|openai|google|deepmind|mistral ai|mistral|aws|amazon|microsoft|github)\s*$/i, '')
    .replace(/\b(is now available on aws|is now available)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (title) return `title:${title}`;
  return `url:${String(item.url || '').trim().toLowerCase()}`;
}

function dedupeLatestNewsItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getLatestNewsDedupeKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLatestNews(feed, templateState, officialReleaseAlerts = []) {
  const sections = Array.isArray(feed?.sections) ? feed.sections : [];
  const written = sections.find(s => s.id === 'written-news');
  const latestItems = (written?.items || []).filter(isLatestAiToolCandidate).filter(isVisibleFreshNewsItem).slice(0, 16).map((item, index) => {
    const publishedAt = pickLatestNewsDate(item);
    return {
      ...item,
      id: item.id || item.url || `written:${index}`,
      source: item.source || item.source_name || item.publisher || 'Written news',
      date: publishedAt,
      publishedAt,
      publishDate: publishedAt,
      kind: item.kind || item.channelType || item.channel_type || 'written',
    };
  });
  const releaseItems = (officialReleaseAlerts || []).filter(isVisibleFreshNewsItem).slice(0, 12).map((alert, index) => {
    const publishedAt = pickLatestNewsDate(alert);
    return normalizeOfficialReleaseAlert(alert, index, publishedAt);
  });
  const sortedItems = [...releaseItems, ...latestItems]
    .filter(item => item.title && pickLatestNewsDate(item) && isVisibleFreshNewsItem(item))
    .sort(compareLatestNewsItems);

  return dedupeLatestNewsItems(sortedItems).slice(0, 12);
}

// ─── Helper: extract normal feed items from a template feed ──────────
function buildNormalNews(feed) {
  const sections = Array.isArray(feed?.sections) ? feed.sections : [];
  return sections
    .filter(s => s.id !== 'written-news')
    .flatMap(s => s.items || [])
    .filter(isVisibleFreshNewsItem)
    .slice(0, 40);
}

function computeFreshnessScore(item = {}) {
  const dateValue = pickLatestNewsDate(item) || item.date || item.publishedAt || item.publishDate || item.created_at;
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return 0.35;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 36e5);
  if (ageHours > MAX_VISIBLE_NEWS_AGE_HOURS) return 0;
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.82;
  return 0;
}

function normalizeFeedRanking(item = {}, fallbackRank = 0) {
  const directNewsScore = Number(item.directNewsScore || item.direct_news_score || 0);
  const templateScore = Number(item.templateScore || item.template_score || item.score || item._score || 0);
  const sourceTrust = clampNewsScore(
    item.sourceTrust
      ?? item.source_trust
      ?? item.trustScore
      ?? item.trust_score
      ?? item.scores?.sourceTrust,
    0.55
  );
  const freshness = clampNewsScore(item.freshnessScore ?? item.scores?.freshness ?? computeFreshnessScore(item), 0.5);
  const usefulness = clampNewsScore(
    item.decisionUsefulness
      ?? item.decision_usefulness
      ?? item.lifeImpact
      ?? item.life_impact
      ?? item.scores?.decisionUsefulness
      ?? item.scores?.lifeImpact,
    0.55
  );
  const personalFit = clampNewsScore(
    item.goalAlignment
      ?? item.goal_alignment
      ?? item.personalFit
      ?? item.personal_fit
      ?? (templateScore > 1 ? templateScore / 100 : templateScore)
      ?? item.scores?.goalAlignment,
    0.5
  );
  const directness = clampNewsScore(
    item.directness
      ?? item.scores?.directness
      ?? (directNewsScore ? directNewsScore / 260 : item.official_source || item.kind === 'official' ? 0.95 : 0.45),
    0.45
  );
  const total = Math.round(
    (directNewsScore || 0)
    + (templateScore || 0)
    + sourceTrust * 30
    + freshness * 25
    + usefulness * 24
    + personalFit * 28
    + directness * 22
    + fallbackRank
  );

  const matchedRules = Array.isArray(item.matchedRules)
    ? item.matchedRules
    : Array.isArray(item.matched_rules)
      ? item.matched_rules
      : [];

  return {
    total,
    sourceTrust,
    freshness,
    usefulness,
    personalFit,
    directness,
    matchedRules,
    why: item.whyShown || item.why_shown || item.reason || item.summary || '',
  };
}

function attachFeedRanking(item = {}, index = 0) {
  const ranking = normalizeFeedRanking(item, Math.max(0, 12 - index));
  return {
    ...item,
    ranking,
    whyShown: item.whyShown || item.why_shown || ranking.why,
    sourceTrust: ranking.sourceTrust,
  };
}

function attachFeedRankings(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => attachFeedRanking(item, index));
}

const DIRECT_NEWS_REGIONAL_LOCATION_PATTERN = /\b(iran|qatar|jordan|lebanon|gaza|israel|palestine|west bank|syria|iraq|red sea|middle east|hezbollah|hamas)\b/i;
const DIRECT_NEWS_URGENT_ACTION_PATTERN = /\b(airstrikes?|ceasefire|security council|embassy|evacuat(?:e|es|ed|ion)|missiles?|sanctions?|war|ground offensive|strikes?|killed|injured|truce|threatens?)\b/i;
const DIRECT_NEWS_KYIV_RISK_PATTERN = /\b(kyiv|ukraine|russia)\b.*\b(strikes?|evacuat(?:e|es|ed|ion)|missiles?|threatens?)\b|\b(strikes?|evacuat(?:e|es|ed|ion)|missiles?|threatens?)\b.*\b(kyiv|ukraine|russia)\b/i;
const DIRECT_NEWS_LOW_SIGNAL_PATTERN = /\b(hot sauce|pool store|filter cleaner|joker|carried knives|sweepstakes|celebrity|sports|football|psg|champions league|gold price)\b/i;
const DIRECT_AI_TOOL_TITLE_PATTERN = /\b(claude|opus|sonnet|fable|mythos|gpt|chatgpt|gemini|deepmind|grok|llama|mistral|codex|cursor|copilot|perplexity|langsmith|agent|agents|api|sdk|mcp|model|tool|tools|available|release|launch|rollout|preview|beta|v0|workflow|automation|lovable|replit|runway|midjourney|elevenlabs|suno|luma|krea)\b/i;
const DIRECT_AI_HIGH_SIGNAL_TITLE_PATTERN = /\b(introduc(?:e|es|ed|ing)|launch(?:es|ed|ing)?|release(?:s|d)?|rollout|now available|new tool|new model|ships?|adds?|updated?|upgrade(?:s|d)?|preview|beta|toolkit|computer use|mobile access|agents sdk|cloud agents)\b/i;
const DIRECT_AI_MODEL_VERSION_PATTERN = /\b(fable|mythos|opus|sonnet|gpt|gemini|grok|llama|mistral)\s*[- ]?\d+(?:\.\d+)?\b/i;
const DIRECT_AI_GENERIC_GUIDE_TITLE_PATTERN = /\b(how\b|build(?:ing)?\b|evaluat(?:e|es|ed|ing)\b|train(?:ing)?\b|streamline\b|using\b|guide\b|glossary\b|test suite\b|dataset management\b|proxy\b|redefine\b|doubles?\b|ships faster\b|big bet\b|agentic organization\b)\b/i;
const DIRECT_AI_HYPE_TITLE_PATTERN = /\b(beast\b|woah\b|big problem\b|coming for\b|just dropped\b|run for 24\+ hours now\b)\b/i;
const DIRECT_AI_POLICY_PATTERN = /\b(resilience|biodefense|evaluation|evaluations|policy|governance|safety framework|responsible ai|societal)\b/i;
const DIRECT_AI_FIRST_PARTY_SOURCE_PATTERN = /\b(openai|anthropic|google deepmind|google ai|xai|x\.ai|mistral ai|microsoft developer|github|vercel|hugging\s*face|perplexity|cursor|lovable|replit|runway|midjourney|elevenlabs|suno|luma|krea)\b/i;
const DIRECT_NEWS_GOOGLE_WRAPPER_PATTERN = /(^|\.)news\.google\.com$/i;

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function clampNewsScore(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function isGoogleNewsWrapperUrl(value = '') {
  try {
    const parsed = new URL(String(value || ''));
    return DIRECT_NEWS_GOOGLE_WRAPPER_PATTERN.test(parsed.hostname);
  } catch (error) {
    return /news\.google\.com/i.test(String(value || ''));
  }
}

function hasDirectRegionalSignal(row = {}) {
  const title = String(row.title || '');
  return (DIRECT_NEWS_REGIONAL_LOCATION_PATTERN.test(title) && DIRECT_NEWS_URGENT_ACTION_PATTERN.test(title))
    || DIRECT_NEWS_KYIV_RISK_PATTERN.test(title);
}

function getDirectNewsDate(row = {}) {
  return row.publish_date || '';
}

function computeDirectNewsScore(row = {}) {
  const text = [
    row.title,
    row.summary,
    row.source_name,
    row.topic_tags_json,
  ].filter(Boolean).join(' ');
  const sourceText = String(row.source_name || '');
  const googleNewsWrapper = isGoogleNewsWrapperUrl(row.url);
  const channelType = String(row.channel_type || '').toLowerCase();
  const publishedTime = Date.parse(getDirectNewsDate(row));
  const ageHours = Number.isFinite(publishedTime)
    ? Math.max(0, (Date.now() - publishedTime) / 36e5)
    : 240;
  const recencyScore = ageHours <= 72 ? 1 : Math.max(0.15, 1 - (ageHours / (24 * 21)));
  const trustScore = clampNewsScore(row.trust_score, 0.5);
  const decisionScore = clampNewsScore(row.decision_usefulness, 0.45);
  const lifeScore = clampNewsScore(row.life_impact, 0.45);
  const distractionRisk = clampNewsScore(row.distraction_risk, 0.2);
  const aiToolSignal = isLatestAiToolCandidate({
    title: row.title,
    summary: row.summary,
    source: row.source_name,
  });
  const directToolTitle = DIRECT_AI_TOOL_TITLE_PATTERN.test(String(row.title || ''));
  const policyOrResearch = DIRECT_AI_POLICY_PATTERN.test(String(row.title || ''));
  const regionalSignal = hasDirectRegionalSignal(row);
  const officialVendor = LATEST_AI_TOOL_VENDOR_PATTERN.test(sourceText);
  const highSignalTitle = DIRECT_AI_HIGH_SIGNAL_TITLE_PATTERN.test(String(row.title || ''))
    || DIRECT_AI_MODEL_VERSION_PATTERN.test(String(row.title || ''));
  const firstPartyAiRelease = aiToolSignal
    && highSignalTitle
    && DIRECT_AI_FIRST_PARTY_SOURCE_PATTERN.test(sourceText);
  const namedFrontierRelease = /\b(fable|mythos|opus|sonnet|gpt|gemini|grok|llama|mistral)\s*[- ]?\d+(?:\.\d+)?\b/i.test(text);
  const lowSignal = DIRECT_NEWS_LOW_SIGNAL_PATTERN.test(text);
  const partnerMarketing = isPartnerMarketingNewsItem(row);
  const platformAvailability = isPlatformAvailabilityNewsItem(row);

  let score = 0;
  if (aiToolSignal) score += 72;
  if (directToolTitle) score += 36;
  if (officialVendor) score += 28;
  if (firstPartyAiRelease) score += 80;
  if (namedFrontierRelease) score += 70;
  if (regionalSignal) score += 42;
  if (channelType === 'written') score += 10;
  score += trustScore * 18;
  score += decisionScore * 18;
  score += lifeScore * 12;
  score += recencyScore * 16;
  score -= distractionRisk * 22;
  if (lowSignal) score -= 55;
  if (partnerMarketing) score -= 90;
  if (platformAvailability && !firstPartyAiRelease) score -= 42;
  if (policyOrResearch && !directToolTitle) score -= 42;
  if (googleNewsWrapper) score -= 58;
  if (channelType === 'socialvideo' && !firstPartyAiRelease && !regionalSignal) score -= 34;
  if (ageHours > 168 && !firstPartyAiRelease && !regionalSignal) score -= 38;

  return Number(score.toFixed(3));
}

function pickOfficialReleaseThumbnail(alert = {}) {
  return String(
    alert?.thumbnail
      || alert?.thumbnailUrl
      || alert?.thumbnail_url
      || alert?.image
      || alert?.imageUrl
      || alert?.coverImage
      || alert?.media?.thumbnail
      || alert?.media?.image
      || alert?.media?.imageUrl
      || ''
  ).trim();
}

function normalizeOfficialReleaseAlert(alert = {}, index = 0, publishedAt = '') {
  const thumbnail = pickOfficialReleaseThumbnail(alert);
  const normalizedPublishedAt = publishedAt || pickLatestNewsDate(alert) || '';

  return {
    ...alert,
    id: alert.id || alert.externalId || alert.sourceUrl || alert.url || `official:${index}:${String(alert.title || '').slice(0, 24)}`,
    title: alert.title || 'Official AI release',
    source: alert.source || alert.company || 'Official AI release',
    url: alert.sourceUrl || alert.url || '',
    date: normalizedPublishedAt,
    publishedAt: normalizedPublishedAt,
    publishDate: normalizedPublishedAt,
    kind: 'official',
    alert: true,
    type: 'official_release',
    severity: alert.importance || 'important',
    summary: alert.summary || alert.reason || '',
    reason: alert.reason || alert.whyNotified || 'Official AI tool release signal',
    whyNotified: alert.whyNotified || '',
    vendorScope: alert.vendorScope || alert.companies || [],
    thumbnail: thumbnail || null,
    thumbnailUrl: alert.thumbnailUrl || thumbnail || null,
    thumbnail_url: alert.thumbnail_url || thumbnail || null,
    image: alert.image || thumbnail || null,
    imageUrl: alert.imageUrl || thumbnail || null,
    coverImage: alert.coverImage || thumbnail || null,
  };
}

function buildDirectLatestNews(db, officialReleaseAlerts = []) {
  const rows = db.prepare(`
    SELECT
      c.id,
      c.external_id,
      c.title,
      c.url,
      c.thumbnail_url,
      c.publish_date,
      c.created_at,
      c.summary,
      c.content_type,
      c.channel_type,
      c.life_impact,
      c.decision_usefulness,
      c.distraction_risk,
      c.trust_score,
      c.topic_tags_json,
      s.name AS source_name,
      s.trust_tier AS source_trust_tier
    FROM content_items c
    LEFT JOIN sources s ON s.id = c.source_id
    WHERE c.title IS NOT NULL AND TRIM(c.title) <> ''
      AND c.publish_date IS NOT NULL
      AND datetime(c.publish_date) >= datetime('now', '-3 days')
    ORDER BY datetime(c.publish_date) DESC, c.created_at DESC
    LIMIT 220
  `).all();

  const releaseItems = (officialReleaseAlerts || [])
    .filter(isVisibleFreshNewsItem)
    .filter(isDirectOfficialLabReleaseAlert)
    .slice(0, 12)
    .map((alert, index) => {
      const publishedAt = pickLatestNewsDate(alert);
      return {
        ...normalizeOfficialReleaseAlert(alert, index, publishedAt),
        directNewsScore: 360,
      };
    });

  const scoredRows = rows
    .map((row) => ({ row, score: computeDirectNewsScore(row) }))
    .filter(({ row, score }) => {
      const text = `${row.title || ''} ${row.summary || ''} ${row.source_name || ''} ${row.topic_tags_json || ''}`;
      const title = String(row.title || '');
      const source = String(row.source_name || '');
      const channelType = String(row.channel_type || '').toLowerCase();
      const contentType = String(row.content_type || '').toLowerCase();
      const publishedTime = Date.parse(getDirectNewsDate(row));
      const ageHours = Number.isFinite(publishedTime)
        ? Math.max(0, (Date.now() - publishedTime) / 36e5)
        : 240;
      const aiTool = isLatestAiToolCandidate({ title, summary: row.summary, source: row.source_name });
      const highSignalToolTitle = DIRECT_AI_HIGH_SIGNAL_TITLE_PATTERN.test(title)
        || DIRECT_AI_MODEL_VERSION_PATTERN.test(title);
      const genericGuideTitle = DIRECT_AI_GENERIC_GUIDE_TITLE_PATTERN.test(title);
      const hypeTitle = DIRECT_AI_HYPE_TITLE_PATTERN.test(title);
      const regional = hasDirectRegionalSignal(row);
      const firstPartySource = DIRECT_AI_FIRST_PARTY_SOURCE_PATTERN.test(source);
      const googleNewsWrapper = isGoogleNewsWrapperUrl(row.url);
      if (ageHours > MAX_VISIBLE_NEWS_AGE_HOURS) return false;
      if (isVideoOnlyNewsItem({ channelType, contentType, url: row.url })) return false;
      if (isPartnerMarketingNewsItem({ title, summary: row.summary, source })) return false;
      const staleWrapperOrSocial = ageHours > MAX_VISIBLE_NEWS_AGE_HOURS && (googleNewsWrapper || channelType === 'socialvideo');
      const staleNonOfficial = ageHours > MAX_VISIBLE_NEWS_AGE_HOURS && !regional && !firstPartySource;
      if (googleNewsWrapper && aiTool && !regional) return false;
      if (staleWrapperOrSocial || staleNonOfficial) return false;
      return regional
        || (score >= 52 && aiTool && highSignalToolTitle && !genericGuideTitle && !hypeTitle);
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(getDirectNewsDate(right.row)) - Date.parse(getDirectNewsDate(left.row));
    })
    .slice(0, 24)
    .map(({ row, score }) => {
      const publishedAt = getDirectNewsDate(row);
      const topics = parseJsonArray(row.topic_tags_json).map((entry) => String(entry || '').trim()).filter(Boolean);
      const regional = hasDirectRegionalSignal(row);
      const aiTool = isLatestAiToolCandidate({ title: row.title, summary: row.summary, source: row.source_name });
      const platformAvailability = isPlatformAvailabilityNewsItem({
        title: row.title,
        summary: row.summary,
        source: row.source_name,
      });
      const officialAiRelease = aiTool
        && DIRECT_AI_HIGH_SIGNAL_TITLE_PATTERN.test(String(row.title || ''))
        && DIRECT_AI_FIRST_PARTY_SOURCE_PATTERN.test(String(row.source_name || ''));
      return {
        id: row.id || row.external_id || row.url || row.title,
        external_id: row.external_id,
        title: row.title,
        source: row.source_name || 'Trusted source',
        url: row.url || '',
        thumbnail: row.thumbnail_url || null,
        date: publishedAt,
        publishedAt,
        publishDate: publishedAt,
        summary: row.summary || '',
        reason: aiTool
          ? platformAvailability
            ? 'Tracked AI platform availability update.'
            : 'Relevant AI tool or model update.'
          : regional
            ? 'Urgent regional update.'
            : 'Relevant trusted news update.',
        kind: officialAiRelease ? 'official' : String(row.channel_type || row.content_type || 'written').toLowerCase(),
        type: officialAiRelease ? 'official_release' : String(row.content_type || 'article').toLowerCase(),
        official_source: officialAiRelease,
        contentType: row.content_type || 'article',
        channelType: row.channel_type || 'written',
        topics,
        sourceTrust: clampNewsScore(row.trust_score, 0.5),
        directNewsScore: score,
      };
    });

  const sorted = dedupeLatestNewsItems([...releaseItems, ...scoredRows])
    .sort((left, right) => {
      const scoreDiff = Number(right.directNewsScore || 0) - Number(left.directNewsScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return compareLatestNewsItems(left, right);
    });

  return attachFeedRankings(selectDistinctDirectEvents(sorted, {
    maxItems: 12,
    maxRegionalItems: 3,
  }));
}

function buildDirectFeedPayload({ db, discoveryStatus, writtenCoverage, officialReleaseAlerts }) {
  const latestNews = buildDirectLatestNews(db, officialReleaseAlerts);
  const sections = [
    {
      id: 'written-news',
      title: 'Latest news',
      items: latestNews,
    },
  ];
  return {
    sections,
    latestNews,
    normalNews: [],
    feedHealth: buildFeedHealthPayload({
      discoveryStatus,
      writtenCoverage,
      officialReleaseAlerts,
      latestNews,
    }),
    direct_feed: true,
  };
}

// ─── Helper: build feed health payload ───────────────────────────────
function buildFeedHealthPayload({ discoveryStatus, writtenCoverage, officialReleaseAlerts, latestNews } = {}) {
  const hasContent = (discoveryStatus?.totalItems || 0) > 0 || (writtenCoverage?.article_count || 0) > 0;
  const hasReleases = Array.isArray(officialReleaseAlerts) && officialReleaseAlerts.length > 0;
  const latestNewsCount = Array.isArray(latestNews) ? latestNews.length : 0;
  const hasVisibleLatest = latestNewsCount > 0;
  const status = hasVisibleLatest ? 'ok' : (hasContent || hasReleases ? 'degraded' : 'empty');
  return {
    status,
    degradedReason: hasVisibleLatest ? null : (hasContent || hasReleases ? 'no_latest_profile_fit' : 'no_content'),
    message: hasVisibleLatest
      ? null
      : hasContent || hasReleases
        ? 'Sources loaded, but no profile-fit latest AI-tool item passed the strict filter yet.'
        : 'No content has been ingested yet. Try triggering a discovery refresh.',
    discovery: discoveryStatus || null,
    writtenCoverage: writtenCoverage || null,
    officialReleasesCount: Array.isArray(officialReleaseAlerts) ? officialReleaseAlerts.length : 0,
    latestNewsCount,
  };
}

fastify.get('/api/v1/health', async (request) => {
  const readiness = buildSystemReadiness({
    db,
    dataBackend: DATA_BACKEND,
    user: request.user,
  });

  return {
    status: 'ok',
    timestamp: new Date(),
    data_backend: DATA_BACKEND,
    sqlite_bridge_active: true,
    supabase_auth_configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    push_configured: hasPushCredentials(),
    readiness: readiness.status,
  };
});

fastify.get('/api/v1/auth/capabilities', async (request) => ({
  authenticated: Boolean(request.user?.id),
  is_admin: isAuthorizedAdminRequest(request),
  user_id: request.user?.id || null,
}));

function isAuthorizedCronRequest(request) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  const authorization = String(request.headers.authorization || '').trim();
  const explicitSecret = String(request.headers['x-cron-secret'] || '').trim();
  return authorization === `Bearer ${expected}` || explicitSecret === expected;
}

async function handleScheduledNewsCycle(request, reply) {
  if (!isAuthorizedCronRequest(request)) {
    return reply.status(401).send({ success: false, error: 'Unauthorized scheduler request.' });
  }

  try {
    const summary = await runIntelligenceCycle(db, {
      force: true,
      loopMode: 'scheduled',
      alertLimit: 40,
    });
    return { success: true, summary };
  } catch (error) {
    request.log.error(error, 'Scheduled intelligence cycle failed');
    return reply.status(500).send({
      success: false,
      error: 'Scheduled intelligence cycle failed.',
      ...(EXPOSE_API_ERROR_DETAILS ? { details: error.message } : {}),
    });
  }
}

fastify.get('/api/v1/automation/news-cycle', handleScheduledNewsCycle);
fastify.post('/api/v1/automation/news-cycle', handleScheduledNewsCycle);

async function refreshGoogleAuthProbeForReadiness(request) {
  try {
    await probeGoogleAuthProvider({ timeoutMs: 2500 });
  } catch (error) {
    request.log.warn({ err: error }, 'Google auth readiness probe failed');
  }
}

async function refreshPrivateMessengerPushEvidence(request) {
  try {
    await probePrivateMessengerPushEvidence({ timeoutMs: 2500 });
  } catch (error) {
    request.log.warn({ err: error }, 'Private-message push evidence probe failed');
  }
}

async function getLiveRadarAlertCountForReadiness(timeoutMs = 2500) {
  const payload = await getPriorityAlertsWithTimeout(timeoutMs);
  return Array.isArray(payload?.alerts) ? payload.alerts.length : 0;
}

async function hydrateRemoteWorkersForReadiness(request, timeoutMs = 2500) {
  try {
    const remoteWorkers = await supabaseRuntimeStore.listWorkerStatuses([
      'best_feed_discovery',
      'priority_alert_dispatch',
    ], { timeoutMs });
    for (const worker of remoteWorkers || []) {
      updateWorkerRuntimeStatus(db, worker.worker_name, worker);
    }
  } catch (error) {
    request.log.warn({ err: error }, 'Could not hydrate remote worker readiness');
  }
}

async function refreshReadinessEvidence(request, { includeRemoteWorkers = false } = {}) {
  const tasks = [
    refreshGoogleAuthProbeForReadiness(request),
    refreshPrivateMessengerPushEvidence(request),
    getLiveRadarAlertCountForReadiness(),
  ];

  if (includeRemoteWorkers) {
    tasks.push(hydrateRemoteWorkersForReadiness(request));
  }

  const results = await Promise.all(tasks);
  return Math.max(0, Number(results[2] || 0));
}

fastify.get('/api/v1/readiness', async (request) => {
  const priorityRadarAlertCount = await refreshReadinessEvidence(request, {
    includeRemoteWorkers: true,
  });
  const privateMessages = buildPrivateMessagingReadiness({ db, user: request.user });
  const readiness = buildSystemReadiness({
    db,
    dataBackend: DATA_BACKEND,
    user: request.user,
    sections: {
      priorityRadarAlertCount,
    },
  });
  return {
    ...readiness,
    private_messages: privateMessages,
  };
});

fastify.get('/api/v1/readiness/vision', async (request) => {
  const priorityRadarAlertCount = await refreshReadinessEvidence(request);
  const privateMessages = buildPrivateMessagingReadiness({ db, user: request.user });
  const readiness = buildVisionReadiness({
    db,
    dataBackend: DATA_BACKEND,
    user: request.user,
    sections: {
      priorityRadarAlertCount,
      private_messages: privateMessages,
    },
  });
  return {
    ...readiness,
    private_messages: privateMessages,
  };
});

fastify.get('/api/v1/readiness/activation', async (request) => {
  await refreshReadinessEvidence(request);
  const privateMessages = buildPrivateMessagingReadiness({ db, user: request.user });
  const readiness = buildActivationReadiness({
    db,
    user: request.user,
  });
  return {
    ...readiness,
    private_messages: privateMessages,
  };
});

fastify.get('/api/v1/messages/readiness', async (request) => {
  await refreshPrivateMessengerPushEvidence(request);
  return buildPrivateMessagingReadiness({
    db,
    user: request.user,
  });
});

fastify.get('/api/v1/auth/google/status', async (request) => {
  const timeoutMs = Math.max(1500, Math.min(12000, Number(request.query?.timeoutMs || 6000)));
  return probeGoogleAuthProvider({ timeoutMs });
});

fastify.get('/api/v1/sources/status', async (request) => {
  const readiness = buildSourceReadiness();
  const discovery = buildSystemReadiness({
    db,
    dataBackend: DATA_BACKEND,
    user: request.user,
  }).discovery;
  return {
    status: readiness.status,
    sources: readiness.items,
    summary: readiness.summary,
    discovery,
  };
});

fastify.get('/api/v1/ai/model-pool/status', async () => {
  return aiService.getSafeModelPoolDiagnostics();
});

fastify.get('/api/v1/ai/model-pool/probe', async (request) => {
  const provider = String(request.query?.provider || 'gemini').toLowerCase() === 'openai' ? 'openai' : 'gemini';
  const timeoutMs = Math.max(1500, Math.min(12000, Number(request.query?.timeoutMs || 8000)));
  return aiService.probeLiveProvider({
    providerPreference: provider,
    timeoutMs,
  });
});

fastify.get('/api/v1/news/brief', async (request, reply) => {
  try {
    const forceRefresh = ['1', 'true', 'yes', 'on'].includes(String(request.query?.refresh || '').toLowerCase());
    if (forceRefresh) {
      if (feedRefreshAuthRequired() && !request.user?.id) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication required for live refresh.',
          auth_required: true,
        });
      }

      const refreshKey = request.user?.id || resolveClientIp(request);
      const refreshRate = newsBriefRefreshRateLimiter.check(refreshKey);
      if (!applyRateLimit(reply, refreshRate, 'News brief refresh rate limit exceeded.')) {
        return;
      }
    }

    const userId = request.user?.id || 'guest';

    // 1. Check in-memory brief cache if not a forced refresh
    if (!forceRefresh) {
      const cached = writtenNewsBriefCache.get(userId);
      if (cached && Date.now() - cached.createdAt < WRITTEN_BRIEF_CACHE_TTL_MS) {
        return cached.payload;
      }
    }

    const coverageResult = await ensureWrittenNewsCoverage(db, { force: forceRefresh }).catch(() => ({
      refreshed: false,
      articleCount: 0,
      coverage: getWrittenNewsCoverageState(db),
    }));
    const coverage = coverageResult?.coverage || getWrittenNewsCoverageState(db);
    const { templateState } = getTemplateContextForRequest(request);
    if (forceRefresh) {
      await refreshBestFeedForRequest(request, templateState, { force: true }).catch(() => null);
    }
    const feed = await templateRankingService.buildTemplateDrivenFeed(db, templateState, {
      precomputeVisuals: true,
      scanLimit: 500,
      limitPerSection: 8,
      scopeUserId: request.user?.id || '',
    });
    const writtenSection = feed.sections.find((section) => section.id === 'written-news') || {
      id: 'written-news',
      title: 'Written News',
      items: [],
    };
    const articleCount = Number(coverageResult?.articleCount || coverage.article_count || writtenSection.items.length || 0);

    if (!writtenSection.items.length && articleCount === 0) {
      return {
        success: false,
        generated_at: new Date().toISOString(),
        refreshed: Boolean(coverageResult?.refreshed),
        article_count: articleCount,
        coverage,
        brief: null,
        items: [],
        error: coverage.all_feeds_failed
          ? 'Written sources are unreachable right now.'
          : 'No written articles are ready yet.',
        details: coverage.message,
      };
    }

    const brief = await buildWrittenNewsBrief(writtenSection.items, templateState, userId, forceRefresh);

    const payload = {
      success: true,
      generated_at: new Date().toISOString(),
      refreshed: Boolean(coverageResult?.refreshed),
      article_count: articleCount,
      coverage,
      brief,
      items: writtenSection.items,
    };

    // Cache the successful brief payload
    writtenNewsBriefCache.set(userId, { createdAt: Date.now(), payload });

    return payload;
  } catch (error) {
    request.log.error(error, 'Written news brief failed');
    return reply.status(500).send({
      success: false,
      error: 'Written news brief failed.',
      details: error.message,
    });
  }
});

fastify.post('/api/v1/ingest/youtube', async (request, reply) => {
  const { url } = request.body || {};

  if (!url || typeof url !== 'string') {
    return reply.status(400).send({ error: 'A valid YouTube URL is required.' });
  }

  try {
    return await ingestYouTubeUrl(url.trim());
  } catch (error) {
    request.log.error(error, 'YouTube ingest failed');
    return reply.status(500).send({ error: 'YouTube ingest failed', details: error.message });
  }
});

fastify.post('/api/v1/ingest/instagram', async (request, reply) => {
  const { url } = request.body || {};

  if (!url || typeof url !== 'string') {
    return reply.status(400).send({ error: 'A valid Instagram URL is required.' });
  }

  try {
    return await ingestInstagramUrl(url.trim());
  } catch (error) {
    request.log.error(error, 'Instagram ingest failed');
    return reply.status(500).send({ error: 'Instagram ingest failed', details: error.message });
  }
});

fastify.post('/api/v1/ingest/podcast', async (request, reply) => {
  const { url } = request.body || {};

  if (!url || typeof url !== 'string') {
    return reply.status(400).send({ error: 'A valid podcast RSS URL is required.' });
  }

  try {
    return await ingestPodcastFeed(url.trim());
  } catch (error) {
    request.log.error(error, 'Podcast ingest failed');
    return reply.status(500).send({ error: 'Podcast ingest failed', details: error.message });
  }
});

fastify.post('/api/v1/ingest/reddit', async (request, reply) => {
  const { source } = request.body || {};

  if (!source || typeof source !== 'string') {
    return reply.status(400).send({ error: 'A subreddit name or Reddit URL is required.' });
  }

  try {
    return await ingestRedditSource(source.trim());
  } catch (error) {
    request.log.error(error, 'Reddit ingest failed');
    return reply.status(500).send({ error: 'Reddit ingest failed', details: error.message });
  }
});

fastify.post('/api/v1/ingest/x', async (request, reply) => {
  const { source } = request.body || {};

  if (!source || typeof source !== 'string') {
    return reply.status(400).send({ error: 'An X profile URL or username is required.' });
  }

  try {
    return await ingestXSource(source.trim());
  } catch (error) {
    request.log.error(error, 'X ingest failed');
    return reply.status(500).send({ error: 'X ingest failed', details: error.message });
  }
});

  // GET /feed
fastify.get('/api/v1/feed', async (request, reply) => {
  let forceRefresh = false;
  try {
    const visualizeQuery = String(request.query?.visualize || '').toLowerCase();
    const visualize = ['1', 'true', 'yes', 'on'].includes(visualizeQuery);
    const directQuery = String(request.query?.direct || '').toLowerCase();
    const useDirectFeed = ['1', 'true', 'yes', 'on'].includes(directQuery);
    const refreshQuery = String(request.query?.refresh || '').toLowerCase();
    forceRefresh = ['1', 'true', 'yes', 'on'].includes(refreshQuery);

    if (forceRefresh) {
      if (feedRefreshAuthRequired() && !request.user?.id) {
        return reply.status(401).send({
          error: 'Authentication required for live refresh.',
          auth_required: true,
        });
      }

      const refreshKey = request.user?.id || resolveClientIp(request);
      const refreshRate = feedRefreshRateLimiter.check(refreshKey);
      if (!applyRateLimit(reply, refreshRate, 'Feed refresh rate limit exceeded.')) {
        return;
      }
    }

    const userId = request.user?.id || 'guest';
    const feedCacheKey = userId;
    let refreshMode = 'none';
    let refreshResults = null;

    // Return cached feed if fresh and not a forced refresh
    if (!forceRefresh && !visualize && !useDirectFeed) {
      const cached = feedCache.get(feedCacheKey);
      if (cached && Date.now() - cached.createdAt < FEED_CACHE_TTL_MS) {
        return {
          ...cached.payload,
          refresh: {
            ...buildFeedRefreshEvidence(),
            source: 'server_cache',
            status: 'cache_hit',
          },
        };
      }
    }

    const { templateState } = getTemplateContextForRequest(request);

    if (forceRefresh && !visualize) {
      feedCache.delete(feedCacheKey);
      writtenNewsBriefCache.delete(userId);
      refreshMode = 'forced';
      refreshResults = await refreshLiveFeedInputsForRequest(request, templateState, {
        force: true,
        timeoutMs: 14000,
        includeDiscovery: !useDirectFeed,
      });
    }

    let discoveryStatus = getDiscoveryStatus(db, request.user?.id || '');
    let writtenCoverage = getWrittenNewsCoverageState(db);

    const writtenCoverageNeedsRefresh = (writtenCoverage?.article_count || 0) === 0
      || Boolean(writtenCoverage?.latest_article_is_stale)
      || ((writtenCoverage?.feed_count || 0) > 0 && (writtenCoverage?.reachable_feed_count || 0) === 0);
    const discoveryNeedsRefresh = !useDirectFeed && (discoveryStatus?.totalItems || 0) === 0;

    if (!forceRefresh && !visualize && (discoveryNeedsRefresh || writtenCoverageNeedsRefresh)) {
      refreshMode = 'automatic';
      refreshResults = await refreshLiveFeedInputsForRequest(request, templateState, {
        force: false,
        timeoutMs: 7000,
        includeDiscovery: !useDirectFeed,
      });
      discoveryStatus = getDiscoveryStatus(db, request.user?.id || '');
      writtenCoverage = getWrittenNewsCoverageState(db);
    }
    const refresh = buildFeedRefreshEvidence({ mode: refreshMode, results: refreshResults });

    const releaseAlertPayload = await getPriorityAlertsWithTimeout(forceRefresh ? 7500 : 2500);
    const officialReleaseAlerts = selectLatestOfficialReleaseAlerts(releaseAlertPayload.alerts || [], {
      limit: 24,
      companies: PRIMARY_AI_RELEASE_COMPANIES,
      minImportance: 'important',
    });

    if (useDirectFeed) {
      const directPayload = buildDirectFeedPayload({
        db,
        discoveryStatus,
        writtenCoverage,
        officialReleaseAlerts,
      });

      return {
        ...directPayload,
        refresh,
      };
    }

    const feed = await templateRankingService.buildTemplateDrivenFeed(db, templateState, {
      ensureWrittenCoverage: true,
      precomputeVisuals: visualize,
      scanLimit: 500,
      limitPerSection: 12,
      scopeUserId: request.user?.id || '',
      discoveryLimit: 160,
    });
    const directLatestNews = buildDirectLatestNews(db, officialReleaseAlerts);
    const templateLatestNews = attachFeedRankings(buildLatestNews(feed, templateState, officialReleaseAlerts));
    const latestNews = directLatestNews.length ? directLatestNews : templateLatestNews;
    const normalNews = attachFeedRankings(buildNormalNews(feed));
    const rankedSections = Array.isArray(feed.sections)
      ? feed.sections.map((section) => ({
          ...section,
          items: attachFeedRankings(section.items || []),
        }))
      : [];
    const payload = {
      ...feed,
      sections: rankedSections,
      discovery_refreshed: false,
      latestNews,
      normalNews,
      feedHealth: buildFeedHealthPayload({
        discoveryStatus,
        writtenCoverage,
        officialReleaseAlerts,
        latestNews,
      }),
      refresh,
    };

    // Store in cache (skip if visualize, as visual computation adds weight)
    if (!visualize) {
      feedCache.set(feedCacheKey, { createdAt: Date.now(), payload });
    }

    return payload;
  } catch (err) {
    const cached = feedCache.get(request.user?.id || 'guest');
    if (cached?.payload?.latestNews?.length) {
      return {
        ...cached.payload,
        refresh: {
          ...buildFeedRefreshEvidence({ mode: forceRefresh ? 'forced' : 'none' }),
          recalculated: false,
          source: 'server_last_good_cache',
          status: 'fallback',
        },
        feedHealth: {
          ...(cached.payload.feedHealth || {}),
          status: 'degraded',
          degradedReason: 'last_good_feed',
          message: 'Live feed refresh failed, so eXplore is showing the last good feed instead of an empty page.',
        },
      };
    }

    if (err.code === '42P01' || (err.message && err.message.includes('no such table'))) {
      // Relation does not exist (Schema not run yet)
      return {
        sections: [
          { id: 'written-news', title: 'Written News', items: [] },
          { id: 'social-video', title: 'Social Video', items: [] },
          { id: 'social-photo', title: 'Social Photo', items: [] },
        ],
        latestNews: [],
        normalNews: [],
        feedHealth: {
          status: 'unavailable',
          degradedReason: 'database_missing',
          message: 'The content database is not ready yet.',
        },
        refresh: {
          ...buildFeedRefreshEvidence({ mode: forceRefresh ? 'forced' : 'none' }),
          recalculated: false,
          source: 'database_unavailable',
          status: 'failed',
        },
      };
    }
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

function inferChatIntentFallback(message = '') {
  const original = String(message || '').trim();
  const normalized = original.toLowerCase();

  if (!normalized) {
    return { action: 'general_chat', query: '' };
  }

  if (/\b(youtube|video|channel)\b/.test(normalized) && /\b(find|fetch|show|latest|new)\b/.test(normalized)) {
    const query = original
      .replace(/\b(find|fetch|show|latest|new|youtube|video|videos|channel)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { action: 'youtube_fetch', query };
  }

  if (/\b(hide|avoid|mute|remove|filter out|stop showing|don't show|do not show)\b/.test(normalized)) {
    const query = original
      .replace(/\b(hide|avoid|mute|remove|filter out|stop showing|don't show|do not show)\b/ig, ' ')
      .replace(/\b(from|in)\s+my\s+feed\b/ig, ' ')
      .replace(/\bnoise\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { action: 'avoid_topic', query: query || original };
  }

  if (/^(what|which|who|why|how|when|where|should|can|could|tell me|explain)\b/.test(normalized)
    || /\bwhat should i watch\b/.test(normalized)
    || normalized.endsWith('?')) {
    return { action: 'general_chat', query: '' };
  }

  if (/\b(track|follow|watch|monitor|notify me about|keep an eye on)\b/.test(normalized)) {
    const query = original
      .replace(/\b(track|follow|watch|monitor|notify me about|keep an eye on)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { action: 'track_topic', query: query || original };
  }

  return { action: 'general_chat', query: '' };
}

function normalizeChatText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isQuestionLikeChatMessage(message = '') {
  const normalized = normalizeChatText(message);
  return /^(what|which|who|why|how|when|where|should|can|could|tell me|explain)\b/.test(normalized)
    || /\bwhat should i watch\b/.test(normalized)
    || normalized.endsWith('?');
}

function hasExplicitYouTubeRequest(message = '') {
  return /\b(youtube|video|videos|channel|transcript)\b/i.test(String(message || ''));
}

function sanitizeChatIntent(intent = {}, message = '') {
  const normalizedIntent = {
    action: String(intent?.action || 'general_chat').trim(),
    query: String(intent?.query || '').trim(),
  };

  if (normalizedIntent.action === 'youtube_fetch' && !hasExplicitYouTubeRequest(message)) {
    return { action: 'general_chat', query: '' };
  }

  if (
    isQuestionLikeChatMessage(message)
    && ['track_topic', 'avoid_topic'].includes(normalizedIntent.action)
    && !/\b(track|follow|monitor|notify me about|keep an eye on|hide|avoid|mute|remove|stop showing)\b/i.test(message)
  ) {
    return { action: 'general_chat', query: '' };
  }

  return normalizedIntent;
}

function extractArticleSummaryRequest(message = '') {
  const text = String(message || '').trim();
  if (!/summarize|explain|article|source:/i.test(text)) {
    return null;
  }

  const title = text.match(/Title:\s*([^\n]+?)(?:\s+Source:|\nSource:|$)/i)?.[1]?.trim() || '';
  const source = text.match(/Source:\s*([^\n]+?)(?:\s+Content:|\nContent:|$)/i)?.[1]?.trim() || '';
  const content = text.match(/Content:\s*([\s\S]+)$/i)?.[1]?.trim() || '';

  if (!title && !content) {
    return null;
  }

  return { title, source, content };
}

function buildArticleFallbackReply(article) {
  const title = article.title || 'This article';
  const source = article.source ? ` from ${article.source}` : '';
  const content = article.content || '';
  const firstSentence = content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .find(Boolean) || content.slice(0, 180);

  const meaning = /research|biology|chemistry|genomic|medicine|life sciences/i.test(content + ' ' + title)
    ? 'Bio-research capability'
    : /release|launch|capabilit|model|AI/i.test(content + ' ' + title)
      ? 'AI capability update'
      : 'Important update';

  return `${title}${source}: ${meaning}. ${firstSentence || 'The item appears relevant because it changes what the tool or organization can do.'}`.trim();
}

function buildChatFallbackReply(intent = {}, newsContext = '', lastUserMessage = '') {
  if (intent.action === 'avoid_topic' && intent.query) {
    return `I updated your feed rules to avoid "${intent.query}". Refresh the feed and those items should be suppressed more aggressively now.`;
  }

  if (intent.action === 'track_topic' && intent.query) {
    return `I added "${intent.query}" to your tracked topics. Refresh the feed and I will prioritize it more strongly.`;
  }

  if (intent.action === 'youtube_fetch' && intent.query) {
    return `I could not complete the live YouTube lookup right now, but I understood that you want updates about "${intent.query}".`;
  }

  const article = extractArticleSummaryRequest(lastUserMessage);
  if (article) {
    return buildArticleFallbackReply(article);
  }

  const lines = [
    'Watch confirmed events first: official AI releases, real access or pricing changes, regional escalation, market filings, and direct opportunities.',
    'For AI advantage, start with OpenAI, Anthropic, Google/Gemini/DeepMind, xAI, Hugging Face, GitHub AI, Product Hunt-style tool launches, and developer pricing pages.',
    'Use Direct only for alerts that change action now; use Important for high-signal app-visible events; use Watch for silent monitoring.',
  ];

  if (newsContext) {
    lines.push('Live AI is degraded, so this answer is rule-based from the current feed and configured source map.');
  }

  return lines.join(' ');
}

// POST /chat — public AI chat endpoint with per-IP rate limiting
fastify.post('/api/v1/chat', async (request, reply) => {
  const chatRate = chatRateLimiter.check(resolveClientIp(request));
  if (!applyRateLimit(reply, chatRate, 'Too many requests. Please slow down.')) {
    return;
  }

  const { messages = [], context = 'general' } = request.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return reply.status(400).send({ error: 'messages array is required.' });
  }

  // Build a news context snippet from the in-memory feed cache if available
  let newsContext = '';
  try {
    const userId = request.user?.id || 'guest';
    const cachedFeed = feedCache.get(userId) || feedCache.get('guest');
    if (cachedFeed?.payload?.latestNews?.length) {
      const headlines = cachedFeed.payload.latestNews
        .slice(0, 5)
        .map((item, i) => `${i + 1}. ${item.title} (${item.source || 'source unknown'})`)
        .join('\n');
      newsContext = `\n\nLatest news as of ${new Date(cachedFeed.createdAt).toUTCString()}:\n${headlines}`;
    }
  } catch (_) {
    // ignore — news context is best-effort
  }

  const systemPrompt = `You are the eXplore AI assistant — a smart, direct intelligence companion built into the eXplore app.

eXplore is a personal AI news intelligence filter that surfaces only the highest-signal updates in AI releases, geopolitical developments, and topics the user cares about. It cuts through noise and delivers what actually matters.

You help users:
- Navigate the features of eXplore (feed, priority radar, template, history, saved items)
- Ask anything — you can discuss news, ideas, strategy, or answer general questions

Be concise, direct, and insightful. No filler. If asked about the latest news, use the context below.${newsContext}`;

  // Build messages array for the AI (last 12 messages max to keep context bounded)
  const recentMessages = messages.slice(-12);
  const conversationText = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').trim()}`)
    .join('\n');
  const generateChatStructuredJson = async (options = {}) => {
    try {
      return await aiService.generateStructuredJson({
        ...options,
        providerPreference: 'gemini',
        includeCoolingFallback: true,
      });
    } catch (primaryError) {
      request.log.warn(
        { error: primaryError?.message || String(primaryError || '') },
        'Gemini chat request failed, retrying with OpenAI'
      );

      return aiService.generateStructuredJson({
        ...options,
        providerPreference: 'openai',
      });
    }
  };
  const lastUserMessage = recentMessages.slice().reverse().find((message) => message.role === 'user')?.content || '';
  const userId = request.user?.id || 'guest';
  const fallbackIntent = sanitizeChatIntent(inferChatIntentFallback(lastUserMessage), lastUserMessage);
  const executeChatIntent = async (nextIntent = {}) => {
    if (!nextIntent?.action || !nextIntent?.query) {
      return '';
    }

    if (nextIntent.action === 'youtube_fetch') {
      request.log.info({ query: nextIntent.query }, 'Executing youtube_fetch action');
      const isChannel = /Ø§Ù„Ù…ÙˆØ§Ø·Ù† Ø³Ø¹ÙŠØ¯/i.test(nextIntent.query) ? 'UChc0Yw9NkSb8Thy53MsM3gw' : null;
      let videos = [];
      if (isChannel) {
        videos = await youtubeService.searchRecentVideosWithOptions({ channelId: isChannel, maxResults: 1 });
      } else {
        videos = await youtubeService.searchRecentVideosWithOptions({ query: nextIntent.query, maxResults: 1 });
      }

      if (videos && videos.length > 0) {
        const latestVideo = videos[0];
        let fullData = null;
        try {
          fullData = await youtubeService.fetchVideoData(latestVideo.url);
        } catch (error) {
          fullData = null;
        }
        if (!fullData) fullData = latestVideo;

        let summaryText = latestVideo.description || '';
        if (fullData.transcript) {
          try {
            const summary = await aiService.analyzeContent(fullData.title, fullData.transcript, fullData.description);
            summaryText = `Summary: ${summary.summary}\nTopics: ${summary.topics.join(', ')}`;
          } catch (error) {
            summaryText = latestVideo.description || '';
          }
        }
        return `\n\n[LIVE YOUTUBE FETCH RESULT]:\nTitle: ${fullData.title}\nURL: ${latestVideo.url}\n${summaryText}`;
      }

      return `\n\n[LIVE YOUTUBE FETCH RESULT]: No videos found for ${nextIntent.query}.`;
    }

    if (nextIntent.action === 'track_topic') {
      request.log.info({ query: nextIntent.query }, 'Executing track_topic action');
      const state = templateService.getTemplateState(db, userId);
      const memory = state.workspace?.workspaceMemory || { priorityTopics: [], trackedCompanies: [], peopleOfInterest: [] };
      if (!memory.priorityTopics) memory.priorityTopics = [];

      if (!memory.priorityTopics.includes(nextIntent.query)) {
        memory.priorityTopics.push(nextIntent.query);
        await templateService.saveWorkspaceDocuments(db, userId, { workspaceMemory: memory });
        feedCache.delete(userId);
        return `\n\n[SYSTEM ACTION]: Successfully added "${nextIntent.query}" to the user's tracking rules. Inform them it is now being tracked for future feeds.`;
      }

      return `\n\n[SYSTEM ACTION]: Topic "${nextIntent.query}" is already being tracked.`;
    }

    if (nextIntent.action === 'avoid_topic') {
      request.log.info({ query: nextIntent.query }, 'Executing avoid_topic action');
      const state = templateService.getTemplateState(db, userId);
      const memory = state.workspace?.workspaceMemory || { priorityTopics: [], trackedCompanies: [], peopleOfInterest: [], avoidTopics: [] };
      if (!memory.avoidTopics) memory.avoidTopics = ['Hype', 'Celebrity AI chatter', 'Repeated context'];

      if (!memory.avoidTopics.includes(nextIntent.query)) {
        memory.avoidTopics.push(nextIntent.query);
        await templateService.saveWorkspaceDocuments(db, userId, { workspaceMemory: memory });
        feedCache.delete(userId);
        return `\n\n[SYSTEM ACTION]: Successfully added "${nextIntent.query}" to the user's avoidance list. Inform them you will now hide items related to this topic from their feed.`;
      }

      return `\n\n[SYSTEM ACTION]: Topic "${nextIntent.query}" is already in the avoidance list.`;
    }

    return '';
  };

  // --- Agentic Intent Router ---
  let fetchedContext = '';
  let intent = { ...fallbackIntent };
  try {
    const lastUserMessage = recentMessages.slice().reverse().find(m => m.role === 'user')?.content || '';
    if (lastUserMessage) {
      const intentPrompt = `Analyze the user's latest message and determine if they want to:
1. "youtube_fetch": Fetch latest videos/summaries from a specific YouTube channel or topic. If so, provide "query" (e.g. channel name or topic).
2. "track_topic": Add a new rule/topic/company to their eXplore platform to track in the background. If so, provide "query" (e.g. topic name).
3. "avoid_topic": Add a topic, person, or noise keyword to their avoidance list to hide from feed results. If so, provide "query".
4. "general_chat": Standard conversation.

User Message: "${lastUserMessage}"

Return JSON: { "action": "youtube_fetch" | "track_topic" | "avoid_topic" | "general_chat", "query": "string or empty" }`;

      intent = await generateChatStructuredJson({
        temperature: 0.1,
        systemPrompt: 'You are an intent router for the eXplore AI assistant.',
        userPrompt: intentPrompt,
      });
      intent = sanitizeChatIntent(intent, lastUserMessage);

      const userId = request.user?.id || 'guest';
      
      if (intent.action === 'youtube_fetch' && intent.query) {
        request.log.info({ query: intent.query }, 'Executing youtube_fetch action');
        const isChannel = /المواطن سعيد/i.test(intent.query) ? 'UChc0Yw9NkSb8Thy53MsM3gw' : null;
        let videos = [];
        if (isChannel) {
          videos = await youtubeService.searchRecentVideosWithOptions({ channelId: isChannel, maxResults: 1 });
        } else {
          videos = await youtubeService.searchRecentVideosWithOptions({ query: intent.query, maxResults: 1 });
        }

        if (videos && videos.length > 0) {
          const latestVideo = videos[0];
          let fullData = null;
          try {
            fullData = await youtubeService.fetchVideoData(latestVideo.url);
          } catch(e) {}
          if (!fullData) fullData = latestVideo;
          
          let summaryText = latestVideo.description || '';
          if (fullData.transcript) {
            try {
              const summary = await aiService.analyzeContent(fullData.title, fullData.transcript, fullData.description);
              summaryText = `Summary: ${summary.summary}\nTopics: ${summary.topics.join(', ')}`;
            } catch(e) {}
          }
          fetchedContext = `\n\n[LIVE YOUTUBE FETCH RESULT]:\nTitle: ${fullData.title}\nURL: ${latestVideo.url}\n${summaryText}`;
        } else {
          fetchedContext = `\n\n[LIVE YOUTUBE FETCH RESULT]: No videos found for ${intent.query}.`;
        }
      } else if (intent.action === 'track_topic' && intent.query) {
        request.log.info({ query: intent.query }, 'Executing track_topic action');
        const state = templateService.getTemplateState(db, userId);
        const memory = state.workspace?.workspaceMemory || { priorityTopics: [], trackedCompanies: [], peopleOfInterest: [] };
        if (!memory.priorityTopics) memory.priorityTopics = [];

        if (!memory.priorityTopics.includes(intent.query)) {
          memory.priorityTopics.push(intent.query);
          await templateService.saveWorkspaceDocuments(db, userId, { workspaceMemory: memory });
          feedCache.delete(userId);
          fetchedContext = `\n\n[SYSTEM ACTION]: Successfully added "${intent.query}" to the user's tracking rules. Inform them it is now being tracked for future feeds.`;
        } else {
          fetchedContext = `\n\n[SYSTEM ACTION]: Topic "${intent.query}" is already being tracked.`;
        }
      } else if (intent.action === 'avoid_topic' && intent.query) {
        request.log.info({ query: intent.query }, 'Executing avoid_topic action');
        const state = templateService.getTemplateState(db, userId);
        const memory = state.workspace?.workspaceMemory || { priorityTopics: [], trackedCompanies: [], peopleOfInterest: [], avoidTopics: [] };
        if (!memory.avoidTopics) memory.avoidTopics = ['Hype', 'Celebrity AI chatter', 'Repeated context'];

        if (!memory.avoidTopics.includes(intent.query)) {
          memory.avoidTopics.push(intent.query);
          await templateService.saveWorkspaceDocuments(db, userId, { workspaceMemory: memory });
          feedCache.delete(userId);
          fetchedContext = `\n\n[SYSTEM ACTION]: Successfully added "${intent.query}" to the user's avoidance list. Inform them you will now hide items related to this topic from their feed.`;
        } else {
          fetchedContext = `\n\n[SYSTEM ACTION]: Topic "${intent.query}" is already in the avoidance list.`;
        }
      }
    }
  } catch (err) {
    request.log.error(err, 'Intent router failed');
  }

  if (!fetchedContext && intent?.action && intent?.query) {
    try {
      fetchedContext = await executeChatIntent(intent);
    } catch (err) {
      request.log.error(err, 'Intent action failed');
    }
  }
  // -----------------------------

  try {
    const finalSystemPrompt = `${systemPrompt}${fetchedContext}`;
    const result = await generateChatStructuredJson({
      temperature: 0.7,
      systemPrompt: finalSystemPrompt,
      userPrompt: `${conversationText}\n\nRespond as Assistant. Return JSON: { "reply": "string" }`,
    });

    const reply_text = String(result?.reply || result?.message || result?.response || result?.text || '').trim();
    if (!reply_text) {
      return reply.status(500).send({ error: 'AI returned an empty response.' });
    }

    return {
      reply: reply_text,
      action: String(intent?.action || 'general_chat'),
      query: String(intent?.query || ''),
    };
  } catch (error) {
    request.log.error(error, 'Chat completion failed');
    return {
      reply: buildChatFallbackReply(intent, newsContext, lastUserMessage),
      action: String(intent?.action || 'general_chat'),
      query: String(intent?.query || ''),
      fallback: true,
    };
  }
});

async function handleOfficialReleaseAlerts(request, reply) {
  try {
    const limit = parseAlertLimit(request.query?.limit, 12);
    const companiesParam = String(request.query?.companies || '').trim();
    const companies = parseCompanySelection(companiesParam);
    const releasePayload = await getPriorityAlertsWithTimeout();
    const allAlerts = Array.isArray(releasePayload.alerts) ? releasePayload.alerts : [];
    const officialAlerts = selectLatestOfficialReleaseAlerts(allAlerts, {
      limit,
      companies: companies.length ? companies : DEFAULT_RELEASE_WATCH_COMPANIES,
      minImportance: 'important',
    });
    const stableAlerts = officialAlerts.length
      ? officialAlerts.map((alert, index) => normalizeOfficialReleaseAlert(alert, index))
      : buildDirectLatestNews(db, [])
        .filter((item) => item.type === 'official_release')
        .slice(0, limit)
        .map((item) => ({
          ...item,
          category: 'ai',
          importance: 'important',
          score: item.directNewsScore,
          official_source: true,
          release_watch_signal: 'official_release',
          release_classification: 'tool_release',
        }));
    return {
      success: true,
      checkedAt: releasePayload.checkedAt || new Date().toISOString(),
      cacheAgeMs: releasePayload.cacheAgeMs || 0,
      alerts: stableAlerts,
      count: stableAlerts.length,
    };
  } catch (error) {
    request.log.error(error, 'Official release alerts failed');
    return reply.status(500).send({
      success: false,
      error: 'Official release alerts are temporarily unavailable.',
      details: error.message,
    });
  }
}

// GET /alerts/official-releases — dedicated public official-release surface
// Used by the HomeScreen latest-news feed to get real-time release-watch results
// without needing auth. Returns only official_source === true alerts sorted newest first.
fastify.get('/api/v1/alerts/official-releases', handleOfficialReleaseAlerts);
fastify.get('/api/v1/alerts/official-releases/', handleOfficialReleaseAlerts);

// GET /search
fastify.get('/api/v1/search', async (request, reply) => {
  const { q, filter } = request.query;
  if (!q) return { query: '', results: [], total: 0 };

  try {
    const safeQ = `%${q}%`;
    const rows = db.prepare(`
      SELECT c.*, s.name AS source_name
      FROM content_items c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE c.title LIKE ?
         OR c.summary LIKE ?
         OR s.name LIKE ?
         OR COALESCE(c.transcript, '') LIKE ?
         OR COALESCE(c.article_body, '') LIKE ?
         OR COALESCE(c.topic_tags_json, '') LIKE ?
         OR COALESCE(c.external_id, '') LIKE ?
      ORDER BY COALESCE(c.freshness_score, 0) DESC, COALESCE(c.depth_score, 0) DESC, COALESCE(c.publish_date, c.created_at) DESC
      LIMIT 40
    `).all(safeQ, safeQ, safeQ, safeQ, safeQ, safeQ, safeQ);

    let items = rows.map(mapItem);

    if (filter && filter !== 'All') {
      if (filter === 'Rare') items = items.filter(r => r.scores.rarity > 0.7);
      if (filter === 'Deep') items = items.filter(r => r.scores.depth > 0.8);
      if (filter === 'Timeless') items = items.filter(r => r.scores.timeless > 0.7);
      if (filter === 'Newest') items = items.filter(r => r.scores.freshness > 0.7);
    }

    return { query: q, results: items, total: items.length };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error' });
  }
});

// GET /content/:id
fastify.get('/api/v1/content/:id', async (request, reply) => {
  try {
    const { templateState } = getTemplateContextForRequest(request);
    const forceRefresh = ['1', 'true', 'yes', 'on'].includes(String(request.query?.refresh || '').toLowerCase());
    if (forceRefresh) {
      await refreshBestFeedForRequest(request, templateState, { force: true });
    }
    const feed = await templateRankingService.buildTemplateDrivenFeed(db, templateState, {
      scanLimit: 500,
      limitPerSection: 200,
      scopeUserId: request.user?.id || '',
      discoveryLimit: 180,
    });
    const item = feed.sections.flatMap((section) => section.items).find((entry) => entry.id === request.params.id || entry.external_id === request.params.id);

    if (item) {
      const detailRow = getContentRowByIdOrExternalId(item.id || item.external_id || request.params.id);
      return {
        ...item,
        intelligenceExplanation: item.intelligenceExplanation || intelligenceContract.buildExplanation({
          item: { ...item, ...detailRow },
          hierarchy: templateState?.hierarchy || {},
          workspaceMemory: templateState?.workspace?.workspaceMemory || {},
          ranking: item.ranking || {},
          source: { id: detailRow?.source_id, name: detailRow?.source_name || item.source, url: detailRow?.url || item.url, trust_tier: detailRow?.source_trust_tier },
        }),
        transcript: detailRow?.transcript || '',
        transcriptText: detailRow?.transcript || '',
        transcriptStatus: detailRow?.transcript_status || (detailRow?.transcript ? 'available' : 'missing'),
        transcriptProvider: detailRow?.transcript_provider || null,
        transcriptPreview: buildTranscriptPreview(detailRow?.transcript || ''),
        transcriptSource: detailRow?.transcript_provider || null,
        transcriptUpdatedAt: detailRow?.transcript_updated_at || detailRow?.updated_at || detailRow?.created_at || null,
      };
    }

    const row = getContentRowByIdOrExternalId(request.params.id);
    if (!row) return reply.status(404).send({ error: 'Not found' });

    const analysis = await templateRankingService.ensureAnalyzedRow(db, row);
    const mappedItem = mapItem({
      ...row,
      channel_type: analysis.channelType,
      visual_meaning_label: analysis.visualMeaningLabel,
      visual_meaning_prompt: analysis.visualMeaningPrompt,
      visual_meaning_status: analysis.visualMeaningStatus,
      visual_meaning_image_url: analysis.visualMeaningImageUrl,
      life_impact: analysis.lifeImpact,
      decision_usefulness: analysis.decisionUsefulness,
      distraction_risk: analysis.distractionRisk,
    });
    return {
      ...mappedItem,
      intelligenceExplanation: intelligenceContract.buildExplanation({
        item: { ...mappedItem, ...row },
        hierarchy: templateState?.hierarchy || {},
        workspaceMemory: templateState?.workspace?.workspaceMemory || {},
        source: { id: row.source_id, name: row.source_name || mappedItem.source, url: row.url, trust_tier: row.source_trust_tier },
      }),
      reason: row.reason_text || rankingEngine.generateReason(mapItem(row)),
      transcript: row.transcript || '',
      transcriptText: row.transcript || '',
      transcriptStatus: row.transcript_status || (row.transcript ? 'available' : 'missing'),
      transcriptProvider: row.transcript_provider || null,
      transcriptPreview: buildTranscriptPreview(row.transcript || ''),
      transcriptSource: row.transcript_provider || null,
      transcriptUpdatedAt: row.transcript_updated_at || row.updated_at || row.created_at || null,
    };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error' });
  }
});

fastify.post('/api/v1/content/:id/visualize', async (request, reply) => {
  try {
    const visualMeaning = await templateRankingService.generateVisualMeaningAsset(db, request.params.id, {
      force: ['1', 'true', 'yes', 'on'].includes(String(request.query?.force || '').toLowerCase()),
    });

    return {
      success: true,
      id: request.params.id,
      visualMeaning,
    };
  } catch (error) {
    const statusCode = error.message === 'Content not found.' ? 404 : error.message.includes('written news') ? 400 : 500;
    return reply.status(statusCode).send({
      success: false,
      error: error.message,
    });
  }
});

// POST /interactions
fastify.post('/api/v1/interactions', async (request, reply) => {
  const { content_id, action, duration_ms } = request.body;
  try {
    const userId = request.user.id;
    const newId = require('crypto').randomUUID();
    db.prepare(`
      INSERT INTO user_interactions (id, user_id, content_id, action, duration_ms) 
      VALUES (?, ?, ?, ?, ?)
    `).run(newId, userId, content_id, action, duration_ms);
    return { success: true };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

const HISTORY_TAB_ACTIONS = {
  all: ['view', 'open', 'open_source', 'save', 'dismiss', 'share', 'ask_ai'],
  viewed: ['view', 'open', 'open_source'],
  saved: ['save'],
  dismissed: ['dismiss'],
  shared: ['share'],
  asked: ['ask_ai'],
};

function normalizeHistoryTab(value = 'all') {
  const normalized = String(value || 'all').trim().toLowerCase();
  if (normalized === 'views') return 'viewed';
  if (normalized === 'dismiss') return 'dismissed';
  if (normalized === 'hidden') return 'dismissed';
  if (normalized === 'ai') return 'asked';
  if (Object.hasOwn(HISTORY_TAB_ACTIONS, normalized)) {
    return normalized;
  }
  return 'all';
}

function getHistoryActionsForTab(tab = 'all') {
  return HISTORY_TAB_ACTIONS[normalizeHistoryTab(tab)] || HISTORY_TAB_ACTIONS.all;
}

// GET /history
fastify.get('/api/v1/history', async (request, reply) => {
  try {
    const userId = request.user.id;
    const tab = normalizeHistoryTab(request.query?.tab);
    const actions = getHistoryActionsForTab(tab);
    const placeholders = actions.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT
        c.*,
        src.name AS source_name,
        MAX(ui.created_at) AS interacted_at,
        COUNT(*) AS interaction_count,
        CASE
          WHEN SUM(CASE WHEN ui.action = 'dismiss' THEN 1 ELSE 0 END) > 0 THEN 'dismiss'
          WHEN SUM(CASE WHEN ui.action = 'open_source' THEN 1 ELSE 0 END) > 0 THEN 'open_source'
          ELSE MIN(ui.action)
        END AS history_action
      FROM user_interactions ui
      JOIN content_items c ON c.id = ui.content_id
      LEFT JOIN sources src ON src.id = c.source_id
      WHERE ui.user_id = ?
        AND ui.action IN (${placeholders})
      GROUP BY c.id
      ORDER BY datetime(interacted_at) DESC, datetime(COALESCE(c.publish_date, c.created_at)) DESC
      LIMIT 100
    `).all(userId, ...actions);

    return {
      items: rows.map(mapHistoryItemRow),
      tab,
    };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

// DELETE /history
fastify.delete('/api/v1/history', async (request, reply) => {
  try {
    const userId = request.user.id;
    const requestedTab = String(request.query?.tab || 'all').trim().toLowerCase();

    if (requestedTab === 'saved') {
      return reply.status(400).send({ error: 'Saved items are managed from Saved, not History reset.' });
    }

    if (requestedTab === 'all') {
      const result = db.prepare(`
        DELETE FROM user_interactions
        WHERE user_id = ?
      `).run(userId);

      return { success: true, tab: 'all', cleared: Number(result.changes || 0) };
    }

    const tab = normalizeHistoryTab(requestedTab);
    const actions = getHistoryActionsForTab(tab);
    const placeholders = actions.map(() => '?').join(', ');
    const result = db.prepare(`
      DELETE FROM user_interactions
      WHERE user_id = ?
        AND action IN (${placeholders})
    `).run(userId, ...actions);

    return { success: true, tab, cleared: Number(result.changes || 0) };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

// ─── Saved Item Helpers & Mapping ──────────────────────────────────────────
const SAVED_ITEM_SELECT = `
  SELECT 
    s.id AS saved_id,
    s.user_id,
    s.content_id,
    s.collection_id,
    s.notes,
    s.created_at AS saved_at,
    c.*,
    src.name AS source_name
  FROM saved_items s
  JOIN content_items c ON c.id = s.content_id
  LEFT JOIN sources src ON src.id = c.source_id
`;

function getContentRowByIdOrExternalId(idOrExternalId) {
  if (!idOrExternalId) return null;
  try {
    return db.prepare(`
      SELECT c.*, s.name AS source_name, s.url AS source_url, s.trust_tier AS source_trust_tier
      FROM content_items c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE c.id = ? OR c.external_id = ?
      LIMIT 1
    `).get(idOrExternalId, idOrExternalId);
  } catch (err) {
    console.error('getContentRowByIdOrExternalId error:', err);
    return null;
  }
}

function mapItem(row) {
  if (!row) return null;
  let topics = [];
  try {
    topics = JSON.parse(row.topic_tags_json || '[]');
  } catch (_) {
    topics = [];
  }
  return {
    id: row.id,
    external_id: row.external_id || row.id,
    title: row.title,
    source: row.source_name || row.source_label || 'Unknown',
    url: row.url,
    thumbnail: row.thumbnail_url || null,
    date: row.publish_date || row.created_at,
    duration: row.duration_seconds || null,
    summary: row.summary || '',
    topics,
    contentType: row.content_type || 'video',
    channelType: row.channel_type || 'written',
    scores: {
      depth: Number(row.depth_score || 0),
      rarity: Number(row.rarity_score || 0),
      freshness: Number(row.freshness_score || 0),
      timeless: Number(row.timeless_score || 0),
      clickbait: Number(row.clickbait_score || 0),
      lifeImpact: Number(row.life_impact || 0),
      decisionUsefulness: Number(row.decision_usefulness || 0),
      distractionRisk: Number(row.distraction_risk || 0),
    },
    visualMeaning: {
      label: row.visual_meaning_label || '',
      prompt: row.visual_meaning_prompt || '',
      status: row.visual_meaning_status || 'prompt_ready',
      imageUrl: row.visual_meaning_image_url || '',
    }
  };
}

function mapHistoryItemRow(row) {
  if (!row) return null;
  const item = mapItem(row);
  return {
    ...item,
    historyAction: row.history_action || row.action || 'view',
    interactedAt: row.interacted_at || row.created_at || item?.date || null,
    interactionCount: Number(row.interaction_count || 0),
  };
}

function mapSavedItemRow(row) {
  if (!row) return null;
  return {
    id: row.saved_id,
    user_id: row.user_id,
    content_id: row.content_id,
    collection_id: row.collection_id,
    notes: row.notes || '',
    created_at: row.saved_at,
    item: mapItem(row),
  };
}

function getSavedItemForUser(userId, contentId) {
  try {
    return db.prepare(`
      ${SAVED_ITEM_SELECT}
      WHERE s.user_id = ? AND s.content_id = ?
      LIMIT 1
    `).get(userId, contentId);
  } catch (err) {
    console.error('getSavedItemForUser error:', err);
    return null;
  }
}

// GET /saved
fastify.get('/api/v1/saved', async (request, reply) => {
  try {
    const userId = request.user.id;
    const rows = db.prepare(`
      ${SAVED_ITEM_SELECT}
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
    `).all(userId);

    return { items: rows.map(mapSavedItemRow) };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error' });
  }
});

// POST /saved
fastify.post('/api/v1/saved', async (request, reply) => {
  const contentId = String(request.body?.content_id || '').trim();
  const collectionId = normalizeNullableId(request.body?.collection_id);

  if (!contentId) {
    return reply.status(400).send({ error: 'content_id is required' });
  }

  try {
    const userId = request.user.id;
    assertOwnedCollection(userId, collectionId);
    const newId = require('crypto').randomUUID();
    db.prepare(`
      INSERT INTO saved_items (id, user_id, content_id, collection_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, content_id) DO UPDATE SET
        collection_id = CASE
          WHEN excluded.collection_id IS NULL THEN saved_items.collection_id
          ELSE excluded.collection_id
        END
    `).run(newId, userId, contentId, collectionId);

    const savedItem = getSavedItemForUser(userId, contentId);
    return {
      success: true,
      item: savedItem ? mapSavedItemRow(savedItem) : null,
    };
  } catch (err) {
    request.log.error(err);
    return reply.status(err.statusCode || 500).send({ error: err.message || 'Database Error' });
  }
});

// PUT /saved/:id
fastify.put('/api/v1/saved/:id', async (request, reply) => {
  const userId = request.user.id;
  const contentId = String(request.params.id || '').trim();
  const collectionId = normalizeNullableId(request.body?.collection_id);
  const hasNotes = Object.prototype.hasOwnProperty.call(request.body || {}, 'notes');
  const notes = hasNotes ? String(request.body?.notes || '').trim() : undefined;

  try {
    const existing = getSavedItemForUser(userId, contentId);
    if (!existing) {
      return reply.status(404).send({ error: 'Saved item not found.' });
    }

    if (collectionId === undefined && !hasNotes) {
      return {
        success: true,
        saved_item: mapSavedItemRow(existing),
      };
    }

    assertOwnedCollection(userId, collectionId);

    const sets = [];
    const values = [];

    if (collectionId !== undefined) {
      sets.push('collection_id = ?');
      values.push(collectionId);
    }

    if (hasNotes) {
      sets.push('notes = ?');
      values.push(notes || null);
    }

    db.prepare(`
      UPDATE saved_items
      SET ${sets.join(', ')}
      WHERE user_id = ? AND content_id = ?
    `).run(...values, userId, contentId);

    const updated = getSavedItemForUser(userId, contentId);
    return {
      success: true,
      saved_item: updated ? mapSavedItemRow(updated) : null,
    };
  } catch (err) {
    request.log.error(err);
    return reply.status(err.statusCode || 500).send({ error: err.message || 'Database Error' });
  }
});

// DELETE /saved/:id
fastify.delete('/api/v1/saved/:id', async (request, reply) => {
  try {
    const userId = request.user.id;
    db.prepare('DELETE FROM saved_items WHERE user_id = ? AND content_id = ?').run(userId, request.params.id);
    return { success: true };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error' });
  }
});

// ─── GET /preferences ────────────────────────────────────────────────
fastify.get('/api/v1/preferences', async (request, reply) => {
  try {
    const userId = request.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const interests = db.prepare(`
      SELECT i.*, t.name AS topic_name, t.slug AS topic_slug, t.icon
      FROM interests i
      JOIN topics t ON t.id = i.topic_id
      WHERE i.user_id = ?
      ORDER BY i.weight DESC
    `).all(userId);

    return {
      theme: user.theme,
      depth_pref: user.depth_pref,
      rarity_pref: user.rarity_pref,
      length_pref: user.length_pref,
      onboarding: Boolean(user.onboarding),
      interests: interests.map(i => ({
        id: i.id,
        topic_id: i.topic_id,
        name: i.topic_name,
        slug: i.topic_slug,
        icon: i.icon,
        weight: i.weight,
      })),
    };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

// ─── PUT /preferences ────────────────────────────────────────────────
fastify.put('/api/v1/preferences', async (request, reply) => {
  try {
    const userId = request.user.id;
    const { theme, depth_pref, rarity_pref, length_pref, interests } = request.body;

    // Update user prefs
    const sets = [];
    const vals = [];
    if (theme !== undefined) { sets.push('theme = ?'); vals.push(theme); }
    if (depth_pref !== undefined) { sets.push('depth_pref = ?'); vals.push(depth_pref); }
    if (rarity_pref !== undefined) { sets.push('rarity_pref = ?'); vals.push(rarity_pref); }
    if (length_pref !== undefined) { sets.push('length_pref = ?'); vals.push(length_pref); }

    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(userId);
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }

    // Bulk-update interests if provided
    if (Array.isArray(interests)) {
      for (const interest of interests) {
        if (interest.topic_id && interest.weight !== undefined) {
          db.prepare(`
            INSERT INTO interests (id, user_id, topic_id, weight)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, topic_id) DO UPDATE SET weight = excluded.weight
          `).run(require('crypto').randomUUID(), userId, interest.topic_id, interest.weight);
        }
      }
    }

    return { success: true };
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Database Error', details: err.message });
  }
});

// --- GET /api/v1/preferences/notifications ---
fastify.get('/api/v1/preferences/notifications', async (request, reply) => {
  try {
    const preferences = getNotificationPreferences(db, request.user.id);
    return buildNotificationStatusResponse(db, request.user.id, preferences);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

fastify.get('/api/v1/devices/notification-status', async (request, reply) => {
  try {
    const preferences = getNotificationPreferences(db, request.user.id);
    return buildNotificationStatusResponse(db, request.user.id, preferences);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

fastify.put('/api/v1/preferences/notifications', async (request, reply) => {
  try {
    const preferences = updateNotificationPreferences(db, request.user.id, request.body || {});
    await supabaseRuntimeStore.upsertNotificationPreferences(request.user.id, preferences);
    return {
      success: true,
      preferences: buildNotificationStatusResponse(db, request.user.id, preferences),
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

// ─── POST /api/v1/devices/push-token ────────────────────────────────
// Registers a push token for the signed-in user's device.
fastify.post('/api/v1/devices/push-token', async (request, reply) => {
  if (!request.user?.id) {
    return reply.status(401).send({ error: 'Sign in required.' });
  }

  const { token, platform, device_id, app_version } = request.body || {};
  if (!token) {
    return reply.status(400).send({ error: 'token is required' });
  }

  try {
    const device = upsertDeviceToken(db, request.user.id, {
      token,
      platform,
      device_id,
      app_version,
    });
    await supabaseRuntimeStore.upsertDeviceToken(request.user.id, {
      token,
      platform,
      device_id,
      app_version,
    });

    return {
      success: true,
      device,
      preferences: buildNotificationStatusResponse(
        db,
        request.user.id,
        getNotificationPreferences(db, request.user.id),
      ),
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

// ─── DELETE /api/v1/devices/push-token ───────────────────────────────
// Deactivates a push token when the user turns off alerts.
fastify.delete('/api/v1/devices/push-token', async (request, reply) => {
  if (!request.user?.id) {
    return reply.status(401).send({ error: 'Sign in required.' });
  }

  const { token, device_id } = request.body || {};
  if (!token && !device_id) {
    return reply.status(400).send({ error: 'token or device_id is required' });
  }

  try {
    deactivateDeviceToken(db, request.user.id, { token, device_id });
    await supabaseRuntimeStore.deactivateDeviceToken(request.user.id, { token, device_id });
    return { success: true };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

// ─── GET /api/v1/sources ─────────────────────────────────────────────
// Returns the list of user-configured + system sources.
fastify.post('/api/v1/devices/private-message-notification', async (request, reply) => {
  if (!request.user?.id) {
    return reply.status(401).send({ error: 'Sign in required.' });
  }

  try {
    return await dispatchPrivateMessageNotification(db, {
      conversationId: request.body?.conversation_id,
      messageId: request.body?.message_id,
      senderId: request.user.id,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      error: 'Private-message notification failed.',
    });
  }
});

fastify.get('/api/v1/sources', async (request, reply) => {
  try {
    const userId = request.user?.id || '';
    const rows = db.prepare(`
      SELECT
        s.id,
        s.platform,
        s.name,
        s.url,
        s.active,
        us.trusted,
        us.muted
      FROM sources s
      LEFT JOIN user_sources us
        ON us.source_id = s.id AND us.user_id = ?
      ORDER BY us.trusted DESC, s.name ASC
    `).all(userId);

    return {
      success: true,
      sources: rows,
      count: rows.length,
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

// ─── PUT /api/v1/sources/:id ──────────────────────────────────────────
// Upserts the user_sources trust / mute flag for a source.
fastify.put('/api/v1/sources/:id', async (request, reply) => {
  if (!request.user?.id) {
    return reply.status(401).send({ error: 'Sign in required.' });
  }

  try {
    const sourceId = String(request.params?.id || '').trim();
    if (!sourceId) {
      return reply.status(400).send({ error: 'source id is required' });
    }

    const { trusted, muted } = request.body || {};
    db.prepare(`
      INSERT INTO user_sources (user_id, source_id, trusted, muted, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, source_id) DO UPDATE SET
        trusted    = excluded.trusted,
        muted      = excluded.muted,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      request.user.id,
      sourceId,
      trusted !== undefined ? Number(Boolean(trusted)) : null,
      muted   !== undefined ? Number(Boolean(muted))   : null,
    );

    return { success: true };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Database Error', details: error.message });
  }
});

// ─── Server startup ───────────────────────────────────────────────────
const serverPort = Number(process.env.PORT || 8080);
const serverHost = String(process.env.HOST || '0.0.0.0');

function startServer() {
  fastify.listen({ port: serverPort, host: serverHost }, (err) => {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }

    fastify.log.info(`eXplore backend listening on ${serverHost}:${serverPort}`);

    // Embedded alert worker
    if (EMBED_ALERT_WORKER) {
      fastify.log.info('Starting embedded alert radar worker...');
      void (async () => {
        try {
          const { startContinuousLoop } = require('./pushWorker');
          await startContinuousLoop({ db, log: fastify.log });
        } catch (workerError) {
          fastify.log.error(workerError, 'Embedded alert worker failed to start');
        }
      })();
    }

    // Embedded discovery worker
    if (EMBED_DISCOVERY_WORKER) {
      fastify.log.info('Starting embedded discovery worker...');
      void (async () => {
        try {
          await startDiscoveryContinuousLoop({ db, log: fastify.log });
        } catch (workerError) {
          fastify.log.error(workerError, 'Embedded discovery worker failed to start');
        }
      })();
    }
  });
}

if (require.main === module || process.env.VERCEL_SERVICE_TYPE === 'web') {
  startServer();
}

module.exports = fastify;
module.exports.startServer = startServer;
// Touched to trigger watcher reload with ALLOW_DEV_MOCKS=true
      
