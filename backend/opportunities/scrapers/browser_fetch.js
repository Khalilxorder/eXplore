'use strict';
/*
 * browser_fetch.js
 * ================
 * Fetch a Cloudflare-protected JSON/HTML endpoint by driving the locally
 * installed Chrome via puppeteer-core (no bundled Chromium). Used for sources
 * that 403 plain urllib requests (remoteok, jooble).
 *
 * Usage:
 *   node browser_fetch.js <url> [--home <homeUrl>] [--headful] [--wait <ms>]
 * Prints the response body text to stdout. Exit code 2 on failure.
 */

const puppeteer = require('puppeteer-core');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const fs = require('fs');
  const url = process.argv[2];
  if (!url) { console.error('usage: node browser_fetch.js <url>'); return 2; }
  const homeUrl = arg('--home', new URL(url).origin + '/');
  const headful = process.argv.includes('--headful');
  const settleMs = Number(arg('--wait', '6000'));

  const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) { console.error('No Chrome/Edge binary found'); return 2; }

  let exitCode = 0;
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: headful ? false : true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--window-size=1280,900',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Visit the site root first to pick up any Cloudflare clearance cookie.
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, settleMs));

    // Fetch the target from within the page context (same-origin, carries cookies).
    const body = await page.evaluate(async (target) => {
      try {
        const res = await fetch(target, { headers: { Accept: 'application/json,text/html,*/*' } });
        return { ok: res.ok, status: res.status, text: await res.text() };
      } catch (e) {
        return { ok: false, status: -1, text: String(e) };
      }
    }, url);

    if (!body.ok || !body.text) {
      console.error(`[browser_fetch] in-page fetch status ${body.status}`);
      // Fall back to a direct navigation (renders JSON as text in <body>).
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 2500));
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      if (resp && resp.ok() && text) {
        process.stdout.write(text);
        exitCode = 0;
        return exitCode;
      }
      console.error(`[browser_fetch] navigation status ${resp ? resp.status() : 'none'}`);
      exitCode = 2;
      return exitCode;
    }
    process.stdout.write(body.text);
    exitCode = 0;
  } catch (err) {
    console.error('[browser_fetch] inner error:', err.message);
    exitCode = 2;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
  return exitCode;
}

main().then((code) => {
  process.exit(code ?? 0);
}).catch((e) => {
  console.error('[browser_fetch] error:', e.message);
  process.exit(2);
});
