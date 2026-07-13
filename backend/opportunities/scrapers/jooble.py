"""
scrapers/jooble.py
==================
Method : Jooble Partner API (JSON POST)
Site   : jooble.org  (aggregates workania.hu and many Hungarian job boards)
Docs   : https://jooble.org/api/about
Auth   : Free API key from https://jooble.org/api/about  (1 click signup)

Setup:
  1. Go to https://jooble.org/api/about
  2. Enter your email -> get a free API key instantly
  3. Set env variable:  JOOBLE_API_KEY=your-key-here
     OR edit JOOBLE_API_KEY constant below directly.

API endpoint:
  POST https://jooble.org/api/{YOUR_KEY}
  Content-Type: application/json
  Body: {
    "keywords": "...",      # search terms (can be empty for all)
    "location": "Hungary",  # or "Budapest" etc.
    "page": 1               # pagination
  }

Response:
  { "totalCount": N, "jobs": [ { id, title, location, salary, snippet, link, company, updated } ] }

Notes:
  - Covers workania.hu, profession.hu (partial), and many aggregated sources
  - Returns up to 20 jobs per page (API limit)
  - Free tier: reasonable rate limits
  - JOOBLE_API_KEY must be set or jobs will return 401
"""

import os
import sys
import time
import re

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch_json, strip_html, save_json, save_csv, SCHEMA_FIELDS, polite_sleep

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Set your key here OR export JOOBLE_API_KEY=xxxx in your shell
JOOBLE_API_KEY = os.environ.get("JOOBLE_API_KEY", "")

BASE_URL    = "https://jooble.org/api/"
PAGE_SIZE   = 20    # Jooble returns max 20 per page
MAX_PAGES   = 50    # safety cap = 1000 jobs max

EXTRA_HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
}


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------

def _search(keywords, location, page):
    """POST one search page and return the parsed JSON response."""
    if not JOOBLE_API_KEY:
        raise RuntimeError(
            "JOOBLE_API_KEY not set.\n"
            "  Get a free key at: https://jooble.org/api/about\n"
            "  Then set: $env:JOOBLE_API_KEY = 'your-key'"
        )
    url  = BASE_URL + JOOBLE_API_KEY
    body = {"keywords": keywords, "location": location, "page": page}
    resp = fetch_json(url, extra_headers=EXTRA_HEADERS, json_body=body)
    return resp or {}


# ---------------------------------------------------------------------------
# Normalise
# ---------------------------------------------------------------------------

def _normalise(raw):
    """Map a Jooble job dict to unified schema."""
    title     = raw.get("title", "")
    location  = raw.get("location", "")
    salary    = raw.get("salary", "")
    snippet   = strip_html(raw.get("snippet", ""))
    company   = raw.get("company", "")
    link      = raw.get("link", "")
    updated   = str(raw.get("updated", ""))[:10]
    job_id    = str(raw.get("id", ""))

    # Extract city from location string (e.g. "Budapest, Hungary")
    city = location.split(",")[0].strip() if location else ""

    # Parse salary range  e.g. "200 000 - 400 000 Ft"
    sal_min = sal_max = ""
    sal_m = re.findall(r"[\d\s]+", salary.replace("\xa0", " "))
    nums = [s.replace(" ", "") for s in sal_m if s.strip()]
    if len(nums) >= 2:
        sal_min, sal_max = nums[0], nums[1]
    elif len(nums) == 1:
        sal_min = sal_max = nums[0]

    sal_period = "MONTH"
    if re.search(r"/\s*h|per hour|ora", salary, re.I):
        sal_period = "HOUR"

    return {
        "source":          "jooble",
        "job_id":          job_id,
        "title":           title,
        "company":         company,
        "city":            city,
        "location_full":   location,
        "country":         "HU",
        "zip":             "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_period,
        "salary_currency": "HUF",
        "employment_type": "",
        "date_posted":     updated,
        "valid_through":   "",
        "tags":            "",
        "category":        "",
        "description":     snippet,
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             link,
        "direct_apply":    "",
    }


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

def scrape(keywords="", location="Hungary", verbose=True):
    """
    Scrape Hungarian jobs from Jooble API.

    Args:
        keywords: job search terms (empty = all jobs)
        location: city or country ("Hungary", "Budapest", etc.)
        verbose:  print progress

    Returns:
        List of normalised job dicts.

    Requires:
        JOOBLE_API_KEY environment variable or constant set above.
    """
    if not JOOBLE_API_KEY:
        print("[jooble] WARNING: JOOBLE_API_KEY not set. Skipping.")
        print("  Get a free key at: https://jooble.org/api/about")
        print("  Then run: $env:JOOBLE_API_KEY = 'your-key'")
        return []

    if verbose:
        print(f"\n[jooble.org] Scraping Hungary jobs (keywords='{keywords}')")

    # First call to get total count
    resp  = _search(keywords, location, page=1)
    total = resp.get("totalCount", 0)
    batch = resp.get("jobs", [])

    if verbose:
        print(f"  Total available: {total}")

    all_raw = list(batch)
    page    = 2
    while len(all_raw) < total and page <= MAX_PAGES:
        resp  = _search(keywords, location, page=page)
        batch = resp.get("jobs", [])
        if not batch:
            break
        all_raw.extend(batch)
        if verbose:
            print(f"  Page {page:>2}  -> +{len(batch)} jobs (total: {len(all_raw)})")
        page += 1
        polite_sleep(0.5)

    jobs = [_normalise(r) for r in all_raw]
    if verbose:
        print(f"  Done: {len(jobs)} Jooble Hungary jobs scraped.")
    return jobs


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os as _os
    _os.makedirs("output", exist_ok=True)
    jobs = scrape()
    if jobs:
        save_json(jobs, "output/jooble_jobs.json")
        save_csv(jobs,  "output/jooble_jobs.csv", fields=SCHEMA_FIELDS)
    else:
        print("No jobs fetched (check JOOBLE_API_KEY).")