'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const xaiProvider = require('../services/xaiProvider');
const {
  normalizeChatMode,
  normalizeChatModelPreference,
  isChatPersonaId,
  isXaiModelId,
  resolveXaiModelId,
  resolveChatProviderRouting,
  clampAgentCount,
  XAI_NOT_CONFIGURED_MESSAGE,
} = require('../services/chatModelRouting');

const XAI_ENV_NAMES = [
  'XAI_API_KEY',
  'GROK_API_KEY',
  'XAI_KEY',
  'XAI_API_KEYS',
  'XAI_KEY_POOL_FILE',
  'XAI_ACTIVE_ACCOUNT_ID',
  'XAI_ACTIVE_ACCOUNT_FILE',
  'XAI_USAGE_FILE',
  'XAI_ACCOUNT_LABEL',
  'XAI_BASE_URL',
  ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
    `XAI_API_KEY_${i}`,
    `GROK_API_KEY_${i}`,
    `XAI_ACCOUNT_LABEL_${i}`,
  ]),
];

async function withXaiEnv(values, callback) {
  const original = new Map(XAI_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of XAI_ENV_NAMES) {
    delete process.env[name];
  }
  // Point pool / usage / active-account at isolated temp paths so real ~/.dev-config does not leak.
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  process.env.XAI_KEY_POOL_FILE = path.join(os.tmpdir(), `explore-xai-missing-pool-${stamp}.json`);
  process.env.XAI_USAGE_FILE = path.join(os.tmpdir(), `explore-xai-usage-${stamp}.json`);
  process.env.XAI_ACTIVE_ACCOUNT_FILE = path.join(
    os.tmpdir(),
    `explore-xai-active-${stamp}.json`
  );
  Object.entries(values || {}).forEach(([name, value]) => {
    if (value === undefined || value === null) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
  try {
    return await callback({
      usageFile: process.env.XAI_USAGE_FILE,
      activeFile: process.env.XAI_ACTIVE_ACCOUNT_FILE,
      poolFile: process.env.XAI_KEY_POOL_FILE,
    });
  } finally {
    for (const name of XAI_ENV_NAMES) {
      const prev = original.get(name);
      if (prev === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = prev;
      }
    }
    xaiProvider.__test__.resetClientFactory();
  }
}

function validXaiKey(suffix = 'alpha') {
  return `xai-test-key-${suffix}-abcdef1234567890`;
}

function cleanupFiles(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // ignore cleanup failures
    }
  }
}

function mockXaiClient({
  text = 'mock grok reply',
  model = 'grok-4',
  usage = { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
  onCreate,
  failWith,
} = {}) {
  return {
    chat: {
      completions: {
        create: async (payload) => {
          if (typeof onCreate === 'function') onCreate(payload);
          if (failWith) {
            const error = failWith instanceof Error ? failWith : new Error(String(failWith));
            throw error;
          }
          return {
            choices: [{ message: { content: text } }],
            usage,
            model,
          };
        },
      },
    },
    models: {
      list: async () => ({ data: [{ id: model }, { id: 'grok-3' }] }),
    },
  };
}

// ---------------------------------------------------------------------------
// xaiProvider unit tests
// ---------------------------------------------------------------------------

test('getCatalog masks API keys and never exposes raw secrets', async () => {
  const secret = validXaiKey('catalog');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
      XAI_ACCOUNT_LABEL: 'Test xAI account',
    },
    () => {
      const catalog = xaiProvider.getCatalog();
      assert.equal(catalog.provider, 'xai');
      assert.equal(catalog.configured, true);
      assert.equal(catalog.accountCount, 1);
      assert.ok(Array.isArray(catalog.accounts));
      assert.equal(catalog.accounts.length, 1);

      const account = catalog.accounts[0];
      assert.equal(account.label, 'Test xAI account');
      assert.ok(account.maskedKey);
      assert.equal(account.maskedKey, `${secret.slice(0, 6)}…${secret.slice(-4)}`);
      assert.equal(account.key, undefined);
      assert.equal(account.apiKey, undefined);

      const serialized = JSON.stringify(catalog);
      assert.equal(serialized.includes(secret), false);
      assert.ok(serialized.includes(account.maskedKey));

      assert.ok(Array.isArray(catalog.models.xai));
      assert.ok(catalog.models.xai.some((m) => m.id === 'grok-3' || m.id === 'grok-4'));
    }
  );
});

