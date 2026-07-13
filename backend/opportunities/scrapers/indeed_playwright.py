"""
scrapers/indeed_playwright.py
=============================
Method : Playwright Chromium + playwright-stealth v2 + human-like behaviour
Site   : https://hu.indeed.com
Country: HU

How it avoids bot detection
---------------------------
1. Headful Chromium (not headless) — visually indistinguishable from a real browser
2. playwright-stealth v2 — removes 60+ automation fingerprints via Stealth.apply_stealth_sync()
3. Homepage warm-up — visits hu.indeed.com first to build a real cookie session
4. Human delays — randomised sleeps between 1.5–5 s on every action
5. Mouse movement — moves cursor before each navigation
6. Proxy/VPN support — set INDEED_PROXY=socks5://127.0.0.1:1080 (or any proxy URL)

VPN tip
-------
For best results run with a Hungarian residential VPN exit node.
Without a residential IP Indeed's DataDome layer still blocks datacenter IPs.
Recommended: set INDEED_PROXY to your local VPN SOCKS5 tunnel.

Environment variables
---------------------
INDEED_PROXY        proxy URL  (e.g. socks5://127.0.0.1:1080)
PLAYWRIGHT_HEADLESS set to 'true' to run headless (less reliable, useful for CI)
"""

import os
import sys
import time
import random
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import save_json, save_csv, SCHEMA_FIELDS
from .indeed import (
    _is_blocked, _parse_job_cards, _normalise,
    SEARCHES, RESULTS_PER_PAGE,
)

_BASE_URL = "https://hu.indeed.com/jobs?{params}&start={start}&sort=date"
_HOME_URL = "https://hu.indeed.com/"

# ── stealth (playwright-stealth v2) ──────────────────────────────────────────
# Stealth is instantiated once at import time so it's ready when scrape() runs.
try:
    from playwright_stealth import Stealth as _StealthCls
    _STEALTH = _StealthCls(
        navigator_languages_override=("hu-HU", "hu"),
        navigator_platform_override="Win32",
    )
except ImportError:
    _STEALTH = None

# ── helpers ──────────────────────────────────────────────────────────────────

def _rnd_sleep(lo=1.5, hi=3.5):
    time.sleep(random.uniform(lo, hi))


def _human_mouse(page, x_range=(200, 1000), y_range=(100, 600)):
    """Move mouse to a random position to look human."""
    try:
        page.mouse.move(
            random.randint(*x_range),
            random.randint(*y_range),
            steps=random.randint(5, 15),
        )
    except Exception:
        pass


def _build_context(playwright, proxy_url, headless):
    """Launch browser + context with stealth applied to the whole context."""
    launch_args = {
        "headless": headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    }
    if proxy_url:
        launch_args["proxy"] = {"server": proxy_url}

    browser = playwright.chromium.launch(**launch_args)
    context = browser.new_context(
        viewport={"width": random.randint(1200, 1400), "height": random.randint(750, 900)},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        locale="hu-HU",
        timezone_id="Europe/Budapest",
        java_script_enabled=True,
        bypass_csp=True,
    )
    # playwright-stealth v2: apply to context so all pages inherit evasions
    if _STEALTH is not None:
        _STEALTH.apply_stealth_sync(context)
    return browser, context


def _warm_up(page, verbose):
    """Visit the Indeed homepage to build a real cookie session."""
    if verbose:
        print("  Warming up — visiting homepage to build cookie session...")
    try:
        page.goto(_HOME_URL, wait_until="domcontentloaded", timeout=30_000)
        _rnd_sleep(2, 5)
        _human_mouse(page)
        _rnd_sleep(1, 3)
    except Exception as e:
        if verbose:
            print(f"  [warn] Warm-up navigation failed: {e}")


# ── main ─────────────────────────────────────────────────────────────────────

