function hasValue(name) {
  return Boolean(process.env[name]);
}

function hasAll(...names) {
  return names.every((name) => hasValue(name));
}

function hasYouTubeApiKey() {
  if (hasValue('YOUTUBE_API_KEY') || hasValue('YOUTUBE_API_KEYS')) {
    return true;
  }

  for (let index = 1; index <= 10; index += 1) {
    if (hasValue(`YOUTUBE_API_KEY_${index}`)) {
      return true;
    }
  }

  return false;
}

function buildSourceRegistry() {
  const hasApify = hasValue('APIFY_API_TOKEN');
  const hasYouTube = hasYouTubeApiKey();

  return [
    {
      id: 'youtube',
      name: 'YouTube',
      category: 'Long-form video',
      provider: 'YouTube Data API v3',
      coverage: 'Main feed ingestion',
      status: hasYouTube ? 'configured' : 'missing_key',
      envKeys: ['YOUTUBE_API_KEY', 'YOUTUBE_API_KEYS', 'YOUTUBE_API_KEY_1..10'],
      notes: hasYouTube
        ? 'Ready for real YouTube metadata ingestion, including pooled-key rotation if multiple keys are configured.'
        : 'Needs a YouTube Data API key.',
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      category: 'Short-form video',
      provider: 'Apify scraper',
      coverage: 'Anomaly radar / short-form discovery',
      status: hasApify ? 'partial' : 'missing_key',
      envKeys: ['APIFY_API_TOKEN'],
      notes: hasApify
        ? 'Live anomaly radar is enabled through Apify, but TikTok is not in the main feed yet.'
        : 'Needs APIFY_API_TOKEN to activate scraping.',
    },
    {
      id: 'instagram',
      name: 'Instagram',
      category: 'Short-form video',
      provider: 'Apify scraper',
      coverage: 'Main feed import',
      status: hasApify ? 'configured' : 'missing_key',
      envKeys: ['APIFY_API_TOKEN'],
      notes: hasApify
        ? 'Ready for Instagram profile and post import through Apify.'
        : 'Needs APIFY_API_TOKEN to activate scraping.',
    },
    {
      id: 'reddit',
      name: 'Reddit',
      category: 'Discussion',
      provider: 'Reddit API',
      coverage: 'Main feed import',
      status: hasAll('REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET') ? 'configured' : 'missing_key',
      envKeys: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
      notes: hasAll('REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET')
        ? 'Ready to import posts from a subreddit or Reddit URL.'
        : 'Needs Reddit app credentials.',
    },
    {
      id: 'x',
      name: 'X / Twitter',
      category: 'Short text',
      provider: 'X API',
      coverage: 'Main feed import',
      status: hasValue('X_BEARER_TOKEN') ? 'configured' : 'missing_key',
      envKeys: ['X_BEARER_TOKEN'],
      notes: hasValue('X_BEARER_TOKEN')
        ? 'Ready to import recent posts from an X profile.'
        : 'Needs an X API bearer token.',
    },
    {
      id: 'podcasts',
      name: 'Podcast RSS',
      category: 'Audio',
      provider: 'RSS / feed URLs',
      coverage: 'Main feed import',
      status: 'configured',
      envKeys: [],
      notes: 'Paste a podcast RSS feed URL to import recent episodes without platform auth.',
    },
  ];
}

module.exports = {
  buildSourceRegistry,
};
