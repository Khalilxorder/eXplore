const test = require('node:test');
const assert = require('node:assert/strict');

const youtubeService = require('../services/youtubeService');
const transcriptService = require('../src/services/transcriptService');

test('YouTube requests rotate across configured keys when quota-like errors occur', async () => {
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalKey1 = process.env.YOUTUBE_API_KEY_1;
  const originalKey2 = process.env.YOUTUBE_API_KEY_2;
  const originalKeys = process.env.YOUTUBE_API_KEYS;

  process.env.YOUTUBE_API_KEY = '';
  process.env.YOUTUBE_API_KEYS = '';
  process.env.YOUTUBE_API_KEY_1 = 'AIzaValidYoutubeKey1234567890';
  process.env.YOUTUBE_API_KEY_2 = 'AIzaBackupYoutubeKey1234567890';

  const seenKeys = [];

  try {
    const result = await youtubeService.__test__.executeYouTubeRequest(async (_client, apiKey) => {
      seenKeys.push(apiKey);

      if (seenKeys.length === 1) {
        const error = new Error('The request cannot be completed because you have exceeded your quota.');
        error.code = 403;
        throw error;
      }

      return { ok: true };
    });

    assert.equal(result.ok, true);
    assert.deepEqual(seenKeys, [
      'AIzaValidYoutubeKey1234567890',
      'AIzaBackupYoutubeKey1234567890',
    ]);
  } finally {
    process.env.YOUTUBE_API_KEY = originalKey;
    process.env.YOUTUBE_API_KEY_1 = originalKey1;
    process.env.YOUTUBE_API_KEY_2 = originalKey2;
    process.env.YOUTUBE_API_KEYS = originalKeys;
  }
});

test('YouTube failed requests are capped so one call cannot drain the whole pool', async () => {
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalKey1 = process.env.YOUTUBE_API_KEY_1;
  const originalKey2 = process.env.YOUTUBE_API_KEY_2;
  const originalKey3 = process.env.YOUTUBE_API_KEY_3;
  const originalKey4 = process.env.YOUTUBE_API_KEY_4;
  const originalKeys = process.env.YOUTUBE_API_KEYS;

  process.env.YOUTUBE_API_KEY = '';
  process.env.YOUTUBE_API_KEYS = '';
  process.env.YOUTUBE_API_KEY_1 = 'AIzaValidYoutubeKey1111111111';
  process.env.YOUTUBE_API_KEY_2 = 'AIzaValidYoutubeKey2222222222';
  process.env.YOUTUBE_API_KEY_3 = 'AIzaValidYoutubeKey3333333333';
  process.env.YOUTUBE_API_KEY_4 = 'AIzaValidYoutubeKey4444444444';
  youtubeService.__test__.resetYouTubeKeyCooldowns();

  const seenKeys = [];

  try {
    await assert.rejects(
      () => youtubeService.__test__.executeYouTubeRequest(async (_client, apiKey) => {
        seenKeys.push(apiKey);
        const error = new Error('quota exceeded');
        error.code = 429;
        throw error;
      }),
      /quota exceeded/
    );

    assert.equal(seenKeys.length, 2);
    assert.deepEqual(youtubeService.__test__.getYouTubeKeyHealthSummary().cooldownStatuses, { 429: 2 });
  } finally {
    youtubeService.__test__.resetYouTubeKeyCooldowns();
    process.env.YOUTUBE_API_KEY = originalKey;
    process.env.YOUTUBE_API_KEY_1 = originalKey1;
    process.env.YOUTUBE_API_KEY_2 = originalKey2;
    process.env.YOUTUBE_API_KEY_3 = originalKey3;
    process.env.YOUTUBE_API_KEY_4 = originalKey4;
    process.env.YOUTUBE_API_KEYS = originalKeys;
  }
});

test('placeholder and junk YouTube API keys are ignored', () => {
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalKey1 = process.env.YOUTUBE_API_KEY_1;
  const originalKey2 = process.env.YOUTUBE_API_KEY_2;
  const originalKeys = process.env.YOUTUBE_API_KEYS;

  process.env.YOUTUBE_API_KEY = 'YOUR_PROD_YOUTUBE_KEY';
  process.env.YOUTUBE_API_KEYS = 'AIzaValidYoutubeKey1234567890, placeholder-demo-key';
  process.env.YOUTUBE_API_KEY_1 = 'y';
  process.env.YOUTUBE_API_KEY_2 = 'AIzaBackupYoutubeKey1234567890';

  try {
    assert.equal(youtubeService.__test__.isUsableYouTubeApiKey(process.env.YOUTUBE_API_KEY), false);
    assert.equal(youtubeService.__test__.isUsableYouTubeApiKey(process.env.YOUTUBE_API_KEY_1), false);
    assert.deepEqual([...youtubeService.__test__.getYouTubeApiKeys()].sort(), [
      'AIzaBackupYoutubeKey1234567890',
      'AIzaValidYoutubeKey1234567890',
    ]);
  } finally {
    process.env.YOUTUBE_API_KEY = originalKey;
    process.env.YOUTUBE_API_KEY_1 = originalKey1;
    process.env.YOUTUBE_API_KEY_2 = originalKey2;
    process.env.YOUTUBE_API_KEYS = originalKeys;
  }
});

