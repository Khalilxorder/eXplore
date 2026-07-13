'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Database = require('better-sqlite3');

const DEFAULT_CHROME_HISTORY_PATH = process.env.CHROME_HISTORY_PATH
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'History')
    : 'C:\\Users\\khali\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\History');

const DOMAIN_BLACKLIST = [
  'localhost', '127.0.0.1', '::1',
  'mail.google.com', 'drive.google.com', 'docs.google.com', 'keep.google.com',
  'calendar.google.com', 'meet.google.com', 'chat.google.com', 'maps.google.com',
  'accounts.google.com', 'play.google.com', 'contacts.google.com', 'photos.google.com',
  'facebook.com', 'm.facebook.com', 'messenger.com', 'whatsapp.com', 'telegram.org',
  'slack.com', 'discord.com', 'discordapp.com', 'teams.microsoft.com',
  'linkedin.com/feed', 'linkedin.com/messaging', 'linkedin.com/mynetwork', 'linkedin.com/in',
  'twitter.com/home', 'twitter.com/messages', 'twitter.com/notifications',
  'x.com/home', 'x.com/messages', 'x.com/notifications',
  'youtube.com/watch', 'm.youtube.com/watch', 'youtube.com/feed',
  'netflix.com', 'spotify.com', 'instagram.com', 'tiktok.com', 'pinterest.com',
  'amazon.com', 'amazon.co.uk', 'ebay.com', 'paypal.com', 'stripe.com',
  'github.com/login', 'github.com/notifications', 'github.com/settings',
  'vercel.com/dashboard', 'vercel.com/login',
  'supabase.com/dashboard', 'supabase.com/login',
  'openai.com/auth', 'chatgpt.com/c', 'chatgpt.com/auth', 'chatgpt.com/share',
  'gemini.google.com/app', 'gemini.google.com/u',
  'microsoft.com', 'apple.com', 'zoho.com', 'outlook.live.com',
  'outlook.office.com', 'bank', 'payment', 'checkout', 'webhp',
  'elte.hu', 'neptun', 'canvas', 'sharepoint', 'onedrive',
  'remotedesktop.google.com', 'g2g.com', 'distrokid.com', 'soundcloud.com',
  'figma.com', 'tasks.google.com', 'google.com/access', 'linkedin.com',
  'jobforce.diakber.hu', 'upwork.com', 'cloneapp.net', 'youtube.com/shorts',
  'youtube.com/@', 'appiancloud.com', 'google-services', 'nav.gov.hu', 'kau.gov.hu',
  'google.com/search',
];

const NEWS_WHITELIST_KEYWORDS = [
  'news', 'blog', 'release', 'engineering', 'changelog', 'update',
  'tech', 'announce', 'developer', 'docs', 'documentation', 'postmortem',
  'discover', 'wiki', 'paper', 'arxiv', 'medium.com', 'dev.to', 'ycombinator',
];

const NEWS_WHITELIST_DOMAINS = [
  'perplexity.ai', 'anthropic.com', 'suno.com', 'grok.com', 'zerogpt.com', 'github.com',
];

const SENSITIVE_PATH_SEGMENTS = new Set([
  '2fa', 'account', 'accounts', 'auth', 'callback', 'chat', 'chats', 'conversation',
  'conversations', 'dm', 'forgot-password', 'inbox', 'log-in', 'login', 'logout',
  'magic-link', 'messages', 'mfa', 'oauth', 'register', 'reset-password', 'session',
  'sessions', 'sign-in', 'sign-up', 'signin', 'signout', 'signup', 'sso', 'thread',
  'threads', 'verify',
]);

const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?token|api[_-]?key|auth(?:orization|user)?|bearer|code|credential|id[_-]?token|jwt|nonce|oauth|refresh[_-]?token|secret|session(?:[_-]?id)?|sid|sso|state|token)(?:$|[_-])/i;
const TRACKING_QUERY_KEY = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|ref|referrer)$/i;

