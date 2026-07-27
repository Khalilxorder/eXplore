'use strict';

/**
 * xAI (Grok) multi-account provider.
 * OpenAI-compatible API: https://api.x.ai/v1
 * Secrets stay server-side only.
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const XAI_BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const MAX_ACCOUNTS = 8;
const DEFAULT_CHAT_MODEL = 'grok-4';
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES_PER_ACCOUNT = 2;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 2500;
const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Math.min(120000, Number(process.env.XAI_TIMEOUT_MS || 60000) || 60000)
);

const KNOWN_MODELS = [
  { id: 'grok-4', label: 'Grok 4', provider: 'xai' },
  { id: 'grok-4-0709', label: 'Grok 4 (0709)', provider: 'xai' },
  { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning', provider: 'xai' },
  { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast Non-Reasoning', provider: 'xai' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xai' },
  { id: 'grok-3-mini', label: 'Grok 3 Mini', provider: 'xai' },
  { id: 'grok-3-fast', label: 'Grok 3 Fast', provider: 'xai' },
  { id: 'grok-2-1212', label: 'Grok 2', provider: 'xai' },
  { id: 'grok-2-vision-1212', label: 'Grok 2 Vision', provider: 'xai' },
  { id: 'grok-beta', label: 'Grok Beta', provider: 'xai' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'gemini' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'gemini' },
];

const SENSITIVE_KEY_RE =
  /^(api[_-]?key|apikey|key|secret|token|authorization|password|credential|x[_-]?api[_-]?key)$/i;

function homeDevConfigPath(...parts) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return home ? path.join(home, '.dev-config', ...parts) : '';
}

function defaultPoolPath() {
  return process.env.XAI_KEY_POOL_FILE || homeDevConfigPath('xai-key-pool.json');
}

function usagePath() {
  return process.env.XAI_USAGE_FILE || homeDevConfigPath('xai-usage.json');
}

function activeAccountPath() {
  return (
    process.env.XAI_ACTIVE_ACCOUNT_FILE || homeDevConfigPath('xai-active-account.json')
  );
}

function isUsableKey(value) {
  // Never treat empty string, whitespace, or short/placeholder values as valid keys.
  if (value == null) return false;
  const key = String(value).trim();
  if (!key || key.length < 12) return false;
  if (/YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO|TODO|INSERT|xxx+/i.test(key)) {
    return false;
  }
  return true;
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '••••';
  if (value.length < 12) return '••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Redact API-key-like substrings from free text (logs / error rows).
 * Never log full API keys.
 */
function redactSecretsInText(text, knownKeys = []) {
  let out = String(text ?? '');
  if (!out) return out;
  for (const key of knownKeys) {
    const raw = String(key || '').trim();
    if (raw.length >= 8 && out.includes(raw)) {
      out = out.split(raw).join(maskKey(raw));
    }
  }
  // Common secret prefixes (xAI, OpenAI, Gemini, Google)
  out = out.replace(/(xai-|sk-|gsk_|AIza)[A-Za-z0-9_\-]{8,}/gi, (match) => maskKey(match));
  // Bearer tokens
  out = out.replace(/(Bearer\s+)[A-Za-z0-9_\-.]{12,}/gi, (_, p1) => `${p1}••••`);
  return out;
}

/**
 * Deep-sanitize objects so API keys / secrets never leave the process.
 * - Renames known secret fields to maskedKey / redacts value
 * - Masks long strings that look like API keys (xai-..., sk-..., long tokens)
 */
function sanitizeForPublic(value, keyHint = '') {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_RE.test(keyHint)) return maskKey(value);
    // Heuristic: long opaque tokens that look like API keys
    if (
      value.length >= 20 &&
      /^(xai-|sk-|gsk_|AIza)[A-Za-z0-9_\-]{10,}$/i.test(value)
    ) {
      return maskKey(value);
    }
    // Free-text fields (errors/notes) may embed keys mid-string
    if (/error|message|detail|note|reason/i.test(keyHint) && /(xai-|sk-|gsk_|AIza)[A-Za-z0-9_\-]{8,}/i.test(value)) {
      return redactSecretsInText(value);
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPublic(item, keyHint));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'key' || k === 'apiKey' || SENSITIVE_KEY_RE.test(k)) {
      // Never expose raw secrets; always surface as maskedKey when present
      if (typeof v === 'string' && v) {
        out.maskedKey = out.maskedKey || maskKey(v);
      }
      continue;
    }
    if (k === 'maskedKey' && typeof v === 'string') {
      // Keep pre-masked values; re-mask only if a raw secret slipped through
      out.maskedKey = /[…•]/.test(v) ? v : maskKey(v);
      continue;
    }
    out[k] = sanitizeForPublic(v, k);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`[xAI] Failed to write ${filePath}: ${error.message}`);
  }
}

