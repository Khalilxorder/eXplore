const crypto = require('crypto');
const aiService = require('../../services/aiService');

const DEFAULT_USER_ID = 'user_1';
const LOCKED_RATIO = 0.2;
const MAX_RULES = 24;
const EMBEDDING_MERGE_THRESHOLD = 0.82;
const LEXICAL_MERGE_THRESHOLD = 0.34;
const DEFAULT_HIERARCHY_WEIGHT = 0.12;
const MAX_TEMPLATE_RULE_EMBEDDING_COMPARISONS = Math.max(
  0,
  Math.min(Number(process.env.TEMPLATE_RULE_EMBEDDING_BUDGET || 4), 12)
);

const DEFAULT_FIXED_RULES = [
  {
    id: 'hb_signal_only',
    title: 'Signal over noise',
    description: 'Reject spectacle, gossip, vanity, and repetition unless they clearly change reality.',
    weight: 100,
    locked: true,
  },
  {
    id: 'hb_life_relevance',
    title: 'Life trajectory first',
    description: 'Prioritize news that affects my decisions, values, safety, opportunities, or long-term direction.',
    weight: 96,
    locked: true,
  },
  {
    id: 'hb_meaning_visuals',
    title: 'Meaning only visuals',
    description: 'Any visual summary must depict only the essential meaning of the news with nothing decorative or invented.',
    weight: 92,
    locked: true,
  },
  {
    id: 'hb_hawk_rule',
    title: 'Sharp-edged focus',
    description: 'Digest toward what matters most and cut away anything weak, blurry, or non-essential, like a hawk locking onto prey.',
    weight: 90,
    locked: true,
  },
];

const DEFAULT_ADAPTIVE_RULES = [
  {
    id: 'ar_decision_leverage',
    title: 'Decision leverage',
    description: 'Prefer developments that change what I should do next, not just what is interesting to know.',
    weight: 86,
    keywords: ['decision', 'action', 'leverage', 'change'],
    locked: false,
  },
  {
    id: 'ar_hidden_signal',
    title: 'Hidden signal',
    description: 'Elevate patterns and under-covered shifts before they become obvious everywhere else.',
    weight: 82,
    keywords: ['hidden', 'signal', 'undercovered', 'pattern'],
    locked: false,
  },
  {
    id: 'ar_real_world_consequence',
    title: 'Real-world consequence',
    description: 'Push stories with practical consequences above stories that are only symbolic drama.',
    weight: 79,
    keywords: ['consequence', 'practical', 'real world'],
    locked: false,
  },
];

const DEFAULT_SOURCE_MIX = {
  written: 52,
  socialVideo: 30,
  socialPhoto: 18,
};

const DEFAULT_VISUAL_SUMMARY = {
  enabled: true,
  label: 'Meaning Sketch',
  iconNameStyle: '3-5 words, meaning first',
  prompt: 'Create a minimal visual that shows only the essential meaning of the news. Remove decoration, branding, jokes, extra objects, and emotional exaggeration.',
};

const DEFAULT_TEMPLATE_ROOT = {
  name: 'Template',
  objective: 'Filter the news down to what truly matters for my life, direction, and decision-making.',
  higherOrderRule: 'Be a sharp-edged hawk on its prey: lock onto the signal, strip away noise, and keep only what matters.',
  fixedRules: DEFAULT_FIXED_RULES,
};

const DEFAULT_WATCH_QUESTIONS = [
  'Which AI releases actually change what I can use or do?',
  'Which war updates between Israel and Iran change real risk?',
  'Which updates change my decisions, safety, money, or access?',
];

const DEFAULT_BRIEFING_STYLE = [
  'Use short direct titles.',
  'Write in plain language with no hype.',
  'Explain why it matters in one clear sentence.',
  'Leave out filler and repeated context.',
];

const TRACKED_COMPANY_ALIASES = {
  claude: 'anthropic',
  anthropic: 'anthropic',
  chatgpt: 'openai',
  gpt: 'openai',
  openai: 'openai',
  gemini: 'google',
  deepmind: 'google',
  google: 'google',
  grok: 'xai',
  xai: 'xai',
  'x.ai': 'xai',
};

const TRACKED_COMPANY_LABELS = {
  anthropic: 'Anthropic / Claude',
  openai: 'OpenAI / ChatGPT',
  google: 'Gemini / DeepMind',
  xai: 'Grok / xAI',
};

const DEFAULT_WORKSPACE_MEMORY = {
  priorityTopics: ['AI releases', 'Iran / regional risk', 'Mohammed bin Rashid leadership', 'Dario Amodei writings and articles', 'Mohammed bin Rashid videos and leadership', 'Sheikh Mohammed bin Rashid Al Maktoum', 'Dario Amodei'],
  avoidTopics: ['Celebrity AI chatter', 'Hype', 'Repeated context'],
  trackedCompanies: ['anthropic', 'openai', 'google', 'xai'],
  peopleOfInterest: ['Sheikh Mohammed bin Rashid Al Maktoum | Dubai leader; UAE Prime Minister; official statement; leadership; personality; governance; innovation', 'Dario Amodei'],
  videoLibrary: {
    creators: ['mohammed-bin-rashid', 'dario-amodei', 'jordan-peterson', 'steve-jobs', 'niles-hollowell-dhar'],
    categories: ['distinctive', 'interview', 'lecture', 'performance', 'keynote'],
    inlinePlayback: true,
  },
  referenceSignals: [],
  highPriorityProfile: {
    enabled: true,
    summary: 'Major AI tool releases, Iran war relation to Jordan and the world, and very important political events stay in the high-priority lane.',
    priorityTopics: [
      'Major AI tool releases',
      'Iran war relation to Jordan and the world',
      'Very important political events',
      'Mohammed bin Rashid leadership and personality',
      'Dario Amodei writings and articles',
      'Mohammed bin Rashid videos and leadership',
    ],
    aiReleasePhrases: [
      'Major AI tool releases',
      'Important AI notes',
    ],
    geoPhrases: [
      'Iran war relation to Jordan and the world',
    ],
    politicalPhrases: [
      'Very important political events',
    ],
    releaseWatchCompanies: ['anthropic', 'openai', 'google', 'xai'],
    minImportance: 'important',
  },
  sourcePreferences: {
    officialFirst: true,
    written: true,
    socialVideo: true,
    socialPhoto: false,
    trustedSourcesOnly: true,
  },
  alertStyle: 'strict',
};

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

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function toSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWeight(value, fallback = 60) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 1, 100) : fallback;
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean)
    .slice(0, 12))];
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source
    .map((entry) => normalizeText(entry))
    .filter(Boolean))]
    .slice(0, 24);
}

function normalizeHierarchyWeight(value, fallback = DEFAULT_HIERARCHY_WEIGHT) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 0.25) : fallback;
}

function createRuleId(prefix, title, fallbackIndex = 0) {
  const base = toSlug(title);
  return base ? `${prefix}_${base}` : `${prefix}_${fallbackIndex + 1}`;
}

function normalizeRule(rule, index = 0, locked = false) {
  const title = normalizeText(rule?.title, `Rule ${index + 1}`);
  return {
    id: normalizeText(rule?.id, createRuleId(locked ? 'hb' : 'ar', title, index)),
    title,
    description: normalizeText(rule?.description, title),
    weight: normalizeWeight(rule?.weight, locked ? 90 : 60),
    keywords: normalizeKeywords(rule?.keywords),
    locked,
  };
}

