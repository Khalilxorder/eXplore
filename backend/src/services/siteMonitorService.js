'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const llmProvider = require('./llmProvider');

const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'application/atom+xml',
  'application/rss+xml',
  'application/xhtml+xml',
  'application/xml',
  'text/html',
  'text/plain',
  'text/xml',
]);
const SPIDER_FINDING_THRESHOLD = (() => {
  const configured = Number(process.env.SPIDER_FINDING_THRESHOLD || 0.65);
  return Number.isFinite(configured) ? Math.min(1, Math.max(0, configured)) : 0.65;
})();

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitored_sites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT,
      last_hash TEXT,
      last_checked_at TEXT,
      last_change_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_findings (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT,
      url TEXT,
      summary TEXT,
      fit_score REAL,
      found_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const addColumnIfNotExists = (tableName, columnName, columnDef) => {
    try {
      db.prepare(`SELECT ${columnName} FROM ${tableName} LIMIT 1`).all();
    } catch (err) {
      if (err.message.includes('no such column')) {
        console.log(`[site-monitor-migration] Adding column ${columnName} to ${tableName}`);
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
      }
    }
  };

  addColumnIfNotExists('monitored_sites', 'is_spider_web', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('monitored_sites', 'last_text', 'TEXT');

  addColumnIfNotExists('site_findings', 'novelty_score', 'REAL DEFAULT 0.0');
  addColumnIfNotExists('site_findings', 'importance_score', 'REAL DEFAULT 0.0');
  addColumnIfNotExists('site_findings', 'novel_elements', 'TEXT');
  addColumnIfNotExists('site_findings', 'is_spider_web_finding', 'INTEGER DEFAULT 0');
}

function getMonitoredSites(db, userId) {
  ensureTables(db);
  return db.prepare(`SELECT * FROM monitored_sites WHERE user_id = ? ORDER BY last_checked_at DESC`).all(userId);
}

function getSiteFindings(db, userId) {
  ensureTables(db);
  return db.prepare(`
    SELECT sf.*, ms.label as site_label, ms.url as site_url
    FROM site_findings sf
    JOIN monitored_sites ms ON sf.site_id = ms.id
    WHERE sf.user_id = ?
    ORDER BY sf.found_at DESC
    LIMIT 100
  `).all(userId);
}

function parseMonitoredUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) {
    const error = new Error('A valid monitored URL is required.');
    error.code = 'INVALID_MONITORED_URL';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    const error = new Error('Monitored URLs must be valid http or https URLs.');
    error.code = 'INVALID_MONITORED_URL';
    throw error;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('Monitored URLs must use http or https.');
    error.code = 'INVALID_MONITORED_URL';
    throw error;
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    const error = new Error('Monitored URLs cannot contain credentials.');
    error.code = 'INVALID_MONITORED_URL';
    throw error;
  }

  parsed.hash = '';
  return parsed;
}

