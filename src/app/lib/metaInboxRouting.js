'use client';

import { getMobileAppScheme } from './mobile';

export const META_INBOX_OPEN_EVENT = 'explore-meta-inbox-open';

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

export function parseMetaInboxUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const normalizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/\\/g, '/') : rawUrl;
    const parsed = new URL(normalizedUrl);
    const expectedScheme = `${getMobileAppScheme()}:`;
    const isMobileDeepLink = parsed.protocol === expectedScheme;

    if (isMobileDeepLink) {
      const host = safeDecode(parsed.hostname || '');
      if (host !== 'messages' && host !== 'inbox') {
        return null;
      }
    }

    if (parsed.searchParams.get('meta_inbox') !== '1') {
      return null;
    }

    return {
      screen: 'messages',
      channel: safeDecode(parsed.searchParams.get('meta_channel') || '').toLowerCase(),
      status: safeDecode(parsed.searchParams.get('meta_status') || ''),
      refresh: parsed.searchParams.get('refresh') !== '0',
    };
  } catch (error) {
    return null;
  }
}

export function clearMetaInboxParamsFromBrowser() {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUrl = typeof window.location.href === 'string' ? window.location.href.replace(/\\/g, '/') : window.location.href;
  const url = new URL(normalizedUrl);
  ['meta_inbox', 'meta_channel', 'meta_status', 'refresh'].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState(window.history.state, '', url.toString());
}

export function emitMetaInboxOpen(target) {
  if (typeof window === 'undefined' || !target?.screen) {
    return;
  }

  window.dispatchEvent(new CustomEvent(META_INBOX_OPEN_EVENT, {
    detail: target,
  }));
}