def scrape(verbose=True):
    """
    Scrape hu.indeed.com using Playwright + stealth + human-like behaviour.

    Returns a list of normalised job dicts, or [] on persistent block.

    Set INDEED_PROXY env var to a SOCKS5/HTTP proxy for VPN routing, e.g.:
        $env:INDEED_PROXY = 'socks5://127.0.0.1:1080'
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  [!] playwright not installed. Run: pip install playwright && playwright install chromium")
        return []

    if _STEALTH is None and verbose:
        print("  [warn] playwright-stealth not installed; running without stealth. Run: pip install playwright-stealth")

    proxy_url = os.environ.get("INDEED_PROXY", "")
    headless  = os.environ.get("PLAYWRIGHT_HEADLESS", "false").lower() == "true"

    if verbose:
        print("\n[indeed_playwright] Launching Playwright Chromium...")
        if proxy_url:
            print(f"  Using proxy: {proxy_url}")
        else:
            print("  No proxy set. Tip: set INDEED_PROXY=socks5://127.0.0.1:1080 for VPN routing.")

    seen_ids    = set()
    all_jobs    = []
    block_count = 0

    with sync_playwright() as p:
        try:
            browser, context = _build_context(p, proxy_url, headless)
            page = context.new_page()
        except Exception as e:
            print(f"  [!] Failed to launch browser: {e}")
            return []

        # ── warm-up visit ─────────────────────────────────────────────────
        _warm_up(page, verbose)

        # ── search loop ───────────────────────────────────────────────────
        for query, location in SEARCHES:
            if block_count >= 2:
                if verbose:
                    print("  [!] 2 consecutive blocks — stopping early.")
                    print("  Fix: connect a Hungarian residential VPN and set INDEED_PROXY.")
                break

            if verbose:
                print(f"  Search: {query!r} in {location!r}")

            params = urllib.parse.urlencode({"q": query, "l": location})

            for page_num in range(3):
                start = page_num * RESULTS_PER_PAGE
                url   = _BASE_URL.format(params=params, start=start)

                try:
                    _human_mouse(page)
                    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                    _rnd_sleep(2.5, 5.0)   # let JS / challenges render
                    _human_mouse(page)
                    html = page.content()
                except Exception as e:
                    if verbose:
                        print(f"    [!] Navigation error on page {page_num+1}: {e}")
                    break

                if _is_blocked(html):
                    if verbose:
                        print(f"    [!] Indeed blocked access (page {page_num+1}).")
                        print("    Tip: set INDEED_PROXY to a Hungarian SOCKS5/VPN tunnel and retry.")
                    block_count += 1
                    _rnd_sleep(4, 8)
                    break
                else:
                    block_count = 0

                cards = _parse_job_cards(html)
                if not cards:
                    if verbose:
                        print(f"    No cards on page {page_num+1} — last page or still blocked.")
                    break

                new_this_page = 0
                for raw in cards:
                    jid = raw.get("job_id")
                    if not jid or jid in seen_ids:
                        continue
                    seen_ids.add(jid)
                    if not raw.get("title") and not raw.get("url"):
                        continue
                    all_jobs.append(_normalise(raw, query))
                    new_this_page += 1

                if verbose:
                    print(f"    Page {page_num+1}: {len(cards)} cards, {new_this_page} new")

                if len(cards) < RESULTS_PER_PAGE:
                    break

                _rnd_sleep(2.0, 4.0)

            _rnd_sleep(2.0, 5.0)

        browser.close()

    if verbose:
        if all_jobs:
            print(f"  Done: {len(all_jobs)} unique Indeed jobs via Playwright.")
        else:
            print(
                "  Done: 0 jobs.\n"
                "  Indeed blocked all requests from this IP.\n"
                "  Fix: set INDEED_PROXY=socks5://127.0.0.1:1080 pointing to a\n"
                "       Hungarian VPN tunnel, then re-run."
            )
    return all_jobs


# ── standalone ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os as _os
    _os.makedirs("output", exist_ok=True)
    jobs = scrape()
    if jobs:
        save_json(jobs, "output/indeed_playwright_jobs.json")
        save_csv(jobs,  "output/indeed_playwright_jobs.csv", fields=SCHEMA_FIELDS)
    else:
        print("No jobs. See tips above.")
