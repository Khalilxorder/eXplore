import { spawn, spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const backendRoot = path.join(projectRoot, 'backend');
const outDir = path.join(projectRoot, 'out');
const smokePort = Number(process.env.EXPLORE_SMOKE_PORT || 3200);
const smokeBackendPort = Number(process.env.EXPLORE_SMOKE_BACKEND_PORT || 3180);
const backendBaseUrl = String(process.env.EXPLORE_SMOKE_BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const staticBaseUrl = String(process.env.EXPLORE_SMOKE_STATIC_URL || `http://127.0.0.1:${smokePort}`).replace(/\/+$/, '');
const authToken = String(process.env.SMOKE_TEST_BEARER_TOKEN || process.env.SMOKE_TEST_TOKEN || '').trim();
const REQUEST_TIMEOUT_MS = Number(process.env.EXPLORE_SMOKE_REQUEST_TIMEOUT_MS || 20000);

function npmCommand() {
  return 'npm';
}

function nodeCommand() {
  return process.platform === 'win32' ? 'node' : process.execPath;
}

function quoteWindowsArg(value) {
  const text = String(value || '');
  if (!/[ \t"]/g.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '\\"')}"`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, label, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJson(url, label, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, label, init, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${text.slice(0, 240)}`);
  }
}

async function readText(url, label, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, label, init, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  return text;
}

async function waitForJson(url, label, validator, {
  attempts = 60,
  intervalMs = 1000,
  init = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const payload = await readJson(url, label, init, timeoutMs);
      if (!validator || validator(payload)) {
        return payload;
      }
      lastError = new Error(`${label} responded but did not satisfy the expected shape.`);
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw lastError || new Error(`${label} never became ready.`);
}

async function waitForText(url, label, validator, {
  attempts = 60,
  intervalMs = 1000,
  init = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const payload = await readText(url, label, init, timeoutMs);
      if (!validator || validator(payload)) {
        return payload;
      }
      lastError = new Error(`${label} responded but did not satisfy the expected shape.`);
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw lastError || new Error(`${label} never became ready.`);
}

function spawnProcess(command, args, cwd, envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
  };

  if (process.platform === 'win32') {
    const commandLine = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
  }

  return spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
}

function waitForProcessExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', finish);
    child.once('close', finish);
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || !child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForProcessExit(child);
    return;
  }

  child.kill('SIGTERM');
  await waitForProcessExit(child);
}

async function ensureBackendRunning() {
  if (process.env.EXPLORE_SMOKE_BACKEND_URL) {
    const health = await readJson(`${backendBaseUrl}/api/v1/health`, 'backend health');
    if (health?.status !== 'ok') {
      throw new Error('Configured EXPLORE_SMOKE_BACKEND_URL is not healthy.');
    }

    return {
      process: null,
      baseUrl: backendBaseUrl,
    };
  }

  const smokeBackendBaseUrl = `http://127.0.0.1:${smokeBackendPort}`;
  const backendProcess = spawnProcess(
    npmCommand(),
    ['run', 'start'],
    backendRoot,
    {
      PORT: String(smokeBackendPort),
      EMBED_ALERT_WORKER: 'false',
      EMBED_DISCOVERY_WORKER: 'false',
      ALLOW_DEV_MOCKS: 'true',
      AI_PROVIDER: process.env.AI_PROVIDER || 'auto',
      YOUTUBE_API_KEY: '',
      YOUTUBE_API_KEYS: '',
      GOOGLE_AI_API_KEY: '',
      GOOGLE_AI_API_KEYS: '',
      GOOGLE_GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
    }
  );
  await waitForJson(
    `${smokeBackendBaseUrl}/api/v1/health`,
    'backend health',
    (payload) => payload?.status === 'ok' || payload?.readiness,
    { attempts: 60, intervalMs: 500, timeoutMs: 2500 }
  );
  return {
    process: backendProcess,
    baseUrl: smokeBackendBaseUrl,
  };
}

async function ensureStaticServerRunning(runtimeBackendBaseUrl) {
  try {
    const html = await readText(staticBaseUrl, 'static root');
    if (html.includes('<html')) {
      const readinessResponse = await fetchWithTimeout(
        `${staticBaseUrl}/api/v1/readiness`,
        'static proxy readiness check',
      );
      if (readinessResponse.ok) {
        return null;
      }
    }
  } catch {
    // Start a local static server if one is not already available.
  }

  const runtimeBackendUrl = new URL(runtimeBackendBaseUrl);
  const staticProcess = spawnProcess(
    nodeCommand(),
    ['scripts/serve-static.mjs', 'out', String(smokePort)],
    projectRoot,
    {
      PORT: String(smokePort),
      PROXY_API_HOST: runtimeBackendUrl.hostname,
      PROXY_API_PORT: runtimeBackendUrl.port || (runtimeBackendUrl.protocol === 'https:' ? '443' : '80'),
    }
  );
  await waitForText(
    staticBaseUrl,
    'static root',
    (payload) => payload.includes('<html')
  );
  return staticProcess;
}

async function main() {
  await stat(path.join(outDir, 'index.html')).catch(() => {
    throw new Error('Static export is missing. Run `npm run build` before the runtime smoke.');
  });

  const startedProcesses = [];

  try {
    const backendRuntime = await ensureBackendRunning();
    if (backendRuntime?.process) {
      startedProcesses.push(backendRuntime.process);
    }
    const runtimeBackendBaseUrl = backendRuntime?.baseUrl || backendBaseUrl;

    const staticProcess = await ensureStaticServerRunning(runtimeBackendBaseUrl);
    if (staticProcess) {
      startedProcesses.push(staticProcess);
    }

    const health = await readJson(`${runtimeBackendBaseUrl}/api/v1/health`, 'backend health');
    if (health.status !== 'ok') {
      throw new Error(`Backend health is not ok: ${JSON.stringify(health)}`);
    }

    const sourcesStatus = await waitForJson(
      `${staticBaseUrl}/api/v1/sources/status`,
      'sources status',
      (payload) => typeof payload?.status === 'string' && typeof payload?.summary === 'object',
      { attempts: 20, intervalMs: 500 }
    );
    if (typeof sourcesStatus.status !== 'string' || typeof sourcesStatus.summary !== 'object') {
      throw new Error('Sources status response is malformed.');
    }

    if (authToken) {
      const template = await waitForJson(
        `${staticBaseUrl}/api/v1/template`,
        'template',
        (payload) => Boolean(payload?.systemMap && payload?.modelPool),
        {
          attempts: 20,
          intervalMs: 500,
          init: { headers: { Authorization: `Bearer ${authToken}` } },
        }
      );
      if (!template.systemMap || !template.modelPool) {
        throw new Error('Template response is missing systemMap or modelPool.');
      }
    } else {
      const templateResponse = await fetchWithTimeout(
        `${staticBaseUrl}/api/v1/template`,
        'protected template check',
      );
      const templatePayload = await templateResponse.json().catch(() => ({}));
      if (templateResponse.status !== 401 || templatePayload?.auth_required !== true) {
        throw new Error('Protected template route did not reject an anonymous request.');
      }
      console.log('Protected template route rejects anonymous requests.');
    }

    const officialReleases = await waitForJson(
      `${staticBaseUrl}/api/v1/alerts/official-releases?limit=3`,
      'official release watch',
      (payload) => payload?.success === true && Array.isArray(payload?.alerts),
      { attempts: 20, intervalMs: 500 }
    );
    if (officialReleases.success !== true || !Array.isArray(officialReleases.alerts)) {
      throw new Error('Official release watch response is malformed.');
    }

    if (authToken) {
      const notificationStatus = await readJson(`${staticBaseUrl}/api/v1/devices/notification-status`, 'notification status', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!notificationStatus.status_label && !notificationStatus.normalized_status) {
        throw new Error('Notification status response is missing normalized state.');
      }
    } else {
      console.log('Skipping protected notification-status smoke because no bearer token was supplied.');
    }

    console.log('Runtime smoke passed.');
  } finally {
    for (const processHandle of startedProcesses.reverse()) {
      await stopProcess(processHandle);
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