test('catalog offline returns known models without network', async () => {
  await withXaiEnv({}, () => {
    const catalog = xaiProvider.getCatalog();
    assert.equal(catalog.provider, 'xai');
    assert.equal(catalog.configured, false);
    assert.equal(catalog.accountCount, 0);
    assert.ok(catalog.models.xai.some((m) => m.id === 'grok-4'));
    assert.ok(catalog.models.gemini.some((m) => String(m.id).startsWith('gemini')));
    assert.ok(Array.isArray(catalog.models.all));
    assert.equal(catalog.activeAccountId, null);
  });
});

test('setActiveAccountId errors on unknown account id', async () => {
  await withXaiEnv(
    {
      XAI_API_KEY: validXaiKey('active'),
    },
    () => {
      assert.throws(
        () => xaiProvider.setActiveAccountId('definitely-not-a-real-xai-account'),
        /Unknown xAI account id/i
      );
    }
  );
});

test('empty and placeholder keys are ignored; usable keys included', async () => {
  await withXaiEnv(
    {
      XAI_API_KEY: 'short',
      XAI_API_KEY_1: 'YOUR_API_KEY_HERE_xxxxxx',
      XAI_API_KEY_2: 'PLACEHOLDER_demo_key_1',
      XAI_API_KEY_3: 'FAKE_key_value_oklength',
      XAI_API_KEY_4: validXaiKey('good'),
      XAI_API_KEYS: 'DEMO_key_not_real_xx,xai-csv-usable-key-zzzzzzzz',
    },
    () => {
      assert.equal(xaiProvider.isUsableKey(''), false);
      assert.equal(xaiProvider.isUsableKey('short'), false);
      assert.equal(xaiProvider.isUsableKey('YOUR_KEY_PLACEHOLDER'), false);
      assert.equal(xaiProvider.isUsableKey(validXaiKey('ok')), true);

      const accounts = xaiProvider.getAccounts();
      const ids = accounts.map((a) => a.id);
      const keys = accounts.map((a) => a.key);

      assert.ok(!keys.some((k) => k === 'short'));
      assert.ok(!keys.some((k) => /YOUR_|PLACEHOLDER|FAKE|DEMO/i.test(k)));
      assert.ok(keys.includes(validXaiKey('good')));
      assert.ok(keys.includes('xai-csv-usable-key-zzzzzzzz'));
      assert.ok(ids.includes('xai-env-4') || accounts.some((a) => a.key === validXaiKey('good')));

      const catalog = xaiProvider.getCatalog();
      for (const account of catalog.accounts) {
        assert.ok(account.maskedKey);
        assert.equal(account.key, undefined);
        assert.ok(!String(account.maskedKey).includes(validXaiKey('good')));
      }
    }
  );
});

test('maskKey and sanitizeForPublic never leak raw secrets', () => {
  const secret = validXaiKey('mask');
  assert.equal(xaiProvider.maskKey(''), '••••');
  assert.equal(xaiProvider.maskKey('tiny'), '••••');
  assert.equal(xaiProvider.maskKey(secret), `${secret.slice(0, 6)}…${secret.slice(-4)}`);

  const sanitized = xaiProvider.sanitizeForPublic({
    key: secret,
    apiKey: secret,
    nested: { token: secret, note: 'safe' },
    rawLooking: secret,
  });
  assert.equal(sanitized.key, undefined);
  assert.equal(sanitized.apiKey, undefined);
  assert.ok(sanitized.maskedKey);
  assert.equal(sanitized.nested.token, undefined);
  assert.ok(sanitized.nested.maskedKey || sanitized.nested.note === 'safe');
  assert.equal(JSON.stringify(sanitized).includes(secret), false);
});

