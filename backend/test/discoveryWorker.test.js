const test = require('node:test');
const assert = require('node:assert/strict');

const { __test__ } = require('../discoveryWorker');

test('discovery cycle is partial when configured sources are stale or failing', () => {
  const summary = __test__.summarizeDiscoveryResults([
    {
      status: 'live',
      candidateCount: 8,
      staleSourceCount: 4,
      errorSourceCount: 2,
    },
  ]);

  assert.equal(summary.status, 'partial');
  assert.equal(summary.candidateCount, 8);
  assert.equal(summary.staleSourceCount, 4);
  assert.equal(summary.errorSourceCount, 2);
  assert.match(summary.message, /4 configured source/);
});

test('discovery cycle is successful only when every configured source is live', () => {
  const summary = __test__.summarizeDiscoveryResults([
    {
      status: 'live',
      candidateCount: 5,
      staleSourceCount: 0,
      errorSourceCount: 0,
    },
  ]);

  assert.equal(summary.status, 'success');
  assert.equal(summary.message, '');
});
