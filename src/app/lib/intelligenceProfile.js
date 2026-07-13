const COMPANY_LABELS = {
  anthropic: 'Anthropic / Claude',
  openai: 'OpenAI / ChatGPT',
  google: 'Gemini / DeepMind',
  meta: 'Meta / Llama',
  xai: 'Grok / xAI',
  microsoft: 'Microsoft / Copilot',
};

const ALERT_STYLE_LABELS = {
  strict: 'Strict alerts',
  balanced: 'Balanced alerts',
  broad: 'Broad alerts',
};

function normalizeCompanyKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'gemini' || normalized === 'deepmind') {
    return 'google';
  }

  if (normalized === 'grok' || normalized === 'x.ai' || normalized === 'xai') {
    return 'xai';
  }

  if (normalized === 'llama' || normalized === 'meta ai') {
    return 'meta';
  }

  if (normalized === 'copilot' || normalized === 'msft') {
    return 'microsoft';
  }

  return normalized;
}

export function normalizeStringList(items = []) {
  const normalized = [];

  for (const entry of Array.isArray(items) ? items : []) {
    const value = String(entry || '').trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (normalized.some((item) => item.toLowerCase() === key)) {
      continue;
    }

    normalized.push(value);
  }

  return normalized;
}

export function getCompanyLabels(companies = []) {
  return normalizeStringList(
    (Array.isArray(companies) ? companies : [])
      .map((entry) => normalizeCompanyKey(entry))
      .filter(Boolean)
      .map((entry) => COMPANY_LABELS[entry] || entry)
  );
}

export function buildOperatingBrief(template = {}) {
  const workspace = template?.workspace && typeof template.workspace === 'object'
    ? template.workspace
    : template;
  const workspaceMemory = workspace?.workspaceMemory && typeof workspace.workspaceMemory === 'object'
    ? workspace.workspaceMemory
    : {};
  const priorityTopics = normalizeStringList(workspaceMemory.priorityTopics || []);
  const avoidTopics = normalizeStringList(workspaceMemory.avoidTopics || []);
  const peopleOfInterest = normalizeStringList(workspaceMemory.peopleOfInterest || []);
  const trackedCompanies = getCompanyLabels(workspaceMemory.trackedCompanies || []);
  const highPriorityProfile = workspaceMemory.highPriorityProfile && typeof workspaceMemory.highPriorityProfile === 'object'
    ? workspaceMemory.highPriorityProfile
    : {};
  const highPriorityTopics = normalizeStringList(highPriorityProfile.priorityTopics || priorityTopics || []);
  const highPrioritySummary = normalizeStringList([
    ...(highPriorityTopics.length ? [`High priority: ${highPriorityTopics.slice(0, 3).join(', ')}`] : []),
    ...(normalizeStringList(highPriorityProfile.aiReleasePhrases || []).length
      ? [`AI release focus: ${normalizeStringList(highPriorityProfile.aiReleasePhrases || []).slice(0, 2).join(', ')}`]
      : []),
    ...(normalizeStringList(highPriorityProfile.geoPhrases || []).length
      ? [`Geo focus: ${normalizeStringList(highPriorityProfile.geoPhrases || []).slice(0, 2).join(', ')}`]
      : []),
  ]);
  const watchQuestions = normalizeStringList(workspace.watchQuestions || []);
  const briefingStyle = normalizeStringList(workspace.briefingStyle || []);
  const sourcePreferences = workspaceMemory.sourcePreferences && typeof workspaceMemory.sourcePreferences === 'object'
    ? workspaceMemory.sourcePreferences
    : {};
  const preferredSources = [
    sourcePreferences.officialFirst !== false ? 'Official sources first' : '',
    sourcePreferences.written !== false ? 'Written reporting on' : '',
    sourcePreferences.socialVideo !== false ? 'Video signals on' : '',
    sourcePreferences.trustedSourcesOnly !== false ? 'Trusted sources only' : '',
  ].filter(Boolean);
  const alertStyle = ALERT_STYLE_LABELS[String(workspaceMemory.alertStyle || '').trim().toLowerCase()] || 'Balanced alerts';

  const summaryParts = [];
  if (priorityTopics.length) {
    summaryParts.push(`watching for ${priorityTopics.slice(0, 3).join(', ')}`);
  }
  if (trackedCompanies.length) {
    summaryParts.push(`keeping ${trackedCompanies.slice(0, 4).join(', ')} near the top`);
  }
  if (peopleOfInterest.length) {
    summaryParts.push(`tracking voices like ${peopleOfInterest.slice(0, 3).join(', ')}`);
  }
  if (avoidTopics.length) {
    summaryParts.push(`suppressing ${avoidTopics.slice(0, 3).join(', ')}`);
  }
  if (highPrioritySummary.length) {
    summaryParts.push(highPrioritySummary.join(', '));
  }

  return {
    priorityTopics,
    avoidTopics,
    peopleOfInterest,
    trackedCompanies,
    highPriorityProfile: {
      enabled: highPriorityProfile.enabled !== false,
      summary: highPriorityProfile.summary || (highPriorityTopics.length ? `High priority on ${highPriorityTopics.slice(0, 3).join(', ')}.` : ''),
      priorityTopics: highPriorityTopics,
      aiReleasePhrases: normalizeStringList(highPriorityProfile.aiReleasePhrases || []),
      geoPhrases: normalizeStringList(highPriorityProfile.geoPhrases || []),
      politicalPhrases: normalizeStringList(highPriorityProfile.politicalPhrases || []),
      releaseWatchCompanies: normalizeStringList(highPriorityProfile.releaseWatchCompanies || []),
      minImportance: String(highPriorityProfile.minImportance || 'important').trim() || 'important',
    },
    watchQuestions,
    briefingStyle,
    preferredSources,
    alertStyle,
    summary: summaryParts.length
      ? `eXplore is currently ${summaryParts.join(', ')}.`
      : 'eXplore is running without a clear personal brief yet.',
  };
}

