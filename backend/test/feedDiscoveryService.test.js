const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// Discovery tests validate deterministic ingestion. They must not call a paid
// or rate-limited provider while global fetch is intentionally stubbed.
process.env.DISCOVERY_AI_ANALYSIS_BUDGET = '0';

const alertRadarService = require('../src/services/alertRadarService');
const feedDiscoveryService = require('../src/services/feedDiscoveryService');
const aiService = require('../services/aiService');
const youtubeService = require('../services/youtubeService');

function createDiscoveryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE youtube_tracked_channels (
      id TEXT PRIMARY KEY,
      scope_key TEXT,
      channel_key TEXT,
      channel_id TEXT,
      channel_query TEXT,
      channel_name TEXT,
      channel_url TEXT,
      lane TEXT,
      trust_tier INTEGER,
      active INTEGER,
      system_managed INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT
    );

    CREATE UNIQUE INDEX idx_youtube_tracked_channels_scope_key_channel_key_lane
      ON youtube_tracked_channels(scope_key, channel_key, lane);

    CREATE TABLE youtube_topic_monitors (
      id TEXT PRIMARY KEY,
      scope_key TEXT,
      query_key TEXT,
      query TEXT,
      intent TEXT,
      weight REAL,
      active INTEGER,
      system_managed INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_youtube_topic_monitors_scope_key_query_key
      ON youtube_topic_monitors(scope_key, query_key);

    CREATE TABLE watched_source_packs (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL DEFAULT 'public',
      topic_key TEXT NOT NULL,
      topic TEXT NOT NULL,
      lane TEXT NOT NULL DEFAULT 'ai_advantage',
      priority TEXT NOT NULL DEFAULT 'watch',
      why TEXT,
      watch_questions_json TEXT NOT NULL DEFAULT '[]',
      generated_sources_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER DEFAULT 1,
      system_managed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scope_key, topic_key)
    );

    CREATE TABLE source_health_status (
      id TEXT PRIMARY KEY,
      scope_key TEXT,
      platform TEXT,
      lane TEXT,
      source_key TEXT,
      source_label TEXT,
      status TEXT,
      produced_items INTEGER,
      freshness_hours REAL,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_source_health_status_scope_key_platform_source_key_lane
      ON source_health_status(scope_key, platform, source_key, lane);

    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      platform TEXT,
      name TEXT,
      url TEXT UNIQUE,
      trust_tier INTEGER,
      category TEXT,
      active INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE creators (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      name TEXT,
      channel_url TEXT,
      subscriber_count INTEGER,
      trust_score REAL,
      expertise_topics_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      creator_id TEXT,
      external_id TEXT UNIQUE,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      publish_date TEXT,
      duration_seconds INTEGER,
      language TEXT,
      view_count INTEGER,
      transcript TEXT,
      summary TEXT,
      rarity_score REAL,
      depth_score REAL,
      trust_score REAL,
      freshness_score REAL,
      timeless_score REAL,
      clickbait_score REAL,
      ingest_status TEXT,
      transcript_status TEXT,
      transcript_provider TEXT,
      analysis_provider TEXT,
      analysis_model TEXT,
      analysis_error TEXT,
      topic_tags_json TEXT,
      content_type TEXT,
      channel_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE feed_candidates (
      id TEXT PRIMARY KEY,
      scope_key TEXT,
      content_id TEXT,
      external_id TEXT,
      platform TEXT,
      lane TEXT,
      source_ref TEXT,
      source_label TEXT,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      published_at TEXT,
      duration_seconds INTEGER,
      view_count INTEGER,
      source_trust REAL,
      freshness_score REAL,
      personal_match_score REAL,
      decision_score REAL,
      exploration_score REAL,
      clickbait_penalty REAL,
      overall_score REAL,
      why_selected TEXT,
      stale INTEGER,
      raw_json TEXT,
      last_seen_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_feed_candidates_scope_key_external_id_lane
      ON feed_candidates(scope_key, external_id, lane);
  `);
  return db;
}

test('radar articles are stored in the written channel instead of the video channel', () => {
  const db = createDiscoveryDb();
  const candidate = {
    videoId: 'radar:official-release',
    platform: 'radar',
    contentType: 'article',
    sourceRef: 'radar:openai',
    sourceLabel: 'OpenAI',
    sourceUrl: 'https://openai.com/news',
    sourceCategory: 'AI Release Watch',
    channelTitle: 'OpenAI',
    title: 'Verified official release',
    url: 'https://openai.com/news/verified-release',
    publishDate: new Date().toISOString(),
    description: 'A verified first-party release.',
    tags: ['AI'],
    channelRow: { trust_tier: 5, platform: 'radar' },
  };
  const analysis = { summary: candidate.description, topics: ['AI'], scores: {} };
  const scorePack = {
    rarityScore: 0.5,
    depthScore: 0.7,
    sourceTrust: 1,
    freshnessScore: 0.9,
    timelessScore: 0.4,
    clickbaitPenalty: 0.05,
  };

  try {
    feedDiscoveryService.__test__.upsertContentItem(db, candidate, analysis, scorePack, candidate.channelRow);
    const row = db.prepare("SELECT content_type, channel_type FROM content_items WHERE external_id = 'radar:official-release'").get();
    assert.equal(row.content_type, 'article');
    assert.equal(row.channel_type, 'written');
  } finally {
    db.close();
  }
});

test('builds fallback discovery candidates from AI release alerts', () => {
  const candidates = feedDiscoveryService.__test__.buildDiscoveryFallbackCandidatesFromAlerts([
    {
      category: 'ai',
      title: 'Anthropic launches Claude 4.6 with API availability',
      url: 'https://www.anthropic.com/news/claude-4-6',
      summary: 'Official Anthropic release for Claude 4.6 with developer access.',
      source: 'Anthropic',
      sourceLabel: 'Anthropic news',
      source_type: 'official',
      official_source: true,
      publishedAt: new Date(Date.now() - (60 * 60 * 1000)).toISOString(),
      release_watch_company: 'anthropic',
      release_watch_company_label: 'Anthropic',
      fingerprint: 'anthropic-claude-4-6',
    },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].platform, 'radar');
  assert.equal(candidates[0].contentType, 'article');
  assert.equal(candidates[0].lane, 'fresh_signal');
  assert.equal(candidates[0].sourceLabel, 'Anthropic');
  assert.match(candidates[0].videoId, /^radar:/);
  assert.equal(candidates[0].channelRow.trust_tier, 5);
});

test('radar fallback ignores alerts without a real publication date', () => {
  const candidates = feedDiscoveryService.__test__.buildDiscoveryFallbackCandidatesFromAlerts([
    {
      category: 'ai',
      title: 'Anthropic launches a current-looking release without source timing',
      url: 'https://www.anthropic.com/news/undated-release',
      source: 'Anthropic',
      official_source: true,
      seenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  assert.equal(candidates.length, 0);
});

test('refreshDiscoveryForScope falls back to radar alerts when topic searches hit quota', async () => {
  const db = createDiscoveryDb();
  const originalSearchVideos = youtubeService.searchVideos;
  const originalHasKey = youtubeService.hasConfiguredYouTubeApiKey;
  const originalGetPriorityAlerts = alertRadarService.getPriorityAlerts;
  const checkedAt = new Date().toISOString();
  const publishedAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'topic-1',
    'tester',
    'anthropic-claude-update',
    'Anthropic Claude update',
    'fresh_signal',
    0.8
  );

  youtubeService.hasConfiguredYouTubeApiKey = () => true;
  youtubeService.searchVideos = async () => {
    const error = new Error('The request cannot be completed because you have exceeded your quota.');
    error.code = 403;
    throw error;
  };
  alertRadarService.getPriorityAlerts = async () => ({
    checkedAt,
    cacheAgeMs: 0,
    reviewLog: [],
    alerts: [
      {
        category: 'ai',
        title: 'Claude 4.6 launches with API availability',
        url: 'https://www.anthropic.com/news/claude-4-6',
        source: 'Anthropic',
        sourceLabel: 'Anthropic news',
        source_type: 'official',
        official_source: true,
        publishedAt,
        summary: 'Official Anthropic release for Claude 4.6 with developer access.',
        release_watch_company: 'anthropic',
        release_watch_company_label: 'Anthropic',
        release_watch_signal: 'official_release',
        release_watch_reason: 'Official vendor source with a clear model release signal.',
        fingerprint: 'anthropic-claude-4-6',
      },
    ],
  });

  try {
    const result = await feedDiscoveryService.refreshDiscoveryForScope(db, {
      userId: 'tester',
      templateState: {},
      force: true,
    });

    assert.equal(result.refreshed, true);
    assert.ok(result.candidateCount > 0);
    assert.match(result.message, /fallback/i);
    assert.ok(result.pipeline_health);
    assert.equal(result.pipeline_health.official_releases.status, 'live');

    const candidate = db.prepare(`
      SELECT platform, source_label, title
      FROM feed_candidates
      WHERE scope_key = 'tester'
      ORDER BY overall_score DESC
      LIMIT 1
    `).get();
    assert.ok(candidate);
    assert.equal(candidate.platform, 'radar');
    assert.match(candidate.source_label, /Anthropic/i);
    assert.match(candidate.title, /Claude 4\.6/i);

    const health = db.prepare(`
      SELECT platform, status, produced_items, last_error
      FROM source_health_status
      WHERE scope_key = 'tester'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get();
    assert.ok(health);
    assert.equal(health.platform, 'radar');
    assert.equal(health.status, 'live');
    assert.ok(health.produced_items > 0);
  } finally {
    youtubeService.searchVideos = originalSearchVideos;
    youtubeService.hasConfiguredYouTubeApiKey = originalHasKey;
    alertRadarService.getPriorityAlerts = originalGetPriorityAlerts;
    db.close();
  }
});

