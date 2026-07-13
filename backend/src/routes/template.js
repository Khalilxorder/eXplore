const templateService = require('../services/newsTemplateService');
const templateRankingService = require('../services/templateRankingService');
const valueHierarchyService = require('../services/valueHierarchySync');
const aiService = require('../../services/aiService');
const { buildSourceRegistry } = require('../../services/sourceRegistry');
const feedDiscoveryService = require('../services/feedDiscoveryService');
const writtenNewsService = require('../services/writtenNewsService');
const alertRadarService = require('../services/alertRadarService');

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

function getModelPool(state = {}) {
  return state?.modelPool || aiService.getModelPoolStatus();
}

function stringifyStatus(status = '') {
  return String(status || '').replace(/_/g, ' ').trim() || 'unknown';
}

function createTreeNode(label, options = {}) {
  return {
    label,
    value: options.value || '',
    badge: options.badge || '',
    meta: options.meta || '',
    children: Array.isArray(options.children) ? options.children.filter(Boolean) : [],
  };
}

function buildModelTree(modelPool = {}) {
  const gemini = modelPool?.gemini || {};
  const openai = modelPool?.openai || {};
  const activeTextModel = modelPool?.activeProvider === 'openai'
    ? (openai.defaultModel || 'gpt-4o-mini')
    : (gemini.defaultAnalysisModel || 'gemini-2.5-flash-lite');
  const templateModel = gemini.defaultTemplateModel || activeTextModel;
  const embeddingModel = gemini.defaultEmbeddingModel || 'text-embedding-3-small';

  return [
    createTreeNode('Models in use', {
      meta: 'Live backend model routing. This section updates when the configured models change.',
      children: [
        createTreeNode('Active provider', {
          value: modelPool?.activeProvider || 'mock',
          badge: modelPool?.activeProvider === 'mock' ? 'fallback' : 'live',
          meta: 'The provider the backend will choose first for language work right now.',
        }),
        createTreeNode('Gemini pool', {
          value: gemini.configured
            ? `${Number(gemini.configuredKeys || 0)} key${Number(gemini.configuredKeys || 0) === 1 ? '' : 's'} configured`
            : 'Not configured',
          badge: gemini.rotationEnabled ? 'rotation on' : (gemini.configured ? 'single key' : 'not configured'),
          meta: 'Gemini keys are pooled and rotated automatically on retryable errors.',
        }),
        createTreeNode('Gemini analysis model', {
          value: gemini.defaultAnalysisModel || 'Not configured',
          badge: gemini.configured ? 'active path' : 'inactive',
          meta: 'Used for interpretation, summary, transcript analysis, and search analysis.',
        }),
        createTreeNode('Gemini template model', {
          value: templateModel || 'Not configured',
          badge: gemini.configured ? 'template path' : 'inactive',
          meta: 'Used when the AI editor rewrites your interest template and watch questions.',
        }),
        createTreeNode('Gemini embedding model', {
          value: embeddingModel || 'Not configured',
          badge: gemini.configured ? 'semantic path' : 'inactive',
          meta: 'Used for semantic similarity, ranking memory, and interest matching.',
        }),
        createTreeNode('OpenAI model', {
          value: openai.defaultModel || 'gpt-4o-mini',
          badge: openai.configured ? 'available' : 'not configured',
          meta: 'Configured as the current backup provider path when OpenAI credentials exist.',
        }),
      ],
    }),
    createTreeNode('Function map', {
      meta: 'This is the simple tree for what each model path is doing.',
      children: [
        createTreeNode('Interpretation, summary, search analysis', {
          value: activeTextModel,
          meta: 'Used by the backend to understand transcripts, videos, and written news.',
        }),
        createTreeNode('Interest-template editing and AI refinement', {
          value: templateModel,
          meta: 'Used when you talk to the AI editor in the News Rules screen.',
        }),
        createTreeNode('Structured JSON decisions', {
          value: activeTextModel,
          meta: 'Used when the backend asks the model for structured updates and rule decisions.',
        }),
        createTreeNode('Embeddings and semantic ranking', {
          value: embeddingModel,
          meta: 'Used for similarity, clustering, ranking support, and memory-style matching.',
        }),
      ],
    }),
  ];
}

