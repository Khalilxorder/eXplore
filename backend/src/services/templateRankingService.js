const fs = require('fs');
const path = require('path');
const aiService = require('../../services/aiService');
const { ensureWrittenNewsCoverage, isLowSignalWrittenItem } = require('./writtenNewsService');
const valueHierarchyService = require('./valueHierarchySync');
const { getDiscoveryStatus } = require('./feedDiscoveryService');
const intelligenceContract = require('./intelligenceContract');

const LIFE_NEWS_PATHS = [
  { id: 'hungary', label: 'Hungary', keywords: ['hungary', 'magyar', 'budapest', 'hungarian'] },
  { id: 'jordan', label: 'Jordan', keywords: ['jordan', 'amman', 'jordanian'] },
  { id: 'usa', label: 'USA', keywords: ['united states', 'american', 'usa', 'washington'] },
  { id: 'europe', label: 'Europe', keywords: ['european union', 'eu ', 'europe', 'brussels'] },
  { id: 'ai', label: 'AI / Tech', keywords: ['artificial intelligence', 'machine learning', 'llm', 'openai', 'gemini'] },
  { id: 'scholarships', label: 'Scholarships', keywords: ['scholarship', 'grant', 'fellowship', 'stipend'] },
  { id: 'immigration', label: 'Immigration / Visa', keywords: ['visa', 'immigration', 'residence permit', 'asylum'] },
  { id: 'work_law', label: 'Work Law', keywords: ['labor law', 'employment', 'work permit', 'contract'] },
  { id: 'uni_deadlines', label: 'University Deadlines', keywords: ['enrollment', 'deadline', 'admission', 'application'] },
  { id: 'war_danger', label: 'War / Danger', keywords: ['war', 'conflict', 'attack', 'bombing', 'missile'] },
  { id: 'economy', label: 'Economy', keywords: ['inflation', 'gdp', 'recession', 'economy', 'market'] },
];

const MAX_SYNC_ANALYSIS = 0;
const ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;
const HEURISTIC_ANALYSIS_VERSION = 2;
const MAX_VISIBLE_NEWS_AGE_HOURS = 72;
const HARD_BOUNDARY_DISTRACTION_MAX = 0.55;
const HARD_BOUNDARY_LIFE_IMPACT_MIN = 0.35;
const FEED_SECTION_DEFS = [
  { id: 'written-news', title: 'Written News', channelType: 'written' },
  { id: 'social-video', title: 'Social Video', channelType: 'socialVideo' },
  { id: 'social-photo', title: 'Social Photo', channelType: 'socialPhoto' },
];
const rerankQueue = new Set();

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function clampWeight(value, fallback = 60) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function parseJson(value, fallback) {
  if (Array.isArray(fallback) && Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeTopicList(value) {
  const input = parseJson(value, []);
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((entry) => normalizeText(entry)).filter(Boolean))].slice(0, 8);
}

function computePublishRecencyScore(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0.35;
  }

  const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
  if (ageHours > MAX_VISIBLE_NEWS_AGE_HOURS) {
    return 0;
  }
  if (ageHours <= 3) {
    return 1;
  }
  if (ageHours <= 12) {
    return 0.92;
  }
  if (ageHours <= 24) {
    return 0.84;
  }
  if (ageHours <= 48) {
    return 0.72;
  }
  if (ageHours <= 72) {
    return 0.6;
  }

  return 0;
}

function getRowPublishedTime(row = {}) {
  const parsed = Date.parse(row.publish_date || row.published_at || row.publishedAt || row.date || row.created_at || row.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isVisibleFreshRow(row = {}) {
  const publishedTime = getRowPublishedTime(row);
  if (!publishedTime) {
    return false;
  }
  return Math.max(0, (Date.now() - publishedTime) / (1000 * 60 * 60)) <= MAX_VISIBLE_NEWS_AGE_HOURS;
}

function tokenize(value) {
  return [...new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .filter((token) => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'your'].includes(token))
  )];
}

