import { createClient } from '@supabase/supabase-js';
import { openExternalUrl } from './external';
import { getGoogleAuthRedirectUrl, isNativeShell } from './mobile';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const AUTH_STORAGE_KEY = 'explore-auth-token';
const AUTH_SETTINGS_URL = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings` : '';
const OAUTH_RESTART_MESSAGE = 'Google sign-in opened in the wrong browser context. Start Google sign-in again from this eXplore screen.';
let authSettingsPromise = null;
let sessionReadPromise = null;
let sessionCache = {
  expiresAt: 0,
  session: null,
};

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storageKey: AUTH_STORAGE_KEY,
      },
    })
  : null;

function parseAuthRedirectUrl(rawUrl) {
  const normalizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/\\/g, '/') : rawUrl;
  const url = new URL(normalizedUrl);
  const params = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);

  const readValue = (key) => params.get(key) || hash.get(key) || '';

  return {
    code: readValue('code'),
    error: readValue('error'),
    errorDescription: readValue('error_description'),
    errorCode: readValue('error_code'),
    accessToken: readValue('access_token'),
    refreshToken: readValue('refresh_token'),
    expiresIn: readValue('expires_in'),
    tokenType: readValue('token_type'),
  };
}

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

function cacheSession(session, ttlMs = 1500) {
  sessionCache = {
    expiresAt: Date.now() + ttlMs,
    session: session || null,
  };
}

export function clearSessionCache() {
  sessionReadPromise = null;
  sessionCache = {
    expiresAt: 0,
    session: null,
  };
}

async function fetchAuthSettings() {
  if (!AUTH_SETTINGS_URL || !supabaseAnonKey) {
    return null;
  }

  if (!authSettingsPromise) {
    authSettingsPromise = fetch(AUTH_SETTINGS_URL, {
      headers: {
        apikey: supabaseAnonKey,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Supabase auth settings (${response.status})`);
        }

        return response.json();
      })
      .catch((error) => {
        authSettingsPromise = null;
        throw error;
      });
  }

  return authSettingsPromise;
}

export async function getGoogleAuthAvailability() {
  try {
    const settings = await fetchAuthSettings();
    if (!settings) {
      return null;
    }

    return Boolean(settings?.external?.google);
  } catch {
    return null;
  }
}

export function hasAuthCallbackParams(rawUrl) {
  const nextUrl = rawUrl || (typeof window !== 'undefined' ? window.location.href : '');
  if (!nextUrl) {
    return false;
  }

  const { code, error, errorDescription, accessToken, refreshToken } = parseAuthRedirectUrl(nextUrl);
  return Boolean(code || error || errorDescription || accessToken || refreshToken);
}

export function clearBrowserAuthParams() {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUrl = typeof window.location.href === 'string' ? window.location.href.replace(/\\/g, '/') : window.location.href;
  const url = new URL(normalizedUrl);
  ['code', 'error', 'error_description', 'error_code', 'state'].forEach((key) => {
    url.searchParams.delete(key);
  });
  url.hash = '';
  window.history.replaceState(window.history.state, '', url.toString());
}

function isMissingPkceVerifier(message) {
  return /pkce|code verifier/i.test(String(message || ''));
}

export async function signUp(email, password) {
  if (!supabase) return { user: null, session: null, confirmationRequired: false, error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signUp({
    email: String(email || '').trim(),
    password,
    options: {
      emailRedirectTo: getGoogleAuthRedirectUrl(),
    },
  });
  cacheSession(data?.session || null);
  return {
    user: data?.user || null,
    session: data?.session || null,
    confirmationRequired: Boolean(data?.user && !data?.session),
    error: error?.message,
  };
}

export async function signIn(email, password) {
  if (!supabase) return { user: null, error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password,
  });
  cacheSession(data?.session || null);
  return { user: data?.user, session: data?.session, error: error?.message };
}

export async function signInWithGoogle() {
  if (!supabase) {
    return { error: 'Supabase not configured' };
  }

  let authSettings = null;
  try {
    authSettings = await fetchAuthSettings();
  } catch (error) {
    authSettings = null;
  }

  if (authSettings && !authSettings?.external?.google) {
    return { error: 'Google sign-in is not enabled in this Supabase project yet.' };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getGoogleAuthRedirectUrl(),
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data?.url) {
    return { error: 'Google sign-in URL was not returned.' };
  }

  if (isNativeShell()) {
    await openExternalUrl(data.url);
    return { error: null, pending: true };
  }

  window.location.assign(data.url);
  return { error: null, pending: true };
}

export async function finishAuthFromUrl(rawUrl) {
  if (!supabase) {
    return { session: null, error: 'Supabase not configured' };
  }

  try {
    const {
      code,
      error,
      errorDescription,
      errorCode,
      accessToken,
      refreshToken,
    } = parseAuthRedirectUrl(rawUrl);

    if (error || errorDescription) {
      return {
        session: null,
        error: errorDescription || errorCode || error || 'Google sign-in failed.',
      };
    }

    if (accessToken || refreshToken) {
      if (!accessToken || !refreshToken) {
        return {
          session: null,
          error: 'Google returned an incomplete session. Start Google sign-in again from this eXplore screen.',
        };
      }

      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      cacheSession(data?.session || null);
      return {
        session: data?.session || null,
        error: sessionError?.message || null,
      };
    }

    if (!code) {
      const session = await getSession();
      return { session, error: null };
    }

    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    const exchangeMessage = exchangeError?.message || null;
    cacheSession(data?.session || null);
    return {
      session: data?.session || null,
      error: isMissingPkceVerifier(exchangeMessage) ? OAUTH_RESTART_MESSAGE : exchangeMessage,
    };
  } catch (error) {
    const message = error?.message || 'Google sign-in failed.';
    return {
      session: null,
      error: isMissingPkceVerifier(message) ? OAUTH_RESTART_MESSAGE : message,
    };
  }
}

export async function signOut() {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.warn('[auth] Supabase sign-out failed; clearing local session state anyway.', error?.message || error);
  } finally {
    clearSessionCache();
  }
}

export async function getSession() {
  if (!supabase) return null;
  if (sessionCache.expiresAt > Date.now()) {
    return sessionCache.session;
  }

  if (sessionReadPromise) {
    return sessionReadPromise;
  }

  try {
    sessionReadPromise = supabase.auth.getSession()
      .then(({ data }) => {
        const nextSession = data?.session || null;
        cacheSession(nextSession);
        return nextSession;
      })
      .finally(() => {
        sessionReadPromise = null;
      });

    return await sessionReadPromise;
  } catch (error) {
    sessionReadPromise = null;
    console.warn('[auth] Supabase getSession failed.', error?.message || error);
    return null;
  }
}

export async function getUser() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user;
  } catch (error) {
    console.warn('[auth] Supabase getUser failed.', error?.message || error);
    return null;
  }
}

export function onAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange((event, nextSession) => {
    cacheSession(nextSession || null);
    callback(event, nextSession);
  });
}