test('ensurePoolFileTemplate exists and creates a backend-only pool template offline', async () => {
  assert.equal(typeof xaiProvider.ensurePoolFileTemplate, 'function');

  const poolFile = path.join(
    os.tmpdir(),
    `explore-xai-pool-template-${process.pid}-${Date.now()}.json`
  );
  try {
    if (fs.existsSync(poolFile)) fs.unlinkSync(poolFile);

    await withXaiEnv({ XAI_KEY_POOL_FILE: poolFile }, () => {
      const created = xaiProvider.ensurePoolFileTemplate();
      assert.equal(created, poolFile);
      assert.ok(fs.existsSync(poolFile));

      const raw = fs.readFileSync(poolFile, 'utf8');
      const data = JSON.parse(raw);
      assert.equal(data.version, 1);
      assert.ok(Array.isArray(data.keys));
      // Requirement: pool template has exactly 3 slots
      assert.equal(data.keys.length, 3);
      assert.deepEqual(
        data.keys.map((k) => k.id),
        ['xai-account-1', 'xai-account-2', 'xai-account-3']
      );
      // Template keys are empty → not usable, so catalog stays unconfigured from pool alone
      for (const entry of data.keys) {
        assert.ok(!entry.key || String(entry.key).trim() === '');
      }

      const catalog = xaiProvider.getCatalog();
      assert.equal(catalog.configured, false);
      assert.equal(catalog.accountCount, 0);

      // Idempotent: existing full template is not rewritten into a different shape
      const again = xaiProvider.ensurePoolFileTemplate();
      assert.equal(again, poolFile);
      assert.deepEqual(JSON.parse(fs.readFileSync(poolFile, 'utf8')).keys.length, 3);
    });
  } finally {
    cleanupFiles(poolFile);
  }
});

test('ensurePoolFileTemplate pads short object pools to 3 slots without inventing keys', async () => {
  const poolFile = path.join(
    os.tmpdir(),
    `explore-xai-pool-pad-${process.pid}-${Date.now()}.json`
  );
  try {
    fs.writeFileSync(
      poolFile,
      JSON.stringify(
        {
          version: 1,
          keys: [{ id: 'xai-account-1', label: 'Only one', key: '', enabled: true }],
        },
        null,
        2
      ),
      'utf8'
    );

    await withXaiEnv({ XAI_KEY_POOL_FILE: poolFile }, () => {
      xaiProvider.ensurePoolFileTemplate();
      const data = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
      assert.equal(data.keys.length, 3);
      assert.equal(data.keys[0].id, 'xai-account-1');
      assert.equal(data.keys[0].label, 'Only one');
      // Padded slots stay empty — never invent fake API keys
      assert.equal(String(data.keys[1].key || ''), '');
      assert.equal(String(data.keys[2].key || ''), '');
      assert.equal(xaiProvider.getCatalog().accountCount, 0);
    });
  } finally {
    cleanupFiles(poolFile);
  }
});