test('getDiscoveryStatus keeps the fallback message visible when radar is live but other sources are stale', async () => {
  const db = createDiscoveryDb();
  const originalSearchVideos = youtubeService.searchVideos;
  const originalHasKey = youtubeService.hasConfiguredYouTubeApiKey;
  const originalGetPriorityAlerts = alertRadarService.getPriorityAlerts;
  const checkedAt = new Date().toISOString();
  const publishedAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'topic-2',
    'tester-status',
    'openai-model-release',
    'OpenAI model release',
    'fresh_signal',
    0.78
  );

  youtubeService.hasConfiguredYouTubeApiKey = () => true;
  youtubeService.searchVideos = async () => {
    const error = new Error('The request cannot be completed because you have exceeded your quota.');
    error.code = 403;
    throw error;
  };
  alertRadarService.getPriorityAlerts = async () => ({
    checkedAt,
    cacheAgeMs: 0,
    reviewLog: [],
    alerts: [
      {
        category: 'ai',
        title: 'OpenAI ships a new developer tool',
        url: 'https://openai.com/news/new-developer-tool',
        source: 'OpenAI',
        sourceLabel: 'OpenAI',
        source_type: 'official',
        official_source: true,
        publishedAt,
        summary: 'Official OpenAI launch post for a new developer tool.',
        release_watch_company: 'openai',
        release_watch_company_label: 'OpenAI',
        fingerprint: 'openai-new-developer-tool',
      },
    ],
  });

  try {
    await feedDiscoveryService.refreshDiscoveryForScope(db, {
      userId: 'tester-status',
      templateState: {},
      force: true,
    });

    const status = feedDiscoveryService.getDiscoveryStatus(db, 'tester-status');
    assert.equal(status.status, 'partial');
    assert.match(status.message, /fallback/i);
    assert.ok(status.source_health.some((entry) => entry.platform === 'radar' && entry.status === 'live'));
    assert.ok(status.pipeline_health);
    assert.equal(status.pipeline_health.official_releases.status, 'live');
  } finally {
    youtubeService.searchVideos = originalSearchVideos;
    youtubeService.hasConfiguredYouTubeApiKey = originalHasKey;
    alertRadarService.getPriorityAlerts = originalGetPriorityAlerts;
    db.close();
  }
});

