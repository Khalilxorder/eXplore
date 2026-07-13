'use client';

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './AuthProvider';
import {
  deactivatePushToken,
  fetchNotificationPreferences,
  registerPushToken,
  updateNotificationPreferences,
} from '../lib/api';
import {
  PRIORITY_RADAR_EVENT,
  loadPriorityRadarSettings,
  savePriorityRadarSettings,
  syncPriorityRadarWithNative,
} from '../lib/alertRadar';
import {
  clearRememberedPushDevice,
  getPushNotificationState,
  loadRememberedPushDevice,
  registerDeviceForPush,
  rememberRegisteredPushDevice,
} from '../lib/pushNotifications';

function normalizeRemoteReleaseWatchCompany(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'gemini' || normalized === 'google') {
    return 'google';
  }

  if (normalized === 'grok' || normalized === 'xai') {
    return 'xai';
  }

  return normalized;
}

function buildActivationSignature(userId, enabled, categories, releaseWatch, permission) {
  const selectedCompanies = Object.entries(releaseWatch?.companies || {})
    .filter(([, isEnabled]) => isEnabled)
    .map(([companyKey]) => companyKey)
    .sort()
    .join(',');

  return [
    userId,
    enabled ? '1' : '0',
    categories.ai ? '1' : '0',
    categories.geo ? '1' : '0',
    releaseWatch?.enabled ? '1' : '0',
    selectedCompanies,
    releaseWatch?.minImportance || 'major',
    permission,
  ].join(':');
}