test('pool file loads usable keys; empty/placeholder pool slots ignored', async () => {
  const poolFile = path.join(
    os.tmpdir(),
    `explore-xai-pool-load-${process.pid}-${Date.now()}.json`
  );
  const usable = validXaiKey('pool-load');
  try {
    fs.writeFileSync(
      poolFile,
      JSON.stringify(
        {
          version: 1,
          keys: [
            { id: 'xai-account-1', label: 'Empty', key: '', enabled: true },
            { id: 'xai-account-2', label: 'Placeholder', key: 'PLACEHOLDER_not_real_key', enabled: true },
            { id: 'xai-account-3', label: 'Real pool', key: usable, enabled: true },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await withXaiEnv({ XAI_KEY_POOL_FILE: poolFile }, () => {
      const accounts = xaiProvider.getAccounts();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].id, 'xai-account-3');
      assert.equal(accounts[0].source, 'pool');
      assert.equal(accounts[0].key, usable);

      const catalog = xaiProvider.getCatalog();
      assert.equal(catalog.accountCount, 1);
      assert.equal(catalog.accounts[0].maskedKey, `${usable.slice(0, 6)}…${usable.slice(-4)}`);
      assert.equal(JSON.stringify(catalog).includes(usable), false);
    });
  } finally {
    cleanupFiles(poolFile);
  }
});

test('public API aliases: catalog, setActiveAccount, getUsage, probe', async () => {
  const secret = validXaiKey('aliases');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
      XAI_ACCOUNT_LABEL: 'Alias account',
    },
    async () => {
      assert.equal(typeof xaiProvider.catalog, 'function');
      assert.equal(typeof xaiProvider.setActiveAccount, 'function');
      assert.equal(typeof xaiProvider.getUsage, 'function');
      assert.equal(typeof xaiProvider.probe, 'function');
      assert.equal(xaiProvider.XAI_BASE_URL, 'https://api.x.ai/v1');

      const offlineCatalog = await xaiProvider.catalog({ live: false });
      assert.equal(offlineCatalog.provider, 'xai');
      assert.equal(offlineCatalog.accountCount, 1);
      assert.ok(offlineCatalog.models.xai.some((m) => m.id === 'grok-4'));
      assert.equal(JSON.stringify(offlineCatalog).includes(secret), false);

      const usage = await xaiProvider.getUsage();
      assert.equal(usage.probe, null);
      assert.deepEqual(usage.liveModels, []);
      assert.equal(usage.accounts[0].key, undefined);

      const activeId = xaiProvider.setActiveAccount('xai-env-primary');
      assert.equal(activeId, 'xai-env-primary');

      // Offline probe with mock client (no real network)
      xaiProvider.__test__.setClientFactory(() => mockXaiClient({ model: 'grok-4' }));
      const probeResult = await xaiProvider.probe({ accountId: 'xai-env-primary' });
      assert.equal(probeResult.id, 'xai-env-primary');
      assert.equal(probeResult.ok, true);
      assert.ok(Array.isArray(probeResult.models));
      assert.equal(probeResult.key, undefined);
      assert.ok(probeResult.maskedKey);
      assert.equal(JSON.stringify(probeResult).includes(secret), false);
    }
  );
});

test('redactSecretsInText never leaves raw API keys in free text', () => {
  const secret = validXaiKey('redact');
  const redacted = xaiProvider.redactSecretsInText(
    `auth failed for ${secret} Bearer ${secret.slice(4)}extra`,
    [secret]
  );
  assert.equal(redacted.includes(secret), false);
  assert.ok(/…|•/.test(redacted));
});

test('getUsageSnapshot offline (live=false) does not call xAI network', async () => {
  const secret = validXaiKey('usage');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
    },
    async () => {
      const snapshot = await xaiProvider.getUsageSnapshot({ live: false });
      assert.equal(snapshot.provider, 'xai');
      assert.equal(snapshot.configured, true);
      assert.ok(Array.isArray(snapshot.accounts));
      assert.equal(snapshot.probe, null);
      assert.deepEqual(snapshot.liveModels, []);
      const serialized = JSON.stringify(snapshot);
      assert.equal(serialized.includes(secret), false);
    }
  );
});

