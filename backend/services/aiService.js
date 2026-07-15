// AI Analysis Service
// Uses Gemini Flash-Lite as the default understanding model with pooled-key rotation.
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_GEMINI_KEY_SLOTS = 100;
const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-3.5-flash';
const INVALID_GEMINI_MODEL_ALIASES = new Map([
  ['gemini-2.5-flash-lite', 'gemini-3.5-flash'],
  ['gemini-2.5-flash', 'gemini-3.5-flash'],
  ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
]);

function normalizeGeminiModelName(value, fallback = DEFAULT_GEMINI_FLASH_LITE_MODEL) {
  const normalized = String(value || '').trim().replace(/^models\//i, '');
  if (!normalized) {
    return fallback;
  }

  return INVALID_GEMINI_MODEL_ALIASES.get(normalized.toLowerCase()) || normalized;
}

const GEMINI_FLASH_LITE_MODEL = normalizeGeminiModelName(
  process.env.GEMINI_FLASH_LITE_MODEL || process.env.GEMINI_TEMPLATE_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
);
const GEMINI_ANALYSIS_MODEL = normalizeGeminiModelName(
  process.env.GEMINI_ANALYSIS_MODEL || process.env.GEMINI_MODEL,
  GEMINI_FLASH_LITE_MODEL,
);
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const GEMINI_ROTATE_STATUSES = new Set([401, 403, 429, 500, 503]);
const MAX_GEMINI_KEYS_PER_REQUEST = Math.max(
  1,
  Math.min(Number(process.env.GEMINI_MAX_KEYS_PER_REQUEST || 3), 10)
);
const MAX_GEMINI_IN_FLIGHT_PER_KEY = Math.max(
  1,
  Math.min(Number(process.env.GEMINI_MAX_IN_FLIGHT_PER_KEY || 1), 8)
);
const DEFAULT_GEMINI_REQUEST_TIMEOUT_MS = 15000;
const GEMINI_KEY_COOLDOWN_BASE_MS = {
  // A disabled/deleted bound service account will not recover during a normal session.
  401: 24 * 60 * 60 * 1000,
  403: 24 * 60 * 60 * 1000,
  429: 5 * 60 * 1000,
  500: 60 * 1000,
  503: 60 * 1000,
  default: 5 * 60 * 1000,
};
const GEMINI_KEY_COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;
const GEMINI_KEY_COOLDOWN_MULTIPLIER = 2;
const geminiKeyCooldowns = new Map();
const geminiKeyRuntimeState = new Map();
let geminiRoundRobinCursor = 0;
let lastLiveProbe = {
  status: 'never_run',
  provider: '',
  model: '',
  checkedAt: '',
  latencyMs: null,
  error: '',
};

const ANALYSIS_PROMPT = `You are an expert content analyst for "eXplore", a personal intelligence filter.
Analyze the following content and return a JSON object with these fields:

1. "summary" - A 2-3 sentence summary highlighting key insights (no fluff).
2. "topics" - Array of 2-5 topic tags (e.g., "Artificial Intelligence", "Psychology").
3. "scores" - Object with:
   - "depth" (0-1): How deeply does it explore the subject? 1 = PhD-level depth.
   - "rarity" (0-1): How rare/unique is this content? 1 = almost no one has seen it.
   - "freshness" (0-1): How new/timely are the insights? 1 = breaking news.
   - "clickbait" (0-1): How clickbaity is the title? 1 = pure clickbait.
   - "timeless" (0-1): Will this content be valuable in 10 years? 1 = timeless classic.
4. "reason" - A one-sentence explanation of why this content is valuable, starting with a category: "New:", "Rare:", "Deep Dive:", or "Timeless:".

Return ONLY valid JSON, no markdown.`;

const PLACEHOLDER_SECRET_PATTERN = /YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO/i;
const OPENAI_PREFIX_PATTERN = /^(?:sk|proj|sess|org)-/i;
const GOOGLE_API_KEY_PATTERN = /^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$/;
const GOOGLE_API_KEY_REDACTION_PATTERN = /(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})/g;
const OPENAI_KEY_REDACTION_PATTERN = /(?:sk|proj|sess|org)-[0-9A-Za-z\-_]+/g;

