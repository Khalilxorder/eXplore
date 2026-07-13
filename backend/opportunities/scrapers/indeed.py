"""
scrapers/indeed.py
==================
Method : HTML scraping of hu.indeed.com job search results.
Site   : https://hu.indeed.com/jobs

Indeed does NOT have a public API and removed their RSS feed support in 2026.
This scraper targets the public HTML search results page.

IMPORTANT NOTES
---------------
* Indeed uses Cloudflare + DataDome anti-bot protection. This scraper may
  return 0 results if Indeed blocks the request from your IP. When blocked,
  it logs a clear warning and returns [] — it will NOT crash the pipeline.
* For best results, run this scraper infrequently (daily max, not hourly).
* If you get persistent blocks, consider using Jooble (already in this
  pipeline) which aggregates many Indeed-equivalent sources via a free API.
* This scraper targets ONLY the publicly visible search result cards.
  It does NOT follow individual job links (saves time and reduces blocks).

Search configuration
--------------------
SEARCHES below define (query, location) tuples for hu.indeed.com.
Add or modify tuples to change what is scraped.
"""

import re
import time
import hashlib
import urllib.parse

from .base import fetch, strip_html

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_BASE_URL = "https://hu.indeed.com/jobs?{params}&start={start}&sort=date"

SEARCHES = [
    ("python developer",         "Budapest"),
    ("machine learning",         "Budapest"),
    ("data analyst",             "Hungary"),
    ("software engineer english","Budapest"),
    ("remote developer",         "Hungary"),
    ("AI researcher",            "Hungary"),
    ("content writer english",   "Hungary"),
]

RESULTS_PER_PAGE = 15    # Indeed shows 15 results per page
MAX_PAGES        = 3     # 45 results per search; keeps runtime reasonable
SLEEP_SEC        = 1.5   # polite delay between page requests

# Headers that closely mimic a real browser visiting from Hungary
_HEADERS = {
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer":         "https://hu.indeed.com/",
    "Connection":      "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control":   "max-age=0",
    "Sec-Fetch-Dest":  "document",
    "Sec-Fetch-Mode":  "navigate",
    "Sec-Fetch-Site":  "same-origin",
    "Sec-Fetch-User":  "?1",
}

# ---------------------------------------------------------------------------
# Block detection
# ---------------------------------------------------------------------------

def _is_blocked(html):
    """Return True if Indeed returned a bot-detection page instead of results."""
    if not html or len(html) < 500:
        return True
    block_signals = [
        "cf-browser-verification",
        "Attention Required!",
        "CAPTCHA",
        "Access Denied",
        "automated access",
        "datadome",
        "are you a robot",
    ]
    lower = html.lower()
    return any(sig.lower() in lower for sig in block_signals)


# ---------------------------------------------------------------------------
# HTML card parser
# ---------------------------------------------------------------------------

def _first(pattern, text, default=""):
    m = re.search(pattern, text, re.I | re.S)
    return strip_html(m.group(1)).strip() if m else default


def _parse_job_cards(html):
    """
    Parse job result cards from Indeed's search HTML.
    Indeed embeds job data in <div class="job_seen_beacon"> cards.
    Also handles <div data-jk="..."> job key attributes.
    Returns list of raw dicts.
    """
    results = []

    # Method 1: Try to find job cards by the data-jk attribute (job key)
    # Indeed renders: <div class="... tapItem ..." data-jk="JOBKEY" ...>
    card_pattern = re.compile(
        r'data-jk="([a-z0-9]+)"[^>]*>(.*?)(?=data-jk="|<div[^>]+class="[^"]*tapItem|$)',
        re.S | re.I,
    )
    for m in card_pattern.finditer(html):
        job_key = m.group(1)
        card = m.group(2)

        title   = _first(r'class="[^"]*jobTitle[^"]*"[^>]*>(?:<span[^>]*>)?(.*?)</(?:span|a|h2)', card)
        company = _first(r'class="[^"]*companyName[^"]*"[^>]*>(.*?)</(?:span|a|div)', card)
        location= _first(r'class="[^"]*companyLocation[^"]*"[^>]*>(.*?)</(?:div|span)', card)
        snippet = _first(r'class="[^"]*job-snippet[^"]*"[^>]*>(.*?)</(?:div|ul)', card)
        date_raw= _first(r'class="[^"]*date[^"]*"[^>]*>(.*?)</span', card)

        # Build canonical URL from job key
        url = f"https://hu.indeed.com/viewjob?jk={job_key}"

        # Parse date text like "2 napja" (2 days ago) → approximate ISO date
        date_posted = _parse_indeed_date(date_raw)

        if title:
            results.append({
                "job_id":      job_key,
                "title":       title,
                "company":     company,
                "location":    location,
                "description": snippet,
                "date_posted": date_posted,
                "url":         url,
            })

    # Method 2: Fallback – look for JSON-embedded job data (Indeed sometimes
    # inlines it as window.mosaic.providerData)
    if not results:
        json_block = re.search(
            r'"jobKeysWithDescriptions"\s*:\s*(\{[^}]+\})',
            html, re.S,
        )
        if json_block:
            # Extract job keys from the JSON block
            keys = re.findall(r'"([a-z0-9]{16})"', json_block.group(1))
            for key in keys[:RESULTS_PER_PAGE]:
                results.append({
                    "job_id":      key,
                    "title":       "",
                    "company":     "",
                    "location":    "",
                    "description": "",
                    "date_posted": "",
                    "url":         f"https://hu.indeed.com/viewjob?jk={key}",
                })

    return results