test('usage counters increment on success and error without real network', async () => {
  const secret = validXaiKey('counters');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
      XAI_ACCOUNT_LABEL: 'Counter account',
    },
    async ({ usageFile }) => {
      const accountId = 'xai-env-primary';
      xaiProvider.recordUsage({
        accountId,
        model: 'grok-4',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
      xaiProvider.recordUsage({
        accountId,
        model: 'grok-4',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
      xaiProvider.recordUsage({
        accountId,
        model: 'grok-4',
        error: '429: rate limited (mock)',
      });

      const snapshot = await xaiProvider.getUsageSnapshot({ live: false });
      const publicAccount = snapshot.accounts.find((a) => a.id === accountId);
      assert.ok(publicAccount);
      assert.equal(publicAccount.usage.requests, 2);
      assert.equal(publicAccount.usage.prompt_tokens, 11);
      assert.equal(publicAccount.usage.completion_tokens, 22);
      assert.equal(publicAccount.usage.total_tokens, 33);
      assert.equal(publicAccount.usage.errors, 1);
      assert.equal(publicAccount.usage.last_model, 'grok-4');
      assert.ok(publicAccount.usage.last_success_at);
      assert.ok(publicAccount.usage.last_error_at);
      assert.match(String(publicAccount.usage.last_error), /rate limited/i);
      assert.equal(publicAccount.key, undefined);
      assert.ok(fs.existsSync(usageFile));
      assert.equal(fs.readFileSync(usageFile, 'utf8').includes(secret), false);
    }
  );
});

test('active account selection: preferred > env active > first account', async () => {
  const keyA = validXaiKey('acct-a');
  const keyB = validXaiKey('acct-b');
  const keyC = validXaiKey('acct-c');

  await withXaiEnv(
    {
      XAI_API_KEY_1: keyA,
      XAI_ACCOUNT_LABEL_1: 'Account A',
      XAI_API_KEY_2: keyB,
      XAI_ACCOUNT_LABEL_2: 'Account B',
      XAI_API_KEY_3: keyC,
      XAI_ACCOUNT_LABEL_3: 'Account C',
    },
    async ({ activeFile }) => {
      const accounts = xaiProvider.getAccounts().filter((a) => a.enabled);
      assert.ok(accounts.length >= 3);

      // Default: first enabled account
      const first = xaiProvider.resolveActiveAccount(null);
      assert.equal(first.id, accounts[0].id);

      // Preferred argument wins
      const preferred = xaiProvider.resolveActiveAccount(accounts[2].id);
      assert.equal(preferred.id, accounts[2].id);
      assert.equal(preferred.label, 'Account C');

      // Env active id
      process.env.XAI_ACTIVE_ACCOUNT_ID = accounts[1].id;
      const fromEnv = xaiProvider.resolveActiveAccount(null);
      assert.equal(fromEnv.id, accounts[1].id);

      // Preferred still beats env
      const preferredOverEnv = xaiProvider.resolveActiveAccount(accounts[2].id);
      assert.equal(preferredOverEnv.id, accounts[2].id);

      // setActiveAccountId persists to isolated file and is used when env cleared
      delete process.env.XAI_ACTIVE_ACCOUNT_ID;
      const savedId = xaiProvider.setActiveAccountId(accounts[2].id);
      assert.equal(savedId, accounts[2].id);
      assert.ok(fs.existsSync(activeFile));
      const fromFile = xaiProvider.resolveActiveAccount(null);
      assert.equal(fromFile.id, accounts[2].id);

      const catalog = xaiProvider.getCatalog();
      assert.equal(catalog.activeAccountId, accounts[2].id);
      assert.equal(catalog.activeAccountLabel, 'Account C');
    }
  );
});

test('chatCompletion uses mocked client (no real xAI) and records usage', async () => {
  const secret = validXaiKey('mock-chat');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
      XAI_ACCOUNT_LABEL: 'Mock chat account',
    },
    async () => {
      const seen = [];
      xaiProvider.__test__.setClientFactory(() =>
        mockXaiClient({
          text: 'hello from mock xAI',
          model: 'grok-4',
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          onCreate: (payload) => seen.push(payload),
        })
      );

      const result = await xaiProvider.chatCompletion({
        messages: [{ role: 'user', content: 'ping' }],
        model: 'grok-4',
        temperature: 0.2,
      });

      assert.equal(result.provider, 'xai');
      assert.equal(result.text, 'hello from mock xAI');
      assert.equal(result.model, 'grok-4');
      assert.equal(result.accountId, 'xai-env-primary');
      assert.equal(result.accountLabel, 'Mock chat account');
      assert.equal(result.usage.total_tokens, 12);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].model, 'grok-4');
      assert.ok(seen[0].messages.some((m) => m.content === 'ping'));

      const snapshot = await xaiProvider.getUsageSnapshot({ live: false });
      const row = snapshot.accounts.find((a) => a.id === 'xai-env-primary');
      assert.equal(row.usage.requests, 1);
      assert.equal(row.usage.total_tokens, 12);
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
  );
});

