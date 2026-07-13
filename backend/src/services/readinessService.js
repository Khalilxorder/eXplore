'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSourceRegistry } = require('../../services/sourceRegistry');
const { getLastLiveProbe, getModelPoolStatus } = require('../../services/aiService');
const { SUPABASE_URL, SUPABASE_ANON_KEY, isUsableSupabaseServiceKey } = require('../auth/supabaseAuth');
const { getLastGoogleAuthProbe } = require('./authProviderReadinessService');
const { getDiscoveryStatus } = require('./feedDiscoveryService');
const { getEventSourceMapSummary } = require('./eventSourceMapService');
const { buildPrivateMessagingReadiness } = require('./privateMessagingReadinessService');
const {
  ALERT_WORKER_NAME,
  getPushActivationStatus,
  getWorkerRuntimeStatus,
  hasPushCredentials,
} = require('./pushDeliveryService');
const { getPublicMetaAppConfig } = require('./metaInboxService');
const { getWrittenNewsCoverageState } = require('./writtenNewsService');
const intelligenceContract = require('./intelligenceContract');
const topicService = require('./topicService');

const DEFAULT_WRITTEN_FEEDS = [
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
];

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function hasYouTubeApiKey() {
  if (process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEYS) {
    return true;
  }

  for (let index = 1; index <= 10; index += 1) {
    if (process.env[`YOUTUBE_API_KEY_${index}`]) {
      return true;
    }
  }

  return false;
}

function normalizeSourceReadiness(status) {
  if (status === 'configured') {
    return 'live';
  }

  if (status === 'partial' || status === 'planned_ready') {
    return 'partial';
  }

  return 'unavailable';
}

function countRows(db, sql, params = []) {
  try {
    return Number(db.prepare(sql).get(...params)?.count || 0);
  } catch (error) {
    return 0;
  }
}

