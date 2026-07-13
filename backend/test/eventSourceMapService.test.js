'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');

const alertRoutes = require('../src/routes/alerts');
const {
  getEventSourceMap,
  getEventSourceMapSummary,
  getLaneSourceMap,
} = require('../src/services/eventSourceMapService');

test('event source map exposes the five event-only intelligence lanes', () => {
  const sourceMap = getEventSourceMap();

  assert.equal(sourceMap.scope, 'event_only_intelligence');
  assert.deepEqual(
    sourceMap.lanes.map((lane) => lane.id),
    ['war', 'ai_advantage', 'markets', 'art_meaning', 'personal_opportunities'],
  );
  assert.ok(sourceMap.lanes.every((lane) => lane.defaultWatchQuestions.length >= 4));
  assert.ok(sourceMap.lanes.every((lane) => lane.sources.length > 0));
});

test('AI Advantage lane has exactly 20 unique reusable sources', () => {
  const aiLane = getLaneSourceMap('AI Advantage');
  const sourceIds = aiLane.sources.map((source) => source.id);
  const uniqueSourceIds = new Set(sourceIds);

  assert.equal(aiLane.id, 'ai_advantage');
  assert.equal(aiLane.sources.length, 20);
  assert.equal(uniqueSourceIds.size, sourceIds.length);
  assert.ok(aiLane.sources.some((source) => source.id === 'openai-news' && source.feedUrl));
  assert.ok(aiLane.sources.some((source) => source.id === 'huggingface-models-api' && source.monitorType === 'api'));
});

test('event source map summary counts lanes and sources', () => {
  const summary = getEventSourceMapSummary();
  const aiSummary = summary.lanes.find((lane) => lane.id === 'ai_advantage');

  assert.equal(summary.laneCount, 5);
  assert.equal(summary.aiAdvantageSourceCount, 20);
  assert.equal(aiSummary.sourceCount, 20);
  assert.ok(summary.sourceCount > summary.aiAdvantageSourceCount);
});

test('alerts source-map route is public and supports lane lookup', async () => {
  const app = Fastify();
  await app.register(alertRoutes, { prefix: '/api/v1/alerts', db: null });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/source-map',
    });
    const laneResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/source-map/ai-advantage',
    });
    const missingResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/source-map/not-real',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().success, true);
    assert.equal(response.json().summary.aiAdvantageSourceCount, 20);

    assert.equal(laneResponse.statusCode, 200);
    assert.equal(laneResponse.json().lane.id, 'ai_advantage');
    assert.equal(laneResponse.json().lane.sources.length, 20);

    assert.equal(missingResponse.statusCode, 404);
  } finally {
    await app.close();
  }
});