test('chatCompletion fails offline with no keys configured', async () => {
  await withXaiEnv({}, async () => {
    await assert.rejects(
      () =>
        xaiProvider.chatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          model: 'grok-4',
        }),
      /No xAI API keys configured/i
    );
  });
});

// ---------------------------------------------------------------------------
// Chat routing: grok-* → xAI; gemini / grok_style → non-xAI
// ---------------------------------------------------------------------------

test('isXaiModelId recognizes grok-* and aliases only', () => {
  assert.equal(isXaiModelId('grok-4'), true);
  assert.equal(isXaiModelId('grok-3-mini'), true);
  assert.equal(isXaiModelId('Grok-4-0709'), true);
  assert.equal(isXaiModelId('grok'), true);
  assert.equal(isXaiModelId('grok_4_5'), true);
  assert.equal(isXaiModelId('grok-4.5'), true);

  assert.equal(isXaiModelId('gemini'), false);
  assert.equal(isXaiModelId('gemini-2.0-flash'), false);
  assert.equal(isXaiModelId('grok_style'), false);
  assert.equal(isXaiModelId('grok-style'), false);
  assert.equal(isXaiModelId('balanced'), false);
  assert.equal(isXaiModelId(''), false);
});

test('resolveXaiModelId maps aliases to grok-4 and keeps concrete ids', () => {
  assert.equal(resolveXaiModelId('grok'), 'grok-4');
  assert.equal(resolveXaiModelId('grok_4_5'), 'grok-4');
  assert.equal(resolveXaiModelId('grok-3-mini'), 'grok-3-mini');
  assert.equal(resolveXaiModelId('grok-4-1-fast-reasoning'), 'grok-4-1-fast-reasoning');
});

test('chat routing: grok-* → xAI path; gemini / grok_style → non-xAI', () => {
  const grok4 = resolveChatProviderRouting({ model: 'grok-4' });
  assert.equal(grok4.useXai, true);
  assert.equal(grok4.provider, 'xai');
  assert.equal(grok4.selectedModelId, 'grok-4');
  assert.equal(grok4.geminiModelId, null);

  const grokMini = resolveChatProviderRouting({ modelPreference: 'grok-3-mini' });
  assert.equal(grokMini.useXai, true);
  assert.equal(grokMini.selectedModelId, 'grok-3-mini');

  const xaiAlias = resolveChatProviderRouting({ modelPreference: 'xai' });
  assert.equal(xaiAlias.useXai, true);
  assert.equal(xaiAlias.selectedModelId, 'grok-4');

  const gemini = resolveChatProviderRouting({ modelPreference: 'gemini' });
  assert.equal(gemini.useXai, false);
  assert.equal(gemini.provider, 'gemini');
  assert.equal(gemini.selectedModelId, null);

  const geminiFlash = resolveChatProviderRouting({ model: 'gemini-2.0-flash' });
  assert.equal(geminiFlash.useXai, false);
  assert.equal(geminiFlash.geminiModelId, 'gemini-2.0-flash');

  const grokStyle = resolveChatProviderRouting({ modelPreference: 'grok_style' });
  assert.equal(grokStyle.useXai, false);
  assert.equal(grokStyle.modelPreference, 'grok_style');
  assert.equal(grokStyle.provider, 'gemini');

  const grokStyleHyphen = resolveChatProviderRouting({ modelPreference: 'grok-style' });
  assert.equal(grokStyleHyphen.useXai, false);
  assert.equal(grokStyleHyphen.modelPreference, 'grok_style');

  // UI often sends model === modelPreference (including hyphenated persona)
  const personaBoth = resolveChatProviderRouting({
    model: 'grok-style',
    modelPreference: 'grok-style',
  });
  assert.equal(personaBoth.useXai, false);
  assert.equal(personaBoth.provider, 'gemini');
  assert.equal(isChatPersonaId('grok-style'), true);
  assert.ok(/No xAI API keys configured/i.test(XAI_NOT_CONFIGURED_MESSAGE));

  // Explicit model wins over preference
  const explicit = resolveChatProviderRouting({
    model: 'grok-4',
    modelPreference: 'gemini',
  });
  assert.equal(explicit.useXai, true);
  assert.equal(explicit.selectedModelId, 'grok-4');
});

