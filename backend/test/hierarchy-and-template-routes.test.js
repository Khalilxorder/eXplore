const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const Database = require('better-sqlite3');

const aiService = require('../services/aiService');
const templateRoutes = require('../src/routes/template');
const templateService = require('../src/services/newsTemplateService');
const templateRankingService = require('../src/services/templateRankingService');
const valueHierarchy = require('../src/services/valueHierarchySync');

function recentIso(hoursAgo = 1) {
  return new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

function createFeedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      name TEXT,
      platform TEXT,
      url TEXT
    );

    CREATE TABLE content_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      external_id TEXT,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      publish_date DATETIME,
      duration_seconds INTEGER,
      transcript TEXT,
      summary TEXT,
      embedding_json TEXT,
      rarity_score REAL DEFAULT 0,
      depth_score REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      timeless_score REAL DEFAULT 0,
      clickbait_score REAL DEFAULT 0,
      topic_tags_json TEXT,
      content_type TEXT DEFAULT 'video',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  templateService.ensureTables(db);
  templateRankingService.ensureContentAnalysisColumns(db);
  valueHierarchy.ensureTables(db);
  return db;
}

function insertSource(db, id, name) {
  db.prepare(`
    INSERT INTO sources (id, name, platform, url)
    VALUES (?, ?, 'test', ?)
  `).run(id, name, `https://example.com/${id}`);
}

function insertAnalyzedItem(db, row) {
  db.prepare(`
    INSERT INTO content_items (
      id,
      source_id,
      external_id,
      title,
      url,
      publish_date,
      summary,
      topic_tags_json,
      content_type,
      rarity_score,
      depth_score,
      freshness_score,
      timeless_score,
      clickbait_score,
      channel_type,
      life_impact,
      decision_usefulness,
      distraction_risk,
      template_analysis_json,
      analysis_updated_at,
      visual_meaning_label,
      visual_meaning_prompt,
      visual_meaning_status,
      visual_meaning_image_url
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?
    )
  `).run(
    row.id,
    row.sourceId,
    row.externalId,
    row.title,
    row.url,
    row.publishDate,
    row.summary,
    JSON.stringify(row.topics || []),
    row.contentType,
    row.rarityScore,
    row.depthScore,
    row.freshnessScore,
    row.timelessScore,
    row.clickbaitScore,
    row.analysis.channelType,
    row.analysis.lifeImpact,
    row.analysis.decisionUsefulness,
    row.analysis.distractionRisk,
    JSON.stringify(row.analysis),
    row.analysis.visualMeaningLabel || '',
    row.analysis.visualMeaningPrompt || '',
    row.analysis.visualMeaningStatus || 'not_applicable',
    row.analysis.visualMeaningImageUrl || '',
  );
}