function normalizeRuleList(rules, locked = false, fallback = []) {
  const sourceRules = Array.isArray(rules) && rules.length ? rules : fallback;
  return sourceRules.map((rule, index) => normalizeRule(rule, index, locked));
}

function normalizeSourceMix(value) {
  const mix = {
    written: clamp(Number(value?.written) || DEFAULT_SOURCE_MIX.written, 0, 100),
    socialVideo: clamp(Number(value?.socialVideo) || DEFAULT_SOURCE_MIX.socialVideo, 0, 100),
    socialPhoto: clamp(Number(value?.socialPhoto) || DEFAULT_SOURCE_MIX.socialPhoto, 0, 100),
  };

  const total = mix.written + mix.socialVideo + mix.socialPhoto || 1;
  const written = Math.round((mix.written / total) * 100);
  const socialVideo = Math.round((mix.socialVideo / total) * 100);

  return {
    written,
    socialVideo,
    socialPhoto: 100 - written - socialVideo,
  };
}

function normalizeVisualSummary(value) {
  return {
    enabled: value?.enabled !== false,
    label: normalizeText(value?.label, DEFAULT_VISUAL_SUMMARY.label),
    iconNameStyle: normalizeText(value?.iconNameStyle, DEFAULT_VISUAL_SUMMARY.iconNameStyle),
    prompt: normalizeText(value?.prompt, DEFAULT_VISUAL_SUMMARY.prompt),
  };
}

function normalizeTrackedCompanies(value, fallback = DEFAULT_WORKSPACE_MEMORY.trackedCompanies) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = [];

  for (const entry of source) {
    const raw = normalizeText(entry).toLowerCase();
    const key = TRACKED_COMPANY_ALIASES[raw] || raw;
    if (!key || !TRACKED_COMPANY_LABELS[key] || normalized.includes(key)) {
      continue;
    }
    normalized.push(key);
  }

  return normalized.length ? normalized : [...fallback];
}

function normalizePeopleOfInterest(value, fallback = DEFAULT_WORKSPACE_MEMORY.peopleOfInterest) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source
    .map((entry) => normalizeText(entry))
    .filter(Boolean))]
    .slice(0, 24);
}

function normalizeSourcePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    officialFirst: source.officialFirst !== false,
    written: source.written !== false,
    socialVideo: source.socialVideo !== false,
    socialPhoto: Boolean(source.socialPhoto),
    trustedSourcesOnly: source.trustedSourcesOnly !== false,
  };
}

function normalizeAlertStyle(value, fallback = DEFAULT_WORKSPACE_MEMORY.alertStyle) {
  const normalized = normalizeText(value, fallback).toLowerCase();
  return ['strict', 'balanced', 'broad'].includes(normalized) ? normalized : fallback;
}

function normalizeVideoLibraryCreators(value, fallback = DEFAULT_WORKSPACE_MEMORY.videoLibrary.creators) {
  const source = Array.isArray(value) ? value : fallback;
  const allowed = new Set(DEFAULT_WORKSPACE_MEMORY.videoLibrary.creators);
  const normalized = [...new Set(source
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter((entry) => allowed.has(entry)))];

  return normalized.length ? normalized : [...fallback];
}

function normalizeVideoLibraryCategories(value, fallback = DEFAULT_WORKSPACE_MEMORY.videoLibrary.categories) {
  const source = Array.isArray(value) ? value : fallback;
  const allowed = new Set(DEFAULT_WORKSPACE_MEMORY.videoLibrary.categories);
  const normalized = [...new Set(source
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter((entry) => allowed.has(entry)))];

  return normalized.length ? normalized : [...fallback];
}

function normalizeVideoLibraryPreferences(value, fallback = DEFAULT_WORKSPACE_MEMORY.videoLibrary) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    creators: normalizeVideoLibraryCreators(source.creators, fallback.creators),
    categories: normalizeVideoLibraryCategories(source.categories, fallback.categories),
    inlinePlayback: source.inlinePlayback !== false,
  };
}

function normalizeHighPriorityProfile(value, fallback = DEFAULT_WORKSPACE_MEMORY.highPriorityProfile) {
  const source = value && typeof value === 'object' ? value : fallback;
  const minImportance = ['important', 'major'].includes(normalizeText(source.minImportance, fallback.minImportance).toLowerCase())
    ? normalizeText(source.minImportance, fallback.minImportance).toLowerCase()
    : fallback.minImportance;

  return {
    enabled: source.enabled !== false,
    summary: normalizeText(source.summary, fallback.summary),
    priorityTopics: normalizeStringList(source.priorityTopics || source.phrases, fallback.priorityTopics),
    aiReleasePhrases: normalizeStringList(source.aiReleasePhrases, fallback.aiReleasePhrases),
    geoPhrases: normalizeStringList(source.geoPhrases, fallback.geoPhrases),
    politicalPhrases: normalizeStringList(source.politicalPhrases, fallback.politicalPhrases),
    releaseWatchCompanies: normalizeTrackedCompanies(
      source.releaseWatchCompanies || source.trackedCompanies,
      fallback.releaseWatchCompanies,
    ),
    minImportance,
    triggerSignals: normalizeStringList(source.triggerSignals, fallback.triggerSignals || []),
  };
}

function normalizeWorkspaceMemory(value, fallback = DEFAULT_WORKSPACE_MEMORY) {
  const source = value && typeof value === 'object' ? value : fallback;
  const highPriorityProfile = normalizeHighPriorityProfile(
    source.highPriorityProfile,
    fallback.highPriorityProfile || DEFAULT_WORKSPACE_MEMORY.highPriorityProfile,
  );
  return {
    priorityTopics: normalizeStringList(
      [
        ...(Array.isArray(source.priorityTopics) ? source.priorityTopics : []),
        ...(highPriorityProfile.priorityTopics || []),
      ],
      [
        ...(Array.isArray(fallback.priorityTopics) ? fallback.priorityTopics : []),
        ...(highPriorityProfile.priorityTopics || []),
      ],
    ),
    avoidTopics: normalizeStringList(source.avoidTopics, fallback.avoidTopics),
    trackedCompanies: normalizeTrackedCompanies(source.trackedCompanies, fallback.trackedCompanies),
    peopleOfInterest: normalizePeopleOfInterest(source.peopleOfInterest, fallback.peopleOfInterest),
    videoLibrary: normalizeVideoLibraryPreferences(source.videoLibrary, fallback.videoLibrary || DEFAULT_WORKSPACE_MEMORY.videoLibrary),
    referenceSignals: normalizeStringList(
      [
        ...(Array.isArray(source.referenceSignals) ? source.referenceSignals : []),
        ...(highPriorityProfile.triggerSignals || []),
        ...(highPriorityProfile.aiReleasePhrases || []),
        ...(highPriorityProfile.geoPhrases || []),
        ...(highPriorityProfile.politicalPhrases || []),
      ],
      [
        ...(Array.isArray(fallback.referenceSignals) ? fallback.referenceSignals : []),
        ...(highPriorityProfile.triggerSignals || []),
      ],
    ),
    highPriorityProfile,
    sourcePreferences: normalizeSourcePreferences(source.sourcePreferences),
    alertStyle: normalizeAlertStyle(source.alertStyle, fallback.alertStyle),
  };
}

