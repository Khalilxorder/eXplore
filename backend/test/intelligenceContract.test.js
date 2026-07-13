'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const intelligenceContract = require('../src/services/intelligenceContract');

test('canonical intelligence explanations expose story, source, freshness, scores, action, and evidence', () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  intelligenceContract.ensureTables(db);
  db.prepare(`
    INSERT INTO users (id, email, name)
    VALUES ('guest', 'guest@example.com', 'Guest')
  `).run();

  db.prepare(`
    INSERT INTO content_items (id, external_id, title, url, summary, publish_date, topic_tags_json, content_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'content-1',
    'external-content-1',
    'OpenAI releases a research model for memory workflows',
    'https://example.com/research-model',
    'A research update about memory and learning workflows.',
    new Date().toISOString(),
    JSON.stringify(['AI', 'memory']),
    'article',
  );

  const explanation = intelligenceContract.buildExplanation({
    item: {
      id: 'content-1',
      title: 'OpenAI releases a research model for memory workflows',
      summary: 'A research update about memory and learning workflows.',
      url: 'https://example.com/research-model',
      topics: ['AI', 'memory'],
      sourceTrust: 0.9,
      scores: { freshness: 0.8, decisionUsefulness: 0.7 },
    },
    hierarchy: {
      lifeNarrative: 'Build useful AI tools for learning.',
      futureWish: 'Become a stronger AI researcher.',
      currentGoal: 'Study memory systems and AI research.',
    },
    workspaceMemory: { priorityTopics: ['AI', 'memory'] },
    goals: [{ goal_text: 'Study memory systems and AI research.' }],
    source: { id: 'source-1', name: 'OpenAI News', url: 'https://openai.com/news/', trust_tier: 1, role: 'official' },
    ranking: { freshness: 0.8, templateScore: 0.9 },
  });

  assert.equal(explanation.schema_version, '1.0');
  assert.match(explanation.why_shown, /Shown because/);
  assert.match(explanation.why_trusted, /Trusted|trust/i);
  assert.ok(Array.isArray(explanation.chips));
  assert.ok(explanation.chips.some((chip) => /Official|Trusted|Goal|Fresh|AI|memory/i.test(chip.label)));
  assert.ok(explanation.story_layer);
  assert.ok(Array.isArray(explanation.story_layers));
  assert.deepEqual(explanation.topics.map((topic) => topic.name), ['AI', 'memory']);
  assert.equal(explanation.source.name, 'OpenAI News');
  assert.equal(explanation.source.trust_score, 0.9);
  assert.equal(explanation.scores.actionability, 0.7);
  assert.equal(explanation.action.url, 'https://openai.com/news/');
  assert.deepEqual(explanation.evidence.source_ids, ['source-1']);

  const analysis = intelligenceContract.buildFinalEventAnalysis({
    item: {
      id: 'content-1',
      title: 'Jordan intercepts drones amid regional escalation near Iran conflict',
      summary: 'Official and regional reports describe airspace activity with possible Jordan impact.',
      publishedAt: new Date().toISOString(),
      url: 'https://example.com/jordan-update',
    },
    hierarchy: {
      currentGoal: 'Stay informed on risks affecting Jordan',
      lifeNarrative: 'Protect family and long-term stability.',
    },
    explanation,
    sources: [{ name: 'Reuters', url: 'https://reuters.com', relation: 'supporting' }],
  });
  assert.equal(analysis.schema_version, 'final-event-analysis-1.0');
  assert.ok(analysis.what_happened);
  assert.ok(analysis.jordan_relevance);
  assert.equal(analysis.jordan_relevance.material_to_jordan, true);
  assert.ok(['direct', 'indirect'].includes(analysis.jordan_relevance.effect_type));

  const theory = intelligenceContract.getUserTheory(db, 'guest');
  assert.equal(theory.user_id, 'guest');
  assert.equal(theory.status, 'active');
  assert.ok(theory.controls.can_reset);
  const paused = intelligenceContract.setUserTheoryStatus(db, 'guest', 'paused');
  assert.equal(paused.status, 'paused');
  const reset = intelligenceContract.resetUserTheory(db, 'guest');
  assert.equal(reset.status, 'active');
  const exported = intelligenceContract.exportUserTheory(db, 'guest');
  assert.equal(exported.schema_version, 'user-theory-export-1.0');
  assert.ok(exported.theory);

  const reasonId = intelligenceContract.persistExplanation(db, {
    userId: 'guest',
    contentId: 'content-1',
    explanation,
  });
  assert.ok(reasonId);
  assert.deepEqual(
    intelligenceContract.getPersistedExplanation(db, { userId: 'guest', recommendationId: 'content-1' }),
    explanation,
  );

  db.close();
});

test('invalid feedback scores do not leak NaN into the canonical explanation contract', () => {
  const explanation = intelligenceContract.buildExplanation({
    item: { title: 'Test item', scores: { freshness: Number.NaN } },
  });
  assert.equal(Number.isNaN(explanation.scores.freshness), false);
  assert.equal(Number.isNaN(explanation.confidence), false);
});
