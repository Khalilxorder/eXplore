const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const aiService = require('../services/aiService');

const GEMINI_ENV_NAMES = [
  'GOOGLE_AI_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEYS',
  'GEMINI_KEY_POOL_FILE',
  ...Array.from({ length: 100 }, (_, index) => index + 1).flatMap((index) => [
    `GOOGLE_AI_API_KEY_${index}`,
    `GOOGLE_GEMINI_API_KEY_${index}`,
    `GEMINI_API_KEY_${index}`,
  ]),
];

function validGeminiKey(index) {
  return `AIzaValidGeminiKey${String(index).padStart(2, '0')}1234567890`;
}

function validAiStudioKey(index) {
  return `AQ.Ab8RN6${String(index).padStart(2, '0')}ValidGeminiStudioKey_1234567890`;
}

async function withGeminiEnv(values, callback) {
  const originalValues = new Map(GEMINI_ENV_NAMES.map((name) => [name, process.env[name]]));

  GEMINI_ENV_NAMES.forEach((name) => {
    delete process.env[name];
  });
  process.env.GEMINI_KEY_POOL_FILE = path.join(os.tmpdir(), 'explore-missing-gemini-key-pool.json');
  Object.entries(values).forEach(([name, value]) => {
    process.env[name] = value;
  });
  aiService.__test__.resetGeminiKeyCooldowns();

  try {
    return await callback();
  } finally {
    aiService.__test__.resetGeminiKeyCooldowns();
    GEMINI_ENV_NAMES.forEach((name) => {
      const originalValue = originalValues.get(name);
      if (originalValue === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalValue;
      }
    });
  }
}

