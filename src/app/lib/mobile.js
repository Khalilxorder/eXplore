'use client';

import { Capacitor } from '@capacitor/core';

const DEFAULT_SITE_URL = 'https://explore-two-rho.vercel.app';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseHttpUrl(value) {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return /^https?:$/i.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function isLocalUrl(url) {
  return url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
}

export function isNativeShell() {
  return Capacitor.isNativePlatform();
}

export function getMobileAppScheme() {
  return process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || 'explore';
}

export function getPublicSiteUrl() {
  const configuredUrl = parseHttpUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const windowUrl = typeof window !== 'undefined' && window.location?.origin
    ? parseHttpUrl(window.location.origin)
    : null;

  if (configuredUrl && !isLocalUrl(configuredUrl)) {
    return trimTrailingSlash(configuredUrl.toString());
  }

  if (windowUrl && !isLocalUrl(windowUrl)) {
    return trimTrailingSlash(windowUrl.toString());
  }

  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl.toString());
  }

  if (windowUrl) {
    return trimTrailingSlash(windowUrl.toString());
  }

  return DEFAULT_SITE_URL;
}

export function buildPublicUrl(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getPublicSiteUrl()}${normalizedPath}`;
}

export function getGoogleAuthRedirectUrl() {
  if (isNativeShell()) {
    return `${getMobileAppScheme()}://auth/callback`;
  }

  return buildPublicUrl('/auth/callback');
}

export async function addAppUrlOpenListener(listener) {
  if (!isNativeShell()) {
    return null;
  }

  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('appUrlOpen', listener);
  return () => {
    void handle.remove();
  };
}

export async function addAndroidBackButtonListener(listener) {
  if (!isNativeShell() || Capacitor.getPlatform() !== 'android') {
    return null;
  }

  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('backButton', async (event) => {
    const handled = await listener?.(event);
    if (handled !== false) {
      return;
    }

    if (typeof App.minimizeApp === 'function') {
      await App.minimizeApp();
    }
  });
  return () => {
    void handle.remove();
  };
}

export async function closeExternalBrowser() {
  if (!isNativeShell()) {
    return;
  }

  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch (error) {
    // Ignore close failures. The auth session can still continue.
  }
}