function getConfiguredWrittenFeeds() {
  const configured = String(process.env.WRITTEN_NEWS_FEEDS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_WRITTEN_FEEDS;
}

function buildSourceReadiness() {
  const items = buildSourceRegistry().map((source) => ({
    ...source,
    readiness: normalizeSourceReadiness(source.status),
    actionable: source.status === 'configured' || source.status === 'partial',
  }));

  const configured = items.filter((item) => item.status === 'configured').length;
  const partial = items.filter((item) => item.status === 'partial').length;
  const plannedReady = items.filter((item) => item.status === 'planned_ready').length;
  const live = items.filter((item) => item.readiness === 'live').length;
  const partialReady = items.filter((item) => item.readiness === 'partial').length;
  const unavailable = items.filter((item) => item.readiness === 'unavailable').length;

  let status = 'unavailable';
  if (live > 0) {
    status = unavailable === 0 ? 'live' : 'partial';
  } else if (partialReady > 0) {
    status = 'partial';
  }

  return {
    status,
    items,
    summary: {
      total: items.length,
      configured,
      partial,
      planned_ready: plannedReady,
      live,
      readiness_partial: partialReady,
      unavailable,
    },
    message: status === 'live'
      ? 'All configured source integrations are ready to ingest.'
      : status === 'partial'
        ? 'Some source integrations are ready, while others still need credentials or setup.'
        : 'No source integrations are ready yet.',
  };
}

function buildRuntimeReadiness(dataBackend = 'sqlite') {
  const sqliteBridgeActive = true;
  const postgresRequested = dataBackend === 'postgres';

  return {
    status: postgresRequested ? 'partial' : 'live',
    backend_reachable: true,
    data_backend: dataBackend,
    runtime_adapter: 'sqlite',
    sqlite_bridge_active: sqliteBridgeActive,
    beta_ready: false,
    deployment_mode: postgresRequested ? 'postgres_requested_sqlite_runtime_active' : 'local_bridge',
    message: postgresRequested
      ? 'Postgres is configured as the target backend, but this runtime is still using the SQLite bridge.'
      : 'SQLite is acting as the active local runtime.',
  };
}

function buildAuthReadiness(user = null) {
  const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

  return {
    status: configured ? (user?.id ? 'live' : 'partial') : 'unavailable',
    configured,
    signed_in: Boolean(user?.id),
    provider: 'supabase',
    user_id: user?.id || '',
    email: user?.email || '',
    message: !configured
      ? 'Supabase auth is not configured yet.'
      : user?.id
        ? 'This device is signed in through Supabase.'
        : 'Supabase auth is configured, but this device is not signed in.',
  };
}

function buildWrittenNewsReadiness(db) {
  const feedCount = getConfiguredWrittenFeeds().length;
  const coverage = getWrittenNewsCoverageState(db);
  const articleCount = Number(coverage.article_count || 0);
  const modelPool = getModelPoolStatus();
  const aiSummaryReady = Boolean(modelPool.gemini.configured || modelPool.openai.configured);
  const aiProvider = modelPool.activeProvider === 'mock' ? '' : modelPool.activeProvider;
  const hasCoverageCheck = Boolean(coverage.checked_at);
  const coverageAppearsLive = coverage.reachable_feed_count > 0
    || (!hasCoverageCheck && articleCount > 0 && Number(coverage.failure_count || 0) === 0);

  let status = 'unavailable';
  if (coverageAppearsLive && articleCount > 0 && aiSummaryReady) {
    status = 'live';
  } else if (feedCount > 0 || articleCount > 0 || coverage.failure_count > 0) {
    status = 'partial';
  }

  let message = coverage.message;
  if (!aiSummaryReady && (coverageAppearsLive || articleCount > 0)) {
    message = 'Written sources are reachable, but AI summarization is not configured yet.';
  } else if (status === 'live') {
    message = `Written news feeds and AI summarization are ready${aiProvider ? ` through ${aiProvider}.` : '.'}`;
  }

  return {
    status,
    feed_count: feedCount,
    reachable_feed_count: Number(coverage.reachable_feed_count || 0),
    failure_count: Number(coverage.failure_count || 0),
    article_count: articleCount,
    ai_summary_ready: aiSummaryReady,
    ai_provider: aiProvider,
    last_checked_at: coverage.checked_at || '',
    all_feeds_failed: Boolean(coverage.all_feeds_failed),
    failures: Array.isArray(coverage.failures) ? coverage.failures.slice(0, 3) : [],
    message,
  };
}

function buildPushReadiness(db, user = null) {
  const configured = hasPushCredentials();
  const signedIn = Boolean(user?.id);
  const activation = user?.id
    ? getPushActivationStatus(db, user.id)
    : {
        alerts_enabled: false,
        ai_enabled: true,
        geo_enabled: false,
        push_enabled: false,
        local_fallback_enabled: false,
        push_registered: false,
        push_configured: configured,
        active_device_count: 0,
      };
  const worker = getWorkerRuntimeStatus(db, ALERT_WORKER_NAME);
  const lastCompletedMs = worker.last_completed_at ? Date.parse(worker.last_completed_at) : NaN;
  const workerRecent = Number.isFinite(lastCompletedMs)
    ? (Date.now() - lastCompletedMs) <= 15 * 60 * 1000
    : false;
  const workerHealthy = worker.last_status === 'running'
    || (worker.last_status === 'success' && workerRecent);
  const workerExplicitFailure = worker.last_status === 'error';
  const pushFullyEnabled = Boolean(
    activation.alerts_enabled
      && activation.push_enabled
      && activation.push_registered
  );
  const pushLive = Boolean(
    configured
      && pushFullyEnabled
      && workerRecent
      && workerHealthy
      && !workerExplicitFailure
  );
  let message = 'Firebase push is not configured yet; no automatic delivery path is active.';

  let status = 'unavailable';
  if (pushLive) {
    status = 'live';
  } else if (configured || activation.push_registered || activation.local_fallback_enabled || worker.last_status !== 'never_run') {
    status = 'partial';
  }

  let workerSummary = null;
  if (worker.last_summary_json) {
    try {
      workerSummary = JSON.parse(worker.last_summary_json);
    } catch (error) {
      workerSummary = null;
    }
  }

  if (configured) {
    if (!signedIn) {
      message = 'Firebase push is configured, but this device is not signed in, so hosted push is inactive.';
    } else if (pushLive) {
      message = 'Firebase push is configured, this account has a registered device, alerts are enabled, and the alert worker is healthy.';
    } else if (pushFullyEnabled) {
      message = !workerRecent || !workerHealthy
        ? 'Firebase push is configured and a device is registered, but the alert worker is stale or unhealthy.'
        : 'Firebase push is configured and a device is registered, but the worker is not fully active yet.';
    } else if (activation.alerts_enabled) {
      message = 'Priority Radar is enabled for this account, but this device has not completed push registration yet.';
    } else if (activation.push_registered) {
      message = 'Firebase push is configured and a device is registered, but hosted push is still turned off for this account.';
    } else {
      message = 'Firebase push is configured, but alerts are turned off for this account.';
    }
  } else if (activation.local_fallback_enabled) {
    message = 'Firebase push is not configured yet; eXplore is in local fallback mode only.';
  }

  return {
    status,
    push_configured: configured,
    push_registered: activation.push_registered,
    alerts_enabled: activation.alerts_enabled,
    push_enabled: activation.push_enabled,
    local_fallback_enabled: activation.local_fallback_enabled,
    registered_device_count: activation.active_device_count,
    delivery_mode: pushLive ? 'hosted_push_primary' : (activation.local_fallback_enabled ? 'local_fallback_only' : 'disabled'),
    worker: {
      name: worker.worker_name,
      loop_mode: worker.loop_mode,
      last_status: worker.last_status,
      last_started_at: worker.last_started_at,
      last_completed_at: worker.last_completed_at,
      last_error: worker.last_error || '',
      heartbeat_at: worker.heartbeat_at,
      recent: workerRecent,
      healthy: workerHealthy,
      last_summary: workerSummary,
    },
    message,
  };
}

function buildMetaReadiness(db, user = null) {
  const app = getPublicMetaAppConfig();
  const readyChannels = user?.id
    ? countRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM meta_channel_connections
          WHERE user_id = ? AND status = 'ready'
        `,
        [user.id],
      )
    : 0;
  const setupRequiredChannels = user?.id
    ? countRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM meta_channel_connections
          WHERE user_id = ?
            AND status IN ('selection_required', 'needs_setup', 'error')
        `,
        [user.id],
      )
    : 0;

  const configScore = [
    app.auth_ready,
    app.webhook_ready,
    app.login_config_ready,
    app.backend_public_url_ready,
    app.secret_ready,
  ].filter(Boolean).length;
  let status = 'unavailable';

  if (app.status === 'live' && readyChannels > 0) {
    status = 'live';
  } else if (configScore > 0 || readyChannels > 0 || setupRequiredChannels > 0) {
    status = 'partial';
  }

  return {
    status,
    app,
    connected_channel_count: readyChannels + setupRequiredChannels,
    ready_channel_count: readyChannels,
    setup_required_count: setupRequiredChannels,
    message: status === 'live'
      ? 'Meta inbox credentials and at least one live channel are connected.'
      : status === 'partial'
        ? 'Meta inbox is only partially configured. Finish app credentials, webhook setup, and live channel connection before treating it as production-ready.'
        : 'Meta inbox is unavailable until app credentials are configured.',
  };
}