test('Gemini key rotation under mock-load simulation', async () => {
  const originalFetch = global.fetch;
  const keys = Array.from({ length: 5 }, (_, index) => validGeminiKey(index + 1));

  const seenKeys = [];
  let requestCount = 0;

  global.fetch = async (url, options) => {
    const keyUsed = options.headers['x-goog-api-key'];
    seenKeys.push(keyUsed);
    requestCount++;

    if (keyUsed === keys[0] && requestCount === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      };
    }

    if (keyUsed === keys[1] && requestCount === 2) {
      return {
        ok: false,
        status: 500,
        text: async () => 'internal server error',
      };
    }

    return {
      ok: true,
      json: async () => ({
        embedding: {
          values: [0.5, 0.5, 0.5],
        },
      }),
    };
  };

  try {
    await withGeminiEnv({
      GOOGLE_AI_API_KEY_1: keys[0],
      GOOGLE_AI_API_KEY_2: keys[1],
      GOOGLE_AI_API_KEY_3: keys[2],
      GOOGLE_AI_API_KEY_4: keys[3],
      GOOGLE_AI_API_KEY_5: keys[4],
    }, async () => {
      const vector = await aiService.generateEmbedding('test embedding', { providerPreference: 'gemini' });

      assert.deepEqual(vector, [0.5773502691896258, 0.5773502691896258, 0.5773502691896258]);
      assert.deepEqual(seenKeys, [keys[0], keys[1], keys[2]]);

      seenKeys.length = 0;
      const vector2 = await aiService.generateEmbedding('second embedding', { providerPreference: 'gemini' });

      assert.deepEqual(vector2, [0.5773502691896258, 0.5773502691896258, 0.5773502691896258]);
      assert.deepEqual(seenKeys, [keys[3]]);
    });

  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini key rotation distributes successful calls round-robin', async () => {
  const originalFetch = global.fetch;
  const keys = Array.from({ length: 4 }, (_, index) => validGeminiKey(index + 61));
  const seenKeys = [];

  global.fetch = async (url, options) => {
    seenKeys.push(options.headers['x-goog-api-key']);
    return {
      ok: true,
      json: async () => ({
        embedding: {
          values: [0.5, 0.5, 0.5],
        },
      }),
    };
  };

  try {
    await withGeminiEnv({
      GOOGLE_AI_API_KEY_1: keys[0],
      GOOGLE_AI_API_KEY_2: keys[1],
      GOOGLE_AI_API_KEY_3: keys[2],
      GOOGLE_AI_API_KEY_4: keys[3],
    }, async () => {
      for (let index = 0; index < 6; index += 1) {
        await aiService.generateEmbedding(`round robin ${index}`, { providerPreference: 'gemini' });
      }

      assert.deepEqual(seenKeys, [
        keys[0],
        keys[1],
        keys[2],
        keys[3],
        keys[0],
        keys[1],
      ]);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini key rotation cools disabled service-account keys', async () => {
  const originalFetch = global.fetch;
  const keys = [validAiStudioKey(71), validGeminiKey(72)];
  const seenKeys = [];

  global.fetch = async (url, options) => {
    const keyUsed = options.headers['x-goog-api-key'];
    seenKeys.push(keyUsed);

    if (keyUsed === keys[0]) {
      return {
        ok: false,
        status: 401,
        text: async () => 'The bound service account is deleted or disabled.',
      };
    }

    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: '{"ok":true,"label":"live"}' },
              ],
            },
          },
        ],
      }),
    };
  };

  try {
    await withGeminiEnv({
      GOOGLE_AI_API_KEY_1: keys[0],
      GOOGLE_AI_API_KEY_2: keys[1],
    }, async () => {
      const result = await aiService.generateStructuredJson({
        providerPreference: 'gemini',
        systemPrompt: 'Return JSON.',
        userPrompt: 'Return {"ok":true,"label":"live"}',
      });

      assert.deepEqual(result, { ok: true, label: 'live' });
      assert.deepEqual(seenKeys, keys);
      assert.deepEqual(aiService.__test__.getGeminiKeyHealthSummary(keys).cooldownStatuses, { 401: 1 });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini failed requests are capped so one call cannot drain the whole pool', async () => {
  const originalFetch = global.fetch;
  const keys = Array.from({ length: 5 }, (_, index) => validGeminiKey(index + 81));
  const seenKeys = [];

  global.fetch = async (url, options) => {
    seenKeys.push(options.headers['x-goog-api-key']);
    return {
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    };
  };

  try {
    await withGeminiEnv({
      GOOGLE_AI_API_KEY_1: keys[0],
      GOOGLE_AI_API_KEY_2: keys[1],
      GOOGLE_AI_API_KEY_3: keys[2],
      GOOGLE_AI_API_KEY_4: keys[3],
      GOOGLE_AI_API_KEY_5: keys[4],
    }, async () => {
      await assert.rejects(
        () => aiService.generateStructuredJson({
          providerPreference: 'gemini',
          systemPrompt: 'Return JSON.',
          userPrompt: 'Return {"ok":true}',
        }),
        /Gemini API error/
      );

      assert.equal(seenKeys.length, 3);
      assert.deepEqual(aiService.__test__.getGeminiKeyHealthSummary(keys).cooldownStatuses, { 429: 3 });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini key parser accepts one hundred indexed keys in rotation order', async () => {
  const keys = Array.from({ length: 100 }, (_, index) => validGeminiKey(index + 1));
  const env = Object.fromEntries(keys.map((key, index) => [`GOOGLE_AI_API_KEY_${index + 1}`, key]));

  await withGeminiEnv(env, async () => {
    assert.deepEqual(aiService.__test__.getGeminiApiKeys(), keys);
    assert.deepEqual(aiService.__test__.getGeminiKeyRotationOrder(), keys);
  });
});

test('Gemini key parser accepts reusable metadata pool file', async () => {
  const keys = [validGeminiKey(101), validAiStudioKey(102), validGeminiKey(103)];
  const poolFile = path.join(os.tmpdir(), `explore-gemini-key-pool-${Date.now()}.json`);

  fs.writeFileSync(poolFile, JSON.stringify({
    version: 1,
    keys: [
      {
        key: keys[0],
        account: 'account-a@example.com',
        project: 'project-a',
        label: 'primary flash key',
      },
      {
        apiKey: keys[1],
        account: 'account-b@example.com',
        project: 'project-b',
        label: 'backup flash key',
      },
      keys[2],
      {
        key: 'not-a-real-key',
        account: 'ignored@example.com',
      },
    ],
  }));

  try {
    await withGeminiEnv({ GEMINI_KEY_POOL_FILE: poolFile }, async () => {
      assert.deepEqual(aiService.__test__.getGeminiApiKeys(), keys);
    });
  } finally {
    fs.rmSync(poolFile, { force: true });
  }
});

test('Gemini key parser accepts comma and newline pooled keys', async () => {
  const keys = [validGeminiKey(11), validAiStudioKey(12), validGeminiKey(13)];

  await withGeminiEnv({
    GOOGLE_AI_API_KEYS: ` ${keys[0]},${keys[1]}\n${keys[2]}\r\n${keys[1]} `,
  }, async () => {
    assert.deepEqual(aiService.__test__.getGeminiApiKeys(), keys);
  });
});

test('Gemini key parser rejects malformed and placeholder keys', async () => {
  const goodKey = validGeminiKey(21);

  await withGeminiEnv({
    GOOGLE_AI_API_KEY: 'YOUR_PROD_GOOGLE_AI_KEY',
    GOOGLE_GEMINI_API_KEY: 'sk-openai-shaped-key-should-not-pass',
    GEMINI_API_KEY: 'AIzaShort',
    GOOGLE_AI_API_KEYS: `not-a-google-key,\n${goodKey}\nplaceholder-demo-key`,
    GOOGLE_AI_API_KEY_1: 'AIzaInvalid Space In Key 1234567890',
    GOOGLE_AI_API_KEY_2: 'CHANGE_ME',
  }, async () => {
    assert.equal(aiService.__test__.isUsableApiKey('AIzaShort', 'gemini'), false);
    assert.equal(aiService.__test__.isUsableApiKey('AQ.Short', 'gemini'), false);
    assert.equal(aiService.__test__.isUsableApiKey(validAiStudioKey(22), 'gemini'), true);
    assert.equal(aiService.__test__.isUsableApiKey('AIzaInvalid Space In Key 1234567890', 'gemini'), false);
    assert.equal(aiService.__test__.isUsableApiKey('placeholder-demo-key', 'gemini'), false);
    assert.deepEqual(aiService.__test__.getGeminiApiKeys(), [goodKey]);
  });
});

test('safe model-pool diagnostics exposes counts and models but never key values', async () => {
  const keys = [validGeminiKey(31), validGeminiKey(32)];

  await withGeminiEnv({
    GOOGLE_AI_API_KEY_1: keys[0],
    GOOGLE_AI_API_KEY_2: keys[1],
  }, async () => {
    aiService.__test__.markGeminiKeyCooldown(keys[0], 429);
    const diagnostics = aiService.getSafeModelPoolDiagnostics();
    const serialized = JSON.stringify(diagnostics);

    assert.equal(diagnostics.provider, 'gemini');
    assert.equal(diagnostics.model, 'gemini-3.5-flash');
    assert.equal(diagnostics.keyCount, 2);
    assert.equal(diagnostics.availableKeyCount, 1);
    assert.equal(diagnostics.coolingKeyCount, 1);
    assert.deepEqual(diagnostics.cooldownStatuses, { 429: 1 });
    assert.equal(typeof diagnostics.nextRetryAt, 'string');
    assert.equal(diagnostics.degraded, true);
    assert.equal(diagnostics.rotationEnabled, true);
    assert.equal(typeof diagnostics.openaiConfigured, 'boolean');
    assert.equal(serialized.includes('AIza'), false);
    assert.equal(serialized.includes(keys[0]), false);
    assert.equal(serialized.includes(keys[1]), false);
  });
});

test('live provider probe records a successful Gemini response without leaking keys', async () => {
  const originalFetch = global.fetch;
  const key = validGeminiKey(41);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"ok":true,"label":"live"}' },
            ],
          },
        },
      ],
    }),
  });

  try {
    await withGeminiEnv({ GOOGLE_AI_API_KEY: key }, async () => {
      aiService.__test__.resetLiveProbe();
      const probe = await aiService.probeLiveProvider({ providerPreference: 'gemini', timeoutMs: 1000 });
      const diagnostics = aiService.getSafeModelPoolDiagnostics();
      const serialized = JSON.stringify(diagnostics);

      assert.equal(probe.status, 'live');
      assert.equal(probe.provider, 'gemini');
      assert.equal(diagnostics.liveProbe.status, 'live');
      assert.equal(serialized.includes(key), false);
      assert.equal(serialized.includes('AIza'), false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('live provider probe records sanitized Gemini failures', async () => {
  const originalFetch = global.fetch;
  const key = validGeminiKey(42);

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => `permission denied for ${key}`,
  });

  try {
    await withGeminiEnv({ GOOGLE_AI_API_KEY: key }, async () => {
      aiService.__test__.resetLiveProbe();
      const probe = await aiService.probeLiveProvider({ providerPreference: 'gemini', timeoutMs: 1000 });

      assert.equal(probe.status, 'failed');
      assert.equal(probe.provider, 'gemini');
      assert.match(probe.error, /redacted-gemini-key/);
      assert.equal(probe.error.includes(key), false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('all cooling Gemini keys are not retried during provider selection', async () => {
  const originalFetch = global.fetch;
  const originalAllowDevMocks = process.env.ALLOW_DEV_MOCKS;
  const key = validGeminiKey(51);
  let fetchCalls = 0;

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Gemini should not be called while every key is cooling.');
  };

  try {
    process.env.ALLOW_DEV_MOCKS = 'false';
    await withGeminiEnv({ GOOGLE_AI_API_KEY: key }, async () => {
      aiService.__test__.markGeminiKeyCooldown(key, 429);

      assert.equal(aiService.__test__.hasAvailableGeminiKey(), false);
      assert.equal(aiService.__test__.getAiProvider('gemini'), 'mock');

      const analysis = await aiService.analyzeContent(
        'Anthropic releases a new coding agent',
        '',
        'Anthropic published a product update for developers.',
        { providerPreference: 'gemini' },
      );
      const embedding = await aiService.generateEmbeddingWithMetadata('Anthropic coding agent', {
        providerPreference: 'gemini',
      });

      assert.equal(fetchCalls, 0);
      assert.equal(analysis.analysis_provider, 'local');
      assert.equal(analysis.analysis_model, 'deterministic-analysis');
      assert.match(analysis.topics.join(' '), /Artificial Intelligence/);
      assert.equal(embedding.embedding_provider, 'local');
      assert.deepEqual(embedding.values, []);
    });
  } finally {
    global.fetch = originalFetch;
    process.env.ALLOW_DEV_MOCKS = originalAllowDevMocks;
  }
});

test('Gemini errors are sanitized before reaching degraded analysis metadata', async () => {
  const originalFetch = global.fetch;
  const originalAllowDevMocks = process.env.ALLOW_DEV_MOCKS;
  const key = validGeminiKey(52);

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => `Consumer api_key:${key} has been suspended`,
  });

  try {
    process.env.ALLOW_DEV_MOCKS = 'false';
    await withGeminiEnv({ GOOGLE_AI_API_KEY: key }, async () => {
      const analysis = await aiService.analyzeContent(
        'Gemini key failure',
        '',
        'This item forces a provider failure.',
        { providerPreference: 'gemini' },
      );
      const serialized = JSON.stringify(analysis);

      assert.equal(analysis.analysis_provider, 'local');
      assert.match(analysis.analysis_error, /redacted-gemini-key/);
      assert.equal(serialized.includes(key), false);
      assert.equal(serialized.includes('AIza'), false);
    });
  } finally {
    global.fetch = originalFetch;
    process.env.ALLOW_DEV_MOCKS = originalAllowDevMocks;
  }
});
