const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const feedDiscoveryService = require('../src/services/feedDiscoveryService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE watched_source_packs (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL DEFAULT 'public',
      topic_key TEXT NOT NULL,
      topic TEXT NOT NULL,
      lane TEXT NOT NULL DEFAULT 'ai_advantage',
      priority TEXT NOT NULL DEFAULT 'watch',
      why TEXT,
      watch_questions_json TEXT NOT NULL DEFAULT '[]',
      generated_sources_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER DEFAULT 1,
      system_managed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scope_key, topic_key)
    );

    CREATE TABLE source_health_status (
      id TEXT PRIMARY KEY,
      scope_key TEXT,
      platform TEXT,
      lane TEXT,
      source_key TEXT,
      source_label TEXT,
      status TEXT,
      produced_items INTEGER,
      freshness_hours REAL,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_source_health_status_scope_key_platform_source_key_lane
      ON source_health_status(scope_key, platform, source_key, lane);

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      content_type TEXT,
      channel_type TEXT,
      publish_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test('Source Packs flow', async (t) => {
  const db = createTestDb();

  await t.test('AI discount topic generates AI Advantage pack, includes G2/Product Hunt/Futurepedia, dedupes sources, and persists by user', async () => {
    const userId = 'user_123';
    const topic = 'cheap AI tools that give me an edge';

    // Add watched source pack
    const pack = await feedDiscoveryService.addWatchedSourcePack(db, userId, {
      topic,
      priority: 'watch',
      why: 'Find cheap/free tools',
    });

    assert.ok(pack);
    assert.equal(pack.topic, topic);
    assert.equal(pack.lane, 'ai_advantage');
    assert.equal(pack.priority, 'watch');
    assert.equal(pack.why, 'Find cheap/free tools');
    assert.equal(pack.active, true);

    // Verify generated watch questions exist
    assert.ok(Array.isArray(pack.watch_questions));
    assert.ok(pack.watch_questions.length > 0);

    // Verify generated sources includes G2, Product Hunt, Futurepedia, etc.
    assert.ok(Array.isArray(pack.generated_sources));
    assert.ok(pack.generated_sources.length > 0);
    assert.ok(pack.spider_policy);
    assert.equal(pack.spider_policy.mode, 'reference_net');
    assert.equal(pack.spider_policy.event_triggered, true);
    assert.equal(pack.spider_policy.cadence_hours, 24);
    assert.ok(pack.spider_policy.trigger_words.includes('release'));
    assert.ok(Array.isArray(pack.interpretation_lenses));
    assert.ok(pack.interpretation_lenses.some((lens) => lens.label === 'Jung'));
    assert.ok(pack.interpretation_lenses.some((lens) => lens.label === 'Self'));
    assert.ok(Array.isArray(pack.gap_awareness));
    assert.ok(pack.gap_awareness.some((gap) => gap.id === 'digital-only'));
    assert.equal(pack.final_theory_feedback.rating, null);

    const labels = pack.generated_sources.map(s => s.label);
    assert.ok(labels.includes('G2 AI Software'));
    assert.ok(labels.includes('Product Hunt AI'));
    assert.ok(labels.includes('Futurepedia'));
    assert.ok(labels.includes("There's An AI For That"));

    // Check for source deduplication (no duplicate source IDs)
    const ids = pack.generated_sources.map(s => s.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size);

    // List packs for the user and make sure it is there
    const packsList = feedDiscoveryService.listWatchedSourcePacks(db, userId);
    assert.equal(packsList.length, 1);
    assert.equal(packsList[0].id, pack.id);

    const healthRows = db.prepare(`
      SELECT *
      FROM source_health_status
      WHERE scope_key = ? AND platform = 'source_pack'
      ORDER BY source_key ASC
    `).all(userId);
    assert.equal(healthRows.length, pack.generated_sources.length);
    assert.ok(healthRows.every((row) => row.status === 'stale'));
    assert.ok(healthRows.every((row) => row.produced_items === 0));
    assert.ok(healthRows.some((row) => row.source_label.includes('G2 AI Software')));

    const discoveryStatus = feedDiscoveryService.getDiscoveryStatus(db, userId);
    assert.equal(discoveryStatus.source_pack_count, 1);
    assert.equal(discoveryStatus.status, 'partial');
    assert.equal(discoveryStatus.pipeline_health.source_packs.status, 'stale');
    assert.equal(discoveryStatus.pipeline_health.source_packs.source_count, pack.generated_sources.length);
    assert.equal(discoveryStatus.pipeline_health.source_packs.candidate_count, 0);
    assert.ok(discoveryStatus.source_health.some((row) => row.platform === 'source_pack'));
    assert.ok(discoveryStatus.source_health.some((row) => {
      const metadata = JSON.parse(row.metadata_json || '{}');
      return metadata.spider_policy?.mode === 'reference_net' && Array.isArray(metadata.interpretation_lenses);
    }));

    // Verify user scoping: list for another user returns empty list
    const otherUserPacks = feedDiscoveryService.listWatchedSourcePacks(db, 'user_456');
    assert.equal(otherUserPacks.length, 0);
  });

  await t.test('Update disables/enables a source pack', () => {
    const userId = 'user_123';
    const packsList = feedDiscoveryService.listWatchedSourcePacks(db, userId);
    assert.equal(packsList.length, 1);
    const pack = packsList[0];

    // Disable the pack
    const updated = feedDiscoveryService.updateWatchedSourcePack(db, userId, pack.id, { active: false });
    assert.ok(updated);
    assert.equal(updated.active, false);

    // Retrieve again to verify persistence
    const reRetrievedList = feedDiscoveryService.listWatchedSourcePacks(db, userId);
    assert.equal(reRetrievedList.length, 1);
    assert.equal(reRetrievedList[0].active, false);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM source_health_status WHERE scope_key = ? AND platform = 'source_pack'`).get(userId).count,
      0
    );

    // Enable it back
    const reEnabled = feedDiscoveryService.updateWatchedSourcePack(db, userId, pack.id, { active: true });
    assert.ok(reEnabled);
    assert.equal(reEnabled.active, true);
    assert.ok(
      db.prepare(`SELECT COUNT(*) AS count FROM source_health_status WHERE scope_key = ? AND platform = 'source_pack'`).get(userId).count > 0
    );

    const rated = feedDiscoveryService.updateWatchedSourcePack(db, userId, pack.id, {
      priority: 'direct',
      final_theory_feedback: { rating: 9, note: 'This fits my direction.' },
    });
    assert.equal(rated.priority, 'direct');
    assert.equal(rated.spider_policy.cadence_hours, 1);
    assert.equal(rated.final_theory_feedback.rating, 9);
    assert.equal(rated.final_theory_feedback.note, 'This fits my direction.');
    assert.ok(rated.final_theory_feedback.updated_at);
  });

  db.close();
});