export function buildTrustReason(item = {}) {
  if (item?.kind === 'official' || item?.officialSource || item?.officialReleaseWatch) {
    return 'Official vendor or first-party release source.';
  }

  if (item?.whyTrusted) {
    return String(item.whyTrusted).trim();
  }

  const transcriptStatus = String(item?.transcriptStatus || '').trim().toLowerCase();
  const sourceTrust = Number(item?.sourceTrust ?? item?.scores?.sourceTrust ?? NaN);
  const source = String(item?.source || '').trim();

  if (transcriptStatus === 'full' || transcriptStatus === 'partial' || item?.hasTranscript) {
    return 'Backed by a public transcript or transcript preview.';
  }

  if (Number.isFinite(sourceTrust) && sourceTrust >= 0.92) {
    return 'High-trust source with strong ranking confidence.';
  }

  if (Number.isFinite(sourceTrust) && sourceTrust >= 0.78) {
    return 'Trusted source with enough signal quality to stay in the feed.';
  }

  if (source) {
    return `${source} is currently contributing enough signal to stay visible.`;
  }

  return 'This item passed the current trust and relevance thresholds.';
}

/**
 * Parse a free-form natural language interest string typed by the user
 * (e.g. "I need tools", "show me new claude and gpt releases") and return
 * a structured intent object the radar and template can act on.
 */