test('template routes scope template state to the current request user', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE content_items (
      id TEXT PRIMARY KEY
    );
  `);
  const app = Fastify();

  app.addHook('preHandler', async (request) => {
    const userId = request.headers['x-user-id'];
    request.user = userId ? { id: String(userId) } : null;
  });

  await app.register(templateRoutes, { prefix: '/api/v1/template', db });

  try {
    const alice = await app.inject({
      method: 'GET',
      url: '/api/v1/template',
      headers: { 'x-user-id': 'alice' },
    });
    const bob = await app.inject({
      method: 'GET',
      url: '/api/v1/template',
      headers: { 'x-user-id': 'bob' },
    });

    const alicePayload = alice.json();
    const bobPayload = bob.json();

    assert.equal(alice.statusCode, 200);
    assert.equal(bob.statusCode, 200);
    assert.equal(alicePayload.template.userId, 'alice');
    assert.equal(bobPayload.template.userId, 'bob');
    assert.notEqual(alicePayload.template.id, bobPayload.template.id);
    assert.equal(alicePayload.highPriorityProfile.enabled, true);
    assert.ok(alicePayload.interestBrain.highPriorityProfile.summary.length > 0);
  } finally {
    await app.close();
    db.close();
  }
});

test('value hierarchy persists user-specific goal and extracted core values', async () => {
  const db = new Database(':memory:');
  const original = aiService.generateStructuredJson;

  aiService.generateStructuredJson = async () => ({
    coreValues: ['AI systems', 'Industrial strategy', 'Human psychology'],
  });

  try {
    valueHierarchy.ensureTables(db);
    const goalState = valueHierarchy.updateUserGoal(
      db,
      'alice',
      'Build deep technical leverage in AI and industrial systems.',
    );

    const syncedState = await valueHierarchy.syncDigitalFootprint(db, 'alice', [
      { title: 'AI supply chains', playCount: 40 },
      { title: 'Industrial policy explainers', playCount: 28 },
      { title: 'Human psychology lectures', playCount: 26 },
    ]);

    const reloaded = valueHierarchy.getState(db, 'alice');
    const otherUser = valueHierarchy.getState(db, 'bob');
    const alignment = valueHierarchy.computeHierarchyAlignment(
      reloaded,
      'New AI supply chain rules are changing industrial strategy.',
    );

    assert.equal(goalState.currentGoal, 'Build deep technical leverage in AI and industrial systems.');
    assert.deepEqual(syncedState.coreValues, ['AI systems', 'Industrial strategy', 'Human psychology']);
    assert.deepEqual(reloaded.coreValues, ['AI systems', 'Industrial strategy', 'Human psychology']);
    assert.equal(otherUser.currentGoal, '');
    assert.deepEqual(otherUser.coreValues, []);
    assert.ok(alignment > 0);
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('value hierarchy imports YouTube watch and liked history with stronger liked weight', () => {
  const jsonHistory = JSON.stringify([
    { title: 'Watched Claude coding agents deep dive' },
    { title: 'Liked Claude coding agents deep dive' },
    { title: 'Watched Jung symbolism lecture' },
  ]);
  const htmlHistory = `
    Liked <a href="https://www.youtube.com/watch?v=abc12345678">AI tools that change work</a>
    Watched <a href="https://www.youtube.com/watch?v=def12345678">AI tools that change work</a>
  `;

  const jsonEntries = valueHierarchy.importDigitalFootprint(jsonHistory, { source: 'youtube-json' });
  const htmlEntries = valueHierarchy.importDigitalFootprint(htmlHistory, { source: 'youtube-html' });

  const claude = jsonEntries.find((entry) => entry.title === 'Claude coding agents deep dive');
  const aiTools = htmlEntries.find((entry) => entry.title === 'AI tools that change work');

  assert.ok(claude);
  assert.equal(claude.playCount, 4);
  assert.ok(aiTools);
  assert.equal(aiTools.playCount, 4);
});

test('value hierarchy sync keeps imported YouTube signals as hierarchy hints', async () => {
  const db = new Database(':memory:');
  const original = aiService.generateStructuredJson;

  aiService.generateStructuredJson = async () => {
    throw new Error('Use deterministic footprint fallback');
  };

  try {
    valueHierarchy.ensureTables(db);
    const imported = valueHierarchy.importDigitalFootprint(JSON.stringify([
      { title: 'Liked Cheap AI tools for coding advantage' },
      { title: 'Watched Cheap AI tools for coding advantage' },
    ]), { source: 'youtube-json' });
    const state = await valueHierarchy.syncDigitalFootprint(db, 'alice', imported);

    assert.ok(state.historyHints.includes('Cheap AI tools for coding advantage'));
    assert.ok(state.coreValues.length > 0);
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('value hierarchy summarizes story-layer alignment without calling AI', async () => {
  const db = new Database(':memory:');
  const original = aiService.generateStructuredJson;
  let aiCallCount = 0;

  aiService.generateStructuredJson = async () => {
    aiCallCount += 1;
    throw new Error('AI should not be called for story-layer summaries');
  };

  try {
    valueHierarchy.ensureTables(db);
    const state = valueHierarchy.updateStories(db, 'alice', {
      storyHighestOrder: 'Biblical responsibility, shared humanity, sacrifice, and meaning.',
      storyYours: 'Build a future in AI psychology research and creative tools in Budapest.',
      storySubStories: 'Apply to scholarships and remote research internships this month.',
    });

    const storySummary = valueHierarchy.summarizeStoryLayerAlignment(state, {
      title: 'Budapest AI psychology research assistant role',
      summary: 'A creative tools lab is hiring for applied psychology and human-centered AI research.',
      tags: ['AI', 'psychology', 'research', 'creative tools'],
      source: 'University lab',
    });

    assert.equal(aiCallCount, 0);
    assert.equal(storySummary.hasContentSignal, true);
    assert.equal(storySummary.hasHierarchySignal, true);
    assert.equal(storySummary.layers.length, 3);
    assert.equal(storySummary.bestLayer.id, 'future_wish');
    assert.equal(storySummary.selectedLayerId, 'future_wish');
    assert.ok(storySummary.alignmentScore > 0);
    assert.ok(storySummary.layers.find((layer) => layer.id === 'future_wish').matchedTerms.includes('psychology'));
    assert.ok(storySummary.layers.find((layer) => layer.id === 'current_goals').score > 0);
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('hierarchy route returns structured story alignment for opportunity items', async () => {
  const db = new Database(':memory:');
  const original = aiService.generateStructuredJson;
  let aiCallCount = 0;

  aiService.generateStructuredJson = async () => {
    aiCallCount += 1;
    throw new Error('AI should not be called for story alignment route');
  };

  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.user = { id: 'alice' };
  });

  const hierarchyRoutes = require('../src/routes/hierarchy');
  await app.register(hierarchyRoutes, { prefix: '/api/v1/hierarchy', db });

  try {
    const storiesResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/hierarchy/stories',
      payload: {
        storyHighestOrder: 'Shared humanity, responsibility, and religious meaning.',
        storyYours: 'Develop a future around cognitive science and AI tools.',
        storySubStories: 'Apply now to scholarships, remote research internships, and funded labs.',
      },
    });
    const alignmentResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/hierarchy/story-alignment',
      payload: {
        opportunity: {
          title: 'Remote research internship scholarship',
          description: 'Funded lab opening for students who can apply now to AI research internships.',
          category: 'scholarship',
          deadline: '2026-06-30',
          fitReason: 'Matches funded lab and current application goals.',
        },
      },
    });
    const emptyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/hierarchy/story-alignment',
      payload: {},
    });

    const body = alignmentResponse.json();

    assert.equal(storiesResponse.statusCode, 200);
    assert.equal(alignmentResponse.statusCode, 200);
    assert.equal(emptyResponse.statusCode, 400);
    assert.equal(body.success, true);
    assert.equal(body.storySummary.bestLayer.id, 'current_goals');
    assert.equal(body.storySummary.selectedLayerId, 'current_goals');
    assert.equal(body.storySummary.layers.length, 3);
    assert.ok(body.storySummary.rankedLayers[0].score >= body.storySummary.rankedLayers[1].score);
    assert.ok(body.storySummary.bestLayer.matchedTerms.includes('scholarship'));
    assert.equal(aiCallCount, 0);
  } finally {
    aiService.generateStructuredJson = original;
    await app.close();
    db.close();
  }
});

test('refining a template over HTTP changes that same user feed without affecting another user', async () => {
  const db = createFeedDb();
  const app = Fastify();
  const originalStructuredJson = aiService.generateStructuredJson;
  const originalFetch = global.fetch;

  aiService.generateStructuredJson = async () => ({
    needsClarification: false,
    confidence: 0.93,
    templateName: 'Template',
    changeSummary: 'Elevated AI procurement and audit signals.',
    objective: 'Filter for high-impact news that changes real decisions.',
    higherOrderRule: 'Track sharp signal and strip away noise.',
    candidateRules: [
      {
        title: 'AI procurement',
        description: 'Prefer procurement, audits, compliance, and public-sector AI rollout changes.',
        weight: 95,
        keywords: ['procurement', 'audits', 'compliance', 'contracts'],
      },
    ],
    sourceMix: { written: 72, socialVideo: 18, socialPhoto: 10 },
    visualSummary: {
      enabled: true,
      label: 'Meaning Sketch',
      iconNameStyle: '3-5 words',
      prompt: 'Meaning only.',
    },
  });
  global.fetch = async () => ({ ok: false, text: async () => '' });

  insertSource(db, 'written-source', 'Written Source');
  insertAnalyzedItem(db, {
    id: 'article-procurement',
    sourceId: 'written-source',
    externalId: 'article-procurement',
    title: 'Government AI procurement audits become mandatory for public contracts',
    url: 'https://example.com/article-procurement',
    publishDate: recentIso(12),
    summary: 'Procurement audits and compliance rules are now shaping which AI vendors can win contracts.',
    topics: ['AI', 'Policy'],
    contentType: 'article',
    rarityScore: 0.32,
    depthScore: 0.74,
    freshnessScore: 0.62,
    timelessScore: 0.42,
    clickbaitScore: 0.03,
    analysis: {
      channelType: 'written',
      lifeImpact: 0.82,
      decisionUsefulness: 0.84,
      distractionRisk: 0.11,
      matchedConcepts: ['procurement', 'audits', 'compliance', 'contracts'],
      visualMeaningLabel: 'AI contract audits',
      visualMeaningPrompt: 'Meaning only.',
      visualMeaningStatus: 'prompt_ready',
      visualMeaningImageUrl: '',
    },
  });
  insertAnalyzedItem(db, {
    id: 'article-energy',
    sourceId: 'written-source',
    externalId: 'article-energy',
    title: 'Battery storage factories speed up after new energy demand rebound',
    url: 'https://example.com/article-energy',
    publishDate: recentIso(10),
    summary: 'Battery supply and storage factories are moving faster after another demand spike.',
    topics: ['Energy', 'Industry'],
    contentType: 'article',
    rarityScore: 0.32,
    depthScore: 0.74,
    freshnessScore: 0.9,
    timelessScore: 0.42,
    clickbaitScore: 0.03,
    analysis: {
      channelType: 'written',
      lifeImpact: 0.81,
      decisionUsefulness: 0.82,
      distractionRisk: 0.12,
      matchedConcepts: ['battery', 'storage', 'factories', 'energy'],
      visualMeaningLabel: 'Battery factory rebound',
      visualMeaningPrompt: 'Meaning only.',
      visualMeaningStatus: 'prompt_ready',
      visualMeaningImageUrl: '',
    },
  });

  app.addHook('preHandler', async (request) => {
    const userId = request.headers['x-user-id'];
    request.user = userId ? { id: String(userId) } : null;
  });

  await app.register(templateRoutes, { prefix: '/api/v1/template', db });

  app.get('/api/v1/feed', async (request) => {
    const userId = request.user?.id || 'guest';
    const templateState = {
      ...templateService.getTemplateState(db, userId),
      hierarchy: valueHierarchy.getState(db, userId),
    };

    return templateRankingService.buildTemplateDrivenFeed(db, templateState, {
      scanLimit: 20,
      syncAnalysisLimit: 0,
      limitPerSection: 6,
    });
  });

  try {
    const refineResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/template/refine',
      headers: { 'x-user-id': 'alice' },
      payload: {
        note: 'Push hard toward AI procurement audits, compliance shifts, and public-sector contract changes.',
      },
    });

    const aliceFeedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/feed',
      headers: { 'x-user-id': 'alice' },
    });
    const bobFeedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/feed',
      headers: { 'x-user-id': 'bob' },
    });

    const aliceWritten = aliceFeedResponse.json().sections.find((section) => section.id === 'written-news');
    const bobWritten = bobFeedResponse.json().sections.find((section) => section.id === 'written-news');

    assert.equal(refineResponse.statusCode, 200);
    assert.equal(aliceFeedResponse.statusCode, 200);
    assert.equal(bobFeedResponse.statusCode, 200);
    assert.equal(aliceWritten.items[0].id, 'article-procurement');
    assert.equal(aliceWritten.items[0].matchedRules[0].title, 'AI procurement');
    assert.equal(bobWritten.items[0].id, 'article-energy');
  } finally {
    aiService.generateStructuredJson = originalStructuredJson;
    global.fetch = originalFetch;
    await app.close();
    db.close();
  }
});

test('value hierarchy analyzeSelfData and HTTP endpoint analyze and persist psychometric profile', async () => {
  const db = new Database(':memory:');
  const originalStructuredJson = aiService.generateStructuredJson;

  const mockProfile = {
    personality: {
      openness: 88,
      conscientiousness: 92,
      extraversion: 65,
      agreeableness: 78,
      neuroticism: 25,
      description: "Exceptionally curious and goal-oriented."
    },
    narrative: {
      agency: 85,
      communion: 75,
      redemption: 95,
      contamination: 5,
      description: "High agency and high resilience."
    },
    cognitive: {
      needForCognition: 90,
      processingDepth: 95,
      lateralExploration: 80,
      cognitiveLoad: 35,
      description: "Exhaustive processing depth and high curiosity."
    }
  };

  aiService.generateStructuredJson = async () => mockProfile;

  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.user = { id: 'alice' };
  });

  const hierarchyRoutes = require('../src/routes/hierarchy');
  await app.register(hierarchyRoutes, { prefix: '/api/v1/hierarchy', db });

  try {
    // 1. Test direct service function
    const updatedState = await valueHierarchy.analyzeSelfData(
      db,
      'alice',
      'This is raw test assessment results.'
    );

    assert.equal(updatedState.selfRawData, 'This is raw test assessment results.');
    assert.deepEqual(updatedState.scientificProfile, mockProfile);

    // Reload from db
    const reloaded = valueHierarchy.getState(db, 'alice');
    assert.deepEqual(reloaded.scientificProfile, mockProfile);

    // 2. Test HTTP API endpoint
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/hierarchy/self-data',
      payload: {
        rawText: 'Alternative pasted results text'
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.hierarchy.selfRawData, 'Alternative pasted results text');
    assert.deepEqual(body.hierarchy.scientificProfile, mockProfile);
  } finally {
    aiService.generateStructuredJson = originalStructuredJson;
    await app.close();
    db.close();
  }
});

test('value hierarchy generateLabsResearch and HTTP endpoint generate custom research portfolio', async () => {
  const db = new Database(':memory:');
  const originalStructuredJson = aiService.generateStructuredJson;

  const mockLabs = {
    hungary: [
      {
        id: "hun-lab-1",
        name: "HUN-REN Institute of Cognitive Neuroscience",
        institution: "Hungarian Research Network",
        location: "Budapest, Hungary",
        director: "Dr. Zoltán Vidnyánszky",
        relevance: "Matches cognitive state modeling.",
        papers: [
          {
            title: "Predictive coding in cognitive strain",
            year: "2024",
            journal: "NeuroImage",
            summary: "Details predictive visual signals.",
            connectionToGoals: "Connects to your custom feed prioritization."
          }
        ]
      }
    ],
    usa: [
      {
        id: "usa-lab-1",
        name: "McGovern Institute",
        institution: "MIT",
        location: "Cambridge, MA, USA",
        director: "Dr. Robert Desimone",
        relevance: "High-resolution cognitive modeling.",
        studies: [
          {
            title: "Selective attention gates",
            leadDoctor: "Dr. Robert Desimone",
            summary: "Details prefrontal cortical signals."
          }
        ]
      }
    ]
  };

  aiService.generateStructuredJson = async () => mockLabs;

  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.user = { id: 'alice' };
  });

  const opportunitiesRoutes = require('../src/routes/opportunities');
  await app.register(opportunitiesRoutes, { prefix: '/api/v1/opportunities', db });

  try {
    // 1. Test direct service function
    const updatedState = await valueHierarchy.generateLabsResearch(db, 'alice');

    assert.deepEqual(updatedState.labsResearch, mockLabs);

    // Reload from db
    const reloaded = valueHierarchy.getState(db, 'alice');
    assert.deepEqual(reloaded.labsResearch, mockLabs);

    // 2. Test HTTP API endpoint
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/opportunities/labs/generate',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.labsResearch, mockLabs);
  } finally {
    aiService.generateStructuredJson = originalStructuredJson;
    await app.close();
    db.close();
  }
});