function normalizeTrackedChannelRows(db, userId) {
  const storedRows = feedDiscoveryService.listTrackedChannels(db, userId);
  if (storedRows.length) {
    return storedRows.map((row) => ({
      label: row.channel_name || row.channel_query || row.channel_id || 'Tracked channel',
      value: row.channel_id ? `https://www.youtube.com/channel/${row.channel_id}` : '',
      badge: row.lane || 'tracked',
      meta: `Trust tier ${Number(row.trust_tier || 3)}${row.system_managed ? ' · system managed' : ''}`,
    }));
  }

  const blueprint = feedDiscoveryService.getSystemDiscoveryBlueprint();
  return (blueprint.trackedChannels || []).map((row) => ({
    label: row.query || row.channelId || 'Tracked channel',
    value: row.channelId ? `https://www.youtube.com/channel/${row.channelId}` : '',
    badge: row.lane || 'tracked',
    meta: `Trust tier ${Number(row.trustTier || 3)} · system blueprint`,
  }));
}

function normalizeTopicMonitorRows(db, userId) {
  const storedRows = feedDiscoveryService.listTopicMonitors(db, userId);
  if (storedRows.length) {
    return storedRows.map((row) => ({
      label: row.query || 'Topic monitor',
      value: '',
      badge: row.intent || 'fresh_signal',
      meta: `Weight ${Number(row.weight || 0.6).toFixed(2)}${row.system_managed ? ' · system managed' : ''}`,
    }));
  }

  const blueprint = feedDiscoveryService.getSystemDiscoveryBlueprint();
  return (blueprint.topicMonitors || []).map((row) => ({
    label: row.query || 'Topic monitor',
    value: '',
    badge: row.intent || 'fresh_signal',
    meta: `Weight ${Number(row.weight || 0.6).toFixed(2)} · system blueprint`,
  }));
}

function normalizePeopleOfInterestRows(state = {}) {
  const blueprint = feedDiscoveryService.getSystemDiscoveryBlueprint();
  const rawPeople = state?.workspace?.workspaceMemory?.peopleOfInterest;
  const savedPeople = Array.isArray(rawPeople)
    ? rawPeople
    : typeof rawPeople === 'string'
      ? rawPeople.split(/\r?\n/g)
      : [];
  const systemPeople = Array.isArray(blueprint?.peopleOfInterest)
    ? blueprint.peopleOfInterest
        .map((entry) => entry?.personName || '')
        .filter(Boolean)
    : [];
  const normalized = [...new Set([...systemPeople, ...savedPeople]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))];

  if (!normalized.length) {
    return [
      createTreeNode('No people saved yet', {
        badge: 'empty',
        meta: 'Add people whose interviews, quotes, or public moves should stay easy to spot.',
      }),
    ];
  }

  return normalized.map((entry) => createTreeNode(entry, {
    badge: 'reference',
    meta: savedPeople.includes(entry)
      ? 'Person of interest saved in workspace memory.'
      : 'System interview watch that is already being monitored.',
  }));
}

function buildSourceTree(db, userId, state = {}) {
  const registry = buildSourceRegistry().map((entry) => createTreeNode(entry.name, {
    value: entry.provider,
    badge: stringifyStatus(entry.status),
    meta: `${entry.coverage}. ${entry.notes}${entry.envKeys?.length ? ` Keys: ${entry.envKeys.join(', ')}` : ''}`,
  }));
  const writtenFeeds = writtenNewsService.getConfiguredFeedDefinitions().map((entry) => createTreeNode(entry.label, {
    value: entry.url,
    badge: entry.host,
    meta: 'Configured written feed source.',
  }));
  const radarFeeds = alertRadarService.getDirectRadarFeedDefinitions();
  const officialFeeds = radarFeeds
    .filter((entry) => entry.sourceType === 'official')
    .map((entry) => createTreeNode(entry.label, {
      value: entry.feedUrl || entry.landingUrl || '',
      badge: entry.kind || 'official',
      meta: entry.publisher ? `Publisher: ${entry.publisher}` : 'Official release-watch source.',
    }));
  const pressFeeds = radarFeeds
    .filter((entry) => entry.sourceType !== 'official')
    .map((entry) => createTreeNode(entry.label, {
      value: entry.feedUrl || entry.landingUrl || '',
      badge: entry.kind || 'press',
      meta: 'Press / corroboration source used by radar.',
    }));
  const trackedChannels = normalizeTrackedChannelRows(db, userId).map((entry) => createTreeNode(entry.label, entry));
  const topicMonitors = normalizeTopicMonitorRows(db, userId).map((entry) => createTreeNode(entry.label, entry));
  const peopleOfInterest = normalizePeopleOfInterestRows(state);

  return [
    createTreeNode('Sources and references', {
      meta: 'These are the live connectors and monitored sources eXplore is using right now.',
      children: [
        createTreeNode('Platform connectors', {
          children: registry,
        }),
        createTreeNode('Written news feeds', {
          children: writtenFeeds,
        }),
        createTreeNode('Official release-watch feeds', {
          children: officialFeeds,
        }),
        createTreeNode('Press and corroboration feeds', {
          children: pressFeeds,
        }),
        createTreeNode('Tracked YouTube channels', {
          children: trackedChannels,
        }),
        createTreeNode('YouTube topic monitors', {
          children: topicMonitors,
        }),
        createTreeNode('People of interest', {
          children: peopleOfInterest,
        }),
      ],
    }),
  ];
}

