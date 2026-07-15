const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, snapshot);
}

function loadWrittenNewsService() {
  const aiModulePath = path.resolve(__dirname, '../services/aiService.js');
  const serviceModulePath = path.resolve(__dirname, '../src/services/writtenNewsService.js');

  delete require.cache[aiModulePath];
  delete require.cache[serviceModulePath];

  const service = require(serviceModulePath);
  const aiService = require(aiModulePath);
  return { service, aiService };
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      platform TEXT,
      name TEXT,
      url TEXT,
      trust_tier INTEGER,
      category TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      external_id TEXT UNIQUE,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      publish_date TEXT,
      transcript TEXT,
      summary TEXT,
      embedding_json TEXT,
      rarity_score REAL,
      depth_score REAL,
      freshness_score REAL,
      timeless_score REAL,
      clickbait_score REAL,
      trust_score REAL,
      topic_tags_json TEXT,
      content_type TEXT,
      article_body TEXT,
      channel_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function createResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => body,
  };
}

test('parseFeedItems keeps the newest written items first even when feed order is older-first', () => {
  const { service } = loadWrittenNewsService();
  const xml = `<?xml version="1.0"?>
    <rss>
      <channel>
        <title>Example Feed</title>
        <item>
          <title>Older entry</title>
          <link>https://example.com/older</link>
          <pubDate>Fri, 28 Mar 2026 08:00:00 GMT</pubDate>
          <description>Older story</description>
        </item>
        <item>
          <title>Newer entry</title>
          <link>https://example.com/newer</link>
          <pubDate>Sat, 29 Mar 2026 08:00:00 GMT</pubDate>
          <description>Newer story</description>
        </item>
      </channel>
    </rss>`;

  const items = service.parseFeedItems(xml, 2);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Newer entry');
  assert.equal(items[1].title, 'Older entry');
});

test('written low-signal filter rejects routine weather but keeps real emergency weather', () => {
  const { service } = loadWrittenNewsService();

  assert.equal(service.__test__.isLowSignalWrittenItem({
    title: 'Pleasant Weather Today, Turning Warm Through the Weekend',
    body: 'Routine temperature forecast for Amman.',
    sourceLabel: 'Jordan News',
  }), true);

  assert.equal(service.__test__.isLowSignalWrittenItem({
    title: 'Flood emergency closes roads after extreme weather',
    body: 'Officials order evacuations after a deadly flood damages infrastructure.',
    sourceLabel: 'Jordan News',
  }), false);

  assert.equal(service.__test__.isLowSignalWrittenItem({
    title: 'Top 10 AI tools after OpenAI launches Codex automation features',
    body: 'Official OpenAI release notes explain a useful coding agent and API workflow update.',
    sourceLabel: 'OpenAI',
  }), false);
});

test('ensureWrittenNewsCoverage isolates a malformed feed and still records good written coverage', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.WRITTEN_NEWS_FEEDS = 'https://good.example/rss,https://broken.example/rss';

  const { service, aiService } = loadWrittenNewsService();
  const db = createDb();
  const publishDate = new Date(Date.now() - (60 * 60 * 1000)).toISOString();

  aiService.analyzeContent = async (title, body) => ({
    summary: `${title}: ${body}`.slice(0, 220),
    scores: {
      rarity: 0.4,
      depth: 0.7,
      freshness: 0.8,
      timeless: 0.3,
      clickbait: 0.05,
    },
    topics: ['AI'],
  });
  aiService.generateEmbedding = async () => [];

  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl === 'https://good.example/rss') {
      return createResponse(`<?xml version="1.0"?>
        <rss>
          <channel>
            <title>BBC News - Technology</title>
            <item>
              <title>Latest useful AI tool</title>
              <link>https://good.example/articles/latest-tool</link>
              <pubDate>${publishDate}</pubDate>
              <description>Important release.</description>
              <media:thumbnail url="https://good.example/images/tool.jpg" />
            </item>
          </channel>
        </rss>`);
    }

    if (requestUrl.startsWith('https://news.google.com/rss/search?')) {
      return createResponse(`<?xml version="1.0"?>
        <rss>
          <channel>
            <title>Jordan source</title>
            <item>
              <title>Latest useful AI tool</title>
              <link>https://good.example/articles/latest-tool</link>
              <pubDate>${publishDate}</pubDate>
              <description>Important release.</description>
              <source url="https://jordantimes.com">Jordan Times</source>
            </item>
            <item>
              <title>Pleasant Weather Today, Turning Warm Through the Weekend</title>
              <link>https://jordannews.jo/weather</link>
              <pubDate>${publishDate}</pubDate>
              <description>Routine temperature forecast for Amman.</description>
              <source url="https://jordannews.jo">Jordan News</source>
            </item>
          </channel>
        </rss>`);
    }

    if (requestUrl === 'https://broken.example/rss') {
      return createResponse(`<?xml version="1.0"?>
        <rss>
          <channel>
            <title>Broken Feed</title>
          </channel>
        </rss>`);
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const result = await service.ensureWrittenNewsCoverage(db, { force: true });
    const coverage = service.getWrittenNewsCoverageState(db);

    assert.equal(result.refreshed, true);
    assert.equal(result.articleCount, 1);
    assert.ok(coverage.reachable_feed_count >= 1);
    assert.ok(coverage.failure_count >= 1);
    const brokenFeedFailure = coverage.failures.find((failure) => failure.feed === 'https://broken.example/rss');
    assert.ok(brokenFeedFailure);
    assert.match(brokenFeedFailure.reason, /no parseable items/i);
    assert.equal(coverage.article_count, 1);
    assert.equal(coverage.latest_article_at, publishDate);
    assert.equal(coverage.latest_article_is_stale, false);
  } finally {
    global.fetch = originalFetch;
    db.close();
    restoreEnv(originalEnv);
  }
});

