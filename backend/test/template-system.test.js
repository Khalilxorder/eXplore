const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const aiService = require('../services/aiService');
const templateService = require('../src/services/newsTemplateService');
const templateRankingService = require('../src/services/templateRankingService');

function recentIso(hoursAgo = 1) {
  return new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

function createTemplateDb() {
  const db = new Database(':memory:');
  templateService.ensureTables(db);
  return db;
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
  templateRankingService.ensureContentAnalysisColumns(db);
  return db;
}

function insertSource(db, id, name) {
  db.prepare(`
    INSERT INTO sources (id, name, platform, url)
    VALUES (?, ?, 'test', ?)
  `).run(id, name, `https://example.com/${id}`);
}

function insertItem(db, row) {
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
    row.source_id,
    row.external_id,
    row.title,
    row.url,
    row.publish_date,
    row.summary,
    JSON.stringify(row.topics || []),
    row.content_type,
    row.rarity_score,
    row.depth_score,
    row.freshness_score,
    row.timeless_score,
    row.clickbait_score,
    row.channel_type,
    row.analysis.lifeImpact,
    row.analysis.decisionUsefulness,
    row.analysis.distractionRisk,
    JSON.stringify({
      channelType: row.analysis.channelType,
      lifeImpact: row.analysis.lifeImpact,
      decisionUsefulness: row.analysis.decisionUsefulness,
      distractionRisk: row.analysis.distractionRisk,
      matchedConcepts: row.analysis.matchedConcepts,
      visualMeaningLabel: row.analysis.visualMeaningLabel,
      visualMeaningPrompt: row.analysis.visualMeaningPrompt,
      visualMeaningStatus: row.analysis.visualMeaningStatus,
      visualMeaningImageUrl: row.analysis.visualMeaningImageUrl,
    }),
    row.analysis.visualMeaningLabel,
    row.analysis.visualMeaningPrompt,
    row.analysis.visualMeaningStatus,
    row.analysis.visualMeaningImageUrl || null,
  );
}

