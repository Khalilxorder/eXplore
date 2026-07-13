const crypto = require('crypto');
const aiService = require('../../services/aiService');

const DEFAULT_USER_ID = 'guest';
const MAX_CORE_VALUES = 6;
const STORY_LAYERS = [
  {
    id: 'highest_order',
    label: 'Life Narrative',
    storyField: 'storyHighestOrder',
    description: 'Highest-order religious, mythic, and shared-humanity frame.',
  },
  {
    id: 'future_wish',
    label: 'Future Wish',
    storyField: 'storyYours',
    description: 'Personal past, present, and future-life wish.',
  },
  {
    id: 'current_goals',
    label: 'Current Goals',
    storyField: 'storySubStories',
    fallbackField: 'currentGoal',
    description: 'Current lower-order goals and immediate sub-stories.',
  },
];

const CONTENT_TEXT_FIELDS = new Set([
  'title',
  'name',
  'headline',
  'summary',
  'description',
  'content',
  'contentInfo',
  'fitReason',
  'fit_reason',
  'relevance',
  'category',
  'type',
  'location',
  'source',
  'deadline',
  'topic',
  'topics',
  'topicTags',
  'topic_tags',
  'tags',
  'skills',
  'requirements',
  'nextAction',
  'next_action',
  'action',
]);

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.max(min, Math.min(max, numeric));
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

function normalizeCoreValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, MAX_CORE_VALUES))];
}

function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => (
        token.length > 3 && token.endsWith('s') && !/(ss|us|is)$/.test(token)
          ? token.slice(0, -1)
          : token
      ))
      .filter((token) => token.length > 2)
      .filter((token) => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'your', 'their'].includes(token))
  )];
}

function overlapScore(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(leftTokens.length, rightTokens.length);
}

function sharedTokens(left, right) {
  const leftTokens = tokenize(left);
  const rightSet = new Set(tokenize(right));

  return leftTokens.filter((token) => rightSet.has(token));
}

function computeStoryLayerScore(contentText, storyText) {
  const contentTokens = tokenize(contentText);
  const storyTokens = tokenize(storyText);

  if (!contentTokens.length || !storyTokens.length) {
    return 0;
  }

  const matched = sharedTokens(contentText, storyText).length;
  const storyCoverage = matched / storyTokens.length;
  const contentCoverage = matched / contentTokens.length;

  return clamp((storyCoverage * 0.7) + (contentCoverage * 0.3), 0, 1);
}

function summarizeInputText(value, depth = 0) {
  if (value === null || value === undefined || depth > 2) {
    return [];
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = normalizeText(value);
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => summarizeInputText(entry, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => (
      CONTENT_TEXT_FIELDS.has(key)
        ? summarizeInputText(entry, depth + 1)
        : []
    ));
  }

  return [];
}

function normalizeContentInput(contentInfo = '') {
  return normalizeText(summarizeInputText(contentInfo).join(' '));
}

function storyAlignmentBand(score) {
  if (score >= 0.45) {
    return 'strong';
  }
  if (score >= 0.2) {
    return 'moderate';
  }
  if (score > 0) {
    return 'weak';
  }
  return 'none';
}

function buildLayerSummary(label, score, matchedTerms, configured, hasContentSignal) {
  if (!configured) {
    return `${label} has no saved story text yet.`;
  }

  if (!hasContentSignal) {
    return 'No item text was provided to compare against this layer.';
  }

  if (!matchedTerms.length) {
    return `No concrete ${label.toLowerCase()} overlap found in this item.`;
  }

  return `${label} match through ${matchedTerms.slice(0, 6).join(', ')}.`;
}