test('temporarily cooling YouTube keys are retryable so public fallbacks remain available', () => {
  assert.equal(
    youtubeService.__test__.isRetryableYouTubeError(
      new Error('YouTube API keys are temporarily cooling (1/1).')
    ),
    true
  );
});

test('transient YouTube fetch failures are retryable so discovery can use public search', () => {
  assert.equal(youtubeService.__test__.isRetryableYouTubeError(new Error('fetch failed')), true);
});

test('search-result HTML fallback parses recent YouTube videos without an API key', () => {
  const payload = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'abc123xyz89',
                        thumbnail: {
                          thumbnails: [
                            { url: 'https://img.example/1.jpg', width: 360, height: 202 },
                            { url: 'https://img.example/2.jpg', width: 720, height: 404 },
                          ],
                        },
                        title: { runs: [{ text: 'Dario Amodei interview on Claude' }] },
                        longBylineText: {
                          runs: [
                            {
                              text: 'Dwarkesh Patel',
                              navigationEndpoint: { browseEndpoint: { browseId: 'UCdwarkesh' } },
                            },
                          ],
                        },
                        publishedTimeText: { simpleText: '3 days ago' },
                        viewCountText: { simpleText: '918,383 views' },
                        lengthText: { simpleText: '2:22:00' },
                        descriptionSnippet: { runs: [{ text: 'A long-form conversation about Claude and AI safety.' }] },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const html = `<html><body><script>var ytInitialData = ${JSON.stringify(payload)};</script></body></html>`;

  const results = youtubeService.__test__.parseSearchResultsFromHtml(html, 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].videoId, 'abc123xyz89');
  assert.equal(results[0].title, 'Dario Amodei interview on Claude');
  assert.equal(results[0].channelTitle, 'Dwarkesh Patel');
  assert.equal(results[0].channelId, 'UCdwarkesh');
  assert.equal(results[0].thumbnailUrl, 'https://img.example/2.jpg');
  assert.equal(results[0].durationSeconds, 8520);
  assert.equal(results[0].viewCount, 918383);
  assert.equal(results[0].url, 'https://www.youtube.com/watch?v=abc123xyz89');
  assert.ok(results[0].publishDate);
});

