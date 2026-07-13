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
  geo_enabled            BOOLEAN DEFAULT FALSE,
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

CREATE INDEX idx_priority_alert_reviews_time
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

CREATE TABLE youtube_tracked_channels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key      TEXT NOT NULL DEFAULT 'public',
  channel_key    TEXT NOT NULL,
  channel_id     TEXT,
  channel_query  TEXT,
  channel_name   TEXT,
  channel_url    TEXT,
  lane           TEXT NOT NULL DEFAULT 'tracked',
  trust_tier     INT DEFAULT 3,
  active         BOOLEAN DEFAULT TRUE,
  system_managed BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_key, channel_key, lane)
);

CREATE INDEX idx_youtube_tracked_channels_scope
  ON youtube_tracked_channels (scope_key, active, lane, updated_at DESC);

CREATE TABLE youtube_topic_monitors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key      TEXT NOT NULL DEFAULT 'public',
  query_key      TEXT NOT NULL,
  query          TEXT NOT NULL,
  intent         TEXT NOT NULL DEFAULT 'personal_match',
  weight         FLOAT DEFAULT 0.6,
  active         BOOLEAN DEFAULT TRUE,
  system_managed BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_key, query_key)
);

CREATE INDEX idx_youtube_topic_monitors_scope
  ON youtube_topic_monitors (scope_key, active, intent, updated_at DESC);

CREATE TABLE feed_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key             TEXT NOT NULL DEFAULT 'public',
  content_id            UUID REFERENCES content_items(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL,
  platform              TEXT NOT NULL DEFAULT 'youtube',
  lane                  TEXT NOT NULL,
  source_ref            TEXT,
  source_label          TEXT,
  title                 TEXT NOT NULL,
  url                   TEXT NOT NULL,
  thumbnail_url         TEXT,
  published_at          TIMESTAMPTZ,
  duration_seconds      INT,
  view_count            INT DEFAULT 0,
  source_trust          FLOAT DEFAULT 0,
  freshness_score       FLOAT DEFAULT 0,
  personal_match_score  FLOAT DEFAULT 0,
  decision_score        FLOAT DEFAULT 0,
  exploration_score     FLOAT DEFAULT 0,
  clickbait_penalty     FLOAT DEFAULT 0,
  overall_score         FLOAT DEFAULT 0,
  why_selected          TEXT,
  stale                 BOOLEAN DEFAULT FALSE,
  raw_json              JSONB DEFAULT '{}'::jsonb,
  last_seen_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_key, external_id, lane)
);

CREATE INDEX idx_feed_candidates_scope
  ON feed_candidates (scope_key, stale, overall_score DESC, published_at DESC);

CREATE TABLE source_health_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key       TEXT NOT NULL DEFAULT 'public',
  platform        TEXT NOT NULL,
  lane            TEXT NOT NULL,
  source_key      TEXT NOT NULL,
  source_label    TEXT,
  status          TEXT DEFAULT 'idle',
  produced_items  INT DEFAULT 0,
  freshness_hours FLOAT DEFAULT 999,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  metadata_json   JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_key, platform, source_key, lane)
);

CREATE INDEX idx_source_health_scope
  ON source_health_status (scope_key, platform, lane, updated_at DESC);

-- AI Chat history tables
CREATE TABLE ai_chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New conversation',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Canonical Life Directed Intelligence extensions.
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS instruction TEXT,
  ADD COLUMN IF NOT EXISTS intended_outcome TEXT,
  ADD COLUMN IF NOT EXISTS included_concepts_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excluded_concepts_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entities_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS locations_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS languages_json JSONB DEFAULT '["en"]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_types_json JSONB DEFAULT '["written","video"]'::jsonb,
  ADD COLUMN IF NOT EXISTS importance_threshold TEXT DEFAULT 'important',
  ADD COLUMN IF NOT EXISTS notification_policy_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_queries_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_discovery_queries_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_goals_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_story_layers_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_status TEXT DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS last_sweep_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_sweep_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_theory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topic_instruction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topic_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'suggested',
  source_role TEXT,
  notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(topic_id, source_id)
);

CREATE TABLE IF NOT EXISTS source_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'never_checked',
  retrieval_method TEXT,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  freshness_hours REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_web_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uncertain',
  event_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_web_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES source_web_claims(id) ON DELETE CASCADE,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  relation TEXT NOT NULL DEFAULT 'supporting',
  url TEXT,
  excerpt TEXT,
  confidence REAL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
