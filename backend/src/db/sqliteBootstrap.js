'use strict';

const fs = require('fs');
const path = require('path');

const SQLITE_SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema.sqlite.sql');

const SQLITE_ALTER_STATEMENTS = [
  "ALTER TABLE content_items ADD COLUMN ingest_status TEXT DEFAULT 'ready'",
  "ALTER TABLE content_items ADD COLUMN transcript_status TEXT DEFAULT 'missing'",
  "ALTER TABLE content_items ADD COLUMN transcript_provider TEXT",
  "ALTER TABLE content_items ADD COLUMN analysis_provider TEXT",
  "ALTER TABLE content_items ADD COLUMN analysis_model TEXT",
  "ALTER TABLE content_items ADD COLUMN analysis_error TEXT",
  "ALTER TABLE content_items ADD COLUMN embedding_provider TEXT",
  "ALTER TABLE content_items ADD COLUMN embedding_model TEXT",
  "ALTER TABLE content_items ADD COLUMN embedding_error TEXT",
  "ALTER TABLE content_items ADD COLUMN updated_at DATETIME",
  "ALTER TABLE priority_alerts ADD COLUMN source_type TEXT DEFAULT 'unknown'",
  "ALTER TABLE priority_alerts ADD COLUMN official_source INTEGER DEFAULT 0",
  "ALTER TABLE priority_alerts ADD COLUMN qualified_reason TEXT",
  "ALTER TABLE priority_alerts ADD COLUMN rejected_reason TEXT",
  "ALTER TABLE notification_preferences ADD COLUMN ai_release_watch_enabled INTEGER DEFAULT 1",
  "ALTER TABLE notification_preferences ADD COLUMN ai_release_watch_companies_json TEXT DEFAULT '[\"anthropic\",\"openai\",\"google\",\"xai\"]'",
  "ALTER TABLE notification_preferences ADD COLUMN ai_release_watch_min_importance TEXT DEFAULT 'major'",
  "ALTER TABLE notification_preferences ADD COLUMN direct_news_watch_enabled INTEGER DEFAULT 1",
  "ALTER TABLE notification_preferences ADD COLUMN direct_news_watch_sources_json TEXT DEFAULT '[\"anthropic\"]'",
  "ALTER TABLE notification_preferences ADD COLUMN direct_news_watch_reason TEXT DEFAULT 'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.'",
  "ALTER TABLE watched_source_packs ADD COLUMN spider_policy_json TEXT DEFAULT '{}'",
  "ALTER TABLE watched_source_packs ADD COLUMN interpretation_lenses_json TEXT DEFAULT '[]'",
  "ALTER TABLE watched_source_packs ADD COLUMN gap_awareness_json TEXT DEFAULT '[]'",
  "ALTER TABLE watched_source_packs ADD COLUMN final_theory_feedback_json TEXT DEFAULT '{}'",
];

