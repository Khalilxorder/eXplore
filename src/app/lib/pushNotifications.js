'use client';

import { Capacitor } from '@capacitor/core';
import {
  emitPriorityRadarOpen,
  emitPriorityRadarRefresh,
  getPriorityRadarTargetFromPayload,
} from './priorityRadarRouting';
import {
  emitPrivateMessengerOpen,
  getPrivateMessengerTargetFromPayload,
} from './privateMessengerRouting';

const PUSH_DEVICE_CACHE_KEY = 'explore-push-device';
const PUSH_DEVICE_ID_KEY = 'explore-push-device-id';

async function loadPushNotificationsModule() {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    return await dynamicImport('@capacitor/push-notifications');
  } catch {
    return null;
  }
}

function normalizePermission(permission) {
  if (permission === 'prompt') {
    return 'default';
  }

  return permission;
}

function unwrapPushPayload(event) {
  return event?.notification?.data || event?.notification?.extra || {};
}

function readCachedPushDevice() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(PUSH_DEVICE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeCachedPushDevice(value) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!value) {
    localStorage.removeItem(PUSH_DEVICE_CACHE_KEY);
    return;
  }

  localStorage.setItem(PUSH_DEVICE_CACHE_KEY, JSON.stringify(value));
}

export function loadRememberedPushDevice() {
  return readCachedPushDevice();
}

export function rememberRegisteredPushDevice(payload = {}) {
  writeCachedPushDevice({
    token: payload.token || '',
    device_id: payload.device_id || '',
    app_version: payload.app_version || '',
    platform: payload.platform || Capacitor.getPlatform(),
    saved_at: new Date().toISOString(),
  });
}

export function clearRememberedPushDevice() {
  writeCachedPushDevice(null);
}

