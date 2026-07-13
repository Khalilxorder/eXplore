'use strict';

const youtubeService = require('../../services/youtubeService');
const aiService = require('../../services/aiService');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cachedZeitgeist = {
  data: null,
  timestamp: 0,
};

function normalizeTimeline(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'daily') return 'Daily';
  if (normalized === 'monthly') return 'Monthly';
  if (normalized === 'yearly') return 'Yearly';
  return 'Monthly';
}

function normalizePercentage(value, fallback = 20) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function buildFallbackReport(videos = []) {
  const fallbackWeights = [35, 25, 20, 20];
  const themes = videos.slice(0, 4).map((video, index) => {
    const title = String(video?.title || '').trim().split('|')[0].trim();
    const descriptionSeed = String(video?.description || '').trim();

    return {
      title: title || `Signal ${index + 1}`,
      description: descriptionSeed
        ? descriptionSeed.slice(0, 220)
        : `Watch how "${title || 'this signal'}" is shaping cultural conversation right now.`,
      timeline: 'Daily',
      percentage: fallbackWeights[index] || 15,
    };
  });

  if (!themes.length) {
    themes.push(
      {
        title: 'Breaking signals',
        description: 'Fast-moving updates are dominating attention and sentiment right now.',
        timeline: 'Daily',
        percentage: 50,
      },
      {
        title: 'Longer trendlines',
        description: 'A slower strategic narrative is continuing beneath short-term headlines.',
        timeline: 'Monthly',
        percentage: 50,
      }
    );
  }

  return {
    themes,
    summary: 'Culture signals are updating. Refresh soon for a richer synthesized report.',
  };
}

function normalizeReport(report, videos = []) {
  if (!report || typeof report !== 'object') {
    return buildFallbackReport(videos);
  }

  const rawThemes = Array.isArray(report.themes) ? report.themes : [];
  const normalizedThemes = rawThemes.slice(0, 6).map((theme, index) => {
    const video = videos[index] || videos[0] || null;
    const title = String(theme?.title || '').trim() || String(video?.title || '').trim().slice(0, 80) || `Signal ${index + 1}`;
    const description = String(theme?.description || '').trim()
      || String(video?.description || '').trim().slice(0, 220)
      || `Tracking emerging conversation around "${title}".`;

    return {
      title: title.slice(0, 120),
      description: description.slice(0, 500),
      timeline: normalizeTimeline(theme?.timeline),
      percentage: normalizePercentage(theme?.percentage, 20),
    };
  }).filter((theme) => theme.title.length > 0);

  if (!normalizedThemes.length) {
    return buildFallbackReport(videos);
  }

  return {
    themes: normalizedThemes,
    summary: String(report.summary || '').trim() || 'Culture conversation is shifting rapidly across entertainment, online discourse, and world events.',
  };
}

async function generateZeitgeistReport() {
  if (cachedZeitgeist.data && (Date.now() - cachedZeitgeist.timestamp < CACHE_TTL_MS)) {
    return cachedZeitgeist.data;
  }

  try {
    const today = new Date();
    today.setDate(today.getDate() - 3); // Last 3 days
    const publishedAfter = today.toISOString();

    const [music, culture, news] = await Promise.all([
      youtubeService.searchRecentVideosWithOptions({ query: 'pop music OR trending song', maxResults: 10, publishedAfter }),
      youtubeService.searchRecentVideosWithOptions({ query: 'viral OR trending OR internet culture', maxResults: 15, publishedAfter }),
      youtubeService.searchRecentVideosWithOptions({ query: 'world news OR major event', maxResults: 10, publishedAfter })
    ]);

    const videos = [...music, ...culture, ...news];

    const corpus = videos.map(v => 
      `Title: ${v.title}
Channel: ${v.channelTitle}
Description: ${v.description || ''}
Published: ${v.publishDate}
---`
    ).join('\n');

    const prompt = `Analyze the following list of recent highly-viewed pop culture, music, and news videos.
Synthesize them into a structured "Culture Zeitgeist" report. Extract the top 4-6 emerging themes (e.g., Pop Music releases, Internet Memes, Tech, Geopolitics). 
For each theme, provide:
- A brief title
- A description of what the cultural conversation is about right now
- The timeline impact (classify as 'Daily', 'Monthly', or 'Yearly' based on how long this trend will matter)
- An estimated scientific percentage of its share of voice across these trends (e.g. 35%).

Return the response strictly as a JSON object with this shape:
{
  "themes": [
    {
      "title": "Theme Name",
      "description": "...",
      "timeline": "Daily | Monthly | Yearly",
      "percentage": 35
    }
  ],
  "summary": "Overall mood of the culture right now..."
}

Here is the data:
${corpus}`;

    const report = await aiService.generateStructuredJson({
      providerPreference: 'auto',
      temperature: 0.2,
      systemPrompt: 'You are an elite culture analyst. Return valid JSON only.',
      userPrompt: prompt,
    });
    const normalizedReport = normalizeReport(report, videos);

    cachedZeitgeist = {
      data: normalizedReport,
      timestamp: Date.now()
    };

    return normalizedReport;

  } catch (error) {
    console.error('[CultureService] Failed to generate Zeitgeist:', error);
    if (cachedZeitgeist.data) return cachedZeitgeist.data;
    return buildFallbackReport();
  }
}

module.exports = {
  generateZeitgeistReport
};
