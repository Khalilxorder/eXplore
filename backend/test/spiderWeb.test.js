'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');
const Fastify = require('fastify');

const llmProvider = require('../src/services/llmProvider');
const sitesRoutes = require('../src/routes/sites');
const siteMonitorService = require('../src/services/siteMonitorService');
const {
  cleanUrl,
  seedSpiderWebSites,
  shouldFilterUrl,
} = require('../scripts/seedSpiderWebSites');

function createDb(filename = ':memory:') {
  const db = new Database(filename);
  siteMonitorService.ensureTables(db);
  return db;
}

function getSite(db, siteId) {
  return db.prepare('SELECT * FROM monitored_sites WHERE id = ?').get(siteId);
}

test('Chrome history privacy filtering excludes conversation, auth, and session URLs', () => {
  assert.equal(shouldFilterUrl('https://mail.google.com/mail/u/0/'), true);
  assert.equal(shouldFilterUrl('http://localhost:3000/'), true);
  assert.equal(shouldFilterUrl('https://chatgpt.com/c/private-thread'), true);
  assert.equal(shouldFilterUrl('https://claude.ai/chat/private-thread'), true);
  assert.equal(shouldFilterUrl('https://perplexity.ai/search/private-query'), true);
  assert.equal(shouldFilterUrl('https://example.com/oauth/callback?code=secret'), true);
  assert.equal(shouldFilterUrl('https://news.example.com/release?access_token=secret'), true);
  assert.equal(shouldFilterUrl('https://news.example.com/release?session_id=private'), true);
  assert.equal(shouldFilterUrl('https://example.com/users/sign_in'), true);
  assert.equal(shouldFilterUrl('https://news.ycombinator.com/'), false);
  assert.equal(shouldFilterUrl('https://khalilsabha.tech/'), false);
  assert.equal(
    cleanUrl('https://khalilsabha.tech/?utm_source=feed&ref=newsletter&other=1#fragment'),
    'https://khalilsabha.tech/?other=1'
  );
});

test('manual add persists SPIDER NET flag while standard add remains standard', async () => {
  const db = createDb();
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'route-user' };
  });
  await app.register(sitesRoutes, { prefix: '/api/v1/sites', db });

  try {
    const standardResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      payload: { url: 'https://example.com/standard', label: 'Standard' },
    });
    const spiderResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      payload: { url: 'https://example.com/spider', label: 'Spider', is_spider_web: true },
    });

    assert.equal(standardResponse.statusCode, 200);
    assert.equal(spiderResponse.statusCode, 200);
    const standardPayload = standardResponse.json();
    const spiderPayload = spiderResponse.json();
    assert.equal(standardPayload.is_spider_web, 0);
    assert.equal(spiderPayload.is_spider_web, 1);
    assert.equal(getSite(db, standardPayload.id).is_spider_web, 0);
    assert.equal(getSite(db, spiderPayload.id).is_spider_web, 1);

    const invalidFlagResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sites',
      payload: { url: 'https://example.com/invalid', is_spider_web: 'true' },
    });
    assert.equal(invalidFlagResponse.statusCode, 400);
  } finally {
    await app.close();
    db.close();
  }
});

test('first scan stores a baseline without invoking analysis or creating a finding', async () => {
  const db = createDb();
  try {
    const siteId = siteMonitorService.addMonitoredSite(
      db,
      'baseline-user',
      'https://example.com/releases',
      'Releases',
      { isSpiderWeb: true }
    );
    let analysisCalls = 0;
    const result = await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<html><body>Version 1 is available.</body></html>',
      analyzeNovelty: async () => {
        analysisCalls += 1;
        throw new Error('analysis must not run for a baseline');
      },
    });

    const stored = getSite(db, siteId);
    assert.equal(result.baseline, true);
    assert.equal(result.changed, false);
    assert.equal(analysisCalls, 0);
    assert.match(stored.last_text, /Version 1 is available/);
    assert.equal(stored.last_hash.length, 64);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM site_findings').get().count, 0);
  } finally {
    db.close();
  }
});

test('monitored URL safety blocks local, private, metadata, and private DNS targets', async () => {
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('file:///etc/passwd'),
    /http or https/
  );
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('http://localhost:8080/'),
    /Blocked monitored URL target/
  );
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('http://169.254.169.254/latest/meta-data/'),
    /Blocked monitored URL target/
  );
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('http://[fd00::1]/'),
    /Blocked monitored URL target/
  );
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('https://public-name.example/releases', {
      lookup: async () => [{ address: '10.20.30.40', family: 4 }],
    }),
    /resolved to 10\.20\.30\.40/
  );
  await assert.rejects(
    siteMonitorService.assertSafeMonitoredUrl('https://slow-dns.example/releases', {
      lookup: async () => new Promise(() => {}),
      timeoutMs: 5,
    }),
    /DNS resolution timed out/
  );

  const safe = await siteMonitorService.assertSafeMonitoredUrl('https://public-name.example/releases', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(safe.addresses[0].address, '93.184.216.34');
  assert.equal(siteMonitorService.__test__.isAllowedContentType('text/html; charset=utf-8'), true);
  assert.equal(siteMonitorService.__test__.isAllowedContentType('application/json'), false);
});

