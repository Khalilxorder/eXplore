'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const topicService = require('../src/services/topicService');
const aiService = require('../services/aiService');

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

test('topic connections accept public links, reject local links, and can be removed', () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  topicService.ensureTables(db);

  const topic = topicService.createTopic(db, 'user-1', {
    name: 'AI advantage',
    instruction: 'Track useful AI tools and official model releases.',
  });
  const source = topicService.addTopicSource(db, 'user-1', topic.id, {
    name: 'Hugging Face',
    url: 'https://huggingface.co/blog',
    role: 'specialist',
    approved: true,
  });

  assert.equal(source.status, 'approved');
  assert.equal(source.url, 'https://huggingface.co/blog');
  assert.throws(
    () => topicService.addTopicSource(db, 'user-1', topic.id, {
      name: 'Local service',
      url: 'http://127.0.0.1:8080/private',
    }),
    /Private or local source URLs/,
  );
  assert.equal(topicService.removeTopicSource(db, 'user-1', topic.id, source.id), true);
  assert.equal(topicService.getTopic(db, 'user-1', topic.id).suggested_sources.length, 0);

  db.close();
});

test('topic news is relevance-ranked and excludes items older than 72 hours', () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  topicService.ensureTables(db);

  const topic = topicService.createTopic(db, 'user-1', {
    name: 'Claude releases',
    instruction: 'Track official Anthropic Claude model and coding agent releases.',
  });
  const source = topicService.addTopicSource(db, 'user-1', topic.id, {
    name: 'Anthropic',
    url: 'https://www.anthropic.com/news',
    role: 'official',
    approved: true,
    trust_tier: 1,
  });

  const insert = db.prepare(`
    INSERT INTO content_items (
      id, source_id, external_id, title, url, publish_date, summary,
      topic_tags_json, content_type, trust_score, depth_score,
      life_impact, decision_usefulness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'written', ?, ?, ?, ?)
  `);
  insert.run(
    'fresh',
    source.id,
    'fresh',
    'Anthropic releases Claude coding agent upgrade',
    'https://www.anthropic.com/news/claude-agent',
    new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
    'Official Claude model and coding agent capabilities changed.',
    JSON.stringify(['Anthropic', 'Claude', 'AI']),
    1,
    0.8,
    0.9,
    1,
  );
  insert.run(
    'old',
    source.id,
    'old',
    'Old Anthropic Claude announcement',
    'https://www.anthropic.com/news/old',
    new Date(Date.now() - (80 * 60 * 60 * 1000)).toISOString(),
    'An old Claude release.',
    JSON.stringify(['Anthropic', 'Claude']),
    1,
    0.8,
    0.8,
    0.8,
  );

  const events = topicService.getTopicEvents(db, 'user-1', topic.id, { limit: 20 });
  assert.deepEqual(events.map((event) => event.id), ['fresh']);
  assert.equal(events[0].approved_source, true);
  assert.match(events[0].reason, /approved connection/);

  db.close();
});

test('AI source discovery is bounded, marks candidates for approval, and deep research is stored', async () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  topicService.ensureTables(db);

  const topic = topicService.createTopic(db, 'user-1', {
    name: 'Jordan excellence schools',
    instruction: 'Monitor the official application announcement for King Abdullah II Schools for Excellence.',
    locations: ['Jordan'],
  });

  const originalGenerate = aiService.generateStructuredJson;
  aiService.generateStructuredJson = async ({ userPrompt }) => {
    if (userPrompt.includes('Suggest valuable source connections')) {
      return {
        sources: [
          {
            name: 'Jordan Ministry of Education News',
            url: 'https://moe.gov.jo/ar/news',
            role: 'official',
            category: 'government',
            trust_tier: 1,
            reason: 'Primary announcement channel.',
          },
        ],
      };
    }
    return {
      summary: 'No indexed announcement is available yet.',
      important_changes: [],
      evidence_map: [],
      uncertainties: ['The application notice has not been indexed.'],
      actions: ['Keep the official ministry source monitored.'],
      next_questions: ['Has the 2026/2027 application page opened?'],
    };
  };

  try {
    const discovery = await topicService.discoverSourcesWithAi(db, 'user-1', topic.id, { limit: 6 });
    assert.equal(discovery.generated_count, 1);
    const candidate = topicService.getTopic(db, 'user-1', topic.id).suggested_sources
      .find((source) => source.url === 'https://moe.gov.jo/ar/news');
    assert.ok(candidate);
    assert.equal(candidate.status, 'suggested');
    assert.match(candidate.suggestion_reason, /Verify before approval/);

    topicService.setSourceApproval(db, 'user-1', topic.id, candidate.id, true);
    const run = await topicService.runDeepResearch(db, 'user-1', topic.id);
    assert.equal(run.status, 'complete');
    assert.match(run.result.summary, /No indexed announcement/);
    assert.equal(topicService.listResearchRuns(db, 'user-1', topic.id).length, 1);
  } finally {
    aiService.generateStructuredJson = originalGenerate;
    db.close();
  }
});