test('coverage state exposes when the newest cached written article is stale', () => {
  const { service } = loadWrittenNewsService();
  const db = createDb();
  const stalePublishDate = new Date(Date.now() - (10 * 60 * 60 * 1000)).toISOString();

  try {
    db.prepare(`
      INSERT INTO content_items (
        id,
        source_id,
        external_id,
        title,
        url,
        publish_date,
        transcript,
        summary,
        embedding_json,
        rarity_score,
        depth_score,
        freshness_score,
        timeless_score,
        clickbait_score,
        trust_score,
        topic_tags_json,
        content_type,
        article_body,
        channel_type
      ) VALUES (
        'article-1',
        'source-1',
        'external-1',
        'Stale article',
        'https://example.com/stale',
        ?,
        'body',
        'summary',
        '[]',
        0.3,
        0.6,
        0.2,
        0.4,
        0.1,
        0.8,
        '[]',
        'article',
        'body',
        'written'
      )
    `).run(stalePublishDate);

    const coverage = service.getWrittenNewsCoverageState(db);

    assert.equal(coverage.article_count, 1);
    assert.equal(coverage.latest_article_at, stalePublishDate);
    assert.equal(coverage.latest_article_is_stale, true);
    assert.equal(typeof coverage.latest_article_age_hours, 'number');
    assert.match(coverage.message, /latest coverage may be lagging/i);
  } finally {
    db.close();
  }
});

test('written thumbnail helpers promote known low-resolution BBC and Google News images', () => {
  const { service } = loadWrittenNewsService();

  const bbcUrl = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/example.jpg';
  const googleUrl = 'https://lh3.googleusercontent.com/example=s0-w300';

  assert.equal(service.__test__.isLowResolutionThumbnailUrl(bbcUrl), true);
  assert.match(service.__test__.promoteWrittenThumbnailUrl(bbcUrl), /\/1600\//);
  assert.match(service.__test__.promoteWrittenThumbnailUrl(googleUrl), /w1600$/);
});

test('written thumbnail helpers prefer the sharper incoming thumbnail', () => {
  const { service } = loadWrittenNewsService();

  const lowRes = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/example.jpg';
  const hiRes = 'https://ichef.bbci.co.uk/ace/standard/1024/cpsprodpb/example.jpg';

  assert.equal(
    service.__test__.pickPreferredThumbnailUrl(lowRes, hiRes),
    service.__test__.promoteWrittenThumbnailUrl(hiRes),
  );
});

test('written refresh repairs an existing article that was previously stored as a video channel', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.WRITTEN_NEWS_FEEDS = 'https://repair.example/rss';

  const { service, aiService } = loadWrittenNewsService();
  const db = createDb();
  const crypto = require('node:crypto');
  const url = 'https://repair.example/articles/official-release';
  const externalId = `article_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
  const publishDate = new Date(Date.now() - (30 * 60 * 1000)).toISOString();

  db.prepare(`
    INSERT INTO content_items (
      id, source_id, external_id, title, url, publish_date, transcript, summary,
      embedding_json, rarity_score, depth_score, freshness_score, timeless_score,
      clickbait_score, trust_score, topic_tags_json, content_type, article_body, channel_type
    ) VALUES (
      'legacy-article', 'source_radar_legacy', ?, 'Legacy release', ?, ?, '', '', '[]',
      0.2, 0.2, 0.2, 0.2, 0.2, 0.2, '[]', 'article', '', 'socialVideo'
    )
  `).run(externalId, url, publishDate);

  aiService.analyzeContent = async () => null;
  aiService.generateEmbedding = async () => [];
  global.fetch = async () => createResponse(`<?xml version="1.0"?>
    <rss><channel><title>OpenAI</title><item>
      <title>Official release</title><link>${url}</link><pubDate>${publishDate}</pubDate>
      <description>Release details.</description>
    </item></channel></rss>`);

  try {
    await service.ensureWrittenNewsCoverage(db, { force: true });
    const row = db.prepare('SELECT source_id, content_type, channel_type FROM content_items WHERE external_id = ?').get(externalId);
    assert.equal(row.content_type, 'article');
    assert.equal(row.channel_type, 'written');
    assert.match(row.source_id, /^src_written_/);
  } finally {
    global.fetch = originalFetch;
    db.close();
    restoreEnv(originalEnv);
  }
});

test('configured sources retain the live Microsoft AI RSS endpoint', () => {
  const { service } = loadWrittenNewsService();
  const microsoft = service.getConfiguredFeedDefinitions()
    .find((definition) => definition.label === 'Microsoft AI blog RSS');

  assert.ok(microsoft);
  assert.equal(microsoft.url, 'https://blogs.microsoft.com/blog/tag/ai/feed/');
});
