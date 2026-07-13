'use strict';

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const Database = require('better-sqlite3');
const path = require('path');
const youtubeService = require('./services/youtubeService');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log(`[Worker] Connecting to Redis at ${REDIS_URL}...`);
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const dbPath = path.join(__dirname, 'explore.db');
console.log(`[Worker] SQLite DB Path: ${dbPath}`);
const db = new Database(dbPath);

const worker = new Worker('ingestionQueue', async (job) => {
  const { url } = job.data;
  console.log(`📥 [Job ${job.id}] Processing URL: ${url}`);
  try {
    const itemId = await youtubeService.youtubeAdapter.process(url, db);
    console.log(`✅ [Job ${job.id}] Processed successfully. Item ID: ${itemId}`);
    return { itemId };
  } catch (error) {
    console.error(`❌ [Job ${job.id}] Process failed: ${error.message}`);
    throw error;
  }
}, {
  connection,
  concurrency: 1, // Concurrency limit for API/AI calls
});

worker.on('completed', (job, result) => {
  console.log(`[Worker] Job ${job.id} completed. Result:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down gracefully...');
  await worker.close();
  connection.disconnect();
  db.close();
  process.exit(0);
});

console.log('[Worker] eXplore Ingestion Worker is running and listening for jobs...');
