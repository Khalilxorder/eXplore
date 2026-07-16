/**
 * Live-probe Gemini keys from env/pool without printing secrets.
 * Usage: node scripts/probe-gemini-pool.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.GEMINI_MODEL || process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.5-flash';

function isLive(value) {
  const s = String(value || '').trim();
  if (s.length < 10) return false;
  const u = s.toUpperCase();
  if (/(PLACEHOLDER|YOUR_|CHANGE_ME|TODO|XXX|REDACTED|EXAMPLE|INSERT|MASK)/.test(u)) return false;
  return true;
}

function mask(key) {
  const s = String(key);
  if (s.length <= 12) return `${s.slice(0, 2)}...${s.slice(-2)}`;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function collectKeys() {
  const env = {
    ...parseEnvFile(resolve(root, 'backend', '.env')),
    ...process.env,
  };
  const keys = [];
  const seen = new Set();

  const add = (raw, source) => {
    const key = String(raw || '').trim();
    if (!isLive(key) || seen.has(key)) return;
    seen.add(key);
    keys.push({ key, source });
  };

  add(env.GOOGLE_AI_API_KEY, 'GOOGLE_AI_API_KEY');
  add(env.GOOGLE_GEMINI_API_KEY, 'GOOGLE_GEMINI_API_KEY');
  add(env.GEMINI_API_KEY, 'GEMINI_API_KEY');

  for (const part of String(env.GOOGLE_AI_API_KEYS || '').split(/[\s,;]+/)) {
    add(part, 'GOOGLE_AI_API_KEYS');
  }

  for (let i = 1; i <= 100; i += 1) {
    add(env[`GOOGLE_AI_API_KEY_${i}`], `GOOGLE_AI_API_KEY_${i}`);
    add(env[`GOOGLE_GEMINI_API_KEY_${i}`], `GOOGLE_GEMINI_API_KEY_${i}`);
    add(env[`GEMINI_API_KEY_${i}`], `GEMINI_API_KEY_${i}`);
  }

  const poolPath = env.GEMINI_KEY_POOL_FILE
    || resolve(process.env.USERPROFILE || process.env.HOME || '', '.dev-config', 'gemini-key-pool.json');
  if (existsSync(poolPath)) {
    try {
      const pool = JSON.parse(readFileSync(poolPath, 'utf8'));
      const list = Array.isArray(pool?.keys) ? pool.keys : Array.isArray(pool) ? pool : [];
      for (const item of list) {
        if (typeof item === 'string') add(item, 'pool');
        else if (item && typeof item === 'object') {
          add(item.key || item.api_key || item.apiKey || item.value, 'pool');
        }
      }
    } catch {
      // ignore pool parse errors
    }
  }

  return keys;
}

async function probeKey(key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let ok = res.ok;
    let snippet = '';
    try {
      const json = JSON.parse(text);
      const out = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      snippet = String(out).slice(0, 40);
      ok = ok && Boolean(snippet || json?.candidates);
    } catch {
      snippet = text.slice(0, 80);
    }
    return { status: res.status, ok, snippet };
  } catch (error) {
    return { status: 0, ok: false, snippet: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const keys = collectKeys();
console.log(JSON.stringify({
  model,
  discovered_unique_keys: keys.length,
}, null, 2));

const results = [];
for (let i = 0; i < keys.length; i += 1) {
  const item = keys[i];
  const result = await probeKey(item.key);
  results.push({
    index: i + 1,
    source: item.source,
    mask: mask(item.key),
    status: result.status,
    ok: result.ok,
    detail: result.ok ? 'WORKING' : result.snippet,
  });
  process.stdout.write(result.ok ? '.' : 'x');
}
process.stdout.write('\n');

const working = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log(JSON.stringify({
  model,
  probed: results.length,
  working: working.length,
  failed: failed.length,
  working_masks: working.map((r) => r.mask),
  failures: failed.map((r) => ({ mask: r.mask, source: r.source, status: r.status, detail: r.detail })),
}, null, 2));

process.exit(failed.length && working.length === 0 ? 1 : 0);