test('ambiguous note creates a clarification without creating a new version', async () => {
  const db = createTemplateDb();
  const original = aiService.generateStructuredJson;
  aiService.generateStructuredJson = async () => ({
    needsClarification: true,
    confidence: 0.21,
    clarificationQuestion: 'Which should dominate: long-term policy shifts or immediate tactical opportunities?',
  });

  try {
    const before = templateService.getTemplateState(db);
    const after = await templateService.refineTemplate(db, 'I want better news');

    assert.equal(after.refinement.status, 'needs_clarification');
    assert.equal(after.versions.length, before.versions.length);
    assert.equal(after.pendingClarification.question, 'Which should dominate: long-term policy shifts or immediate tactical opportunities?');
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('fixed rules remain immutable across refine and restore', async () => {
  const db = createTemplateDb();
  const original = aiService.generateStructuredJson;
  const responses = [
    {
      needsClarification: false,
      confidence: 0.91,
      templateName: 'Template',
      changeSummary: 'Shifted harder toward AI procurement and regulation.',
      objective: 'Prioritize decision-changing developments.',
      higherOrderRule: 'Track the sharpest signal and discard vanity.',
      candidateRules: [{ title: 'AI procurement', description: 'Focus on AI procurement, audits, and regulated adoption.', weight: 88, keywords: ['procurement', 'audit', 'regulated'] }],
      sourceMix: { written: 64, socialVideo: 24, socialPhoto: 12 },
      visualSummary: { enabled: true, label: 'Meaning Sketch', iconNameStyle: '3-5 words', prompt: 'Meaning only.' },
    },
    {
      needsClarification: false,
      confidence: 0.9,
      templateName: 'Template',
      changeSummary: 'Shifted toward industrial supply constraints.',
      objective: 'Prioritize decision-changing developments.',
      higherOrderRule: 'Track the sharpest signal and discard vanity.',
      candidateRules: [{ title: 'Industrial bottlenecks', description: 'Watch energy, logistics, and industrial bottlenecks.', weight: 86, keywords: ['energy', 'logistics', 'industrial'] }],
      sourceMix: { written: 60, socialVideo: 26, socialPhoto: 14 },
      visualSummary: { enabled: true, label: 'Meaning Sketch', iconNameStyle: '3-5 words', prompt: 'Meaning only.' },
    },
  ];
  aiService.generateStructuredJson = async () => responses.shift();

  try {
    const initial = templateService.getTemplateState(db);
    const fixedRulesBefore = JSON.parse(JSON.stringify(initial.fixedRules));

    const v2 = await templateService.refineTemplate(db, 'Care more about AI procurement and audits.');
    const v3 = await templateService.refineTemplate(db, 'Also watch industrial bottlenecks.');
    const restored = templateService.restoreVersion(db, v2.activeVersion.id);

    assert.deepEqual(v2.fixedRules, fixedRulesBefore);
    assert.deepEqual(v3.fixedRules, fixedRulesBefore);
    assert.deepEqual(restored.fixedRules, fixedRulesBefore);
    assert.equal(restored.activeVersion.id, v2.activeVersion.id);
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('similar notes merge into an existing adaptive rule instead of duplicating it', async () => {
  const existingRules = templateService.__test__.dedupeAdaptiveRules([
    {
      id: 'ar_decision_leverage',
      title: 'Decision leverage',
      description: 'Prefer developments that change what I should do next, not just what is interesting to know.',
      weight: 86,
      keywords: ['decision', 'action', 'leverage', 'change'],
      locked: false,
    },
  ]);

  const merged = await templateService.__test__.mergeAdaptiveRules(existingRules, [
    {
      title: 'Decision leverage',
      description: 'Focus harder on news that changes what I should do next.',
      weight: 80,
      keywords: ['decision', 'next step'],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.match(merged[0].description, /changes what I should do next/i);
  assert.ok(merged[0].weight >= 86);
});

test('workspace memory is versioned and restored with saved template snapshots', async () => {
  const db = createTemplateDb();

  try {
    const first = await templateService.saveWorkspaceDocuments(db, 'user_1', {
      watchQuestions: ['Which Anthropic releases change what I can use right now?'],
      briefingStyle: ['Use short direct titles.'],
      workspaceMemory: {
        priorityTopics: ['AI releases', 'Claude features'],
        avoidTopics: ['Hype'],
        trackedCompanies: ['anthropic'],
        sourcePreferences: {
          officialFirst: true,
          written: true,
          socialVideo: false,
          socialPhoto: false,
          trustedSourcesOnly: true,
        },
        alertStyle: 'strict',
      },
    });

    const second = await templateService.saveWorkspaceDocuments(db, 'user_1', {
      watchQuestions: ['Which OpenAI launches change what I can use right now?'],
      briefingStyle: ['Lead with the takeaway first.'],
      workspaceMemory: {
        priorityTopics: ['OpenAI launches'],
        avoidTopics: ['Repeated context'],
        trackedCompanies: ['openai'],
        sourcePreferences: {
          officialFirst: true,
          written: true,
          socialVideo: true,
          socialPhoto: false,
          trustedSourcesOnly: true,
        },
        alertStyle: 'balanced',
      },
    });

    const restored = templateService.restoreVersion(db, first.activeVersion.id, 'user_1');

    assert.deepEqual(second.workspace.workspaceMemory.trackedCompanies, ['openai']);
    assert.deepEqual(restored.workspace.workspaceMemory.trackedCompanies, ['anthropic']);
    assert.deepEqual(restored.workspace.workspaceMemory.priorityTopics, [
      'AI releases',
      'Claude features',
      'Major AI tool releases',
      'Iran war relation to Jordan and the world',
      'Very important political events',
      'Mohammed bin Rashid leadership and personality',
      'Dario Amodei writings and articles',
      'Mohammed bin Rashid videos and leadership',
    ]);
    assert.equal(restored.workspace.workspaceMemory.alertStyle, 'strict');
  } finally {
    db.close();
  }
});

test('high priority profile is inferred and persisted from strongly prioritized intent', async () => {
  const db = createTemplateDb();
  const original = aiService.generateStructuredJson;

  aiService.generateStructuredJson = async () => ({
    needsClarification: false,
    confidence: 0.93,
    templateName: 'Template',
    changeSummary: 'Locked in the high-priority profile.',
    objective: 'Prioritize only the sharpest news.',
    higherOrderRule: 'Keep the highest priority signal visible.',
    candidateRules: [],
    sourceMix: { written: 60, socialVideo: 25, socialPhoto: 15 },
    visualSummary: { enabled: true, label: 'Meaning Sketch', iconNameStyle: '3-5 words', prompt: 'Meaning only.' },
  });

  try {
    const state = await templateService.refineTemplate(
      db,
      'Major AI tool releases, important AI notes, Iran war relation to Jordan and the world, and very important political events should stay high priority.',
    );
    const profile = state.workspace.workspaceMemory.highPriorityProfile;

    assert.equal(profile.enabled, true);
    assert.equal(profile.minImportance, 'important');
    assert.match(profile.summary, /high priority/i);
    assert.ok(profile.priorityTopics.some((topic) => /Major AI tool releases/i.test(topic)));
    assert.ok(profile.priorityTopics.some((topic) => /Iran war relation to Jordan and the world/i.test(topic)));
    assert.ok(profile.priorityTopics.some((topic) => /Very important political events/i.test(topic)));
    assert.deepEqual(profile.releaseWatchCompanies.sort(), ['anthropic', 'google', 'openai', 'xai']);
    assert.ok(state.workspace.workspaceMemory.priorityTopics.some((topic) => /Major AI tool releases/i.test(topic)));
    assert.ok(state.workspace.workspaceMemory.priorityTopics.some((topic) => /Very important political events/i.test(topic)));
  } finally {
    aiService.generateStructuredJson = original;
    db.close();
  }
});

test('template-driven feed reranks items, sections content, and gates distracting items', async () => {
  const db = createFeedDb();
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, text: async () => '' });

  try {
    insertSource(db, 'src_written', 'Written Source');
    insertSource(db, 'src_video', 'Video Source');
    insertSource(db, 'src_photo', 'Photo Source');

    const articleAAnalysis = {
      channelType: 'written',
      lifeImpact: 0.86,
      decisionUsefulness: 0.84,
      distractionRisk: 0.12,
      matchedConcepts: ['procurement', 'ai', 'compliance'],
      visualMeaningLabel: 'AI procurement rules',
      visualMeaningPrompt: 'Meaning only.',
      visualMeaningStatus: 'prompt_ready',
      visualMeaningImageUrl: '',
    };

    const articleBAnalysis = {
      channelType: 'written',
      lifeImpact: 0.84,
      decisionUsefulness: 0.82,
      distractionRisk: 0.14,
      matchedConcepts: ['battery', 'supply', 'automation'],
      visualMeaningLabel: 'Battery supply squeeze',
      visualMeaningPrompt: 'Meaning only.',
      visualMeaningStatus: 'prompt_ready',
      visualMeaningImageUrl: '',
    };

    insertItem(db, {
      id: 'article_a',
      source_id: 'src_written',
      external_id: 'article_a',
      title: 'Governments are moving from AI principles to procurement rules',
      url: 'https://example.com/article-a',
      publish_date: recentIso(12),
      summary: 'Procurement, audits, and liability rules are getting concrete.',
      topics: ['AI', 'Policy'],
      content_type: 'article',
      channel_type: 'written',
      rarity_score: 0.35,
      depth_score: 0.76,
      freshness_score: 0.72,
      timeless_score: 0.4,
      clickbait_score: 0.05,
      analysis: articleAAnalysis,
    });

    insertItem(db, {
      id: 'article_b',
      source_id: 'src_written',
      external_id: 'article_b',
      title: 'Battery bottlenecks are starting to affect automation plans',
      url: 'https://example.com/article-b',
      publish_date: recentIso(11),
      summary: 'Battery supply constraints are delaying industrial automation decisions.',
      topics: ['Energy', 'Industry'],
      content_type: 'article',
      channel_type: 'written',
      rarity_score: 0.34,
      depth_score: 0.74,
      freshness_score: 0.7,
      timeless_score: 0.42,
      clickbait_score: 0.04,
      analysis: articleBAnalysis,
    });

    insertItem(db, {
      id: 'article_weather',
      source_id: 'src_written',
      external_id: 'article_weather',
      title: 'Pleasant Weather Today, Turning Warm Through the Weekend',
      url: 'https://example.com/weather',
      publish_date: recentIso(8),
      summary: 'Routine temperature forecast for Amman.',
      topics: ['Weather'],
      content_type: 'article',
      channel_type: 'written',
      rarity_score: 0.8,
      depth_score: 0.8,
      freshness_score: 0.9,
      timeless_score: 0.2,
      clickbait_score: 0.02,
      analysis: {
        channelType: 'written',
        lifeImpact: 0.9,
        decisionUsefulness: 0.8,
        distractionRisk: 0.04,
        matchedConcepts: ['weather', 'forecast'],
        visualMeaningLabel: 'Routine weather forecast',
        visualMeaningPrompt: 'Meaning only.',
        visualMeaningStatus: 'prompt_ready',
        visualMeaningImageUrl: '',
      },
    });

    insertItem(db, {
      id: 'video_1',
      source_id: 'src_video',
      external_id: 'video_1',
      title: 'Short video on AI infrastructure economics',
      url: 'https://example.com/video-1',
      publish_date: recentIso(10),
      summary: 'A useful video on AI infrastructure economics.',
      topics: ['AI', 'Economics'],
      content_type: 'video',
      channel_type: 'socialVideo',
      rarity_score: 0.28,
      depth_score: 0.62,
      freshness_score: 0.68,
      timeless_score: 0.35,
      clickbait_score: 0.06,
      analysis: {
        channelType: 'socialVideo',
        lifeImpact: 0.66,
        decisionUsefulness: 0.64,
        distractionRisk: 0.18,
        matchedConcepts: ['ai', 'economics'],
        visualMeaningLabel: '',
        visualMeaningPrompt: '',
        visualMeaningStatus: 'not_applicable',
        visualMeaningImageUrl: '',
      },
    });

    insertItem(db, {
      id: 'photo_1',
      source_id: 'src_photo',
      external_id: 'photo_1',
      title: 'Celebrity transformation highlight',
      url: 'https://example.com/photo-1',
      publish_date: recentIso(9),
      summary: 'A viral photo post with no practical consequence.',
      topics: ['Entertainment'],
      content_type: 'image',
      channel_type: 'socialPhoto',
      rarity_score: 0.2,
      depth_score: 0.1,
      freshness_score: 0.8,
      timeless_score: 0.1,
      clickbait_score: 0.7,
      analysis: {
        channelType: 'socialPhoto',
        lifeImpact: 0.12,
        decisionUsefulness: 0.1,
        distractionRisk: 0.86,
        matchedConcepts: ['celebrity', 'viral'],
        visualMeaningLabel: '',
        visualMeaningPrompt: '',
        visualMeaningStatus: 'not_applicable',
        visualMeaningImageUrl: '',
      },
    });

    const templateStateA = {
      fixedRules: [
        { id: 'hb_signal_only', title: 'Signal over noise', description: 'Reject spectacle and gossip.', weight: 100, locked: true },
      ],
      adaptiveRules: [
        { id: 'ar_procurement', title: 'AI procurement', description: 'Focus on AI procurement, audits, and compliance.', weight: 94, keywords: ['procurement', 'audit', 'compliance'], locked: false },
      ],
      sourceMix: { written: 70, socialVideo: 20, socialPhoto: 10 },
      visualSummary: { enabled: true, label: 'Meaning Sketch', iconNameStyle: '3-5 words', prompt: 'Meaning only.' },
    };

    const templateStateB = {
      ...templateStateA,
      adaptiveRules: [
        { id: 'ar_supply', title: 'Industrial bottlenecks', description: 'Focus on battery, supply, and automation bottlenecks.', weight: 94, keywords: ['battery', 'supply', 'automation'], locked: false },
      ],
    };

    const feedA = await templateRankingService.buildTemplateDrivenFeed(db, templateStateA, {
      scanLimit: 10,
      limitPerSection: 10,
    });
    const feedB = await templateRankingService.buildTemplateDrivenFeed(db, templateStateB, {
      scanLimit: 10,
      limitPerSection: 10,
    });

    assert.deepEqual(feedA.sections.map((section) => section.id), ['written-news', 'social-video', 'social-photo']);
    assert.equal(feedA.sections.find((section) => section.id === 'social-photo').items.length, 0);
    assert.equal(feedA.sections.find((section) => section.id === 'social-video').items.length, 1);
    assert.equal(feedA.sections.find((section) => section.id === 'written-news').items[0].id, 'article_a');
    assert.equal(feedA.sections.find((section) => section.id === 'written-news').items.some((item) => item.id === 'article_weather'), false);
    assert.equal(feedB.sections.find((section) => section.id === 'written-news').items[0].id, 'article_b');
    assert.ok(feedA.sections.find((section) => section.id === 'written-news').items[0].matchedRules.length > 0);
  } finally {
    global.fetch = originalFetch;
    db.close();
  }
});