function addMonitoredSite(db, userId, url, label, options = {}) {
  ensureTables(db);
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    throw new Error('userId is required');
  }

  const normalizedUrl = parseMonitoredUrl(url).toString();
  const isSpiderWeb = options === true
    || options?.isSpiderWeb === true
    || options?.is_spider_web === true
    || options?.is_spider_web === 1;
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO monitored_sites (
      id, user_id, url, label, last_hash, last_checked_at, last_change_at, is_spider_web, last_text
    ) VALUES (?, ?, ?, ?, '', '', '', ?, '')
  `).run(id, normalizedUserId, normalizedUrl, label || normalizedUrl, isSpiderWeb ? 1 : 0);
  return id;
}

function deleteMonitoredSite(db, userId, siteId) {
  ensureTables(db);
  db.prepare(`DELETE FROM monitored_sites WHERE id = ? AND user_id = ?`).run(siteId, userId);
  db.prepare(`DELETE FROM site_findings WHERE site_id = ? AND user_id = ?`).run(siteId, userId);
}

function parseIpv6Bytes(address) {
  let normalized = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!normalized) return null;

  const dottedTail = normalized.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/);
  if (dottedTail) {
    const parts = dottedTail[1].split('.').map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return null;
    const replacement = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    normalized = normalized.slice(0, -dottedTail[1].length) + replacement;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const groups = halves.length === 2
    ? [...left, ...new Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2));
  return bytes;
}

function isBlockedIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;

  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isBlockedIpAddress(address) {
  const normalized = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family !== 6) return true;

  const bytes = parseIpv6Bytes(normalized);
  if (!bytes) return true;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.subarray(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const siteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
  const multicast = bytes[0] === 0xff;
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const ipv4Mapped = bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const ipv4Compatible = bytes.subarray(0, 12).every((byte) => byte === 0);
  if (ipv4Mapped || ipv4Compatible) {
    return isBlockedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  return allZero || loopback || uniqueLocal || linkLocal || siteLocal || multicast || documentation;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!normalized) return true;
  if (net.isIP(normalized)) return isBlockedIpAddress(normalized);

  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.lan')
    || normalized === 'instance-data'
    || normalized === 'instance-data.ec2.internal'
    || normalized === 'metadata'
    || normalized.startsWith('metadata.');
}

function normalizeLookupRecords(records) {
  const list = Array.isArray(records) ? records : [records];
  return list.map((record) => {
    if (typeof record === 'string') {
      return { address: record, family: net.isIP(record) };
    }
    return { address: record?.address, family: Number(record?.family) || net.isIP(record?.address) };
  }).filter((record) => record.address && record.family);
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutHandle;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function assertSafeMonitoredUrl(value, options = {}) {
  const parsed = parseMonitoredUrl(value);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    const error = new Error(`Blocked monitored URL target: ${hostname}`);
    error.code = 'UNSAFE_MONITORED_URL';
    throw error;
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    const lookup = options.lookup || dns.lookup;
    try {
      const timeoutMs = Math.max(1, Number(options.timeoutMs || FETCH_TIMEOUT_MS));
      const records = await withTimeout(
        Promise.resolve(lookup(hostname, { all: true, verbatim: true })),
        timeoutMs,
        `DNS resolution timed out after ${timeoutMs}ms`
      );
      addresses = normalizeLookupRecords(records);
    } catch (cause) {
      const error = new Error(`Could not resolve monitored URL host ${hostname}: ${cause.message}`);
      error.code = 'MONITORED_URL_DNS_ERROR';
      throw error;
    }
  }

  if (!addresses.length) {
    const error = new Error(`Could not resolve monitored URL host ${hostname}`);
    error.code = 'MONITORED_URL_DNS_ERROR';
    throw error;
  }
  const blocked = addresses.find((record) => isBlockedIpAddress(record.address));
  if (blocked) {
    const error = new Error(`Blocked monitored URL target: ${hostname} resolved to ${blocked.address}`);
    error.code = 'UNSAFE_MONITORED_URL';
    throw error;
  }

  return { parsed, addresses };
}

function createPinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof options === 'function') {
      done = options;
      lookupOptions = {};
    }
    if (lookupOptions?.all) {
      done(null, addresses);
      return;
    }
    done(null, addresses[0].address, addresses[0].family);
  };
}

function isAllowedContentType(headerValue) {
  const mediaType = String(Array.isArray(headerValue) ? headerValue[0] : headerValue || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(mediaType);
}

function requestMonitoredUrl(parsed, addresses, options) {
  const transport = parsed.protocol === 'https:' ? https : http;
  const remainingMs = Math.max(1, options.deadline - Date.now());

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      reject(error);
    };
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolve(value);
    };
    const request = transport.request(parsed, {
      method: 'GET',
      agent: false,
      lookup: createPinnedLookup(addresses),
      headers: {
        Accept: 'text/html, application/xhtml+xml, text/plain, application/xml;q=0.9, text/xml;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'eXplore-SPIDER-NET/1.0',
      },
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        finishResolve({ redirect: new URL(response.headers.location, parsed).toString() });
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        finishReject(new Error(`HTTP Error ${statusCode || 'unknown'}`));
        return;
      }
      if (!isAllowedContentType(response.headers['content-type'])) {
        response.resume();
        finishReject(new Error(`Unsupported monitored response content type: ${response.headers['content-type'] || 'missing'}`));
        return;
      }
      const contentEncoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
      if (contentEncoding !== 'identity') {
        response.resume();
        finishReject(new Error(`Unsupported monitored response content encoding: ${contentEncoding}`));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > options.maxResponseBytes) {
        response.resume();
        finishReject(new Error(`Monitored response exceeds ${options.maxResponseBytes} bytes`));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        totalBytes += chunk.length;
        if (totalBytes > options.maxResponseBytes) {
          finishReject(new Error(`Monitored response exceeds ${options.maxResponseBytes} bytes`));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        finishResolve({
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: response.headers['content-type'],
        });
      });
      response.on('error', finishReject);
      response.on('aborted', () => finishReject(new Error('Monitored response was aborted')));
    });

    deadlineTimer = setTimeout(() => {
      request.destroy(new Error(`Monitored request timed out after ${options.timeoutMs}ms`));
    }, remainingMs);
    request.on('error', finishReject);
    request.end();
  });
}

async function fetchMonitoredPage(value, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || FETCH_TIMEOUT_MS));
  const maxRedirects = Math.max(0, Number(options.maxRedirects ?? MAX_REDIRECTS));
  const maxResponseBytes = Math.max(1, Number(options.maxResponseBytes || MAX_RESPONSE_BYTES));
  const deadline = Date.now() + timeoutMs;
  let currentUrl = parseMonitoredUrl(value).toString();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (Date.now() >= deadline) {
      throw new Error(`Monitored request timed out after ${timeoutMs}ms`);
    }
    const { parsed, addresses } = await assertSafeMonitoredUrl(currentUrl, {
      lookup: options.lookup,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    const result = await requestMonitoredUrl(parsed, addresses, {
      deadline,
      maxResponseBytes,
      timeoutMs,
    });
    if (!result.redirect) {
      return { body: result.body, finalUrl: parsed.toString(), contentType: result.contentType };
    }
    if (redirectCount === maxRedirects) {
      throw new Error(`Monitored request exceeded ${maxRedirects} redirects`);
    }
    currentUrl = result.redirect;
  }

  throw new Error('Monitored request redirect limit exceeded');
}

function isUsableApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length < 20) return false;
  return !/YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO/i.test(normalized)
    && !/^(?:x|y|z|null|none|undefined|test)$/i.test(normalized);
}

function resolveLiveLlmProvider() {
  if (String(process.env.ALLOW_DEV_MOCKS || '').toLowerCase() === 'true') return null;
  const configured = String(process.env.LLM_PROVIDER || '').trim().toLowerCase();
  const hasOpenAi = isUsableApiKey(process.env.OPENAI_API_KEY);
  const hasGemini = isUsableApiKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);

  if (configured) {
    if (configured === 'openai' && hasOpenAi) return 'openai';
    if (configured === 'gemini' && hasGemini) return 'gemini';
    return null;
  }
  if (hasOpenAi) return 'openai';
  if (hasGemini) return 'gemini';
  return null;
}

function normalizeSpiderAnalysis(analysis, analysisToken) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return null;
  if (analysis.analysisToken !== analysisToken) return null;
  if (analysis.degraded === true || analysis.mock === true || analysis.error || analysis.analysisError) return null;

  const provenance = [analysis.provider, analysis.source, analysis.status, analysis.mode]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (provenance.some((value) => /mock|fallback|degraded|unavailable|error/.test(value))) return null;
  if (typeof analysis.noveltyScore !== 'number' || !Number.isFinite(analysis.noveltyScore)) return null;
  if (typeof analysis.importanceScore !== 'number' || !Number.isFinite(analysis.importanceScore)) return null;
  if (analysis.noveltyScore < 0 || analysis.noveltyScore > 1) return null;
  if (analysis.importanceScore < 0 || analysis.importanceScore > 1) return null;
  if (typeof analysis.isImportant !== 'boolean') return null;
  if (!Array.isArray(analysis.novelElements) || analysis.novelElements.length === 0) return null;
  if (analysis.novelElements.some((element) => typeof element !== 'string' || !element.trim())) return null;
  if (typeof analysis.summaryOfNovelty !== 'string' || !analysis.summaryOfNovelty.trim()) return null;
  if (/mock_string_value|synthesized summary analyzing the subject matter/i.test(analysis.summaryOfNovelty)) return null;

  return {
    noveltyScore: analysis.noveltyScore,
    importanceScore: analysis.importanceScore,
    novelElements: analysis.novelElements.map((element) => element.trim().slice(0, 500)).slice(0, 20),
    summaryOfNovelty: analysis.summaryOfNovelty.trim().slice(0, 4000),
    isImportant: analysis.isImportant,
  };
}

async function checkSpiderWebNovelty(site, oldText, newText, options = {}) {
  const generateStructuredJson = options.generateStructuredJson || llmProvider.generateStructuredJson;
  const provider = options.provider || resolveLiveLlmProvider();

  const analysisToken = options.analysisToken || crypto.randomUUID();
  const systemPrompt = `You are the central processor for the SPIDER NET monitoring method in the eXplore app.