test('fetchPublicTranscript returns standardized metadata for public captions', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input) => {
    const url = String(input || '');
    if (url.includes('/watch?v=video1234567')) {
      return {
        ok: true,
        text: async () => '<html><script>"captionTracks":[{"languageCode":"en","baseUrl":"https://example.com/captions"}]</script></html>',
      };
    }

    if (url.startsWith('https://example.com/captions')) {
      return {
        ok: true,
        json: async () => ({
          events: [
            { segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
            { segs: [{ utf8: ' from transcripts' }] },
          ],
        }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const result = await transcriptService.fetchPublicTranscript('video1234567');

    assert.equal(result.transcript, 'Hello world from transcripts');
    assert.equal(result.transcriptStatus, 'available');
    assert.equal(result.transcriptSource, 'public_captions');
    assert.equal(result.transcriptPreview, 'Hello world from transcripts');
    assert.match(result.transcriptUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.transcriptProvider, 'youtube-json3');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPublicTranscript reports unavailable explicitly when captions are missing', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    text: async () => '<html><body>No captions here</body></html>',
  });

  try {
    const result = await transcriptService.fetchPublicTranscript('video7654321');

    assert.equal(result.transcript, '');
    assert.equal(result.transcriptStatus, 'unavailable');
    assert.equal(result.transcriptSource, 'unavailable');
    assert.equal(result.transcriptPreview, '');
    assert.match(result.transcriptUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('description fallback is standardized when transcript metadata is missing', () => {
  const normalized = youtubeService.__test__.buildTranscriptMetadata(
    {
      transcriptStatus: 'unavailable',
      transcriptSource: 'unavailable',
      transcriptProvider: 'youtube-watch-page',
    },
    'This is the video description and becomes the fallback text.'
  );

  assert.equal(normalized.transcript, 'This is the video description and becomes the fallback text.');
  assert.equal(normalized.transcriptStatus, 'description_only');
  assert.equal(normalized.transcriptSource, 'description_fallback');
  assert.equal(normalized.transcriptPreview, 'This is the video description and becomes the fallback text.');
  assert.equal(normalized.transcriptProvider, 'youtube-watch-page');
  assert.equal(normalized.transcript_status, 'description_only');
});

test('public YouTube search retries a transient failure and shares cached results', async () => {
  const originalFetch = global.fetch;
  const payload = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [{
                  videoRenderer: {
                    videoId: 'cachetest001',
                    thumbnail: { thumbnails: [{ url: 'https://img.example/cache.jpg' }] },
                    title: { runs: [{ text: 'Cached public YouTube result' }] },
                    longBylineText: { runs: [{ text: 'eXplore test channel' }] },
                    publishedTimeText: { simpleText: '1 hour ago' },
                  },
                }],
              },
            }],
          },
        },
      },
    },
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(payload)};</script></html>`;
  let calls = 0;

  youtubeService.__test__.resetPublicYoutubeFallbackCaches();
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('fetch failed');
    }

    return {
      ok: true,
      status: 200,
      text: async () => html,
    };
  };

  try {
    const first = await youtubeService.__test__.searchRecentVideosWithoutApiKey('eXplore cache test', 3);
    const second = await youtubeService.__test__.searchRecentVideosWithoutApiKey('eXplore cache test', 3);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].title, 'Cached public YouTube result');
    assert.equal(calls, 2);
  } finally {
    youtubeService.__test__.resetPublicYoutubeFallbackCaches();
    global.fetch = originalFetch;
  }
});

test('hydration uses public metadata when every configured key is cooling', async () => {
  const envNames = [
    'YOUTUBE_API_KEY',
    'YOUTUBE_API_KEYS',
    ...Array.from({ length: 10 }, (_value, index) => `YOUTUBE_API_KEY_${index + 1}`),
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;

  for (const name of envNames) {
    delete process.env[name];
  }
  process.env.YOUTUBE_API_KEY = 'AIzaPublicFallbackKey1234567890';
  youtubeService.__test__.resetYouTubeKeyCooldowns();
  youtubeService.__test__.resetPublicYoutubeFallbackCaches();
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body>No captions here</body></html>',
  });

  try {
    await assert.rejects(
      () => youtubeService.__test__.executeYouTubeRequest(async () => {
        const error = new Error('quota exceeded');
        error.code = 429;
        throw error;
      }),
      /quota exceeded/
    );

    const results = await youtubeService.hydrateSearchResults([{
      videoId: 'publicmeta1',
      title: 'Public metadata remains visible',
      description: 'A usable public description.',
      durationSeconds: 120,
      viewCount: 42,
      url: 'https://www.youtube.com/watch?v=publicmeta1',
    }]);

    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Public metadata remains visible');
    assert.equal(results[0].durationSeconds, 120);
    assert.equal(results[0].viewCount, 42);
    assert.equal(results[0].transcriptStatus, 'description_only');
  } finally {
    youtubeService.__test__.resetYouTubeKeyCooldowns();
    youtubeService.__test__.resetPublicYoutubeFallbackCaches();
    for (const name of envNames) {
      if (originalEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalEnv[name];
      }
    }
    global.fetch = originalFetch;
  }
});

test('channel fallback does not repeat a failed RSS request before public search', async () => {
  const envNames = [
    'YOUTUBE_API_KEY',
    'YOUTUBE_API_KEYS',
    ...Array.from({ length: 10 }, (_value, index) => `YOUTUBE_API_KEY_${index + 1}`),
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const channelId = 'UCpublicchannel1234567890';
  const payload = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [{
                  videoRenderer: {
                    videoId: 'channeltest1',
                    thumbnail: { thumbnails: [{ url: 'https://img.example/channel.jpg' }] },
                    title: { runs: [{ text: 'Official channel update' }] },
                    longBylineText: {
                      runs: [{
                        text: 'Official Channel',
                        navigationEndpoint: { browseEndpoint: { browseId: channelId } },
                      }],
                    },
                    publishedTimeText: { simpleText: '2 hours ago' },
                  },
                }],
              },
            }],
          },
        },
      },
    },
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(payload)};</script></html>`;
  const calls = [];

  for (const name of envNames) {
    delete process.env[name];
  }
  youtubeService.__test__.resetPublicYoutubeFallbackCaches();
  global.fetch = async (input) => {
    const url = String(input || '');
    calls.push(url);
    if (url.includes('/feeds/videos.xml')) {
      return { ok: false, status: 404, text: async () => '' };
    }
    if (url.includes('/results?')) {
      return { ok: true, status: 200, text: async () => html };
    }
    if (url.includes('/watch?v=channeltest1')) {
      return { ok: true, status: 200, text: async () => '<html><body>No captions</body></html>' };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const results = await youtubeService.fetchRecentVideosByChannel(channelId, {
      maxResults: 1,
      query: 'Official Channel',
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].videoId, 'channeltest1');
    assert.equal(calls.filter((url) => url.includes('/feeds/videos.xml')).length, 1);
    assert.equal(calls.length, 3);
  } finally {
    youtubeService.__test__.resetPublicYoutubeFallbackCaches();
    for (const name of envNames) {
      if (originalEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalEnv[name];
      }
    }
    global.fetch = originalFetch;
  }
});
