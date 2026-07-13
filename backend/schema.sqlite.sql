-- Explore MVP SQLite Database Schema
-- Simplified for local development without Docker/Postgres

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  theme TEXT DEFAULT 'system',
  depth_pref REAL DEFAULT 0.5,
  rarity_pref REAL DEFAULT 0.5,
  length_pref REAL DEFAULT 0.5,
  onboarding INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  parent_id TEXT REFERENCES topics(id),
  icon TEXT,
  embedding_json TEXT, -- Mock vector
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id),
  weight REAL DEFAULT 1.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT UNIQUE,
  trust_tier INTEGER DEFAULT 3,
  category TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id),
  name TEXT NOT NULL,
  channel_url TEXT,
  subscriber_count INTEGER,
  trust_score REAL DEFAULT 0.5,
  expertise_topics_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id),
  creator_id TEXT REFERENCES creators(id),
  external_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  publish_date DATETIME,
  duration_seconds INTEGER,
  language TEXT DEFAULT 'en',
  view_count INTEGER,
  transcript TEXT,
  summary TEXT,
  embedding_json TEXT,
  rarity_score REAL DEFAULT 0,
  depth_score REAL DEFAULT 0,
  trust_score REAL DEFAULT 0,
  freshness_score REAL DEFAULT 0,
  timeless_score REAL DEFAULT 0,
  clickbait_score REAL DEFAULT 0,
  ingest_status TEXT DEFAULT 'ready',
  transcript_status TEXT DEFAULT 'missing',
  transcript_provider TEXT,
  analysis_provider TEXT,
  analysis_model TEXT,
  analysis_error TEXT,
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding_error TEXT,
  topic_tags_json TEXT,
  content_type TEXT DEFAULT 'video',
  article_body TEXT,
  channel_type TEXT DEFAULT 'socialVideo',
  life_impact REAL DEFAULT 0,
  decision_usefulness REAL DEFAULT 0,
  distraction_risk REAL DEFAULT 0,
  template_analysis_json TEXT,
  analysis_updated_at DATETIME,
  visual_meaning_label TEXT,
  visual_meaning_prompt TEXT,
  visual_meaning_status TEXT DEFAULT 'prompt_ready',
  visual_meaning_image_url TEXT,
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT REFERENCES content_items(id),
  action TEXT NOT NULL,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT REFERENCES content_items(id),
  collection_id TEXT REFERENCES collections(id),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, content_id)
);

CREATE TABLE IF NOT EXISTS saved_opportunities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  opportunity_type TEXT NOT NULL, -- 'job' or 'scholarship'
  title TEXT NOT NULL,
  company_or_org TEXT,
  location_or_country TEXT,
  details_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, opportunity_id, opportunity_type)
);

CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user
  ON saved_opportunities (user_id);


CREATE TABLE IF NOT EXISTS user_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  creator_id TEXT REFERENCES creators(id),
  trusted INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, creator_id)
);

CREATE TABLE IF NOT EXISTS recommendation_reasons (
  id TEXT PRIMARY KEY,
  content_id TEXT REFERENCES content_items(id),
  user_id TEXT REFERENCES users(id),
  reason_type TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Subscription System ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly REAL DEFAULT 0,
  price_yearly REAL DEFAULT 0,
  max_family_members INTEGER DEFAULT 1,
  features_json TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  tier_id TEXT REFERENCES subscription_tiers(id),
  status TEXT DEFAULT 'active',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  billing_cycle TEXT DEFAULT 'monthly',
  referral_months_remaining INTEGER DEFAULT 0,
  UNIQUE(user_id)
);

-- ─── Family System ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  safe_screen INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS family_members (
  id TEXT PRIMARY KEY,
  family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(family_id, user_id)
);

