"""
scrapers/linkedin.py
====================
Method : LinkedIn guest job-search endpoint (no login required).
Site   : linkedin.com/jobs

This uses LinkedIn's internal XHR endpoint that powers the public job search
page for unauthenticated (guest) visitors. It returns raw HTML card fragments
which we parse with regex — no external dependencies beyond the stdlib.

IMPORTANT NOTES
---------------
* This is NOT an official API. LinkedIn can change or block it at any time.
* If LinkedIn returns a 429 / 999 / empty body: the scraper logs a warning
  and returns [] gracefully — it will NOT crash the pipeline.
* Personal / research use only. Respect LinkedIn's ToS and rate limits.
* Max 100 results per run (4 pages × 25). Increase MAX_PAGES carefully.

Search configuration
--------------------
SEARCHES below define (keywords, location, geoId) tuples.
geoId 102650489 = Hungary  |  geoId 102908578 = Budapest
Add more tuples to cover additional searches.
"""

import re
import time
import datetime

from .base import fetch, strip_html

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Internal XHR endpoint – no auth required for public (guest) job search
_BASE = (
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    "?keywords={keywords}&location={location}"
    "&f_TPR=r604800"   # posted in last 7 days
    "&start={start}"
)

# (keywords, human-readable location)
SEARCHES = [
    ("python developer",         "Hungary"),
    ("data scientist",           "Hungary"),
    ("machine learning engineer","Hungary"),
    ("AI researcher",            "Hungary"),
    ("software engineer english","Budapest"),
    ("remote developer",         "Hungary"),
    ("research engineer",        "Europe"),
]

PAGE_SIZE  = 25    # LinkedIn returns max 25 per page
MAX_PAGES  = 4     # 100 results per search  →  700 max across all searches
SLEEP_SEC  = 1.2   # polite delay between requests

# Extra headers that mimic a real browser session
_HEADERS = {
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.linkedin.com/jobs/search/",
    "X-Requested-With":"XMLHttpRequest",
}

# ---------------------------------------------------------------------------
# HTML card parser
# ---------------------------------------------------------------------------

def _first(pattern, text, default=""):
    m = re.search(pattern, text, re.I | re.S)
    return strip_html(m.group(1)).strip() if m else default


def _parse_cards(html):
    """
    Parse raw HTML fragment returned by the LinkedIn guest endpoint.
    Each job is inside  <li class="...">...</li>.
    Returns list of raw dicts before normalisation.
    """
    # LinkedIn returns <li> cards – grab each one
    cards = re.findall(r"<li[^>]*>(.*?)</li>", html, re.S | re.I)
    results = []
    for card in cards:
        # job id lives in data-entity-urn or a class href
        job_id = _first(r'data-entity-urn="[^"]*:(\d+)"', card)
        if not job_id:
            job_id = _first(r'/jobs/view/(\d+)', card)
        if not job_id:
            continue

        title   = _first(r'class="[^"]*base-search-card__title[^"]*"[^>]*>(.*?)</(?:h3|span|div)', card)
        company = _first(r'class="[^"]*base-search-card__subtitle[^"]*"[^>]*>(.*?)</(?:h4|span|div|a)', card)
        location= _first(r'class="[^"]*job-search-card__location[^"]*"[^>]*>(.*?)</span', card)
        date_raw= _first(r'<time[^>]*datetime="([^"]+)"', card)
        url_raw = _first(r'href="(https://[^"]*linkedin\.com/jobs/view/[^"?]+)', card)

        # Strip tracking suffixes from URL
        url = re.sub(r'\?.*$', '', url_raw).strip() if url_raw else ""

        date_posted = str(date_raw)[:10] if date_raw else ""

        results.append({
            "job_id":   job_id,
            "title":    title,
            "company":  company,
            "location": location,
            "date_posted": date_posted,
            "url":      url,
        })
    return results


# ---------------------------------------------------------------------------
# Normalise to unified schema
# ---------------------------------------------------------------------------

def _normalise(raw, search_keywords):
    location = raw.get("location", "")
    city = location.split(",")[0].strip() if location else ""
    is_remote = bool(re.search(r"\bremote\b", location, re.I)
                     or re.search(r"\bremote\b", search_keywords, re.I))

    return {
        "source":          "linkedin",
        "job_id":          raw["job_id"],
        "title":           raw["title"],
        "company":         raw["company"],
        "city":            city,
        "location_full":   location,
        "country":         "",
        "zip":             "",
        "salary_min":      "",
        "salary_max":      "",
        "salary_period":   "",
        "salary_currency": "",
        "employment_type": "",
        "date_posted":     raw["date_posted"],
        "valid_through":   "",
        "tags":            search_keywords,
        "category":        "",
        "description":     "",
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
    Fetch LinkedIn job listings via the guest endpoint.
    Returns a deduplicated list of normalised job dicts.
    Gracefully returns [] on any block or network error.
    """
    if verbose:
        print("\n[linkedin.com] Fetching via guest job-search endpoint...")

    seen_ids = set()
    all_jobs = []

    for keywords, location in SEARCHES:
        if verbose:
            print(f"  Search: {keywords!r} / {location}")

        for page_num in range(MAX_PAGES):
            start = page_num * PAGE_SIZE
            url = _BASE.format(
                keywords=keywords.replace(" ", "%20"),
                location=location.replace(" ", "%20"),
                start=start,
            )
            html = fetch(url, extra_headers=_HEADERS)
            if not html or len(html) < 100:
                if verbose:
                    print(f"    [!] Empty/blocked response on page {page_num + 1}. Stopping search.")
                break

            cards = _parse_cards(html)
            if not cards:
                if verbose:
                    print(f"    [!] No cards found on page {page_num + 1}. Stopping search.")
                break

            new_in_page = 0
            for raw in cards:
                jid = raw.get("job_id")
                if not jid or jid in seen_ids:
                    continue
                seen_ids.add(jid)
                # Skip entries with no title or no URL (malformed cards)
                if not raw.get("title") or not raw.get("url"):
                    continue
                all_jobs.append(_normalise(raw, keywords))
                new_in_page += 1

            if verbose:
                print(f"    Page {page_num + 1}: {len(cards)} cards, {new_in_page} new")

            if len(cards) < PAGE_SIZE:
                break   # last page reached

            time.sleep(SLEEP_SEC)

        time.sleep(SLEEP_SEC * 2)   # extra pause between searches

    if verbose:
        print(f"  Done: {len(all_jobs)} unique LinkedIn jobs.")
    return all_jobs
