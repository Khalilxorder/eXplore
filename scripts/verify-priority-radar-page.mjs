import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const backendRoot = path.join(projectRoot, 'backend');
const artifactsRoot = path.join(projectRoot, 'artifacts');
const screenshotPath = path.join(artifactsRoot, 'priority-radar-mobile.png');
const profileDir = path.join(artifactsRoot, 'chrome-priority-radar-check-profile');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const backendPort = 8080;
const sitePort = 3000;
const debugPort = 9334;
const children = [];
const expectedReferences = ['OpenAI', 'Anthropic', 'Google / Gemini / DeepMind', 'xAI'];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });
  children.push(child);
  return child;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForJson(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(url, 3000);
    } catch (error) {
      lastError = error;
      await wait(500);
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForHttp(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || 'CDP command failed'));
      return;
    }
    resolve(message.result || {});
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return result.result?.value;
}

async function clickButton(cdp, text) {
  return evaluate(cdp, `
    (() => {
      const target = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      if (!target) return false;
      target.click();
      return true;
    })()
  `);
}

async function main() {
  await fs.mkdir(artifactsRoot, { recursive: true });
  await fs.rm(profileDir, { recursive: true, force: true });

  const backend = spawnChild(process.execPath, ['server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(backendPort),
      EMBED_ALERT_WORKER: 'false',
      EMBED_DISCOVERY_WORKER: 'false',
    },
  });
  await waitForJson(`http://127.0.0.1:${backendPort}/api/v1/health`, 45000);
    const referencePayload = await fetchJson(`http://127.0.0.1:${backendPort}/api/v1/alerts/references`);
    const sourceMapPayload = await fetchJson(`http://127.0.0.1:${backendPort}/api/v1/alerts/source-map`);

  const site = spawnChild(process.execPath, ['scripts/serve-static.mjs', 'out', String(sitePort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PROXY_API_HOST: '127.0.0.1',
      PROXY_API_PORT: String(backendPort),
    },
  });
  await waitForHttp(`http://127.0.0.1:${sitePort}/`, 30000);

  const chrome = spawnChild(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, 30000);
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, 30000);
  const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pageTarget) {
    throw new Error('Chrome did not expose a page DevTools target.');
  }
  const cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${sitePort}/` });
    await wait(2500);

    await evaluate(cdp, `localStorage.setItem('explore-onboarding-complete', '1')`);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await clickButton(cdp, 'continue without account');
      await wait(500);
      const shellReady = await evaluate(cdp, `Boolean(document.querySelector('.explore-section-row'))`);
      if (shellReady) {
        break;
      }
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await clickButton(cdp, 'skip for now');
      await wait(500);
      const shellReady = await evaluate(cdp, `Boolean(document.querySelector('.explore-section-row'))`);
      if (shellReady) {
        break;
      }
    }
    await wait(1200);

    const opened = await evaluate(cdp, `
      (() => {
        const target = document.querySelector('button[aria-label="Priority alerts"]');
        if (target) {
          target.click();
          return 'button';
        }
        window.dispatchEvent(new CustomEvent('explore-priority-radar-open', {
          detail: { screen: 'priority-radar' },
        }));
        return 'event';
      })()
    `);
    if (!opened) throw new Error('Priority Radar could not be opened.');
    await wait(2200);

    const state = await evaluate(cdp, `
      (() => {
        const bodyText = document.body.innerText || '';
        const lowerText = bodyText.toLowerCase();
        return {
          bodyText,
          hasPriorityRadar: lowerText.includes('priority radar'),
          hasReferenceBox: lowerText.includes('reference points') && lowerText.includes('always monitored'),
          hasWatchedSources: lowerText.includes('watched sources'),
          hasSourceMapLanes: lowerText.includes('war') && lowerText.includes('ai advantage') && lowerText.includes('markets') && lowerText.includes('art/meaning') && lowerText.includes('personal opportunities'),
          hasSourceMapCounts: lowerText.includes('38 references') && lowerText.includes('5 lanes'),
          hasDirectRule: lowerText.includes('direct notification') && lowerText.includes('investable shares'),
          hasReason: lowerText.includes('directly investable'),
          selectedAnthropic: lowerText.includes('anthropic'),
          overflowWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          viewportWidth: window.innerWidth,
        };
      })()
    `);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const apiReferences = Array.isArray(referencePayload.referencePoints)
      ? referencePayload.referencePoints.map((reference) => reference.publisher)
      : [];
    const problems = [];
    if (sourceMapPayload.summary?.laneCount !== 5) {
      problems.push(`source map lane count is ${sourceMapPayload.summary?.laneCount}`);
    }
    if (sourceMapPayload.summary?.sourceCount < 38) {
      problems.push(`source map source count is ${sourceMapPayload.summary?.sourceCount}`);
    }
    if (sourceMapPayload.summary?.aiAdvantageSourceCount < 20) {
      problems.push(`AI Advantage source count is ${sourceMapPayload.summary?.aiAdvantageSourceCount}`);
    }
    for (const reference of expectedReferences) {
      if (!apiReferences.includes(reference)) {
        problems.push(`missing API reference: ${reference}`);
      }
      if (!state.bodyText.includes(reference)) {
        problems.push(`missing visible reference: ${reference}`);
      }
    }
    if (!state.hasPriorityRadar) problems.push('Priority Radar page did not open');
    if (!state.hasReferenceBox) problems.push('reference box is not visible');
    if (!state.hasWatchedSources) problems.push('watched sources box is not visible');
    if (!state.hasSourceMapLanes) problems.push('event source map lanes are not visible');
    if (!state.hasSourceMapCounts) problems.push('source map counts are not visible');
    if (!state.hasDirectRule) problems.push('direct Investable shares rule is not visible');
    if (!state.hasReason) problems.push('direct notification reason is not visible');
    if (!state.selectedAnthropic) problems.push('Anthropic direct source is not visible');
    if (state.overflowWidth > state.viewportWidth + 2) {
      problems.push(`horizontal overflow ${state.overflowWidth}px > ${state.viewportWidth}px`);
    }

    const report = {
      passed: problems.length === 0,
      problems,
      screenshotPath,
      apiReferences,
      sourceMapSummary: sourceMapPayload.summary,
      directRuleCount: referencePayload.directNotificationRules?.length || 0,
      state: {
        ...state,
        bodyText: state.bodyText.slice(0, 1200),
      },
      build: await fetchJson(`http://127.0.0.1:${sitePort}/__explore_build.json`, 5000).catch(() => null),
    };

    console.log(JSON.stringify(report, null, 2));
    if (problems.length) {
      process.exitCode = 1;
    }
  } finally {
    cdp.close();
    for (const child of [chrome, site, backend]) {
      if (child && !child.killed) {
        child.kill();
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  for (const child of children) {
    if (child && !child.killed) {
      child.kill();
    }
  }
  process.exit(1);
});
