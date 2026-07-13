const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const formulationService = require('../src/services/formulationService');
const experienceService = require('../src/services/experienceService');
const experimentService = require('../src/services/experimentService');
const sharedExperienceService = require('../src/services/sharedExperienceService');

test('formulationService - ensureTables and formulate fallback', async () => {
  const db = new Database(':memory:');
  formulationService.ensureTables(db);

  const res = await formulationService.formulate(db, 'test-user', 'My raw text expressing feelings of joy');
  assert.ok(res.goldenParagraph.includes('My raw text expressing feelings of joy'));
  assert.ok(res.themes.includes('My'));

  const items = formulationService.getFormulations(db, 'test-user');
  assert.equal(items.length, 1);
  assert.equal(items[0].inputText, 'My raw text expressing feelings of joy');
});

test('experienceService - CRUD', () => {
  const db = new Database(':memory:');
  experienceService.ensureTables(db);

  const entry = experienceService.createEntry(db, 'user-1', 'reflection', 'Deep thought of the day');
  assert.equal(entry.userId, 'user-1');
  assert.equal(entry.kind, 'reflection');
  assert.equal(entry.body, 'Deep thought of the day');

  const list = experienceService.getEntries(db, 'user-1');
  assert.equal(list.length, 1);
  assert.equal(list[0].body, 'Deep thought of the day');

  const updated = experienceService.updateEntry(db, 'user-1', entry.id, 'shared-experience-state', '{"saved":true}');
  assert.equal(updated.kind, 'shared-experience-state');
  assert.equal(updated.body, '{"saved":true}');

  const afterUpdate = experienceService.getEntries(db, 'user-1');
  assert.equal(afterUpdate[0].kind, 'shared-experience-state');
  assert.equal(afterUpdate[0].body, '{"saved":true}');

  const deleted = experienceService.deleteEntry(db, 'user-1', entry.id);
  assert.equal(deleted, true);

  const listAfter = experienceService.getEntries(db, 'user-1');
  assert.equal(listAfter.length, 0);
});

test('experienceService - symbolic song matching', () => {
  const result = experienceService.matchSong(
    'I waited until dusk to confess love, then realized she was leaving.',
    { phase: 'dusk', season: 'summer' },
    { labels: ['love', 'threshold'] }
  );

  assert.equal(result.match.id, 'tobu-dusk');
  assert.ok(result.match.score >= 0.3);
  assert.ok(result.alternatives.length > 0);
});

test('sharedExperienceService - workspace items, comments, and tasks', () => {
  const db = new Database(':memory:');
  sharedExperienceService.ensureTables(db);

  const item = sharedExperienceService.addItem(db, 'user-1', {
    kind: 'video',
    title: 'Leader that changed the world',
    url: 'https://youtube.com/watch?v=example',
    metadata: { category: 'leadership' },
  });

  assert.equal(item.title, 'Leader that changed the world');
  assert.equal(item.metadata.category, 'leadership');

  const comment = sharedExperienceService.interact(db, 'user-1', {
    type: 'comment',
    itemId: item.id,
    body: 'This connects to the Middle Eastern identity section.',
  });
  assert.equal(comment.success, true);
  assert.equal(comment.state.comments.length, 1);

  const task = sharedExperienceService.interact(db, 'user-1', {
    type: 'task',
    title: 'Send this section to my brother',
    done: true,
    priority: 'high',
  });
  assert.equal(task.success, true);
  assert.equal(task.state.tasks[0].done, true);
});

test('experimentService - CRUD', () => {
  const db = new Database(':memory:');
  experimentService.ensureTables(db);

  const exp = experimentService.createExperiment(db, 'user-2', 'If I sleep 8 hours, focus will increase', 'Track sleep using Oura');
  assert.equal(exp.userId, 'user-2');
  assert.equal(exp.hypothesis, 'If I sleep 8 hours, focus will increase');
  assert.equal(exp.action, 'Track sleep using Oura');
  assert.equal(exp.status, 'pending');

  const list = experimentService.getExperiments(db, 'user-2');
  assert.equal(list.length, 1);
  assert.equal(list[0].hypothesis, 'If I sleep 8 hours, focus will increase');

  const updated = experimentService.updateExperiment(db, 'user-2', exp.id, 'success', 'Felt much more focused');
  assert.equal(updated.status, 'success');
  assert.equal(updated.result, 'Felt much more focused');

  const listAfterUpdate = experimentService.getExperiments(db, 'user-2');
  assert.equal(listAfterUpdate[0].status, 'success');
  assert.equal(listAfterUpdate[0].result, 'Felt much more focused');

  const deleted = experimentService.deleteExperiment(db, 'user-2', exp.id);
  assert.equal(deleted, true);

  const listAfterDelete = experimentService.getExperiments(db, 'user-2');
  assert.equal(listAfterDelete.length, 0);
});
