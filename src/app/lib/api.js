import { getSession, supabase } from './supabase';
import { isNativeShell } from './mobile';

export const API_BASE_OVERRIDE_KEY = 'explore-api-base';
export const AUTH_REQUIRED_EVENT = 'explore-auth-required';
const HOSTED_WEB_API_BASE = '/_/backend';
const HOSTED_NATIVE_API_BASE = 'https://explore-two-rho.vercel.app/_/backend';

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function isPrivateHostname(hostname = '') {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    || hostname === 'localhost'
    || hostname === '127.0.0.1';
}

function isNativeProduction() {
  return isNativeShell() && process.env.NODE_ENV === 'production';
}

function isDebugApiOverrideEnabled() {
  if (process.env.NEXT_PUBLIC_DEBUG_BACKEND_OVERRIDE === 'true') {
    return true;
  }

  if (typeof window === 'undefined' || isNativeProduction()) {
    return false;
  }

  return isPrivateHostname(window.location.hostname);
}

function parseUrlSafely(value) {
  try {
    const normalizedValue = typeof value === 'string' ? value.replace(/\\/g, '/') : value;
    return new URL(normalizedValue);
  } catch (error) {
    return null;
  }
}

function buildWindowApiBase(hostname) {
  if (typeof window === 'undefined') {
    return '';
  }

  const apiProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${apiProtocol}//${hostname}:8080`;
}

function addUniqueCandidate(candidates, value) {
  if (!value) {
    return;
  }

  const normalizedValue = normalizeBaseUrl(value);
  if (!normalizedValue || candidates.includes(normalizedValue)) {
    return;
  }

  candidates.push(normalizedValue);
}

function shouldPreferWindowApiBase(envUrl) {
  if (typeof window === 'undefined' || !envUrl) {
    return false;
  }

  const windowHostname = window.location.hostname;
  if (windowHostname !== 'localhost' && windowHostname !== '127.0.0.1') {
    return false;
  }

  // When the app is opened on localhost, prefer the colocated API instead of a stale LAN IP.
  return isPrivateHostname(envUrl.hostname) && envUrl.hostname !== windowHostname;
}

function shouldPreferCurrentWindowHostApiBase(envUrl) {
  if (typeof window === 'undefined' || !envUrl) {
    return false;
  }

  const windowHostname = window.location.hostname;
  if (!isPrivateHostname(windowHostname) || windowHostname === 'localhost' || windowHostname === '127.0.0.1') {
    return false;
  }

  return envUrl.hostname === 'localhost' || envUrl.hostname === '127.0.0.1';
}

function shouldIgnorePrivateEnvApiBase(envUrl) {
  if (typeof window === 'undefined' || !envUrl) {
    return false;
  }

  const windowHostname = window.location.hostname;
  return !isPrivateHostname(windowHostname) && isPrivateHostname(envUrl.hostname);
}

export function getApiBaseOverride() {
  if (typeof window === 'undefined' || !isDebugApiOverrideEnabled()) {
    return '';
  }

  return normalizeBaseUrl(localStorage.getItem(API_BASE_OVERRIDE_KEY) || '');
}

export function setApiBaseOverride(value) {
  if (typeof window === 'undefined' || !isDebugApiOverrideEnabled()) {
    return;
  }

  const nextValue = normalizeBaseUrl(value.trim());
  if (!nextValue) {
    localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    return;
  }

  localStorage.setItem(API_BASE_OVERRIDE_KEY, nextValue);
}