function buildDiscoveryReadiness(db, user = null) {
  const discovery = getDiscoveryStatus(db, user?.id || '');
  const youtubeConfigured = hasYouTubeApiKey();
  const worker = getWorkerRuntimeStatus(db, 'best_feed_discovery');
  const lastCompletedMs = worker.last_completed_at ? Date.parse(worker.last_completed_at) : NaN;
  const workerRecent = Number.isFinite(lastCompletedMs)
    ? (Date.now() - lastCompletedMs) <= 20 * 60 * 1000
    : false;
  const workerHealthy = worker.last_status === 'running'
    || (worker.last_status === 'success' && workerRecent);
  const workerSummary = worker.last_summary_json
    ? (() => {
        try {
          return JSON.parse(worker.last_summary_json);
        } catch (error) {
          return null;
        }
      })()
    : null;

  let status = 'unavailable';
  if (discovery.status === 'live' && workerHealthy) {
    status = 'live';
  } else if (youtubeConfigured || discovery.status === 'partial' || worker.last_status !== 'never_run') {
    status = 'partial';
  }

  return {
    status,
    scope_key: discovery.scope_key,
    scope_mode: user?.id ? 'signed_in_user' : 'public_fallback',
    youtube_api_configured: youtubeConfigured,
    tracked_channel_count: discovery.tracked_channel_count,
    topic_monitor_count: discovery.topic_monitor_count,
    live_source_count: discovery.live_source_count,
    stale_source_count: discovery.stale_source_count,
    candidate_count: discovery.candidate_count,
    last_refresh_at: discovery.last_refresh_at,
    tracked_channels: discovery.tracked_channels,
    topic_monitors: discovery.topic_monitors,
    source_health: discovery.source_health,
    worker: {
      name: worker.worker_name,
      loop_mode: worker.loop_mode,
      last_status: worker.last_status,
      last_started_at: worker.last_started_at,
      last_completed_at: worker.last_completed_at,
      last_error: worker.last_error || '',
      heartbeat_at: worker.heartbeat_at,
      healthy: workerHealthy,
      recent: workerRecent,
      last_summary: workerSummary,
    },
    message: discovery.candidate_count > 0 && workerHealthy
      ? 'Best Feed discovery is generating ranked YouTube candidates on a live worker loop.'
      : youtubeConfigured
        ? 'YouTube discovery is configured, but it still needs fresh worker output or more tracked sources.'
        : 'YouTube discovery needs a valid API key before it can generate a live Best Feed.',
  };
}

function buildIntelligenceReadiness(db, user = null) {
  let schemaReady = false;
  try {
    intelligenceContract.ensureTables(db);
    topicService.ensureTables(db);
    schemaReady = true;
  } catch (error) {
    schemaReady = false;
  }

  const topicCount = schemaReady
    ? countRows(db, 'SELECT COUNT(*) AS count FROM topics WHERE owner_user_id IS NULL OR owner_user_id = ?', [user?.id || ''])
    : 0;
  const explanationCount = schemaReady
    ? countRows(db, "SELECT COUNT(*) AS count FROM recommendation_reasons WHERE reason_type = 'intelligence_explanation' AND (user_id = ? OR user_id = 'guest')", [user?.id || ''])
    : 0;
  const evidenceCount = schemaReady
    ? countRows(db, 'SELECT COUNT(*) AS count FROM user_theory_evidence WHERE user_id = ?', [user?.id || ''])
    : 0;
  const status = !schemaReady ? 'unavailable' : (topicCount > 0 || explanationCount > 0 || evidenceCount > 0 ? 'live' : 'partial');

  return {
    status,
    schema_ready: schemaReady,
    explanation_schema_version: intelligenceContract.EXPLANATION_SCHEMA_VERSION,
    topic_count: topicCount,
    explanation_count: explanationCount,
    theory_evidence_count: evidenceCount,
    message: status === 'live'
      ? 'Personal intelligence has canonical explanations, topic state, and feedback evidence for this scope.'
      : status === 'partial'
        ? 'The intelligence spine is installed, but this account has not accumulated enough topic, explanation, or feedback evidence yet.'
        : 'The intelligence spine schema is not available in this runtime.',
  };
}

