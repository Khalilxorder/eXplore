'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Fastify = require('fastify');

const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const personalIntelligenceCycle = require('../src/services/personalIntelligenceCycle');
const intelligenceRoutes = require('../src/routes/intelligence');
const recommenderCore = require('../src/services/recommenderCore');

function createDb() {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  return db;
}

test('personal intelligence cycle bootstrap → rank → feedback → theory evidence', async () => {
  const db = createDb();
  const userId = 'guest';

  const first = await personalIntelligenceCycle.runPersonalIntelligenceCycle(db, userId, {
    runExternal: false,
    limit: 8,
  });

  assert.equal(first.success, true);
  assert.ok(first.bootstrap.content.total >= 3);
  assert.ok(first.ranking.itemCount >= 1);
  assert.ok(first.items[0].intelligenceExplanation.why_shown);
  assert.ok(first.items[0].intelligenceExplanation.why_trusted);
  assert.ok(Array.isArray(first.items[0].intelligenceExplanation.chips));
  assert.ok(first.loop.includes('ready_for_feedback'));

  const targetId = first.items[0].id;
  recommenderCore.saveFeedFeedback(db, userId, targetId, 9, 'more_like', '');
  const theoryUpdate = personalIntelligenceCycle.applyFeedbackToTheory(db, userId, {
    contentItemId: targetId,
    feedbackType: 'more_like',
    rating: 9,
  });
  assert.ok(theoryUpdate.evidenceId);

  const second = await personalIntelligenceCycle.runPersonalIntelligenceCycle(db, userId, {
    runExternal: false,
    limit: 8,
  });
  assert.equal(second.success, true);
  assert.ok(second.theory.evidenceCount >= 1);

  const status = personalIntelligenceCycle.getCycleStatus(db, userId);
  assert.equal(status.ready, true);
  assert.ok(status.contentCount >= 3);
  assert.ok(status.lastCycle);

  db.close();
});

test('POST /api/v1/intelligence/cycle/run exposes closed-loop items', async () => {
  const db = createDb();
  const app = Fastify({ logger: false });
  await app.register(intelligenceRoutes, { db });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/intelligence/cycle/run',
    payload: { runExternal: false, limit: 6 },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.success, true);
  assert.ok(body.items.length >= 1);
  assert.ok(body.items[0].intelligenceExplanation);
  assert.ok(body.clustering.clusterCount >= 0);

  const statusRes = await app.inject({ method: 'GET', url: '/api/v1/intelligence/cycle/status' });
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.json().ready, true);

  await app.close();
  db.close();
});