export default function PriorityRadarPhoneSetup() {
  const { user } = useAuth();
  const lastPromptSignatureRef = useRef('');
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;

    const runSetup = async () => {
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;

      try {
        const settings = loadPriorityRadarSettings();
        const clearDeniedPushState = async () => {
          const rememberedDevice = loadRememberedPushDevice();
          if (rememberedDevice?.token || rememberedDevice?.device_id) {
            await deactivatePushToken({
              token: rememberedDevice.token,
              device_id: rememberedDevice.device_id,
            });
            clearRememberedPushDevice();
          }
        };

        if (!Capacitor.isNativePlatform()) {
          return;
        }

        if (!user) {
          await syncPriorityRadarWithNative(settings);
          return;
        }

        let remotePreferences = null;
        try {
          remotePreferences = await fetchNotificationPreferences();
        } catch {
          remotePreferences = null;
        }

        const desiredSettings = {
          ...settings,
          enabled: remotePreferences
            ? Boolean(remotePreferences.alerts_enabled)
            : Boolean(settings.enabled),
          categories: {
            ai: remotePreferences
              ? remotePreferences.ai_enabled !== false
              : settings.categories.ai,
            geo: remotePreferences
              ? remotePreferences.geo_enabled !== false
              : settings.categories.geo,
          },
          releaseWatch: remotePreferences
            ? {
                ...settings.releaseWatch,
                enabled: remotePreferences.ai_release_watch_enabled !== false,
                minImportance: remotePreferences.ai_release_watch_min_importance || settings.releaseWatch?.minImportance || 'major',
                companies: (() => {
                  const currentCompanies = settings.releaseWatch?.companies || {};
                  const remoteCompanies = new Set(
                    Array.isArray(remotePreferences.ai_release_watch_companies)
                      ? remotePreferences.ai_release_watch_companies
                        .map(normalizeRemoteReleaseWatchCompany)
                        .filter(Boolean)
                      : []
                  );

                  return Object.fromEntries(
                    Object.keys(currentCompanies).map((companyKey) => ([
                      companyKey,
                      remoteCompanies.size ? remoteCompanies.has(companyKey) : currentCompanies[companyKey] !== false,
                    ]))
                  );
                })(),
              }
            : settings.releaseWatch,
        };

        if (
          settings.enabled !== desiredSettings.enabled
          || settings.categories.ai !== desiredSettings.categories.ai
          || settings.categories.geo !== desiredSettings.categories.geo
          || settings.releaseWatch?.enabled !== desiredSettings.releaseWatch?.enabled
          || JSON.stringify(settings.releaseWatch?.companies || {}) !== JSON.stringify(desiredSettings.releaseWatch?.companies || {})
        ) {
          await savePriorityRadarSettings(desiredSettings);
        } else {
          await syncPriorityRadarWithNative(desiredSettings);
        }

        if (!desiredSettings.enabled) {
          if (user) {
            const rememberedDevice = loadRememberedPushDevice();
            if (rememberedDevice?.token || rememberedDevice?.device_id) {
              await deactivatePushToken({
                token: rememberedDevice.token,
                device_id: rememberedDevice.device_id,
              });
              clearRememberedPushDevice();
            }
          }

          lastPromptSignatureRef.current = '';
          return;
        }

        const pushState = await getPushNotificationState();
        const activationSignature = buildActivationSignature(
          user.id,
          desiredSettings.enabled,
          desiredSettings.categories,
          desiredSettings.releaseWatch,
          pushState.permission,
        );

        if (pushState.permission === 'unsupported' || pushState.permission === 'denied') {
          await clearDeniedPushState();
          await updateNotificationPreferences({
            alerts_enabled: true,
            ai_enabled: desiredSettings.categories.ai,
            geo_enabled: desiredSettings.categories.geo,
            push_enabled: false,
            local_fallback_enabled: true,
            ai_release_watch_enabled: desiredSettings.releaseWatch?.enabled !== false,
            ai_release_watch_min_importance: desiredSettings.releaseWatch?.minImportance || 'major',
            ai_release_watch_companies: Object.entries(desiredSettings.releaseWatch?.companies || {})
              .filter(([, enabled]) => enabled)
              .map(([companyKey]) => companyKey),
          });
          return;
        }

        if (pushState.permission === 'default' && lastPromptSignatureRef.current === activationSignature) {
          return;
        }

        if (pushState.permission === 'default') {
          lastPromptSignatureRef.current = activationSignature;
        }

        const pushResult = await registerDeviceForPush();
        if (cancelled || !pushResult.ok || !pushResult.token) {
          if (pushResult?.state?.permission === 'denied' || pushResult?.state?.permission === 'unsupported') {
            await clearDeniedPushState();
          }

          await updateNotificationPreferences({
            alerts_enabled: true,
            ai_enabled: desiredSettings.categories.ai,
            geo_enabled: desiredSettings.categories.geo,
            push_enabled: false,
            local_fallback_enabled: true,
            ai_release_watch_enabled: desiredSettings.releaseWatch?.enabled !== false,
            ai_release_watch_min_importance: desiredSettings.releaseWatch?.minImportance || 'major',
            ai_release_watch_companies: Object.entries(desiredSettings.releaseWatch?.companies || {})
              .filter(([, enabled]) => enabled)
              .map(([companyKey]) => companyKey),
          });
          return;
        }

        const nextPushState = pushResult.state || pushState;
        const deviceResult = await registerPushToken({
          token: pushResult.token,
          platform: pushResult.platform || nextPushState.platform || 'android',
          device_id: pushResult.device_id || '',
          app_version: pushResult.app_version || '',
        });

        if (cancelled || !deviceResult?.success) {
          await updateNotificationPreferences({
            alerts_enabled: true,
            ai_enabled: desiredSettings.categories.ai,
            geo_enabled: desiredSettings.categories.geo,
            push_enabled: false,
            local_fallback_enabled: true,
            ai_release_watch_enabled: desiredSettings.releaseWatch?.enabled !== false,
            ai_release_watch_min_importance: desiredSettings.releaseWatch?.minImportance || 'major',
            ai_release_watch_companies: Object.entries(desiredSettings.releaseWatch?.companies || {})
              .filter(([, enabled]) => enabled)
              .map(([companyKey]) => companyKey),
          });
          return;
        }

        rememberRegisteredPushDevice({
          token: pushResult.token,
          platform: pushResult.platform || nextPushState.platform || 'android',
          device_id: pushResult.device_id || '',
          app_version: pushResult.app_version || '',
        });

        await updateNotificationPreferences({
          alerts_enabled: true,
          ai_enabled: desiredSettings.categories.ai,
          geo_enabled: desiredSettings.categories.geo,
          push_enabled: true,
          local_fallback_enabled: true,
          ai_release_watch_enabled: desiredSettings.releaseWatch?.enabled !== false,
          ai_release_watch_min_importance: desiredSettings.releaseWatch?.minImportance || 'major',
          ai_release_watch_companies: Object.entries(desiredSettings.releaseWatch?.companies || {})
            .filter(([, enabled]) => enabled)
            .map(([companyKey]) => companyKey),
        });
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleSettingsChanged = () => {
      void runSetup();
    };

    void runSetup();
    window.addEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
    window.addEventListener('focus', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
      window.removeEventListener('focus', handleSettingsChanged);
    };
  }, [user]);

  return null;
}
