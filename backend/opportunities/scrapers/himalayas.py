"""
scrapers/himalayas.py
=====================
Source : https://himalayas.app  (Himalayas)
Method : Public JSON API (no auth, no key required)
Scope  : Worldwide remote jobs — 100k+ listings, curated, tech-heavy

API
---
GET https://himalayas.app/jobs/api
  ?limit=100   (max per page)
  &offset=0    (pagination)

Response shape (verified 2026-06):
{
  "jobs": [
    {
      "title", "excerpt", "companyName", "companySlug",
      "employmentType",            # "Full Time" / "Part Time" / "Contract"
      "minSalary", "maxSalary",    # numeric or null
      "currency",                  # "USD"
      "locationRestrictions",      # list or string
      "categories",                # list of strings
      "description",               # HTML
      "pubDate",                   # ISO timestamp
      "applicationLink",           # apply URL
      "guid"                       # unique identifier
    },
    ...
  ],
  "totalCount": 105737,
  "offset": 0,
  "limit": 100
}
"""

import sys
import re

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch_json, strip_html, empty_job

_API_URL  = "https://himalayas.app/jobs/api"
_PER_PAGE = 100
_MAX_PAGES = 5   # up to 500 jobs per run


def _job_id(raw: dict) -> str:
    return str(raw.get("guid") or raw.get("companySlug", "") + "-" + re.sub(r"\W+", "-", raw.get("title", "").lower()))


def _employment_type(raw: dict) -> str:
    t = str(raw.get("employmentType") or "").strip()
    mapping = {
        "Full Time": "FULL_TIME",
        "Part Time": "PART_TIME",
        "Contract":  "FREELANCE",
        "Internship":"INTERN",
    }
    return mapping.get(t, t.upper().replace(" ", "_"))


def _location(raw: dict) -> str:
    loc = raw.get("locationRestrictions")
    if not loc:
        return "Worldwide / Remote"
    if isinstance(loc, list):
        return ", ".join(str(x) for x in loc) or "Worldwide / Remote"
    # Sometimes returned as a string repr of a list: "['Brazil']"
    cleaned = re.sub(r"[\[\]'\"]", "", str(loc)).strip()
    return cleaned or "Worldwide / Remote"


def _categories(raw: dict) -> str:
    cats = raw.get("categories") or []
    if isinstance(cats, list):
        return "; ".join(
            c if isinstance(c, str) else c.get("name", "") for c in cats
        )
    return str(cats)


def _normalise(raw: dict) -> dict:
    sal_min = str(raw.get("minSalary") or "")
    sal_max = str(raw.get("maxSalary") or "")
    currency = str(raw.get("currency") or "USD").upper()

    url = raw.get("applicationLink") or raw.get("url") or ""
    if not url:
        slug = raw.get("companySlug") or ""
        title_slug = re.sub(r"\W+", "-", (raw.get("title") or "").lower()).strip("-")
        url = f"https://himalayas.app/jobs/{slug}/{title_slug}" if slug else ""

    job = empty_job()
    job.update({
        "source":          "himalayas",
        "job_id":          _job_id(raw),
        "title":           raw.get("title") or "",
        "company":         raw.get("companyName") or "",
        "city":            "Remote",
        "location_full":   _location(raw),
        "country":         "REMOTE",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   "YEAR",
        "salary_currency": currency,
        "employment_type": _employment_type(raw),
        "date_posted":     str(raw.get("pubDate") or "")[:10],
        "tags":            _categories(raw),
        "category":        (_categories(raw).split(";")[0]).strip(),
        "description":     strip_html(raw.get("description") or raw.get("excerpt") or "")[:3000],
        "url":             url,
        "direct_apply":    "True",
        "remote":          "True",
    })
    return job


def scrape(verbose=True):
    if verbose:
        print("\n[himalayas.app] Fetching worldwide remote-job API...")

    seen, jobs = set(), []

    for page in range(_MAX_PAGES):
        offset = page * _PER_PAGE
        data   = fetch_json(
            f"{_API_URL}?limit={_PER_PAGE}&offset={offset}",
            extra_headers={"Accept": "application/json"},
        )
        if not data or not isinstance(data, dict):
            break

        raw_jobs = data.get("jobs") or []
        if not raw_jobs:
            break

        new = 0
        for raw in raw_jobs:
            jid = _job_id(raw)
            if not jid or jid in seen:
                continue
            seen.add(jid)
            jobs.append(_normalise(raw))
            new += 1

        if verbose:
            total = data.get("totalCount", "?")
            print(f"  Page {page+1}: {new} new jobs (API total: {total})")

        if len(raw_jobs) < _PER_PAGE:
            break

    if verbose:
        print(f"  Done: {len(jobs)} Himalayas jobs.")
    return jobs


if __name__ == "__main__":
    from .base import save_both
    jobs = scrape()
    if jobs:
        save_both(jobs, "himalayas_jobs")
