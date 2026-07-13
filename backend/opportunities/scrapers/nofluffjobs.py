"""
scrapers/nofluffjobs.py
=======================
Method : GET JSON API (changed from POST in May 2026)
Site   : https://nofluffjobs.com/hu  (IT/Tech jobs, Poland-origin, Hungary section)

API endpoint (NEW - May 2026):
  GET https://nofluffjobs.com/api/posting?country=hu
  No auth required. Returns ALL jobs in a single response!

  Old endpoint (broken): POST /api/search/posting -> 400 "salaryCurrency required"
"""

import sys
import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import strip_html, save_json, save_csv, SCHEMA_FIELDS

BASE    = "https://nofluffjobs.com"
API_URL = BASE + "/api/posting"


def _fetch_all(country="hu"):
    """GET /api/posting?country=hu - returns all postings in one call."""
    import urllib.request, json as _json

    url = f"{API_URL}?country={country}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": BASE,
        "Referer": BASE + "/hu",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [!] NoFluffJobs API error: {e}")
        return {}


def _normalise(raw):
    """Map a raw nofluffjobs posting to unified schema."""

    loc    = raw.get("location") or {}
    places = loc.get("places") or []
    city   = ""
    if places:
        city_field = places[0].get("city", "")
        if isinstance(city_field, dict):
            city = city_field.get("name", "")
        else:
            city = str(city_field) if city_field else ""
    remote = loc.get("fullyRemote", False)
    if remote and not city:
        city = "Remote"

    sal     = raw.get("salary") or {}
    sal_min = str(sal.get("from", ""))
    sal_max = str(sal.get("to", ""))
    sal_cur = sal.get("currency", "PLN")
    sal_typ = sal.get("type", "")
    sal_per = "MONTH"

    emp_map = {"permanent": "FULL_TIME", "b2b": "FREELANCE", "any": "FULL_TIME"}
    emp_type = emp_map.get(sal_typ, "FULL_TIME")

    tags = raw.get("tiles") or raw.get("tags") or []
    tag_str = "; ".join(
        t.get("value", "") if isinstance(t, dict) else str(t) for t in tags
    )

    cat = raw.get("category") or ""
    if isinstance(cat, dict):
        cat = cat.get("name", "")

    posted_ms = raw.get("posted") or raw.get("added", "")
    if isinstance(posted_ms, (int, float)) and posted_ms > 1_000_000_000_000:
        date_posted = datetime.datetime.fromtimestamp(posted_ms / 1000).strftime("%Y-%m-%d")
    elif isinstance(posted_ms, (int, float)) and posted_ms > 1_000_000_000:
        date_posted = datetime.datetime.fromtimestamp(posted_ms).strftime("%Y-%m-%d")
    else:
        date_posted = str(posted_ms)[:10] if posted_ms else ""

    job_id  = str(raw.get("id", ""))
    url_sfx = raw.get("url", "")
    url     = f"{BASE}/hu/job/{url_sfx}" if url_sfx else ""

    title   = raw.get("title", "") or raw.get("name", "")
    company = raw.get("name", "") if raw.get("title") else ""

    seniority = raw.get("seniority") or []
    if isinstance(seniority, list):
        seniority = "; ".join(seniority)

    return {
        "source":          "nofluffjobs",
        "job_id":          job_id,
        "title":           title,
        "company":         company,
        "city":            city,
        "location_full":   city,
        "country":         "HU",
        "zip":             "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_per,
        "salary_currency": sal_cur,
        "employment_type": emp_type,
        "date_posted":     date_posted,
        "valid_through":   "",
        "tags":            tag_str,
        "category":        str(cat),
        "description":     "",
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             url,
        "direct_apply":    "",
        "remote":          str(remote),
        "seniority":       str(seniority),
    }


def scrape(country="hu", verbose=True):
    """
    Scrape all NoFluffJobs listings for Hungary via GET API.
    Returns ALL jobs in a single request (19,000+).
    """
    if verbose:
        print(f"\n[nofluffjobs.com] Fetching all jobs for country=\'{country}\'")

    resp = _fetch_all(country)
    total = resp.get("totalCount", 0)
    postings = resp.get("postings") or []

    if verbose:
        print(f"  API returned: {total} total, {len(postings)} postings")

    # Filter: keep only jobs with at least one HUN location
    # (fullyRemote jobs without HUN location are global, skip those)
    hu_postings = []
    for p in postings:
        loc = p.get("location", {})
        places = loc.get("places", [])
        is_hu = any(
            pl.get("country", {}).get("code", "") in ("HUN", "HU")
            or "hungary" in pl.get("country", {}).get("name", "").lower()
            or "budapest" in (pl.get("city") or "").lower()
            for pl in places
        ) if places else False
        if is_hu:
            hu_postings.append(p)

    if verbose:
        print(f"  Hungary-located: {len(hu_postings)} jobs")

    jobs = [_normalise(r) for r in hu_postings]
    if verbose:
        print(f"  Done: {len(jobs)} nofluffjobs.com jobs normalised.")
    return jobs


if __name__ == "__main__":
    import os
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    save_json(jobs, "output/nofluffjobs_jobs.json")
    save_csv(jobs, "output/nofluffjobs_jobs.csv", fields=SCHEMA_FIELDS)