function buildSurfaceReadiness(db, user = null, sections = {}) {
  const totalContentItems = countRows(db, 'SELECT COUNT(*) AS count FROM content_items');
  const writtenItems = countRows(
    db,
    `
      SELECT COUNT(*) AS count
      FROM content_items
      WHERE content_type = 'article' OR channel_type = 'written'
    `
  );
  const radarItems = countRows(db, 'SELECT COUNT(*) AS count FROM priority_alerts');
  const savedItems = user?.id ? countRows(db, 'SELECT COUNT(*) AS count FROM saved_items WHERE user_id = ?', [user.id]) : 0;
  const interactionItems = user?.id ? countRows(db, 'SELECT COUNT(*) AS count FROM user_interactions WHERE user_id = ?', [user.id]) : 0;
  const subscriptionCount = user?.id
    ? countRows(db, 'SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ?', [user.id])
    : 0;
  const familyGroupCount = user?.id
    ? countRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM families
          WHERE owner_id = ?
             OR id IN (
               SELECT family_id
               FROM family_members
               WHERE user_id = ?
             )
        `,
        [user.id, user.id]
      )
    : 0;
  const referralCount = user?.id
    ? countRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM referrals
          WHERE referrer_id = ? OR referee_id = ?
        `,
        [user.id, user.id]
      )
    : 0;

  const pushLive = sections?.push?.status === 'live';
  const metaStatus = sections?.meta?.status || 'unavailable';
  const writtenStatus = sections?.written_news?.status || (writtenItems > 0 ? 'partial' : 'unavailable');
  const discoveryStatus = sections?.discovery?.status || 'unavailable';
  const discoveryCandidateCount = Number(sections?.discovery?.candidate_count || 0);

  return {
    priority_radar: {
      status: radarItems > 0 ? (pushLive ? 'live' : 'partial') : 'unavailable',
      message: radarItems > 0
        ? (pushLive
            ? 'Radar feed is populated and push path is active.'
            : 'Radar feed is populated, but push activation is still partial.')
        : 'No qualifying radar alerts are cached yet.',
      alert_count: radarItems,
    },
    written_brief: {
      status: writtenStatus,
      message: writtenStatus === 'live'
        ? 'Written brief has live source coverage and AI summarization.'
        : writtenStatus === 'partial'
          ? 'Written brief is available but still partially configured.'
          : 'Written brief has no live written coverage yet.',
      article_count: writtenItems,
    },
    explore_feed: {
      status: discoveryCandidateCount > 0
        ? 'live'
        : (totalContentItems > 0 ? 'partial' : 'unavailable'),
      message: discoveryCandidateCount > 0
        ? 'eXplore feed is using ranked discovery candidates.'
        : totalContentItems > 0
          ? 'eXplore feed has indexed content, but Best Feed discovery is still partial.'
          : 'eXplore feed has no indexed content yet.',
      content_count: totalContentItems,
    },
    best_feed: {
      status: discoveryStatus,
      message: discoveryStatus === 'live'
        ? 'Best Feed is actively ranking fresh YouTube candidates.'
        : discoveryStatus === 'partial'
          ? 'Best Feed setup exists, but discovery coverage is still partial.'
          : 'Best Feed has no live discovery output yet.',
      candidate_count: discoveryCandidateCount,
    },
    search: {
      status: discoveryCandidateCount > 0
        ? 'live'
        : (totalContentItems > 0 ? 'partial' : 'unavailable'),
      message: discoveryCandidateCount > 0
        ? 'Search runs against indexed and ranked content.'
        : totalContentItems > 0
          ? 'Search has indexed content, but discovery breadth is still partial.'
          : 'Search has no indexed corpus yet.',
      indexed_count: totalContentItems,
    },
    saved: {
      status: !user?.id ? 'partial' : (savedItems > 0 ? 'live' : 'partial'),
      message: !user?.id
        ? 'Sign in to access saved items.'
        : savedItems > 0
          ? 'Saved items are active for this account.'
          : 'No items are saved yet for this account.',
      saved_count: savedItems,
    },
    history: {
      status: !user?.id ? 'partial' : (interactionItems > 0 ? 'live' : 'partial'),
      message: !user?.id
        ? 'Sign in to access history.'
        : interactionItems > 0
          ? 'Interaction history is active for this account.'
          : 'No history has been recorded for this account yet.',
      interaction_count: interactionItems,
    },
    unified_inbox: {
      status: metaStatus,
      message: metaStatus === 'live'
        ? 'Unified Inbox is live.'
        : metaStatus === 'partial'
          ? 'Unified Inbox requires additional setup.'
          : 'Unified Inbox is unavailable until Meta setup is complete.',
    },
    intelligence: {
      status: sections?.intelligence?.status || 'unavailable',
      message: sections?.intelligence?.message || 'Personal intelligence readiness has not been checked yet.',
      explanation_schema_version: sections?.intelligence?.explanation_schema_version || '',
    },
    subscription: {
      status: !user?.id ? 'partial' : (subscriptionCount > 0 ? 'live' : 'partial'),
      message: !user?.id
        ? 'Sign in to access subscription state.'
        : subscriptionCount > 0
          ? 'Subscription state is live for this account.'
          : 'No live subscription record exists for this account yet.',
    },
    family: {
      status: !user?.id ? 'partial' : (familyGroupCount > 0 ? 'live' : 'partial'),
      message: !user?.id
        ? 'Sign in to access Family.'
        : familyGroupCount > 0
          ? 'Family data is live for this account.'
          : 'No live family group exists for this account yet.',
      family_group_count: familyGroupCount,
    },
    referrals: {
      status: !user?.id ? 'partial' : (referralCount > 0 ? 'live' : 'partial'),
      message: !user?.id
        ? 'Sign in to access referral rewards.'
        : referralCount > 0
          ? 'Referral state is live for this account.'
          : 'No live referral records exist for this account yet.',
      referral_record_count: referralCount,
    },
    template: {
      status: totalContentItems > 0 ? 'partial' : 'unavailable',
      message: totalContentItems > 0
        ? 'Template controls are available against the live corpus, but quality still depends on source coverage.'
        : 'Template controls are visible, but there is no live corpus to shape yet.',
    },
  };
}

