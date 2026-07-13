'use strict';

const { SUPABASE_ANON_KEY, SUPABASE_URL } = require('../auth/supabaseAuth');

let lastGoogleAuthProbe = {
  status: 'never_run',
  checkedAt: '',
  provider: 'google',
  supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
  enabled: null,
  error: '',
};

function sanitizeError(error) {
  return String(error?.message || error || '')
    .replace(/eyJ[0-9A-Za-z._-]+/g, '[redacted-jwt]')
    .replace(/(?:sbp|sb_secret|sk|proj|AIza)[0-9A-Za-z\-_]+/g, '[redacted-secret]')
    .slice(0, 220);
}

function getLastGoogleAuthProbe() {
  return { ...lastGoogleAuthProbe };
}

function resetGoogleAuthProbe() {
  lastGoogleAuthProbe = {
    status: 'never_run',
    checkedAt: '',
    provider: 'google',
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    enabled: null,
    error: '',
  };
}

async function probeGoogleAuthProvider({ timeoutMs = 6000 } = {}) {
  const checkedAt = new Date().toISOString();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    lastGoogleAuthProbe = {
      status: 'unavailable',
      checkedAt,
      provider: 'google',
      supabaseConfigured: false,
      enabled: null,
      error: 'Supabase URL or anon key is missing.',
    };
    return getLastGoogleAuthProbe();
  }

  const settingsUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/settings`;
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Google auth provider probe timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(settingsUrl, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
        },
      }),
      timeout,
    ]);

    if (!response.ok) {
      throw new Error(`Supabase auth settings returned HTTP ${response.status}.`);
    }

    const settings = await response.json();
    const enabled = Boolean(settings?.external?.google);
    lastGoogleAuthProbe = {
      status: enabled ? 'live' : 'disabled',
      checkedAt,
      provider: 'google',
      supabaseConfigured: true,
      enabled,
      error: '',
    };
  } catch (error) {
    lastGoogleAuthProbe = {
      status: 'unreachable',
      checkedAt,
      provider: 'google',
      supabaseConfigured: true,
      enabled: null,
      error: sanitizeError(error),
    };
  }

  return getLastGoogleAuthProbe();
}

module.exports = {
  getLastGoogleAuthProbe,
  probeGoogleAuthProvider,
  resetGoogleAuthProbe,
};