export function parseInterestIntent(text = '') {
  const t = String(text || '').toLowerCase();

  // Tool-seeking intent — user wants things they can actually USE
  const toolIntent = /\b(tool|tools|use|useful|usable|build with|work with|productivity|automate|workflow|api|sdk|plugin|extension|integration|app|apps|agent|agents|assistant|assistants|coding|code|help me|practical|real.?world|actually use|can use|i need|need to use|working|deploy|production|implement|utility|utilities)\b/.test(t);

  // Release-seeking intent
  const releaseIntent = /\b(release|released|launch|launched|new model|latest model|newest|just out|dropped|available|update|updated|upgrade|version|v\d|\d\.\d|announcement|announced|rollout|rolled out|pricing|api access|open source|open.?source|weights|benchmark|preview|beta|general availability|ga)\b/.test(t);

  // Specific model name patterns (very precise — catches "claude opus 4.6", "claude mythos", "gpt-5", "gemini 2.5")
  const modelNamePatterns = [
    /claude\s+(opus|sonnet|haiku|mythos|instant|\d)/i,
    /gpt[-\s]?(\d|nano|mini|turbo|o\d)/i,
    /gemini\s+(\d|pro|flash|ultra|nano)/i,
    /llama\s*(\d|\d\.\d)/i,
    /grok\s*(\d|\d\.\d|-mini|-vision)/i,
    /phi[-\s]?(\d|\d\.\d)/i,
    /mistral|mixtral|deepseek|qwen|command[-\s]?r/i,
    /o[1-9]\b|o[1-9]-mini|o[1-9]-pro/i,
  ];
  const modelIntent = modelNamePatterns.some((p) => p.test(t));

  // Companies mentioned
  const companies = [];
  if (/\b(anthropic|claude|mythos|sonnet|opus|haiku)\b/.test(t)) companies.push('anthropic');
  if (/\b(openai|gpt|chatgpt|o1|o3|o4|sora)\b/.test(t)) companies.push('openai');
  if (/\b(google|gemini|deepmind|bard|veo|imagen)\b/.test(t)) companies.push('google');
  if (/\b(meta|llama|mistral)\b/.test(t)) companies.push('meta');
  if (/\b(xai|grok|x\.ai)\b/.test(t)) companies.push('xai');
  if (/\b(microsoft|copilot|phi|azure ai)\b/.test(t)) companies.push('microsoft');

  // Importance level preference
  const wantsMajorOnly = /\b(major|biggest|only big|top|most important|critical|game.?changer|landmark|breakthrough)\b/.test(t);
  const wantsEverything = /\b(all|everything|any|every|small|minor|even small|don.?t miss|nothing|comprehensive|inclusive)\b/.test(t);
  const minImportance = wantsMajorOnly ? 'major' : wantsEverything ? 'important' : null;

  // Alert style
  const wantsStrict = /\b(strict|only the best|quiet|minimal|interrupt|don.?t bother|selective|curated)\b/.test(t);
  const wantsBroad = /\b(broad|all updates|everything|any update|comprehensive|loose|open|inclusive)\b/.test(t);
  const alertStyle = wantsStrict ? 'strict' : wantsBroad ? 'broad' : null;

  // Speed preference
  const wantsRealTime = /\b(real.?time|instant|immediately|as soon as|fastest|right away|live|breaking|fast|quickly|asap)\b/.test(t);
  const politicsIntent = /\b(politic|political|government|election|policy|parliament|minister|diplomacy|summit|assassination|death|leader)\b/.test(t);
  const jordanIntent = /\bjordan\b/.test(t);
  const iranWarIntent = /\biran\b|\bwar\b|\bconflict\b|\bescalat|\brisk\b/.test(t);
  const highPriorityPhrases = [
    ...(releaseIntent || toolIntent || modelIntent ? ['Major AI tool releases'] : []),
    ...(releaseIntent || /\bimportant\b|\bmajor\b|\bcritical\b/.test(t) ? ['Important AI notes'] : []),
    ...(iranWarIntent || jordanIntent ? ['Iran war relation to Jordan and the world'] : []),
    ...(politicsIntent ? ['Very important political events'] : []),
  ];

  return {
    toolIntent,
    releaseIntent,
    modelIntent,
    companies,
    minImportance,
    alertStyle,
    wantsRealTime,
    politicsIntent,
    jordanIntent,
    iranWarIntent,
    highPriorityPhrases: normalizeStringList(highPriorityPhrases),
    hasAnySignal: toolIntent || releaseIntent || modelIntent || politicsIntent || jordanIntent || iranWarIntent || companies.length > 0,
  };
}

export function buildSignalRationale(item = {}) {
  const intelligence = item?.intelligenceExplanation || item?.explanation || null;
  return {
    whyShown: String(
      intelligence?.why_shown
      || item?.whyShown
      || item?.reason
      || item?.summary
      || 'This matched your current feed rules.'
    ).trim(),
    whyNow: String(intelligence?.why_now || item?.whyNow || '').trim(),
    whyTrusted: String(intelligence?.why_trusted || buildTrustReason(item) || '').trim(),
    whyNotified: String(item?.whyNotified || '').trim(),
    chips: Array.isArray(intelligence?.chips) ? intelligence.chips : [],
    confidence: typeof intelligence?.confidence === 'number' ? intelligence.confidence : null,
  };
}