function getReleaseApkMetadata() {
  const canonicalApk = path.join(PROJECT_ROOT, 'releases', 'eXplore-release.apk');
  const publicApk = path.join(PROJECT_ROOT, 'public', 'downloads', 'eXplore-release.apk');
  const publicAab = path.join(PROJECT_ROOT, 'public', 'downloads', 'eXplore-release.aab');
  const webBuildMetaPath = path.join(PROJECT_ROOT, 'out', '__explore_build.json');
  const androidAssetBuildMetaPath = path.join(PROJECT_ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', '__explore_build.json');

  const readJson = (filePath) => {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return null;
    }
  };

  const statFile = (filePath) => {
    try {
      return fs.statSync(filePath);
    } catch (error) {
      return null;
    }
  };

  const apkStats = statFile(canonicalApk);
  const publicApkStats = statFile(publicApk);
  const publicAabStats = statFile(publicAab);
  const webBuild = readJson(webBuildMetaPath);
  const androidAssetBuild = readJson(androidAssetBuildMetaPath);
  const expectedBuildId = androidAssetBuild?.buildId || webBuild?.buildId || '';
  const localBuildIdsMatch = Boolean(
    expectedBuildId
      && webBuild?.buildId
      && androidAssetBuild?.buildId
      && webBuild.buildId === androidAssetBuild.buildId
  );
  const installAssetExists = Boolean(apkStats || publicApkStats);

  return {
    apk_path: canonicalApk,
    apk_exists: Boolean(apkStats),
    apk_size_bytes: apkStats?.size || 0,
    apk_updated_at: apkStats?.mtime ? apkStats.mtime.toISOString() : '',
    public_apk_path: publicApk,
    public_apk_exists: Boolean(publicApkStats),
    public_apk_size_bytes: publicApkStats?.size || 0,
    public_apk_updated_at: publicApkStats?.mtime ? publicApkStats.mtime.toISOString() : '',
    public_apk_url: '/downloads/eXplore-release.apk',
    public_aab_path: publicAab,
    public_aab_exists: Boolean(publicAabStats),
    public_aab_size_bytes: publicAabStats?.size || 0,
    public_aab_url: '/downloads/eXplore-release.aab',
    expected_build_id: expectedBuildId,
    web_build_id: webBuild?.buildId || '',
    android_asset_build_id: androidAssetBuild?.buildId || '',
    build_ids_match: localBuildIdsMatch,
    install_asset_exists: installAssetExists,
    install_asset_ready: Boolean(installAssetExists && (localBuildIdsMatch || publicApkStats)),
  };
}

function buildRequirement(id, label, status, message, evidence = {}, blockers = []) {
  return {
    id,
    label,
    status,
    message,
    evidence,
    blockers: blockers.filter(Boolean),
  };
}

function hasConfiguredEnv(name) {
  return String(process.env[name] || '').trim().length > 0;
}

function buildActivationItem(id, label, status, evidence = {}, actions = []) {
  return {
    id,
    label,
    status,
    evidence,
    actions: actions.filter(Boolean),
  };
}

