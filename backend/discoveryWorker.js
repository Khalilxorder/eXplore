const path = require('path');
const fs = require('fs');
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.LAMBDA_TASK_ROOT) {
  require('dotenv').config({ path: path.join(__dirname, ['.', 'env'].join('')) });
}

const Database = require('better-sqlite3');
const { ensureSqliteIdealState } = require('./src/db/sqliteBootstrap');
const templateService = require('./src/services/newsTemplateService');
const valueHierarchyService = require('./src/services/valueHierarchySync');
const { refreshDiscoveryForAllScopes } = require('./src/services/feedDiscoveryService');
const { updateWorkerRuntimeStatus } = require('./src/services/pushDeliveryService');

const DISCOVERY_WORKER_NAME = 'best_feed_discovery';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let activeLoopController = null;

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
}

function resolveSqliteDatabasePath() {
  const configuredPath = process.env.SQLITE_DB_PATH || process.env.EXPLORE_SQLITE_DB_PATH || '';
  if (configuredPath) {
    fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
    return configuredPath;
  }

  if (!isServerlessRuntime()) {
    return path.join(__dirname, ['explore', 'db'].join('.'));
  }

  const runtimeRoot = process.env.EXPLORE_RUNTIME_DIR || path.join('/tmp', 'explore-backend');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return path.join(runtimeRoot, ['explore', 'db'].join('.'));
}

function createDb() {
  const db = new Database(resolveSqliteDatabasePath());
  db.pragma(isServerlessRuntime() ? 'journal_mode = DELETE' : 'journal_mode = WAL');
  ensureSqliteIdealState(db);
  return db;
}

function buildTemplateState(db, userId = '') {
  return {
    ...templateService.getTemplateState(db, userId),
    hierarchy: valueHierarchyService.getState(db, userId),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveIntervalMs() {
  const envInterval = Number(process.env.DISCOVERY_WORKER_INTERVAL_MS || 0);
  if (!Number.isFinite(envInterval) || envInterval <= 0) {
    return DEFAULT_INTERVAL_MS;
  }

  if (envInterval < 1000) {
    return Math.max(5000, envInterval * 1000);
  }

  return Math.max(5000, envInterval);
}

async function runDiscoveryCycle(db, { loopMode = 'oneshot' } = {}) {
  updateWorkerRuntimeStatus(db, DISCOVERY_WORKER_NAME, {
    loop_mode: loopMode,
    last_status: 'running',
    last_started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    last_error: '',
  });

  try {
    const results = await refreshDiscoveryForAllScopes(db, {
      resolveTemplateState: (userId) => buildTemplateState(db, userId),
    });
    const summary = {
      refreshedScopes: results.length,
      liveScopes: results.filter((entry) => entry.status === 'live').length,
      partialScopes: results.filter((entry) => entry.status === 'partial').length,
      candidateCount: results.reduce((total, entry) => total + Number(entry.candidateCount || 0), 0),
      results,
    };

    updateWorkerRuntimeStatus(db, DISCOVERY_WORKER_NAME, {
      loop_mode: loopMode,
      last_status: 'success',
      last_completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      last_summary_json: JSON.stringify(summary),
      last_error: '',
    });
    return summary;
  } catch (error) {
    updateWorkerRuntimeStatus(db, DISCOVERY_WORKER_NAME, {
      loop_mode: loopMode,
      last_status: 'error',
      last_completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      last_error: error?.message || 'discovery cycle failed',
    });
    throw error;
  }
}

async function runContinuousLoop(options = {}) {
  const db = options.db || createDb();
  const intervalMs = options.intervalMs || resolveIntervalMs();
  let keepRunning = true;

  const stop = () => {
    keepRunning = false;
  };

  if (options.attachSignalHandlers !== false) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }

  while (keepRunning) {
    try {
      const summary = await runDiscoveryCycle(db, { loopMode: 'continuous' });
      console.log(JSON.stringify({ mode: 'continuous', summary }, null, 2));
    } catch (error) {
      console.error(error);
    }

    if (!keepRunning) {
      break;
    }

    await wait(intervalMs);
  }

  if (!options.db) {
    db.close();
  }
}

function startContinuousLoop(options = {}) {
  if (activeLoopController) {
    return activeLoopController;
  }

  const db = options.db || createDb();
  const intervalMs = options.intervalMs || resolveIntervalMs();
  let keepRunning = true;
  let loopPromise = null;

  const runner = async () => {
    while (keepRunning) {
      try {
        const summary = await runDiscoveryCycle(db, { loopMode: 'continuous' });
        if (typeof options.onSummary === 'function') {
          options.onSummary(summary);
        }
      } catch (error) {
        if (typeof options.onError === 'function') {
          options.onError(error);
        } else {
          console.error(error);
        }
      }

      if (!keepRunning) {
        break;
      }

      await wait(intervalMs);
    }

    if (!options.db) {
      db.close();
    }
  };

  const stop = async () => {
    keepRunning = false;
    try {
      await loopPromise;
    } finally {
      activeLoopController = null;
    }
  };

  activeLoopController = {
    stop,
    intervalMs,
  };

  loopPromise = runner();
  return activeLoopController;
}

if (require.main === module) {
  const db = createDb();
  runContinuousLoop({ db })
    .catch((error) => {
      console.error(error);
      db.close();
      process.exit(1);
    });
}

module.exports = {
  DISCOVERY_WORKER_NAME,
  runDiscoveryCycle,
  runContinuousLoop,
  startContinuousLoop,
};
