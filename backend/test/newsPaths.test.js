const { test } = require('node:test');
const assert = require('node:assert/strict');
const { __test__ } = require('../src/services/templateRankingService');
const { computeRuleMatches } = __test__;

test('newsPaths - computeRuleMatches jordan keywords', () => {
  const jordanRule = {
    id: 'ar_jordan',
    title: 'Jordan updates',
    description: 'Which Jordan (jordan, amman, jordanian) updates are important?',
    weight: 74,
    keywords: ['jordan', 'amman', 'jordanian'],
    locked: false,
  };

  const matches = computeRuleMatches(
    'Important developments in Amman regarding the economic reforms.',
    ['economy', 'reforms'],
    [jordanRule]
  );

  assert.ok(matches.length > 0, 'Should match jordan related text');
  assert.equal(matches[0].id, 'ar_jordan');
  console.log('newsPaths test ok');
});
