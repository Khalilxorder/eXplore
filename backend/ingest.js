#!/usr/bin/env node
// eXplore Ingestion CLI — Add YouTube URLs to the processing pipeline
// Usage: node ingest.js <url> [url2] [url3] ...
//        node ingest.js --file urls.txt

require('dotenv').config();
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const youtubeService = require('./services/youtubeService');
const aiService = require('./services/aiService');

const db = new Database(require('path').join(__dirname, 'explore.db'));

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function ingestWithQueue(urls) {
  console.log(`\n🔄 Queuing ${urls.length} URL(s) via BullMQ...\n`);
  
  const connection = new Redis(REDIS_URL);
  const queue = new Queue('ingestionQueue', { connection });

  for (const url of urls) {
    const job = await queue.add('ingest', { url }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    console.log(`  ✅ Queued: ${url} (Job ID: ${job.id})`);
  }

  await queue.close();
  await connection.quit();
  console.log(`\n✅ All ${urls.length} URL(s) queued. Start the worker with: node worker.js\n`);
}

async function ingestDirect(urls) {
  console.log(`\n🔄 Processing ${urls.length} URL(s) directly (no Redis required)...\n`);

  const results = [];

  for (const url of urls) {
    console.log(`\n────────────────────────────────────────`);
    console.log(`📺 Processing: ${url}`);
    console.log(`────────────────────────────────────────`);

    try {
      // 1. Fetch YouTube data
      console.log('  📥 Fetching YouTube metadata...');
      const videoData = await youtubeService.fetchVideoData(url);
      if (!videoData) {
        console.log('  ❌ Failed to fetch video data');
        results.push({ url, success: false, error: 'Fetch failed' });
        continue;
      }
      console.log(`  ✅ Title: "${videoData.title}"`);
      console.log(`  ✅ Channel: ${videoData.channelTitle}`);
      console.log(`  ✅ Duration: ${Math.floor(videoData.durationSeconds / 60)} min`);
      console.log(`  ✅ Views: ${videoData.viewCount?.toLocaleString()}`);

      // 2. Analyze with AI
      console.log('  🧠 Analyzing with AI...');
      const analysis = await aiService.analyzeContent(
        videoData.title,
        videoData.transcript,
        videoData.description
      );
      console.log(`  ✅ Summary: ${analysis.summary.slice(0, 80)}...`);
      console.log(`  ✅ Topics: ${analysis.topics.join(', ')}`);
      console.log(`  ✅ Scores: Depth=${analysis.scores.depth.toFixed(2)} Rarity=${analysis.scores.rarity.toFixed(2)} Fresh=${analysis.scores.freshness.toFixed(2)}`);
      console.log(`  ✅ Reason: ${analysis.reason}`);

      // 3. Generate embedding
      console.log('  📐 Generating embedding...');
      const embedding = await aiService.generateEmbedding(
        `${videoData.title}. ${analysis.summary}`
      );
      console.log(`  ✅ Embedding: ${embedding.length}-dimensional vector`);

      console.log('  💾 Saving to local explore.db...');
      const newId = crypto.randomUUID();
      const sourceId = 'src_' + Buffer.from(videoData.channelTitle).toString('base64').substring(0,8);
      
      const insertSource = db.prepare(`INSERT OR IGNORE INTO sources (id, platform, name) VALUES (?, 'youtube', ?)`);
      insertSource.run(sourceId, videoData.channelTitle);
      
      const insertItem = db.prepare(`
        INSERT INTO content_items (
          id, external_id, title, url, thumbnail_url, publish_date, 
          duration_seconds, summary, topic_tags_json, 
          rarity_score, depth_score, freshness_score, timeless_score,
          source_id, created_at, embedding_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?
        )
      `);
      
      try {
        insertItem.run(
          newId, videoData.videoId, videoData.title, url, videoData.thumbnailUrl,
          videoData.publishDate, videoData.durationSeconds, analysis.summary,
          JSON.stringify(analysis.topics), analysis.scores.rarity, analysis.scores.depth,
          analysis.scores.freshness, analysis.scores.timeless || 0.5,
          sourceId, JSON.stringify(embedding)
        );
      } catch (err) {
         if (!err.message.includes('UNIQUE constraint failed')) {
            throw err;
         }
      }

      const badges = determineBadges(analysis.scores, videoData);
      
      // Auto-insert a default reason based on badges or feed assignment
      const reasonType = badges.includes('rare') ? 'old' : badges.includes('new') ? 'new' : badges.includes('deep') ? 'deep' : 'care';
      const insertReason = db.prepare(`INSERT INTO recommendation_reasons (id, content_id, reason_type, reason_text) VALUES (?, ?, ?, ?)`);
      
      try {
         insertReason.run('rsn_' + newId, newId, reasonType, analysis.reason);
      } catch (err) {
          // Ignore
      }

      results.push({
        url,
        success: true,
        data: {
          id: videoData.videoId,
          title: videoData.title,
          source: videoData.channelTitle,
          badges: badges,
        }
      });

      console.log('  ✅ Done!');
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      results.push({ url, success: false, error: err.message });
    }
  }

  // Summary
  console.log(`\n════════════════════════════════════════`);
  console.log(`📊 Ingestion Report`);
  console.log(`════════════════════════════════════════`);
  console.log(`  Total: ${results.length}`);
  console.log(`  Success: ${results.filter(r => r.success).length}`);
  console.log(`  Failed: ${results.filter(r => !r.success).length}`);
  
  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.data.title}`);
    } else {
      console.log(`  ❌ ${r.url}: ${r.error}`);
    }
  }

  return results;
}

function determineBadges(scores, videoData) {
  const badges = [];
  if (scores.freshness > 0.7) badges.push('new');
  if (scores.rarity > 0.7) badges.push('rare');
  if (scores.timeless > 0.7) badges.push('timeless');
  if (scores.depth > 0.8 && videoData.durationSeconds > 3600) badges.push('deep');
  return badges;
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
  eXplore Ingestion CLI
  ─────────────────────
  Usage:
    node ingest.js <url> [url2] ...       Process YouTube URLs directly
    node ingest.js --queue <url> ...      Queue for BullMQ worker
    node ingest.js --file urls.txt        Process URLs from a file

  Examples:
    node ingest.js https://youtube.com/watch?v=dQw4w9WgXcQ
    node ingest.js --queue https://youtu.be/abc123
    `);
    process.exit(0);
  }

  let useQueue = false;
  let urls = [];

  for (const arg of args) {
    if (arg === '--queue') {
      useQueue = true;
    } else if (arg === '--file') {
      // Next arg should be filename
    } else if (args[args.indexOf(arg) - 1] === '--file') {
      const fs = require('fs');
      const content = fs.readFileSync(arg, 'utf-8');
      urls = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } else if (arg.startsWith('http')) {
      urls.push(arg);
    }
  }

  if (urls.length === 0) {
    console.error('❌ No valid URLs provided.');
    process.exit(1);
  }

  if (useQueue) {
    await ingestWithQueue(urls);
  } else {
    await ingestDirect(urls);
  }
}

main().catch(console.error);
