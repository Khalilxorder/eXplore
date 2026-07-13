'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const topicService = require('../src/services/topicService');

test('topic instructions persist as versioned source-approved monitoring configuration', () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  topicService.ensureTables(db);

  const topic = topicService.createTopic(db, 'user-1', {
    name: 'Jordan AI education',
    instruction: 'Track important AI education changes in Jordan and explain what matters for my study plans.',
    intended_outcome: 'Find credible updates and next actions.',
    locations: ['Jordan'],
    content_types: ['written', 'video'],
  });

  assert.equal(topic.owner_user_id, 'user-1');
  assert.match(topic.instruction, /AI education/);
  assert.deepEqual(topic.locations, ['Jordan']);
  assert.deepEqual(topic.content_types, ['written', 'video']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topic_instruction_versions WHERE topic_id = ?').get(topic.id).count, 1);

  const suggestions = topicService.suggestSources(db, 'user-1', topic.id);
  assert.ok(suggestions.some((source) => source.role === 'official'));
  assert.ok(suggestions.some((source) => source.role === 'independent_reporting'));

  const suggested = topicService.getTopic(db, 'user-1', topic.id).suggested_sources;
  assert.ok(suggested.length >= 2);
  const official = suggested.find((source) => source.role === 'official');
  assert.ok(official);

  topicService.setSourceApproval(db, 'user-1', topic.id, official.id, true, 'Approved for primary evidence.');
  const sourceWeb = topicService.getSourceWeb(db, 'user-1', topic.id);
  assert.equal(sourceWeb.coverage.approved, 1);
  assert.equal(sourceWeb.sources.find((source) => source.source_id === official.id).status, 'approved');
  assert.deepEqual(sourceWeb.coverage.missing_evidence, ['No approved source has a successful check yet.']);

  const updated = topicService.updateTopic(db, 'user-1', topic.id, {
    instruction: 'Track major AI education policy and research changes in Jordan.',
  });
  assert.match(updated.instruction, /policy and research/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM topic_instruction_versions WHERE topic_id = ?').get(topic.id).count, 2);
  assert.equal(topicService.getTopic(db, 'other-user', topic.id), null);

  db.close();
});
