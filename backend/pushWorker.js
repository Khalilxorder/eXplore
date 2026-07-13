const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Database = require('better-sqlite3');
const { ensureSqliteIdealState } = require('./src/db/sqliteBootstrap');
const { refreshPriorityAlertCache } = require('./src/services/priorityAlertStore');
const {
  alreadyDelivered,
  ALERT_WORKER_NAME,
  getNotificationPreferences,
  hasPushCredentials,
  updateWorkerRuntimeStatus,
  recordNotificationDelivery,
  sendFcmNotification,
  shouldDeliverPriorityAlert,
} = require('./src/services/pushDeliveryService');

const db = new Database(path.join(__dirname, 'explore.db'));
db.pragma('journal_mode = WAL');
ensureSqliteIdealState(db);
const DEFAULT_INTERVAL_MS = 60 * 1000;
let activeLoopController = null;

function userWantsAlert(preferences, alert) {
  return shouldDeliverPriorityAlert(alert, preferences);
}

async function dispatchPriorityAlerts(options = {}) {
  const activeDb = options.db || db;
  const { alerts = [], checkedAt } = await refreshPriorityAlertCache(activeDb, { limit: 20 });
  const devices = activeDb.prepare(`
    SELECT id, user_id, token, platform, device_id, app_version
    FROM device_tokens
    WHERE active = 1
  `).all();

  const summary = {
    checkedAt,
    alertsConsidered: alerts.length,
    devicesConsidered: devices.length,
    pushConfigured: hasPushCredentials(),
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const device of devices) {
    const preferences = getNotificationPreferences(activeDb, device.user_id);

    for (const alert of alerts) {
      const channel = `push:${device.id}`;
      if (!userWantsAlert(preferences, alert) || alreadyDelivered(activeDb, device.user_id, alert.id, channel)) {
        summary.skipped += 1;
        continue;
      }

      const result = await sendFcmNotification(device.token, alert);
      recordNotificationDelivery(
        activeDb,
        device.user_id,
        alert,
        channel,
        result.ok ? 'sent' : 'failed',
        result.error || '',
        result.providerMessageId || ''
      );

      if (result.ok) {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDispatchCycle({ loopMode = 'oneshot', db: providedDb = null } = {}) {
  const activeDb = providedDb || db;
  updateWorkerRuntimeStatus(activeDb, ALERT_WORKER_NAME, {
    loop_mode: loopMode,
    last_status: 'running',
    last_started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    last_error: '',
  });

  try {
    const summary = await dispatchPriorityAlerts({ db: activeDb });
    const deliveryFailed = Number(summary.failed || 0) > 0;
    updateWorkerRuntimeStatus(activeDb, ALERT_WORKER_NAME, {
      loop_mode: loopMode,
      last_status: deliveryFailed ? 'error' : 'success',
      last_completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      last_summary_json: JSON.stringify(summary),
      last_error: deliveryFailed ? `${summary.failed} push delivery attempt(s) failed.` : '',
    });
    return summary;
  } catch (error) {
    updateWorkerRuntimeStatus(activeDb, ALERT_WORKER_NAME, {
      loop_mode: loopMode,
      last_status: 'error',
      last_completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      last_error: error?.message || 'worker cycle failed',
    });
    throw error;
  }
}

function resolveLoopMode(argv = process.argv.slice(2)) {
  if (argv.includes('--loop')) {
    return 'loop';
  }

  const mode = String(process.env.ALERT_WORKER_MODE || '').toLowerCase();
  if (mode === 'loop' || mode === 'continuous') {
    return 'loop';
  }

  return 'oneshot';
}

function resolveIntervalMs() {
  const envInterval = Number(process.env.ALERT_WORKER_INTERVAL_MS || process.env.ALERT_WORKER_INTERVAL_SECONDS || 0);
  if (!Number.isFinite(envInterval) || envInterval <= 0) {
    return DEFAULT_INTERVAL_MS;
  }

  // If seconds are passed by accident, clamp to at least 5 seconds.
  if (envInterval < 1000) {
    return Math.max(5000, envInterval * 1000);
  }

  return Math.max(5000, envInterval);
}

async function runContinuousLoop(options = {}) {
  const intervalMs = options.intervalMs || resolveIntervalMs();
  const activeDb = options.db || db;
  let keepRunning = true;

  const stop = () => {
    keepRunning = false;
  };

  const attachSignalHandlers = options.attachSignalHandlers !== false;
  if (attachSignalHandlers) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }

  while (keepRunning) {
    try {
      const summary = await runDispatchCycle({ loopMode: 'continuous', db: activeDb });
      console.log(JSON.stringify({ mode: 'continuous', summary }, null, 2));
    } catch (error) {
      console.error(error);
    }

    if (!keepRunning) {
      break;
    }

    await wait(intervalMs);
  }
}

function startContinuousLoop(options = {}) {
  if (activeLoopController) {
    return activeLoopController;
  }

  let keepRunning = true;
  const intervalMs = options.intervalMs || resolveIntervalMs();
  const activeDb = options.db || db;
  let loopPromise = null;

  const runner = async () => {
    while (keepRunning) {
      try {
        const summary = await runDispatchCycle({ loopMode: 'continuous', db: activeDb });
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
  const mode = resolveLoopMode();
  const runner = mode === 'loop'
    ? runContinuousLoop()
    : runDispatchCycle({ loopMode: 'oneshot' });

  runner
    .then((summary) => {
      if (mode !== 'loop') {
        console.log(JSON.stringify(summary, null, 2));
      }
      db.close();
    })
    .catch((error) => {
      console.error(error);
      db.close();
      process.exit(1);
    });
}

module.exports = {
  dispatchPriorityAlerts,
  runDispatchCycle,
  runContinuousLoop,
  startContinuousLoop,
};