function buildSourceHealthSummary(db, userId, state = {}) {
  const registry = buildSourceRegistry();
  const radarFeeds = alertRadarService.getDirectRadarFeedDefinitions();
  const trackedChannels = normalizeTrackedChannelRows(db, userId);
  const topicMonitors = normalizeTopicMonitorRows(db, userId);
  const peopleOfInterest = normalizePeopleOfInterestRows(state);

  return {
    status: 'live',
    connectors: registry.length,
    writtenFeedCount: writtenNewsService.getConfiguredFeedDefinitions().length,
    officialFeedCount: radarFeeds.filter((entry) => entry.sourceType === 'official').length,
    pressFeedCount: radarFeeds.filter((entry) => entry.sourceType !== 'official').length,
    trackedChannelCount: trackedChannels.length,
    topicMonitorCount: topicMonitors.length,
    peopleOfInterestCount: peopleOfInterest.filter((entry) => entry?.label !== 'No people saved yet').length,
  };
}

function buildSystemMap(db, userId, state = {}) {
  const modelPool = getModelPool(state);
  return {
    updatedAt: new Date().toISOString(),
    summary: {
      activeProvider: modelPool?.activeProvider || 'mock',
      geminiKeyCount: Number(modelPool?.gemini?.configuredKeys || 0),
      geminiConfigured: Boolean(modelPool?.gemini?.configured),
      openaiConfigured: Boolean(modelPool?.openai?.configured),
    },
    tree: [
      ...buildModelTree(modelPool),
      ...buildSourceTree(db, userId, state),
    ],
  };
}

function uniqueTrimmedList(items = [], limit = 8) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))]
    .slice(0, limit);
}

function compactText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTrackedCompanyLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'anthropic') return 'Anthropic / Claude';
  if (normalized === 'openai') return 'OpenAI / ChatGPT';
  if (normalized === 'google') return 'Gemini / DeepMind';
  if (normalized === 'xai') return 'Grok / xAI';
  return String(value || '').trim();
}

function formatAlertStyleMeta(value = 'strict') {
  if (value === 'broad') {
    return {
      label: 'Broad',
      summary: 'Let more relevant updates through as long as they still fit the saved interests.',
    };
  }

  if (value === 'balanced') {
    return {
      label: 'Balanced',
      summary: 'Keep the app selective, but allow more than only the sharpest official interrupts.',
    };
  }

  return {
    label: 'Strict',
    summary: 'Prefer official, high-consequence changes and keep interruption pressure low.',
  };
}

function buildHighPriorityProfile(workspaceMemory = {}) {
  const profile = workspaceMemory?.highPriorityProfile || {};
  const priorityTopics = uniqueTrimmedList(profile.priorityTopics || workspaceMemory?.priorityTopics, 6);
  const aiReleasePhrases = uniqueTrimmedList(profile.aiReleasePhrases, 6);
  const geoPhrases = uniqueTrimmedList(profile.geoPhrases, 6);
  const politicalPhrases = uniqueTrimmedList(profile.politicalPhrases, 6);
  const releaseWatchCompanies = uniqueTrimmedList(profile.releaseWatchCompanies, 6)
    .map(formatTrackedCompanyLabel)
    .filter(Boolean);
  const summary = profile.summary
    || compactText([
      priorityTopics.length ? `Priority topics: ${priorityTopics.join(', ')}` : '',
      releaseWatchCompanies.length ? `Release watch: ${releaseWatchCompanies.join(', ')}` : '',
    ].filter(Boolean).join(' · '));

  return {
    enabled: profile.enabled !== false,
    summary,
    minImportance: profile.minImportance || 'important',
    priorityTopics,
    aiReleasePhrases,
    geoPhrases,
    politicalPhrases,
    releaseWatchCompanies,
  };
}