function loadAccountsFromEnv() {
  const accounts = [];
  const primary = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.XAI_KEY;
  if (isUsableKey(primary)) {
    accounts.push({
      id: 'xai-env-primary',
      label: process.env.XAI_ACCOUNT_LABEL || 'xAI account 1',
      key: String(primary).trim(),
      enabled: true,
      source: 'env',
    });
  }

  for (let i = 1; i <= MAX_ACCOUNTS; i += 1) {
    const key = process.env[`XAI_API_KEY_${i}`] || process.env[`GROK_API_KEY_${i}`];
    if (!isUsableKey(key)) continue;
    accounts.push({
      id: `xai-env-${i}`,
      label: process.env[`XAI_ACCOUNT_LABEL_${i}`] || `xAI account ${i}`,
      key: String(key).trim(),
      enabled: true,
      source: 'env',
    });
  }

  const csv = String(process.env.XAI_API_KEYS || '')
    .split(/[\n,;]/)
    .map((v) => v.trim())
    .filter(isUsableKey);
  csv.forEach((key, index) => {
    accounts.push({
      id: `xai-csv-${index + 1}`,
      label: `xAI CSV ${index + 1}`,
      key,
      enabled: true,
      source: 'env_csv',
    });
  });

  return accounts;
}

function loadAccountsFromPoolFile() {
  const pool = readJsonSafe(defaultPoolPath(), null);
  if (!pool) return [];
  const entries = Array.isArray(pool) ? pool : Array.isArray(pool.keys) ? pool.keys : [];
  return entries
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return isUsableKey(entry)
          ? {
              id: `xai-pool-${index + 1}`,
              label: `xAI pool ${index + 1}`,
              key: entry.trim(),
              enabled: true,
              source: 'pool',
            }
          : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const key = String(entry.key || entry.apiKey || entry.value || '').trim();
      if (!isUsableKey(key)) return null;
      return {
        id: String(entry.id || `xai-pool-${index + 1}`),
        label: String(entry.label || entry.account || entry.name || `xAI account ${index + 1}`),
        key,
        enabled: entry.enabled !== false,
        source: 'pool',
        notes: entry.notes || '',
      };
    })
    .filter(Boolean);
}

function dedupeAccounts(accounts) {
  const byKey = new Map();
  for (const account of accounts) {
    if (!account?.key) continue;
    if (!byKey.has(account.key)) {
      byKey.set(account.key, account);
    }
  }
  return [...byKey.values()];
}

function getAccounts() {
  return dedupeAccounts([...loadAccountsFromEnv(), ...loadAccountsFromPoolFile()]);
}

function loadUsageStore() {
  return readJsonSafe(usagePath(), {
    updatedAt: null,
    accounts: {},
  });
}

function saveUsageStore(store) {
  store.updatedAt = new Date().toISOString();
  writeJsonSafe(usagePath(), store);
}

function emptyUsageRow() {
  return {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    errors: 0,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    last_model: null,
  };
}

function ensureUsageAccount(store, accountId) {
  if (!store.accounts[accountId]) {
    store.accounts[accountId] = emptyUsageRow();
  }
  return store.accounts[accountId];
}

function recordUsage({ accountId, model, usage, error, knownKeys = [] }) {
  if (!accountId) return;
  const store = loadUsageStore();
  const row = ensureUsageAccount(store, accountId);
  if (error) {
    row.errors += 1;
    row.last_error_at = new Date().toISOString();
    row.last_error = redactSecretsInText(String(error), knownKeys).slice(0, 240);
  } else {
    row.requests += 1;
    const promptTokens = Number(usage?.prompt_tokens || usage?.input_tokens || 0);
    const completionTokens = Number(usage?.completion_tokens || usage?.output_tokens || 0);
    const totalTokens = Number(usage?.total_tokens || 0);
    row.prompt_tokens += promptTokens;
    row.completion_tokens += completionTokens;
    // Prefer API total_tokens; otherwise sum prompt + completion (no double-count).
    if (totalTokens > 0) {
      row.total_tokens += totalTokens;
    } else {
      row.total_tokens += promptTokens + completionTokens;
    }
    row.last_success_at = new Date().toISOString();
    row.last_model = model || row.last_model;
    row.last_error = null;
  }
  saveUsageStore(store);
}

