const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadService() {
  const authModule = path.resolve(__dirname, '../src/auth/supabaseAuth.js');
  const serviceModule = path.resolve(__dirname, '../src/services/authProviderReadinessService.js');

  delete require.cache[authModule];
  delete require.cache[serviceModule];

  return require(serviceModule);
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, snapshot);
}

test('probeGoogleAuthProvider reports live when Supabase settings enable Google', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  global.fetch = async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/settings');
    assert.equal(options.headers.apikey, 'anon-key');
    return {
      ok: true,
      json: async () => ({ external: { google: true } }),
    };
  };

  try {
    const service = loadService();
    const status = await service.probeGoogleAuthProvider({ timeoutMs: 1000 });

    assert.equal(status.status, 'live');
    assert.equal(status.enabled, true);
    assert.equal(service.getLastGoogleAuthProbe().status, 'live');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test('probeGoogleAuthProvider reports disabled when Supabase settings disable Google', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ external: { google: false } }),
  });

  try {
    const service = loadService();
    const status = await service.probeGoogleAuthProvider({ timeoutMs: 1000 });

    assert.equal(status.status, 'disabled');
    assert.equal(status.enabled, false);
    assert.equal(status.error, '');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test('probeGoogleAuthProvider sanitizes unreachable provider errors', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  global.fetch = async () => {
    throw new Error('network failed for sb_secret_abcdefghijklmnopqrstuvwxyz');
  };

  try {
    const service = loadService();
    const status = await service.probeGoogleAuthProvider({ timeoutMs: 1000 });

    assert.equal(status.status, 'unreachable');
    assert.equal(status.enabled, null);
    assert.match(status.error, /redacted-secret/);
    assert.equal(status.error.includes('sb_secret_abcdefghijklmnopqrstuvwxyz'), false);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});