test('only a valid important structured analysis above threshold creates a SPIDER NET finding', async () => {
  const db = createDb();
  try {
    const siteId = siteMonitorService.addMonitoredSite(
      db,
      'finding-user',
      'https://example.com/changelog',
      '[SPIDER NET] Example changelog',
      { isSpiderWeb: true }
    );
    await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<main>Version 1</main>',
    });

    const result = await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<main>Version 2 adds a major research model.</main>',
      analyzeNovelty: async () => ({
        noveltyScore: 0.9,
        importanceScore: 0.8,
        novelElements: ['Version 2 research model'],
        summaryOfNovelty: 'Version 2 introduces a major research model.',
        isImportant: true,
      }),
    });

    const finding = db.prepare('SELECT * FROM site_findings WHERE site_id = ?').get(siteId);
    assert.equal(result.changed, true);
    assert.ok(result.findingId);
    assert.equal(finding.is_spider_web_finding, 1);
    assert.ok(Math.abs(finding.fit_score - 0.85) < Number.EPSILON * 2);
    assert.equal(finding.title, 'SPIDER NET alert: Example changelog');
    assert.deepEqual(JSON.parse(finding.novel_elements), ['Version 2 research model']);
  } finally {
    db.close();
  }
});

test('mock, degraded, malformed, and below-threshold analyses do not create findings', async () => {
  const analysisToken = 'test-analysis-token';
  const mockResult = await siteMonitorService.checkSpiderWebNovelty(
    { url: 'https://example.com/blog', label: 'Blog' },
    'before',
    'after',
    {
      provider: 'test-provider',
      analysisToken,
      generateStructuredJson: async ({ schema, userPrompt }) => llmProvider.generateMockFromSchema(schema, userPrompt),
    }
  );
  assert.equal(mockResult, null);

  const degradedResult = await siteMonitorService.checkSpiderWebNovelty(
    { url: 'https://example.com/blog', label: 'Blog' },
    'before',
    'after',
    {
      provider: 'test-provider',
      analysisToken,
      generateStructuredJson: async () => ({
        analysisToken,
        noveltyScore: 0.9,
        importanceScore: 0.9,
        novelElements: ['Claimed change'],
        summaryOfNovelty: 'Claimed change.',
        isImportant: true,
        degraded: true,
      }),
    }
  );
  assert.equal(degradedResult, null);

  const validResult = await siteMonitorService.checkSpiderWebNovelty(
    { url: 'https://example.com/blog', label: 'Blog' },
    'before',
    'after',
    {
      provider: 'test-provider',
      analysisToken,
      generateStructuredJson: async () => ({
        analysisToken,
        noveltyScore: 0.75,
        importanceScore: 0.85,
        novelElements: ['Verified release'],
        summaryOfNovelty: 'A verified release was published.',
        isImportant: true,
      }),
    }
  );
  assert.equal(validResult.summaryOfNovelty, 'A verified release was published.');

  const db = createDb();
  try {
    const siteId = siteMonitorService.addMonitoredSite(
      db,
      'filtered-user',
      'https://example.com/updates',
      'Updates',
      { isSpiderWeb: true }
    );
    await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<p>Baseline</p>',
    });
    const unavailable = await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<p>Changed without live analysis</p>',
      analyzeNovelty: async () => null,
    });
    assert.equal(unavailable.filtered, true);
    assert.equal(unavailable.reason, 'analysis_unavailable');

    const belowThreshold = await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<p>Another low-value change</p>',
      analyzeNovelty: async () => ({
        noveltyScore: 0.2,
        importanceScore: 0.3,
        novelElements: ['Minor wording'],
        summaryOfNovelty: 'Minor wording changed.',
        isImportant: true,
      }),
    });
    assert.equal(belowThreshold.filtered, true);
    assert.equal(belowThreshold.reason, 'below_threshold');

    const lowImportance = await siteMonitorService.checkSite(db, getSite(db, siteId), {
      fetchPage: async () => '<p>Highly novel wording with low importance</p>',
      analyzeNovelty: async () => ({
        noveltyScore: 1,
        importanceScore: 0.4,
        novelElements: ['Novel but low-impact wording'],
        summaryOfNovelty: 'Novel wording has low practical importance.',
        isImportant: true,
      }),
    });
    assert.equal(lowImportance.filtered, true);
    assert.equal(lowImportance.reason, 'below_threshold');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM site_findings').get().count, 0);
  } finally {
    db.close();
  }
});