function isUsableApiKey(value, provider = 'generic') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  if (PLACEHOLDER_SECRET_PATTERN.test(normalized)) {
    return false;
  }

  if (/^(?:x|y|z|null|none|undefined|test)$/i.test(normalized)) {
    return false;
  }

  if (provider === 'openai') {
    return OPENAI_PREFIX_PATTERN.test(normalized) || normalized.length >= 20;
  }

  if (provider === 'gemini') {
    return GOOGLE_API_KEY_PATTERN.test(normalized);
  }

  return normalized.length >= 8;
}

const openaiApiKey = isUsableApiKey(process.env.OPENAI_API_KEY, 'openai')
  ? String(process.env.OPENAI_API_KEY).trim()
  : '';
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeVector(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return getMockEmbedding();
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function getDefaultGeminiKeyPoolFile() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return home ? path.join(home, '.dev-config', 'gemini-key-pool.json') : '';
}

function normalizeGeminiPoolEntry(entry) {
  if (typeof entry === 'string') {
    return entry.trim();
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return String(entry.key || entry.apiKey || entry.value || '').trim();
}

function readGeminiKeyPoolFileKeys() {
  const poolFile = String(process.env.GEMINI_KEY_POOL_FILE || getDefaultGeminiKeyPoolFile()).trim();
  if (!poolFile || !fs.existsSync(poolFile)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(poolFile, 'utf8').replace(/^\uFEFF/, ''));
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.keys) ? payload.keys : [];
    return entries
      .map((entry) => normalizeGeminiPoolEntry(entry))
      .filter((value) => isUsableApiKey(value, 'gemini'));
  } catch (error) {
    return [];
  }
}

function getGeminiApiKeys() {
  const envKeys = [
    process.env.GOOGLE_AI_API_KEY,
    process.env.GOOGLE_GEMINI_API_KEY,
    process.env.GEMINI_API_KEY,
  ];

  const pooledKeys = String(process.env.GOOGLE_AI_API_KEYS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  for (let index = 1; index <= MAX_GEMINI_KEY_SLOTS; index += 1) {
    envKeys.push(
      process.env[`GOOGLE_AI_API_KEY_${index}`],
      process.env[`GOOGLE_GEMINI_API_KEY_${index}`],
      process.env[`GEMINI_API_KEY_${index}`],
    );
  }

  return [...new Set(
    [...envKeys, ...pooledKeys, ...readGeminiKeyPoolFileKeys()]
      .map((value) => String(value || '').trim())
      .filter((value) => isUsableApiKey(value, 'gemini'))
  )];
}

function getGeminiCooldownStatus(errorOrStatus) {
  const status = Number(
    errorOrStatus?.status
      || errorOrStatus?.response?.status
      || errorOrStatus?.code
      || errorOrStatus
      || 0
  );

  return Number.isFinite(status) ? status : 0;
}

function getGeminiCooldownDurationMs(status, failureCount = 0) {
  const normalizedStatus = getGeminiCooldownStatus(status);
  const base = GEMINI_KEY_COOLDOWN_BASE_MS[normalizedStatus] || GEMINI_KEY_COOLDOWN_BASE_MS.default;
  const exponent = Math.max(0, Number(failureCount) || 0);
  return Math.min(GEMINI_KEY_COOLDOWN_MAX_MS, base * (GEMINI_KEY_COOLDOWN_MULTIPLIER ** exponent));
}

function getGeminiRequestTimeoutMs() {
  return Math.max(
    3000,
    Math.min(Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || DEFAULT_GEMINI_REQUEST_TIMEOUT_MS), 60000)
  );
}

function sanitizeAiErrorMessage(error) {
  return String(error?.message || error || '')
    .replace(GOOGLE_API_KEY_REDACTION_PATTERN, '[redacted-gemini-key]')
    .replace(OPENAI_KEY_REDACTION_PATTERN, '[redacted-openai-key]')
    .slice(0, 500);
}

function clearGeminiKeyCooldown(apiKey) {
  const normalizedKey = String(apiKey || '').trim();
  if (normalizedKey) {
    geminiKeyCooldowns.delete(normalizedKey);
  }
}