function resolveEnvApiBase() {
  const envBase = process.env.NEXT_PUBLIC_API_URL;
  if (envBase) {
    const normalizedEnvBase = normalizeBaseUrl(envBase);
    if (isNativeProduction()) {
      if (normalizedEnvBase.startsWith('/')) {
        return HOSTED_NATIVE_API_BASE;
      }

      const nativeEnvUrl = parseUrlSafely(normalizedEnvBase);
      return nativeEnvUrl && !isPrivateHostname(nativeEnvUrl.hostname)
        ? normalizedEnvBase
        : HOSTED_NATIVE_API_BASE;
    }

    if (normalizedEnvBase.startsWith('/')) {
      return normalizedEnvBase;
    }

    const envUrl = parseUrlSafely(normalizedEnvBase);
    const siteUrl = parseUrlSafely(process.env.NEXT_PUBLIC_SITE_URL || '');

    if (envUrl && isNativeShell() && process.env.NODE_ENV === 'production' && isPrivateHostname(envUrl.hostname)) {
      return HOSTED_NATIVE_API_BASE;
    }

    if (shouldIgnorePrivateEnvApiBase(envUrl)) {
      return HOSTED_WEB_API_BASE;
    }

    // Some local mobile setups accidentally point NEXT_PUBLIC_API_URL at the web dev server on :3000.
    // In that case, prefer the matching host on :8080 where the Fastify API actually lives.
    if (envUrl && envUrl.port === '3000' && (!siteUrl || envUrl.hostname === siteUrl.hostname)) {
      const apiProtocol = envUrl.protocol === 'https:' ? 'https:' : 'http:';
      return `${apiProtocol}//${envUrl.hostname}:8080`;
    }

    if (shouldPreferWindowApiBase(envUrl)) {
      return buildWindowApiBase(window.location.hostname);
    }

    if (shouldPreferCurrentWindowHostApiBase(envUrl)) {
      return buildWindowApiBase(window.location.hostname);
    }

    return normalizedEnvBase;
  }

  if (typeof window === 'undefined') {
    return HOSTED_WEB_API_BASE;
  }

  if (isNativeProduction()) {
    return HOSTED_NATIVE_API_BASE;
  }

  const { protocol, hostname } = window.location;
  if (isPrivateHostname(hostname)) {
    const apiProtocol = protocol === 'https:' ? 'https:' : 'http:';
    return `${apiProtocol}//${hostname}:8080`;
  }

  return HOSTED_WEB_API_BASE;
}

export function resolveApiBaseCandidates() {
  const candidates = [];
  const mobileApiBase = process.env.NEXT_PUBLIC_MOBILE_API_URL;
  const nativeProduction = isNativeProduction();
  if (mobileApiBase && isNativeShell()) {
    addUniqueCandidate(candidates, mobileApiBase);
  }

  const override = getApiBaseOverride();
  addUniqueCandidate(candidates, override);

  if (!nativeProduction && typeof window !== 'undefined' && isPrivateHostname(window.location.hostname)) {
    addUniqueCandidate(candidates, buildWindowApiBase(window.location.hostname));
  }

  const envBase = resolveEnvApiBase();
  addUniqueCandidate(candidates, envBase);

  if (!isNativeShell()) {
    addUniqueCandidate(candidates, HOSTED_WEB_API_BASE);
    addUniqueCandidate(candidates, '/api');
  }

  const envUrl = parseUrlSafely(envBase);
  if (!nativeProduction && envUrl && isPrivateHostname(envUrl.hostname) && envUrl.hostname !== 'localhost' && envUrl.hostname !== '127.0.0.1') {
    addUniqueCandidate(candidates, buildWindowApiBase('localhost'));
    addUniqueCandidate(candidates, buildWindowApiBase('127.0.0.1'));
  }

  return candidates.length ? candidates : [nativeProduction ? HOSTED_NATIVE_API_BASE : HOSTED_WEB_API_BASE];
}

export function resolveApiBase() {
  return resolveApiBaseCandidates()[0] || HOSTED_WEB_API_BASE;
}

function buildApiUrl(path, base = resolveApiBase()) {
  if (!base) {
    return path;
  }

  if (base.startsWith('/')) {
    if (base === '/api' && path.startsWith('/api/')) {
      return path;
    }

    return `${base}${path}`;
  }

  return `${base}${path}`;
}

function isRetryableRequest(method = 'GET') {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

function shouldRetryWithNextBase(error) {
  if (!error) {
    return false;
  }

  if (!Number.isFinite(error.apiStatus)) {
    return true;
  }

  return error.apiStatus >= 500 || error.apiStatus === 404 || error.apiStatus === 405;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJsonWithBase(url, path, options, token) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 && token) {
      emitAuthRequired({ path, status: 401 });
    }

    if (!res.ok) {
      let message = `API error: ${res.status}`;
      try {
        const payload = await res.json();
        message = payload?.details || payload?.error || message;
      } catch (error) {
        // Ignore non-JSON responses.
      }

      const apiError = new Error(message);
      apiError.apiStatus = res.status;
      throw apiError;
    }

    if (res.status === 204) {
      return { success: true };
    }

    return await res.json();
  } catch (error) {
    error.requestUrl = url;
    throw error;
  }
}

