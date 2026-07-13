"""
scrapers/minddiak.py  (and humancentrum.py via SITE_TYPE)
==========================================================
Method : DIRECT REST API  (discovered by reverse-engineering the Angular JS bundle)
API    : https://api.humancentrum.hu/   (LoopBack.js REST framework)
Auth   : POST /guest  ->  free anonymous JWT Bearer token (no login needed)
Jobs   : GET  /positions?type=<SITE_TYPE>&offset=N&limit=50
Tags   : GET  /position-tags?where={"positionId":ID}

SITE_TYPE values (found in JS bundle, variable v.N.site):
  20  = minddiak.hu     (student / part-time jobs)
  10  = humancentrum.hu (full-time adult jobs)
  30  = humancentrum.hu (retiree / pensioner jobs)

This single scraper handles all three by accepting a site_type argument.
"""

import json
import time
import urllib.parse
import datetime
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch, fetch_json, strip_html, save_json, save_csv, SCHEMA_FIELDS

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API          = "https://api.humancentrum.hu/"
PAGE_SIZE    = 50

SITE_NAMES = {
    20: "minddiak",
    10: "humancentrum",
    30: "humancentrum_nyugdijas",
}

SITE_URLS = {
    20: "https://minddiak.hu",
    10: "https://humancentrum.hu",
    30: "https://humancentrum.hu",
}

EXTRA_HEADERS = {
    "Accept":       "application/json, text/plain, */*",
    "Origin":       "https://minddiak.hu",
    "Referer":      "https://minddiak.hu/",
}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_guest_token() -> str:
    """
    POST /guest with empty body -> returns {"token": "eyJ..."}
    This is how the Angular app authenticates anonymous visitors.
    The token is a short-lived JWT; refresh by calling this again.
    """
    resp = fetch_json(API + "guest", json_body={},
                      extra_headers=EXTRA_HEADERS)
    if not resp or "token" not in resp:
        raise RuntimeError(f"Guest auth failed: {resp}")
    return resp["token"]


# ---------------------------------------------------------------------------
# Core API calls
# ---------------------------------------------------------------------------

def count_jobs(token: str, site_type: int) -> int:
    today = datetime.date.today().strftime("%Y-%m-%d 00:00:00")
    where = json.dumps({"type": site_type, "date": today})
    resp  = fetch_json(
        API + "positions/count",
        extra_headers={**EXTRA_HEADERS, "Authorization": f"Bearer {token}"},
        json_body=None,
    )
    # fetch_json uses GET by default; pass via URL params
    url = (API + "positions/count?" +
           urllib.parse.urlencode({"where": where}))
    from .base import fetch as _fetch
    raw = _fetch(url, extra_headers={**EXTRA_HEADERS,
                                     "Authorization": f"Bearer {token}"})
    try:
        return json.loads(raw).get("count", 0)
    except Exception:
        return 0


def fetch_page(token: str, site_type: int, offset: int) -> list:
    today   = datetime.date.today().strftime("%Y-%m-%d 00:00:00")
    where   = json.dumps({"type": site_type, "date": today})
    include = json.dumps([
        {"relation": "positionMd"},
        {"relation": "positionFrontend"},
        {"relation": "ownerUser"},
    ])
    params = urllib.parse.urlencode({
        "order":   "id DESC",
        "offset":  offset,
        "limit":   PAGE_SIZE,
        "where":   where,
        "include": include,
    })
    url = API + "positions?" + params
    raw = fetch(url, extra_headers={**EXTRA_HEADERS,
                                    "Authorization": f"Bearer {token}"})
    try:
        return json.loads(raw)
    except Exception:
        return []


def fetch_tags_for(token: str, position_id: int) -> list:
    where   = json.dumps({"positionId": position_id})
    include = json.dumps([{"relation": "tag"}])
    params  = urllib.parse.urlencode({"where": where, "include": include})
    url     = API + "position-tags?" + params
    raw     = fetch(url, extra_headers={**EXTRA_HEADERS,
                                        "Authorization": f"Bearer {token}"})
    try:
        rows = json.loads(raw)
        return [r["tag"]["name"] for r in rows if r.get("tag")]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Normalise raw API record -> unified schema
# ---------------------------------------------------------------------------