function parseHttpUrl(urlStr) {
  try {
    const parsed = new URL(String(urlStr || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function hasSensitiveHistoryData(url) {
  if (url.username || url.password) return true;
  const hostname = url.hostname.toLowerCase();
  let pathname = url.pathname.toLowerCase();
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_) {}
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/_/g, '-').replace(/\.[a-z0-9]+$/i, ''));

  if (segments.some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment))) return true;
  if (hostname === 'chatgpt.com' && /\/(?:c|g|share|backend-api\/conversation)(?:\/|$)/.test(pathname)) return true;
  if (hostname === 'claude.ai' && /\/(?:chat|project)(?:\/|$)/.test(pathname)) return true;
  if (hostname === 'gemini.google.com' && /\/(?:app|u)(?:\/|$)/.test(pathname)) return true;
  if (hostname === 'perplexity.ai' && /\/(?:search|library)(?:\/|$)/.test(pathname)) return true;
  if ((hostname === 'copilot.microsoft.com' || hostname === 'www.bing.com') && /\/(?:chat|chats)(?:\/|$)/.test(pathname)) return true;

  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key) || /^(?:session|sid|jwt|sso|oauth|code)$/i.test(key)) return true;
  }
  return /(?:access[_-]?token|id[_-]?token|refresh[_-]?token|session|oauth|bearer|jwt)/i.test(url.hash);
}

function cleanUrl(urlStr) {
  const url = parseHttpUrl(urlStr);
  if (!url) return urlStr;

  const paramsToDelete = [];
  url.searchParams.forEach((_value, key) => {
    if (TRACKING_QUERY_KEY.test(key) || SENSITIVE_QUERY_KEY.test(key) || /^(?:session|sid|jwt|oauth|code)$/i.test(key)) {
      paramsToDelete.push(key);
    }
  });
  paramsToDelete.forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  return url.toString();
}

function shouldFilterUrl(urlStr) {
  const url = parseHttpUrl(urlStr);
  if (!url || hasSensitiveHistoryData(url)) return true;

  const lowerUrl = url.toString().toLowerCase();
  if (DOMAIN_BLACKLIST.some((blacklisted) => lowerUrl.includes(blacklisted))) return true;

  const isNewsOrReference = NEWS_WHITELIST_KEYWORDS.some((keyword) => lowerUrl.includes(keyword));
  const hostname = url.hostname.toLowerCase();
  const isMajorTechDomain = NEWS_WHITELIST_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  return !(isNewsOrReference || isMajorTechDomain);
}

