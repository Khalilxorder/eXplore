const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const valueHierarchy = require('../src/services/valueHierarchySync');
const { __test__ } = require('../src/services/templateRankingService');
const { scoreRowAgainstTemplate } = __test__;

test('appMode - persistence and scoring effect', () => {
  const db = new Database(':memory:');
  valueHierarchy.ensureTables(db);

  // 1. Verify default mode
  const guestState = valueHierarchy.getState(db, 'guest');
  assert.equal(guestState.appMode, 'average', 'Default mode should be average');

  // 2. Verify updating to edge
  valueHierarchy.upsertState(db, 'guest', { appMode: 'edge' });
  const updatedState = valueHierarchy.getState(db, 'guest');
  assert.equal(updatedState.appMode, 'edge', 'Mode should be updated to edge');

  // 3. Verify scoring boost logic
  // We'll prepare a mock row, analysis, and templateState
  const row = {
    id: 'test-item-1',
    title: 'A breakthrough in scientific research and design vision',
    summary: 'A new model has been discovered.',
    content_type: 'article',
    channel_type: 'written',
    depth_score: 0.5,
    rarity_score: 0.5,
    clickbait_score: 0.1,
    freshness_score: 0.5,
    publish_date: new Date().toISOString(),
  };

  const analysis = {
    channelType: 'written',
    lifeImpact: 0.5,
    decisionUsefulness: 0.5,
    distractionRisk: 0.1,
    matchedConcepts: ['science', 'research'],
    visualMeaningLabel: 'Research',
    visualMeaningPrompt: 'Test',
    visualMeaningStatus: 'prompt_ready',
  };

  // Test with Average Mode
  const templateStateAverage = {
    hierarchy: {
      hasSignal: false,
      appMode: 'average',
    },
  };
  const resultAverage = scoreRowAgainstTemplate(row, analysis, templateStateAverage);

  // Test with Edge Mode (since text contains "scientific research and design vision", it should match the edgeRegex)
  const templateStateEdge = {
    hierarchy: {
      hasSignal: false,
      appMode: 'edge',
    },
  };
  const resultEdge = scoreRowAgainstTemplate(row, analysis, templateStateEdge);

  assert.ok(resultEdge.templateScore > resultAverage.templateScore, `Edge score (${resultEdge.templateScore}) should be boosted compared to average score (${resultAverage.templateScore})`);

  console.log('appMode unit tests passed successfully');
});