async function getAuthToken() {
  if (!supabase) {
    return '';
  }

  try {
    const session = await getSession();
    return session?.access_token || '';
  } catch (error) {
    return '';
  }
}

function emitAuthRequired(detail = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail }));
}

export async function apiFetch(path, options = {}) {
  const { retryAcrossBases = false, throwOnError = false, ...requestOptions } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const canRetryAcrossBases = isRetryableRequest(method) || retryAcrossBases;
  const candidateBases = canRetryAcrossBases
    ? resolveApiBaseCandidates()
    : [resolveApiBase()];
  const token = await getAuthToken();
  const retryDelays = canRetryAcrossBases ? [0, 500, 1500] : [0];
  let lastError = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (attempt > 0) {
      await delay(retryDelays[attempt]);
    }

    for (let index = 0; index < candidateBases.length; index += 1) {
      const url = buildApiUrl(path, candidateBases[index]);

      try {
        return await fetchJsonWithBase(url, path, requestOptions, token);
      } catch (err) {
        lastError = err;
        const hasFallback = index < candidateBases.length - 1;
        if (!hasFallback || !shouldRetryWithNextBase(err)) {
          break;
        }
      }
    }

    if (!shouldRetryWithNextBase(lastError)) {
      break;
    }
  }

  if (lastError) {
    console.warn(`[API] ${lastError.message} - ${lastError.requestUrl || buildApiUrl(path)}`);
    if (throwOnError) {
      const message = `${lastError.message}${lastError.requestUrl ? ` (${lastError.requestUrl})` : ''}`;
      const apiError = new Error(message);
      apiError.apiStatus = lastError.apiStatus;
      apiError.requestUrl = lastError.requestUrl;
      throw apiError;
    }
  }

  return null;
}

export async function fetchFeed(options = {}) {
  const params = new URLSearchParams();
  if (options.summarizeVisually) {
    params.set('visualize', '1');
  }
  if (options.direct) {
    params.set('direct', '1');
  }
  if (options.refresh) {
    params.set('refresh', '1');
  }
  if (options.mode) {
    params.set('mode', options.mode);
  }

  const query = params.toString();
  return apiFetch(`/api/v1/feed${query ? `?${query}` : ''}`);
}

// ─── Intelligence Profile, Interests, and Goals ──────────────────────
export async function fetchIntelligenceProfile() {
  return apiFetch('/api/v1/intelligence/profile');
}

export async function fetchIntelligenceExplanation(recommendationId) {
  if (!recommendationId) {
    return null;
  }

  return apiFetch(`/api/v1/intelligence/explanation/${encodeURIComponent(recommendationId)}`);
}

export async function fetchUserTheory() {
  return apiFetch('/api/v1/intelligence/theory');
}

export async function pauseUserTheory() {
  return apiFetch('/api/v1/intelligence/theory/pause', { method: 'POST' });
}

export async function resumeUserTheory() {
  return apiFetch('/api/v1/intelligence/theory/resume', { method: 'POST' });
}

export async function resetUserTheory() {
  return apiFetch('/api/v1/intelligence/theory/reset', { method: 'POST' });
}

export async function exportUserTheory() {
  return apiFetch('/api/v1/intelligence/theory/export');
}

export async function fetchFinalEventAnalysis(contentId) {
  if (!contentId) return null;
  return apiFetch(`/api/v1/intelligence/final-analysis/${encodeURIComponent(contentId)}`);
}

