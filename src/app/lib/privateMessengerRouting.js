'use client';

import { getMobileAppScheme } from './mobile';

export const PRIVATE_MESSENGER_OPEN_EVENT = 'explore-private-messenger-open';

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildPrivateMessengerDeepLink(conversationId = '') {
  return `${getMobileAppScheme()}://messages/${encodeURIComponent(conversationId)}`;
}

export function parsePrivateMessengerUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const normalizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/\\/g, '/') : rawUrl;
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== `${getMobileAppScheme()}:`) {
      return null;
    }
    if (safeDecode(parsed.hostname || '') !== 'messages') {
      return null;
    }

    const conversationId = safeDecode(parsed.pathname.split('/').filter(Boolean)[0] || '');
    return {
      screen: 'private-chat',
      conversationId,
    };
  } catch {
    return null;
  }
}

export function getPrivateMessengerTargetFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.deepLink) {
    const parsed = parsePrivateMessengerUrl(payload.deepLink);
    if (parsed) {
      return parsed;
    }
  }

  const conversationId = payload.conversationId || payload.conversation_id || '';
  if (payload.route === 'private-message' && conversationId) {
    return {
      screen: 'private-chat',
      conversationId,
    };
  }

  return null;
}

export function emitPrivateMessengerOpen(target) {
  if (typeof window === 'undefined' || !target?.screen) {
    return;
  }

  window.dispatchEvent(new CustomEvent(PRIVATE_MESSENGER_OPEN_EVENT, {
    detail: target,
  }));
}
