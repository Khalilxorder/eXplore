'use client';

import { getMobileAppScheme } from './mobile';

export const PRIORITY_RADAR_OPEN_EVENT = 'explore-priority-radar-open';
export const PRIORITY_RADAR_REFRESH_EVENT = 'explore-priority-radar-refresh';

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

export function buildPriorityRadarDeepLink(alertId = '') {
  const scheme = getMobileAppScheme();
  if (!alertId) {
    return `${scheme}://radar`;
  }

  return `${scheme}://radar/${encodeURIComponent(alertId)}`;
}

export function parsePriorityRadarUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const normalizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/\\/g, '/') : rawUrl;
    const parsed = new URL(normalizedUrl);
    const expectedScheme = `${getMobileAppScheme()}:`;
    if (parsed.protocol !== expectedScheme) {
      return null;
    }

    const host = safeDecode(parsed.hostname || '');
    const pathSegments = parsed.pathname
      .split('/')
      .map((segment) => safeDecode(segment))
      .filter(Boolean);

    if (host !== 'radar' && host !== 'priority-radar') {
      return null;
    }

    const alertId = pathSegments[0] || parsed.searchParams.get('alertId') || '';
    return {
      screen: alertId ? 'priority-radar-detail' : 'priority-radar',
      alertId: alertId || null,
    };
  } catch (error) {
    return null;
  }
}

export function getPriorityRadarTargetFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.deepLink) {
    const parsed = parsePriorityRadarUrl(payload.deepLink);
    if (parsed) {
      return parsed;
    }
  }

  const alertId = payload.alertId || payload.alert_id || '';
  if (alertId) {
    return {
      screen: 'priority-radar-detail',
      alertId,
    };
  }

  if (payload.route === 'priority-radar' || payload.route === 'priority-radar-feed') {
    return {
      screen: 'priority-radar',
      alertId: null,
    };
  }

  return null;
}

export function emitPriorityRadarOpen(target) {
  if (typeof window === 'undefined' || !target?.screen) {
    return;
  }

  window.dispatchEvent(new CustomEvent(PRIORITY_RADAR_OPEN_EVENT, {
    detail: target,
  }));
}

export function emitPriorityRadarRefresh(detail = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(PRIORITY_RADAR_REFRESH_EVENT, {
    detail,
  }));
}
