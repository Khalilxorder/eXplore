ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS direct_news_watch_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS direct_news_watch_sources_json TEXT DEFAULT '["anthropic"]',
  ADD COLUMN IF NOT EXISTS direct_news_watch_reason TEXT DEFAULT 'Notify me if a selected AI company becomes directly investable through a confirmed listing, filing, ticker, public offering, or direct listing report.';