function ensureColumn(db, tableName, columnName, definition) {
  const tableExists = db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName);
  if (!tableExists) {
    return;
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function ensureContentAnalysisColumns(db) {
  ensureColumn(db, 'sources', 'trust_tier', 'INTEGER DEFAULT 3');
  ensureColumn(db, 'content_items', 'article_body', 'TEXT');
  ensureColumn(db, 'content_items', 'channel_type', "TEXT DEFAULT 'socialVideo'");
  ensureColumn(db, 'content_items', 'life_impact', 'REAL DEFAULT 0');
  ensureColumn(db, 'content_items', 'decision_usefulness', 'REAL DEFAULT 0');
  ensureColumn(db, 'content_items', 'distraction_risk', 'REAL DEFAULT 0');
  ensureColumn(db, 'content_items', 'trust_score', 'REAL DEFAULT 0.5');
  ensureColumn(db, 'content_items', 'template_analysis_json', 'TEXT');
  ensureColumn(db, 'content_items', 'analysis_updated_at', 'DATETIME');
  ensureColumn(db, 'content_items', 'visual_meaning_label', 'TEXT');
  ensureColumn(db, 'content_items', 'visual_meaning_prompt', 'TEXT');
  ensureColumn(db, 'content_items', 'visual_meaning_status', "TEXT DEFAULT 'prompt_ready'");
  ensureColumn(db, 'content_items', 'visual_meaning_image_url', 'TEXT');
}

function inferChannelType(row) {
  const explicitType = normalizeText(row.channel_type).toLowerCase();
  if (explicitType === 'written' || explicitType === 'socialphoto') {
    return explicitType === 'socialphoto' ? 'socialPhoto' : 'written';
  }

  const contentType = normalizeText(row.content_type).toLowerCase();
  if (contentType === 'article' || contentType === 'written' || contentType === 'release' || contentType === 'radar') {
    return 'written';
  }
  if (contentType === 'image' || contentType === 'photo') {
    return 'socialPhoto';
  }

  const url = normalizeText(row.url || row.link || '').toLowerCase();
  const sourceText = [
    row.source,
    row.publisher,
    row.source_label,
    row.sourceLabel,
    row.feed_section_title,
    row.feedSectionTitle,
  ].filter(Boolean).join(' ').toLowerCase();
  const articleHost = /\b(openai\.com|anthropic\.com|blog\.google|deepmind\.google|x\.ai|ai\.meta\.com|mistral\.ai|stability\.ai|huggingface\.co\/blog|reuters\.com|bloomberg\.com|ft\.com|wsj\.com|theverge\.com|techcrunch\.com|wired\.com|cnbc\.com|apnews\.com|bbc\.com|aljazeera\.com|jordannews\.jo)\b/i;
  const articleSource = /\b(official feed|official announcements|newsroom|written|article|release|press|reuters|bloomberg|financial times|wall street journal|verge|techcrunch|wired|cnbc|ap news|bbc|al jazeera|jordan news)\b/i;
  if (articleHost.test(url) || articleSource.test(sourceText)) {
    return 'written';
  }

  if (explicitType === 'socialvideo') {
    return 'socialVideo';
  }

  return 'socialVideo';
}

function buildContentText(row) {
  return [
    row.title,
    row.summary,
    row.article_body,
    row.transcript,
    ...(normalizeTopicList(row.topic_tags_json)),
  ].filter(Boolean).join(' ');
}

function buildMeaningLabel(row, concepts = []) {
  const base = concepts[0] || row.title || 'Core meaning';
  return normalizeText(base)
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');
}

function buildMeaningPrompt(row, label) {
  return [
    'Create a plain, meaning-only visual summary.',
    `News meaning: ${label}.`,
    'Rules: no decoration, no invented objects, no symbolism beyond the direct meaning, no branding, no emotional exaggeration.',
    `Source context: ${normalizeText(row.title)}.`,
  ].join(' ');
}

function buildHeuristicAnalysis(row) {
  const channelType = inferChannelType(row);
  const text = buildContentText(row).toLowerCase();
  const topics = normalizeTopicList(row.topic_tags_json);
  const clickbait = clamp01(row.clickbait_score, 0.08);
  const freshness = clamp01(row.freshness_score, 0.4);

  let lifeImpact = 0.44;
  let decisionUsefulness = 0.42;
  let distractionRisk = 0.18 + clickbait * 0.5;

  if (channelType === 'written') {
    lifeImpact += 0.12;
    decisionUsefulness += 0.1;
    distractionRisk -= 0.05;
  }

  if (/(policy|law|government|market|supply|risk|security|health|finance|research|infrastructure|economy|procurement|energy)/.test(text)) {
    lifeImpact += 0.18;
    decisionUsefulness += 0.14;
  }

  if (/(anthropic|claude|openai|chatgpt|gpt-?[0-9.]*|gemini|deepmind|xai|grok|iran|iranian|israel|israeli|qatar|qatari|lebanon|lebanese|houthi|houthis|missile|strike|ceasefire|war)/.test(text)) {
    lifeImpact += 0.16;
    decisionUsefulness += 0.12;
  }

  if (/(how to|guide|strategy|decision|plan|what changes|practical|deployment|timeline)/.test(text)) {
    decisionUsefulness += 0.18;
  }

  if (/(celebrity|iconic|went crazy|viral|gossip|look at|makeup|brit awards|transformation|meme)/.test(text)) {
    distractionRisk += 0.28;
    lifeImpact -= 0.12;
  }

  if (/(influencer|looksmaxxing|tv star|reality star|pop star|actor|actress|rapper|red carpet|tabloid|dui|battery charge)/.test(text)) {
    distractionRisk += 0.34;
    lifeImpact -= 0.18;
    decisionUsefulness -= 0.12;
  }

  const matchedConcepts = [...new Set([...topics, ...tokenize(text).slice(0, 5)])].slice(0, 6);
  const visualMeaningLabel = buildMeaningLabel(row, matchedConcepts);
  const visualMeaningPrompt = buildMeaningPrompt(row, visualMeaningLabel);

  return {
    channelType,
    lifeImpact: clamp01(lifeImpact, 0.42),
    decisionUsefulness: clamp01(decisionUsefulness, 0.42),
    distractionRisk: clamp01(distractionRisk, 0.22),
    matchedConcepts,
    visualMeaningLabel,
    visualMeaningPrompt,
    visualMeaningStatus: row.visual_meaning_image_url ? 'image_ready' : 'prompt_ready',
    visualMeaningImageUrl: normalizeText(row.visual_meaning_image_url),
    analysisSource: 'heuristic',
    analysisVersion: HEURISTIC_ANALYSIS_VERSION,
    analyzedAt: new Date().toISOString(),
    freshnessHint: freshness,
  };
}

function normalizeAnalysis(row, analysis) {
  const fallback = buildHeuristicAnalysis(row);
  const channelType = normalizeText(analysis?.channelType || fallback.channelType);
  const safeChannelType = ['written', 'socialVideo', 'socialPhoto'].includes(channelType) ? channelType : fallback.channelType;
  const matchedConcepts = Array.isArray(analysis?.matchedConcepts)
    ? [...new Set(analysis.matchedConcepts.map((entry) => normalizeText(entry)).filter(Boolean))].slice(0, 8)
    : fallback.matchedConcepts;
  const visualMeaningLabel = normalizeText(analysis?.visualMeaningLabel, fallback.visualMeaningLabel).split(/\s+/).slice(0, 6).join(' ');
  const visualMeaningPrompt = buildMeaningPrompt(row, visualMeaningLabel || fallback.visualMeaningLabel);
  const visualMeaningImageUrl = normalizeText(analysis?.visualMeaningImageUrl, row.visual_meaning_image_url || fallback.visualMeaningImageUrl);
  const visualMeaningStatus = normalizeText(
    analysis?.visualMeaningStatus,
    visualMeaningImageUrl ? 'image_ready' : row.visual_meaning_status || fallback.visualMeaningStatus
  );

  return {
    channelType: safeChannelType,
    lifeImpact: clamp01(analysis?.lifeImpact, fallback.lifeImpact),
    decisionUsefulness: clamp01(analysis?.decisionUsefulness, fallback.decisionUsefulness),
    distractionRisk: clamp01(analysis?.distractionRisk, fallback.distractionRisk),
    matchedConcepts,
    visualMeaningLabel,
    visualMeaningPrompt,
    visualMeaningStatus,
    visualMeaningImageUrl,
    analysisSource: normalizeText(analysis?.analysisSource, fallback.analysisSource),
    analysisVersion: Number.isFinite(Number(analysis?.analysisVersion))
      ? Number(analysis.analysisVersion)
      : fallback.analysisVersion,
    analyzedAt: normalizeText(analysis?.analyzedAt, fallback.analyzedAt),
  };
}

function getCachedAnalysis(row) {
  const raw = parseJson(row.template_analysis_json, null);
  if (!raw) {
    return null;
  }

  if (normalizeText(raw.analysisSource) === 'heuristic' && Number(raw.analysisVersion) !== HEURISTIC_ANALYSIS_VERSION) {
    return null;
  }

  const updatedAt = row.analysis_updated_at ? new Date(row.analysis_updated_at).getTime() : 0;
  if (!updatedAt || Number.isNaN(updatedAt) || Date.now() - updatedAt > ANALYSIS_TTL_MS) {
    return null;
  }

  return normalizeAnalysis(row, raw);
}

function saveAnalysis(db, contentId, analysis) {
  db.prepare(`
    UPDATE content_items
    SET channel_type = ?,
        life_impact = ?,
        decision_usefulness = ?,
        distraction_risk = ?,
        template_analysis_json = ?,
        analysis_updated_at = CURRENT_TIMESTAMP,
        visual_meaning_label = ?,
        visual_meaning_prompt = ?,
        visual_meaning_status = ?,
        visual_meaning_image_url = ?
    WHERE id = ?
  `).run(
    analysis.channelType,
    analysis.lifeImpact,
    analysis.decisionUsefulness,
    analysis.distractionRisk,
    JSON.stringify(analysis),
    analysis.visualMeaningLabel,
    analysis.visualMeaningPrompt,
    analysis.visualMeaningStatus,
    analysis.visualMeaningImageUrl || null,
    contentId,
  );
}

async function buildAiAnalysis(row) {
  const response = await aiService.generateStructuredJson({
    providerPreference: 'gemini',
    systemPrompt: `
You classify content for a ruthless personal-news ranking system.

Return valid JSON only with this shape:
{
  "channelType": "written" | "socialVideo" | "socialPhoto",
  "lifeImpact": number,
  "decisionUsefulness": number,
  "distractionRisk": number,
  "matchedConcepts": [string],
  "visualMeaningLabel": string,
  "visualMeaningPrompt": string,
  "visualMeaningStatus": string
}

Rules:
- lifeImpact, decisionUsefulness, distractionRisk must be between 0 and 1.
- Use "written" for article/news text, "socialVideo" for short or long videos, "socialPhoto" for image/photo posts.
- The visual meaning output must be strict and literal: no decoration, no invented objects, no symbolism beyond the news meaning.
- Keep visualMeaningLabel to 3-5 words when possible.
`.trim(),
    userPrompt: `
Classify this content:
Title: ${normalizeText(row.title)}
Source: ${normalizeText(row.source_name)}
Content type: ${normalizeText(row.content_type)}
Summary: ${normalizeText(row.summary)}
Body: ${normalizeText(row.article_body || row.transcript).slice(0, 1800)}
Topics: ${normalizeTopicList(row.topic_tags_json).join(', ')}
`.trim(),
  });

  return response;
}

async function ensureAnalyzedRow(db, row, options = {}) {
  const cached = !options.force ? getCachedAnalysis(row) : null;
  if (cached) {
    return cached;
  }

  let analysis;
  try {
    analysis = normalizeAnalysis(row, await buildAiAnalysis(row));
  } catch (error) {
    analysis = buildHeuristicAnalysis(row);
  }

  saveAnalysis(db, row.id, analysis);
  return analysis;
}

function getRuleText(rule) {
  return [rule.title, rule.description, ...(Array.isArray(rule.keywords) ? rule.keywords : [])].filter(Boolean).join(' ');
}

function scoreTextOverlap(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(leftTokens.length, rightTokens.length);
}

function computeRuleMatches(text, concepts, rules = []) {
  const conceptText = Array.isArray(concepts) ? concepts.join(' ') : '';
  return rules
    .map((rule) => {
      const overlap = scoreTextOverlap(`${text} ${conceptText}`, getRuleText(rule));
      return {
        id: rule.id,
        title: rule.title,
        description: rule.description,
        weight: clampWeight(rule.weight, 60),
        locked: Boolean(rule.locked),
        matchScore: Number((overlap * (clampWeight(rule.weight, 60) / 100)).toFixed(3)),
      };
    })
    .filter((rule) => rule.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 3);
}

function computeAdaptiveAlignment(matches = [], hasActiveRules = true) {
  if (!matches.length) {
    return hasActiveRules ? 0 : 0.08;
  }

  const weighted = matches.reduce((sum, match) => sum + match.matchScore, 0) / matches.length;
  return clamp01(weighted, hasActiveRules ? 0 : 0.08);
}

function buildTemplateReason(analysis, matchedRules, goalAlignment = 0, workspaceSignals = {}) {
  const topRule = matchedRules[0];
  if (topRule) {
    if (goalAlignment >= 0.55 && analysis.lifeImpact >= 0.7) {
      return `Hawk match: ${topRule.title}. Strong trajectory alignment for real decisions.`;
    }
    if (analysis.lifeImpact >= 0.7) {
      return `Hawk match: ${topRule.title}. High impact for real decisions.`;
    }
    return `Hawk match: ${topRule.title}.`;
  }

  if (goalAlignment >= 0.65) {
    return 'Strong alignment with your long-term trajectory and current template.';
  }

  if (workspaceSignals.workspaceAvoidPenalty >= 0.7) {
    return 'Downranked because it overlaps with topics you asked eXplore to avoid.';
  }

  if (workspaceSignals.trackedCompanyAlignment >= 0.5) {
    return 'Strong match with the AI companies you explicitly track.';
  }

  if (workspaceSignals.workspaceTopicAlignment >= 0.5) {
    return 'Strong match with the topics you explicitly care about most.';
  }

  if (analysis.lifeImpact >= 0.65) {
    return 'High life impact and useful for practical decisions.';
  }

  return 'Aligned with the current template balance.';
}

function parseEmbedding(row) {
  const parsed = parseJson(row.embedding_json, []);
  return Array.isArray(parsed) ? parsed : [];
}

function getSourceLabel(row) {
  return normalizeText(row.discovery_source_label || row.source_name || row.source_label) || 'Unknown';
}

function getSourceTrustScore(row) {
  const sourceTrustScore = Number(row?.source_trust_score);
  if (Number.isFinite(sourceTrustScore)) {
    return clamp01(sourceTrustScore, 0.5);
  }

  const sourceTrustTier = Number(row?.source_trust_tier);
  if (Number.isFinite(sourceTrustTier) && sourceTrustTier > 0) {
    return clamp01(sourceTrustTier / 5, 0.5);
  }

  const trustScore = Number(row?.trust_score);
  if (Number.isFinite(trustScore)) {
    return clamp01(trustScore, 0.5);
  }

  return 0.5;
}

function hasExplicitSourceTrust(row) {
  const sourceTrustScore = Number(row?.source_trust_score);
  if (Number.isFinite(sourceTrustScore)) {
    return true;
  }

  const sourceTrustTier = Number(row?.source_trust_tier);
  return Number.isFinite(sourceTrustTier) && sourceTrustTier > 0;
}

function buildItemFromRow(row, analysis, templateScore, matchedRules, reason, goalAlignment = 0, hierarchyWeight = 0.12, workspaceSignals = {}, intelligenceExplanation = null) {
  const topics = normalizeTopicList(row.topic_tags_json);
  const thumbnail = normalizeText(row.thumbnail_url);
  const recency = computePublishRecencyScore(row.publish_date || row.created_at);
  const freshness = Number((((clamp01(row.freshness_score, 0.4) * 0.4) + (recency * 0.6))).toFixed(3));
  const sourceTrust = getSourceTrustScore(row);
  const sourceTrustProvided = hasExplicitSourceTrust(row);
  const sourceLabel = getSourceLabel(row);

  return {
    id: row.id,
    external_id: row.external_id,
    title: row.title,
    source: sourceLabel,
    url: row.url,
    thumbnail: thumbnail || null,
    date: row.publish_date,
    duration: row.duration_seconds,
    summary: row.summary,
    sourceTrust: sourceTrustProvided && Number.isFinite(sourceTrust)
      ? Number(sourceTrust.toFixed(3))
      : null,
    sourceTrustProvided,
    badges: [],
    reason,
    intelligenceExplanation,
    topics,
    contentType: row.content_type,
    channelType: analysis.channelType,
    templateScore: Number(templateScore.toFixed(3)),
    goalAlignment: Number(goalAlignment.toFixed(3)),
    matchedRules,
    visualMeaning: {
      label: analysis.visualMeaningLabel,
      prompt: analysis.visualMeaningPrompt,
      status: analysis.visualMeaningStatus,
      imageUrl: analysis.visualMeaningImageUrl || '',
    },
    scores: {
      depth: clamp01(row.depth_score, 0.5),
      rarity: clamp01(row.rarity_score, 0.4),
      freshness,
      recency,
      clickbait: clamp01(row.clickbait_score, 0.08),
      timeless: clamp01(row.timeless_score, 0.4),
      relevance: 0.8,
      sourceTrust: sourceTrustProvided && Number.isFinite(sourceTrust)
        ? Number(sourceTrust.toFixed(3))
        : undefined,
      goalAlignment,
      hierarchyWeight,
      workspaceTopicAlignment: clamp01(workspaceSignals.workspaceTopicAlignment, 0),
      trackedCompanyAlignment: clamp01(workspaceSignals.trackedCompanyAlignment, 0),
      workspaceSourceAlignment: clamp01(workspaceSignals.workspaceSourceAlignment, 0),
      workspaceAvoidPenalty: clamp01(workspaceSignals.workspaceAvoidPenalty, 0),
      lifeImpact: analysis.lifeImpact,
      decisionUsefulness: analysis.decisionUsefulness,
      distractionRisk: analysis.distractionRisk,
    },
    embedding: parseEmbedding(row),
  };
}

function getDiscoveryBoost(discovery = {}) {
  const lane = normalizeText(discovery?.lane).toLowerCase();
  const overall = clamp01(discovery?.overallScore, 0);
  const decision = clamp01(discovery?.decisionScore, 0);
  const exploration = clamp01(discovery?.explorationScore, 0);

  const laneWeight = lane === 'tracked_channels'
    ? 0.08
    : lane === 'topic_monitors'
      ? 0.06
      : lane === 'strategic_discovery'
        ? 0.03
        : 0.04;

  return (overall * laneWeight) + (decision * 0.04) - (exploration * 0.03);
}

function getTemplateSignalBoost(item) {
  const matches = Array.isArray(item?.matchedRules) ? item.matchedRules : [];
  const topMatch = clamp01(matches[0]?.matchScore, 0);

  // Strong explicit rule hits should beat "slightly newer but less relevant".
  if (topMatch < 0.08) {
    return 0;
  }

  return (topMatch - 0.08) * 0.24;
}

function computeBestFeedComposite(item) {
  const scores = item?.scores || {};
  const freshness = clamp01(scores.freshness, 0.4);
  const recency = clamp01(scores.recency, freshness);
  const lifeImpact = clamp01(scores.lifeImpact, 0.42);
  const decisionUsefulness = clamp01(scores.decisionUsefulness, 0.42);
  const distractionRisk = clamp01(scores.distractionRisk, 0.18);
  const sourceTrust = clamp01(scores.sourceTrust, 0.5);
  const templateScore = clamp01(item?.templateScore, 0.36);

  return (
    (templateScore * 0.42) +
    (lifeImpact * 0.16) +
    (decisionUsefulness * 0.16) +
    (freshness * 0.11) +
    (recency * 0.18) +
    (sourceTrust * 0.08) +
    getTemplateSignalBoost(item) +
    getDiscoveryBoost(item?.discovery) -
    (distractionRisk * 0.13)
  );
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLabel(label) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return [words.join(' ')];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')];
}

const VISUAL_ICONS = new Set([
  'document',
  'chip',
  'gavel',
  'battery',
  'factory',
  'warning',
  'globe',
  'chart',
  'network',
  'shield',
  'robot',
  'server',
  'book',
  'camera',
  'video',
  'photo',
  'currency',
  'truck',
  'lab',
]);

const VISUAL_ICON_COLORS = {
  document: '#2563EB',
  chip: '#1D4ED8',
  gavel: '#7C3AED',
  battery: '#0F766E',
  factory: '#B45309',
  warning: '#D97706',
  globe: '#0369A1',
  chart: '#0F766E',
  network: '#4F46E5',
  shield: '#0F766E',
  robot: '#1D4ED8',
  server: '#1E40AF',
  book: '#7C2D12',
  camera: '#334155',
  video: '#7C3AED',
  photo: '#0F766E',
  currency: '#047857',
  truck: '#9A3412',
  lab: '#BE185D',
};

function normalizeVisualSceneElement(element, index = 0) {
  const icon = VISUAL_ICONS.has(element?.icon) ? element.icon : 'document';
  const label = normalizeText(element?.label, `Element ${index + 1}`).split(/\s+/).slice(0, 4).join(' ');
  return {
    icon,
    label,
    emphasis: clampWeight(element?.emphasis, 2),
  };
}

function normalizeVisualSceneSpec(scene, fallbackLabel = 'Core meaning') {
  const rawElements = Array.isArray(scene?.elements) ? scene.elements : [];
  const elements = rawElements
    .slice(0, 3)
    .map((element, index) => normalizeVisualSceneElement(element, index));

  const safeElements = elements.length ? elements : [
    normalizeVisualSceneElement({ icon: 'document', label: fallbackLabel, emphasis: 3 }, 0),
  ];

  const layout = ['row', 'flow', 'stack'].includes(scene?.layout) ? scene.layout : (safeElements.length >= 3 ? 'flow' : 'row');

  return {
    label: normalizeText(scene?.label, fallbackLabel),
    layout,
    elements: safeElements,
  };
}

function buildHeuristicVisualSceneSpec(row, analysis) {
  const text = `${row.title} ${row.summary} ${row.article_body}`.toLowerCase();
  const elements = [];

  if (/ai|model|chip|compute|inference|llm/.test(text)) {
    elements.push({ icon: 'chip', label: 'AI systems', emphasis: 3 });
  }
  if (/policy|rule|law|regulat|audit|procurement|compliance/.test(text)) {
    elements.push({ icon: 'gavel', label: 'Rules', emphasis: 2 });
  }
  if (/battery|energy|power/.test(text)) {
    elements.push({ icon: 'battery', label: 'Energy', emphasis: 2 });
  }
  if (/factory|industrial|manufactur|automation/.test(text)) {
    elements.push({ icon: 'factory', label: 'Industry', emphasis: 3 });
  }
  if (/supply|logistics|shipment|transport|bottleneck/.test(text)) {
    elements.push({ icon: 'truck', label: 'Supply', emphasis: 2 });
  }
  if (/market|pricing|cost|price|economics|finance/.test(text)) {
    elements.push({ icon: 'chart', label: 'Costs', emphasis: 2 });
  }
  if (/health|lab|science|research/.test(text)) {
    elements.push({ icon: 'lab', label: 'Research', emphasis: 2 });
  }
  if (/risk|warning|danger|shortage/.test(text)) {
    elements.push({ icon: 'warning', label: 'Risk', emphasis: 2 });
  }

  if (!elements.length) {
    elements.push({ icon: 'document', label: analysis.visualMeaningLabel || row.title, emphasis: 3 });
  }

  return normalizeVisualSceneSpec({
    label: analysis.visualMeaningLabel || row.title,
    layout: elements.length >= 3 ? 'flow' : 'row',
    elements,
  }, analysis.visualMeaningLabel || row.title);
}

async function buildAiVisualSceneSpec(row, analysis) {
  const response = await aiService.generateStructuredJson({
    providerPreference: 'gemini',
    temperature: 0.1,
    systemPrompt: `
Design a strict meaning-only visual scene spec for a news item.

Return valid JSON only:
{
  "label": string,
  "layout": "row" | "flow" | "stack",
  "elements": [
    { "icon": string, "label": string, "emphasis": number }
  ]
}

Rules:
- Use only these icons: document, chip, gavel, battery, factory, warning, globe, chart, network, shield, robot, server, book, camera, video, photo, currency, truck, lab.
- Use 1 to 3 elements only.
- Keep labels literal and short.
- No decoration, no invented symbolism, no style commentary.
    `.trim(),
    userPrompt: `
Title: ${normalizeText(row.title)}
Summary: ${normalizeText(row.summary)}
Body: ${normalizeText(row.article_body || row.transcript).slice(0, 1600)}
Meaning label: ${analysis.visualMeaningLabel}
    `.trim(),
  });

  return normalizeVisualSceneSpec(response, analysis.visualMeaningLabel || row.title);
}

function renderVisualIcon(icon, x, y, size, color) {
  const stroke = color;
  const fill = `${color}14`;
  const unit = size / 24;

  switch (icon) {
    case 'chip':
      return `
        <rect x="${x + unit * 4}" y="${y + unit * 4}" width="${unit * 16}" height="${unit * 16}" rx="${unit * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.6}" />
        <path d="M ${x + unit * 8} ${y + unit * 8} H ${x + unit * 16} V ${y + unit * 16} H ${x + unit * 8} Z" fill="none" stroke="${stroke}" stroke-width="${unit * 1.4}" />
      `;
    case 'gavel':
      return `
        <rect x="${x + unit * 7}" y="${y + unit * 6}" width="${unit * 8}" height="${unit * 4}" rx="${unit}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 12} ${y + unit * 10} L ${x + unit * 18} ${y + unit * 18}" stroke="${stroke}" stroke-width="${unit * 2}" stroke-linecap="round" />
        <path d="M ${x + unit * 6} ${y + unit * 18} H ${x + unit * 16}" stroke="${stroke}" stroke-width="${unit * 1.6}" stroke-linecap="round" />
      `;
    case 'battery':
      return `
        <rect x="${x + unit * 5}" y="${y + unit * 7}" width="${unit * 13}" height="${unit * 10}" rx="${unit * 1.8}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <rect x="${x + unit * 18}" y="${y + unit * 10}" width="${unit * 2}" height="${unit * 4}" rx="${unit * 0.8}" fill="${stroke}" />
        <path d="M ${x + unit * 9} ${y + unit * 10} L ${x + unit * 12} ${y + unit * 10} L ${x + unit * 10.5} ${y + unit * 14} H ${x + unit * 14} L ${x + unit * 11} ${y + unit * 19} L ${x + unit * 12} ${y + unit * 14} H ${x + unit * 9} Z" fill="${stroke}" />
      `;
    case 'factory':
      return `
        <path d="M ${x + unit * 5} ${y + unit * 18} V ${y + unit * 10} L ${x + unit * 10} ${y + unit * 13} V ${y + unit * 9} L ${x + unit * 15} ${y + unit * 12} V ${y + unit * 7} H ${x + unit * 19} V ${y + unit * 18} Z" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 8} ${y + unit * 18} V ${y + unit * 14} M ${x + unit * 12} ${y + unit * 18} V ${y + unit * 14} M ${x + unit * 16} ${y + unit * 18} V ${y + unit * 14}" stroke="${stroke}" stroke-width="${unit * 1.2}" />
      `;
    case 'warning':
      return `
        <path d="M ${x + unit * 12} ${y + unit * 4} L ${x + unit * 20} ${y + unit * 18} H ${x + unit * 4} Z" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 12} ${y + unit * 9} V ${y + unit * 14}" stroke="${stroke}" stroke-width="${unit * 2}" stroke-linecap="round" />
        <circle cx="${x + unit * 12}" cy="${y + unit * 17}" r="${unit}" fill="${stroke}" />
      `;
    case 'chart':
      return `
        <path d="M ${x + unit * 5} ${y + unit * 18} H ${x + unit * 19}" stroke="${stroke}" stroke-width="${unit * 1.6}" stroke-linecap="round" />
        <path d="M ${x + unit * 7} ${y + unit * 15} L ${x + unit * 11} ${y + unit * 11} L ${x + unit * 14} ${y + unit * 13} L ${x + unit * 18} ${y + unit * 8}" fill="none" stroke="${stroke}" stroke-width="${unit * 1.8}" stroke-linecap="round" stroke-linejoin="round" />
      `;
    case 'truck':
      return `
        <rect x="${x + unit * 5}" y="${y + unit * 10}" width="${unit * 9}" height="${unit * 6}" rx="${unit}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 14} ${y + unit * 12} H ${x + unit * 18} L ${x + unit * 20} ${y + unit * 15} V ${y + unit * 16} H ${x + unit * 14} Z" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <circle cx="${x + unit * 9}" cy="${y + unit * 18}" r="${unit * 1.4}" fill="#FFFFFF" stroke="${stroke}" stroke-width="${unit * 1.2}" />
        <circle cx="${x + unit * 17}" cy="${y + unit * 18}" r="${unit * 1.4}" fill="#FFFFFF" stroke="${stroke}" stroke-width="${unit * 1.2}" />
      `;
    case 'lab':
      return `
        <path d="M ${x + unit * 9} ${y + unit * 5} V ${y + unit * 11} L ${x + unit * 5} ${y + unit * 18} H ${x + unit * 19} L ${x + unit * 15} ${y + unit * 11} V ${y + unit * 5}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" stroke-linejoin="round" />
        <path d="M ${x + unit * 8} ${y + unit * 14} H ${x + unit * 16}" stroke="${stroke}" stroke-width="${unit * 1.2}" />
      `;
    case 'currency':
      return `
        <circle cx="${x + unit * 12}" cy="${y + unit * 12}" r="${unit * 7}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 12} ${y + unit * 7} V ${y + unit * 17} M ${x + unit * 9} ${y + unit * 10} H ${x + unit * 14} C ${x + unit * 16} ${y + unit * 10} ${x + unit * 16} ${y + unit * 14} ${x + unit * 12} ${y + unit * 14} H ${x + unit * 9}" fill="none" stroke="${stroke}" stroke-width="${unit * 1.4}" stroke-linecap="round" />
      `;
    case 'globe':
      return `
        <circle cx="${x + unit * 12}" cy="${y + unit * 12}" r="${unit * 7}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 5} ${y + unit * 12} H ${x + unit * 19} M ${x + unit * 12} ${y + unit * 5} V ${y + unit * 19} M ${x + unit * 8} ${y + unit * 6} C ${x + unit * 10} ${y + unit * 10} ${x + unit * 10} ${y + unit * 14} ${x + unit * 8} ${y + unit * 18} M ${x + unit * 16} ${y + unit * 6} C ${x + unit * 14} ${y + unit * 10} ${x + unit * 14} ${y + unit * 14} ${x + unit * 16} ${y + unit * 18}" fill="none" stroke="${stroke}" stroke-width="${unit * 1.2}" />
      `;
    default:
      return `
        <rect x="${x + unit * 6}" y="${y + unit * 4}" width="${unit * 12}" height="${unit * 16}" rx="${unit * 1.8}" fill="${fill}" stroke="${stroke}" stroke-width="${unit * 1.4}" />
        <path d="M ${x + unit * 9} ${y + unit * 9} H ${x + unit * 15} M ${x + unit * 9} ${y + unit * 12} H ${x + unit * 15} M ${x + unit * 9} ${y + unit * 15} H ${x + unit * 13}" stroke="${stroke}" stroke-width="${unit * 1.2}" stroke-linecap="round" />
      `;
  }
}

function renderSceneCard(element, x, y, width, height) {
  const color = VISUAL_ICON_COLORS[element.icon] || '#1D4ED8';
  const iconSize = Math.min(width * 0.36, 88);
  const iconX = x + (width - iconSize) / 2;
  const iconY = y + 18;
  const lines = wrapLabel(element.label).slice(0, 2);
  const fontSize = element.emphasis >= 3 ? 20 : 18;

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="#FFFFFF" stroke="#D9DFEA" stroke-width="2" />
    <rect x="${x + 12}" y="${y + 12}" width="${width - 24}" height="${height - 24}" rx="22" fill="${color}08" />
    ${renderVisualIcon(element.icon, iconX, iconY, iconSize, color)}
    <text x="${x + width / 2}" y="${y + height - 42}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#0B1730" text-anchor="middle">${escapeXml(lines[0] || element.label)}</text>
    ${lines[1] ? `<text x="${x + width / 2}" y="${y + height - 18}" font-family="Arial, sans-serif" font-size="${fontSize - 2}" font-weight="600" fill="#334155" text-anchor="middle">${escapeXml(lines[1])}</text>` : ''}
  `;
}

function buildSceneFrames(scene) {
  const count = scene.elements.length;

  if (count === 1) {
    return [{ x: 112, y: 110, width: 288, height: 292 }];
  }

  if (count === 2 && scene.layout === 'stack') {
    return [
      { x: 96, y: 72, width: 320, height: 156 },
      { x: 96, y: 268, width: 320, height: 156 },
    ];
  }

  if (count === 2) {
    return [
      { x: 52, y: 116, width: 176, height: 280 },
      { x: 284, y: 116, width: 176, height: 280 },
    ];
  }

  return [
    { x: 32, y: 132, width: 136, height: 248 },
    { x: 188, y: 92, width: 136, height: 328 },
    { x: 344, y: 132, width: 136, height: 248 },
  ];
}

function buildVisualMeaningSvg(scene) {
  const normalized = normalizeVisualSceneSpec(scene, scene?.label || 'Core meaning');
  const frames = buildSceneFrames(normalized);
  const cards = normalized.elements.map((element, index) => renderSceneCard(element, frames[index].x, frames[index].y, frames[index].width, frames[index].height)).join('');
  const arrows = normalized.layout === 'flow' && normalized.elements.length >= 2
    ? `
      <path d="M 168 256 H 188 M 324 256 H 344" stroke="#94A3B8" stroke-width="6" stroke-linecap="round" />
      <path d="M 182 248 L 194 256 L 182 264" stroke="#94A3B8" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 338 248 L 350 256 L 338 264" stroke="#94A3B8" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    `
    : normalized.layout === 'row' && normalized.elements.length === 2
      ? `
        <path d="M 228 256 H 284" stroke="#94A3B8" stroke-width="6" stroke-linecap="round" />
        <path d="M 272 248 L 284 256 L 272 264" stroke="#94A3B8" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      `
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${escapeXml(normalized.label)}">
  <rect width="512" height="512" fill="#F6F7FB" />
  <rect x="20" y="20" width="472" height="472" rx="38" fill="#FFFFFF" stroke="#D9DFEA" stroke-width="2" />
  ${cards}
  ${arrows}
</svg>`;
}

async function generateVisualMeaningAsset(db, contentId, options = {}) {
  ensureContentAnalysisColumns(db);

  const row = db.prepare(`
    SELECT c.*, s.name AS source_name
    FROM content_items c
    LEFT JOIN sources s ON s.id = c.source_id
    WHERE c.id = ? OR c.external_id = ?
    LIMIT 1
  `).get(contentId, contentId);

  if (!row) {
    throw new Error('Content not found.');
  }

  const analysis = await ensureAnalyzedRow(db, row, { force: Boolean(options.forceAnalysis) });
  if (analysis.channelType !== 'written') {
    throw new Error('Visual meaning is available only for written news items.');
  }

  if (row.visual_meaning_image_url && row.visual_meaning_status === 'image_ready' && !options.force) {
    return {
      label: analysis.visualMeaningLabel,
      prompt: analysis.visualMeaningPrompt,
      status: 'image_ready',
      imageUrl: row.visual_meaning_image_url,
    };
  }

  let scene;
  try {
    scene = await buildAiVisualSceneSpec(row, analysis);
  } catch (error) {
    scene = buildHeuristicVisualSceneSpec(row, analysis);
  }

  const visualsDir = path.join(__dirname, '..', '..', 'uploads', 'visuals');
  fs.mkdirSync(visualsDir, { recursive: true });
  const safeId = String(row.id || contentId).replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${safeId}.svg`;
  const filePath = path.join(visualsDir, fileName);
  fs.writeFileSync(filePath, buildVisualMeaningSvg(scene), 'utf8');

  const imageUrl = `/api/v1/visuals/${fileName}`;
  const nextAnalysis = {
    ...analysis,
    visualMeaningStatus: 'image_ready',
    visualMeaningImageUrl: imageUrl,
  };
  saveAnalysis(db, row.id, nextAnalysis);

  return {
    label: nextAnalysis.visualMeaningLabel,
    prompt: nextAnalysis.visualMeaningPrompt,
    status: nextAnalysis.visualMeaningStatus,
    imageUrl,
  };
}

function buildSourceMixPreference(templateState, channelType) {
  const mix = templateState?.sourceMix || templateState?.activeVersion?.sourceMix || {
    written: 50,
    socialVideo: 30,
    socialPhoto: 20,
  };

  return clamp01((Number(mix[channelType]) || 0) / 100, 0.2);
}

function getWorkspaceMemory(templateState) {
  return templateState?.workspace?.workspaceMemory
    || templateState?.template?.workspaceMemory
    || null;
}

function computeWorkspaceTopicAlignment(text, workspaceMemory) {
  const priorityTopics = Array.isArray(workspaceMemory?.priorityTopics) ? workspaceMemory.priorityTopics : [];
  if (!priorityTopics.length) {
    return 0;
  }

  const normalizedText = String(text || '').toLowerCase();
  const hits = priorityTopics.filter((topic) => normalizeText(topic).toLowerCase() && normalizedText.includes(normalizeText(topic).toLowerCase())).length;
  return clamp01(hits / Math.max(1, Math.min(priorityTopics.length, 3)), 0);
}

function computeWorkspaceAvoidPenalty(text, workspaceMemory) {
  const avoidTopics = Array.isArray(workspaceMemory?.avoidTopics) ? workspaceMemory.avoidTopics : [];
  if (!avoidTopics.length) {
    return 0;
  }

  const normalizedText = String(text || '').toLowerCase();
  const hits = avoidTopics.filter((topic) => normalizeText(topic).toLowerCase() && normalizedText.includes(normalizeText(topic).toLowerCase())).length;
  return clamp01(hits / Math.max(1, Math.min(avoidTopics.length, 2)), 0);
}

function computeTrackedCompanyAlignment(text, workspaceMemory) {
  const trackedCompanies = Array.isArray(workspaceMemory?.trackedCompanies) ? workspaceMemory.trackedCompanies : [];
  if (!trackedCompanies.length) {
    return 0;
  }

  const normalizedText = String(text || '').toLowerCase();
  const companyPatterns = {
    anthropic: /\banthropic\b|\bclaude\b/i,
    openai: /\bopenai\b|\bgpt\b|\bchatgpt\b/i,
    google: /\bgemini\b|\bdeepmind\b|\bgoogle\s+ai\b|\bgoogle\b/i,
    xai: /\bgrok\b|\bxai\b|\bx\.ai\b/i,
  };
  const hits = trackedCompanies.filter((companyKey) => companyPatterns[companyKey]?.test(normalizedText)).length;
  return clamp01(hits / Math.max(1, Math.min(trackedCompanies.length, 2)), 0);
}

function computeWorkspaceSourceAlignment(row, analysis, workspaceMemory) {
  const preferences = workspaceMemory?.sourcePreferences;
  if (!preferences) {
    return 0;
  }

  let score = 0;
  if (preferences.officialFirst && /\b(openai|anthropic|deepmind|gemini|xai|grok|official|newsroom|blog)\b/i.test(`${row.source_name || ''} ${row.url || ''} ${row.title || ''}`)) {
    score += 0.8;
  }
  if (preferences.written && analysis.channelType === 'written') {
    score += 0.6;
  }
  if (preferences.socialVideo && analysis.channelType === 'socialVideo') {
    score += 0.4;
  }
  if (preferences.socialPhoto && analysis.channelType === 'socialPhoto') {
    score += 0.4;
  }
  if (preferences.trustedSourcesOnly && Number(row.source_trust_tier || 3) <= 2) {
    score += 0.5;
  }

  return clamp01(score / 1.8, 0);
}

function resolveHierarchyWeight(templateState) {
  const rawWeight = Number(
    templateState?.hierarchyWeight
    ?? templateState?.template?.hierarchyWeight
    ?? 0.12
  );

  if (!Number.isFinite(rawWeight)) {
    return 0.12;
  }

  return clamp01(rawWeight, 0.12);
}

function scoreRowAgainstTemplate(row, analysis, templateState) {
  const fixedRules = templateState?.fixedRules || templateState?.template?.fixedRules || [];
  const adaptiveRules = templateState?.adaptiveRules || templateState?.activeVersion?.adaptiveRules || [];
  const allRules = [...fixedRules, ...adaptiveRules];
  const text = buildContentText(row);
  const matchedRules = computeRuleMatches(text, analysis.matchedConcepts, allRules);
  const adaptiveMatches = matchedRules.filter((rule) => !rule.locked);
  const adaptiveAlignment = computeAdaptiveAlignment(adaptiveMatches, allRules.length > 0);
  const sourceMixPreference = buildSourceMixPreference(templateState, analysis.channelType);
  const depth = clamp01(row.depth_score, 0.5);
  const rarity = clamp01(row.rarity_score, 0.4);
  const recency = computePublishRecencyScore(row.publish_date || row.created_at);
  const freshness = Number((((clamp01(row.freshness_score, 0.4) * 0.4) + (recency * 0.6))).toFixed(3));
  const goalAlignment = valueHierarchyService.computeHierarchyAlignment(templateState?.hierarchy, text);
  const hierarchyWeight = resolveHierarchyWeight(templateState);
  const workspaceMemory = getWorkspaceMemory(templateState);
  const workspaceTopicAlignment = computeWorkspaceTopicAlignment(text, workspaceMemory);
  const trackedCompanyAlignment = computeTrackedCompanyAlignment(text, workspaceMemory);
  const workspaceSourceAlignment = computeWorkspaceSourceAlignment(row, analysis, workspaceMemory);
  const workspaceAvoidPenalty = computeWorkspaceAvoidPenalty(text, workspaceMemory);

  const templateScoreBase = (
    (0.39 * adaptiveAlignment) +
    (0.25 * analysis.lifeImpact) +
    (0.10 * freshness) +
    (0.10 * depth) +
    (0.05 * rarity) +
    (0.05 * sourceMixPreference) +
    (0.04 * workspaceTopicAlignment) +
    (0.03 * trackedCompanyAlignment) +
    (0.03 * workspaceSourceAlignment) -
    (0.08 * workspaceAvoidPenalty)
  );
  let finalScore = templateState?.hierarchy?.hasSignal
    ? Math.min(1, templateScoreBase + (goalAlignment * hierarchyWeight))
    : templateScoreBase;

  const appMode = templateState?.hierarchy?.appMode || 'average';
  const textLower = text.toLowerCase();
  if (appMode === 'edge') {
    if (/(vision|sphere|creative|research|science|discovery|academic|breakthrough|lab|art|design)/i.test(textLower)) {
      finalScore *= 1.5;
    }
  } else {
    if (/(daily|life|work|job|employment|deadline|due|invoice|bill|payment|money|visa|permit|housing|rent)/i.test(textLower)) {
      finalScore *= 1.5;
    }
  }
  const templateScore = Math.min(1, finalScore);

  const blocked = analysis.distractionRisk > HARD_BOUNDARY_DISTRACTION_MAX
    || analysis.lifeImpact < HARD_BOUNDARY_LIFE_IMPACT_MIN
    || workspaceAvoidPenalty >= 0.9;

  return {
    blocked,
    templateScore,
    goalAlignment,
    hierarchyWeight,
    workspaceTopicAlignment,
    trackedCompanyAlignment,
    workspaceSourceAlignment,
    workspaceAvoidPenalty,
    matchedRules,
    reason: buildTemplateReason(
      analysis,
      matchedRules,
      goalAlignment,
      {
        workspaceTopicAlignment,
        trackedCompanyAlignment,
        workspaceSourceAlignment,
        workspaceAvoidPenalty,
      }
    ),
  };
}

function getDiscoveryScopeKey(userId = '') {
  return normalizeText(userId) || 'public';
}

function loadDiscoveryRows(db, userId = '', limit = 120) {
  try {
    return db.prepare(`
      SELECT
        c.*,
        s.name AS source_name,
        s.trust_tier AS source_trust_tier,
        fc.lane AS discovery_lane,
        fc.overall_score AS discovery_overall_score,
        fc.personal_match_score AS discovery_personal_match_score,
        fc.decision_score AS discovery_decision_score,
        fc.exploration_score AS discovery_exploration_score,
        fc.why_selected AS discovery_why_selected,
        fc.source_label AS discovery_source_label
      FROM feed_candidates fc
      JOIN content_items c ON c.id = fc.content_id
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE fc.scope_key = ? AND fc.stale = 0
      ORDER BY fc.overall_score DESC, datetime(COALESCE(fc.published_at, fc.updated_at, fc.created_at)) DESC
      LIMIT ?
    `).all(getDiscoveryScopeKey(userId), Math.max(1, Math.min(Number(limit) || 120, 240)))
      .map((row) => ({
        ...row,
        __discovery: {
          lane: row.discovery_lane || '',
          overallScore: clamp01(row.discovery_overall_score, 0.32),
          personalMatchScore: clamp01(row.discovery_personal_match_score, 0.32),
          decisionScore: clamp01(row.discovery_decision_score, 0.32),
          explorationScore: clamp01(row.discovery_exploration_score, 0.12),
          whySelected: normalizeText(row.discovery_why_selected),
          sourceLabel: normalizeText(row.discovery_source_label || row.source_name),
        },
      }));
  } catch (error) {
    return [];
  }
}

function mergeDiscoveryRows(discoveryRows = [], baseRows = []) {
  const seen = new Set();
  const merged = [];

  for (const row of discoveryRows) {
    const key = row.id || row.external_id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(row);
  }

  for (const row of baseRows) {
    const key = row.id || row.external_id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(row);
  }

  return merged;
}

async function buildTemplateDrivenFeed(db, templateState, options = {}) {
  ensureContentAnalysisColumns(db);
  if (options.ensureWrittenCoverage === true) {
    await ensureWrittenNewsCoverage(db).catch(() => null);
  }

  const baseRows = db.prepare(`
    SELECT c.*, s.name AS source_name, s.trust_tier AS source_trust_tier
    FROM content_items c
    LEFT JOIN sources s ON s.id = c.source_id
    WHERE datetime(COALESCE(c.publish_date, c.created_at)) >= datetime('now', '-3 days')
    ORDER BY COALESCE(c.publish_date, c.created_at) DESC, c.created_at DESC
    LIMIT ?
  `).all(Number(options.scanLimit) || 500);
  const discoveryRows = loadDiscoveryRows(db, options.scopeUserId || '', options.discoveryLimit || 140);
  const rows = mergeDiscoveryRows(discoveryRows, baseRows)
    .filter(isVisibleFreshRow)
    .slice(0, Number(options.scanLimit) || 500);

  const sectionMap = new Map(FEED_SECTION_DEFS.map((section) => [section.id, { ...section, items: [] }]));
  const configuredSyncAnalysisLimit = Number(options.syncAnalysisLimit);
  let remainingSyncAnalyses = Number.isFinite(configuredSyncAnalysisLimit)
    ? Math.max(0, configuredSyncAnalysisLimit)
    : MAX_SYNC_ANALYSIS;
  let missingAnalysisCount = 0;

  for (const row of rows) {
    if (inferChannelType(row) === 'written' && isLowSignalWrittenItem(row)) {
      continue;
    }

    let analysis = getCachedAnalysis(row);

    if (!analysis && remainingSyncAnalyses > 0) {
      analysis = await ensureAnalyzedRow(db, row);
      remainingSyncAnalyses -= 1;
    } else if (!analysis) {
      analysis = buildHeuristicAnalysis(row);
      missingAnalysisCount += 1;
    }

    const ranking = scoreRowAgainstTemplate(row, analysis, templateState);
    if (ranking.blocked) {
      continue;
    }

    const intelligenceExplanation = intelligenceContract.buildExplanation({
      item: {
        ...row,
        source: row.source_name || row.discovery_source_label || '',
        sourceTrust: Number.isFinite(Number(row.source_trust_tier)) ? Number(row.source_trust_tier) / 5 : undefined,
        topics: normalizeTopicList(row.topic_tags_json),
      },
      hierarchy: templateState?.hierarchy || {},
      workspaceMemory: getWorkspaceMemory(templateState) || {},
      goals: templateState?.goals || [],
      ranking,
      source: {
        id: row.source_id || null,
        name: row.source_name || row.discovery_source_label || '',
        url: row.source_url || row.url || '',
        trust_tier: row.source_trust_tier,
        role: row.official_source ? 'official' : 'reported',
      },
    });
    const item = buildItemFromRow(
      row,
      analysis,
      ranking.templateScore,
      ranking.matchedRules,
      ranking.reason,
      ranking.goalAlignment,
      ranking.hierarchyWeight,
      ranking,
      intelligenceExplanation,
    );
    if (row.__discovery) {
      item.discovery = row.__discovery;
      if (row.__discovery.whySelected) {
        item.reason = `${item.reason} ${row.__discovery.whySelected}`.trim();
      }
    }
    const section = FEED_SECTION_DEFS.find((entry) => entry.channelType === analysis.channelType);
    if (section) {
      sectionMap.get(section.id).items.push(item);
    }
  }

  const sections = FEED_SECTION_DEFS.map((section) => {
    const nextSection = sectionMap.get(section.id);
    nextSection.items = nextSection.items
      .sort((left, right) => {
        const leftComposite = computeBestFeedComposite(left);
        const rightComposite = computeBestFeedComposite(right);
        if (rightComposite !== leftComposite) {
          return rightComposite - leftComposite;
        }

        const rightTime = new Date(right.date || 0).getTime();
        const leftTime = new Date(left.date || 0).getTime();
        return rightTime - leftTime;
      })
      .slice(0, Number(options.limitPerSection) || 12);
    return nextSection;
  });

  if (missingAnalysisCount > 0) {
    scheduleRecentContentWarmup(db);
  }

  const shouldBackfillVisuals = options.precomputeVisuals === true;
  if (shouldBackfillVisuals) {
    const writtenSection = sections.find((section) => section.id === 'written-news');
    const visibleWritten = (writtenSection?.items || []).slice(0, 4);
    for (const item of visibleWritten) {
      if (item.thumbnail || (item.visualMeaning?.status === 'image_ready' && item.visualMeaning?.imageUrl)) {
        continue;
      }

      try {
        item.visualMeaning = await generateVisualMeaningAsset(db, item.id);
      } catch (error) {
        // Keep label/prompt only if visual generation fails.
      }
    }
  }

  return {
    sections,
    discovery: getDiscoveryStatus(db, options.scopeUserId || ''),
  };
}

function scheduleRecentContentWarmup(db) {
  const jobId = 'recent-content-analysis';
  if (rerankQueue.has(jobId)) {
    return;
  }

  rerankQueue.add(jobId);
  setTimeout(async () => {
    try {
      ensureContentAnalysisColumns(db);
      await ensureWrittenNewsCoverage(db).catch(() => null);
      const rows = db.prepare(`
        SELECT c.*, s.name AS source_name
        FROM content_items c
        LEFT JOIN sources s ON s.id = c.source_id
        ORDER BY COALESCE(c.publish_date, c.created_at) DESC, c.created_at DESC
        LIMIT 500
      `).all();
      const warmedRows = mergeDiscoveryRows(loadDiscoveryRows(db, '', 160), rows);

      for (const row of warmedRows) {
        await ensureAnalyzedRow(db, row);
      }
    } catch (error) {
      // Background warmups should never take the app down.
    } finally {
      rerankQueue.delete(jobId);
    }
  }, 25);
}

module.exports = {
  FEED_SECTION_DEFS,
  LIFE_NEWS_PATHS,
  buildTemplateDrivenFeed,
  ensureContentAnalysisColumns,
  ensureAnalyzedRow,
  generateVisualMeaningAsset,
  scheduleRecentContentWarmup,
  __test__: {
    buildHeuristicAnalysis,
    buildVisualMeaningSvg,
    computeRuleMatches,
    scoreRowAgainstTemplate,
  },
};
