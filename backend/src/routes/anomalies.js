const { getLiveAnomalyFeed } = require('../services/anomalyFeedService');

const MOCK_ANOMALIES = [
  {
    id: 'mock-1',
    platform: 'tiktok',
    creatorUsername: 'quantum_physics_dude',
    creatorFollowers: 1200,
    videoViews: 5400000,
    engagementRatio: 4500,
    anomalyScore: 9.2,
    aiHookAnalysis: 'Extremely rare physics phenomenon explained in seconds.',
    sentimentBreakdown: { shock: 8, confusion: 9, praise: 2, intelligence: 9 },
    localVideoPath: '/api/v1/anomalies/video/mock_video_1.mp4',
    videoUrl: null,
    sourceUrl: null,
    thumbnailUrl: null,
  },
  {
    id: 'mock-2',
    platform: 'instagram',
    creatorUsername: 'unknown_art_history',
    creatorFollowers: 500,
    videoViews: 2100000,
    engagementRatio: 4200,
    anomalyScore: 8.8,
    aiHookAnalysis: 'A hidden detail in a famous renaissance painting.',
    sentimentBreakdown: { shock: 9, confusion: 7, praise: 5, intelligence: 8 },
    localVideoPath: '/api/v1/anomalies/video/mock_video_2.mp4',
    videoUrl: null,
    sourceUrl: null,
    thumbnailUrl: null,
  },
];

async function anomalyRoutes(fastify) {
  fastify.get('/feed', async (request) => {
    if (!process.env.APIFY_API_TOKEN) {
      return {
        success: true,
        anomalies: MOCK_ANOMALIES,
        source: 'mock',
        message: 'APIFY_API_TOKEN is missing, so the anomaly radar is using mock content.',
      };
    }

    try {
      const anomalies = await getLiveAnomalyFeed();
      if (anomalies.length === 0) {
        return {
          success: true,
          anomalies: [],
          source: 'live',
          message: 'No high-ratio anomalies were found in the latest short-form scrape.',
        };
      }

      return {
        success: true,
        anomalies,
        source: 'live',
      };
    } catch (error) {
      request.log.error(error, 'Failed to build live anomaly feed');
      return {
        success: true,
        anomalies: MOCK_ANOMALIES,
        source: 'mock',
        message: 'Live anomaly scraping failed, so mock content is being used instead.',
      };
    }
  });
}

module.exports = anomalyRoutes;