function normalizeMaybeList(source, limit = 6) {
  if (!Array.isArray(source)) {
    return [];
  }

  return [...new Set(source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))]
    .slice(0, limit);
}

function formatRecentChangeSignal(entry) {
  if (!entry) {
    return '';
  }

  if (typeof entry === 'string') {
    return compactText(entry);
  }

  if (typeof entry === 'object') {
    const label = compactText(entry.label || entry.title || entry.name || entry.field || entry.type || '');
    const detail = compactText(entry.detail || entry.summary || entry.reason || entry.note || entry.value || '');
    if (label && detail) {
      return `${label}: ${detail}`;
    }
    return label || detail;
  }

  return '';
}

function collectRecentSignals(state = {}) {
  const candidates = [
    state?.recentChanges,
    state?.changeLog,
    state?.changes,
    state?.history,
    state?.versionHistory,
    state?.workspace?.recentChanges,
    state?.workspace?.changeLog,
    state?.workspace?.history,
  ];

  const signals = [];
  for (const source of candidates) {
    const normalized = normalizeMaybeList(source, 4)
      .map(formatRecentChangeSignal)
      .filter(Boolean);
    if (normalized.length) {
      signals.push(...normalized);
      break;
    }
  }

  const fallbackSignals = [];
  const workspace = state?.workspace || {};
  const workspaceMemory = workspace?.workspaceMemory || {};

  if (Array.isArray(workspace.watchQuestions) && workspace.watchQuestions.length) {
    fallbackSignals.push(`Watch questions saved (${workspace.watchQuestions.length}).`);
  }

  if (Array.isArray(workspace.briefingStyle) && workspace.briefingStyle.length) {
    fallbackSignals.push(`Briefing style saved (${workspace.briefingStyle.length}).`);
  }

  const trackedCompanies = normalizeMaybeList(workspaceMemory.trackedCompanies, 8);
  if (trackedCompanies.length) {
    fallbackSignals.push(`Tracked companies: ${trackedCompanies.map(formatTrackedCompanyLabel).join(', ')}.`);
  }

  const peopleOfInterest = normalizeMaybeList(workspaceMemory.peopleOfInterest, 8);
  if (peopleOfInterest.length) {
    fallbackSignals.push(`People of interest: ${peopleOfInterest.join(', ')}.`);
  }

  const priorityTopics = normalizeMaybeList(workspaceMemory.priorityTopics, 6);
  if (priorityTopics.length) {
    fallbackSignals.push(`Priority topics: ${priorityTopics.join(', ')}.`);
  }

  if (!signals.length) {
    signals.push(...fallbackSignals.slice(0, 4));
  }

  return [...new Set(signals.map(compactText).filter(Boolean))].slice(0, 6);
}