CREATE TABLE IF NOT EXISTS family_goals (
  id TEXT PRIMARY KEY,
  family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
  goal_text TEXT NOT NULL,
  topic_tags_json TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── B2B Anomaly Radar API Keys ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner_name TEXT,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  tier TEXT DEFAULT 'starter',
  rate_limit_daily INTEGER DEFAULT 100,
  requests_today INTEGER DEFAULT 0,
  requests_reset_at DATE DEFAULT CURRENT_DATE,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Referral System ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_id TEXT REFERENCES users(id),
  referee_id TEXT REFERENCES users(id),
  code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  converted_at DATETIME
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alerts_enabled INTEGER DEFAULT 1,
  ai_enabled INTEGER DEFAULT 1,
  geo_enabled INTEGER DEFAULT 0,
  push_enabled INTEGER DEFAULT 1,
  local_fallback_enabled INTEGER DEFAULT 1,
  ai_release_watch_enabled INTEGER DEFAULT 1,
  ai_release_watch_companies_json TEXT DEFAULT '["anthropic","openai","google","xai"]',
  ai_release_watch_min_importance TEXT DEFAULT 'major',
  direct_news_watch_enabled INTEGER DEFAULT 1,
  direct_news_watch_sources_json TEXT DEFAULT '["anthropic"]',
  direct_news_watch_reason TEXT DEFAULT 'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  device_id TEXT,
  app_version TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'queued',
  error_message TEXT,
  provider_message_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_chat_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_conversations (
  id TEXT PRIMARY KEY,
  participant_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME,
  CHECK (participant_a <> participant_b),
  CHECK (participant_a < participant_b),
  CHECK (created_by IN (participant_a, participant_b)),
  UNIQUE(participant_a, participant_b)
);

CREATE INDEX IF NOT EXISTS idx_private_conversations_participant_a
  ON private_conversations (participant_a, last_message_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_private_conversations_participant_b
  ON private_conversations (participant_b, last_message_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS private_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  reply_to_message_id TEXT REFERENCES private_messages(id) ON DELETE SET NULL,
  edited_at DATETIME,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_private_messages_conversation
  ON private_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_private_messages_sender
  ON private_messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_private_messages_reply_to
  ON private_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS private_read_receipts (
  conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS private_typing_status (
  conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_typing INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS private_conversation_preferences (
  conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_pinned INTEGER DEFAULT 0,
  is_muted INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS priority_alerts (
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
);

CREATE INDEX IF NOT EXISTS idx_priority_alerts_published
  ON priority_alerts (published_at DESC, score DESC);

CREATE TABLE IF NOT EXISTS user_alert_states (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT REFERENCES priority_alerts(id) ON DELETE CASCADE,
  seen_at DATETIME,
  opened_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_user_alert_states_user
  ON user_alert_states (user_id, opened_at, seen_at);

CREATE TABLE IF NOT EXISTS priority_alert_reviews (
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
);

CREATE INDEX IF NOT EXISTS idx_priority_alert_reviews_time
  ON priority_alert_reviews (reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_priority_alert_reviews_category
  ON priority_alert_reviews (category, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS worker_runtime_status (
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
);

CREATE TABLE IF NOT EXISTS youtube_tracked_channels (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL DEFAULT 'public',
  channel_key TEXT NOT NULL,
  channel_id TEXT,
  channel_query TEXT,
  channel_name TEXT,
  channel_url TEXT,
  lane TEXT NOT NULL DEFAULT 'tracked',
  trust_tier INTEGER DEFAULT 3,
  active INTEGER DEFAULT 1,
  system_managed INTEGER DEFAULT 0,
  last_checked_at DATETIME,
  last_success_at DATETIME,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_key, channel_key, lane)
);

CREATE INDEX IF NOT EXISTS idx_youtube_tracked_channels_scope
  ON youtube_tracked_channels (scope_key, active, lane, updated_at DESC);

CREATE TABLE IF NOT EXISTS youtube_topic_monitors (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL DEFAULT 'public',
  query_key TEXT NOT NULL,
  query TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'personal_match',
  weight REAL DEFAULT 0.6,
  active INTEGER DEFAULT 1,
  system_managed INTEGER DEFAULT 0,
  last_checked_at DATETIME,
  last_success_at DATETIME,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_key, query_key)
);

CREATE INDEX IF NOT EXISTS idx_youtube_topic_monitors_scope
  ON youtube_topic_monitors (scope_key, active, intent, updated_at DESC);

CREATE TABLE IF NOT EXISTS watched_source_packs (
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
);

CREATE INDEX IF NOT EXISTS idx_watched_source_packs_scope
  ON watched_source_packs (scope_key, active, lane, updated_at DESC);

CREATE TABLE IF NOT EXISTS feed_candidates (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL DEFAULT 'public',
  content_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'youtube',
  lane TEXT NOT NULL,
  source_ref TEXT,
  source_label TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at DATETIME,
  duration_seconds INTEGER,
  view_count INTEGER DEFAULT 0,
  source_trust REAL DEFAULT 0,
  freshness_score REAL DEFAULT 0,
  personal_match_score REAL DEFAULT 0,
  decision_score REAL DEFAULT 0,
  exploration_score REAL DEFAULT 0,
  clickbait_penalty REAL DEFAULT 0,
  overall_score REAL DEFAULT 0,
  why_selected TEXT,
  stale INTEGER DEFAULT 0,
  raw_json TEXT DEFAULT '{}',
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_key, external_id, lane)
);

CREATE INDEX IF NOT EXISTS idx_feed_candidates_scope
  ON feed_candidates (scope_key, stale, overall_score DESC, published_at DESC);

CREATE TABLE IF NOT EXISTS source_health_status (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL DEFAULT 'public',
  platform TEXT NOT NULL,
  lane TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_label TEXT,
  status TEXT DEFAULT 'idle',
  produced_items INTEGER DEFAULT 0,
  freshness_hours REAL DEFAULT 999,
  last_checked_at DATETIME,
  last_success_at DATETIME,
  last_error TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_key, platform, source_key, lane)
);

CREATE INDEX IF NOT EXISTS idx_source_health_scope
  ON source_health_status (scope_key, platform, lane, updated_at DESC);

-- ─── Affiliate Tracking ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affiliate_links (
  id TEXT PRIMARY KEY,
  content_id TEXT REFERENCES content_items(id),
  product_name TEXT,
  affiliate_url TEXT NOT NULL,
  provider TEXT DEFAULT 'amazon',
  clicks INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Meta Messaging Inbox

CREATE TABLE IF NOT EXISTS meta_channel_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  display_name TEXT,
  access_token TEXT,
  scopes_json TEXT DEFAULT '[]',
  page_id TEXT,
  instagram_account_id TEXT,
  business_account_id TEXT,
  phone_number_id TEXT,
  metadata_json TEXT DEFAULT '{}',
  connected_at DATETIME,
  last_webhook_at DATETIME,
  last_sync_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, channel_type)
);

CREATE TABLE IF NOT EXISTS meta_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES meta_channel_connections(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL,
  external_thread_key TEXT NOT NULL,
  participant_id TEXT,
  participant_name TEXT,
  participant_handle TEXT,
  participant_avatar_url TEXT,
  last_message_preview TEXT,
  last_message_at DATETIME,
  unread_count INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, channel_type, external_thread_key)
);

CREATE TABLE IF NOT EXISTS meta_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES meta_conversations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  recipient_id TEXT,
  text TEXT,
  delivery_status TEXT DEFAULT 'received',
  raw_payload_json TEXT DEFAULT '{}',
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_type, external_message_id)
);

CREATE TABLE IF NOT EXISTS meta_webhook_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL,
  event_uid TEXT UNIQUE NOT NULL,
  payload_json TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS music_tracks (
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
);

CREATE TABLE IF NOT EXISTS music_track_stats (
  id TEXT PRIMARY KEY,
  track_id TEXT REFERENCES music_tracks(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  streams_views INTEGER DEFAULT 0,
  reels_count INTEGER DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0.0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_music_track_stats_track ON music_track_stats(track_id);

-- AI Chat history tables for guest fallback / local environment
CREATE TABLE IF NOT EXISTS ai_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Personal Intelligence Engine Requirements ─────────────────────────

CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  platform TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_content_sources_user ON content_sources (user_id);

CREATE TABLE IF NOT EXISTS content_chunks (
  id TEXT PRIMARY KEY,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  start_time_seconds REAL,
  end_time_seconds REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(content_item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_content_chunks_item ON content_chunks (content_item_id);

CREATE TABLE IF NOT EXISTS content_item_embeddings (
  id TEXT PRIMARY KEY,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES content_chunks(id) ON DELETE CASCADE,
  embedding_json TEXT NOT NULL,
  model_version TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_item_embeddings_item ON content_item_embeddings (content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_item_embeddings_chunk ON content_item_embeddings (chunk_id);

CREATE TABLE IF NOT EXISTS interaction_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_data_json TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interaction_events_user ON interaction_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_interests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  interest_name TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, interest_name)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests (user_id);

CREATE TABLE IF NOT EXISTS user_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  goal_text TEXT NOT NULL,
  target_date DATETIME,
  status TEXT DEFAULT 'active',
  priority TEXT DEFAULT 'medium',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_goals_user ON user_goals (user_id);

CREATE TABLE IF NOT EXISTS user_preference_profiles (
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
);

CREATE INDEX IF NOT EXISTS idx_user_pref_profiles_user ON user_preference_profiles (user_id);

CREATE TABLE IF NOT EXISTS user_profile_vectors (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  profile_type TEXT NOT NULL DEFAULT 'interests',
  vector_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, profile_type, model_version)
);

CREATE INDEX IF NOT EXISTS idx_user_profile_vectors_user ON user_profile_vectors (user_id);

CREATE TABLE IF NOT EXISTS recommendations (
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
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_score ON recommendations (user_id, score DESC);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  content_text TEXT NOT NULL,
  importance_score REAL DEFAULT 0.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id);

CREATE TABLE IF NOT EXISTS memory_questions (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  last_asked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_questions_memory ON memory_questions (memory_id);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  version_string TEXT NOT NULL UNIQUE,
  parameters_json TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_runs (
  id TEXT PRIMARY KEY,
  model_version_id TEXT REFERENCES model_versions(id),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  metrics_json TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_runs_user ON training_runs (user_id);

CREATE TABLE IF NOT EXISTS daily_user_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  insight_date DATE NOT NULL,
  insight_text TEXT NOT NULL,
  topics_covered_json TEXT DEFAULT '[]',
  metrics_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_insights_user ON daily_user_insights (user_id, insight_date DESC);

-- Canonical Life Directed Intelligence extensions. The runtime bootstrap also
-- adds these columns to older local databases without a destructive migration.
ALTER TABLE topics ADD COLUMN owner_user_id TEXT;
ALTER TABLE topics ADD COLUMN instruction TEXT;
ALTER TABLE topics ADD COLUMN intended_outcome TEXT;
ALTER TABLE topics ADD COLUMN included_concepts_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN excluded_concepts_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN entities_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN locations_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN languages_json TEXT DEFAULT '["en"]';
ALTER TABLE topics ADD COLUMN content_types_json TEXT DEFAULT '["written","video"]';
ALTER TABLE topics ADD COLUMN importance_threshold TEXT DEFAULT 'important';
ALTER TABLE topics ADD COLUMN notification_policy_json TEXT DEFAULT '{}';
ALTER TABLE topics ADD COLUMN search_queries_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN source_discovery_queries_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN linked_goals_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN linked_story_layers_json TEXT DEFAULT '[]';
ALTER TABLE topics ADD COLUMN coverage_status TEXT DEFAULT 'unavailable';
ALTER TABLE topics ADD COLUMN last_sweep_at DATETIME;
ALTER TABLE topics ADD COLUMN next_sweep_at DATETIME;
ALTER TABLE topics ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_theory_evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_theory_evidence_user
  ON user_theory_evidence (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS topic_instruction_versions (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topic_sources (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  source_role TEXT,
  notes TEXT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(topic_id, source_id)
);

CREATE TABLE IF NOT EXISTS source_checks (
  id TEXT PRIMARY KEY,
  topic_id TEXT,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'never_checked',
  retrieval_method TEXT,
  last_checked_at DATETIME,
  last_success_at DATETIME,
  last_error TEXT,
  freshness_hours REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_web_claims (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uncertain',
  event_time DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_web_evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  source_id TEXT,
  relation TEXT NOT NULL DEFAULT 'supporting',
  url TEXT,
  excerpt TEXT,
  confidence REAL DEFAULT 0.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