const SQLITE_POST_BOOT_STATEMENTS = [
  "UPDATE content_items SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)",
  `CREATE TABLE IF NOT EXISTS priority_alerts (
    id TEXT PRIMARY KEY,
    fingerprint TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    source TEXT,
    published_at DATETIME,
    summary TEXT,
    why_it_matters TEXT,
    importance TEXT,
    threat_level TEXT,
    source_type TEXT DEFAULT 'unknown',
    official_source INTEGER DEFAULT 0,
    qualified_reason TEXT,
    rejected_reason TEXT,
    score INTEGER DEFAULT 0,
    raw_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_priority_alerts_published ON priority_alerts (published_at DESC, score DESC)',
  `CREATE TABLE IF NOT EXISTS user_alert_states (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    alert_id TEXT REFERENCES priority_alerts(id) ON DELETE CASCADE,
    seen_at DATETIME,
    opened_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, alert_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_user_alert_states_user ON user_alert_states (user_id, opened_at, seen_at)',
  `CREATE TABLE IF NOT EXISTS priority_alert_reviews (
    id TEXT PRIMARY KEY,
    category TEXT,
    title TEXT,
    url TEXT,
    source TEXT,
    published_at DATETIME,
    source_type TEXT DEFAULT 'unknown',
    official_source INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    qualified_reason TEXT,
    rejected_reason TEXT,
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    raw_json TEXT DEFAULT '{}'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_priority_alert_reviews_reviewed_at ON priority_alert_reviews (reviewed_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_priority_alert_reviews_category ON priority_alert_reviews (category, reviewed_at DESC)',
  `CREATE TABLE IF NOT EXISTS worker_runtime_status (
    worker_name TEXT PRIMARY KEY,
    loop_mode TEXT DEFAULT 'oneshot',
    last_status TEXT DEFAULT 'never_run',
    last_started_at DATETIME,
    last_completed_at DATETIME,
    last_error TEXT,
    last_summary_json TEXT,
    heartbeat_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS watched_source_packs (
    id TEXT PRIMARY KEY,
    scope_key TEXT NOT NULL DEFAULT 'public',
    topic_key TEXT NOT NULL,
    topic TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'ai_advantage',
    priority TEXT NOT NULL DEFAULT 'watch',
    why TEXT,
    watch_questions_json TEXT NOT NULL DEFAULT '[]',
    generated_sources_json TEXT NOT NULL DEFAULT '[]',
    spider_policy_json TEXT DEFAULT '{}',
    interpretation_lenses_json TEXT DEFAULT '[]',
    gap_awareness_json TEXT DEFAULT '[]',
    final_theory_feedback_json TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    system_managed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope_key, topic_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_watched_source_packs_scope ON watched_source_packs (scope_key, active, lane, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS saved_opportunities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    opportunity_type TEXT NOT NULL,
    title TEXT NOT NULL,
    company_or_org TEXT,
    location_or_country TEXT,
    details_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, opportunity_id, opportunity_type)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user ON saved_opportunities (user_id)',
  `CREATE TABLE IF NOT EXISTS music_tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT,
    isrc TEXT,
    upc TEXT,
    release_date DATETIME,
    distributor TEXT NOT NULL,
    status TEXT DEFAULT 'Distributed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS music_track_stats (
    id TEXT PRIMARY KEY,
    track_id TEXT REFERENCES music_tracks(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    streams_views INTEGER DEFAULT 0,
    reels_count INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(track_id, platform)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_music_track_stats_track ON music_track_stats(track_id)',
  `CREATE TABLE IF NOT EXISTS content_sources (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT,
    platform TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, url)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_content_sources_user ON content_sources (user_id)',
  `CREATE TABLE IF NOT EXISTS content_chunks (
    id TEXT PRIMARY KEY,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content_text TEXT NOT NULL,
    start_time_seconds REAL,
    end_time_seconds REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(content_item_id, chunk_index)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_content_chunks_item ON content_chunks (content_item_id)',
  `CREATE TABLE IF NOT EXISTS content_item_embeddings (
    id TEXT PRIMARY KEY,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES content_chunks(id) ON DELETE CASCADE,
    embedding_json TEXT NOT NULL,
    model_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_content_item_embeddings_item ON content_item_embeddings (content_item_id)',
  'CREATE INDEX IF NOT EXISTS idx_content_item_embeddings_chunk ON content_item_embeddings (chunk_id)',
  `CREATE TABLE IF NOT EXISTS interaction_events (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_data_json TEXT,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interaction_events_user ON interaction_events (user_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS user_interests (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    interest_name TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, interest_name)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests (user_id)',
  `CREATE TABLE IF NOT EXISTS user_goals (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    goal_text TEXT NOT NULL,
    target_date DATETIME,
    status TEXT DEFAULT 'active',
    priority TEXT DEFAULT 'medium',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_user_goals_user ON user_goals (user_id)',
  `CREATE TABLE IF NOT EXISTS user_preference_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL DEFAULT 'default',
    depth_pref REAL DEFAULT 0.5,
    rarity_pref REAL DEFAULT 0.5,
    length_pref REAL DEFAULT 0.5,
    topics_avoid_json TEXT DEFAULT '[]',
    topics_focus_json TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, profile_name)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_user_pref_profiles_user ON user_preference_profiles (user_id)',
  `CREATE TABLE IF NOT EXISTS user_profile_vectors (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL DEFAULT 'interests',
    vector_json TEXT NOT NULL,
    model_version TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, profile_type, model_version)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_user_profile_vectors_user ON user_profile_vectors (user_id)',
  `CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
    score REAL DEFAULT 0.0,
    reason_json TEXT,
    seen INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0,
    model_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_item_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_recommendations_user_score ON recommendations (user_id, score DESC)',
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    content_text TEXT NOT NULL,
    importance_score REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id)',
  `CREATE TABLE IF NOT EXISTS memory_questions (
    id TEXT PRIMARY KEY,
    memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    last_asked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_memory_questions_memory ON memory_questions (memory_id)',
  `CREATE TABLE IF NOT EXISTS model_versions (
    id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    version_string TEXT NOT NULL UNIQUE,
    parameters_json TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS training_runs (
    id TEXT PRIMARY KEY,
    model_version_id TEXT REFERENCES model_versions(id),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    metrics_json TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_training_runs_user ON training_runs (user_id)',
  `CREATE TABLE IF NOT EXISTS daily_user_insights (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    insight_date DATE NOT NULL,
    insight_text TEXT NOT NULL,
    topics_covered_json TEXT DEFAULT '[]',
    metrics_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, insight_date)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_daily_user_insights_user ON daily_user_insights (user_id, insight_date DESC)',
];

function seedMusicStats(db) {
  try {
    const rowCount = db.prepare('SELECT COUNT(*) as count FROM music_tracks').get();
    if (rowCount && rowCount.count > 0) {
      return;
    }
  } catch (e) {
    // If table doesn't exist yet, we will handle it next time
    return;
  }

  console.log('[sqliteBootstrap] Seeding music track stats...');
  const tracks = [
    {
      id: 'track_1',
      user_id: 'user_1',
      title: 'Neon Heartbeat',
      artist: 'K-Explore',
      isrc: 'USRC12600001',
      upc: '190296999912',
      release_date: '2026-01-15 00:00:00',
      distributor: 'DistroKid',
      status: 'Distributed'
    },
    {
      id: 'track_2',
      user_id: 'user_1',
      title: 'Sunset Echoes',
      artist: 'K-Explore',
      isrc: 'USRC12600002',
      upc: '190296999929',
      release_date: '2026-02-10 00:00:00',
      distributor: 'DistroKid',
      status: 'Distributed'
    },
    {
      id: 'track_3',
      user_id: 'user_1',
      title: 'Midnight Drive',
      artist: 'K-Explore',
      isrc: 'USRC12600003',
      upc: '190296999936',
      release_date: '2026-03-22 00:00:00',
      distributor: 'SoundCloud Artists',
      status: 'Distributed'
    },
    {
      id: 'track_4',
      user_id: 'user_1',
      title: 'Cybernetic Dreams (Radio Edit)',
      artist: 'K-Explore',
      isrc: 'USRC12600004',
      upc: '190296999943',
      release_date: '2026-05-18 00:00:00',
      distributor: 'SoundCloud Artists',
      status: 'Distributed'
    },
    {
      id: 'track_5',
      user_id: 'user_1',
      title: 'Future Retro',
      artist: 'K-Explore',
      isrc: 'USRC12600005',
      upc: '190296999950',
      release_date: '2026-06-01 00:00:00',
      distributor: 'DistroKid',
      status: 'Processing'
    }
  ];

  const trackStats = [
    { id: 'stat_1_1', track_id: 'track_1', platform: 'Spotify', streams_views: 452000, reels_count: 0, revenue: 1582.00 },
    { id: 'stat_1_2', track_id: 'track_1', platform: 'Apple Music', streams_views: 189000, reels_count: 0, revenue: 945.00 },
    { id: 'stat_1_3', track_id: 'track_1', platform: 'SoundCloud', streams_views: 75000, reels_count: 0, revenue: 150.00 },
    { id: 'stat_1_4', track_id: 'track_1', platform: 'Instagram Reels', streams_views: 1250000, reels_count: 3200, revenue: 250.00 },
    { id: 'stat_1_5', track_id: 'track_1', platform: 'TikTok', streams_views: 3100000, reels_count: 8900, revenue: 620.00 },
    { id: 'stat_1_6', track_id: 'track_1', platform: 'YouTube', streams_views: 92000, reels_count: 0, revenue: 184.00 },

    { id: 'stat_2_1', track_id: 'track_2', platform: 'Spotify', streams_views: 120000, reels_count: 0, revenue: 420.00 },
    { id: 'stat_2_2', track_id: 'track_2', platform: 'Apple Music', streams_views: 52000, reels_count: 0, revenue: 260.00 },
    { id: 'stat_2_3', track_id: 'track_2', platform: 'SoundCloud', streams_views: 41000, reels_count: 0, revenue: 82.00 },
    { id: 'stat_2_4', track_id: 'track_2', platform: 'Instagram Reels', streams_views: 320000, reels_count: 1100, revenue: 64.00 },
    { id: 'stat_2_5', track_id: 'track_2', platform: 'TikTok', streams_views: 890000, reels_count: 2400, revenue: 178.00 },

    { id: 'stat_3_1', track_id: 'track_3', platform: 'Spotify', streams_views: 88000, reels_count: 0, revenue: 308.00 },
    { id: 'stat_3_2', track_id: 'track_3', platform: 'Apple Music', streams_views: 31000, reels_count: 0, revenue: 155.00 },
    { id: 'stat_3_3', track_id: 'track_3', platform: 'SoundCloud', streams_views: 290000, reels_count: 0, revenue: 580.00 },
    { id: 'stat_3_4', track_id: 'track_3', platform: 'Instagram Reels', streams_views: 150000, reels_count: 450, revenue: 30.00 },

    { id: 'stat_4_1', track_id: 'track_4', platform: 'Spotify', streams_views: 24000, reels_count: 0, revenue: 84.00 },
    { id: 'stat_4_2', track_id: 'track_4', platform: 'Apple Music', streams_views: 9500, reels_count: 0, revenue: 47.50 },
    { id: 'stat_4_3', track_id: 'track_4', platform: 'SoundCloud', streams_views: 42000, reels_count: 0, revenue: 84.00 },
    { id: 'stat_4_4', track_id: 'track_4', platform: 'Instagram Reels', streams_views: 88000, reels_count: 280, revenue: 17.60 },
    { id: 'stat_4_5', track_id: 'track_4', platform: 'TikTok', streams_views: 140000, reels_count: 650, revenue: 28.00 }
  ];

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, onboarding, created_at, updated_at)
      VALUES ('user_1', 'user_1@explore.local', 'eXplore Music', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    const insertTrack = db.prepare(`
      INSERT INTO music_tracks (id, user_id, title, artist, isrc, upc, release_date, distributor, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStats = db.prepare(`
      INSERT INTO music_track_stats (id, track_id, platform, streams_views, reels_count, revenue)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const t of tracks) {
      insertTrack.run(t.id, t.user_id, t.title, t.artist, t.isrc, t.upc, t.release_date, t.distributor, t.status);
    }

    for (const s of trackStats) {
      insertStats.run(s.id, s.track_id, s.platform, s.streams_views, s.reels_count, s.revenue);
    }
  })();
}

function runStatement(db, statement) {
  try {
    db.prepare(statement).run();
  } catch (error) {
    if (
      error.message?.includes('already exists') ||
      error.message?.includes('duplicate column') ||
      error.message?.includes('duplicate')
    ) {
      return;
    }

    throw error;
  }
}

function executeSqlFile(db, filePath) {
  const schema = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    runStatement(db, statement);
  }
}

function ensureSqliteIdealState(db) {
  executeSqlFile(db, SQLITE_SCHEMA_PATH);

  for (const statement of SQLITE_ALTER_STATEMENTS) {
    runStatement(db, statement);
  }

  for (const statement of SQLITE_POST_BOOT_STATEMENTS) {
    runStatement(db, statement);
  }

  seedMusicStats(db);
}


function syncSqliteUser(db, user) {
  if (!user?.id) {
    return;
  }

  const requestedEmail = user.email || `${user.id}@explore.local`;
  const existingEmailOwner = db.prepare(`
    SELECT id
    FROM users
    WHERE email = ?
    LIMIT 1
  `).get(requestedEmail);
  const safeEmail = existingEmailOwner && existingEmailOwner.id !== user.id
    ? `${user.id}@explore.local`
    : requestedEmail;

  db.prepare(`
    INSERT INTO users (id, email, name, avatar_url, onboarding, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = COALESCE(NULLIF(excluded.name, ''), users.name),
      avatar_url = COALESCE(NULLIF(excluded.avatar_url, ''), users.avatar_url),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    user.id,
    safeEmail,
    user.name || '',
    user.avatar_url || null
  );

  db.prepare(`
    INSERT OR IGNORE INTO notification_preferences (
      user_id,
      alerts_enabled,
      ai_enabled,
      geo_enabled,
      push_enabled,
      local_fallback_enabled,
      ai_release_watch_enabled,
      ai_release_watch_companies_json,
      ai_release_watch_min_importance,
      direct_news_watch_enabled,
      direct_news_watch_sources_json,
      direct_news_watch_reason,
      created_at,
      updated_at
    ) VALUES (?, 1, 1, 1, 1, 1, 1, '["anthropic","openai","google","xai"]', 'major', 1, '["anthropic"]', 'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(user.id);
}

function enforceUserIsolation(query, userId) {
  if (!userId) {
    throw new Error('Security Violation: userId is required to enforce data isolation.');
  }
  // Simple validation to ensure that the SQL statement filters by user_id
  const lowerQuery = query.toLowerCase();
  const hasUserIdFilter = lowerQuery.includes('user_id') && (lowerQuery.includes('=') || lowerQuery.includes('in') || lowerQuery.includes('?'));
  
  if (!hasUserIdFilter) {
    throw new Error(`Security Violation: Query "${query}" does not filter strictly by user_id.`);
  }
  
  return {
    query,
    userId,
    isSecured: true
  };
}

module.exports = {
  ensureSqliteIdealState,
  syncSqliteUser,
  enforceUserIsolation,
};
