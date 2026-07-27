#!/usr/bin/env node
/**
 * Lightweight smoke test for xAI catalog / usage / active-account / chat routes.
 * Hits localhost:8080; skips gracefully if the server is down.
 * Never prints secrets — only pass/fail and safe metadata.
 */

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 4000);

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name, detail = '') {
  results.push({ name, ok: null, detail });
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}

function looksLikeSecret(value) {
  if (typeof value !== 'string') return false;
  if (/^(xai-|sk-|gsk_|AIza)[A-Za-z0-9_\-]{16,}$/i.test(value)) return true;
  if (value.length >= 32 && /^[A-Za-z0-9_\-]{32,}$/.test(value) && !/[…•]/.test(value)) {
    return true;
  }
  return false;
}

function findSecretLeaks(node, path = '$', found = []) {
  if (node == null) return found;
  if (typeof node === 'string') {
    if (looksLikeSecret(node)) found.push(path);
    return found;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => findSecretLeaks(item, `${path}[${i}]`, found));
    return found;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^(key|apiKey|secret|token|password|authorization)$/i.test(k) && typeof v === 'string' && v.length > 8) {
        found.push(`${path}.${k}`);
      }
      findSecretLeaks(v, `${path}.${k}`, found);
    }
  }
  return found;
}

async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function serverUp() {
  try {
    const res = await fetchJson('/api/v1/ai/catalog');
    return res.status > 0 && res.status < 600;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`xAI catalog smoke test → ${BASE}\n`);

  let up = false;
  try {
    up = await serverUp();
  } catch {
    up = false;
  }

  if (!up) {
    skip('server-reachable', `no response from ${BASE} (start backend with npm start / PORT=8080)`);
    skip('GET /api/v1/ai/catalog');
    skip('GET /api/v1/ai/usage');
    skip('POST /api/v1/ai/accounts/active');
    skip('POST /api/v1/chat model=grok-4');
    printSummary();
    process.exit(0);
  }

  pass('server-reachable', BASE);

  // --- catalog ---
  try {
    const { status, body } = await fetchJson('/api/v1/ai/catalog');
    if (status !== 200) {
      fail('GET /api/v1/ai/catalog', `status ${status}`);
    } else if (!body || body.success !== true) {
      fail('GET /api/v1/ai/catalog', 'missing success:true');
    } else {
      const leaks = findSecretLeaks(body);
      if (leaks.length) {
        fail('GET /api/v1/ai/catalog', `possible secret leak at ${leaks.slice(0, 3).join(', ')}`);
      } else {
        const modelCount =
          body.models?.xai?.length ||
          body.knownModels?.length ||
          body.models?.known?.length ||
          0;
        const accounts = Array.isArray(body.accounts) ? body.accounts.length : 0;
        pass(
          'GET /api/v1/ai/catalog',
          `accounts=${accounts} models≈${modelCount} active=${body.activeAccountId || 'none'} keys masked`
        );
      }
    }
  } catch (error) {
    fail('GET /api/v1/ai/catalog', String(error.message || error));
  }

  // --- usage ---
  try {
    const { status, body } = await fetchJson('/api/v1/ai/usage');
    if (status !== 200) {
      fail('GET /api/v1/ai/usage', `status ${status}`);
    } else if (!body || body.success !== true) {
      fail('GET /api/v1/ai/usage', 'missing success:true');
    } else {
      const leaks = findSecretLeaks(body);
      if (leaks.length) {
        fail('GET /api/v1/ai/usage', `possible secret leak at ${leaks.slice(0, 3).join(', ')}`);
      } else {
        pass(
          'GET /api/v1/ai/usage',
          `configured=${Boolean(body.configured)} accounts=${Array.isArray(body.accounts) ? body.accounts.length : 0}`
        );
      }
    }
  } catch (error) {
    fail('GET /api/v1/ai/usage', String(error.message || error));
  }

  // --- set active account (only if catalog has an account) ---
  try {
    const catalog = await fetchJson('/api/v1/ai/catalog');
    const firstId = catalog.body?.accounts?.[0]?.id;
    if (!firstId) {
      skip('POST /api/v1/ai/accounts/active', 'no configured accounts to activate');
    } else {
      const { status, body } = await fetchJson('/api/v1/ai/accounts/active', {
        method: 'POST',
        body: JSON.stringify({ accountId: firstId }),
      });
      if (status !== 200 || body?.success !== true) {
        fail('POST /api/v1/ai/accounts/active', `status ${status} error=${body?.error || 'unknown'}`);
      } else if (body.activeAccountId !== firstId) {
        fail('POST /api/v1/ai/accounts/active', `expected ${firstId}, got ${body.activeAccountId}`);
      } else {
        const leaks = findSecretLeaks(body);
        if (leaks.length) {
          fail('POST /api/v1/ai/accounts/active', `possible secret leak at ${leaks[0]}`);
        } else {
          pass('POST /api/v1/ai/accounts/active', `activeAccountId=${body.activeAccountId}`);
        }
      }
    }
  } catch (error) {
    fail('POST /api/v1/ai/accounts/active', String(error.message || error));
  }

  // --- chat with grok-4 (may fallback if no keys; still validates route shape) ---
  try {
    const catalog = await fetchJson('/api/v1/ai/catalog');
    const accountId = catalog.body?.activeAccountId || catalog.body?.accounts?.[0]?.id || null;
    const payload = {
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
      model: 'grok-4',
      mode: 'solo',
    };
    if (accountId) payload.accountId = accountId;

    const { status, body } = await fetchJson('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (status === 429) {
      skip('POST /api/v1/chat model=grok-4', 'rate limited');
    } else if (status === 503) {
      // Honest "no keys" response — not an opaque 500
      if (/No xAI API keys configured/i.test(String(body?.error || ''))) {
        pass('POST /api/v1/chat model=grok-4', '503 honest no-keys message');
      } else {
        fail('POST /api/v1/chat model=grok-4', `503 without clear config message: ${body?.error || 'n/a'}`);
      }
    } else if (status !== 200) {
      fail('POST /api/v1/chat model=grok-4', `status ${status} error=${body?.error || 'n/a'}`);
    } else if (!body || typeof body.reply !== 'string') {
      fail('POST /api/v1/chat model=grok-4', 'missing reply string');
    } else {
      const leaks = findSecretLeaks(body);
      if (leaks.length) {
        fail('POST /api/v1/chat model=grok-4', `possible secret leak at ${leaks[0]}`);
      } else {
        const provider = body.provider || 'unknown';
        const model = body.model || 'unknown';
        const note = body.fallback
          ? `fallback=true provider=${provider} model=${model}`
          : `provider=${provider} model=${model} account=${body.accountId || 'n/a'}`;
        pass('POST /api/v1/chat model=grok-4', note);
      }
    }
  } catch (error) {
    fail('POST /api/v1/chat model=grok-4', String(error.message || error));
  }

  printSummary();
  const failed = results.filter((r) => r.ok === false).length;
  process.exit(failed ? 1 : 0);
}

function printSummary() {
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\nSummary: ${passed} pass, ${failed} fail, ${skipped} skip`);
}

main().catch((error) => {
  console.error('Unexpected error:', error?.message || error);
  process.exit(1);
});