function detectTrackedCompaniesFromText(...values) {
  const text = values.join(' ').toLowerCase();
  return Object.keys(TRACKED_COMPANY_LABELS).filter((companyKey) => {
    if (companyKey === 'anthropic') {
      return /\banthropic\b|\bclaude\b/i.test(text);
    }
    if (companyKey === 'openai') {
      return /\bopenai\b|\bgpt\b|\bchatgpt\b/i.test(text);
    }
    if (companyKey === 'google') {
      return /\bgemini\b|\bdeepmind\b|\bgoogle\s+ai\b|\bgoogle\b/i.test(text);
    }
    if (companyKey === 'xai') {
      return /\bgrok\b|\bxai\b|\bx\.ai\b/i.test(text);
    }
    return false;
  });
}

function inferHighPriorityProfileFromText(baseProfile = DEFAULT_WORKSPACE_MEMORY.highPriorityProfile, ...values) {
  const mergedText = values.join(' ');
  const lowerText = mergedText.toLowerCase();
  const priorityTopics = [];
  const aiReleasePhrases = [];
  const geoPhrases = [];
  const politicalPhrases = [];
  const triggerSignals = [];

  if (/\b(ai|model|models|tool|tools|api|release|launch|update|feature|announcement|note)\b/i.test(lowerText)) {
    priorityTopics.push('Major AI tool releases');
    aiReleasePhrases.push('Major AI tool releases');
    triggerSignals.push('Major AI tool releases');
  }

  if (/\b(important note|important notes|critical note|critical notes|major note|major notes)\b/i.test(lowerText)) {
    aiReleasePhrases.push('Important AI notes');
    triggerSignals.push('Important AI notes');
  }

  if (/\b(iran|jordan|world|war|conflict|risk|escalat)\b/i.test(lowerText)) {
    priorityTopics.push('Iran war relation to Jordan and the world');
    geoPhrases.push('Iran war relation to Jordan and the world');
    triggerSignals.push('Iran / Jordan / world risk');
  }

  if (/\b(politic|political|government|election|policy|parliament|minister|diplomacy|summit|assassination|death|leader)\b/i.test(lowerText)) {
    priorityTopics.push('Very important political events');
    politicalPhrases.push('Very important political events');
    triggerSignals.push('Very important political events');
  }

  const releaseWatchCompanies = detectTrackedCompaniesFromText(mergedText);
  const summaryParts = [];

  if (aiReleasePhrases.length) {
    summaryParts.push('major AI tool releases');
  }
  if (geoPhrases.length) {
    summaryParts.push('Iran / Jordan / world risk');
  }
  if (politicalPhrases.length) {
    summaryParts.push('very important political events');
  }

  return normalizeHighPriorityProfile({
    ...baseProfile,
    enabled: true,
    summary: summaryParts.length
      ? `High priority on ${summaryParts.join(', ')}.`
      : baseProfile.summary,
    priorityTopics: [
      ...(baseProfile.priorityTopics || []),
      ...priorityTopics,
    ],
    aiReleasePhrases: [
      ...(baseProfile.aiReleasePhrases || []),
      ...aiReleasePhrases,
    ],
    geoPhrases: [
      ...(baseProfile.geoPhrases || []),
      ...geoPhrases,
    ],
    politicalPhrases: [
      ...(baseProfile.politicalPhrases || []),
      ...politicalPhrases,
    ],
    releaseWatchCompanies: releaseWatchCompanies.length
      ? releaseWatchCompanies
      : (baseProfile.releaseWatchCompanies || DEFAULT_WORKSPACE_MEMORY.highPriorityProfile.releaseWatchCompanies),
    minImportance: baseProfile.minImportance || DEFAULT_WORKSPACE_MEMORY.highPriorityProfile.minImportance,
    triggerSignals: [
      ...(baseProfile.triggerSignals || []),
      ...triggerSignals,
    ],
  }, baseProfile);
}

function inferWorkspaceMemoryFromText(baseMemory = DEFAULT_WORKSPACE_MEMORY, ...values) {
  const mergedText = values.join(' ');
  const trackedCompanies = detectTrackedCompaniesFromText(mergedText);
  const priorityTopics = [];
  const avoidTopics = [];

  if (/\bai\b|\brelease\b|\bmodel\b|\btool\b|\bapi\b/i.test(mergedText)) {
    priorityTopics.push('AI releases');
  }
  if (/\biran\b|\bregional\b|\bqatar\b|\bescalat/i.test(mergedText)) {
    priorityTopics.push('Iran / regional risk');
  }
  if (/\b(politic|political|government|election|policy|parliament|minister|diplomacy|summit|assassination|death|leader)\b/i.test(mergedText)) {
    priorityTopics.push('Very important political events');
  }
  if (/\bdecision\b|\bpractical\b|\buse\b|\bbuild\b/i.test(mergedText)) {
    priorityTopics.push('Practical decision impact');
  }
  if (/\bhype\b|\bfluff\b|\bgossip\b|\bcelebrity\b/i.test(mergedText)) {
    avoidTopics.push('Hype');
  }
  if (/\brepeated\b|\bfiller\b|\bbackground\b/i.test(mergedText)) {
    avoidTopics.push('Repeated context');
  }

  return normalizeWorkspaceMemory({
    ...baseMemory,
    priorityTopics: [...(baseMemory.priorityTopics || []), ...priorityTopics],
    avoidTopics: [...(baseMemory.avoidTopics || []), ...avoidTopics],
    trackedCompanies: trackedCompanies.length ? trackedCompanies : baseMemory.trackedCompanies,
    peopleOfInterest: baseMemory.peopleOfInterest || DEFAULT_WORKSPACE_MEMORY.peopleOfInterest,
    referenceSignals: baseMemory.referenceSignals || DEFAULT_WORKSPACE_MEMORY.referenceSignals,
    highPriorityProfile: inferHighPriorityProfileFromText(
      baseMemory.highPriorityProfile || DEFAULT_WORKSPACE_MEMORY.highPriorityProfile,
      mergedText,
    ),
    alertStyle: /\bexact\b|\bstrict\b|\bofficial\b|\brelease only\b/i.test(mergedText)
      ? 'strict'
      : /\bbroad\b|\bwider\b|\bmore\b/i.test(mergedText)
        ? 'broad'
        : baseMemory.alertStyle,
  }, baseMemory);
}

function tokenize(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter((token) => !['that', 'with', 'from', 'this', 'have', 'your', 'about', 'into', 'when', 'there', 'should', 'would'].includes(token)))];
}

function scoreOverlap(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(leftTokens.length, rightTokens.length);
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length || left.length !== right.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += Number(left[index] || 0) * Number(right[index] || 0);
  }

  return sum;
}

function dedupeAdaptiveRules(rules) {
  const merged = new Map();

  for (const rule of rules) {
    const normalized = normalizeRule(rule, 0, false);
    const key = toSlug(normalized.title) || normalized.id;

    if (!merged.has(key)) {
      merged.set(key, normalized);
      continue;
    }

    const current = merged.get(key);
    const descriptions = [current.description, normalized.description].filter(Boolean);
    const nextDescription = descriptions.length === 2 && descriptions[0] !== descriptions[1]
      ? `${descriptions[0]} ${descriptions[1]}`
      : descriptions[0] || normalized.title;

    merged.set(key, {
      ...current,
      description: nextDescription.trim(),
      weight: clamp(Math.round((current.weight + normalized.weight) / 2 + 2), 1, 100),
      keywords: [...new Set([...current.keywords, ...normalized.keywords])].slice(0, 12),
      locked: false,
    });
  }

  return [...merged.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_RULES);
}