export async function getPushRegistrationContext() {
  const context = {
    device_id: '',
    app_version: '',
  };

  if (!Capacitor.isNativePlatform()) {
    return context;
  }

  try {
    const existingId = localStorage.getItem(PUSH_DEVICE_ID_KEY);
    if (existingId) {
      context.device_id = existingId;
    } else {
      const generatedId = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `device-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(PUSH_DEVICE_ID_KEY, generatedId);
      context.device_id = generatedId;
    }
  } catch (error) {
    // Ignore local storage issues and continue without a stable device id.
  }

  try {
    const { App } = await import('@capacitor/app');
    const appInfo = await App.getInfo();
    context.app_version = appInfo?.version || appInfo?.build || '';
  } catch (error) {
    // Ignore optional app metadata failures.
  }

  return context;
}

export async function getPushNotificationState() {
  if (!Capacitor.isNativePlatform()) {
    return {
      supported: false,
      permission: 'unsupported',
      platform: 'web',
      isNative: false,
      canRegister: false,
    };
  }

  try {
    const { PushNotifications } = await loadPushNotificationsModule();
    const permissions = await PushNotifications.checkPermissions();
    const permission = normalizePermission(permissions.receive);

    return {
      supported: true,
      permission,
      platform: Capacitor.getPlatform(),
      isNative: true,
      canRegister: permission === 'granted',
    };
  } catch (error) {
    return {
      supported: false,
      permission: 'unsupported',
      platform: Capacitor.getPlatform(),
      isNative: true,
      canRegister: false,
      error: error?.message || 'Push notifications are unavailable in this build.',
    };
  }
}

export function describePushNotificationReadiness({
  backendAvailable = true,
  alertsEnabled = false,
  notificationState = {},
  pushState = {},
} = {}) {
  const isNative = Boolean(notificationState.isNative || pushState.isNative);
  const supported = notificationState.supported !== false;
  const permission = String(notificationState.permission || pushState.permission || 'default');

  if (!backendAvailable) {
    return {
      key: 'backend_unavailable',
      label: 'Service offline',
      description: 'The alert service is offline, so alerts cannot finish setup right now.',
    };
  }

  if (!supported && isNative) {
    return {
      key: 'backend_unavailable',
      label: 'Service offline',
      description: 'Push notifications are not available in this phone build right now.',
    };
  }

  if (permission === 'denied') {
    return {
      key: 'needs_permission',
      label: 'Needs permission',
      description: 'Allow notifications on this phone to receive alerts.',
    };
  }

  if (permission !== 'granted') {
    return {
      key: 'needs_permission',
      label: 'Needs permission',
      description: 'Tap Enable high-priority alerts so the app can ask for permission.',
    };
  }

  if (!alertsEnabled) {
    return {
      key: 'needs_registration',
      label: 'Needs setup',
      description: 'Tap Enable high-priority alerts to finish setup on this phone.',
    };
  }

  if (isNative && pushState.supported !== false && pushState.permission !== 'granted') {
    return {
      key: 'needs_registration',
      label: 'Needs setup',
      description: 'This phone still needs push registration to finish.',
    };
  }

  return {
    key: 'enabled',
    label: 'Ready',
    description: 'High-priority alerts are ready on this phone.',
  };
}

export async function registerDeviceForPush() {
  try {
    const state = await getPushNotificationState();
    if (!state.supported) {
      return {
        ok: false,
        state,
        message: state.error || 'Push notifications are not supported in this build.',
      };
    }

    const pushNotificationsModule = await loadPushNotificationsModule();
    const PushNotifications = pushNotificationsModule?.PushNotifications;
    if (!PushNotifications) {
      return {
        ok: false,
        state: {
          ...state,
          supported: false,
          canRegister: false,
        },
        message: 'Push notifications are not supported in this build.',
      };
    }

    let permissions = await PushNotifications.checkPermissions();

    if (normalizePermission(permissions.receive) !== 'granted') {
      permissions = await PushNotifications.requestPermissions();
    }

    const permission = normalizePermission(permissions.receive);
    const nextState = {
      ...state,
      permission,
      canRegister: permission === 'granted',
    };

    if (permission !== 'granted') {
      return {
        ok: false,
        state: nextState,
        message: 'Notification permission was not granted on this phone.',
      };
    }

    return await new Promise((resolve) => {
      let registrationHandle = null;
      let registrationErrorHandle = null;
      let settled = false;

      const cleanup = async () => {
        await Promise.allSettled([
          registrationHandle?.remove?.(),
          registrationErrorHandle?.remove?.(),
        ]);
      };

      const finish = async (payload) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        await cleanup();
        resolve(payload);
      };

      const timeoutId = window.setTimeout(() => {
        void finish({
          ok: false,
          state: nextState,
          message: 'Phone registration timed out. Try again in a moment.',
        });
      }, 15000);

      void (async () => {
        try {
          registrationHandle = await PushNotifications.addListener('registration', async (token) => {
            const context = await getPushRegistrationContext();
            const registeredDevice = {
              token: token.value,
              device_id: context.device_id,
              app_version: context.app_version,
              platform: Capacitor.getPlatform(),
            };
            rememberRegisteredPushDevice(registeredDevice);
            await finish({
              ok: true,
              token: token.value,
              state: nextState,
              platform: Capacitor.getPlatform(),
              device_id: context.device_id,
              app_version: context.app_version,
              message: 'This phone is registered for alerts.',
            });
          });

          registrationErrorHandle = await PushNotifications.addListener('registrationError', async (error) => {
            await finish({
              ok: false,
              state: nextState,
              message: error?.error || error?.message || 'Phone registration failed.',
            });
          });

          await PushNotifications.register();
        } catch (error) {
          await finish({
            ok: false,
            state: nextState,
            message: error?.message || 'Phone registration failed.',
          });
        }
      })();
    });
  } catch (error) {
    const state = await getPushNotificationState().catch(() => ({
      supported: false,
      permission: 'unsupported',
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      canRegister: false,
    }));

    return {
      ok: false,
      state,
      message: error?.message || 'Push notifications are not supported in this build.',
    };
  }
}

export async function attachPriorityRadarNotificationListeners() {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const removers = [];

  try {
    const [{ PushNotifications }, { LocalNotifications }] = await Promise.all([
      loadPushNotificationsModule(),
      import('@capacitor/local-notifications'),
    ]);

    const pushHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      const payload = unwrapPushPayload(event);
      const privateMessengerTarget = getPrivateMessengerTargetFromPayload(payload);
      if (privateMessengerTarget) {
        emitPrivateMessengerOpen(privateMessengerTarget);
        return;
      }

      const target = getPriorityRadarTargetFromPayload(payload);
      if (target) {
        emitPriorityRadarOpen(target);
      }
    });

    const pushReceivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      emitPriorityRadarRefresh({
        source: 'foreground-push',
        target: getPriorityRadarTargetFromPayload(notification?.data || notification?.extra || {}),
      });
    });

    const localHandle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const payload = event?.notification?.extra || {};
      const privateMessengerTarget = getPrivateMessengerTargetFromPayload(payload);
      if (privateMessengerTarget) {
        emitPrivateMessengerOpen(privateMessengerTarget);
        return;
      }

      const target = getPriorityRadarTargetFromPayload(payload);
      if (target) {
        emitPriorityRadarOpen(target);
      }
    });

    removers.push(
      () => pushHandle.remove(),
      () => pushReceivedHandle.remove(),
      () => localHandle.remove(),
    );
  } catch (error) {
    return null;
  }

  return () => {
    for (const remove of removers) {
      void remove();
    }
  };
}