function buildOperatingBrief(state = {}) {
  const workspace = state?.workspace || {};
  const workspaceMemory = workspace?.workspaceMemory || {};
  const hierarchy = state?.hierarchy || {};
  const currentGoal = String(hierarchy?.currentGoal || '').trim();
  const priorityTopics = uniqueTrimmedList(workspaceMemory?.priorityTopics, 6);
  const avoidTopics = uniqueTrimmedList(workspaceMemory?.avoidTopics, 6);
  const trackedCompanies = uniqueTrimmedList(workspaceMemory?.trackedCompanies, 6)
    .map((entry) => formatTrackedCompanyLabel(entry))
    .filter(Boolean);
  const peopleOfInterest = uniqueTrimmedList(workspaceMemory?.peopleOfInterest, 8);
  const referenceSignals = uniqueTrimmedList(workspaceMemory?.referenceSignals, 8);
  const highPriorityProfile = buildHighPriorityProfile(workspaceMemory);
  const activeQuestions = uniqueTrimmedList(workspace?.watchQuestions, 4);
  const writingDirectives = uniqueTrimmedList(workspace?.briefingStyle, 4);
  const alertStyle = formatAlertStyleMeta(workspaceMemory?.alertStyle || 'strict');
  const sourcePreferences = workspaceMemory?.sourcePreferences || {};
  const sourceBias = [
    sourcePreferences.officialFirst !== false ? 'Official sources first' : null,
    sourcePreferences.written !== false ? 'Written reporting on' : null,
    sourcePreferences.socialVideo !== false ? 'Video intelligence on' : null,
    sourcePreferences.socialPhoto ? 'Photo signals on' : null,
    sourcePreferences.trustedSourcesOnly !== false ? 'Trust filtering on' : null,
  ].filter(Boolean);

  const northStar = currentGoal
    || priorityTopics[0]
    || 'Stay ahead of important AI releases and regional risk';
  const missionSummary = currentGoal
    ? `Find the freshest high-signal changes that matter for this current goal: ${currentGoal}.`
    : trackedCompanies.length
      ? `Stay current on ${trackedCompanies.join(', ')} while filtering out weak or noisy updates.`
      : 'Stay focused on the highest-signal changes and ignore weak or repetitive noise.';
  const trustContract = [
    'Fresh items should appear before older matched items in the main news lane.',
    'Official sources and trusted reporting should beat commentary when the stakes are high.',
    'If a transcript or image is unavailable, the app should say that directly instead of faking it.',
  ];

  return {
    northStar,
    missionSummary,
    currentGoal,
    trackedCompanies,
    priorityTopics,
    avoidTopics,
    peopleOfInterest,
    referenceSignals,
    highPriorityProfile,
    activeQuestions,
    writingDirectives,
    sourceBias,
    alertStyle,
    trustContract,
  };
}

function buildInterestBrain(state = {}) {
  const workspace = state?.workspace || {};
  const workspaceMemory = workspace?.workspaceMemory || {};
  const hierarchy = state?.hierarchy || {};
  const currentGoal = compactText(hierarchy?.currentGoal || workspace?.currentGoal || state?.currentGoal || '');
  const priorityTopics = uniqueTrimmedList(workspaceMemory?.priorityTopics, 6);
  const avoidTopics = uniqueTrimmedList(workspaceMemory?.avoidTopics, 6);
  const trackedCompanies = uniqueTrimmedList(workspaceMemory?.trackedCompanies, 6)
    .map(formatTrackedCompanyLabel)
    .filter(Boolean);
  const peopleOfInterest = uniqueTrimmedList(workspaceMemory?.peopleOfInterest, 8);
  const sourcePreferences = workspaceMemory?.sourcePreferences || {};
  const highPriorityProfile = buildHighPriorityProfile(workspaceMemory);
  const sourcePosture = {
    officialFirst: sourcePreferences.officialFirst !== false,
    written: sourcePreferences.written !== false,
    socialVideo: sourcePreferences.socialVideo !== false,
    socialPhoto: Boolean(sourcePreferences.socialPhoto),
    trustedSourcesOnly: sourcePreferences.trustedSourcesOnly !== false,
  };
  const alertStyle = formatAlertStyleMeta(workspaceMemory?.alertStyle || 'strict');
  const watchQuestions = uniqueTrimmedList(workspace?.watchQuestions, 6);
  const briefingStyle = uniqueTrimmedList(workspace?.briefingStyle, 4);
  const recentSignals = collectRecentSignals(state);

  const missionFocus = currentGoal
    || priorityTopics[0]
    || (trackedCompanies.length ? `Keep current on ${trackedCompanies.join(', ')}` : 'Stay focused on high-signal changes');

  return {
    missionFocus,
    currentGoal,
    trackedCompanies,
    peopleOfInterest,
    priorityTopics,
    avoidTopics,
    highPriorityProfile,
    sourcePosture,
    alertPosture: alertStyle,
    watchQuestions,
    briefingStyle,
    recentSignals,
    summary: compactText([
      missionFocus,
      trackedCompanies.length ? `Tracked companies: ${trackedCompanies.join(', ')}` : '',
      peopleOfInterest.length ? `People of interest: ${peopleOfInterest.join(', ')}` : '',
      priorityTopics.length ? `Priority topics: ${priorityTopics.join(', ')}` : '',
      highPriorityProfile.summary ? `High-priority profile: ${highPriorityProfile.summary}` : '',
      alertStyle?.label ? `Alert posture: ${alertStyle.label}` : '',
    ].filter(Boolean).join(' · ')),
  };
}