function buildActivationReadiness({ db, user = null } = {}) {
  const modelPool = getModelPoolStatus();
  const liveProbe = getLastLiveProbe();
  const googleAuthProbe = getLastGoogleAuthProbe();
  const push = buildPushReadiness(db, user);
  const privateMessaging = buildPrivateMessagingReadiness({ db, user });

  const geminiLive = liveProbe.status === 'live' && liveProbe.provider === 'gemini';
  const googleClientConfigured = hasConfiguredEnv('GOOGLE_OAUTH_CLIENT_ID')
    || hasConfiguredEnv('GOOGLE_CLIENT_ID')
    || hasConfiguredEnv('SUPABASE_AUTH_GOOGLE_CLIENT_ID');
  const googleSecretConfigured = hasConfiguredEnv('GOOGLE_OAUTH_CLIENT_SECRET')
    || hasConfiguredEnv('GOOGLE_CLIENT_SECRET')
    || hasConfiguredEnv('SUPABASE_AUTH_GOOGLE_CLIENT_SECRET');
  const googleKnownLive = String(process.env.SUPABASE_AUTH_GOOGLE_ENABLED || '').toLowerCase() === 'true'
    || (googleAuthProbe.status === 'live' && googleAuthProbe.enabled === true);
  const supabaseManagementConfigured = hasConfiguredEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseServiceRoleConfigured = isUsableSupabaseServiceKey();

  const items = [
    buildActivationItem(
      'gemini_live_key',
      'Gemini Live Key',
      geminiLive ? 'live' : (modelPool.gemini?.availableKeys > 0 ? 'partial' : 'blocked'),
      {
        configured_keys: modelPool.gemini?.configuredKeys || 0,
        available_keys: modelPool.gemini?.availableKeys || 0,
        cooling_keys: modelPool.gemini?.coolingKeys || 0,
        cooldown_statuses: modelPool.gemini?.cooldownStatuses || {},
        openai_fallback_configured: Boolean(modelPool.openai?.configured),
        last_probe: liveProbe,
      },
      geminiLive ? [] : [
        modelPool.gemini?.availableKeys > 0
          ? 'Run /api/v1/ai/model-pool/probe?provider=gemini after cooldown to prove a live response.'
          : 'Add a fresh valid Gemini key, or add OPENAI_API_KEY as a fallback provider.',
      ],
    ),
    buildActivationItem(
      'supabase_google_oauth',
      'Supabase Google OAuth',
      googleKnownLive ? 'live' : 'blocked',
      {
        supabase_url_configured: Boolean(SUPABASE_URL),
        supabase_anon_configured: Boolean(SUPABASE_ANON_KEY),
        google_client_configured: googleClientConfigured,
        google_secret_configured: googleSecretConfigured,
        supabase_management_token_configured: supabaseManagementConfigured,
        provider_probe: googleAuthProbe,
      },
      googleKnownLive ? [] : [
        googleClientConfigured && googleSecretConfigured && supabaseManagementConfigured
          ? 'Use Supabase Management API PATCH /v1/projects/{ref}/config/auth to enable external_google.'
          : 'Create a Google OAuth Web client, add the Supabase callback URL in Google, then add Client ID/Secret to Supabase Auth.',
        'Add Supabase redirect URLs for https://explore-two-rho.vercel.app/ and explore://auth/callback.',
      ],
    ),
    buildActivationItem(
      'firebase_push_device',
      'Firebase Push Device',
      push.status === 'live' ? 'live' : 'blocked',
      {
        firebase_credentials_configured: hasPushCredentials(),
        signed_in: Boolean(user?.id),
        alerts_enabled: push.alerts_enabled,
        push_enabled: push.push_enabled,
        push_registered: push.push_registered,
        registered_device_count: push.registered_device_count,
      },
      push.status === 'live' ? [] : [
        'Install the current APK on a real phone, sign in, grant notifications, and let the app POST /api/v1/devices/push-token.',
      ],
    ),
    buildActivationItem(
      'private_message_delivery',
      'Private Message Delivery',
      privateMessaging.status === 'live' ? 'live' : 'blocked',
      {
        signed_in: privateMessaging.signed_in,
        runtime_schema_ready: privateMessaging.runtime_schema_ready,
        migration_proof_ready: privateMessaging.migration_proof_ready,
        supabase_service_role_configured: supabaseServiceRoleConfigured,
        push_configured: privateMessaging.push_configured,
        registered_device_count: privateMessaging.registered_device_count,
        conversation_count: privateMessaging.conversation_count,
        message_count: privateMessaging.message_count,
      },
      privateMessaging.status === 'live' ? [] : privateMessaging.blockers,
    ),
  ];

  const liveCount = items.filter((item) => item.status === 'live').length;
  const blockedCount = items.filter((item) => item.status === 'blocked').length;
  const partialCount = items.filter((item) => item.status === 'partial').length;

  return {
    status: liveCount === items.length ? 'live' : (liveCount > 0 || partialCount > 0 ? 'partial' : 'blocked'),
    generated_at: new Date().toISOString(),
    summary: {
      item_count: items.length,
      live: liveCount,
      partial: partialCount,
      blocked: blockedCount,
      action_count: items.reduce((sum, item) => sum + item.actions.length, 0),
    },
    items,
  };
}

