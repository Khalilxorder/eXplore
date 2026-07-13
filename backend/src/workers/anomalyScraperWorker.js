const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { scrapeTrendingTikToks } = require('../services/scraperService');
const { filterAnomalies } = require('../services/anomalyMath');

// Setup Redis connection for BullMQ
const connection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
});

const anomalyQueue = new Queue('AnomalyScraperQueue', { connection });

// Define the worker that processes the anomaly jobs
const anomalyWorker = new Worker('AnomalyScraperQueue', async job => {
  console.log(`[BullMQ] Starting job: ${job.name} (ID: ${job.id})`);

  if (job.name === 'ScrapeTikTokTrends') {
    try {
      // 1. Fetch raw trending data from Apify
      const rawVideos = await scrapeTrendingTikToks(500);
      console.log(`[BullMQ] Scraped ${rawVideos.length} raw videos.`);

      // 2. Run the math to filter out non-anomalies
      const anomalousVideos = filterAnomalies(rawVideos);
      console.log(`[BullMQ] Math Filter Complete: Found ${anomalousVideos.length} anomalies.`);

      // TODO: 3. Pass survivors to Gemini LLM for sentiment/hook analysis
      // TODO: 4. Download the raw .mp4 for the final winners
      // TODO: 5. Save everything to PostgreSQL

      return { success: true, anomaliesFound: anomalousVideos.length };

    } catch (err) {
      console.error(`[BullMQ] Job ${job.id} failed:`, err);
      throw err;
    }
  }
}, { connection });

// Event handlers
anomalyWorker.on('completed', job => {
  console.log(`[BullMQ] Job ${job.id} completed successfully.`);
});

anomalyWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Job ${job.id} failed with error ${err.message}`);
});

/**
 * Helper to manually kick off a job or schedule a recurring cron
 */
async function scheduleAnomalyScrapes() {
  await anomalyQueue.add('ScrapeTikTokTrends', {}, {
    repeat: {
      pattern: '0 */6 * * *' // Every 6 hours
    }
  });
  console.log('[BullMQ] Anomaly scraping job scheduled (Every 6 hours).');
}

module.exports = {
  anomalyQueue,
  scheduleAnomalyScrapes
};