export async function submitIntelligenceFeedback(payload) {
  return apiFetch('/api/v1/intelligence/feedback', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function fetchIntelligenceCorrections() {
  return apiFetch('/api/v1/intelligence/corrections');
}

export async function fetchIntelligenceMultipliers() {
  return apiFetch('/api/v1/intelligence/multipliers');
}

export async function fetchTopics() {
  return apiFetch('/api/v1/topics');
}

export async function fetchTopic(topicId) {
  return apiFetch(`/api/v1/topics/${encodeURIComponent(topicId)}`);
}

export async function createTopic(payload) {
  return apiFetch('/api/v1/topics', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTopic(topicId, payload) {
  return apiFetch(`/api/v1/topics/${encodeURIComponent(topicId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function discoverTopicSources(topicId) {
  return apiFetch(`/api/v1/topics/${encodeURIComponent(topicId)}/discover-sources`, {
    method: 'POST',
  });
}

export async function setTopicSourceApproval(topicId, sourceId, approved, notes = '', status = null) {
  return apiFetch(`/api/v1/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ approved, notes, status }),
  });
}

export async function fetchSourceWeb(topicId) {
  return apiFetch(`/api/v1/source-web?topicId=${encodeURIComponent(topicId)}`);
}

export async function createSourceWebClaim(payload) {
  return apiFetch('/api/v1/source-web/claims', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addSourceWebEvidence(payload) {
  return apiFetch('/api/v1/source-web/evidence', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addInterest(interestName, weight = 1.0) {
  return apiFetch('/api/v1/intelligence/interests', {
    method: 'POST',
    body: JSON.stringify({ interest_name: interestName, weight })
  });
}

export async function updateInterestWeight(interestName, weight) {
  return apiFetch(`/api/v1/intelligence/interests/${encodeURIComponent(interestName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ weight })
  });
}

export async function addGoal(goalText, priority = 'medium', targetDate = null) {
  return apiFetch('/api/v1/intelligence/goals', {
    method: 'POST',
    body: JSON.stringify({ goal_text: goalText, priority, target_date: targetDate })
  });
}

export async function updateGoal(id, updates) {
  return apiFetch(`/api/v1/intelligence/goals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

// ─── Memories and Memory Questions ───────────────────────────────────
export async function fetchMemories() {
  return apiFetch('/api/v1/intelligence/memories');
}

export async function proposeMemory(contentText, importanceScore = 0.5) {
  return apiFetch('/api/v1/intelligence/memories/propose', {
    method: 'POST',
    body: JSON.stringify({ content_text: contentText, importance_score: importanceScore })
  });
}

export async function updateMemory(id, updates) {
  return apiFetch(`/api/v1/intelligence/memories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

export async function fetchMemoryQuestions() {
  return apiFetch('/api/v1/intelligence/memory-questions');
}

export async function answerMemoryQuestion(questionId, answerText) {
  return apiFetch('/api/v1/intelligence/memory-questions/answers', {
    method: 'POST',
    body: JSON.stringify({ question_id: questionId, answer_text: answerText })
  });
}

// ─── Recommender Admin and Ingestion ────────────────────────────────
export async function trainRecommenderModel(payload = {}) {
  return apiFetch('/api/v1/admin/recommender/train', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function fetchRecommenderStatus() {
  return apiFetch('/api/v1/admin/recommender/status');
}

export async function adminIngestYouTube(url) {
  return apiFetch('/api/v1/admin/content/ingest/youtube', {
    method: 'POST',
    body: JSON.stringify({ url })
  });
}

export async function fetchWrittenNewsBrief(forceRefresh = false) {
  const params = new URLSearchParams();
  if (forceRefresh) {
    params.set('refresh', '1');
  }

  const query = params.toString();
  return apiFetch(`/api/v1/news/brief${query ? `?${query}` : ''}`);
}

export async function fetchSystemReadiness() {
  return apiFetch('/api/v1/readiness');
}

export async function fetchPrivateMessagingReadiness() {
  return apiFetch('/api/v1/messages/readiness');
}

export async function fetchModelPoolStatus() {
  return apiFetch('/api/v1/ai/model-pool/status');
}

export async function fetchGoogleAuthStatus(timeoutMs = 6000) {
  const boundedTimeout = Math.max(1500, Math.min(12000, Number(timeoutMs) || 6000));
  return apiFetch(`/api/v1/auth/google/status?timeoutMs=${encodeURIComponent(String(boundedTimeout))}`);
}

export async function fetchAuthCapabilities() {
  return apiFetch('/api/v1/auth/capabilities');
}

export async function probeGeminiStatus(timeoutMs = 8000) {
  const boundedTimeout = Math.max(1500, Math.min(12000, Number(timeoutMs) || 8000));
  return apiFetch(`/api/v1/ai/model-pool/probe?provider=gemini&timeoutMs=${encodeURIComponent(String(boundedTimeout))}`);
}

export async function searchContent(query, filter = 'All') {
  return apiFetch(`/api/v1/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}`);
}

export async function fetchContentDetail(id) {
  return apiFetch(`/api/v1/content/${id}`);
}

export async function visualizeContent(id, force = false) {
  const query = force ? '?force=1' : '';
  return apiFetch(`/api/v1/content/${id}/visualize${query}`, {
    method: 'POST',
  });
}

export async function fetchSaved() {
  return apiFetch('/api/v1/saved');
}

export async function fetchHistory(tab = 'viewed') {
  return apiFetch(`/api/v1/history?tab=${encodeURIComponent(tab)}`, {
    retryAcrossBases: true,
  });
}

export async function clearHistory(tab = 'all') {
  return apiFetch(`/api/v1/history?tab=${encodeURIComponent(tab)}`, {
    method: 'DELETE',
    retryAcrossBases: true,
  });
}

export async function fetchSourcesStatus() {
  return apiFetch('/api/v1/sources/status');
}

export async function fetchDiscoveryStatus() {
  return apiFetch('/api/v1/discovery/status');
}

export async function refreshDiscovery() {
  return apiFetch('/api/v1/discovery/refresh', {
    method: 'POST',
  });
}

export async function fetchTrackedChannels() {
  return apiFetch('/api/v1/discovery/youtube/channels');
}

export async function addTrackedChannel(payload) {
  return apiFetch('/api/v1/discovery/youtube/channels', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTrackedChannel(id, payload) {
  return apiFetch(`/api/v1/discovery/youtube/channels/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchTopicMonitors() {
  return apiFetch('/api/v1/discovery/youtube/monitors');
}

export async function addTopicMonitor(payload) {
  return apiFetch('/api/v1/discovery/youtube/monitors', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTopicMonitor(id, payload) {
  return apiFetch(`/api/v1/discovery/youtube/monitors/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchDiscoverySourceHealth() {
  return apiFetch('/api/v1/discovery/sources/health');
}

export async function fetchSourcePacks() {
  return apiFetch('/api/v1/discovery/source-packs');
}

export async function previewSourcePack(payload) {
  return apiFetch('/api/v1/discovery/source-packs/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addSourcePack(payload) {
  return apiFetch('/api/v1/discovery/source-packs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSourcePack(id, payload) {
  return apiFetch(`/api/v1/discovery/source-packs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchAnomalyFeed() {
  return apiFetch('/api/v1/anomalies/feed');
}

export async function importYouTubeUrl(url) {
  return apiFetch('/api/v1/ingest/youtube', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function importInstagramUrl(url) {
  return apiFetch('/api/v1/ingest/instagram', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function importPodcastFeed(url) {
  return apiFetch('/api/v1/ingest/podcast', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function importRedditSource(source) {
  return apiFetch('/api/v1/ingest/reddit', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export async function importXSource(source) {
  return apiFetch('/api/v1/ingest/x', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export async function saveItem(contentId) {
  return apiFetch('/api/v1/saved', {
    method: 'POST',
    body: JSON.stringify({ content_id: contentId }),
  });
}

export async function unsaveItem(contentId) {
  return apiFetch(`/api/v1/saved/${contentId}`, { method: 'DELETE' });
}

export async function updateSavedItem(contentId, updates) {
  return apiFetch(`/api/v1/saved/${contentId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function trackInteraction(contentId, action, durationMs = null) {
  return apiFetch('/api/v1/interactions', {
    method: 'POST',
    body: JSON.stringify({ content_id: contentId, action, duration_ms: durationMs }),
  });
}

export async function fetchPreferences() {
  return apiFetch('/api/v1/preferences');
}

export async function updatePreferences(prefs) {
  return apiFetch('/api/v1/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}

export async function fetchNotificationPreferences() {
  return apiFetch('/api/v1/preferences/notifications');
}

export async function fetchNotificationStatus() {
  return apiFetch('/api/v1/devices/notification-status');
}

export async function updateNotificationPreferences(prefs) {
  return apiFetch('/api/v1/preferences/notifications', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}

export async function registerPushToken(payload) {
  return apiFetch('/api/v1/devices/push-token', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deactivatePushToken(payload) {
  return apiFetch('/api/v1/devices/push-token', {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

export async function notifyPrivateMessage({ conversationId, messageId }) {
  return apiFetch('/api/v1/devices/private-message-notification', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: messageId,
    }),
  });
}

export async function fetchPriorityRadarFeed(limit = 20) {
  return apiFetch(`/api/v1/alerts/feed?limit=${Math.max(1, limit)}`);
}

export async function fetchPriorityRadarReferences() {
  return apiFetch('/api/v1/alerts/references');
}

export async function fetchEventSourceMap() {
  return apiFetch('/api/v1/alerts/source-map');
}

function buildRadarCategoryQuery(categories = {}) {
  const params = new URLSearchParams();
  if (categories.ai !== undefined) {
    params.set('ai', categories.ai ? '1' : '0');
  }
  if (categories.geo !== undefined) {
    params.set('geo', categories.geo ? '1' : '0');
  }
  return params.toString();
}

export async function fetchFilteredPriorityRadarFeed(limit = 20, categories = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, limit)));

  const categoryQuery = buildRadarCategoryQuery(categories);
  if (categoryQuery) {
    const categoryParams = new URLSearchParams(categoryQuery);
    for (const [key, value] of categoryParams.entries()) {
      params.set(key, value);
    }
  }

  return apiFetch(`/api/v1/alerts/feed?${params.toString()}`);
}

export async function fetchOfficialReleaseAlerts(options = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.min(Number(options.limit) || 8, 20))));

  const companies = Array.isArray(options.companies)
    ? options.companies.map((company) => String(company || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (companies.length) {
    params.set('companies', companies.join(','));
  }

  return apiFetch(`/api/v1/alerts/official-releases?${params.toString()}`);
}

export async function fetchPriorityRadarItem(alertId) {
  return apiFetch(`/api/v1/alerts/feed/${encodeURIComponent(alertId)}`);
}

export async function fetchPublicPriorityRadarItem(alertId) {
  return apiFetch(`/api/v1/alerts/radar/${encodeURIComponent(alertId)}`, {
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function fetchPublicPriorityRadarFeed(limit = 20, categories = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, limit)));

  const categoryQuery = buildRadarCategoryQuery(categories);
  if (categoryQuery) {
    const categoryParams = new URLSearchParams(categoryQuery);
    for (const [key, value] of categoryParams.entries()) {
      params.set(key, value);
    }
  }

  return apiFetch(`/api/v1/alerts/radar?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function interpretPriorityRadarItem(alertId) {
  return apiFetch(`/api/v1/alerts/feed/${encodeURIComponent(alertId)}/interpret`, { method: 'POST' });
}

export async function interpretPublicPriorityRadarItem(alertId) {
  return apiFetch(`/api/v1/alerts/radar/${encodeURIComponent(alertId)}/interpret`, { method: 'POST' });
}

export async function markPriorityRadarItemOpened(alertId) {
  return apiFetch(`/api/v1/alerts/feed/${encodeURIComponent(alertId)}/open`, {
    method: 'POST',
  });
}

export async function fetchSources() {
  return apiFetch('/api/v1/sources');
}

export async function updateSource(creatorId, trusted) {
  return apiFetch(`/api/v1/sources/${creatorId}`, {
    method: 'PUT',
    body: JSON.stringify({ trusted }),
  });
}

export async function fetchRelated(contentId) {
  return apiFetch(`/api/v1/content/${contentId}/related`);
}

export async function fetchFeedSection(sectionId) {
  return apiFetch(`/api/v1/feed/${sectionId}`);
}

export async function fetchCollections() {
  return apiFetch('/api/v1/collections');
}

export async function createCollection(name, description = '', isPublic = false) {
  return apiFetch('/api/v1/collections', {
    method: 'POST',
    body: JSON.stringify({ name, description, is_public: isPublic }),
  });
}

export async function fetchTemplate() {
  return apiFetch('/api/v1/template');
}

export async function fetchNewsPaths() {
  return apiFetch('/api/v1/template/news-paths');
}

export async function refineTemplate(note) {
  return apiFetch('/api/v1/template/refine', {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function saveTemplateWorkspace(payload) {
  return apiFetch('/api/v1/template/workspace', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function restoreTemplateVersion(versionId) {
  return apiFetch(`/api/v1/template/restore/${versionId}`, {
    method: 'POST',
  });
}

export async function updateTemplateConfig(config) {
  return apiFetch('/api/v1/template/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function fetchHierarchyState() {
  return apiFetch('/api/v1/hierarchy/state');
}

export async function fetchFinalInterpretation() {
  return apiFetch('/api/v1/hierarchy/final-interpretation');
}

export async function updateHierarchyGoal(goal) {
  return apiFetch('/api/v1/hierarchy/goal', {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });
}

export async function updateHierarchyStories({ storyHighestOrder, storyYours, storySubStories }) {
  return apiFetch('/api/v1/hierarchy/stories', {
    method: 'POST',
    body: JSON.stringify({ storyHighestOrder, storyYours, storySubStories }),
  });
}

export async function analyzeSelfData(rawText) {
  return apiFetch('/api/v1/hierarchy/self-data', {
    method: 'POST',
    body: JSON.stringify({ rawText }),
  });
}

export async function syncHierarchyFootprint(historyData) {
  return apiFetch('/api/v1/hierarchy/sync-footprint', {
    method: 'POST',
    body: JSON.stringify({ historyData }),
  });
}

export async function importHierarchyFootprint(rawText, source = 'auto', fileName = '') {
  return apiFetch('/api/v1/hierarchy/import-footprint', {
    method: 'POST',
    body: JSON.stringify({ rawText, source, fileName }),
  });
}

export async function fetchSubscriptionTiers() {
  return apiFetch('/api/v1/subscription/tiers');
}

export async function fetchSubscription() {
  return apiFetch('/api/v1/subscription');
}

export async function upgradeSubscription(tier, billingCycle = 'monthly') {
  return apiFetch('/api/v1/subscription/upgrade', {
    method: 'POST',
    body: JSON.stringify({ tier, billing_cycle: billingCycle }),
  });
}

export async function fetchFamily() {
  return apiFetch('/api/v1/family');
}

export async function createFamily(name) {
  return apiFetch('/api/v1/family', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function inviteToFamily(email) {
  return apiFetch('/api/v1/family/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function addFamilyGoal(goalText, topicTags = []) {
  return apiFetch('/api/v1/family/goals', {
    method: 'POST',
    body: JSON.stringify({ goal_text: goalText, topic_tags: topicTags }),
  });
}

export async function toggleFamilySafeScreen(enabled) {
  return apiFetch('/api/v1/family/safe-screen', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export async function fetchReferralCode() {
  return apiFetch('/api/v1/referral/code');
}

export async function redeemReferralCode(code) {
  return apiFetch('/api/v1/referral/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function fetchFamilyFeed() {
  return apiFetch('/api/v1/family/feed');
}

export async function fetchMetaInboxOverview() {
  return apiFetch('/api/v1/meta/overview');
}

export async function fetchCultureZeitgeist() {
  return apiFetch('/api/v1/culture/zeitgeist');
}

export async function fetchMetaConversationMessages(conversationId) {
  return apiFetch(`/api/v1/meta/conversations/${conversationId}/messages`);
}

export async function fetchMetaAuthorizeUrl(channel) {
  return apiFetch(`/api/v1/meta/authorize/${encodeURIComponent(channel)}`);
}

export async function saveMetaConnection(channel, payload) {
  return apiFetch(`/api/v1/meta/connections/${encodeURIComponent(channel)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function disconnectMetaConnection(channel) {
  return apiFetch(`/api/v1/meta/connections/${encodeURIComponent(channel)}`, {
    method: 'DELETE',
  });
}

export async function sendMetaConversationMessage(conversationId, text) {
  return apiFetch(`/api/v1/meta/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function fetchAffiliateLinks(contentId) {
  return apiFetch(`/api/v1/content/${contentId}/affiliate`);
}

export async function trackAffiliateClick(linkId) {
  return apiFetch('/api/v1/affiliate/click', {
    method: 'POST',
    body: JSON.stringify({ link_id: linkId }),
  });
}

export async function fetchWeeklyDigest() {
  return apiFetch('/api/v1/digest/weekly');
}

/**
 * Send a chat message to the AI chat endpoint.
 * Uses apiFetch so the Supabase Bearer token is attached automatically,
 * allowing the backend to identify the signed-in user for track_topic /
 * avoid_topic workspace mutations.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} context
 * @returns {Promise<{reply: string, action?: string, query?: string, fallback?: boolean} | null>}
 */
export async function postChat(messages, context = 'general') {
  return apiFetch('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, context }),
    retryAcrossBases: true,
    throwOnError: true,
  });
}

export async function generateLabsResearch() {
  return apiFetch('/api/v1/opportunities/labs/generate', {
    method: 'POST',
  });
}

export async function fetchMailAuthUrl() {
  return apiFetch('/api/v1/mail/auth-url');
}

export async function syncMail() {
  return apiFetch('/api/v1/mail/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchMailMessages(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/api/v1/mail/messages${qs ? '?' + qs : ''}`);
}

export async function fetchMailPriorityFeed() {
  return apiFetch('/api/v1/mail/priority-feed');
}

export async function fetchReferenceSenders() {
  return apiFetch('/api/v1/mail/reference-senders');
}

export async function addReferenceSender(email, label) {
  return apiFetch('/api/v1/mail/reference-senders', {
    method: 'POST',
    body: JSON.stringify({ email, label }),
  });
}

export async function fetchProfileVariants() {
  return apiFetch('/api/v1/profile-variants');
}

export async function generateProfileVariant(kind) {
  return apiFetch('/api/v1/profile-variants/generate', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
}

export async function saveProfileVariant(kind, title, body) {
  return apiFetch('/api/v1/profile-variants/save', {
    method: 'POST',
    body: JSON.stringify({ kind, title, body }),
  });
}

export async function fetchMonitoredSites() {
  return apiFetch('/api/v1/sites');
}

export async function addMonitoredSite(url, label, options = {}) {
  const isSpiderWeb = options === true
    || options?.isSpiderWeb === true
    || options?.is_spider_web === true
    || options?.is_spider_web === 1;
  return apiFetch('/api/v1/sites', {
    method: 'POST',
    body: JSON.stringify({ url, label, ...(isSpiderWeb ? { is_spider_web: true } : {}) }),
  });
}

export async function deleteMonitoredSite(id) {
  return apiFetch(`/api/v1/sites/${id}`, {
    method: 'DELETE',
  });
}

export async function checkAllMonitoredSites(siteType = 'all') {
  return apiFetch('/api/v1/sites/check-all', {
    method: 'POST',
    ...(siteType && siteType !== 'all' ? { body: JSON.stringify({ site_type: siteType }) } : {}),
  });
}

export async function seedSpiderWebSites() {
  return apiFetch('/api/v1/sites/seed-spider-web', {
    method: 'POST',
  });
}

export async function fetchAppMode() {
  return apiFetch('/api/v1/hierarchy/mode');
}

export async function updateAppMode(mode) {
  return apiFetch('/api/v1/hierarchy/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export async function fetchFormulations() {
  return apiFetch('/api/v1/formulation');
}

export async function createFormulation(inputText) {
  return apiFetch('/api/v1/formulation', {
    method: 'POST',
    body: JSON.stringify({ inputText }),
  });
}

export async function fetchExperienceEntries() {
  return apiFetch('/api/v1/experience');
}

export async function createExperienceEntry(kind, body) {
  return apiFetch('/api/v1/experience', {
    method: 'POST',
    body: JSON.stringify({ kind, body }),
  });
}

export async function updateExperienceEntry(id, kind, body) {
  return apiFetch(`/api/v1/experience/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ kind, body }),
  });
}

export async function deleteExperienceEntry(id) {
  return apiFetch(`/api/v1/experience/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchExperiments() {
  return apiFetch('/api/v1/experiment');
}

export async function createExperiment(hypothesis, action) {
  return apiFetch('/api/v1/experiment', {
    method: 'POST',
    body: JSON.stringify({ hypothesis, action }),
  });
}

export async function updateExperiment(id, status, result) {
  return apiFetch(`/api/v1/experiment/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, result }),
  });
}

export async function deleteExperiment(id) {
  return apiFetch(`/api/v1/experiment/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchMusicTracks() {
  return apiFetch('/api/v1/music/tracks');
}

export async function fetchMusicTrackDetails(id) {
  return apiFetch(`/api/v1/music/tracks/${encodeURIComponent(id)}`);
}

export async function syncMusicStats() {
  return apiFetch('/api/v1/music/sync', {
    method: 'POST',
  });
}

export async function importMusicStatement(rawText, source = 'auto', fileName = '') {
  return apiFetch('/api/v1/music/import-statement', {
    method: 'POST',
    body: JSON.stringify({ rawText, source, fileName }),
  });
}
