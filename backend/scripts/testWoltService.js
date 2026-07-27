'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const {
  SUPPLY_STATES,
  getWoltConfig,
  saveWoltConfig,
  getLatestSnapshot,
  recordSnapshot,
  evaluateAndTriggerAlert,
} = require('../src/services/woltDemandService');

console.log('--- Running Wolt Demand Service Integration Verification ---');

const dbPath = path.join(__dirname, '..', 'explore.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
ensureSqliteIdealState(db);

const testUserId = 'test_wolt_user_123';

// 1. Verify Config Save & Retrieve
console.log('[1/4] Testing Wolt config save and retrieval...');
const savedConfig = saveWoltConfig(db, testUserId, {
  enabled: true,
  auth_token: 'Bearer test_token_xyz',
  city_id: 'test_city_helsinki',
  venue_id: 'test_venue_456',
  check_interval_minutes: 3,
  min_notify_level: 'EXPECT_SOON',
  notify_hotspots: true,
});

if (!savedConfig.enabled || savedConfig.auth_token !== 'Bearer test_token_xyz') {
  console.error('Config save failed:', savedConfig);
  process.exit(1);
}
console.log('Config save OK:', savedConfig.user_id, savedConfig.min_notify_level);

// 2. Verify Snapshot Recording
console.log('[2/4] Testing Snapshot recording...');
const dummySnapshot = {
  supplyState: 'SUPPLY_STATE_OFFERS_FLYING',
  demandLevelLabel: 'Offers Flying (High)',
  level: 3,
  badge: '🔥',
  hotspotsCount: 5,
  forecast: [{ hour: 14, state: 'SUPPLY_STATE_OFFERS_FLYING' }],
  rawResponse: { status: 'ok' },
  fetchedAt: new Date().toISOString(),
};

const snapshotId = recordSnapshot(db, testUserId, dummySnapshot);
const retrievedSnapshot = getLatestSnapshot(db, testUserId);

if (!retrievedSnapshot || retrievedSnapshot.supply_state !== 'SUPPLY_STATE_OFFERS_FLYING') {
  console.error('Snapshot retrieval failed:', retrievedSnapshot);
  process.exit(1);
}
console.log('Snapshot recording OK:', snapshotId, retrievedSnapshot.supply_state, 'Hotspots:', retrievedSnapshot.hotspots_count);

// 3. Verify Alert Transition Evaluation
console.log('[3/4] Testing Alert Transition Evaluation...');
const previousSlowerSnapshot = {
  supplyState: 'SUPPLY_STATE_SLOWER',
  demandLevelLabel: 'Slower (Low)',
  level: 1,
  hotspotsCount: 1,
};

const currentHighSnapshot = {
  supplyState: 'SUPPLY_STATE_OFFERS_FLYING',
  demandLevelLabel: 'Offers Flying (High)',
  level: 3,
  badge: '🔥',
  hotspotsCount: 5,
  fetchedAt: new Date().toISOString(),
};

const transitionInfo = evaluateAndTriggerAlert(db, testUserId, currentHighSnapshot, previousSlowerSnapshot, savedConfig);

if (!transitionInfo || !transitionInfo.alert) {
  console.error('Transition evaluation failed to trigger alert!');
  process.exit(1);
}
console.log('Alert Transition OK:', transitionInfo.transitionReason);

console.log('[4/4] Cleanup test records...');
db.prepare(`DELETE FROM wolt_monitor_configs WHERE user_id = ?`).run(testUserId);
db.prepare(`DELETE FROM wolt_demand_snapshots WHERE user_id = ?`).run(testUserId);

console.log('✅ ALL WOLT DEMAND SERVICE TESTS PASSED SUCCESSFULLY!');