function getActiveAccountId() {
  const fromEnv = String(process.env.XAI_ACTIVE_ACCOUNT_ID || '').trim();
  if (fromEnv) return fromEnv;
  const saved = readJsonSafe(activeAccountPath(), null);
  return String(saved?.activeAccountId || '').trim();
}

function setActiveAccountId(accountId) {
  const id = String(accountId || '').trim();
  if (!id) {
    throw new Error('accountId is required.');
  }
  const accounts = getAccounts().filter((a) => a.enabled);
  const match = accounts.find((a) => a.id === id);
  if (!match) {
    throw new Error(`Unknown xAI account id: ${id}`);
  }
  writeJsonSafe(activeAccountPath(), {
    activeAccountId: match.id,
    updatedAt: new Date().toISOString(),
  });
  return match.id;
}

/** Alias matching public API naming used by docs / callers. */
function setActiveAccount(accountId) {
  return setActiveAccountId(accountId);
}

function resolveActiveAccount(preferredAccountId) {
  const accounts = getAccounts().filter((a) => a.enabled);
  if (!accounts.length) return null;
  if (preferredAccountId) {
    const preferred = accounts.find((a) => a.id === preferredAccountId);
    if (preferred) return preferred;
  }
  const activeId = getActiveAccountId();
  if (activeId) {
    const active = accounts.find((a) => a.id === activeId);
    if (active) return active;
  }
  return accounts[0];
}

/**
 * Ordered account list: preferred/active first, then remaining enabled accounts
 * (used when preferred hits 429/503 and we may rotate).
 */
function orderAccountsForAttempt(preferredAccountId) {
  const accounts = getAccounts().filter((a) => a.enabled);
  if (!accounts.length) return [];
  const preferred = resolveActiveAccount(preferredAccountId);
  if (!preferred) return accounts;
  const rest = accounts.filter((a) => a.id !== preferred.id);
  return [preferred, ...rest];
}

function defaultCreateClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: XAI_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0, // we handle retries / account rotation ourselves
    defaultHeaders: {
      'User-Agent': 'eXplore-backend-xaiProvider/1.0',
    },
  });
}

/** Overridable for offline unit tests — never used in production paths. */
let createClientImpl = defaultCreateClient;

function createClient(apiKey) {
  return createClientImpl(apiKey);
}

function getErrorStatus(error) {
  const status =
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    error?.error?.status ||
    null;
  const n = Number(status);
  return Number.isFinite(n) ? n : null;
}

function isRetryableError(error) {
  const status = getErrorStatus(error);
  if (status && RETRY_STATUSES.has(status)) return true;
  const message = String(error?.message || error || '').toLowerCase();
  if (/\b(429|503|rate limit|too many requests|overloaded|unavailable|high demand)\b/.test(message)) {
    return true;
  }
  // Transient network glitches (not auth/model errors)
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
    return true;
  }
  if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'APIConnectionError') {
    return true;
  }
  return false;
}

function shouldRotateAccount(error) {
  // Rotate on rate-limit / capacity; do not rotate on 401/403 (bad key) for every account blindly —
  // still allow rotate so a different key can succeed if only one key is invalid.
  const status = getErrorStatus(error);
  if (status && RETRY_STATUSES.has(status)) return true;
  if (status === 401 || status === 403) return true;
  return isRetryableError(error);
}

function backoffMs(attempt) {
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt) + jitter);
}

