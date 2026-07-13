-- Explore MVP Database Schema
-- Requires PostgreSQL with pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  theme         TEXT DEFAULT 'system',
  depth_pref    FLOAT DEFAULT 0.5,
  rarity_pref   FLOAT DEFAULT 0.5,
  length_pref   FLOAT DEFAULT 0.5,
  onboarding    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. topics
CREATE TABLE topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT UNIQUE NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  parent_id       UUID REFERENCES topics(id),
  icon            TEXT,
  embedding       VECTOR(1536),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. interests
CREATE TABLE interests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  topic_id    UUID REFERENCES topics(id),
  weight      FLOAT DEFAULT 1.0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, topic_id)
);

-- 4. sources
CREATE TABLE sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT NOT NULL,
  name        TEXT NOT NULL,
  url         TEXT UNIQUE,
  trust_tier  INT DEFAULT 3,
  category    TEXT,
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. creators
CREATE TABLE creators (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID REFERENCES sources(id),
  name              TEXT NOT NULL,
  channel_url       TEXT,
  subscriber_count  INT,
  trust_score       FLOAT DEFAULT 0.5,
  expertise_topics  TEXT[],
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 6. content_items
CREATE TABLE content_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID REFERENCES sources(id),
  creator_id        UUID REFERENCES creators(id),
  external_id       TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  thumbnail_url     TEXT,
  publish_date      TIMESTAMPTZ,
  duration_seconds  INT,
  language          TEXT DEFAULT 'en',
  view_count        INT,
  transcript        TEXT,
  summary           TEXT,
  embedding         VECTOR(1536),
  rarity_score      FLOAT DEFAULT 0,
  depth_score       FLOAT DEFAULT 0,
  trust_score       FLOAT DEFAULT 0,
  freshness_score   FLOAT DEFAULT 0,
  timeless_score    FLOAT DEFAULT 0,
  clickbait_score   FLOAT DEFAULT 0,
  ingest_status     TEXT DEFAULT 'ready',
  transcript_status TEXT DEFAULT 'missing',
  transcript_provider TEXT,
  analysis_provider TEXT,
  analysis_model    TEXT,
  analysis_error    TEXT,
  embedding_provider TEXT,
  embedding_model   TEXT,
  embedding_error   TEXT,
  topic_tags        TEXT[],
  content_type      TEXT DEFAULT 'video',
  indexed_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_embedding ON content_items USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_content_scores ON content_items (rarity_score, depth_score, freshness_score);

-- 7. user_interactions
CREATE TABLE user_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  content_id      UUID REFERENCES content_items(id),
  action          TEXT NOT NULL,
  duration_ms     INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interactions_user ON user_interactions (user_id, created_at DESC);

-- 8. collections
CREATE TABLE collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_public   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 9. saved_items
CREATE TABLE saved_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  content_id    UUID REFERENCES content_items(id),
  collection_id UUID REFERENCES collections(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

-- 10. user_sources
CREATE TABLE user_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  creator_id  UUID REFERENCES creators(id),
  trusted     BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, creator_id)
);

-- 11. recommendation_reasons
CREATE TABLE recommendation_reasons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  UUID REFERENCES content_items(id),
  user_id     UUID REFERENCES users(id),
  reason_type TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  score       FLOAT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscription_tiers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  price_monthly       FLOAT DEFAULT 0,
  price_yearly        FLOAT DEFAULT 0,
  max_family_members  INT DEFAULT 1,
  features_json       JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier_id                   UUID REFERENCES subscription_tiers(id),
  status                    TEXT DEFAULT 'active',
  started_at                TIMESTAMPTZ DEFAULT NOW(),
  expires_at                TIMESTAMPTZ,
  billing_cycle             TEXT DEFAULT 'monthly',
  referral_months_remaining INT DEFAULT 0
);

CREATE TABLE families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id),
  safe_screen BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE family_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  UUID REFERENCES families(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'member',
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(family_id, user_id)
);

CREATE TABLE family_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID REFERENCES families(id) ON DELETE CASCADE,
  goal_text       TEXT NOT NULL,
  topic_tags_json JSONB DEFAULT '[]'::jsonb,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE referrals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  UUID REFERENCES users(id),
  referee_id   UUID REFERENCES users(id),
  code         TEXT UNIQUE NOT NULL,
  status       TEXT DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  converted_at TIMESTAMPTZ
);

CREATE TABLE notification_preferences (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alerts_enabled         BOOLEAN DEFAULT TRUE,
  ai_enabled             BOOLEAN DEFAULT TRUE,
  geo_enabled            BOOLEAN DEFAULT TRUE,
  push_enabled           BOOLEAN DEFAULT TRUE,
  local_fallback_enabled BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE device_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT UNIQUE NOT NULL,
  platform     TEXT NOT NULL,
  device_id    TEXT,
  app_version  TEXT,
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  alert_id            TEXT NOT NULL,
  channel             TEXT NOT NULL,
  dedupe_key          TEXT UNIQUE NOT NULL,
  status              TEXT DEFAULT 'queued',
  error_message       TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE priority_alerts (
  id             TEXT PRIMARY KEY,
  fingerprint    TEXT UNIQUE NOT NULL,
  category       TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT,
  source         TEXT,
  published_at   TIMESTAMPTZ,
  summary        TEXT,
  why_it_matters TEXT,
  importance     TEXT,
  threat_level   TEXT,
  source_type    TEXT DEFAULT 'unknown',
  official_source BOOLEAN DEFAULT FALSE,
  qualified_reason TEXT,
  rejected_reason TEXT,
  score          INT DEFAULT 0,
  raw_json       JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_priority_alerts_published
  ON priority_alerts (published_at DESC, score DESC);

CREATE TABLE user_alert_states (
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  alert_id   TEXT REFERENCES priority_alerts(id) ON DELETE CASCADE,
  seen_at    TIMESTAMPTZ,
  opened_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, alert_id)
);

CREATE INDEX idx_user_alert_states_user
  ON user_alert_states (user_id, opened_at, seen_at);

CREATE TABLE priority_alert_reviews (
  id               TEXT PRIMARY KEY,
  category         TEXT,
  title            TEXT,
  url              TEXT,
  source           TEXT,
  published_at     TIMESTAMPTZ,
  source_type      TEXT DEFAULT 'unknown',
  official_source  BOOLEAN DEFAULT FALSE,
  score            INT DEFAULT 0,
  qualified_reason TEXT,
  rejected_reason  TEXT,
  reviewed_at      TIMESTAMPTZ DEFAULT NOW(),
  raw_json         JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_priority_alert_reviews_reviewed_at
  ON priority_alert_reviews (reviewed_at DESC);

CREATE INDEX idx_priority_alert_reviews_category
  ON priority_alert_reviews (category, reviewed_at DESC);

CREATE TABLE worker_runtime_status (
  worker_name       TEXT PRIMARY KEY,
  loop_mode         TEXT DEFAULT 'oneshot',
  last_status       TEXT DEFAULT 'never_run',
  last_started_at   TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_error        TEXT,
  last_summary_json TEXT,
  heartbeat_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