function parseCliArgs(argv) {
  const parsed = {};
  const accepted = new Map([
    ['--user-id', 'userId'],
    ['--db-path', 'dbPath'],
    ['--history-path', 'historyPath'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const equalsIndex = raw.indexOf('=');
    const flag = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
    const key = accepted.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    parsed[key] = value;
  }

  if (!String(parsed.userId || '').trim()) throw new Error('--user-id is required');
  if (!String(parsed.dbPath || '').trim()) throw new Error('--db-path is required');
  return parsed;
}

function seedSpiderWebSites(options) {
  const userId = String(options?.userId || '').trim();
  const dbPath = path.resolve(String(options?.dbPath || '').trim());
  const historyPath = path.resolve(String(options?.historyPath || DEFAULT_CHROME_HISTORY_PATH).trim());
  const logger = options?.logger || console;
  if (!userId) throw new Error('userId is required');
  if (!options?.dbPath) throw new Error('dbPath is required');
  if (!fs.existsSync(historyPath)) throw new Error(`Chrome History file not found at: ${historyPath}`);

  const tempHistoryPath = path.join(os.tmpdir(), `explore-spider-history-${process.pid}-${crypto.randomUUID()}.db`);
  let historyDb;
  let exploreDb;

  try {
    logger.log('[spider-net-seeder] Copying Chrome history snapshot...');
    fs.copyFileSync(historyPath, tempHistoryPath);
    historyDb = new Database(tempHistoryPath, { readonly: true });
    exploreDb = new Database(dbPath);

    const siteMonitorService = require('../src/services/siteMonitorService');
    siteMonitorService.ensureTables(exploreDb);

    const urls = historyDb.prepare(`
      SELECT url, title, visit_count, typed_count, last_visit_time
      FROM urls
      ORDER BY visit_count DESC
    `).all();
    const aggregated = new Map();

    for (const row of urls) {
      if (shouldFilterUrl(row.url)) continue;
      const cleaned = cleanUrl(row.url);
      const parsedUrl = parseHttpUrl(cleaned);
      if (!parsedUrl || ['google.com', 'www.google.com'].includes(parsedUrl.hostname)) continue;

      const existing = aggregated.get(cleaned);
      if (existing) {
        existing.visit_count += Number(row.visit_count || 0);
        existing.typed_count += Number(row.typed_count || 0);
        if (row.last_visit_time > existing.last_visit_time) {
          existing.last_visit_time = row.last_visit_time;
          existing.title = row.title || existing.title;
        }
        continue;
      }

      aggregated.set(cleaned, {
        url: cleaned,
        title: row.title || parsedUrl.hostname,
        visit_count: Number(row.visit_count || 0),
        typed_count: Number(row.typed_count || 0),
        last_visit_time: row.last_visit_time,
      });
    }

    const selectedSites = Array.from(aggregated.values())
      .sort((a, b) => b.visit_count - a.visit_count)
      .slice(0, 100);
    const findForUser = exploreDb.prepare(`
      SELECT id, is_spider_web
      FROM monitored_sites
      WHERE user_id = ? AND url = ?
      LIMIT 1
    `);
    const updateForUser = exploreDb.prepare(`
      UPDATE monitored_sites
      SET is_spider_web = 1
      WHERE id = ? AND user_id = ?
    `);
    const insertForUser = exploreDb.prepare(`
      INSERT INTO monitored_sites (
        id, user_id, url, label, last_hash, last_checked_at, last_change_at, is_spider_web, last_text
      ) VALUES (?, ?, ?, ?, '', '', '', 1, '')
    `);
    const counts = { inserted: 0, updated: 0, skipped: 0 };

    exploreDb.transaction((sites) => {
      for (const site of sites) {
        const existing = findForUser.get(userId, site.url);
        if (existing) {
          if (Number(existing.is_spider_web) === 1) {
            counts.skipped += 1;
          } else {
            updateForUser.run(existing.id, userId);
            counts.updated += 1;
          }
          continue;
        }

        const title = String(site.title || site.url).replace(/\s+/g, ' ').trim().slice(0, 80);
        insertForUser.run(crypto.randomUUID(), userId, site.url, `[SPIDER NET] ${title}`);
        counts.inserted += 1;
      }
    })(selectedSites);

    const result = {
      userId,
      selected: selectedSites.length,
      inserted: counts.inserted,
      updated: counts.updated,
      skipped: counts.skipped,
    };
    logger.log(`[spider-net-seeder] Finished for user ${userId}: ${JSON.stringify(result)}`);
    return result;
  } finally {
    if (historyDb) historyDb.close();
    if (exploreDb) exploreDb.close();
    try {
      if (fs.existsSync(tempHistoryPath)) fs.unlinkSync(tempHistoryPath);
    } catch (err) {
      logger.warn(`[spider-net-seeder] Could not remove temporary history snapshot: ${err.message}`);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  return seedSpiderWebSites(args);
}

if (require.main === module) {
  try {
    const result = main();
    process.stdout.write(`SPIDER_SEED_RESULT ${JSON.stringify(result)}\n`);
  } catch (err) {
    console.error(`[spider-net-seeder] Failed: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  cleanUrl,
  hasSensitiveHistoryData,
  main,
  parseCliArgs,
  seedSpiderWebSites,
  shouldFilterUrl,
};
