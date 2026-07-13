"""
scrapers/cvonline.py
====================
Method : Sitemap + JSON-LD (schema.org/JobPosting)
Site   : cvonline.hu  (~5,900 jobs, Hungarian + Austrian)
Tech   : Drupal CMS

Discovery:
  robots.txt -> standard Drupal, no API routes
  sitemap    -> cvonline.hu/hu/sitemap.xml?page=1 (5000 URLs)
               cvonline.hu/hu/sitemap.xml?page=2 (931 URLs)
  Each detail page has <script type="application/ld+json"> with full JobPosting.

Fields in JSON-LD:
  title, datePosted, validThrough, hiringOrganization, employmentType,
  jobLocation, directApply, description (full HTML)
"""

import sys
import os
import re
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import (fetch, extract_job_posting_ld, strip_html,
                   save_json, save_csv, SCHEMA_FIELDS)

SITEMAP_PAGES = [
    "https://www.cvonline.hu/hu/sitemap.xml?page=1",
    "https://www.cvonline.hu/hu/sitemap.xml?page=2",
]


def _parse_sitemap(xml_text):
    """Extract (url, lastmod) pairs from sitemap XML."""
    entries = []
    locs = re.findall(r"<url>\s*<loc>(.*?)</loc>(?:.*?<lastmod>(.*?)</lastmod>)?", xml_text, re.S)
    for loc, lastmod in locs:
        if "/allas/" in loc:
            entries.append((loc.strip(), lastmod.strip()))
    return entries


def _extract_id(url):
    """Extract job ID from URL like /hu/allas/slug-1234567"""
    m = re.search(r"-(\d{6,})$", url)
    return m.group(1) if m else ""


def _normalise_ld(ld, url, job_id):
    """Convert JSON-LD JobPosting to unified schema."""
    org = ld.get("hiringOrganization") or {}
    company = org.get("name", "") if isinstance(org, dict) else ""

    loc_list = ld.get("jobLocation") or []
    if isinstance(loc_list, dict):
        loc_list = [loc_list]
    city = ""
    country = "HU"
    for loc in loc_list:
        addr = loc.get("address") or {}
        city = addr.get("addressLocality", "") or ""
        country = addr.get("addressCountry", "HU") or "HU"
        if city:
            break

    emp_type = ld.get("employmentType", "")
    if isinstance(emp_type, list):
        emp_type = emp_type[0] if emp_type else ""

    sal = ld.get("baseSalary") or {}
    sal_min = sal_max = sal_cur = sal_per = ""
    if isinstance(sal, dict):
        val = sal.get("value") or {}
        if isinstance(val, dict):
            sal_min = str(val.get("minValue", ""))
            sal_max = str(val.get("maxValue", ""))
        sal_cur = sal.get("currency", "HUF")
        sal_per = val.get("unitText", "MONTH") if isinstance(val, dict) else "MONTH"

    desc = strip_html(ld.get("description", ""))

    return {
        "source":          "cvonline",
        "job_id":          job_id,
        "title":           ld.get("title", ""),
        "company":         company,
        "city":            city,
        "location_full":   city,
        "country":         country,
        "zip":             "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_per,
        "salary_currency": sal_cur,
        "employment_type": emp_type,
        "date_posted":     ld.get("datePosted", ""),
        "valid_through":   ld.get("validThrough", ""),
        "tags":            "",
        "category":        "",
        "description":     desc[:3000],
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             url,
        "direct_apply":    str(ld.get("directApply", False)),
    }


def _merge_cached_active_entries(jobs, all_entries, existing_jobs_path, verbose):
    """Retain cached listings that still exist in the live sitemap."""
    if not existing_jobs_path or not os.path.exists(existing_jobs_path):
        return jobs

    try:
        with open(existing_jobs_path, encoding="utf-8") as f:
            cached_jobs = json.load(f)
    except (OSError, json.JSONDecodeError):
        return jobs

    active_urls = {url for url, _lastmod in all_entries}
    refreshed_urls = {job.get("url", "") for job in jobs}
    retained = [
        job for job in cached_jobs
        if job.get("url", "") in active_urls and job.get("url", "") not in refreshed_urls
    ]
    if verbose:
        print(f"  Retained {len(retained)} cached listings still present in the live sitemap.")
    return jobs + retained


def _fetch_detail_entry(entry):
    url, _lastmod = entry
    job_id = _extract_id(url)
    html = fetch(url, retries=2)
    if not html:
        return None, 1

    ld = extract_job_posting_ld(html)
    if not ld:
        return None, 1

    job = _normalise_ld(ld, url, job_id)
    if job["country"] not in ("HU", ""):
        return None, 0
    return job, 0


def scrape(max_jobs=500, verbose=True, existing_jobs_path="output/cvonline_jobs.json",
           max_workers=6):
    """
    Scrape cvonline.hu via sitemap + JSON-LD.

    Args:
        max_jobs: limit for how many detail pages to fetch (default 500)
        verbose:  print progress

    Returns:
        List of normalised job dicts.
    """
    if verbose:
        print("\n[cvonline.hu] Loading sitemaps...")

    all_entries = []
    for sm_url in SITEMAP_PAGES:
        xml = fetch(sm_url)
        if not xml:
            continue
        entries = _parse_sitemap(xml)
        all_entries.extend(entries)
        if verbose:
            print(f"  {sm_url.split('=')[1]}: {len(entries)} job URLs")

    if verbose:
        print(f"  Total sitemap entries: {len(all_entries)}")

    # Sort by lastmod descending (newest first)
    all_entries.sort(key=lambda x: x[1] if x[1] else "", reverse=True)

    # Limit to max_jobs (None = no limit, get everything)
    to_fetch = all_entries if not max_jobs else all_entries[:max_jobs]
    if verbose:
        print(f"  Fetching {len(to_fetch)} detail pages...")

    jobs = []
    errors = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_fetch_detail_entry, entry) for entry in to_fetch]
        for i, future in enumerate(as_completed(futures), 1):
            job, failed = future.result()
            errors += failed
            if job:
                jobs.append(job)
            if verbose and i % 50 == 0:
                print(f"    ... {i}/{len(to_fetch)} fetched ({len(jobs)} HU jobs, {errors} errors)")

    jobs.sort(key=lambda job: (job.get("date_posted", ""), job.get("job_id", "")), reverse=True)

    if max_jobs:
        jobs = _merge_cached_active_entries(jobs, all_entries, existing_jobs_path, verbose)

    if verbose:
        print(f"  Done: {len(jobs)} cvonline.hu HU jobs scraped ({errors} errors).")
    return jobs


if __name__ == "__main__":
    os.makedirs("output", exist_ok=True)
    jobs = scrape(max_jobs=200)
    save_json(jobs, "output/cvonline_jobs.json")
    save_csv(jobs, "output/cvonline_jobs.csv", fields=SCHEMA_FIELDS)