test('normalizeChatModelPreference and mode helpers', () => {
  assert.equal(normalizeChatModelPreference('gemini-auto'), 'gemini');
  assert.equal(normalizeChatModelPreference('auto'), 'balanced');
  assert.equal(normalizeChatModelPreference('grok-style'), 'grok_style');
  assert.equal(normalizeChatModelPreference('grok-4'), 'grok-4');

  assert.equal(normalizeChatMode('multi_agent'), 'multi');
  assert.equal(normalizeChatMode('agents'), 'multi');
  assert.equal(normalizeChatMode('solo'), 'solo');
  assert.equal(clampAgentCount('solo', 99), 1);
  assert.equal(clampAgentCount('multi', 1), 2); // multi clamps min 2
  assert.equal(clampAgentCount('multi', 4), 4);
  assert.equal(clampAgentCount('multi', 99), 5);
});

test('multi-agent + grok routing matrix stays consistent (solo/multi × gemini/xai)', () => {
  const matrix = [
    { mode: 'solo', model: 'gemini', expectXai: false, agents: 1 },
    { mode: 'solo', model: 'grok-4', expectXai: true, agents: 1 },
    { mode: 'multi', model: 'gemini', expectXai: false, agents: 3 },
    { mode: 'multi', model: 'grok-4', expectXai: true, agents: 3 },
    { mode: 'multi', model: 'grok_style', expectXai: false, agents: 2 },
  ];

  for (const row of matrix) {
    const chatMode = normalizeChatMode(row.mode);
    const agentCount = clampAgentCount(chatMode, row.agents);
    const routing = resolveChatProviderRouting({
      model: row.model,
      modelPreference: row.model,
    });
    assert.equal(routing.useXai, row.expectXai, `${row.mode}/${row.model} useXai`);
    if (chatMode === 'solo') {
      assert.equal(agentCount, 1);
    } else {
      assert.ok(agentCount >= 2 && agentCount <= 5);
    }
  }
});

test('multi-agent xAI mock runs N sequential chatCompletion calls without throw', async () => {
  const secret = validXaiKey('multi-seq');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
    },
    async () => {
      let xaiCalls = 0;
      xaiProvider.__test__.setClientFactory(() =>
        mockXaiClient({
          text: 'multi-step-note',
          onCreate: () => {
            xaiCalls += 1;
          },
        })
      );

      const routing = resolveChatProviderRouting({ model: 'grok-4', modelPreference: 'grok-4' });
      assert.equal(routing.useXai, true);
      const agentCount = clampAgentCount('multi', 3);
      // Simulate multi path: (N-1) specialists + synthesizer = agentCount calls
      const texts = [];
      for (let i = 0; i < agentCount; i += 1) {
        const result = await xaiProvider.chatCompletion({
          messages: [{ role: 'user', content: `agent step ${i + 1}` }],
          model: routing.selectedModelId,
        });
        texts.push(result.text);
      }
      assert.equal(xaiCalls, agentCount);
      assert.equal(texts.length, agentCount);
      assert.ok(texts.every((t) => t === 'multi-step-note'));
    }
  );
});

test('mock xAI path for grok-* vs non-xAI for gemini/grok_style (routing + provider mock)', async () => {
  const secret = validXaiKey('route-mock');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
    },
    async () => {
      let xaiCalls = 0;
      xaiProvider.__test__.setClientFactory(() =>
        mockXaiClient({
          text: 'xai-path',
          onCreate: () => {
            xaiCalls += 1;
          },
        })
      );

      // grok-* → live xAI mock path
      const grokRouting = resolveChatProviderRouting({ model: 'grok-4' });
      assert.equal(grokRouting.useXai, true);
      if (grokRouting.useXai) {
        const result = await xaiProvider.chatCompletion({
          messages: [{ role: 'user', content: 'via xai' }],
          model: grokRouting.selectedModelId,
        });
        assert.equal(result.provider, 'xai');
        assert.equal(result.text, 'xai-path');
      }
      assert.equal(xaiCalls, 1);

      // gemini → must not call xAI
      const geminiRouting = resolveChatProviderRouting({ modelPreference: 'gemini' });
      assert.equal(geminiRouting.useXai, false);
      assert.equal(xaiCalls, 1);

      // grok_style persona → non-xAI (Gemini pool), must not call xAI
      const styleRouting = resolveChatProviderRouting({ modelPreference: 'grok_style' });
      assert.equal(styleRouting.useXai, false);
      assert.equal(xaiCalls, 1);
    }
  );
});