function hydrateTemplatePayload(baseState, db, userId) {
  const state = baseState || templateService.getTemplateState(db, userId);
  const hierarchy = valueHierarchyService.getState(db, userId);
  const enrichedState = {
    ...state,
    hierarchy,
  };
  return {
    ...enrichedState,
    workspaceMemory: enrichedState?.workspace?.workspaceMemory || {},
    highPriorityProfile: buildHighPriorityProfile(enrichedState?.workspace?.workspaceMemory || {}),
    sourceHealth: buildSourceHealthSummary(db, userId, enrichedState),
    systemMap: buildSystemMap(db, userId, enrichedState),
    operatingBrief: buildOperatingBrief(enrichedState),
    interestBrain: buildInterestBrain(enrichedState),
  };
}

function buildTemplatePayload(db, userId) {
  return {
    ...hydrateTemplatePayload(templateService.getTemplateState(db, userId), db, userId),
  };
}

module.exports = async function templateRoutes(fastify, opts) {
  const db = opts.db;

  templateService.ensureTables(db);
  valueHierarchyService.ensureTables(db);

  fastify.get('/', async (request) => {
    const userId = resolveUserId(request);
    templateRankingService.ensureContentAnalysisColumns(db);
    return buildTemplatePayload(db, userId);
  });

  fastify.get('/news-paths', async () => {
    const { LIFE_NEWS_PATHS } = require('../services/templateRankingService');
    return { success: true, paths: LIFE_NEWS_PATHS };
  });

  fastify.post('/refine', async (request, reply) => {
    const note = String(request.body?.note || '').trim();
    const userId = resolveUserId(request);

    if (!note) {
      return reply.code(400).send({
        success: false,
        error: 'A note is required to refine the template.',
      });
    }

    try {
      const state = await templateService.refineTemplate(db, note, userId);
      templateRankingService.scheduleRecentContentWarmup(db);
      return {
        success: true,
        ...hydrateTemplatePayload(state, db, userId),
      };
    } catch (error) {
      request.log.error(error, 'Template refinement failed');
      return reply.code(500).send({
        success: false,
        error: 'Template refinement failed.',
        details: error.message,
      });
    }
  });

  fastify.post('/config', async (request, reply) => {
    const userId = resolveUserId(request);
    const hierarchyWeight = Number(request.body?.hierarchyWeight);

    if (!Number.isFinite(hierarchyWeight)) {
      return reply.code(400).send({
        success: false,
        error: 'A numeric hierarchyWeight is required.',
      });
    }

    try {
      const state = templateService.updateTemplateConfig(db, userId, { hierarchyWeight });
      return {
        success: true,
        ...hydrateTemplatePayload(state, db, userId),
      };
    } catch (error) {
      request.log.error(error, 'Template config update failed');
      return reply.code(500).send({
        success: false,
        error: 'Template config update failed.',
        details: error.message,
      });
    }
  });

  fastify.post('/workspace', async (request, reply) => {
    const userId = resolveUserId(request);
    const watchQuestions = Array.isArray(request.body?.watchQuestions) ? request.body.watchQuestions : [];
    const briefingStyle = Array.isArray(request.body?.briefingStyle) ? request.body.briefingStyle : [];
    const workspaceMemory = request.body?.workspaceMemory && typeof request.body.workspaceMemory === 'object'
      ? request.body.workspaceMemory
      : undefined;

    try {
      const state = await templateService.saveWorkspaceDocuments(db, userId, {
        watchQuestions,
        briefingStyle,
        workspaceMemory,
      });
      return {
        success: true,
        ...hydrateTemplatePayload(state, db, userId),
      };
    } catch (error) {
      request.log.error(error, 'Template workspace save failed');
      return reply.code(500).send({
        success: false,
        error: 'Template workspace save failed.',
        details: error.message,
      });
    }
  });

  fastify.post('/restore/:versionId', async (request, reply) => {
    const userId = resolveUserId(request);

    try {
      const state = templateService.restoreVersion(db, request.params.versionId, userId);
      templateRankingService.scheduleRecentContentWarmup(db);
      return {
        success: true,
        ...hydrateTemplatePayload(state, db, userId),
      };
    } catch (error) {
      const statusCode = error.message === 'Template version not found.' ? 404 : 500;
      return reply.code(statusCode).send({
        success: false,
        error: error.message,
      });
    }
  });
};