def normalise(raw: dict, tags: list, site_type: int) -> dict:
    md  = raw.get("positionMd")  or {}
    fe  = raw.get("positionFrontend") or {}
    own = raw.get("ownerUser")   or {}
    src = SITE_NAMES.get(site_type, f"humancentrum_{site_type}")
    base_url = SITE_URLS.get(site_type, "https://humancentrum.hu")
    slug = fe.get("slug", "")
    detail_segment = "diakmunka" if site_type == 20 else "munkalehetoseg"
    detail_key = slug or str(raw.get("id", ""))

    sal     = md.get("salary",    "")
    sal_max = md.get("salaryMax", "")

    return {
        "source":          src,
        "job_id":          str(raw.get("id", "")),
        "title":           raw.get("name", "").strip(),
        "company":         raw.get("companyText", "") or "",
        "city":            raw.get("cityText", ""),
        "location_full":   md.get("address", ""),
        "country":         "HU",
        "zip":             raw.get("zip", ""),
        "salary_min":      str(sal)     if sal     else "",
        "salary_max":      str(sal_max) if sal_max else "",
        "salary_period":   "HOUR",
        "salary_currency": "HUF",
        "employment_type": "TEMPORARY",
        "date_posted":     str(raw.get("createTime", ""))[:10],
        "valid_through":   "",
        "tags":            "; ".join(tags),
        "category":        "",
        "description":     strip_html(raw.get("description", "")),
        "requirements":    strip_html(raw.get("requirements", "")),
        "what_we_offer":   strip_html(raw.get("offer", "")),
        "contact_name":    own.get("name", "") or "",
        "contact_email":   own.get("email", "") or "",
        "url":             f"{base_url}/{detail_segment}/{detail_key}" if detail_key else "",
        "direct_apply":    "True" if detail_key else "",
        # Extra fields (beyond schema, kept in JSON)
        "short_description": strip_html(raw.get("shortDescription", "")),
        "worktime":          strip_html(raw.get("worktime", "")),
        "start_date":        raw.get("startDate", ""),
        "company_description": strip_html(raw.get("companyDescription", "")),
    }


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

def scrape(site_type: int = 20, verbose: bool = True, include_tags: bool = False) -> list:
    """
    Scrape all active jobs for a given site_type from api.humancentrum.hu.

    Args:
        site_type: 20=minddiak, 10=humancentrum, 30=nyugdijas
        verbose:   print progress

    Returns:
        List of normalised job dicts.
    """
    name = SITE_NAMES.get(site_type, str(site_type))
    if verbose:
        print(f"\n[humancentrum API] Scraping site_type={site_type} ({name})")
        print("  Authenticating as guest...")

    token = get_guest_token()

    # Count
    today = datetime.date.today().strftime("%Y-%m-%d 00:00:00")
    where = json.dumps({"type": site_type, "date": today})
    url   = (API + "positions/count?" +
             urllib.parse.urlencode({"where": where}))
    raw   = fetch(url, extra_headers={**EXTRA_HEADERS,
                                      "Authorization": f"Bearer {token}"})
    total = json.loads(raw).get("count", 0) if raw else 0
    if verbose:
        print(f"  Total jobs: {total}")

    # Paginate
    raw_jobs, offset, page = [], 0, 1
    while offset < total:
        batch = fetch_page(token, site_type, offset)
        if not batch:
            break
        raw_jobs.extend(batch)
        if verbose:
            print(f"  Page {page:>2}  ->  +{len(batch)} jobs "
                  f"(total so far: {len(raw_jobs)})")
        offset += PAGE_SIZE
        page   += 1
        time.sleep(0.3)

    # Fetch tags
    tags_map = {}
    if include_tags:
        if verbose:
            print(f"  Fetching optional tags for {len(raw_jobs)} jobs...")
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {
                executor.submit(fetch_tags_for, token, rj["id"]): rj["id"]
                for rj in raw_jobs
            }
            for i, future in enumerate(as_completed(futures), 1):
                job_id = futures[future]
                try:
                    tags_map[job_id] = future.result()
                except Exception:
                    tags_map[job_id] = []
                if verbose and i % 25 == 0:
                    print(f"    ... tags {i}/{len(raw_jobs)}")

    # Normalise
    jobs = [normalise(r, tags_map.get(r["id"], []), site_type) for r in raw_jobs]
    if verbose:
        print(f"  Done: {len(jobs)} jobs normalised.")
    return jobs


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    os.makedirs("output", exist_ok=True)

    for stype in [20, 10]:
        name = SITE_NAMES[stype]
        jobs = scrape(site_type=stype)
        save_json(jobs, f"output/{name}_jobs.json")
        save_csv(jobs,  f"output/{name}_jobs.csv", fields=SCHEMA_FIELDS)