// ---------------------------------------------------------------------------
// Catalog / usage / active route shape helpers (mocked provider, offline)
// ---------------------------------------------------------------------------

test('catalog + usage + active selection shape is safe for API responses', async () => {
  const secret = validXaiKey('api-shape');
  await withXaiEnv(
    {
      XAI_API_KEY: secret,
      XAI_ACCOUNT_LABEL: 'Shape account',
    },
    async () => {
      xaiProvider.recordUsage({
        accountId: 'xai-env-primary',
        model: 'grok-4',
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });

      const catalog = xaiProvider.getCatalog();
      // Shape mirrors GET /api/v1/ai/catalog body fields
      const catalogPayload = {
        success: true,
        ...catalog,
      };
      assert.equal(catalogPayload.success, true);
      assert.ok(Array.isArray(catalogPayload.accounts));
      assert.ok(catalogPayload.models);
      for (const account of catalogPayload.accounts) {
        assert.ok(account.maskedKey);
        assert.equal(account.key, undefined);
        assert.equal(account.apiKey, undefined);
      }
      assert.equal(JSON.stringify(catalogPayload).includes(secret), false);

      const usage = await xaiProvider.getUsageSnapshot({ live: false });
      const usagePayload = { success: true, ...usage };
      assert.equal(usagePayload.success, true);
      assert.ok(Array.isArray(usagePayload.accounts));
      assert.equal(usagePayload.probe, null);
      assert.equal(JSON.stringify(usagePayload).includes(secret), false);

      const activeId = xaiProvider.setActiveAccountId('xai-env-primary');
      const activePayload = {
        success: true,
        activeAccountId: activeId,
        catalog: xaiProvider.getCatalog(),
      };
      assert.equal(activePayload.activeAccountId, 'xai-env-primary');
      assert.equal(activePayload.catalog.activeAccountId, 'xai-env-primary');
      assert.equal(JSON.stringify(activePayload).includes(secret), false);
    }
  );
});

test('HTTP catalog/usage when local server is reachable (optional, offline-safe)', async (t) => {
  const candidates = [
    process.env.BACKEND_PUBLIC_URL,
    process.env.EXPLORE_BACKEND_URL,
    'http://127.0.0.1:8080',
    'http://localhost:8080',
  ].filter(Boolean);

  let baseUrl = null;
  for (const candidate of candidates) {
    const root = String(candidate).replace(/\/$/, '');
    try {
      const health = await fetch(`${root}/api/v1/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (health.ok) {
        baseUrl = root;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!baseUrl) {
    t.skip('No local backend listening; skipped HTTP catalog/usage checks');
    return;
  }

  const catalogRes = await fetch(`${baseUrl}/api/v1/ai/catalog`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(catalogRes.ok, true);
  const catalog = await catalogRes.json();
  assert.equal(catalog.success, true);
  assert.ok(Array.isArray(catalog.accounts));
  for (const account of catalog.accounts) {
    assert.ok(account.maskedKey);
    assert.equal(account.key, undefined);
  }
  // Ensure live=false path was used by default (no forced xAI network dependency)
  assert.ok(catalog.models);

  const usageRes = await fetch(`${baseUrl}/api/v1/ai/usage`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(usageRes.ok, true);
  const usage = await usageRes.json();
  assert.equal(usage.success, true);
  assert.ok(Array.isArray(usage.accounts));
  for (const account of usage.accounts) {
    assert.ok(account.maskedKey);
    assert.equal(account.key, undefined);
  }
});
