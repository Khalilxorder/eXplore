const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/explore'
});

async function run() {
  await client.connect();
  try {
    // Create enum
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_type') THEN
          CREATE TYPE platform_type AS ENUM ('tiktok', 'instagram');
        END IF;
      END$$;
    `);

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS anomalous_videos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        platform platform_type NOT NULL,
        original_url TEXT NOT NULL,
        local_video_path TEXT NOT NULL,
        creator_username VARCHAR NOT NULL,
        creator_followers INTEGER NOT NULL,
        video_views INTEGER NOT NULL,
        engagement_ratio DECIMAL NOT NULL,
        anomaly_score DECIMAL NOT NULL,
        ai_hook_analysis TEXT,
        sentiment_breakdown JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Successfully created `anomalous_videos` table.');
  } catch (error) {
    console.error('Error creating schema:', error);
  } finally {
    await client.end();
  }
}

run();
