const { ApifyClient } = require('apify-client');

const DEFAULT_TIKTOK_ACTOR_ID = 'therealdude/tiktok-scraper';
const DEFAULT_INSTAGRAM_ACTOR_ID = 'apify/instagram-scraper';

function getApifyClient() {
  if (!process.env.APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN is not configured');
  }

  return new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
  });
}

function getTikTokActorId() {
  return process.env.APIFY_TIKTOK_ACTOR_ID || DEFAULT_TIKTOK_ACTOR_ID;
}

function getInstagramActorId() {
  return process.env.APIFY_INSTAGRAM_ACTOR_ID || DEFAULT_INSTAGRAM_ACTOR_ID;
}

async function runActor(actorId, input) {
  const client = getApifyClient();
  const run = await client.actor(actorId).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

async function scrapeTrendingTikToks(limit = 25) {
  const actorId = getTikTokActorId();
  const hashtags = (process.env.APIFY_TIKTOK_HASHTAGS || 'trending,viral,fyp')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const input = {
    hashtags,
    resultsPerPage: limit,
    excludePinnedPosts: true,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  };

  return runActor(actorId, input);
}

async function scrapeInstagramPosts(url, limit = 5) {
  const actorId = getInstagramActorId();

  const input = {
    directUrls: [url],
    resultsType: 'posts',
    resultsLimit: limit,
  };

  return runActor(actorId, input);
}

module.exports = {
  scrapeTrendingTikToks,
  scrapeInstagramPosts,
  getTikTokActorId,
  getInstagramActorId,
};