function buildVisionReadiness({ db, dataBackend = 'sqlite', user = null, sections = {} } = {}) {
  const sourceMapSummary = getEventSourceMapSummary();
  const modelPool = getModelPoolStatus();
  const liveProbe = getLastLiveProbe();
  const googleAuthProbe = getLastGoogleAuthProbe();
  const liveProbeAgeMs = liveProbe.checkedAt ? Date.now() - Date.parse(liveProbe.checkedAt) : Infinity;
  const recentGeminiProbeLive = liveProbe.status === 'live'
    && liveProbe.provider === 'gemini'
    && Number.isFinite(liveProbeAgeMs)
    && liveProbeAgeMs <= 60 * 60 * 1000;
  const apk = getReleaseApkMetadata();
  const auth = sections.auth || buildAuthReadiness(user);
  const push = sections.push || buildPushReadiness(db, user);
  const discovery = sections.discovery || buildDiscoveryReadiness(db, user);
  const writtenNews = sections.written_news || buildWrittenNewsReadiness(db);
  const runtime = sections.runtime || buildRuntimeReadiness(dataBackend);
  const privateMessaging = sections.private_messages || buildPrivateMessagingReadiness({ db, user });
  const persistedContentCount = countRows(db, 'SELECT COUNT(*) AS count FROM content_items');
  const liveEventCount = Number(sections.event_only_item_count || sections.eventOnlyItemCount || sections.priorityRadarAlertCount || sections.priority_radar_alert_count || 0);
  const latestContentCount = Math.max(persistedContentCount, liveEventCount);
  const persistedRadarCount = countRows(db, 'SELECT COUNT(*) AS count FROM priority_alerts');
  const liveRadarCount = Number(sections.priority_radar_alert_count || sections.priorityRadarAlertCount || 0);
  const radarCount = Math.max(persistedRadarCount, liveRadarCount);

  const googleClientConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID
      || process.env.GOOGLE_CLIENT_ID
      || process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID
  );
  const googleSecretConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
      || process.env.GOOGLE_CLIENT_SECRET
      || process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET
  );
  const googleProviderKnownLive = String(process.env.SUPABASE_AUTH_GOOGLE_ENABLED || '').toLowerCase() === 'true';
  const googleProbeLive = googleAuthProbe.status === 'live' && googleAuthProbe.enabled === true;
  const googleProbeDisabled = googleAuthProbe.status === 'disabled';
  const googleProbeUnreachable = googleAuthProbe.status === 'unreachable';
  const googleSignInBlockers = [];
  if (!googleProviderKnownLive && !googleProbeLive) {
    if (googleProbeDisabled) {
      googleSignInBlockers.push('Enable the Google provider in Supabase Auth and add Google OAuth Client ID/Secret.');
    } else if (googleProbeUnreachable) {
      googleSignInBlockers.push('Run the Google provider probe from an environment with network access to prove Supabase Auth settings.');
    } else {
      googleSignInBlockers.push('Enable Google provider in Supabase Auth and add Google OAuth Client ID/Secret.');
    }
  }

  const requirements = [
    buildRequirement(
      'event_only_feed',
      'Event-only feed',
      latestContentCount > 0 && (discovery.status !== 'unavailable' || writtenNews.status !== 'unavailable') ? 'live' : 'partial',
      latestContentCount > 0
        ? 'The feed has indexed items and can rank them into event-first output.'
        : 'The event-only surface is implemented, but no indexed items are available in this runtime.',
      {
        indexed_content_count: latestContentCount,
        persisted_content_count: persistedContentCount,
        live_event_count: liveEventCount,
        discovery_status: discovery.status,
        written_news_status: writtenNews.status,
      },
      latestContentCount > 0 ? [] : ['Needs live indexed content in the current runtime.'],
    ),
    buildRequirement(
      'source_reference_map',
      'Reference source map',
      sourceMapSummary.laneCount >= 5 && sourceMapSummary.aiAdvantageSourceCount >= 20 ? 'live' : 'partial',
      'The event-source map defines the lanes and source references used by event-only intelligence.',
      sourceMapSummary,
      sourceMapSummary.aiAdvantageSourceCount >= 20 ? [] : ['AI Advantage needs at least 20 configured sources.'],
    ),
    buildRequirement(
      'direct_notifications',
      'Direct notifications',
      push.status,
      push.status === 'live'
        ? 'Hosted push is ready for this signed-in device.'
        : 'Notification code and Firebase credentials exist, but hosted phone delivery is not fully proven for this user/device.',
      {
        push_configured: push.push_configured,
        push_registered: push.push_registered,
        alerts_enabled: push.alerts_enabled,
        push_enabled: push.push_enabled,
        worker_status: push.worker?.last_status || '',
        registered_device_count: push.registered_device_count,
      },
      push.status === 'live' ? [] : ['Install the APK, sign in, grant notification permission, and register a live device token.'],
    ),
    buildRequirement(
      'google_sign_in',
      'Google sign-in',
      googleProviderKnownLive || googleProbeLive ? 'live' : (auth.configured ? 'partial' : 'unavailable'),
      googleProviderKnownLive || googleProbeLive
        ? 'Google OAuth is enabled for the Supabase project.'
        : googleProbeDisabled
          ? 'Supabase is reachable and reports Google OAuth disabled.'
          : 'The app can call Supabase Google OAuth, but the external Supabase Google provider is not proven enabled here.',
      {
        supabase_auth_configured: auth.configured,
        google_client_configured: googleClientConfigured,
        google_secret_configured: googleSecretConfigured,
        google_provider_known_live: googleProviderKnownLive,
        google_provider_probe: googleAuthProbe,
      },
      googleSignInBlockers,
    ),
    buildRequirement(
      'gemini_interpretation',
      'Gemini interpretation',
      recentGeminiProbeLive ? 'live' : (modelPool.gemini?.availableKeys > 0 ? 'partial' : 'unavailable'),
      recentGeminiProbeLive
        ? 'Gemini answered a bounded live probe recently.'
        : modelPool.gemini?.availableKeys > 0
          ? 'Gemini keys are configured and available, but this readiness check does not prove a successful live model response.'
          : 'No available Gemini key is visible to the backend.',
      {
        active_provider: modelPool.activeProvider,
        gemini_configured: modelPool.gemini?.configured,
        gemini_available_keys: modelPool.gemini?.availableKeys || 0,
        gemini_cooling_keys: modelPool.gemini?.coolingKeys || 0,
        openai_configured: modelPool.openai?.configured,
        live_probe: liveProbe,
      },
      recentGeminiProbeLive
        ? []
        : modelPool.gemini?.availableKeys > 0
          ? ['Run a live AI probe in an environment with network access to prove Gemini response, not only fallback.']
          : ['Configure a valid Gemini key.'],
    ),
    buildRequirement(
      'phone_apk',
      'Phone APK',
      apk.install_asset_ready ? 'live' : (apk.install_asset_exists ? 'partial' : 'unavailable'),
      apk.install_asset_ready
        ? 'The installable APK is available for phone testing.'
        : 'The installable APK is missing or does not match the current Android web build metadata.',
      apk,
      apk.install_asset_ready ? [] : ['Rebuild or repack the APK from the latest verified web export and publish it under /downloads.'],
    ),
    buildRequirement(
      'private_messages',
      'Private messages',
      privateMessaging.status,
      privateMessaging.message,
      {
        signed_in: privateMessaging.signed_in,
        migration_proof_ready: privateMessaging.migration_proof_ready,
        runtime_schema_ready: privateMessaging.runtime_schema_ready,
        notification_lookup_configured: privateMessaging.notification_lookup_configured,
        push_configured: privateMessaging.push_configured,
        registered_device_count: privateMessaging.registered_device_count,
        conversation_count: privateMessaging.conversation_count,
        message_count: privateMessaging.message_count,
        receipt_count: privateMessaging.receipt_count,
        missing_tables: privateMessaging.missing_tables,
        missing_message_columns: privateMessaging.missing_message_columns,
      },
      privateMessaging.blockers,
    ),
    buildRequirement(
      'runtime_backend',
      'Runtime backend',
      runtime.status,
      runtime.message,
      {
        data_backend: runtime.data_backend,
        runtime_adapter: runtime.runtime_adapter,
        deployment_mode: runtime.deployment_mode,
      },
      runtime.status === 'live' ? [] : ['Deploy/verify the production backend target instead of the local SQLite bridge.'],
    ),
    buildRequirement(
      'priority_radar',
      'Priority radar',
      radarCount > 0 ? 'live' : 'partial',
      radarCount > 0
        ? 'Priority Radar has cached alert events.'
        : 'Priority Radar is implemented, but no alert events are cached in this runtime.',
      { alert_count: radarCount, persisted_alert_count: persistedRadarCount, live_alert_count: liveRadarCount },
      radarCount > 0 ? [] : ['Run alert refresh against live sources.'],
    ),
  ];

  const blockers = requirements.flatMap((requirement) => requirement.blockers.map((blocker) => ({
    requirement: requirement.id,
    blocker,
  })));
  const liveCount = requirements.filter((requirement) => requirement.status === 'live').length;
  const unavailableCount = requirements.filter((requirement) => requirement.status === 'unavailable').length;
  const partialCount = requirements.filter((requirement) => requirement.status === 'partial').length;
  const status = liveCount === requirements.length
    ? 'live'
    : liveCount > 0 || partialCount > 0
      ? 'partial'
      : 'unavailable';

  return {
    status,
    generated_at: new Date().toISOString(),
    summary: {
      requirement_count: requirements.length,
      live: liveCount,
      partial: partialCount,
      unavailable: unavailableCount,
      blocker_count: blockers.length,
    },
    requirements,
    blockers,
  };
}