Analyze changes on a monitored webpage and identify only genuinely novel, important elements.
Ignore layout changes, timestamps, counts, advertising, navigation, and promotional boilerplate.
Return only the requested JSON object. Set analysisToken exactly to "${analysisToken}". Never claim importance when analysis is unavailable.`;

  const userPrompt = `Monitored Site: ${site.label || site.url}
URL: ${site.url}

--- BEFORE TEXT (PREVIOUS CRAWL) ---
${oldText.slice(0, 10000)}

--- AFTER TEXT (CURRENT CRAWL) ---
${newText.slice(0, 10000)}`;

  const schema = {
    type: 'object',
    properties: {
      analysisToken: { type: 'string', const: analysisToken, description: `Return exactly ${analysisToken}` },
      noveltyScore: { type: 'number', minimum: 0, maximum: 1 },
      importanceScore: { type: 'number', minimum: 0, maximum: 1 },
      novelElements: { type: 'array', items: { type: 'string' } },
      summaryOfNovelty: { type: 'string' },
      isImportant: { type: 'boolean' },
    },
    required: ['analysisToken', 'noveltyScore', 'importanceScore', 'novelElements', 'summaryOfNovelty', 'isImportant'],
  };

  try {
    const analysis = await generateStructuredJson({
      systemPrompt,
      userPrompt,
      schema,
      temperature: 0.1,
      ...(provider ? { provider } : {}),
    });
    const normalized = normalizeSpiderAnalysis(analysis, analysisToken);
    if (!normalized) {
      console.warn('[spider-net-llm] Ignored malformed, mock, or degraded analysis result.');
    }
    return normalized;
  } catch (err) {
    console.error('[spider-net-llm] Failed LLM analysis:', err.message);
    return null;
  }
}

function extractPageText(html) {
  return String(html || '')
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function updateChangedSnapshot(db, siteId, hash, text) {
  db.prepare(`
    UPDATE monitored_sites
    SET last_hash = ?, last_text = ?, last_checked_at = CURRENT_TIMESTAMP, last_change_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hash, text, siteId);
}

