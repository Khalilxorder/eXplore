const { filterAnomalies } = require('./anomalyMath');
const { scrapeTrendingTikToks } = require('./scraperService');

const CACHE_TTL_MS = 15 * 60 * 1000;

let cachedFeed = [];
let cachedAt = 0;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function clampScore(value, min = 0, max = 10) {
  return Math.min(max, Math.max(min, value));
}

function truncate(text, maxLength = 120) {
  if (!text) {
    return 'Fast breakout from a small creator.';
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function extractDescription(video) {
  return pickFirst(video.text, video.description, video.caption, video.desc) || '';
}

function extractHashtags(video) {
  const tags = video.hashtags || video.hashTags || [];

  if (Array.isArray(tags)) {
    return tags
      .map((tag) => (typeof tag === 'string' ? tag : tag?.name || tag?.title || ''))
      .filter(Boolean);
  }

  return [];
}

function extractViews(video) {
  return toNumber(
    pickFirst(
      video.playCount,
      video.viewsCount,
      video.viewCount,
      video.stats?.playCount,
      video.stats?.views,
      video.videoMeta?.playCount
    )
  );
}

function extractFollowers(video) {
  return toNumber(
    pickFirst(
      video.authorMeta?.fans,
      video.authorMeta?.followers,
      video.author?.followerCount,
      video.authorStats?.followerCount,
      video.author?.followers
    )
  );
}

function extractCreatorUsername(video) {
  return pickFirst(
    video.authorMeta?.name,
    video.authorUniqueId,
    video.author?.uniqueId,
    video.author?.username,
    video.authorName,
    video.author?.nickname,
    'unknown_creator'
  );
}

function extractVideoUrl(video) {
  return pickFirst(
    video.playUrl,
    video.downloadUrl,
    video.videoUrl,
    video.videoMeta?.playUrl,
    video.videoMeta?.downloadUrl,
    video.videoMeta?.downloadAddr,
    video.videoMeta?.playAddr,
    video.downloadAddr,
    video.webVideoUrl
  );
}

function extractSourceUrl(video) {
  return pickFirst(
    video.webVideoUrl,
    video.url,
    video.shareUrl,
    video.videoLink
  );
}

function extractCoverUrl(video) {
  return pickFirst(
    video.coverUrl,
    video.originCover,
    video.thumbnailUrl,
    video.videoMeta?.coverUrl
  );
}

function estimateSentiment(description, hashtags) {
  const haystack = `${description} ${hashtags.join(' ')}`.toLowerCase();
  const countMatches = (keywords) => keywords.reduce((count, keyword) => count + (haystack.includes(keyword) ? 1 : 0), 0);

  const shockMatches = countMatches(['rare', 'secret', 'insane', 'crazy', 'wild', 'shocking', 'unbelievable', 'wtf']);
  const confusionMatches = countMatches(['weird', 'bizarre', 'strange', 'mystery', 'unknown', 'explained', 'confusing']);
  const intelligenceMatches = countMatches(['ai', 'science', 'physics', 'history', 'math', 'psychology', 'design', 'philosophy', 'research']);

  return {
    shock: clampScore(3 + shockMatches * 2),
    confusion: clampScore(2 + confusionMatches * 2),
    praise: clampScore(2 + countMatches(['genius', 'brilliant', 'amazing', 'masterpiece']) * 2),
    intelligence: clampScore(1 + intelligenceMatches * 2.5),
  };
}

function mapTikTokAnomaly(video, index) {
  const description = extractDescription(video);
  const hashtags = extractHashtags(video);
  const sentiment = estimateSentiment(description, hashtags);
  const baseScore = toNumber(video.baseAnomalyScore);
  const creatorFollowers = extractFollowers(video);
  const anomalyScore = clampScore(
    baseScore * 0.65
      + sentiment.intelligence * 0.2
      + ((sentiment.shock + sentiment.confusion) / 2) * 0.15
  );

  return {
    id: String(pickFirst(video.id, video.videoId, video.itemId, `tiktok-${index}`)),
    platform: 'tiktok',
    creatorUsername: extractCreatorUsername(video),
    creatorFollowers: creatorFollowers > 0 ? creatorFollowers : null,
    videoViews: extractViews(video),
    engagementRatio: toNumber(video.engagementRatio),
    anomalyScore,
    baselineType: video.baselineType || 'engagement_proxy',
    aiHookAnalysis: truncate(description || hashtags.map((tag) => `#${tag}`).join(' ')),
    sentimentBreakdown: sentiment,
    localVideoPath: null,
    videoUrl: extractVideoUrl(video),
    sourceUrl: extractSourceUrl(video),
    thumbnailUrl: extractCoverUrl(video),
    description,
    hashtags,
    publishDate: pickFirst(video.createTimeISO, video.createTime, video.createDate, null),
  };
}

async function getLiveAnomalyFeed({ limit = 10, forceRefresh = false } = {}) {
  const now = Date.now();

  if (!forceRefresh && cachedFeed.length > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedFeed.slice(0, limit);
  }

  const rawVideos = await scrapeTrendingTikToks(Math.max(limit * 3, 24));
  const anomalies = filterAnomalies(rawVideos)
    .map(mapTikTokAnomaly)
    .filter((video) => video.videoUrl || video.localVideoPath)
    .slice(0, limit);

  cachedFeed = anomalies;
  cachedAt = now;

  return anomalies;
}

module.exports = {
  getLiveAnomalyFeed,
};
