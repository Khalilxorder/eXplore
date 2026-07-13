'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const siteMonitorService = require('../services/siteMonitorService');

const execFileAsync = promisify(execFile);

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

function resolveDatabasePath(opts, db) {
  const configuredPath = opts.databasePath || opts.dbPath || db?.name;
  if (!configuredPath || configuredPath === ':memory:') {
    throw new Error('SPIDER NET seeding requires a configured file-backed SQLite database path.');
  }
  return path.resolve(configuredPath);
}

function parseSeedResult(stdout) {
  const match = String(stdout || '').match(/^SPIDER_SEED_RESULT (.+)$/m);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

async function runSeedScript({ scriptPath, userId, dbPath, historyPath }) {
  const args = [scriptPath, '--user-id', userId, '--db-path', dbPath];
  if (historyPath) args.push('--history-path', historyPath);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
    });
    return {
      log: [stdout, stderr].filter(Boolean).join('\n').trim(),
      result: parseSeedResult(stdout),
    };
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || 'Seeder process failed').trim();
    const wrapped = new Error(detail);
    wrapped.cause = err;
    throw wrapped;
  }
}

function resolveCheckFilter(body) {
  if (!body || typeof body !== 'object') return 'all';
  if (body.site_type !== undefined) return body.site_type;
  if (body.type !== undefined) return body.type;
  if (body.is_spider_web !== undefined) return body.is_spider_web;
  return 'all';
}

async function sitesRoutes(fastify, opts) {
  const db = opts.db;
  const seedRunner = opts.seedRunner || runSeedScript;
  siteMonitorService.ensureTables(db);

  fastify.get('/', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const sites = siteMonitorService.getMonitoredSites(db, userId);
      const findings = siteMonitorService.getSiteFindings(db, userId);
      return { success: true, sites, findings };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.post('/', async (request, reply) => {
    const userId = resolveUserId(request);
    const { url, label, is_spider_web: isSpiderWebSnake, isSpiderWeb: isSpiderWebCamel } = request.body || {};
    if (!url) {
      return reply.status(400).send({ success: false, error: 'url is required' });
    }

    const rawSpiderValue = isSpiderWebSnake !== undefined ? isSpiderWebSnake : isSpiderWebCamel;
    if (rawSpiderValue !== undefined && ![true, false, 1, 0].includes(rawSpiderValue)) {
      return reply.status(400).send({ success: false, error: 'is_spider_web must be a boolean' });
    }
    const isSpiderWeb = rawSpiderValue === true || rawSpiderValue === 1;

    try {
      const id = siteMonitorService.addMonitoredSite(db, userId, url, label, { isSpiderWeb });
      return { success: true, id, is_spider_web: isSpiderWeb ? 1 : 0 };
    } catch (err) {
      const statusCode = err.code === 'INVALID_MONITORED_URL' ? 400 : 500;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  fastify.post('/check-all', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const results = await siteMonitorService.checkAll(db, userId, resolveCheckFilter(request.body));
      const findings = siteMonitorService.getSiteFindings(db, userId);
      return { success: true, results, findings };
    } catch (err) {
      const statusCode = err.code === 'INVALID_SITE_FILTER' ? 400 : 500;
      return reply.status(statusCode).send({ success: false, error: err.message });
    }
  });

  fastify.post('/seed-spider-web', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({ success: false, error: 'Authentication required.' });
    }

    try {
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'seedSpiderWebSites.js');
      const dbPath = resolveDatabasePath(opts, db);
      const seedOutput = await seedRunner({
        scriptPath,
        userId,
        dbPath,
        historyPath: opts.chromeHistoryPath || process.env.CHROME_HISTORY_PATH || '',
      });
      const sites = siteMonitorService.getMonitoredSites(db, userId);
      const findings = siteMonitorService.getSiteFindings(db, userId);

      return {
        success: true,
        log: seedOutput?.log || '',
        seed: seedOutput?.result || null,
        sites,
        findings,
      };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    const { id } = request.params;
    if (!id) {
      return reply.status(400).send({ success: false, error: 'id is required' });
    }

    try {
      siteMonitorService.deleteMonitoredSite(db, userId, id);
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

module.exports = sitesRoutes;
module.exports.__test__ = {
  parseSeedResult,
  resolveCheckFilter,
  resolveDatabasePath,
  runSeedScript,
};