def _parse_indeed_date(date_text):
    """
    Convert Indeed's human-readable date strings to ISO format.
    Examples:
      "Ma"           → today
      "Tegnap"       → yesterday
      "2 napja"      → 2 days ago
      "30+ napja"    → 30+ days ago (treat as 30 days)
      "Just posted"  → today
    """
    import datetime
    today = datetime.date.today()
    if not date_text:
        return ""
    text = date_text.strip().lower()
    if text in ("ma", "today", "just posted", "active today"):
        return today.isoformat()
    if text in ("tegnap", "yesterday"):
        return (today - datetime.timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)\+?\s*(nap|day)", text, re.I)
    if m:
        days = min(int(m.group(1)), 60)
        return (today - datetime.timedelta(days=days)).isoformat()
    return ""


# ---------------------------------------------------------------------------
# Normalise to unified schema
# ---------------------------------------------------------------------------

def _normalise(raw, search_query):
    location = raw.get("location", "")
    city = location.split(",")[0].strip() if location else ""
    is_remote = bool(
        re.search(r"\bremote\b|\btávmunka\b|\botthonról\b", location, re.I)
        or re.search(r"\bremote\b", search_query, re.I)
    )
    return {
        "source":          "indeed",
        "job_id":          raw["job_id"],
        "title":           raw["title"],
        "company":         raw["company"],
        "city":            city,
        "location_full":   location,
        "country":         "HU",
        "zip":             "",
        "salary_min":      "",
        "salary_max":      "",
        "salary_period":   "",
        "salary_currency": "HUF",
        "employment_type": "",
        "date_posted":     raw["date_posted"],
        "valid_through":   "",
        "tags":            search_query,
        "category":        "",
        "description":     strip_html(raw.get("description", "")),
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             raw["url"],
        "direct_apply":    "False",
        "remote":          str(is_remote),
    }


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

def scrape(verbose=True):
    """
    Fetch jobs from hu.indeed.com job search pages.
    Returns a deduplicated list of normalised job dicts.
    Gracefully returns [] if Indeed blocks access (Cloudflare/DataDome).
    """
    if verbose:
        print("\n[hu.indeed.com] Fetching job search results...")

    seen_ids = set()
    all_jobs = []
    block_count = 0

    for query, location in SEARCHES:
        if block_count >= 2:
            if verbose:
                print("  [!] Two consecutive blocks detected. Stopping Indeed scraper early.")
            break

        if verbose:
            print(f"  Search: {query!r} in {location!r}")

        params = urllib.parse.urlencode({"q": query, "l": location})

        for page_num in range(MAX_PAGES):
            start = page_num * RESULTS_PER_PAGE
            url = _BASE_URL.format(params=params, start=start)

            html = fetch(url, extra_headers=_HEADERS)

            if _is_blocked(html):
                if verbose:
                    print(f"    [!] Indeed blocked access (page {page_num + 1}). Skipping.")
                block_count += 1
                break
            else:
                block_count = 0   # reset on success

            cards = _parse_job_cards(html)
            if not cards:
                if verbose:
                    print(f"    No cards found on page {page_num + 1} (possibly last page).")
                break

            new_in_page = 0
            for raw in cards:
                jid = raw.get("job_id")
                if not jid or jid in seen_ids:
                    continue
                seen_ids.add(jid)
                if not raw.get("title") and not raw.get("url"):
                    continue
                all_jobs.append(_normalise(raw, query))
                new_in_page += 1

            if verbose:
                print(f"    Page {page_num + 1}: {len(cards)} cards, {new_in_page} new")

            if len(cards) < RESULTS_PER_PAGE:
                break   # last page

            time.sleep(SLEEP_SEC)

        time.sleep(SLEEP_SEC * 1.5)

    if verbose:
        if all_jobs:
            print(f"  Done: {len(all_jobs)} unique Indeed jobs.")
        else:
            print(
                "  Done: 0 jobs.\n"
                "  NOTE: Indeed blocked all requests from this IP.\n"
                "  Tip: Jooble (already in the pipeline) aggregates many of\n"
                "  the same sources. Run it instead for reliable coverage."
            )
    return all_jobs