function ensureTables(db) {
  if (!db) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_value_hierarchy (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      current_goal TEXT,
      core_values_json TEXT,
      source_history_json TEXT,
      story_highest_order TEXT,
      story_yours TEXT,
      story_sub_stories TEXT,
      self_raw_data TEXT,
      scientific_profile_json TEXT,
      labs_research_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run dynamic migrations to add new columns to existing database if needed
  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN story_highest_order TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN story_yours TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN story_sub_stories TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN self_raw_data TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN scientific_profile_json TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN labs_research_json TEXT;`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    db.exec(`ALTER TABLE user_value_hierarchy ADD COLUMN app_mode TEXT DEFAULT 'average';`);
  } catch (e) {
    // Ignore if column already exists
  }
}

function getRow(db, userId = DEFAULT_USER_ID) {
  ensureTables(db);
  return db.prepare(`
    SELECT *
    FROM user_value_hierarchy
    WHERE user_id = ?
    LIMIT 1
  `).get(userId);
}

function mapState(row, userId = DEFAULT_USER_ID) {
  const currentGoal = normalizeText(row?.current_goal);
  const coreValues = normalizeCoreValues(parseJson(row?.core_values_json, []));
  const historyHints = normalizeCoreValues(parseJson(row?.source_history_json, []));

  return {
    userId,
    currentGoal,
    coreValues,
    historyHints,
    storyHighestOrder: row?.story_highest_order || '',
    storyYours: row?.story_yours || '',
    storySubStories: row?.story_sub_stories || '',
    selfRawData: row?.self_raw_data || '',
    scientificProfile: parseJson(row?.scientific_profile_json, null),
    labsResearch: parseJson(row?.labs_research_json, null),
    appMode: row?.app_mode || 'average',
    hasSignal: Boolean(
      currentGoal || 
      coreValues.length || 
      row?.story_highest_order || 
      row?.story_yours || 
      row?.story_sub_stories || 
      row?.self_raw_data || 
      row?.scientific_profile_json ||
      row?.labs_research_json
    ),
    updatedAt: row?.updated_at || null,
    createdAt: row?.created_at || null,
  };
}

function upsertState(db, userId = DEFAULT_USER_ID, updates = {}) {
  ensureTables(db);

  const existing = getRow(db, userId);
  const nextState = {
    currentGoal: updates.currentGoal !== undefined
      ? normalizeText(updates.currentGoal)
      : normalizeText(existing?.current_goal),
    coreValues: updates.coreValues !== undefined
      ? normalizeCoreValues(updates.coreValues)
      : normalizeCoreValues(parseJson(existing?.core_values_json, [])),
    historyHints: updates.historyHints !== undefined
      ? normalizeCoreValues(updates.historyHints)
      : normalizeCoreValues(parseJson(existing?.source_history_json, [])),
    storyHighestOrder: updates.storyHighestOrder !== undefined
      ? String(updates.storyHighestOrder || '').trim()
      : (existing?.story_highest_order || ''),
    storyYours: updates.storyYours !== undefined
      ? String(updates.storyYours || '').trim()
      : (existing?.story_yours || ''),
    storySubStories: updates.storySubStories !== undefined
      ? String(updates.storySubStories || '').trim()
      : (existing?.story_sub_stories || ''),
    selfRawData: updates.selfRawData !== undefined
      ? String(updates.selfRawData || '').trim()
      : (existing?.self_raw_data || ''),
    scientificProfile: updates.scientificProfile !== undefined
      ? updates.scientificProfile
      : parseJson(existing?.scientific_profile_json, null),
    labsResearch: updates.labsResearch !== undefined
      ? updates.labsResearch
      : parseJson(existing?.labs_research_json, null),
    appMode: updates.appMode !== undefined
      ? String(updates.appMode || 'average')
      : (existing?.app_mode || 'average'),
  };

  if (existing) {
    db.prepare(`
      UPDATE user_value_hierarchy
      SET current_goal = ?,
          core_values_json = ?,
          source_history_json = ?,
          story_highest_order = ?,
          story_yours = ?,
          story_sub_stories = ?,
          self_raw_data = ?,
          scientific_profile_json = ?,
          labs_research_json = ?,
          app_mode = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      nextState.currentGoal || null,
      JSON.stringify(nextState.coreValues),
      JSON.stringify(nextState.historyHints),
      nextState.storyHighestOrder || null,
      nextState.storyYours || null,
      nextState.storySubStories || null,
      nextState.selfRawData || null,
      nextState.scientificProfile ? JSON.stringify(nextState.scientificProfile) : null,
      nextState.labsResearch ? JSON.stringify(nextState.labsResearch) : null,
      nextState.appMode,
      userId,
    );
  } else {
    db.prepare(`
      INSERT INTO user_value_hierarchy (
        id,
        user_id,
        current_goal,
        core_values_json,
        source_history_json,
        story_highest_order,
        story_yours,
        story_sub_stories,
        self_raw_data,
        scientific_profile_json,
        labs_research_json,
        app_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      nextState.currentGoal || null,
      JSON.stringify(nextState.coreValues),
      JSON.stringify(nextState.historyHints),
      nextState.storyHighestOrder || null,
      nextState.storyYours || null,
      nextState.storySubStories || null,
      nextState.selfRawData || null,
      nextState.scientificProfile ? JSON.stringify(nextState.scientificProfile) : null,
      nextState.labsResearch ? JSON.stringify(nextState.labsResearch) : null,
      nextState.appMode,
    );
  }

  return getState(db, userId);
}

function getState(db, userId = DEFAULT_USER_ID) {
  return mapState(getRow(db, userId), userId);
}

function updateUserGoal(db, userId = DEFAULT_USER_ID, goal = '') {
  return upsertState(db, userId, {
    currentGoal: goal,
  });
}

function updateStories(db, userId = DEFAULT_USER_ID, { storyHighestOrder, storyYours, storySubStories }) {
  return upsertState(db, userId, {
    storyHighestOrder,
    storyYours,
    storySubStories,
    currentGoal: storySubStories,
  });
}

function buildFootprintHeuristic(historyData = []) {
  const weightedTerms = new Map();

  for (const entry of historyData) {
    const title = normalizeText(entry?.title);
    const playCount = clamp(entry?.playCount, 1, 999) || 1;

    for (const token of tokenize(title)) {
      weightedTerms.set(token, (weightedTerms.get(token) || 0) + playCount);
    }
  }

  return [...weightedTerms.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_CORE_VALUES)
    .map(([token]) => token)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1));
}

function aggregateHistoryEntries(entries = []) {
  const aggregated = new Map();

  for (const entry of entries) {
    const title = normalizeText(entry?.title)
      .replace(/^(watched|visited|liked|saved)\s+/i, '')
      .replace(/\s+-\s+youtube$/i, '')
      .trim();
    if (!title) {
      continue;
    }

    const action = normalizeText(entry?.action).toLowerCase();
    const weight = action === 'liked' || action === 'saved' ? 3 : 1;
    const current = aggregated.get(title) || { title, playCount: 0, actions: [] };
    current.playCount += (clamp(entry?.playCount, 1, 999) || 1) * weight;
    if (action && !current.actions.includes(action)) {
      current.actions.push(action);
    }
    aggregated.set(title, current);
  }

  return [...aggregated.values()]
    .sort((left, right) => right.playCount - left.playCount)
    .slice(0, 100);
}

function parseHistoryJson(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.activities)
        ? parsed.activities
        : Array.isArray(parsed?.history)
          ? parsed.history
          : [];

    return aggregateHistoryEntries(items.map((entry) => ({
      title: entry?.title || entry?.titleText || entry?.name || entry?.description,
      action: /liked/i.test(`${entry?.title || ''} ${entry?.description || ''}`)
        ? 'liked'
        : /saved/i.test(`${entry?.title || ''} ${entry?.description || ''}`)
          ? 'saved'
          : 'watched',
      playCount: entry?.playCount || 1,
    })));
  } catch (error) {
    return [];
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHistoryHtml(rawText) {
  const matches = [];
  const watchedAnchorPattern = /(?:Watched|Visited|Liked|Saved)\s*<a[^>]*>(.*?)<\/a>/gi;
  let anchorMatch = watchedAnchorPattern.exec(rawText);

  while (anchorMatch) {
    matches.push({
      title: stripHtml(anchorMatch[1]),
      action: /liked/i.test(anchorMatch[0]) ? 'liked' : /saved/i.test(anchorMatch[0]) ? 'saved' : 'watched',
      playCount: 1,
    });
    anchorMatch = watchedAnchorPattern.exec(rawText);
  }

  if (!matches.length) {
    const lineMatches = rawText
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => /\b(watched|visited|liked|saved)\b/i.test(line))
      .map((line) => ({
        title: stripHtml(line.replace(/^.*?(watched|visited|liked|saved)\s+/i, '').trim()),
        action: /liked/i.test(line) ? 'liked' : /saved/i.test(line) ? 'saved' : 'watched',
        playCount: 1,
      }));
    matches.push(...lineMatches);
  }

  return aggregateHistoryEntries(matches);
}

function importDigitalFootprint(rawText = '', options = {}) {
  const text = String(rawText || '').trim();
  if (!text) {
    return [];
  }

  const normalizedSource = normalizeText(options.source).toLowerCase();
  const fileName = normalizeText(options.fileName).toLowerCase();
  const treatAsJson = normalizedSource.includes('json')
    || fileName.endsWith('.json')
    || text.startsWith('[')
    || text.startsWith('{');

  if (treatAsJson) {
    const jsonEntries = parseHistoryJson(text);
    if (jsonEntries.length) {
      return jsonEntries;
    }
  }

  return parseHistoryHtml(text);
}

async function extractCoreValues(historyData = []) {
  const rankedTitles = historyData
    .filter((entry) => normalizeText(entry?.title))
    .sort((left, right) => clamp(right?.playCount, 0, 999) - clamp(left?.playCount, 0, 999))
    .slice(0, 16)
    .map((entry) => `- ${normalizeText(entry.title)} (${clamp(entry.playCount, 1, 999)} plays)`)
    .join('\n');

  if (!rankedTitles) {
    return [];
  }

  try {
    const response = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.2,
      systemPrompt: `
You extract a user's recurring core values from their digital footprint.

Return valid JSON only:
{
  "coreValues": [string]
}

Rules:
- Return 3 to 6 short phrases.
- Focus on enduring pursuits, not superficial topics.
- Prefer values and trajectories like "AI systems", "industrial strategy", "human psychology".
      `.trim(),
      userPrompt: `
The user repeatedly consumed these titles:
${rankedTitles}

Extract the clearest recurring core values.
      `.trim(),
    });

    return normalizeCoreValues(response?.coreValues);
  } catch (error) {
    return buildFootprintHeuristic(historyData);
  }
}

async function syncDigitalFootprint(db, userId = DEFAULT_USER_ID, historyData = []) {
  const normalizedHistory = aggregateHistoryEntries(Array.isArray(historyData)
    ? historyData
      .map((entry) => ({
        title: normalizeText(entry?.title),
        action: normalizeText(entry?.action),
        playCount: clamp(entry?.playCount, 1, 999) || 1,
      }))
      .filter((entry) => entry.title)
    : []);

  const coreValues = await extractCoreValues(normalizedHistory);
  return upsertState(db, userId, {
    coreValues,
    historyHints: normalizedHistory.map((entry) => entry.title).slice(0, 12),
  });
}

function computeHierarchyAlignment(state, contentText) {
  if (!state?.hasSignal) {
    return 0;
  }

  const narrativeScore = state.storyHighestOrder ? overlapScore(contentText, state.storyHighestOrder) : 0;
  const wishScore = state.storyYours ? overlapScore(contentText, state.storyYours) : 0;
  const goalScore = (state.storySubStories || state.currentGoal) ? overlapScore(contentText, state.storySubStories || state.currentGoal) : 0;

  const coreValueScore = state.coreValues.length
    ? state.coreValues
      .map((coreValue) => overlapScore(contentText, coreValue))
      .reduce((sum, score) => sum + score, 0) / state.coreValues.length
    : 0;

  const storyScore = (narrativeScore * 0.3) + (wishScore * 0.3) + (goalScore * 0.4);
  return clamp((storyScore * 0.6) + (coreValueScore * 0.4), 0, 1);
}

function summarizeStoryLayerAlignment(state, contentInfo = '') {
  const contentText = normalizeContentInput(contentInfo);
  const hasContentSignal = Boolean(contentText);
  const layers = STORY_LAYERS.map((layer, index) => {
    const layerText = normalizeText(
      state?.[layer.storyField] || (layer.fallbackField ? state?.[layer.fallbackField] : ''),
    );
    const configured = Boolean(layerText);
    const matchedTerms = configured && hasContentSignal
      ? sharedTokens(contentText, layerText)
      : [];
    const score = configured && hasContentSignal
      ? computeStoryLayerScore(contentText, layerText)
      : 0;
    const roundedScore = Number(score.toFixed(3));

    return {
      id: layer.id,
      label: layer.label,
      order: index + 1,
      storyField: layer.storyField,
      fallbackField: layer.fallbackField || null,
      description: layer.description,
      configured,
      score: roundedScore,
      alignmentBand: storyAlignmentBand(score),
      matchedTerms,
      layerPreview: layerText.slice(0, 240),
      summary: buildLayerSummary(layer.label, roundedScore, matchedTerms, configured, hasContentSignal),
    };
  });
  const rankedLayers = [...layers].sort((left, right) => (
    right.score - left.score || left.order - right.order
  ));
  const bestLayer = rankedLayers[0]?.score > 0 ? rankedLayers[0] : null;

  return {
    hasHierarchySignal: Boolean(state?.hasSignal || layers.some((layer) => layer.configured)),
    hasContentSignal,
    contentSummary: contentText.slice(0, 240),
    bestLayer,
    selectedLayerId: bestLayer?.id || null,
    alignmentScore: bestLayer?.score || 0,
    alignmentBand: bestLayer?.alignmentBand || 'none',
    layers,
    rankedLayers,
  };
}

async function evaluateContentAgainstHierarchy(db, userId = DEFAULT_USER_ID, contentInfo = '') {
  const hierarchy = getState(db, userId);
  if (!hierarchy.hasSignal) {
    return 1.0;
  }

  const heuristicScore = computeHierarchyAlignment(hierarchy, contentInfo);

  // Extract scientific profile text if present
  const profile = hierarchy.scientificProfile;
  let profilePrompt = 'None';
  if (profile) {
    profilePrompt = `
Personality (Big Five): Openness=${profile.personality?.openness}/100, Conscientiousness=${profile.personality?.conscientiousness}/100, Extraversion=${profile.personality?.extraversion}/100, Agreeableness=${profile.personality?.agreeableness}/100, Neuroticism=${profile.personality?.neuroticism}/100. Diagnostic: ${profile.personality?.description}
Narrative Profile: Agency=${profile.narrative?.agency}/100, Communion=${profile.narrative?.communion}/100, Redemption=${profile.narrative?.redemption}/100, Contamination=${profile.narrative?.contamination}/100. Diagnostic: ${profile.narrative?.description}
Cognitive Style: Need for Cognition=${profile.cognitive?.needForCognition}/100, Processing Depth=${profile.cognitive?.processingDepth}/100, Lateral Exploration=${profile.cognitive?.lateralExploration}/100. Diagnostic: ${profile.cognitive?.description}
    `.trim();
  }

  try {
    const response = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.15,
      systemPrompt: `
You judge how strongly incoming content aligns with a user's long-term trajectory, values, and psychological profile.

Return valid JSON only:
{
  "alignmentScore": number
}

Rules:
- alignmentScore must be between 0.1 and 10.0.
- 0.1 means meaningless distraction.
- 10.0 means directly accelerates the user's life direction.
- Adjust scores based on cognitive style: if user has high Need for Cognition or high Processing Depth, favor rich, deep-dives, scientific, and analytical articles. If they have high Lateral Exploration, allow diverse interdisciplinary topics; if low, penalize distraction.
      `.trim(),
      userPrompt: `
The user has defined their life and focus across 3 Layers of Stories:
1. Highest Order all life story: ${hierarchy.storyHighestOrder || 'Not set'}
2. Your Story (past, present, future wishes): ${hierarchy.storyYours || 'Not set'}
3. Current sub-stories & immediate goals: ${hierarchy.storySubStories || hierarchy.currentGoal || 'Not set'}

User core values: ${hierarchy.coreValues.join(', ') || 'None'}

User Scientific Profile (Personality, Narrative & Cognitive style):
${profilePrompt}

Incoming content:
${normalizeText(contentInfo)}
      `.trim(),
    });

    return clamp(response?.alignmentScore, 0.1, 10.0);
  } catch (error) {
    return Number((0.1 + (heuristicScore * 9.9)).toFixed(2));
  }
}

async function analyzeSelfData(db, userId = DEFAULT_USER_ID, rawText = '') {
  const normalizedText = String(rawText || '').trim();
  if (!normalizedText) {
    throw new Error('Valid raw text assessment data is required');
  }

  const systemPrompt = `
You are a psychometric scoring engine. You analyze a user's self-description, journal, or personality/cognitive assessment results and predict their personality traits, narrative identity styles, and cognitive state based on scientifically grounded psychological correlations.

Return valid JSON matching this schema exactly:
{
  "personality": {
    "openness": number, // 0-100 score
    "conscientiousness": number, // 0-100 score
    "extraversion": number, // 0-100 score
    "agreeableness": number, // 0-100 score
    "neuroticism": number, // 0-100 score
    "description": "Short diagnostic summary of their OCEAN traits (1-2 sentences)"
  },
  "narrative": {
    "agency": number, // 0-100 score (Dan McAdams model: autonomy, dominance, achievement)
    "communion": number, // 0-100 score (Dan McAdams model: connection, love, dialogue)
    "redemption": number, // 0-100 score (Dan McAdams model: turning bad events into positive outcomes)
    "contamination": number, // 0-100 score (Dan McAdams model: good events ending in ruin or pain)
    "description": "Short summary of their narrative identity themes (1-2 sentences)"
  },
  "cognitive": {
    "needForCognition": number, // 0-100 score (appetite for intellectual challenges)
    "processingDepth": number, // 0-100 score (preference for deep, exhaustive explanation vs. summaries)
    "lateralExploration": number, // 0-100 score (preference for exploring diverse ideas vs. staying focused)
    "cognitiveLoad": number, // 0-100 score (estimated mental bandwidth or stress level)
    "description": "Short summary of their cognitive style (1-2 sentences)"
  }
}

Use true scientifically grounded correlations:
- Openness correlates with curiosity, complex ideas, and interest in art/science.
- McAdams Narrative Redemption correlates with resilience and high psychological well-being.
- Need for Cognition correlates with deep information processing and low trust in superficial headlines.
- Conscientiousness correlates with detail, structure, and goal-oriented behaviors.
`.trim();

  const userPrompt = `
Analyze the following user data to produce their psychometric and cognitive profile:

${normalizedText}
`.trim();

  const response = await aiService.generateStructuredJson({
    providerPreference: 'gemini',
    temperature: 0.15,
    systemPrompt,
    userPrompt,
  });

  if (!response?.personality || !response?.narrative || !response?.cognitive) {
    throw new Error('Analysis completed but the response was malformed. Please try again.');
  }

  // Persist to database
  return upsertState(db, userId, {
    selfRawData: normalizedText,
    scientificProfile: response,
  });
}

async function generateLabsResearch(db, userId = DEFAULT_USER_ID) {
  ensureTables(db);
  const state = getState(db, userId);

  const goalText = `
Highest Order Story: ${state.storyHighestOrder || 'None'}
Personal Story: ${state.storyYours || 'None'}
Immediate Goals/Sub-stories: ${state.storySubStories || state.currentGoal || 'None'}
Core Values: ${(state.coreValues || []).join(', ') || 'None'}
  `.trim();

  const systemPrompt = `
You are a world-class scientific research scout and academic advisor.
Analyze the user's active life direction, core values, and goals.
Identify:
1. Three (3) actual, highly prestigious research laboratories in Hungary focusing on fields relevant to the user's focus. For each Hungarian lab, summarize exactly five (5) top recent scientific papers (published within the last few years) and detail a highly specific, personalized connection explaining how that exact paper aligns with or advances the user's life goals.
2. Three (3) actual, highly prestigious research laboratories or medical research centers in the USA. For each USA lab, detail their active leading studies, their primary focus, the name of the leading doctor/director/PI (Principal Investigator), their location/institution, and why they are strategic.

Your output must be valid JSON matching this schema exactly:
{
  "hungary": [
    {
      "id": "string (unique id like hun-lab-1)",
      "name": "string (name of lab)",
      "institution": "string (university or research institute)",
      "location": "string (city, Hungary)",
      "director": "string (director or leading scientist name)",
      "relevance": "string (how the lab matches the user's overall goals)",
      "papers": [
        {
          "title": "string (title of scientific paper)",
          "year": "string (year of publication)",
          "journal": "string (journal name)",
          "summary": "string (1-2 sentence summary of the paper's key findings)",
          "connectionToGoals": "string (detailed personalized explanation of why this paper connects to their goals)"
        }
      ]
    }
  ],
  "usa": [
    {
      "id": "string (unique id like usa-lab-1)",
      "name": "string (name of lab)",
      "institution": "string (university or research institute)",
      "location": "string (city, state, USA)",
      "director": "string (director or leading doctor/PI name)",
      "relevance": "string (why this lab is strategic for the user)",
      "studies": [
        {
          "title": "string (title of top study or active project)",
          "leadDoctor": "string (doctor or PI leading the study)",
          "summary": "string (summary of study objectives or findings)"
        }
      ]
    }
  ]
}

Ensure all laboratory names, institution names, and director names are actual, legitimate, and prominent entities (e.g. Hungarian Academy of Sciences, HUN-REN, Semmelweis University, Eötvös Loránd University, MIT, Stanford, Harvard, Johns Hopkins, etc.). Do not return plain markdown. Return ONLY the JSON object.
`.trim();

  const userPrompt = `
Map research laboratories in Hungary and the USA to these active life goals and trajectory:

${goalText}
`.trim();

  const response = await aiService.generateStructuredJson({
    providerPreference: 'gemini',
    temperature: 0.15,
    systemPrompt,
    userPrompt,
  });

  if (!response?.hungary || !response?.usa) {
    throw new Error('Research labs generation completed but response structure was incomplete.');
  }

  // Persist to database
  return upsertState(db, userId, {
    labsResearch: response,
  });
}

function buildDeterministicInterpretation(state) {
  const configuredLayers = STORY_LAYERS.map((layer) => {
    const text = normalizeText(state?.[layer.storyField] || (layer.fallbackField ? state?.[layer.fallbackField] : ''));
    return {
      id: layer.id,
      label: layer.label,
      configured: Boolean(text),
      preview: text.slice(0, 200),
    };
  });
  const dominant = configuredLayers.find((layer) => layer.configured) || configuredLayers[0];

  const goalTokens = tokenize(`${state.currentGoal || ''} ${state.storySubStories || ''}`).slice(0, 8);
  const rawAmplify = [...new Set([
    ...state.coreValues,
    ...goalTokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)),
  ])].filter(Boolean);

  const appMode = state.appMode || 'average';
  const edgeRegex = /(vision|sphere|creative|research|science|discovery|academic|breakthrough|lab|art|design)/i;
  const averageRegex = /(daily|life|work|job|employment|deadline|due|invoice|bill|payment|money|visa|permit|housing|rent)/i;

  const scoredAmplify = rawAmplify.map((word) => {
    let score = 1.0;
    if (appMode === 'edge') {
      if (edgeRegex.test(word)) score *= 1.5;
    } else {
      if (averageRegex.test(word)) score *= 1.5;
    }
    return { word, score };
  });

  const amplify = scoredAmplify
    .sort((a, b) => b.score - a.score)
    .map((item) => item.word)
    .slice(0, 10);

  const profile = state.scientificProfile;
  let cognitiveTilt = 'No SELF profile yet — ranking uses goals and values only.';
  if (profile?.cognitive) {
    const c = profile.cognitive;
    const deep = Number(c.needForCognition || 0) >= 60 || Number(c.processingDepth || 0) >= 60;
    const lateral = Number(c.lateralExploration || 0) >= 60;
    cognitiveTilt = `${deep ? 'Favors deep, analytical, research-grade pieces over headlines. ' : 'Prefers concise, practical pieces. '}`
      + `${lateral ? 'Allows wide interdisciplinary range.' : 'Stays focused; penalizes off-topic distraction.'}`;
  }

  return {
    headline: dominant?.configured
      ? `News is filtered through your "${dominant.label}" lens first, then goals, values, and cognitive style.`
      : 'No life-story layers set yet — news is shown broadly until you add your rules.',
    dominantLayer: dominant ? { id: dominant.id, label: dominant.label } : null,
    configuredLayers,
    amplify: amplify.length ? amplify : ['(add Current Goals and Core Values to steer amplification)'],
    suppress: [
      'Generic clickbait and low-trust sources',
      'Topics with no link to your story layers or goals',
      ...(state.coreValues.length ? [] : ['(add Filters / Do-Not-Show to suppress specific topics)']),
    ],
    sourcePosture: 'Official and high-trust sources are weighted up; popularity alone does not promote an item.',
    cognitiveTilt,
    plainSummary: dominant?.configured
      ? `After all your rules, the system keeps news that advances your ${dominant.label.toLowerCase()} and current goals (${amplify.slice(0, 4).join(', ') || 'your values'}), trusts official sources, and downgrades anything off-trajectory.`
      : 'Add your story layers and goals in the profile to give the filter something to work with.',
    source: 'deterministic',
    hasSignal: Boolean(state.hasSignal),
  };
}

async function buildFinalInterpretation(db, userId = DEFAULT_USER_ID) {
  const state = getState(db, userId);
  const fallback = buildDeterministicInterpretation(state);
  if (!state.hasSignal) {
    return fallback;
  }

  const profile = state.scientificProfile;
  const profilePrompt = profile
    ? `Personality openness=${profile.personality?.openness}, conscientiousness=${profile.personality?.conscientiousness}; Cognitive needForCognition=${profile.cognitive?.needForCognition}, processingDepth=${profile.cognitive?.processingDepth}, lateralExploration=${profile.cognitive?.lateralExploration}.`
    : 'None';

  try {
    const response = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.2,
      systemPrompt: `
You explain, in plain and honest language, the EFFECTIVE news filter that results from combining a user's life-story layers, current goals, core values, and cognitive profile. This is the single lens the system uses to score, rank, keep, and suppress news for this user. Do not invent rules the user did not provide.

Return valid JSON only:
{
  "headline": "one sentence describing the lens",
  "dominantLayer": "Life Narrative" | "Future Wish" | "Current Goals",
  "amplify": ["short topic/signal the filter surfaces", ...],
  "suppress": ["short topic/signal the filter downgrades or hides", ...],
  "sourcePosture": "one sentence on source trust posture",
  "cognitiveTilt": "one sentence on how their cognitive style tilts ranking",
  "plainSummary": "2-3 sentences a non-technical user can read to understand what finally gets through"
}`.trim(),
      userPrompt: `
The user's rules, in priority order:
1. Life Narrative (highest-order story): ${state.storyHighestOrder || 'Not set'}
2. Your Story (past, present, future wishes): ${state.storyYours || 'Not set'}
3. Current Goals (immediate sub-stories): ${state.storySubStories || state.currentGoal || 'Not set'}

Core values: ${state.coreValues.join(', ') || 'None'}
Cognitive/personality profile: ${profilePrompt}
App mode: ${state.appMode || 'average'}

Describe the effective filter these rules produce.`.trim(),
    });

    if (!response || (!response.plainSummary && !response.headline)) {
      return fallback;
    }

    return {
      ...fallback,
      headline: normalizeText(response.headline) || fallback.headline,
      dominantLayer: response.dominantLayer
        ? (STORY_LAYERS.find((l) => l.label === normalizeText(response.dominantLayer))
            ? { id: STORY_LAYERS.find((l) => l.label === normalizeText(response.dominantLayer)).id, label: normalizeText(response.dominantLayer) }
            : fallback.dominantLayer)
        : fallback.dominantLayer,
      amplify: Array.isArray(response.amplify) && response.amplify.length
        ? response.amplify.map((x) => normalizeText(x)).filter(Boolean).slice(0, 10)
        : fallback.amplify,
      suppress: Array.isArray(response.suppress) && response.suppress.length
        ? response.suppress.map((x) => normalizeText(x)).filter(Boolean).slice(0, 10)
        : fallback.suppress,
      sourcePosture: normalizeText(response.sourcePosture) || fallback.sourcePosture,
      cognitiveTilt: normalizeText(response.cognitiveTilt) || fallback.cognitiveTilt,
      plainSummary: normalizeText(response.plainSummary) || fallback.plainSummary,
      source: 'ai',
    };
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  ensureTables,
  getState,
  upsertState,
  updateUserGoal,
  updateStories,
  analyzeSelfData,
  generateLabsResearch,
  buildFinalInterpretation,
  syncDigitalFootprint,
  importDigitalFootprint,
  computeHierarchyAlignment,
  summarizeStoryLayerAlignment,
  evaluateContentAgainstHierarchy,
  __test__: {
    aggregateHistoryEntries,
    buildFootprintHeuristic,
    computeStoryLayerScore,
    importDigitalFootprint,
    normalizeContentInput,
    overlapScore,
    sharedTokens,
    tokenize,
  },
};
