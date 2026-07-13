'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const eventClusteringService = require('../src/services/eventClusteringService');

test('event clustering groups similar titles and extracts claim candidates', () => {
  const db = new Database(':memory:');
  eventClusteringService.ensureTables(db);

  const first = eventClusteringService.upsertItemIntoCluster(db, {
    id: 'a1',
    title: 'Jordan intercepts drones amid Iran regional escalation',
    summary: 'Official reports describe airspace activity near Jordan.',
    url: 'https://example.com/1',
    source: 'Reuters',
    publishedAt: new Date().toISOString(),
  });
  const second = eventClusteringService.upsertItemIntoCluster(db, {
    id: 'a2',
    title: 'Jordan airspace drones interception during Iran conflict',
    summary: 'Regional escalation continues with air defense reports.',
    url: 'https://example.com/2',
    source: 'AP',
    publishedAt: new Date().toISOString(),
  });
  const third = eventClusteringService.upsertItemIntoCluster(db, {
    id: 'b1',
    title: 'OpenAI releases a new frontier coding model',
    summary: 'Company newsroom announces public availability.',
    url: 'https://example.com/3',
    source: 'OpenAI',
    publishedAt: new Date().toISOString(),
  });

  assert.ok(first.id);
  assert.equal(first.id, second.id, 'similar Jordan stories should share one cluster');
  assert.notEqual(first.id, third.id, 'unrelated AI release should not merge');
  assert.ok(first.member_count >= 1);
  assert.ok(second.member_count >= 2);
  assert.ok(Array.isArray(first.claims));

  const listed = eventClusteringService.listClusters(db, { limit: 10 });
  assert.ok(listed.length >= 2);
  const jordanOnly = eventClusteringService.listClusters(db, { limit: 10, jordanOnly: true });
  assert.ok(jordanOnly.some((cluster) => cluster.id === first.id));
});
