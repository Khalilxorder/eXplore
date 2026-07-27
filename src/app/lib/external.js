'use client';

import { Capacitor } from '@capacitor/core';
import { buildPublicUrl } from './mobile';

function resolveSafeExternalUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const baseUrl = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : buildPublicUrl('/');
    const parsed = new URL(url, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function isYouTubeUrl(url) {
  if (!url) return false;
  try {
    const baseUrl = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : buildPublicUrl('/');
    const parsed = new URL(url, baseUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

export function openYouTubeResearchGate({ url, title = '', summary = '' } = {}) {
  if (typeof window === 'undefined' || !isYouTubeUrl(url)) {
    return false;
  }

  window.dispatchEvent(new CustomEvent('explore:open-youtube-gate', {
    detail: { url, title, summary },
  }));
  return true;
}

export async function openExternalUrl(url) {
  const safeUrl = resolveSafeExternalUrl(url);

  if (!safeUrl) {
    return { ok: false, message: 'No source link is available for this item yet.' };
  }

  if (openYouTubeResearchGate({ url: safeUrl })) {
    return { ok: true, message: 'Opened in eXplore YouTube Research Instrument.' };
  }

  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: safeUrl });
    return { ok: true, message: 'Opened in your device browser.' };
  }

  const openedWindow = window.open(safeUrl, '_blank', 'noopener,noreferrer');
  if (openedWindow) {
    openedWindow.opener = null;
    return { ok: true, message: 'Opened in a new tab.' };
  }

  window.location.assign(safeUrl);
  return { ok: true, message: 'Opened in the current tab.' };
}

export async function shareContentLink({ title, text, url }) {
  const safeUrl = resolveSafeExternalUrl(url);

  if (!safeUrl) {
    return { ok: false, message: 'No source link is available for sharing yet.' };
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: safeUrl });
      return { ok: true, message: '' };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, message: '' };
      }
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(safeUrl);
    return { ok: true, message: 'Link copied to the clipboard.' };
  }

  return openExternalUrl(safeUrl);
}