test('refreshDiscoveryForScope turns Source Pack feeds into real article candidates', async () => {
  const db = createDiscoveryDb();
  const originalFetch = global.fetch;
  const originalGetPriorityAlerts = alertRadarService.getPriorityAlerts;
  const originalGenerateStructuredJson = aiService.generateStructuredJson;
  const publishedAt = new Date(Date.now() - (20 * 60 * 1000)).toUTCString();

  // Source-pack ingestion is deterministic here; provider behavior has its own tests.
  aiService.generateStructuredJson = async () => null;

  await feedDiscoveryService.addWatchedSourcePack(db, 'tester-source-pack', {
    topic: 'cheap AI tools that give me an edge',
    priority: 'watch',
    why: 'Find useful cheap tools from watched references',
  });

  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
        <title>Source Pack Test</title>
        <item>
          <title>New AI coding tool adds a free plan for students</title>
          <link>https://example.com/ai-coding-tool-free-plan?source=${encodeURIComponent(String(url).slice(0, 24))}</link>
          <pubDate>${publishedAt}</pubDate>
          <description>A useful AI workflow tool now offers a free plan and lower-cost upgrade path.</description>
        </item>
      </channel></rss>`,
  });
  alertRadarService.getPriorityAlerts = async () => ({
    checkedAt: new Date().toISOString(),
    cacheAgeMs: 0,
    reviewLog: [],
    alerts: [],
  });

  try {
    const result = await feedDiscoveryService.refreshDiscoveryForScope(db, {
      userId: 'tester-source-pack',
      templateState: {},
      force: true,
    });

    assert.equal(result.refreshed, true);
    assert.ok(result.candidateCount > 0);

    const candidate = db.prepare(`
      SELECT platform, source_label, title, url, why_selected
      FROM feed_candidates
      WHERE scope_key = 'tester-source-pack' AND platform = 'source_pack'
      ORDER BY overall_score DESC
      LIMIT 1
    `).get();
    assert.ok(candidate);
    assert.match(candidate.title, /free plan/i);
    assert.match(candidate.why_selected, /watched reference pack/i);

    const health = db.prepare(`
      SELECT platform, status, produced_items, metadata_json
      FROM source_health_status
      WHERE scope_key = 'tester-source-pack' AND platform = 'source_pack' AND status = 'live'
      ORDER BY produced_items DESC
      LIMIT 1
    `).get();
    assert.ok(health);
    assert.equal(health.platform, 'source_pack');
    assert.equal(health.status, 'live');
    assert.ok(health.produced_items > 0);
    assert.match(health.metadata_json, /feed_url/);

    const status = feedDiscoveryService.getDiscoveryStatus(db, 'tester-source-pack');
    assert.equal(status.status, 'partial');
    assert.ok(status.pipeline_health.source_packs.candidate_count > 0);
  } finally {
    global.fetch = originalFetch;
    alertRadarService.getPriorityAlerts = originalGetPriorityAlerts;
    aiService.generateStructuredJson = originalGenerateStructuredJson;
    db.close();
  }
});

test('refreshDiscoveryForScope canonicalizes duplicate source URLs instead of crashing', async () => {
  const db = createDiscoveryDb();
  const originalFetchRecentVideosByChannel = youtubeService.fetchRecentVideosByChannel;
  const originalSearchVideos = youtubeService.searchVideos;
  const originalHasKey = youtubeService.hasConfiguredYouTubeApiKey;
  const originalGetPriorityAlerts = alertRadarService.getPriorityAlerts;
  const trackedPublishedAt = new Date(Date.now() - (90 * 60 * 1000)).toISOString();
  const topicPublishedAt = new Date(Date.now() - (30 * 60 * 1000)).toISOString();
  const checkedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO youtube_tracked_channels (
      id, scope_key, channel_key, channel_id, channel_query, channel_name, channel_url, lane, trust_tier, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'tracked-1',
    'tester-dup',
    'tracked-key',
    'UCsame12345678',
    'Tracked Source',
    'Tracked Source',
    null,
    'tracked',
    5
  );

  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'topic-dup',
    'tester-dup',
    'dario-amodei-interview',
    'Dario Amodei interview',
    'interview_signal',
    0.8
  );

  youtubeService.hasConfiguredYouTubeApiKey = () => true;
    youtubeService.fetchRecentVideosByChannel = async () => ([
      {
        videoId: 'track-video-1',
        title: 'Tracked video one',
        description: 'Tracked channel item.',
        channelTitle: 'Same Channel',
        channelId: 'UCsame12345678',
        thumbnailUrl: null,
        publishDate: trackedPublishedAt,
        url: 'https://www.youtube.com/watch?v=track-video-1',
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptProvider: null,
        ingestStatus: 'partial',
    },
  ]);
    youtubeService.searchVideos = async () => ([
      {
        videoId: 'topic-video-1',
        title: 'Topic video one',
        description: 'Topic monitor item.',
        channelTitle: 'Same Channel',
        channelId: 'UCsame12345678',
        thumbnailUrl: null,
        publishDate: topicPublishedAt,
        url: 'https://www.youtube.com/watch?v=topic-video-1',
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptProvider: null,
        ingestStatus: 'partial',
      },
    ]);
    alertRadarService.getPriorityAlerts = async () => ({
      checkedAt,
      cacheAgeMs: 0,
      reviewLog: [],
      alerts: [],
    });

  try {
    const result = await feedDiscoveryService.refreshDiscoveryForScope(db, {
      userId: 'tester-dup',
      templateState: {},
      force: true,
    });

    assert.equal(result.refreshed, true);
    assert.equal(result.candidateCount, 2);

    const sources = db.prepare(`
      SELECT id, url
      FROM sources
      ORDER BY created_at ASC
    `).all();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, 'https://www.youtube.com/channel/UCsame12345678');
  } finally {
    youtubeService.fetchRecentVideosByChannel = originalFetchRecentVideosByChannel;
    youtubeService.searchVideos = originalSearchVideos;
    youtubeService.hasConfiguredYouTubeApiKey = originalHasKey;
    alertRadarService.getPriorityAlerts = originalGetPriorityAlerts;
    db.close();
  }
});

test('getDiscoveryStatus exposes per-pipeline health and freshness metadata', () => {
  const db = createDiscoveryDb();
  const recentWrittenPublishDate = new Date(Date.now() - (30 * 60 * 1000)).toISOString();

  db.prepare(`
    INSERT INTO youtube_tracked_channels (
      id, scope_key, channel_key, channel_id, channel_query, channel_name, channel_url, lane, trust_tier, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'tracked-health',
    'tester-health',
    'tracked-health-key',
    'UChealth1234567',
    'Tracked Health',
    'Tracked Health',
    null,
    'tracked',
    5
  );

  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'poi-health',
    'tester-health',
    'dario-health-query',
    'Dario Amodei interview',
    'interview_signal',
    0.8
  );

  db.prepare(`
    INSERT INTO source_health_status (
      id, scope_key, platform, lane, source_key, source_label, status, produced_items, freshness_hours,
      last_checked_at, last_success_at, last_error, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'official-health',
    'tester-health',
    'radar',
    'fresh_signal',
    'official_ai_release_watch',
    'Official AI release watch',
    'live',
    3,
    1.5,
    '2026-04-01T12:00:00.000Z',
    '2026-04-01T12:00:00.000Z',
    null,
    JSON.stringify({ source: 'alert_radar' })
  );

  db.prepare(`
    INSERT INTO source_health_status (
      id, scope_key, platform, lane, source_key, source_label, status, produced_items, freshness_hours,
      last_checked_at, last_success_at, last_error, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'tracked-health-source',
    'tester-health',
    'youtube',
    'tracked',
    'tracked-health-key',
    'Tracked Health',
    'live',
    4,
    2.2,
    '2026-04-01T12:05:00.000Z',
    '2026-04-01T12:05:00.000Z',
    null,
    JSON.stringify({ channel_id: 'UChealth1234567' })
  );

  db.prepare(`
    INSERT INTO source_health_status (
      id, scope_key, platform, lane, source_key, source_label, status, produced_items, freshness_hours,
      last_checked_at, last_success_at, last_error, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'poi-health-source',
    'tester-health',
    'youtube',
    'interview_signal',
    'dario-health-query',
    'Dario Amodei interview',
    'live',
    1,
    4.8,
    '2026-04-01T12:10:00.000Z',
    '2026-04-01T12:10:00.000Z',
    null,
    JSON.stringify({ query: 'Dario Amodei interview' })
  );

  db.prepare(`
    INSERT INTO content_items (
      id, source_id, creator_id, external_id, title, url, thumbnail_url, publish_date,
      duration_seconds, language, view_count, transcript, summary,
      rarity_score, depth_score, trust_score, freshness_score, timeless_score, clickbait_score,
      ingest_status, transcript_status, transcript_provider,
      analysis_provider, analysis_model, analysis_error,
      topic_tags_json, content_type, channel_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'written-health',
    'source_written_health',
    'creator_written_health',
    'written-external-health',
    'Written health item',
    'https://example.com/written-health',
    null,
    recentWrittenPublishDate,
    0,
    'en',
    0,
    null,
    'Written health summary.',
    0.5,
    0.5,
    0.5,
    0.9,
    0.5,
    0.1,
    'ready',
    'unavailable',
    null,
    null,
    null,
    null,
    JSON.stringify([]),
    'article',
    'written'
  );

  const status = feedDiscoveryService.getDiscoveryStatus(db, 'tester-health');
  assert.equal(status.status, 'live');
  assert.ok(status.pipeline_health);
  assert.equal(status.pipeline_health.official_releases.status, 'live');
  assert.equal(status.pipeline_health.tracked_channels.status, 'live');
  assert.equal(status.pipeline_health.people_of_interest.status, 'live');
  assert.equal(status.pipeline_health.written_news.status, 'live');
  assert.ok(Number.isFinite(status.pipeline_health.official_releases.freshness_hours));
  assert.ok(Number.isFinite(status.pipeline_health.written_news.freshness_hours));
  db.close();
});

test('interview-signal candidates outrank generic fresh-signal duplicates during dedupe', () => {
  const existing = {
    videoId: 'dup-video',
    lane: 'fresh_signal',
    publishDate: '2026-03-31T10:00:00.000Z',
    transcript: '',
  };
  const candidate = {
    videoId: 'dup-video',
    lane: 'interview_signal',
    publishDate: '2026-03-31T10:00:00.000Z',
    transcript: '',
  };

  const deduped = new Map([[existing.videoId, existing]]);
  feedDiscoveryService.__test__.mergeDiscoveryCandidates(deduped, [candidate]);

  assert.equal(deduped.get('dup-video').lane, 'interview_signal');
});

test('people-of-interest monitoring is bounded and gives each person useful queries', () => {
  const monitors = feedDiscoveryService.__test__.buildPeopleOfInterestMonitors({
    peopleOfInterest: [
      {
        name: 'A third figure',
        aliases: ['Third figure alias'],
        topics: ['public leadership', 'institution building', 'extra topic'],
      },
      {
        name: 'A fourth figure',
        topics: ['This must not displace the highest-priority figures'],
      },
    ],
  });

  assert.ok(monitors.length <= 15);
  assert.ok(monitors.some((monitor) => monitor.query === 'Sheikh Mohammed bin Rashid Al Maktoum interview'));
  assert.ok(monitors.some((monitor) => monitor.query === 'Dario Amodei interview'));
  assert.ok(monitors.some((monitor) => monitor.query === 'A third figure interview'));
  assert.equal(monitors.some((monitor) => monitor.query.includes('A fourth figure')), false);
});

test('system monitor sync retires obsolete generated queries without touching user rules', () => {
  const db = createDiscoveryDb();

  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1)
  `).run(
    'obsolete-system-query',
    'public',
    'obsolete-system-query',
    'obsolete system query',
    'personal_match',
    0.5
  );
  db.prepare(`
    INSERT INTO youtube_topic_monitors (
      id, scope_key, query_key, query, intent, weight, active, system_managed
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(
    'user-owned-query',
    'public',
    'user-owned-query',
    'user-owned query',
    'personal_match',
    0.5
  );

  try {
    feedDiscoveryService.__test__.ensureSeedData(db, '', {});

    const obsolete = db.prepare(`SELECT active FROM youtube_topic_monitors WHERE id = ?`).get('obsolete-system-query');
    const userOwned = db.prepare(`SELECT active FROM youtube_topic_monitors WHERE id = ?`).get('user-owned-query');
    const activeSystemCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM youtube_topic_monitors
      WHERE scope_key = 'public' AND system_managed = 1 AND active = 1
    `).get();

    assert.equal(obsolete.active, 0);
    assert.equal(userOwned.active, 1);
    assert.ok(activeSystemCount.count <= 14);
  } finally {
    db.close();
  }
});

test('feed candidates older than three days are hidden and marked stale', () => {
  const db = createDiscoveryDb();
  const freshPublishedAt = new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString();
  const oldPublishedAt = new Date(Date.now() - (73 * 60 * 60 * 1000)).toISOString();

  db.prepare(`
    INSERT INTO feed_candidates (
      id, scope_key, content_id, external_id, platform, lane, title, url, published_at,
      overall_score, stale, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    'fresh-candidate',
    'freshness-scope',
    'fresh-content',
    'fresh-external',
    'youtube',
    'fresh_signal',
    'Fresh item',
    'https://example.com/fresh',
    freshPublishedAt,
    0.9
  );
  db.prepare(`
    INSERT INTO feed_candidates (
      id, scope_key, content_id, external_id, platform, lane, title, url, published_at,
      overall_score, stale, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    'old-candidate',
    'freshness-scope',
    'old-content',
    'old-external',
    'youtube',
    'fresh_signal',
    'Old item',
    'https://example.com/old',
    oldPublishedAt,
    1
  );
  db.prepare(`
    INSERT INTO feed_candidates (
      id, scope_key, content_id, external_id, platform, lane, title, url,
      overall_score, stale, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    'undated-candidate',
    'freshness-scope',
    'undated-content',
    'undated-external',
    'source_pack',
    'fresh_signal',
    'Undated item',
    'https://example.com/undated',
    1
  );

  try {
    feedDiscoveryService.__test__.pruneScope(db, 'freshness-scope');
    const visible = feedDiscoveryService.__test__.listFeedCandidates(db, 'freshness-scope');
    const oldRow = db.prepare(`SELECT stale FROM feed_candidates WHERE id = ?`).get('old-candidate');
    const undatedRow = db.prepare(`SELECT stale FROM feed_candidates WHERE id = ?`).get('undated-candidate');

    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, 'fresh-candidate');
    assert.equal(oldRow.stale, 1);
    assert.equal(undatedRow.stale, 1);
  } finally {
    db.close();
  }
});

test('undated radar-derived candidates are retired and their content date is cleared', () => {
  const db = createDiscoveryDb();
  db.exec(`
    CREATE TABLE priority_alerts (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT,
      published_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, publish_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'radar-content',
    'radar:undated-alert',
    'Undated official alert',
    'https://example.com/undated-alert',
    new Date().toISOString()
  );
  db.prepare(`
    INSERT INTO feed_candidates (
      id, scope_key, content_id, external_id, platform, lane, title, url, published_at,
      overall_score, stale, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    'radar-candidate',
    'public',
    'radar-content',
    'radar:undated-alert',
    'radar',
    'fresh_signal',
    'Undated official alert',
    'https://example.com/undated-alert',
    new Date().toISOString(),
    1
  );
  db.prepare(`
    INSERT INTO priority_alerts (id, title, url, published_at)
    VALUES (?, ?, ?, NULL)
  `).run('undated-alert', 'Undated official alert', 'https://example.com/undated-alert');

  try {
    const result = feedDiscoveryService.__test__.sanitizeUndatedRadarDerivedContent(db);
    const candidate = db.prepare(`SELECT stale FROM feed_candidates WHERE id = ?`).get('radar-candidate');
    const content = db.prepare(`SELECT publish_date FROM content_items WHERE id = ?`).get('radar-content');

    assert.equal(result.candidatesRetired, 1);
    assert.equal(result.contentDatesCleared, 1);
    assert.equal(candidate.stale, 1);
    assert.equal(content.publish_date, null);
  } finally {
    db.close();
  }
});

test('source health is stale when a source returns only expired or undated material', () => {
  const db = createDiscoveryDb();

  try {
    feedDiscoveryService.__test__.upsertSourceHealth(db, 'source-freshness-scope', {
      lane: 'tracked',
      sourceKey: 'expired-source',
      sourceLabel: 'Expired source',
      producedItems: 3,
      freshnessHours: 96,
      platform: 'youtube',
    });
    feedDiscoveryService.__test__.upsertSourceHealth(db, 'source-freshness-scope', {
      lane: 'tracked',
      sourceKey: 'undated-source',
      sourceLabel: 'Undated source',
      producedItems: 2,
      freshnessHours: null,
      platform: 'youtube',
    });

    const health = db.prepare(`
      SELECT source_key, status
      FROM source_health_status
      WHERE scope_key = 'source-freshness-scope'
      ORDER BY source_key
    `).all();

    assert.deepEqual(health, [
      { source_key: 'expired-source', status: 'stale' },
      { source_key: 'undated-source', status: 'stale' },
    ]);
  } finally {
    db.close();
  }
});