async function checkSite(db, site, options = {}) {
  ensureTables(db);
  const fetchPage = options.fetchPage || fetchMonitoredPage;
  const analyzeNovelty = options.analyzeNovelty || checkSpiderWebNovelty;

  try {
    const fetched = await fetchPage(site.url);
    const html = typeof fetched === 'string' ? fetched : fetched?.body;
    if (typeof html !== 'string') throw new Error('Monitored response did not contain text content');

    const text = extractPageText(html);
    const hash = crypto.createHash('sha256').update(text).digest('hex');

    if (!site.last_hash) {
      db.prepare(`
        UPDATE monitored_sites
        SET last_hash = ?, last_text = ?, last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(hash, text, site.id);
      return { siteId: site.id, label: site.label, changed: false, baseline: true };
    }

    if (hash === site.last_hash) {
      db.prepare(`
        UPDATE monitored_sites
        SET last_checked_at = CURRENT_TIMESTAMP,
            last_text = CASE WHEN COALESCE(last_text, '') = '' THEN ? ELSE last_text END
        WHERE id = ?
      `).run(text, site.id);
      return { siteId: site.id, label: site.label, changed: false };
    }

    let summary = text.slice(0, 300) + (text.length > 300 ? '...' : '');
    let noveltyScore = 0;
    let importanceScore = 0;
    let novelElements = null;
    let isSpiderWebFinding = 0;
    let fitScore = 0.5;

    if (Number(site.is_spider_web) === 1) {
      const analysis = await analyzeNovelty(site, site.last_text || '', text);
      updateChangedSnapshot(db, site.id, hash, text);

      if (!analysis) {
        return {
          siteId: site.id,
          label: site.label,
          changed: true,
          filtered: true,
          reason: 'analysis_unavailable',
        };
      }

      noveltyScore = analysis.noveltyScore;
      importanceScore = analysis.importanceScore;
      fitScore = (noveltyScore + importanceScore) / 2;
      if (
        analysis.isImportant !== true
        || importanceScore < SPIDER_FINDING_THRESHOLD
        || fitScore < SPIDER_FINDING_THRESHOLD
      ) {
        return {
          siteId: site.id,
          label: site.label,
          changed: true,
          filtered: true,
          reason: 'below_threshold',
          noveltyScore,
          importanceScore,
        };
      }

      novelElements = JSON.stringify(analysis.novelElements);
      isSpiderWebFinding = 1;
      summary = analysis.summaryOfNovelty;
    } else {
      updateChangedSnapshot(db, site.id, hash, text);
    }

    const findingId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO site_findings (
        id, site_id, user_id, title, url, summary, fit_score,
        novelty_score, importance_score, novel_elements, is_spider_web_finding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      findingId,
      site.id,
      site.user_id,
      isSpiderWebFinding ? `SPIDER NET alert: ${(site.label || 'New insight').replace(/^\[(?:Spider Web|SPIDER NET)\]\s*/i, '')}` : `Updates on ${site.label || 'Monitored Site'}`,
      site.url,
      summary,
      fitScore,
      noveltyScore,
      importanceScore,
      novelElements,
      isSpiderWebFinding
    );

    return {
      siteId: site.id,
      findingId,
      label: site.label,
      changed: true,
      summary,
      noveltyScore,
      importanceScore,
    };
  } catch (err) {
    console.error(`[site-monitor] Failed checking ${site.url}:`, err.message);
    db.prepare(`UPDATE monitored_sites SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`).run(site.id);
    return { siteId: site.id, label: site.label, error: err.message };
  }
}

function normalizeCheckFilter(filter) {
  if (filter === undefined || filter === null || filter === '' || filter === 'all') return 'all';
  if (filter === true || filter === 1 || ['1', 'spider', 'spiderweb', 'spider_web', 'spider-net', 'spider_net'].includes(String(filter).toLowerCase())) {
    return 'spider';
  }
  if (filter === false || filter === 0 || ['0', 'standard', 'normal'].includes(String(filter).toLowerCase())) return 'standard';
  const error = new Error('site_type must be all, standard, or spider');
  error.code = 'INVALID_SITE_FILTER';
  throw error;
}

async function checkAll(db, userId, filter = 'all', options = {}) {
  ensureTables(db);
  const normalizedFilter = normalizeCheckFilter(filter);
  let sql = `SELECT * FROM monitored_sites WHERE user_id = ?`;
  if (normalizedFilter === 'spider') sql += ` AND COALESCE(is_spider_web, 0) = 1`;
  if (normalizedFilter === 'standard') sql += ` AND COALESCE(is_spider_web, 0) != 1`;
  const sites = db.prepare(sql).all(userId);
  const results = [];
  const runCheckSite = options.checkSite || checkSite;
  for (const site of sites) {
    results.push(await runCheckSite(db, site));
  }
  return results;
}

module.exports = {
  ensureTables,
  getMonitoredSites,
  getSiteFindings,
  addMonitoredSite,
  deleteMonitoredSite,
  checkSpiderWebNovelty,
  checkSite,
  checkAll,
  assertSafeMonitoredUrl,
  fetchMonitoredPage,
  __test__: {
    extractPageText,
    isAllowedContentType,
    isBlockedHostname,
    isBlockedIpAddress,
    normalizeCheckFilter,
    normalizeSpiderAnalysis,
    parseMonitoredUrl,
    SPIDER_FINDING_THRESHOLD,
  },
};