test('check-all can intentionally select standard or SPIDER NET sites and defaults to all', async () => {
  const db = createDb();
  try {
    const standardId = siteMonitorService.addMonitoredSite(db, 'scope-user', 'https://example.com/standard', 'Standard');
    const spiderId = siteMonitorService.addMonitoredSite(
      db,
      'scope-user',
      'https://example.com/spider',
      'Spider',
      { isSpiderWeb: true }
    );
    const run = (filter) => siteMonitorService.checkAll(db, 'scope-user', filter, {
      checkSite: async (_db, site) => ({ siteId: site.id }),
    });

    assert.deepEqual((await run('standard')).map((row) => row.siteId), [standardId]);
    assert.deepEqual((await run('spider')).map((row) => row.siteId), [spiderId]);
    assert.deepEqual((await run(1)).map((row) => row.siteId), [spiderId]);
    assert.deepEqual((await run(0)).map((row) => row.siteId), [standardId]);
    assert.deepEqual(new Set((await run()).map((row) => row.siteId)), new Set([standardId, spiderId]));
    await assert.rejects(run('unsupported'), /site_type must be/);
  } finally {
    db.close();
  }
});

test('Chrome-history seeding uses the requested database and never relabels another user row', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-spider-seed-'));
  const historyPath = path.join(tempDir, 'History');
  const dbPath = path.join(tempDir, 'explore.db');
  let historyDb;
  let setupDb;
  let verificationDb;

  try {
    historyDb = new Database(historyPath);
    historyDb.exec(`
      CREATE TABLE urls (
        url TEXT,
        title TEXT,
        visit_count INTEGER,
        typed_count INTEGER,
        last_visit_time INTEGER
      );
    `);
    const insertHistory = historyDb.prepare('INSERT INTO urls VALUES (?, ?, ?, ?, ?)');
    insertHistory.run('https://news.ycombinator.com/item?id=1&utm_source=history', 'Hacker News item', 20, 2, 30);
    insertHistory.run('https://example.com/blog/release', 'Example release', 15, 1, 20);
    insertHistory.run('https://chatgpt.com/c/private-conversation', 'Private conversation', 100, 5, 40);
    historyDb.close();
    historyDb = null;

    setupDb = createDb(dbPath);
    const guestId = siteMonitorService.addMonitoredSite(
      setupDb,
      'guest',
      'https://news.ycombinator.com/item?id=1',
      'Guest shared row'
    );
    const existingUserId = siteMonitorService.addMonitoredSite(
      setupDb,
      'alice',
      'https://example.com/blog/release',
      'Alice release'
    );
    setupDb.close();
    setupDb = null;

    const result = seedSpiderWebSites({
      userId: 'alice',
      dbPath,
      historyPath,
      logger: { log() {}, warn() {} },
    });
    assert.deepEqual(
      { selected: result.selected, inserted: result.inserted, updated: result.updated },
      { selected: 2, inserted: 1, updated: 1 }
    );

    verificationDb = createDb(dbPath);
    assert.equal(getSite(verificationDb, guestId).is_spider_web, 0);
    assert.equal(getSite(verificationDb, existingUserId).is_spider_web, 1);
    const aliceHackerNews = verificationDb.prepare(`
      SELECT * FROM monitored_sites WHERE user_id = 'alice' AND url = ?
    `).get('https://news.ycombinator.com/item?id=1');
    assert.equal(aliceHackerNews.is_spider_web, 1);
    assert.equal(
      verificationDb.prepare(`SELECT COUNT(*) AS count FROM monitored_sites WHERE url LIKE '%private-conversation%'`).get().count,
      0
    );
  } finally {
    if (historyDb) historyDb.close();
    if (setupDb) setupDb.close();
    if (verificationDb) verificationDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('seed route forwards authenticated user and configured DB path and returns only user data', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-spider-route-'));
  const dbPath = path.join(tempDir, 'configured.db');
  const db = createDb(dbPath);
  const app = Fastify({ logger: false });
  let receivedSeedOptions;

  siteMonitorService.addMonitoredSite(db, 'guest', 'https://example.com/guest-news', 'Guest news');
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'authenticated-user' };
  });
  await app.register(sitesRoutes, {
    prefix: '/api/v1/sites',
    db,
    databasePath: dbPath,
    seedRunner: async (options) => {
      receivedSeedOptions = options;
      siteMonitorService.addMonitoredSite(
        db,
        options.userId,
        'https://example.com/blog/authenticated',
        'Authenticated source',
        { isSpiderWeb: true }
      );
      return { log: 'seeded', result: { selected: 1, inserted: 1, updated: 0, skipped: 0 } };
    },
  });

  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/sites/seed-spider-web' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(receivedSeedOptions.userId, 'authenticated-user');
    assert.equal(receivedSeedOptions.dbPath, path.resolve(dbPath));
    assert.equal(payload.seed.selected, 1);
    assert.equal(payload.sites.length, 1);
    assert.equal(payload.sites[0].user_id, 'authenticated-user');
    assert.equal(getSite(db, db.prepare(`SELECT id FROM monitored_sites WHERE user_id = 'guest'`).get().id).is_spider_web, 0);
  } finally {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('seeder CLI exits nonzero when required input cannot be read', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-spider-cli-'));
  const scriptPath = path.join(__dirname, '..', 'scripts', 'seedSpiderWebSites.js');
  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--user-id', 'cli-user',
      '--db-path', path.join(tempDir, 'explore.db'),
      '--history-path', path.join(tempDir, 'missing-history'),
    ], { encoding: 'utf8', windowsHide: true });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Chrome History file not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