function humanizeModelId(id) {
  const raw = String(id || '').trim();
  if (!raw) return 'Unknown';
  const known = KNOWN_MODELS.find((m) => m.id === raw);
  if (known) return known.label;
  return raw
    .replace(/^grok-/, 'Grok ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Merge static known models with live API model ids (live wins for labels when new).
 */
function mergeKnownAndLiveModels(liveModelIds = []) {
  const byId = new Map();
  for (const model of KNOWN_MODELS) {
    byId.set(model.id, { ...model });
  }
  for (const raw of liveModelIds || []) {
    const id = typeof raw === 'string' ? raw.trim() : String(raw?.id || '').trim();
    if (!id) continue;
    if (byId.has(id)) {
      byId.set(id, { ...byId.get(id), live: true });
    } else {
      byId.set(id, {
        id,
        label: humanizeModelId(id),
        provider: 'xai',
        live: true,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function listModelsForKey(apiKey) {
  const client = createClient(apiKey);
  try {
    const response = await client.models.list();
    const data = Array.isArray(response?.data) ? response.data : [];
    return data
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
      .sort();
  } catch (error) {
    return {
      error: redactSecretsInText(String(error?.message || error), [apiKey]).slice(0, 200),
      models: [],
    };
  }
}

function normalizeChatMessages(messages, systemPrompt = '') {
  const finalMessages = [];
  if (systemPrompt) {
    finalMessages.push({ role: 'system', content: String(systemPrompt) });
  }
  for (const message of messages || []) {
    if (!message) continue;
    let role = String(message.role || 'user').toLowerCase();
    if (role === 'system') {
      // Keep explicit system turns (rare from clients)
    } else if (role === 'assistant' || role === 'model') {
      role = 'assistant';
    } else {
      role = 'user';
    }
    const content = String(message.content ?? message.text ?? '').trim();
    if (!content) continue;
    finalMessages.push({ role, content });
  }
  return finalMessages;
}

async function chatCompletionOnce(account, { messages, model, temperature, systemPrompt, max_tokens }) {
  const client = createClient(account.key);
  const finalMessages = normalizeChatMessages(messages, systemPrompt);
  if (!finalMessages.length) {
    throw new Error('No messages provided for xAI chat.');
  }

  const payload = {
    model: model || DEFAULT_CHAT_MODEL,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    messages: finalMessages,
  };
  if (max_tokens != null && Number.isFinite(Number(max_tokens))) {
    payload.max_tokens = Number(max_tokens);
  }

  const response = await client.chat.completions.create(payload);
  const text = String(response?.choices?.[0]?.message?.content || '').trim();
  const usage = response?.usage || {};
  return {
    text,
    usage,
    model: response?.model || payload.model,
    accountId: account.id,
    accountLabel: account.label,
    provider: 'xai',
    baseUrl: XAI_BASE_URL,
  };
}

/**
 * Chat completion against https://api.x.ai/v1 via OpenAI SDK.
 * Retries on 429/503 with short exponential backoff; if preferred account
 * still fails as retryable, tries the next configured account.
 */
async function chatCompletion({
  messages,
  model = DEFAULT_CHAT_MODEL,
  temperature = 0.7,
  accountId = null,
  systemPrompt = '',
  max_tokens = null,
  allowAccountFailover = true,
}) {
  const accountOrder = orderAccountsForAttempt(accountId);
  if (!accountOrder.length) {
    throw new Error('No xAI API keys configured. Add XAI_API_KEY_1..3 or xai-key-pool.json.');
  }

  // Prefer only the preferred account when failover is disabled
  const accountsToTry = allowAccountFailover
    ? accountOrder
    : accountOrder.slice(0, 1);

  let lastError = null;

  for (let accountIndex = 0; accountIndex < accountsToTry.length; accountIndex += 1) {
    const account = accountsToTry[accountIndex];
    const attempts = MAX_RETRIES_PER_ACCOUNT + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await chatCompletionOnce(account, {
          messages,
          model,
          temperature,
          systemPrompt,
          max_tokens,
        });
        recordUsage({
          accountId: account.id,
          model: result.model,
          usage: result.usage,
          knownKeys: [account.key],
        });
        return result;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error);
        const status = getErrorStatus(error);
        const safeMessage = redactSecretsInText(String(error?.message || error), [account.key]);
        recordUsage({
          accountId: account.id,
          model,
          error: `${status ? `${status}: ` : ''}${safeMessage}`,
          knownKeys: [account.key],
        });

        if (retryable && attempt < attempts - 1) {
          const wait = backoffMs(attempt);
          console.warn(
            `[xAI] ${status || 'retryable'} on account ${account.id} (attempt ${attempt + 1}/${attempts}); backoff ${wait}ms`
          );
          await sleep(wait);
          continue;
        }

        // Move to next account if allowed and error suggests it might help
        if (
          allowAccountFailover &&
          accountIndex < accountsToTry.length - 1 &&
          shouldRotateAccount(error)
        ) {
          console.warn(
            `[xAI] Failing over from ${account.id} after error: ${safeMessage.slice(0, 160)}`
          );
          break;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error('xAI chat completion failed.');
}

async function probeAccount(account) {
  const started = Date.now();
  const knownKeys = account?.key ? [account.key] : [];
  try {
    const modelsResult = await listModelsForKey(account.key);
    const models = Array.isArray(modelsResult) ? modelsResult : modelsResult.models || [];
    const error = Array.isArray(modelsResult)
      ? null
      : redactSecretsInText(modelsResult.error || '', knownKeys) || null;
    // lightweight completion probe only if models list worked
    let completionOk = false;
    let completionError = null;
    if (models.length && !error) {
      try {
        const client = createClient(account.key);
        const preferred =
          models.find((id) => /grok-4|grok-3|grok-2/i.test(id)) ||
          models[0];
        const response = await client.chat.completions.create({
          model: preferred,
          temperature: 0,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        });
        completionOk = Boolean(response?.choices?.[0]?.message?.content);
      } catch (probeError) {
        completionError = redactSecretsInText(
          String(probeError?.message || probeError),
          knownKeys
        ).slice(0, 200);
      }
    }
    return sanitizeForPublic({
      id: account.id,
      label: account.label,
      ok: !error && (completionOk || models.length > 0),
      models,
      latencyMs: Date.now() - started,
      error: error || completionError,
      maskedKey: maskKey(account.key),
    });
  } catch (error) {
    return sanitizeForPublic({
      id: account.id,
      label: account.label,
      ok: false,
      models: [],
      latencyMs: Date.now() - started,
      error: redactSecretsInText(String(error?.message || error), knownKeys).slice(0, 200),
      maskedKey: maskKey(account.key),
    });
  }
}

function buildPublicAccount(account, usageRow) {
  return {
    id: account.id,
    label: account.label,
    enabled: account.enabled,
    source: account.source,
    maskedKey: maskKey(account.key),
    usage: usageRow || emptyUsageRow(),
    // Explicitly omit: key, apiKey, secret, token
  };
}

/**
 * Safe catalog for UI / API. Never includes raw API keys — only maskedKey.
 * When options.liveModels is provided, merges them into models.xai / models.all.
 * For live network fetch, use catalog({ live: true }) / getUsageSnapshot({ live: true }).
 */
function getCatalog(options = {}) {
  const accounts = getAccounts().filter((a) => a.enabled);
  const active = resolveActiveAccount(options.accountId);
  const usageStore = loadUsageStore();
  const usage = {};
  for (const account of accounts) {
    usage[account.id] = usageStore.accounts[account.id] || emptyUsageRow();
  }

  const liveIds = Array.isArray(options.liveModels)
    ? options.liveModels.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean)
    : [];
  const mergedXai = mergeKnownAndLiveModels(liveIds);

  const catalogPayload = {
    provider: 'xai',
    baseUrl: XAI_BASE_URL,
    activeAccountId: active?.id || null,
    activeAccountLabel: active?.label || null,
    accounts: accounts.map((account) => buildPublicAccount(account, usage[account.id])),
    models: {
      xai: mergedXai,
      known: KNOWN_MODELS.map((m) => ({ ...m })),
      gemini: GEMINI_MODELS.map((m) => ({ ...m })),
      all: [
        ...mergedXai,
        ...GEMINI_MODELS.map((m) => ({ ...m })),
        { id: 'gemini', label: 'Gemini (auto)', provider: 'gemini' },
        { id: 'balanced', label: 'Balanced auto', provider: 'auto' },
      ],
    },
    knownModels: KNOWN_MODELS.map((m) => ({ ...m })),
    configured: accounts.length > 0,
    accountCount: accounts.length,
  };

  return sanitizeForPublic(catalogPayload);
}

async function getUsageSnapshot(options = {}) {
  let liveModels = [];
  let probe = null;
  const active = resolveActiveAccount(options.accountId);

  if (active && options.live) {
    probe = await probeAccount(active);
    liveModels = probe.models || [];
  }

  const catalogPayload = getCatalog({
    accountId: options.accountId,
    liveModels,
  });

  return sanitizeForPublic({
    ...catalogPayload,
    liveModels: liveModels.map((id) => ({
      id,
      label: humanizeModelId(id),
      provider: 'xai',
      live: true,
    })),
    probe,
    note: liveModels.length
      ? 'Live model list fetched from xAI for the active account (merged with known models).'
      : 'Showing known Grok models. Pass live=1 to merge the live catalog from the active account.',
  });
}

/**
 * Public catalog helper.
 * - catalog() / catalog({ live: false }) → known models + masked accounts (no network)
 * - catalog({ live: true }) → probes active account and merges live models
 */
async function catalog(options = {}) {
  if (options.live) {
    return getUsageSnapshot({
      accountId: options.accountId || null,
      live: true,
    });
  }
  return getCatalog(options);
}

/**
 * Local usage snapshot (no network). Alias of getUsageSnapshot({ live: false }).
 */
async function getUsage(options = {}) {
  return getUsageSnapshot({
    accountId: options.accountId || null,
    live: false,
  });
}

/** Probe helpers: active account, optional accountId override, or explicit account object. */
async function probe(options = {}) {
  if (options && typeof options === 'object' && options.key && options.id) {
    return probeAccount(options);
  }
  const account = resolveActiveAccount(options?.accountId || null);
  if (!account) {
    return sanitizeForPublic({
      ok: false,
      models: [],
      latencyMs: 0,
      error: 'No xAI accounts configured.',
      maskedKey: '••••',
    });
  }
  return probeAccount(account);
}

function poolTemplateSlots() {
  return [
    {
      id: 'xai-account-1',
      label: 'xAI account 1',
      key: '',
      enabled: true,
      notes: 'Paste XAI API key here',
    },
    {
      id: 'xai-account-2',
      label: 'xAI account 2',
      key: '',
      enabled: true,
      notes: 'Paste XAI API key here',
    },
    {
      id: 'xai-account-3',
      label: 'xAI account 3',
      key: '',
      enabled: true,
      notes: 'Paste XAI API key here',
    },
  ];
}

/**
 * Ensure ~/.dev-config/xai-key-pool.json exists with 3 empty slots.
 * If the file already exists with a shorter object.keys array, pad to 3
 * without overwriting existing entries or inventing keys.
 */
function ensurePoolFileTemplate() {
  const poolFile = defaultPoolPath();
  if (!poolFile) return poolFile;

  const slots = poolTemplateSlots();

  if (!fs.existsSync(poolFile)) {
    writeJsonSafe(poolFile, {
      version: 1,
      updatedAt: new Date().toISOString(),
      usage: 'Backend-only xAI (Grok) key pool. Do not commit this file.',
      keys: slots,
    });
    return poolFile;
  }

  // Pad object-shaped pools that have fewer than 3 slots (do not rewrite array pools).
  const existing = readJsonSafe(poolFile, null);
  if (existing && !Array.isArray(existing) && Array.isArray(existing.keys) && existing.keys.length < 3) {
    const keys = [...existing.keys];
    for (let i = keys.length; i < 3; i += 1) {
      keys.push({ ...slots[i] });
    }
    writeJsonSafe(poolFile, {
      ...existing,
      keys,
      updatedAt: new Date().toISOString(),
    });
  }

  return poolFile;
}

module.exports = {
  // Account loading / selection
  getAccounts,
  getActiveAccountId,
  setActiveAccountId,
  setActiveAccount,
  resolveActiveAccount,
  orderAccountsForAttempt,
  // Catalog + usage (masked public surfaces)
  getCatalog,
  catalog,
  getUsageSnapshot,
  getUsage,
  // Chat + health
  chatCompletion,
  listModelsForKey,
  probeAccount,
  probe,
  // Pool / paths
  ensurePoolFileTemplate,
  defaultPoolPath,
  usagePath,
  activeAccountPath,
  // Utilities
  mergeKnownAndLiveModels,
  maskKey,
  sanitizeForPublic,
  redactSecretsInText,
  isUsableKey,
  isRetryableError,
  recordUsage,
  // Constants used by server.js
  KNOWN_MODELS,
  GEMINI_MODELS,
  DEFAULT_CHAT_MODEL,
  XAI_BASE_URL,
  // Offline test hooks only — do not use in production routes
  __test__: {
    setClientFactory(factory) {
      createClientImpl = typeof factory === 'function' ? factory : defaultCreateClient;
    },
    resetClientFactory() {
      createClientImpl = defaultCreateClient;
    },
    recordUsage,
    isUsableKey,
    emptyUsageRow,
    loadUsageStore,
    redactSecretsInText,
  },
};