function markGeminiKeyCooldown(apiKey, errorOrStatus) {
  const normalizedKey = String(apiKey || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const status = getGeminiCooldownStatus(errorOrStatus);
  const previousState = geminiKeyCooldowns.get(normalizedKey);
  const failureCount = Number(previousState?.failureCount || 0);
  const cooldownMs = getGeminiCooldownDurationMs(status, failureCount);
  const cooldownUntil = Date.now() + cooldownMs;

  const nextState = {
    failureCount: failureCount + 1,
    status,
    cooldownUntil,
    updatedAt: new Date().toISOString(),
  };

  geminiKeyCooldowns.set(normalizedKey, nextState);
  return nextState;
}

function getGeminiRuntimeState(apiKey) {
  const normalizedKey = String(apiKey || '').trim();
  if (!normalizedKey) {
    return {
      inFlight: 0,
      lastStartedAt: 0,
      lastFinishedAt: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  if (!geminiKeyRuntimeState.has(normalizedKey)) {
    geminiKeyRuntimeState.set(normalizedKey, {
      inFlight: 0,
      lastStartedAt: 0,
      lastFinishedAt: 0,
      successCount: 0,
      failureCount: 0,
    });
  }

  return geminiKeyRuntimeState.get(normalizedKey);
}

function beginGeminiRequest(apiKey) {
  const state = getGeminiRuntimeState(apiKey);
  state.inFlight = Math.max(0, Number(state.inFlight || 0)) + 1;
  state.lastStartedAt = Date.now();
}

function finishGeminiRequest(apiKey, ok = false) {
  const state = getGeminiRuntimeState(apiKey);
  state.inFlight = Math.max(0, Number(state.inFlight || 0) - 1);
  state.lastFinishedAt = Date.now();
  if (ok) {
    state.successCount = Number(state.successCount || 0) + 1;
  } else {
    state.failureCount = Number(state.failureCount || 0) + 1;
  }
}

function orderGeminiKeysByRuntimeLoad(apiKeys) {
  const indexed = apiKeys.map((apiKey, index) => ({
    apiKey,
    index,
    state: getGeminiRuntimeState(apiKey),
  }));
  const idle = indexed.filter((entry) => Number(entry.state.inFlight || 0) < MAX_GEMINI_IN_FLIGHT_PER_KEY);
  const candidates = idle.length ? idle : indexed;

  return candidates
    .sort((left, right) => {
      const inFlightDiff = Number(left.state.inFlight || 0) - Number(right.state.inFlight || 0);
      if (inFlightDiff !== 0) return inFlightDiff;
      const startedDiff = Number(left.state.lastStartedAt || 0) - Number(right.state.lastStartedAt || 0);
      if (startedDiff !== 0) return startedDiff;
      return left.index - right.index;
    })
    .map((entry) => entry.apiKey);
}

function getGeminiKeyRotationOrder({ includeCoolingFallback = false } = {}) {
  const apiKeys = getGeminiApiKeys();
  const now = Date.now();
  const available = [];
  const cooling = [];

  apiKeys.forEach((apiKey, index) => {
    const state = geminiKeyCooldowns.get(apiKey);
    if (state && Number(state.cooldownUntil || 0) > now) {
      cooling.push({
        apiKey,
        cooldownUntil: Number(state.cooldownUntil || 0),
        index,
      });
      return;
    }

    if (state && Number(state.cooldownUntil || 0) <= now) {
      geminiKeyCooldowns.delete(apiKey);
    }

    available.push({ apiKey, index });
  });

  if (available.length > 0) {
    const ordered = available.sort((left, right) => left.index - right.index);
    const normalizedCursor = ((geminiRoundRobinCursor % apiKeys.length) + apiKeys.length) % apiKeys.length;
    let startIndex = ordered.findIndex((entry) => entry.index >= normalizedCursor);
    if (startIndex < 0) {
      startIndex = 0;
    }
    return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)].map((entry) => entry.apiKey);
  }

  if (!includeCoolingFallback) {
    return [];
  }

  return cooling
    .sort((left, right) => left.cooldownUntil - right.cooldownUntil || left.index - right.index)
    .map((entry) => entry.apiKey);
}

function advanceGeminiRoundRobinCursor(apiKey) {
  const apiKeys = getGeminiApiKeys();
  const usedIndex = apiKeys.indexOf(apiKey);
  if (usedIndex < 0 || apiKeys.length === 0) {
    geminiRoundRobinCursor += 1;
    return;
  }

  geminiRoundRobinCursor = (usedIndex + 1) % apiKeys.length;
}

function getGeminiApiKey() {
  return getGeminiApiKeys()[0] || '';
}

function hasAvailableGeminiKey() {
  return getGeminiKeyRotationOrder().length > 0;
}

function getAiProvider(preferred = process.env.AI_PROVIDER || 'auto', { includeCoolingFallback = false } = {}) {
  const normalizedPreferred = String(preferred || 'auto').toLowerCase();
  const hasGemini = getGeminiKeyRotationOrder({ includeCoolingFallback }).length > 0;
  const hasOpenAI = Boolean(openai);

  if (normalizedPreferred === 'openai' && hasOpenAI) return 'openai';
  if (normalizedPreferred === 'gemini' && hasGemini) return 'gemini';
  if (normalizedPreferred === 'mock') return 'mock';

  if (normalizedPreferred === 'openai' || normalizedPreferred === 'gemini') {
    return 'mock';
  }

  if (hasGemini) return 'gemini';
  if (hasOpenAI) return 'openai';
  return 'mock';
}

function isDevMocksEnabled() {
  return String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true';
}

function getAnalysisModelForProvider(provider, requestedModel) {
  if (provider === 'gemini') {
    return requestedModel || GEMINI_ANALYSIS_MODEL;
  }

  if (provider === 'openai') {
    return requestedModel || OPENAI_MODEL;
  }

  return requestedModel || 'mock-analysis';
}

function getEmbeddingModelForProvider(provider, requestedModel) {
  if (provider === 'gemini') {
    return requestedModel || GEMINI_EMBEDDING_MODEL;
  }

  if (provider === 'openai') {
    return requestedModel || 'text-embedding-3-small';
  }

  return requestedModel || 'mock-embedding';
}

function buildAnalysisText(title, transcript, description) {
  if (transcript && transcript.length > 100) {
    return `Title: ${title}\n\nTranscript (first 3000 chars): ${transcript.slice(0, 3000)}`;
  }

  return `Title: ${title}\n\nDescription: ${String(description || 'No description available.').slice(0, 2400)}`;
}

function cleanJsonPayload(text) {
  return String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('\n').trim();
}

async function readResponseText(response) {
  try {
    return (await response.text()).trim();
  } catch (error) {
    return '';
  }
}

async function fetchGeminiWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGeminiRequestTimeoutMs());

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function executeGeminiRequest({ model, action, body, parser, maxKeyAttempts = MAX_GEMINI_KEYS_PER_REQUEST, includeCoolingFallback = false }) {
  const apiKeys = getGeminiKeyRotationOrder({ includeCoolingFallback });
  if (apiKeys.length === 0) {
    const configuredKeys = getGeminiApiKeys();
    const health = getGeminiKeyHealthSummary(configuredKeys);
    const reason = configuredKeys.length
      ? `Gemini keys are temporarily cooling (${health.coolingKeys}/${configuredKeys.length}); next retry ${health.nextRetryAt || 'later'}.`
      : 'Gemini API key is not configured.';
    const unavailableError = new Error(reason);
    unavailableError.status = configuredKeys.length ? 429 : 0;
    throw unavailableError;
  }

  let lastError = new Error(`Gemini API request failed for ${model}:${action}.`);

  const orderedApiKeys = orderGeminiKeysByRuntimeLoad(apiKeys);
  const attempts = orderedApiKeys.slice(0, Math.max(1, Math.min(Number(maxKeyAttempts) || 1, orderedApiKeys.length)));

  for (let index = 0; index < attempts.length; index += 1) {
    const apiKey = attempts[index];
    // Advance the cursor immediately to support parallel processing and prevent concurrent pressure
    advanceGeminiRoundRobinCursor(apiKey);

    beginGeminiRequest(apiKey);
    let response;
    try {
      response = await fetchGeminiWithTimeout(`${GEMINI_API_URL}/${model}:${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      finishGeminiRequest(apiKey, false);
      const networkStatus = error?.name === 'AbortError' ? 503 : 500;
      const errorText = sanitizeAiErrorMessage(error);
      lastError = new Error(
        `Gemini API request failed (${model}:${action})${errorText ? ` ${errorText.slice(0, 240)}` : ''}`
      );
      markGeminiKeyCooldown(apiKey, networkStatus);
      if (index < attempts.length - 1) {
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      clearGeminiKeyCooldown(apiKey);
      finishGeminiRequest(apiKey, true);
      return parser(response);
    }

    const responseText = sanitizeAiErrorMessage(await readResponseText(response));
    finishGeminiRequest(apiKey, false);
    lastError = new Error(
      `Gemini API error (${model}:${action}) ${response.status}${responseText ? ` ${responseText.slice(0, 240)}` : ''}`
    );

    const shouldRotateKey = GEMINI_ROTATE_STATUSES.has(response.status) && index < attempts.length - 1;
    if (GEMINI_ROTATE_STATUSES.has(response.status)) {
      markGeminiKeyCooldown(apiKey, response.status);
    }
    if (!shouldRotateKey) {
      throw lastError;
    }
  }

  throw lastError;
}

async function generateGeminiJson(promptText, options = {}) {
  const {
    model = GEMINI_ANALYSIS_MODEL,
    temperature = 0.2,
  } = options;

  return executeGeminiRequest({
    model,
    action: 'generateContent',
    body: {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature,
      },
    },
    parser: async (response) => {
      const payload = await response.json();
      return JSON.parse(cleanJsonPayload(extractGeminiText(payload)));
    },
    maxKeyAttempts: options.maxKeyAttempts,
    includeCoolingFallback: options.includeCoolingFallback,
  });
}

async function generateGeminiEmbedding(text, options = {}) {
  const model = options.model || GEMINI_EMBEDDING_MODEL;

  return executeGeminiRequest({
    model,
    action: 'embedContent',
    body: {
      model: `models/${model}`,
      content: {
        parts: [{ text: String(text || '').slice(0, 2048) }],
      },
      output_dimensionality: 1536,
    },
    parser: async (response) => {
      const payload = await response.json();
      const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values || [];
      return normalizeVector(values);
    },
    maxKeyAttempts: options.maxKeyAttempts,
  });
}

function getMockAnalysis(title) {
  return {
    summary: `A deep dive into the subject matter of "${title}", drawing from expert insights and thorough analysis.`,
    topics: ['Technology', 'AI'],
    scores: { depth: 0.8, rarity: 0.4, freshness: 0.7, clickbait: 0.1, timeless: 0.6 },
    reason: 'Matches your interests in Technology and AI',
  };
}

function getLocalAnalysis(title, transcript = '', description = '') {
  const sourceText = String(transcript || description || title || '').replace(/\s+/g, ' ').trim();
  const firstSentence = sourceText.split(/(?<=[.!?])\s+/).find(Boolean) || '';
  const fallbackSummary = firstSentence
    ? firstSentence.slice(0, 260)
    : `Relevant update: ${String(title || 'Untitled item').slice(0, 180)}`;
  const combined = `${title || ''} ${description || ''} ${transcript || ''}`.toLowerCase();
  const topics = [];

  if (/\b(ai|model|openai|anthropic|gemini|deepmind|xai|hugging face|agent|llm)\b/.test(combined)) topics.push('Artificial Intelligence');
  if (/\b(iran|qatar|jordan|ukraine|war|airspace|missile|ceasefire|regional)\b/.test(combined)) topics.push('Regional Risk');
  if (/\b(stock|market|shares|ipo|s-1|investment|funding|earnings)\b/.test(combined)) topics.push('Markets');
  if (/\b(scholarship|fellowship|grant|fully funded|deadline)\b/.test(combined)) topics.push('Scholarships');
  if (/\b(job|internship|hiring|career|role)\b/.test(combined)) topics.push('Jobs');
  if (!topics.length) topics.push('General');

  return {
    summary: fallbackSummary,
    topics: topics.slice(0, 5),
    scores: {
      depth: sourceText.length > 1200 ? 0.7 : 0.45,
      rarity: 0.45,
      freshness: 0.65,
      clickbait: /shocking|you won't believe|insane|secret/i.test(String(title || '')) ? 0.7 : 0.12,
      timeless: 0.45,
    },
    reason: 'Local: ranked without live AI because the provider is unavailable.',
  };
}

function getMockEmbedding() {
  const values = new Array(16).fill(0).map((_, index) => (index % 2 === 0 ? 0.25 : -0.25));
  return normalizeVector(values);
}

async function generateOpenAiStructuredJson({ systemPrompt, userPrompt, model, temperature }) {
  const res = await openai.chat.completions.create({
    model: model || OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0]?.message?.content || '{}');
}

exports.analyzeContent = async (title, transcript, description = '', options = {}) => {
  const providerPreference = options.providerPreference || 'auto';
  const provider = getAiProvider(providerPreference);
  const contentText = buildAnalysisText(title, transcript, description);
  const model = getAnalysisModelForProvider(provider, options.model);

  if (provider === 'mock') {
    const localAnalysis = isDevMocksEnabled() ? getMockAnalysis(title) : getLocalAnalysis(title, transcript, description);
    console.warn('[AI] No live provider available - returning local analysis fallback');
    return {
      ...localAnalysis,
      analysis_provider: isDevMocksEnabled() ? 'mock' : 'local',
      analysis_model: isDevMocksEnabled() ? model : 'deterministic-analysis',
      analysis_error: 'No live AI provider is currently available.',
    };
  }

  try {
    console.log(`[AI] Analyzing "${title}" with ${provider} (${model})...`);

    let parsed;
    if (provider === 'gemini') {
      parsed = await generateGeminiJson(`${ANALYSIS_PROMPT}\n\n${contentText}`, {
        model,
        temperature: options.temperature ?? 0.2,
      });
    } else {
      parsed = await generateOpenAiStructuredJson({
        systemPrompt: ANALYSIS_PROMPT,
        userPrompt: contentText,
        model,
        temperature: options.temperature ?? 0.2,
      });
    }

    return {
      summary: parsed.summary || 'No summary available.',
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      scores: {
        depth: clamp(parsed.scores?.depth || 0.5),
        rarity: clamp(parsed.scores?.rarity || 0.5),
        freshness: clamp(parsed.scores?.freshness || 0.5),
        clickbait: clamp(parsed.scores?.clickbait || 0.1),
        timeless: clamp(parsed.scores?.timeless || 0.5),
      },
      reason: parsed.reason || `Matches your interests in ${(parsed.topics || []).join(', ')}`,
      analysis_provider: provider,
      analysis_model: model,
      analysis_error: null,
    };
  } catch (error) {
    const safeError = sanitizeAiErrorMessage(error);
    console.warn(`[AI] Analysis degraded: ${safeError}`);
    if (providerPreference === 'auto' && provider === 'gemini' && openai && !options.fallbackAttempt) {
      console.warn('[AI] Retrying analysis with the secondary OpenAI provider.');
      return exports.analyzeContent(title, transcript, description, {
        ...options,
        providerPreference: 'openai',
        model: undefined,
        fallbackAttempt: true,
      });
    }
    if (isDevMocksEnabled()) {
      return {
        ...getMockAnalysis(title),
        analysis_provider: 'mock',
        analysis_model: 'mock-analysis',
        analysis_error: safeError,
      };
    }

    return {
      ...getLocalAnalysis(title, transcript, description),
      analysis_provider: 'local',
      analysis_model: 'deterministic-analysis',
      analysis_error: safeError,
    };
  }
};

exports.generateEmbeddingWithMetadata = async (text, options = {}) => {
  const provider = getAiProvider(options.providerPreference || 'auto');
  const model = getEmbeddingModelForProvider(provider, options.model);

  if (provider === 'mock') {
    console.warn('[AI] No live embedding provider available - returning empty embedding fallback');
    return {
      values: isDevMocksEnabled() ? getMockEmbedding() : [],
      embedding_provider: isDevMocksEnabled() ? 'mock' : 'local',
      embedding_model: isDevMocksEnabled() ? model : 'none',
      embedding_error: 'No live embedding provider is currently available.',
    };
  }

  try {
    console.log(`[AI] Generating embedding with ${provider} (${model}) (${String(text || '').slice(0, 50)}...)...`);

    let values;

    if (provider === 'gemini') {
      values = await generateGeminiEmbedding(text, { ...options, model });
    } else {
      const res = await openai.embeddings.create({
        model,
        input: String(text || '').slice(0, 8000),
      });

      values = normalizeVector(res.data[0]?.embedding || []);
    }

    return {
      values,
      embedding_provider: provider,
      embedding_model: model,
      embedding_error: null,
    };
  } catch (error) {
    const safeError = sanitizeAiErrorMessage(error);
    console.warn(`[AI] Embedding degraded: ${safeError}`);
    if (isDevMocksEnabled()) {
      return {
        values: getMockEmbedding(),
        embedding_provider: 'mock',
        embedding_model: 'mock-embedding',
        embedding_error: safeError,
      };
    }

    return {
      values: [],
      embedding_provider: provider,
      embedding_model: model,
      embedding_error: safeError,
    };
  }
};

exports.generateEmbedding = async (text, options = {}) => {
  const result = await exports.generateEmbeddingWithMetadata(text, options);
  return result.values;
};

exports.generateStructuredJson = async ({
  systemPrompt,
  userPrompt,
  providerPreference = 'auto',
  model,
  temperature = 0.2,
  maxKeyAttempts,
  includeCoolingFallback = false,
}) => {
  const provider = getAiProvider(providerPreference, { includeCoolingFallback });

  if (provider === 'mock') {
    throw new Error('No AI provider is configured for structured generation.');
  }

  if (provider === 'gemini') {
    try {
      return await generateGeminiJson(`${systemPrompt}\n\n${userPrompt}`, {
        model: model || GEMINI_FLASH_LITE_MODEL,
        temperature,
        maxKeyAttempts,
        includeCoolingFallback,
      });
    } catch (error) {
      if (providerPreference === 'auto' && openai) {
        console.warn(`[AI] Gemini structured generation failed; retrying with OpenAI: ${sanitizeAiErrorMessage(error)}`);
        return generateOpenAiStructuredJson({
          systemPrompt,
          userPrompt,
          model: OPENAI_MODEL,
          temperature,
        });
      }
      throw error;
    }
  }

  return generateOpenAiStructuredJson({
    systemPrompt,
    userPrompt,
    model: model || OPENAI_MODEL,
    temperature,
  });
};

function sanitizeProbeError(error) {
  return sanitizeAiErrorMessage(error).slice(0, 240);
}

function getLastLiveProbe() {
  return { ...lastLiveProbe };
}

function resetLiveProbe() {
  lastLiveProbe = {
    status: 'never_run',
    provider: '',
    model: '',
    checkedAt: '',
    latencyMs: null,
    error: '',
  };
}

exports.probeLiveProvider = async ({
  providerPreference = 'gemini',
  timeoutMs = 8000,
  maxKeyAttempts = 3,
} = {}) => {
  const startedAt = Date.now();
  const provider = getAiProvider(providerPreference);
  const model = provider === 'gemini' ? GEMINI_FLASH_LITE_MODEL : OPENAI_MODEL;

  if (provider === 'mock') {
    lastLiveProbe = {
      status: 'failed',
      provider: '',
      model: '',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      error: 'No live AI provider is configured.',
    };
    return getLastLiveProbe();
  }

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`AI live probe timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  try {
    const result = await Promise.race([
      exports.generateStructuredJson({
        providerPreference,
        temperature: 0,
        // Probe a small eligible subset so one invalid key cannot make the
        // entire configured pool appear unavailable.
        maxKeyAttempts: provider === 'gemini'
          ? Math.max(1, Math.min(Number(maxKeyAttempts) || 1, 3))
          : 1,
        systemPrompt: 'Return only valid JSON. This is a health probe for eXplore.',
        userPrompt: 'Return JSON exactly shaped as {"ok":true,"label":"live"}',
      }),
      timeout,
    ]);

    if (result?.ok !== true || String(result?.label || '').toLowerCase() !== 'live') {
      throw new Error('AI live probe returned an unexpected JSON shape.');
    }

    lastLiveProbe = {
      status: 'live',
      provider,
      model,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: '',
    };
  } catch (error) {
    lastLiveProbe = {
      status: 'failed',
      provider,
      model,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: sanitizeProbeError(error),
    };
  }

  return getLastLiveProbe();
};

function getModelPoolStatus() {
  const geminiKeys = getGeminiApiKeys();
  const geminiHealth = getGeminiKeyHealthSummary(geminiKeys);

  return {
    activeProvider: getAiProvider(),
    gemini: {
      configured: geminiKeys.length > 0,
      configuredKeys: geminiKeys.length,
      rotationEnabled: geminiKeys.length > 1,
      ...geminiHealth,
      defaultAnalysisModel: GEMINI_ANALYSIS_MODEL,
      defaultTemplateModel: GEMINI_FLASH_LITE_MODEL,
      defaultEmbeddingModel: GEMINI_EMBEDDING_MODEL,
    },
    openai: {
      configured: Boolean(openai),
      defaultModel: OPENAI_MODEL,
    },
  };
}

function getGeminiKeyHealthSummary(geminiKeys = getGeminiApiKeys()) {
  const now = Date.now();
  const cooling = [];
  let busyKeys = 0;

  for (const apiKey of geminiKeys) {
    const runtimeState = getGeminiRuntimeState(apiKey);
    if (Number(runtimeState.inFlight || 0) > 0) {
      busyKeys += 1;
    }
    const state = geminiKeyCooldowns.get(apiKey);
    if (state && Number(state.cooldownUntil || 0) > now) {
      cooling.push(state);
    }
  }

  const cooldownStatuses = {};
  for (const state of cooling) {
    const status = String(state.status || 'unknown');
    cooldownStatuses[status] = (cooldownStatuses[status] || 0) + 1;
  }

  const nextRetryAt = cooling.length
    ? new Date(Math.min(...cooling.map((state) => Number(state.cooldownUntil || now)))).toISOString()
    : null;

  return {
    availableKeys: Math.max(0, geminiKeys.length - cooling.length),
    busyKeys,
    coolingKeys: cooling.length,
    cooldownStatuses,
    nextRetryAt,
    degraded: geminiKeys.length > 0 && cooling.length > 0,
  };
}

function getSafeModelPoolDiagnostics() {
  const status = getModelPoolStatus();

  return {
    provider: status.activeProvider,
    model: status.gemini.defaultAnalysisModel,
    keyCount: status.gemini.configuredKeys,
    availableKeyCount: status.gemini.availableKeys,
    busyKeyCount: status.gemini.busyKeys,
    coolingKeyCount: status.gemini.coolingKeys,
    cooldownStatuses: status.gemini.cooldownStatuses,
    nextRetryAt: status.gemini.nextRetryAt,
    degraded: status.gemini.degraded,
    rotationEnabled: status.gemini.rotationEnabled,
    openaiConfigured: status.openai.configured,
    liveProbe: getLastLiveProbe(),
  };
}

exports.getModelPoolStatus = getModelPoolStatus;
exports.getSafeModelPoolDiagnostics = getSafeModelPoolDiagnostics;
exports.getLastLiveProbe = getLastLiveProbe;

exports.__test__ = {
  getAiProvider,
  getGeminiApiKey,
  getGeminiApiKeys,
  getGeminiKeyRotationOrder,
  hasAvailableGeminiKey,
  getGeminiKeyHealthSummary,
  isUsableApiKey,
  executeGeminiRequest,
  generateGeminiEmbedding,
  generateGeminiJson,
  clearGeminiKeyCooldown,
  markGeminiKeyCooldown,
  getGeminiCooldownDurationMs,
  getGeminiCooldownStatus,
  normalizeGeminiModelName,
  sanitizeAiErrorMessage,
  getLastLiveProbe,
  getSafeModelPoolDiagnostics,
  resetLiveProbe,
  resetGeminiKeyCooldowns: () => {
    geminiKeyCooldowns.clear();
    geminiKeyRuntimeState.clear();
    geminiRoundRobinCursor = 0;
  },
  normalizeVector,
};