function getDefaultAdaptivePayload() {
  return {
    adaptiveRules: normalizeRuleList(DEFAULT_ADAPTIVE_RULES, false, DEFAULT_ADAPTIVE_RULES),
    sourceMix: normalizeSourceMix(DEFAULT_SOURCE_MIX),
    visualSummary: normalizeVisualSummary(DEFAULT_VISUAL_SUMMARY),
  };
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      fixed_boundary_ratio REAL DEFAULT 0.2,
      active_version_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_news_templates_user_id
      ON news_templates(user_id);

    CREATE TABLE IF NOT EXISTS news_template_versions (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES news_templates(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      created_from TEXT DEFAULT 'manual',
      change_summary TEXT,
      objective_text TEXT NOT NULL,
      prioritization_text TEXT NOT NULL,
      hard_boundaries_json TEXT NOT NULL,
      adaptive_rules_json TEXT NOT NULL,
      source_mix_json TEXT NOT NULL,
      visual_summary_json TEXT NOT NULL,
      workspace_memory_json TEXT,
      conversation_excerpt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_news_template_versions_template_id
      ON news_template_versions(template_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS news_template_messages (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES news_templates(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL,
      needs_clarification INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_news_template_messages_template_id
      ON news_template_messages(template_id, created_at DESC);
  `);

  ensureColumn(db, 'news_templates', 'objective_text', 'TEXT');
  ensureColumn(db, 'news_templates', 'higher_order_rule_text', 'TEXT');
  ensureColumn(db, 'news_templates', 'fixed_rules_json', 'TEXT');
  ensureColumn(db, 'news_templates', 'pending_clarification_json', 'TEXT');
  ensureColumn(db, 'news_templates', 'hierarchy_weight', `REAL DEFAULT ${DEFAULT_HIERARCHY_WEIGHT}`);
  ensureColumn(db, 'news_templates', 'watch_questions_json', 'TEXT');
  ensureColumn(db, 'news_templates', 'briefing_style_json', 'TEXT');
  ensureColumn(db, 'news_templates', 'workspace_memory_json', 'TEXT');
  ensureColumn(db, 'news_template_versions', 'workspace_memory_json', 'TEXT');
}

function getTemplateRow(db, userId = DEFAULT_USER_ID) {
  return db.prepare(`
    SELECT *
    FROM news_templates
    WHERE user_id = ?
    LIMIT 1
  `).get(userId);
}

function getActiveVersionRow(db, template) {
  if (!template) {
    return null;
  }

  if (template.active_version_id) {
    const activeRow = db.prepare(`
      SELECT *
      FROM news_template_versions
      WHERE id = ?
      LIMIT 1
    `).get(template.active_version_id);

    if (activeRow) {
      return activeRow;
    }
  }

  return db.prepare(`
    SELECT *
    FROM news_template_versions
    WHERE template_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `).get(template.id);
}

function getVersionRows(db, templateId, limit = 12) {
  return db.prepare(`
    SELECT *
    FROM news_template_versions
    WHERE template_id = ?
    ORDER BY version_number DESC
    LIMIT ?
  `).all(templateId, limit);
}

function getMessageRows(db, templateId, limit = 14) {
  return db.prepare(`
    SELECT *
    FROM news_template_messages
    WHERE template_id = ?
    ORDER BY rowid DESC
    LIMIT ?
  `).all(templateId, limit).reverse();
}

function insertMessage(db, templateId, role, content, confidence = 1, needsClarification = false) {
  db.prepare(`
    INSERT INTO news_template_messages (
      id, template_id, role, content, confidence, needs_clarification
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    templateId,
    role,
    normalizeText(content),
    clamp(Number(confidence) || 0, 0, 1),
    needsClarification ? 1 : 0,
  );
}

function mapMessageRow(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    confidence: Number(row.confidence ?? 0),
    needsClarification: Boolean(row.needs_clarification),
    createdAt: row.created_at,
  };
}

function mapTemplateRoot(template, fallbackRoot = DEFAULT_TEMPLATE_ROOT) {
  return {
    id: template.id,
    userId: template.user_id,
    name: normalizeText(template.name, fallbackRoot.name),
    objective: normalizeText(template.objective_text, fallbackRoot.objective),
    higherOrderRule: normalizeText(template.higher_order_rule_text, fallbackRoot.higherOrderRule),
    prioritizationRule: normalizeText(template.higher_order_rule_text, fallbackRoot.higherOrderRule),
    fixedBoundaryRatio: Number(template.fixed_boundary_ratio || LOCKED_RATIO),
    hierarchyWeight: normalizeHierarchyWeight(template.hierarchy_weight, DEFAULT_HIERARCHY_WEIGHT),
    fixedRules: normalizeRuleList(parseJson(template.fixed_rules_json, fallbackRoot.fixedRules), true, fallbackRoot.fixedRules),
    watchQuestions: normalizeWatchQuestions(parseJson(template.watch_questions_json, DEFAULT_WATCH_QUESTIONS), DEFAULT_WATCH_QUESTIONS),
    briefingStyle: normalizeBriefingStyle(parseJson(template.briefing_style_json, DEFAULT_BRIEFING_STYLE), DEFAULT_BRIEFING_STYLE),
    workspaceMemory: normalizeWorkspaceMemory(parseJson(template.workspace_memory_json, DEFAULT_WORKSPACE_MEMORY), DEFAULT_WORKSPACE_MEMORY),
    activeVersionId: template.active_version_id,
    pendingClarification: parseJson(template.pending_clarification_json, null),
    createdAt: template.created_at,
    updatedAt: template.updated_at,
  };
}

function mapVersionRow(row, templateRoot = DEFAULT_TEMPLATE_ROOT) {
  if (!row) {
    return null;
  }

  const adaptiveRules = dedupeAdaptiveRules(
    normalizeRuleList(parseJson(row.adaptive_rules_json, DEFAULT_ADAPTIVE_RULES), false, DEFAULT_ADAPTIVE_RULES)
  );

  return {
    id: row.id,
    versionNumber: row.version_number,
    createdFrom: row.created_from,
    changeSummary: row.change_summary || '',
    objective: templateRoot.objective,
    prioritizationRule: templateRoot.higherOrderRule,
    higherOrderRule: templateRoot.higherOrderRule,
    adaptiveRules,
    sourceMix: normalizeSourceMix(parseJson(row.source_mix_json, DEFAULT_SOURCE_MIX)),
    visualSummary: normalizeVisualSummary(parseJson(row.visual_summary_json, DEFAULT_VISUAL_SUMMARY)),
    workspaceMemory: normalizeWorkspaceMemory(parseJson(row.workspace_memory_json, templateRoot.workspaceMemory || DEFAULT_WORKSPACE_MEMORY), templateRoot.workspaceMemory || DEFAULT_WORKSPACE_MEMORY),
    conversationExcerpt: row.conversation_excerpt || '',
    createdAt: row.created_at,
  };
}

function updateTemplateRoot(db, templateId, updates = {}) {
  const sets = [];
  const values = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(normalizeText(updates.name, DEFAULT_TEMPLATE_ROOT.name));
  }

  if (updates.objective !== undefined) {
    sets.push('objective_text = ?');
    values.push(normalizeText(updates.objective, DEFAULT_TEMPLATE_ROOT.objective));
  }

  if (updates.higherOrderRule !== undefined) {
    sets.push('higher_order_rule_text = ?');
    values.push(normalizeText(updates.higherOrderRule, DEFAULT_TEMPLATE_ROOT.higherOrderRule));
  }

  if (updates.fixedRules !== undefined) {
    sets.push('fixed_rules_json = ?');
    values.push(JSON.stringify(normalizeRuleList(updates.fixedRules, true, DEFAULT_FIXED_RULES)));
  }

  if (updates.watchQuestions !== undefined) {
    sets.push('watch_questions_json = ?');
    values.push(JSON.stringify(normalizeWatchQuestions(updates.watchQuestions, DEFAULT_WATCH_QUESTIONS)));
  }

  if (updates.briefingStyle !== undefined) {
    sets.push('briefing_style_json = ?');
    values.push(JSON.stringify(normalizeBriefingStyle(updates.briefingStyle, DEFAULT_BRIEFING_STYLE)));
  }

  if (updates.workspaceMemory !== undefined) {
    sets.push('workspace_memory_json = ?');
    values.push(JSON.stringify(normalizeWorkspaceMemory(updates.workspaceMemory, DEFAULT_WORKSPACE_MEMORY)));
  }

  if (updates.pendingClarification !== undefined) {
    sets.push('pending_clarification_json = ?');
    values.push(updates.pendingClarification ? JSON.stringify(updates.pendingClarification) : null);
  }

  if (updates.hierarchyWeight !== undefined) {
    sets.push('hierarchy_weight = ?');
    values.push(normalizeHierarchyWeight(updates.hierarchyWeight));
  }

  if (updates.activeVersionId !== undefined) {
    sets.push('active_version_id = ?');
    values.push(updates.activeVersionId);
  }

  if (!sets.length) {
    return;
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(templateId);

  db.prepare(`
    UPDATE news_templates
    SET ${sets.join(', ')}
    WHERE id = ?
  `).run(...values);
}

function createVersion(db, templateRoot, payload, meta = {}) {
  const latestRow = db.prepare(`
    SELECT version_number
    FROM news_template_versions
    WHERE template_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `).get(templateRoot.id);

  const versionNumber = (latestRow?.version_number || 0) + 1;
  const versionId = crypto.randomUUID();
  const normalizedPayload = {
    adaptiveRules: dedupeAdaptiveRules(normalizeRuleList(payload.adaptiveRules, false, DEFAULT_ADAPTIVE_RULES)),
    sourceMix: normalizeSourceMix(payload.sourceMix),
    visualSummary: normalizeVisualSummary(payload.visualSummary),
  };

  db.prepare(`
    INSERT INTO news_template_versions (
      id,
      template_id,
      version_number,
      created_from,
      change_summary,
      objective_text,
      prioritization_text,
      hard_boundaries_json,
      adaptive_rules_json,
      source_mix_json,
      visual_summary_json,
      workspace_memory_json,
      conversation_excerpt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    templateRoot.id,
    versionNumber,
    meta.createdFrom || 'manual',
    meta.changeSummary || '',
    normalizeText(templateRoot.objective, DEFAULT_TEMPLATE_ROOT.objective),
    normalizeText(templateRoot.higherOrderRule, DEFAULT_TEMPLATE_ROOT.higherOrderRule),
    JSON.stringify(normalizeRuleList(templateRoot.fixedRules, true, DEFAULT_FIXED_RULES)),
    JSON.stringify(normalizedPayload.adaptiveRules),
    JSON.stringify(normalizedPayload.sourceMix),
    JSON.stringify(normalizedPayload.visualSummary),
    JSON.stringify(normalizeWorkspaceMemory(templateRoot.workspaceMemory, DEFAULT_WORKSPACE_MEMORY)),
    meta.conversationExcerpt || '',
  );

  updateTemplateRoot(db, templateRoot.id, {
    activeVersionId: versionId,
    pendingClarification: null,
  });

  return db.prepare(`
    SELECT *
    FROM news_template_versions
    WHERE id = ?
    LIMIT 1
  `).get(versionId);
}

function hydrateExistingTemplate(db, template) {
  const activeRow = getActiveVersionRow(db, template);
  const rootFallback = activeRow
    ? {
        name: template.name || DEFAULT_TEMPLATE_ROOT.name,
        objective: normalizeText(activeRow.objective_text, DEFAULT_TEMPLATE_ROOT.objective),
        higherOrderRule: normalizeText(activeRow.prioritization_text, DEFAULT_TEMPLATE_ROOT.higherOrderRule),
        fixedRules: normalizeRuleList(parseJson(activeRow.hard_boundaries_json, DEFAULT_FIXED_RULES), true, DEFAULT_FIXED_RULES),
      }
    : DEFAULT_TEMPLATE_ROOT;

  const needsHydration = !normalizeText(template.objective_text)
    || !normalizeText(template.higher_order_rule_text)
    || !normalizeText(template.fixed_rules_json)
    || !normalizeText(template.watch_questions_json)
    || !normalizeText(template.briefing_style_json);

  if (!needsHydration) {
    return;
  }

  updateTemplateRoot(db, template.id, {
    name: template.name || rootFallback.name,
    objective: rootFallback.objective,
    higherOrderRule: rootFallback.higherOrderRule,
    fixedRules: rootFallback.fixedRules,
    watchQuestions: DEFAULT_WATCH_QUESTIONS,
    briefingStyle: DEFAULT_BRIEFING_STYLE,
  });
}

function ensureDefaultTemplate(db, userId = DEFAULT_USER_ID) {
  ensureTables(db);

  let existing = getTemplateRow(db, userId);
  if (existing) {
    hydrateExistingTemplate(db, existing);
    return getTemplateRow(db, userId);
  }

  const templateId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO news_templates (
      id,
      user_id,
      name,
      fixed_boundary_ratio,
      hierarchy_weight,
      objective_text,
      higher_order_rule_text,
      fixed_rules_json,
      watch_questions_json,
      briefing_style_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    templateId,
    userId,
    DEFAULT_TEMPLATE_ROOT.name,
    LOCKED_RATIO,
    DEFAULT_HIERARCHY_WEIGHT,
    DEFAULT_TEMPLATE_ROOT.objective,
    DEFAULT_TEMPLATE_ROOT.higherOrderRule,
    JSON.stringify(normalizeRuleList(DEFAULT_TEMPLATE_ROOT.fixedRules, true, DEFAULT_FIXED_RULES)),
    JSON.stringify(DEFAULT_WATCH_QUESTIONS),
    JSON.stringify(DEFAULT_BRIEFING_STYLE),
  );

  existing = getTemplateRow(db, userId);
  const root = mapTemplateRoot(existing);
  const initialVersion = createVersion(db, root, getDefaultAdaptivePayload(), {
    createdFrom: 'seed',
    changeSummary: 'Initial hawk-style news template created.',
    conversationExcerpt: 'Initial default template seeded for the news view.',
  });

  updateTemplateRoot(db, templateId, { activeVersionId: initialVersion.id });

  insertMessage(
    db,
    templateId,
    'assistant',
    'Template initialized. The fixed 20% remains locked while the adaptive 80% can evolve with your notes.',
    1,
    false,
  );

  return getTemplateRow(db, userId);
}

function getTemplateState(db, userId = DEFAULT_USER_ID) {
  const template = ensureDefaultTemplate(db, userId);
  const templateRoot = mapTemplateRoot(template);
  const activeVersion = mapVersionRow(getActiveVersionRow(db, template), templateRoot);
  const versions = getVersionRows(db, template.id).map((row) => mapVersionRow(row, templateRoot));
  const messages = getMessageRows(db, template.id).map(mapMessageRow);

  return {
    template: templateRoot,
    fixedRules: templateRoot.fixedRules,
    higherOrderRule: templateRoot.higherOrderRule,
    hierarchyWeight: templateRoot.hierarchyWeight,
    objective: templateRoot.objective,
    workspace: {
      watchQuestions: templateRoot.watchQuestions,
      briefingStyle: templateRoot.briefingStyle,
      workspaceMemory: templateRoot.workspaceMemory,
    },
    pendingClarification: templateRoot.pendingClarification,
    activeVersion,
    adaptiveRules: activeVersion?.adaptiveRules || [],
    sourceMix: activeVersion?.sourceMix || getDefaultAdaptivePayload().sourceMix,
    visualSummary: activeVersion?.visualSummary || getDefaultAdaptivePayload().visualSummary,
    versions,
    messages,
    modelPool: aiService.getModelPoolStatus(),
  };
}

function updateTemplateConfig(db, userId = DEFAULT_USER_ID, updates = {}) {
  const template = ensureDefaultTemplate(db, userId);
  updateTemplateRoot(db, template.id, {
    hierarchyWeight: updates.hierarchyWeight,
  });
  return getTemplateState(db, userId);
}

async function saveWorkspaceDocuments(db, userId = DEFAULT_USER_ID, documents = {}) {
  const template = ensureDefaultTemplate(db, userId);
  const state = getTemplateState(db, userId);
  const watchQuestions = normalizeWatchQuestions(
    documents.watchQuestions ?? state.workspace.watchQuestions,
    state.workspace.watchQuestions,
  );
  const briefingStyle = normalizeBriefingStyle(
    documents.briefingStyle ?? state.workspace.briefingStyle,
    state.workspace.briefingStyle,
  );
  const workspaceMemory = normalizeWorkspaceMemory(
    documents.workspaceMemory ?? state.workspace.workspaceMemory,
    state.workspace.workspaceMemory || DEFAULT_WORKSPACE_MEMORY,
  );

  updateTemplateRoot(db, template.id, {
    watchQuestions,
    briefingStyle,
    workspaceMemory,
    pendingClarification: null,
  });

  const adaptiveRules = await mergeAdaptiveRules(
    state.adaptiveRules,
    watchQuestions.map((question, index) => ({
      id: createRuleId('ar', question, index),
      title: titleFromSentence(question, index),
      description: question,
      weight: 74,
      keywords: tokenize(question).slice(0, 8),
      locked: false,
    })),
  );

  createVersion(db, {
    id: template.id,
    objective: state.objective,
    higherOrderRule: state.higherOrderRule,
    fixedRules: state.fixedRules,
    workspaceMemory,
  }, {
    adaptiveRules,
    sourceMix: state.sourceMix,
    visualSummary: state.visualSummary,
  }, {
    createdFrom: 'workspace_edit',
    changeSummary: 'Updated the saved news questions and briefing style.',
    conversationExcerpt: `${watchQuestions.join(' ')} ${briefingStyle.join(' ')} ${workspaceMemory.priorityTopics.join(' ')} ${workspaceMemory.avoidTopics.join(' ')} ${(workspaceMemory.peopleOfInterest || []).join(' ')} ${(workspaceMemory.referenceSignals || []).join(' ')} ${(workspaceMemory.highPriorityProfile?.summary || '')} ${(workspaceMemory.highPriorityProfile?.priorityTopics || []).join(' ')}`.slice(0, 400),
  });

  insertMessage(
    db,
    template.id,
    'assistant',
    'Saved the editable news workspace and refreshed the ranking rules from it.',
    0.92,
    false,
  );

  return getTemplateState(db, userId);
}

function extractSentences(input) {
  return String(input || '')
    .split(/[\n\r]+|[.!?]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 6);
}

function titleFromSentence(sentence, fallbackIndex = 0) {
  const cleaned = sentence
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');

  return cleaned || `Rule ${fallbackIndex + 1}`;
}

function sentenceToQuestion(sentence, fallbackIndex = 0) {
  const cleaned = normalizeText(sentence);
  if (!cleaned) {
    return `What matters most ${fallbackIndex + 1}?`;
  }

  if (cleaned.endsWith('?')) {
    return cleaned;
  }

  const lower = cleaned.toLowerCase();
  if (lower.startsWith('which ') || lower.startsWith('what ') || lower.startsWith('how ') || lower.startsWith('when ') || lower.startsWith('where ') || lower.startsWith('who ')) {
    return `${cleaned}?`;
  }

  if (lower.startsWith('prioritize ') || lower.startsWith('watch ') || lower.startsWith('show ')) {
    return `What about ${cleaned.replace(/^(prioritize|watch|show)\s+/i, '')}?`;
  }

  return `What matters about ${cleaned.replace(/[.]+$/g, '')}?`;
}

function normalizeWatchQuestions(value, fallback = DEFAULT_WATCH_QUESTIONS) {
  return normalizeStringList(value, fallback)
    .map((entry, index) => sentenceToQuestion(entry, index))
    .slice(0, 24);
}

function normalizeBriefingStyle(value, fallback = DEFAULT_BRIEFING_STYLE) {
  return normalizeStringList(value, fallback)
    .map((entry) => {
      const cleaned = normalizeText(entry);
      return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
    })
    .slice(0, 24);
}

async function findBestRuleMatch(candidate, rules) {
  let bestMatch = { index: -1, lexical: 0, embedding: 0 };
  const candidateText = `${candidate.title} ${candidate.description} ${(candidate.keywords || []).join(' ')}`;

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const ruleText = `${rule.title} ${rule.description} ${(rule.keywords || []).join(' ')}`;
    const lexical = scoreOverlap(candidateText, ruleText);

    if (lexical > bestMatch.lexical) {
      bestMatch = { index, lexical, embedding: bestMatch.embedding };
    }

    if (lexical >= LEXICAL_MERGE_THRESHOLD) {
      return { ...bestMatch, index, lexical };
    }
  }

  try {
    const status = aiService.getSafeModelPoolDiagnostics();
    if (Number(status.availableKeyCount || 0) <= 2) {
      return bestMatch;
    }

    const candidateEmbedding = await aiService.generateEmbedding(candidateText, {
      providerPreference: 'gemini',
    });

    for (let index = 0; index < Math.min(rules.length, MAX_TEMPLATE_RULE_EMBEDDING_COMPARISONS); index += 1) {
      const rule = rules[index];
      const ruleText = `${rule.title} ${rule.description} ${(rule.keywords || []).join(' ')}`;
      const ruleEmbedding = await aiService.generateEmbedding(ruleText, {
        providerPreference: 'gemini',
      });
      const similarity = cosineSimilarity(candidateEmbedding, ruleEmbedding);

      if (similarity > bestMatch.embedding) {
        bestMatch = { index, lexical: bestMatch.lexical, embedding: similarity };
      }
    }
  } catch (error) {
    // Fall back to lexical-only merging when embeddings are unavailable.
  }

  return bestMatch;
}

async function mergeAdaptiveRules(existingRules, candidateRules) {
  const nextRules = dedupeAdaptiveRules(existingRules);

  for (const rawCandidate of candidateRules) {
    const candidate = normalizeRule(rawCandidate, nextRules.length, false);
    const bestMatch = await findBestRuleMatch(candidate, nextRules);
    const shouldMerge = bestMatch.lexical >= LEXICAL_MERGE_THRESHOLD || bestMatch.embedding >= EMBEDDING_MERGE_THRESHOLD;

    if (shouldMerge && bestMatch.index >= 0) {
      const existing = nextRules[bestMatch.index];
      const descriptions = [existing.description, candidate.description].filter(Boolean);
      const nextDescription = descriptions.length === 2 && descriptions[0] !== descriptions[1]
        ? `${descriptions[0]} ${candidate.description}`
        : descriptions[0] || candidate.description;

      nextRules[bestMatch.index] = {
        ...existing,
        description: normalizeText(nextDescription),
        weight: clamp(Math.round((existing.weight * 0.72) + (candidate.weight * 0.28) + 4), 1, 100),
        keywords: [...new Set([...existing.keywords, ...candidate.keywords])].slice(0, 12),
      };
      continue;
    }

    nextRules.push(candidate);
  }

  return dedupeAdaptiveRules(nextRules);
}

function buildHeuristicRefinement(state, userInput) {
  const sentences = extractSentences(userInput);
  if (sentences.length === 0) {
    return {
      needsClarification: true,
      confidence: 0.28,
      clarificationQuestion: 'What should the template push harder toward: life-changing decisions, long-term goals, or immediate practical news?',
      candidateRules: [],
    };
  }

  const lowerInput = String(userInput || '').toLowerCase();
  const sourceMix = { ...state.sourceMix };
  if (lowerInput.includes('written') || lowerInput.includes('article') || lowerInput.includes('news')) {
    sourceMix.written += 6;
  }
  if (lowerInput.includes('video') || lowerInput.includes('social media')) {
    sourceMix.socialVideo += 5;
  }
  if (lowerInput.includes('photo') || lowerInput.includes('image') || lowerInput.includes('visual')) {
    sourceMix.socialPhoto += 5;
  }

  const nextWatchQuestions = normalizeWatchQuestions([
    ...state.workspace.watchQuestions,
    ...sentences.slice(0, 4),
  ], state.workspace.watchQuestions);

  const nextBriefingStyle = normalizeBriefingStyle([
    ...state.workspace.briefingStyle,
    ...(lowerInput.includes('short') || lowerInput.includes('simple') ? ['Keep it short and simple'] : []),
    ...(lowerInput.includes('plain') ? ['Use plain language'] : []),
    ...(lowerInput.includes('why it matters') ? ['Always add one line for why it matters'] : []),
  ], state.workspace.briefingStyle);
  const workspaceMemory = inferWorkspaceMemoryFromText(
    state.workspace.workspaceMemory || DEFAULT_WORKSPACE_MEMORY,
    ...nextWatchQuestions,
    ...nextBriefingStyle,
    userInput,
  );

  return {
    needsClarification: false,
    confidence: 0.58,
    clarificationQuestion: '',
    templateName: state.template.name,
    changeSummary: 'Merged the latest note into the evolving template and rebalanced source emphasis.',
    objective: state.objective,
    higherOrderRule: state.higherOrderRule,
    sourceMix: normalizeSourceMix(sourceMix),
    visualSummary: state.visualSummary,
    watchQuestions: nextWatchQuestions,
    briefingStyle: nextBriefingStyle,
    workspaceMemory,
    candidateRules: sentences.map((sentence, index) => ({
      id: createRuleId('ar', sentence, index),
      title: titleFromSentence(sentence, index),
      description: sentence,
      weight: 72,
      keywords: tokenize(sentence).slice(0, 8),
      locked: false,
    })),
  };
}

function buildAiUserPrompt(state, userInput) {
  const recentMessages = state.messages.slice(-6).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return `
Current template root:
${JSON.stringify({
  name: state.template.name,
  objective: state.objective,
  higherOrderRule: state.higherOrderRule,
  fixedRules: state.fixedRules,
}, null, 2)}

Current adaptive version:
${JSON.stringify({
  adaptiveRules: state.adaptiveRules,
  sourceMix: state.sourceMix,
  visualSummary: state.visualSummary,
}, null, 2)}

Current editable workspace:
${JSON.stringify(state.workspace, null, 2)}

Pending clarification:
${JSON.stringify(state.pendingClarification, null, 2)}

Recent conversation:
${JSON.stringify(recentMessages, null, 2)}

Latest user message:
${userInput}
  `.trim();
}

const TEMPLATE_SYSTEM_PROMPT = `
You are designing a personal AI news template for a user who wants ruthless prioritization.

Rules for your output:
- The fixed 20% hard boundaries are immutable and must not be edited.
- Only propose adaptive rules for the flexible 80%.
- If the user is ambiguous, emotionally unclear, or under-specified, set "needsClarification" to true and ask one sharp follow-up question.
- Keep adaptive rule weights on a 1-100 scale.
- Source mix must cover written, socialVideo, and socialPhoto and sum to 100.
- The visual summary prompt must enforce meaning-only imagery with nothing decorative or invented.
- Return JSON only.

Return this shape:
{
  "needsClarification": boolean,
  "confidence": number,
  "clarificationQuestion": string,
  "templateName": string,
  "changeSummary": string,
  "objective": string,
  "higherOrderRule": string,
  "watchQuestions": [string],
  "briefingStyle": [string],
  "workspaceMemory": {
    "priorityTopics": [string],
    "avoidTopics": [string],
    "trackedCompanies": [string],
    "peopleOfInterest": [string],
    "referenceSignals": [string],
    "highPriorityProfile": {
      "enabled": boolean,
      "summary": string,
      "priorityTopics": [string],
      "aiReleasePhrases": [string],
      "geoPhrases": [string],
      "politicalPhrases": [string],
      "releaseWatchCompanies": [string],
      "minImportance": "important" | "major",
      "triggerSignals": [string]
    },
    "sourcePreferences": {
      "officialFirst": boolean,
      "written": boolean,
      "socialVideo": boolean,
      "socialPhoto": boolean,
      "trustedSourcesOnly": boolean
    },
    "alertStyle": "strict" | "balanced" | "broad"
  },
  "candidateRules": [{ "title": string, "description": string, "weight": number, "keywords": [string] }],
  "sourceMix": { "written": number, "socialVideo": number, "socialPhoto": number },
  "visualSummary": { "enabled": true, "label": string, "iconNameStyle": string, "prompt": string }
}
`.trim();

async function buildAiRefinement(state, userInput) {
  const response = await aiService.generateStructuredJson({
    systemPrompt: TEMPLATE_SYSTEM_PROMPT,
    userPrompt: buildAiUserPrompt(state, userInput),
    providerPreference: 'gemini',
    temperature: 0.2,
  });

  return {
    needsClarification: Boolean(response?.needsClarification),
    confidence: clamp(Number(response?.confidence) || 0.5, 0, 1),
    clarificationQuestion: normalizeText(response?.clarificationQuestion),
    templateName: normalizeText(response?.templateName, state.template.name || 'Template'),
    changeSummary: normalizeText(response?.changeSummary, 'AI refined the template based on the latest note.'),
    objective: normalizeText(response?.objective, state.objective),
    higherOrderRule: normalizeText(response?.higherOrderRule, state.higherOrderRule),
    watchQuestions: normalizeWatchQuestions(response?.watchQuestions || state.workspace.watchQuestions, state.workspace.watchQuestions),
    briefingStyle: normalizeBriefingStyle(response?.briefingStyle || state.workspace.briefingStyle, state.workspace.briefingStyle),
    workspaceMemory: (() => {
      const inferredWorkspaceMemory = inferWorkspaceMemoryFromText(
        state.workspace.workspaceMemory || DEFAULT_WORKSPACE_MEMORY,
        ...(response?.watchQuestions || state.workspace.watchQuestions),
        ...(response?.briefingStyle || state.workspace.briefingStyle),
        userInput,
      );
      const responseWorkspaceMemory = response?.workspaceMemory && typeof response.workspaceMemory === 'object'
        ? response.workspaceMemory
        : {};

      return normalizeWorkspaceMemory(
        {
          ...inferredWorkspaceMemory,
          ...responseWorkspaceMemory,
          highPriorityProfile: responseWorkspaceMemory.highPriorityProfile || inferredWorkspaceMemory.highPriorityProfile,
        },
        state.workspace.workspaceMemory || DEFAULT_WORKSPACE_MEMORY,
      );
    })(),
    sourceMix: normalizeSourceMix(response?.sourceMix || state.sourceMix),
    visualSummary: normalizeVisualSummary(response?.visualSummary || state.visualSummary),
    candidateRules: normalizeRuleList(response?.candidateRules, false, []),
  };
}

async function applyRefinement(state, refinement, userInput) {
  const adaptiveRules = await mergeAdaptiveRules(state.adaptiveRules, refinement.candidateRules);
  const nextRoot = {
    ...state.template,
    name: refinement.templateName || state.template.name,
    objective: refinement.objective || state.objective,
    higherOrderRule: refinement.higherOrderRule || state.higherOrderRule,
    fixedRules: state.fixedRules,
    watchQuestions: refinement.watchQuestions || state.workspace.watchQuestions,
    briefingStyle: refinement.briefingStyle || state.workspace.briefingStyle,
    workspaceMemory: refinement.workspaceMemory || state.workspace.workspaceMemory || DEFAULT_WORKSPACE_MEMORY,
  };

  return {
    root: nextRoot,
    adaptiveVersion: {
      adaptiveRules,
      sourceMix: refinement.sourceMix || state.sourceMix,
      visualSummary: refinement.visualSummary || state.visualSummary,
    },
    meta: {
      changeSummary: refinement.changeSummary,
      conversationExcerpt: normalizeText(userInput).slice(0, 400),
    },
  };
}

async function refineTemplate(db, userInput, userId = DEFAULT_USER_ID) {
  const state = getTemplateState(db, userId);
  const templateId = state.template.id;
  insertMessage(db, templateId, 'user', userInput, 1, false);

  let refinement;
  try {
    refinement = await buildAiRefinement(state, userInput);
  } catch (error) {
    refinement = buildHeuristicRefinement(state, userInput);
  }

  if (refinement.needsClarification || refinement.confidence < 0.45) {
    const question = refinement.clarificationQuestion || 'What should the template cut more aggressively, and what should it never cut?';
    const pendingClarification = {
      question,
      confidence: refinement.confidence || 0.35,
      createdAt: new Date().toISOString(),
      lastUserNote: normalizeText(userInput).slice(0, 400),
    };

    updateTemplateRoot(db, templateId, {
      pendingClarification,
    });
    insertMessage(db, templateId, 'assistant', question, refinement.confidence || 0.35, true);

    return {
      ...getTemplateState(db, userId),
      refinement: {
        status: 'needs_clarification',
        confidence: refinement.confidence || 0.35,
        clarificationQuestion: question,
      },
    };
  }

  const nextState = await applyRefinement(state, refinement, userInput);
  updateTemplateRoot(db, templateId, {
    name: nextState.root.name,
    objective: nextState.root.objective,
    higherOrderRule: nextState.root.higherOrderRule,
    fixedRules: state.fixedRules,
    watchQuestions: nextState.root.watchQuestions,
    briefingStyle: nextState.root.briefingStyle,
    workspaceMemory: nextState.root.workspaceMemory,
    pendingClarification: null,
  });

  const versionRow = createVersion(db, {
    id: templateId,
    objective: nextState.root.objective,
    higherOrderRule: nextState.root.higherOrderRule,
    fixedRules: state.fixedRules,
    workspaceMemory: nextState.root.workspaceMemory,
  }, nextState.adaptiveVersion, {
    createdFrom: 'ai_refinement',
    changeSummary: nextState.meta.changeSummary,
    conversationExcerpt: nextState.meta.conversationExcerpt,
  });

  insertMessage(
    db,
    templateId,
    'assistant',
    refinement.changeSummary || 'Template refined and versioned.',
    refinement.confidence || 0.7,
    false,
  );

  return {
    ...getTemplateState(db, userId),
    refinement: {
      status: 'updated',
      confidence: refinement.confidence || 0.7,
      clarificationQuestion: '',
      version: mapVersionRow(versionRow, {
        objective: nextState.root.objective,
        higherOrderRule: nextState.root.higherOrderRule,
      }),
    },
  };
}

function restoreVersion(db, versionId, userId = DEFAULT_USER_ID) {
  const template = ensureDefaultTemplate(db, userId);
  const templateRoot = mapTemplateRoot(template);
  const versionRow = db.prepare(`
    SELECT *
    FROM news_template_versions
    WHERE id = ? AND template_id = ?
    LIMIT 1
  `).get(versionId, template.id);

  if (!versionRow) {
    throw new Error('Template version not found.');
  }

  updateTemplateRoot(db, template.id, {
    activeVersionId: versionId,
    pendingClarification: null,
    fixedRules: templateRoot.fixedRules,
    workspaceMemory: parseJson(versionRow.workspace_memory_json, templateRoot.workspaceMemory || DEFAULT_WORKSPACE_MEMORY),
  });

  insertMessage(
    db,
    template.id,
    'assistant',
    `Restored template version ${versionRow.version_number}.`,
    1,
    false,
  );

  return getTemplateState(db, userId);
}

module.exports = {
  ensureTables,
  getTemplateState,
  refineTemplate,
  restoreVersion,
  updateTemplateConfig,
  saveWorkspaceDocuments,
  __test__: {
    DEFAULT_HIERARCHY_WEIGHT,
    DEFAULT_FIXED_RULES,
    EMBEDDING_MERGE_THRESHOLD,
    LEXICAL_MERGE_THRESHOLD,
    dedupeAdaptiveRules,
    mergeAdaptiveRules,
    scoreOverlap,
  },
};
