import { pgTable, uuid, text, integer, decimal, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const platformEnum = pgEnum('platform', ['tiktok', 'instagram']);

export const anomalousVideos = pgTable('anomalous_videos', {
  id: uuid('id').defaultRandom().primaryKey(),
  platform: platformEnum('platform').notNull(),
  originalUrl: text('original_url').notNull(),
  localVideoPath: text('local_video_path').notNull(),
  creatorUsername: text('creator_username').notNull(),
  creatorFollowers: integer('creator_followers').notNull(),
  videoViews: integer('video_views').notNull(),
  engagementRatio: decimal('engagement_ratio').notNull(),
  anomalyScore: decimal('anomaly_score').notNull(),
  aiHookAnalysis: text('ai_hook_analysis'),
  sentimentBreakdown: jsonb('sentiment_breakdown'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
