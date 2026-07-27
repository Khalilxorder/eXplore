'use strict';

/**
 * Pure chat model preference / xAI routing helpers.
 * Shared by the HTTP chat route and offline unit tests.
 */

const XAI_NOT_CONFIGURED_MESSAGE =
  'No xAI API keys configured. Add XAI_API_KEY / XAI_API_KEY_1..3 (or XAI_API_KEYS), or fill xai-key-pool.json, then restart the backend. Keys stay server-side only.';

function normalizeChatMode(value = 'solo') {
  const mode = String(value || 'solo').trim().toLowerCase();
  return mode === 'multi' || mode === 'multi_agent' || mode === 'agents' ? 'multi' : 'solo';
}

function normalizeChatModelPreference(value = 'gemini') {
  const model = String(value || 'gemini').trim();
  const lower = model.toLowerCase();
  if (!lower || lower === 'gemini' || lower === 'gemini-auto') return 'gemini';
  if (lower === 'balanced' || lower === 'auto') return 'balanced';
  // Persona only — must never route to live xAI (underscore or hyphen form).
  if (lower === 'grok_style' || lower === 'grok-style') return 'grok_style';
  // Real model ids pass through (grok-4, grok-3-mini, gemini-2.0-flash, ...)
  return model;
}

/** Gemini / auto personas that must never hit the live xAI provider. */
function isChatPersonaId(value = '') {
  const model = String(value || '').toLowerCase().trim();
  return (
    model === 'gemini'
    || model === 'gemini-auto'
    || model === 'balanced'
    || model === 'auto'
    || model === 'grok_style'
    || model === 'grok-style'
  );
}

/**
 * True for real xAI Grok model ids and short aliases.
 * Explicitly excludes grok_style / grok-style (Gemini persona path).
 */
function isXaiModelId(value = '') {
  const model = String(value || '').toLowerCase().trim();
  if (!model || isChatPersonaId(model)) return false;
  if (model === 'xai' || model === 'grok' || model === 'grok_4_5' || model === 'grok-4.5') return true;
  // Real model family: grok-4, grok-3-mini, grok-2-1212, …
  return model.startsWith('grok-');
}

function resolveXaiModelId(value = 'grok-4') {
  const model = String(value || '').trim();
  const lower = model.toLowerCase();
  if (lower === 'grok' || lower === 'xai' || lower === 'grok_4_5' || lower === 'grok-4.5') {
    return 'grok-4';
  }
  if (isXaiModelId(model)) return model;
  return 'grok-4';
}

function isXaiConfigError(error) {
  const msg = String(error?.message || error || '');
  return /No xAI API keys configured/i.test(msg);
}

/**
 * Decide whether a chat request should hit live xAI (Grok API) vs Gemini/OpenAI pool.
 * Note: `grok_style` / `grok-style` is a persona on the Gemini path — not live xAI.
 */
function resolveChatProviderRouting({
  model = null,
  modelPreference = 'gemini',
} = {}) {
  const rawModel = model == null || model === '' ? null : String(model);
  const rawModelPreference =
    modelPreference == null || modelPreference === '' ? 'gemini' : String(modelPreference);
  // Prefer explicit `model` when provided; otherwise modelPreference (UI pickers send both).
  const normalizedPreference = normalizeChatModelPreference(rawModel || rawModelPreference);
  // isXaiModelId excludes personas (incl. hyphenated grok-style) on both raw and normalized forms.
  const useXai =
    isXaiModelId(normalizedPreference)
    || isXaiModelId(rawModel)
    || isXaiModelId(rawModelPreference);

  const selectedModelId = useXai
    ? resolveXaiModelId(normalizedPreference || rawModel || 'grok-4')
    : normalizedPreference === 'gemini'
      || normalizedPreference === 'balanced'
      || normalizedPreference === 'grok_style'
      ? null
      : normalizedPreference;

  // Explicit gemini-* ids still go through Gemini path (never xAI).
  const geminiModelId =
    !useXai && selectedModelId && String(selectedModelId).toLowerCase().startsWith('gemini')
      ? selectedModelId
      : null;

  return {
    modelPreference: normalizedPreference,
    useXai,
    selectedModelId,
    geminiModelId,
    provider: useXai ? 'xai' : 'gemini',
  };
}

function clampAgentCount(mode, value) {
  if (mode !== 'multi') return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(2, Math.min(5, Math.round(n)));
}

module.exports = {
  normalizeChatMode,
  normalizeChatModelPreference,
  isChatPersonaId,
  isXaiModelId,
  resolveXaiModelId,
  resolveChatProviderRouting,
  clampAgentCount,
  isXaiConfigError,
  XAI_NOT_CONFIGURED_MESSAGE,
};
