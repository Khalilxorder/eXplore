'use client';

import { Capacitor } from '@capacitor/core';

let reminderTimerId = null;

function normalizePermission(permission) {
  if (permission === 'prompt') {
    return 'default';
  }

  return permission;
}

function createNotificationId() {
  return Math.floor(Date.now() % 2147483647);
}

function createUnavailableNotificationState() {
  return {
    supported: false,
    permission: 'unsupported',
    platform: Capacitor.getPlatform(),
    isNative: Capacitor.isNativePlatform(),
    canSchedule: false,
  };
}

async function loadLocalNotificationsModule() {
  try {
    return await import('@capacitor/local-notifications');
  } catch {
    return null;
  }
}

export async function getNotificationState() {
  try {
    if (Capacitor.isNativePlatform()) {
      const localNotificationsModule = await loadLocalNotificationsModule();
      const LocalNotifications = localNotificationsModule?.LocalNotifications;
      if (!LocalNotifications) {
        return createUnavailableNotificationState();
      }

      const permissions = await LocalNotifications.checkPermissions();
      const permission = normalizePermission(permissions.display);

      return {
        supported: true,
        permission,
        platform: Capacitor.getPlatform(),
        isNative: true,
        canSchedule: permission === 'granted',
      };
    }

    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return {
        supported: false,
        permission: 'unsupported',
        platform: 'web',
        isNative: false,
        canSchedule: false,
      };
    }

    const permission = normalizePermission(Notification.permission);
    return {
      supported: true,
      permission,
      platform: 'web',
      isNative: false,
      canSchedule: permission === 'granted',
    };
  } catch {
    return createUnavailableNotificationState();
  }
}

export async function requestNotificationAccess() {
  try {
    if (Capacitor.isNativePlatform()) {
      const localNotificationsModule = await loadLocalNotificationsModule();
      const LocalNotifications = localNotificationsModule?.LocalNotifications;
      if (!LocalNotifications) {
        return createUnavailableNotificationState();
      }

      const permissions = await LocalNotifications.requestPermissions();
      const permission = normalizePermission(permissions.display);

      return {
        supported: true,
        permission,
        platform: Capacitor.getPlatform(),
        isNative: true,
        canSchedule: permission === 'granted',
      };
    }

    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return {
        supported: false,
        permission: 'unsupported',
        platform: 'web',
        isNative: false,
        canSchedule: false,
      };
    }

    const permission = normalizePermission(await Notification.requestPermission());
    return {
      supported: true,
      permission,
      platform: 'web',
      isNative: false,
      canSchedule: permission === 'granted',
    };
  } catch {
    return createUnavailableNotificationState();
  }
}

export async function sendTestNotification() {
  let state = createUnavailableNotificationState();

  try {
    state = await getNotificationState();
    if (!state.supported) {
      return { ok: false, message: 'Notifications are not supported on this device.', state };
    }

    if (state.permission !== 'granted') {
      state = await requestNotificationAccess();
    }

    if (state.permission !== 'granted') {
      return { ok: false, message: 'Notification permission was not granted.', state };
    }

    if (state.isNative) {
      const localNotificationsModule = await loadLocalNotificationsModule();
      const LocalNotifications = localNotificationsModule?.LocalNotifications;
      if (!LocalNotifications) {
        return { ok: false, message: 'Notifications are not supported on this device.', state: createUnavailableNotificationState() };
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: createNotificationId(),
            title: 'eXplore',
            body: 'Notifications are ready on this phone.',
            schedule: { at: new Date(Date.now() + 3000) },
          },
        ],
      });

      return {
        ok: true,
        message: 'A test phone notification is scheduled for a few seconds from now.',
        state,
      };
    }

    new Notification('eXplore', {
      body: 'Notifications are ready in this browser.',
    });

    return {
      ok: true,
      message: 'A browser notification was sent.',
      state,
    };
  } catch {
    return { ok: false, message: 'Notifications are not supported on this device.', state };
  }
}

export async function scheduleReminder(minutes = 60) {
  let state = createUnavailableNotificationState();

  try {
    state = await getNotificationState();
    if (!state.supported) {
      return { ok: false, message: 'Notifications are not supported on this device.', state };
    }

    if (state.permission !== 'granted') {
      state = await requestNotificationAccess();
    }

    if (state.permission !== 'granted') {
      return { ok: false, message: 'Notification permission was not granted.', state };
    }

    const targetDate = new Date(Date.now() + minutes * 60 * 1000);

    if (state.isNative) {
      const localNotificationsModule = await loadLocalNotificationsModule();
      const LocalNotifications = localNotificationsModule?.LocalNotifications;
      if (!LocalNotifications) {
        return { ok: false, message: 'Notifications are not supported on this device.', state: createUnavailableNotificationState() };
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: createNotificationId(),
            title: 'eXplore reminder',
            body: 'Come back and check your latest discoveries.',
            schedule: { at: targetDate },
          },
        ],
      });

      return {
        ok: true,
        message: `A phone reminder is scheduled for ${targetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
        state,
      };
    }

    if (reminderTimerId) {
      window.clearTimeout(reminderTimerId);
    }

    reminderTimerId = window.setTimeout(() => {
      new Notification('eXplore reminder', {
        body: 'Come back and check your latest discoveries.',
      });
    }, minutes * 60 * 1000);

    return {
      ok: true,
      message: `A browser reminder is queued for ${targetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Keep eXplore open on your PC for web reminders.`,
      state,
    };
  } catch {
    return { ok: false, message: 'Notifications are not supported on this device.', state };
  }
}

export async function sendPriorityNotification({ title, body, data = {} }) {
  let state = createUnavailableNotificationState();

  try {
    state = await getNotificationState();
    if (!state.supported) {
      return { ok: false, message: 'Notifications are not supported on this device.', state };
    }

    if (state.permission !== 'granted') {
      state = await requestNotificationAccess();
    }

    if (state.permission !== 'granted') {
      return { ok: false, message: 'Notification permission was not granted.', state };
    }

    if (state.isNative) {
      const localNotificationsModule = await loadLocalNotificationsModule();
      const LocalNotifications = localNotificationsModule?.LocalNotifications;
      if (!LocalNotifications) {
        return { ok: false, message: 'Notifications are not supported on this device.', state: createUnavailableNotificationState() };
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: createNotificationId(),
            title,
            body,
            extra: data,
            schedule: { at: new Date(Date.now() + 1000) },
          },
        ],
      });

      return {
        ok: true,
        message: 'A priority notification was scheduled on this device.',
        state,
      };
    }

    new Notification(title, { body });
    return {
      ok: true,
      message: 'A browser notification was sent.',
      state,
    };
  } catch {
    return { ok: false, message: 'Notifications are not supported on this device.', state };
  }
}
