'use client';

import { Capacitor, registerPlugin } from '@capacitor/core';

const RadarBridge = registerPlugin('RadarBridge');

export function isNativeRadarSupported() {
  return Capacitor.isNativePlatform();
}

export async function syncNativeRadarConfig({
  enabled,
  apiBase,
  aiEnabled = true,
  geoEnabled = false,
  releaseWatchEnabled = false,
  releaseWatchCompanies = '',
  releaseWatchMinImportance = 'major',
  directNewsWatchEnabled = true,
  directNewsWatchSources = 'anthropic',
}) {
  if (!isNativeRadarSupported()) {
    return { supported: false };
  }

  try {
    return await RadarBridge.configure({
      enabled,
      apiBase,
      aiEnabled,
      geoEnabled,
      releaseWatchEnabled,
      releaseWatchCompanies,
      releaseWatchMinImportance,
      directNewsWatchEnabled,
      directNewsWatchSources,
    });
  } catch (error) {
    return {
      supported: true,
      ok: false,
      error: error?.message || 'Unable to sync native radar configuration.',
    };
  }
}

export async function performNativeRadarCheck() {
  if (!isNativeRadarSupported()) {
    return { supported: false };
  }

  try {
    return await RadarBridge.performCheck();
  } catch (error) {
    return {
      supported: true,
      ok: false,
      error: error?.message || 'Unable to trigger a native radar check.',
    };
  }
}

export async function getNativeRadarStatus() {
  if (!isNativeRadarSupported()) {
    return { supported: false };
  }

  try {
    return await RadarBridge.getStatus();
  } catch (error) {
    return {
      supported: true,
      ok: false,
      error: error?.message || 'Unable to read native radar status.',
    };
  }
}
