'use client';

const GUEST_SAVED_ITEMS_KEY = 'explore-guest-saved-items';
const GUEST_HISTORY_KEY = 'explore-guest-history';
const GUEST_DISMISSED_KEY = 'explore-guest-dismissed-items';
const MAX_SAVED_ITEMS = 160;
const MAX_HISTORY_ITEMS = 220;

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSavedItem(item = {}) {
  const now = new Date().toISOString();
  return {
    ...item,
    id: item?.id,
    title: item?.title || 'Untitled item',
    source: item?.source || item?.sourceName || item?.feedSectionTitle || 'Unknown source',
    date: item?.date || item?.publishedAt || now,
    savedAt: item?.savedAt || now,
    channelType: item?.channelType || item?.kind || 'written',
  };
}

function normalizeHistoryItem(item = {}, action = 'view') {
  const normalized = normalizeSavedItem(item);
  return {
    ...normalized,
    historyAction: action,
    interactedAt: new Date().toISOString(),
  };
}

export function loadGuestSavedItems() {
  const items = readJsonStorage(GUEST_SAVED_ITEMS_KEY, []);
  return Array.isArray(items) ? items : [];
}

export function saveGuestItem(item) {
  if (!item?.id) {
    return null;
  }

  const normalized = normalizeSavedItem(item);
  const nextItems = [
    normalized,
    ...loadGuestSavedItems().filter((entry) => entry?.id !== normalized.id),
  ].slice(0, MAX_SAVED_ITEMS);

  writeJsonStorage(GUEST_SAVED_ITEMS_KEY, nextItems);
  return normalized;
}

export function removeGuestSavedItem(itemId) {
  if (!itemId) {
    return;
  }

  const nextItems = loadGuestSavedItems().filter((entry) => entry?.id !== itemId);
  writeJsonStorage(GUEST_SAVED_ITEMS_KEY, nextItems);
}

export function loadGuestDismissedIds() {
  const ids = readJsonStorage(GUEST_DISMISSED_KEY, []);
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export function rememberGuestDismissedId(itemId) {
  if (!itemId) {
    return;
  }

  const nextIds = [
    itemId,
    ...loadGuestDismissedIds().filter((entry) => entry !== itemId),
  ].slice(0, MAX_HISTORY_ITEMS);
  writeJsonStorage(GUEST_DISMISSED_KEY, nextIds);
}

export function clearGuestDismissedIds() {
  writeJsonStorage(GUEST_DISMISSED_KEY, []);
}

export function loadGuestHistory(kind = 'all') {
  const entries = readJsonStorage(GUEST_HISTORY_KEY, []);
  const normalized = Array.isArray(entries) ? entries : [];

  if (kind === 'dismissed') {
    return normalized.filter((entry) => entry?.historyAction === 'dismiss');
  }

  if (kind === 'viewed') {
    return normalized.filter((entry) => entry?.historyAction !== 'dismiss');
  }

  return normalized;
}

export function recordGuestHistory(item, action = 'view') {
  if (!item?.id) {
    return null;
  }

  const normalized = normalizeHistoryItem(item, action);
  const nextHistory = [
    normalized,
    ...loadGuestHistory().filter((entry) => !(
      entry?.id === normalized.id
      && entry?.historyAction === normalized.historyAction
    )),
  ].slice(0, MAX_HISTORY_ITEMS);

  writeJsonStorage(GUEST_HISTORY_KEY, nextHistory);
  return normalized;
}

export function clearGuestHistory(kind = 'all') {
  if (kind === 'all') {
    writeJsonStorage(GUEST_HISTORY_KEY, []);
    writeJsonStorage(GUEST_DISMISSED_KEY, []);
    return;
  }

  if (kind === 'dismissed') {
    writeJsonStorage(GUEST_HISTORY_KEY, loadGuestHistory().filter((entry) => entry?.historyAction !== 'dismiss'));
    writeJsonStorage(GUEST_DISMISSED_KEY, []);
    return;
  }

  if (kind === 'viewed') {
    writeJsonStorage(GUEST_HISTORY_KEY, loadGuestHistory().filter((entry) => entry?.historyAction === 'dismiss'));
  }
}