function buildSystemReadiness({ db, dataBackend = 'sqlite', user = null, sections: providedSections = {} } = {}) {
  const runtime = buildRuntimeReadiness(dataBackend);
  const auth = buildAuthReadiness(user);
  const written_news = buildWrittenNewsReadiness(db);
  const sources = buildSourceReadiness();
  const push = buildPushReadiness(db, user);
  const meta = buildMetaReadiness(db, user);
  const discovery = buildDiscoveryReadiness(db, user);
  const intelligence = buildIntelligenceReadiness(db, user);
  const surfaces = buildSurfaceReadiness(db, user, {
    push,
    written_news,
    meta,
    discovery,
    intelligence,
  });
  const vision = buildVisionReadiness({
    db,
    dataBackend,
    user,
    sections: {
      runtime,
      auth,
      written_news,
      sources,
      push,
      meta,
      discovery,
      priorityRadarAlertCount: providedSections.priorityRadarAlertCount || providedSections.priority_radar_alert_count || 0,
    },
  });
  const sections = [runtime, auth, written_news, sources, push, meta, discovery, intelligence];
  const coreSections = [runtime, auth, written_news, sources, push, meta, intelligence];

  let status = 'unavailable';
  if (sections.every((section) => section.status === 'live')) {
    status = 'live';
  } else if (coreSections.every((section) => section.status === 'live') && discovery.status !== 'unavailable') {
    status = 'live';
  } else if (sections.some((section) => section.status !== 'unavailable')) {
    status = 'partial';
  }

  return {
    status,
    generated_at: new Date().toISOString(),
    runtime,
    auth,
    written_news,
    sources,
    push,
    meta,
    discovery,
    intelligence,
    surfaces,
    vision,
  };
}

module.exports = {
  buildActivationReadiness,
  buildSourceReadiness,
  buildSystemReadiness,
  buildIntelligenceReadiness,
  buildVisionReadiness,
  normalizeSourceReadiness,
};
