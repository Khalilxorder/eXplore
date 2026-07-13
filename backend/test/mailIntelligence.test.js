const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyLifeDomain, classifyMessage } = require('../src/services/mailIntelligenceService');

test('classifyLifeDomain - money keywords', () => {
  assert.equal(classifyLifeDomain('Your invoice is due'), 'Money');
});

test('classifyLifeDomain - visa keywords', () => {
  assert.equal(classifyLifeDomain('Your visa application status'), 'Visa/Documents');
});

test('classifyMessage - deterministic fallback', async () => {
  // No DB needed for fallback test; pass null db and stub a message
  const msg = { sender: 'bank@test.com', subject: 'Invoice due', snippet: 'Payment required' };
  const result = await classifyMessage(null, msg);
  assert.ok(['Money', 'Work', 'Urgent'].includes(result.life_domain));
  assert.ok(['emergency', 'today', 'week', 'opportunity', 'archive', 'ignore'].includes(result.importance));
  console.log('Classify message test completed successfully!');
});
