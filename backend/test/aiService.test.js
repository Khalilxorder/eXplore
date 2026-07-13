const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const aiService = require('../services/aiService');

// Keep these tests hermetic. getGeminiApiKeys() also reads an on-disk key pool
// (~/.dev-config/gemini-key-pool.json by default), so on a developer machine the
// real pooled keys would leak in and break assertions that expect only the keys
// each test sets via env. Point GEMINI_KEY_POOL_FILE at a path that does not
// exist so the file source is always empty here.
const MISSING_KEY_POOL_FILE = path.join(os.tmpdir(), 'explore-missing-gemini-key-pool.json');
let originalKeyPoolFile;

test.beforeEach(() => {
  originalKeyPoolFile = process.env.GEMINI_KEY_POOL_FILE;
  process.env.GEMINI_KEY_POOL_FILE = MISSING_KEY_POOL_FILE;
});

test.afterEach(() => {
  if (originalKeyPoolFile === undefined) {
    delete process.env.GEMINI_KEY_POOL_FILE;
  } else {
    process.env.GEMINI_KEY_POOL_FILE = originalKeyPoolFile;
  }
});

test('Gemini embedding requests rotate across configured keys', async () => {
  const originalFetch = global.fetch;
  const originalKey1 = process.env.GOOGLE_AI_API_KEY_1;
  const originalKey2 = process.env.GOOGLE_AI_API_KEY_2;
  const originalKeys = process.env.GOOGLE_AI_API_KEYS;

  aiService.__test__.resetGeminiKeyCooldowns();
  process.env.GOOGLE_AI_API_KEYS = '';
  process.env.GOOGLE_AI_API_KEY_1 = 'AIzaValidGeminiKey1234567890';
  process.env.GOOGLE_AI_API_KEY_2 = 'AIzaBackupGeminiKey1234567890';

  const seenKeys = [];
  global.fetch = async (url, options) => {
    seenKeys.push(options.headers['x-goog-api-key']);

    if (seenKeys.length === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      };
    }

    return {
      ok: true,
      json: async () => ({
        embedding: {
          values: [1, 0, 0],
        },
      }),
    };
  };

  try {
    const vector = await aiService.generateEmbedding('hello world', { providerPreference: 'gemini' });

    assert.deepEqual(seenKeys, ['AIzaValidGeminiKey1234567890', 'AIzaBackupGeminiKey1234567890']);
    assert.deepEqual(vector, [1, 0, 0]);
  } finally {
    aiService.__test__.resetGeminiKeyCooldowns();
    global.fetch = originalFetch;
    process.env.GOOGLE_AI_API_KEY_1 = originalKey1;
    process.env.GOOGLE_AI_API_KEY_2 = originalKey2;
    process.env.GOOGLE_AI_API_KEYS = originalKeys;
  }
});

test('Gemini cooldown skips a recently failing key on the next request', async () => {
  const originalFetch = global.fetch;
  const originalKey1 = process.env.GOOGLE_AI_API_KEY_1;
  const originalKey2 = process.env.GOOGLE_AI_API_KEY_2;
  const originalKeys = process.env.GOOGLE_AI_API_KEYS;

  aiService.__test__.resetGeminiKeyCooldowns();
  process.env.GOOGLE_AI_API_KEYS = '';
  process.env.GOOGLE_AI_API_KEY_1 = 'AIzaValidGeminiKey1234567890';
  process.env.GOOGLE_AI_API_KEY_2 = 'AIzaBackupGeminiKey1234567890';

  const seenKeys = [];
  let firstCall = true;
  global.fetch = async (url, options) => {
    seenKeys.push(options.headers['x-goog-api-key']);

    if (firstCall) {
      firstCall = false;
      return {
        ok: false,
        status: 403,
        text: async () => 'permission denied',
      };
    }

    return {
      ok: true,
      json: async () => ({
        embedding: {
          values: [1, 0, 0],
        },
      }),
    };
  };

  try {
    await aiService.generateEmbedding('first request', { providerPreference: 'gemini' });
    seenKeys.length = 0;

    const vector = await aiService.generateEmbedding('second request', { providerPreference: 'gemini' });

    assert.deepEqual(vector, [1, 0, 0]);
    assert.deepEqual(seenKeys, ['AIzaBackupGeminiKey1234567890']);
  } finally {
    aiService.__test__.resetGeminiKeyCooldowns();
    global.fetch = originalFetch;
    process.env.GOOGLE_AI_API_KEY_1 = originalKey1;
    process.env.GOOGLE_AI_API_KEY_2 = originalKey2;
    process.env.GOOGLE_AI_API_KEYS = originalKeys;
  }
});

test('placeholder and junk provider keys are ignored', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalGeminiKey = process.env.GOOGLE_AI_API_KEY;
  const originalGeminiKey1 = process.env.GOOGLE_AI_API_KEY_1;
  const originalGeminiKey2 = process.env.GOOGLE_AI_API_KEY_2;

  process.env.OPENAI_API_KEY = 'y';
  process.env.GOOGLE_AI_API_KEY = 'YOUR_PROD_GOOGLE_AI_KEY';
  process.env.GOOGLE_AI_API_KEY_1 = 'AIzaValidGeminiKey1234567890';
  process.env.GOOGLE_AI_API_KEY_2 = 'placeholder-demo-key';

  try {
    assert.equal(aiService.__test__.isUsableApiKey(process.env.OPENAI_API_KEY, 'openai'), false);
    assert.equal(aiService.__test__.isUsableApiKey(process.env.GOOGLE_AI_API_KEY, 'gemini'), false);
    assert.deepEqual(aiService.__test__.getGeminiApiKeys(), ['AIzaValidGeminiKey1234567890']);
  } finally {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
    process.env.GOOGLE_AI_API_KEY = originalGeminiKey;
    process.env.GOOGLE_AI_API_KEY_1 = originalGeminiKey1;
    process.env.GOOGLE_AI_API_KEY_2 = originalGeminiKey2;
  }
});

test('explicit provider preference does not silently fall back to the other provider', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalGeminiKey = process.env.GOOGLE_AI_API_KEY;
  const originalGeminiKey1 = process.env.GOOGLE_AI_API_KEY_1;
  const originalKeys = process.env.GOOGLE_AI_API_KEYS;

  process.env.OPENAI_API_KEY = '';
  process.env.GOOGLE_AI_API_KEY = 'AIzaValidGeminiKey1234567890';
  process.env.GOOGLE_AI_API_KEY_1 = '';
  process.env.GOOGLE_AI_API_KEYS = '';

  try {
    assert.equal(aiService.__test__.getAiProvider('openai'), 'mock');
    assert.equal(aiService.__test__.getAiProvider('gemini'), 'gemini');
  } finally {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
    process.env.GOOGLE_AI_API_KEY = originalGeminiKey;
    process.env.GOOGLE_AI_API_KEY_1 = originalGeminiKey1;
    process.env.GOOGLE_AI_API_KEYS = originalKeys;
  }
});

test('invalid Gemini 3.5 aliases are normalized to the supported flash-lite model', () => {
  assert.equal(
    aiService.__test__.normalizeGeminiModelName('gemini-3.5-flash'),
    'gemini-3.5-flash',
  );
  assert.equal(
    aiService.__test__.normalizeGeminiModelName('models/gemini-3.5-flash-lite'),
    'gemini-3.5-flash',
  );
  assert.equal(
    aiService.__test__.normalizeGeminiModelName('gemini-2.5-flash'),
    'gemini-3.5-flash',
  );
});
