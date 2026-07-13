"""
scrapers/randstad.py
====================
Method : HTML Route Data Parsing (Elasticsearch hits)
Site   : https://www.randstad.hu

Randstad Hungary embeds the complete Elasticsearch search results (including
job descriptions, locations, salaries, dates, etc.) directly in the HTML of
their listing pages inside `window.__ROUTE_DATA__`.

This scraper fetches the listing pages sequentially, extracts the JSON data,
and normalises all job postings without having to fetch detail pages.
"""

import re
import json
import math
import sys
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import (fetch, strip_html, save_json, save_csv, SCHEMA_FIELDS, polite_sleep)

BASE_URL = "https://www.randstad.hu"
LISTING_URL = BASE_URL + "/allasok/"
MAX_PAGES = 20  # Safeguard cap

def _extract_route_data(html: str) -> dict | None:
    """Extract and parse window.__ROUTE_DATA__ JSON from HTML page."""
    # Try different regex patterns for flexibility
    m = re.search(r"window\.__ROUTE_DATA__\s*=\s*(.*?);?\s*\n", html)
    if not m:
        m = re.search(r"window\.__ROUTE_DATA__\s*=\s*(\{.*?\});", html, re.S)
    
    if m:
        data_str = m.group(1).strip()
        if data_str.endswith(";"):
            data_str = data_str[:-1]
        try:
            return json.loads(data_str)
        except Exception as e:
            print(f"  [randstad.py] JSON parse error: {e}")
            return None
    return None

def _normalise(hit: dict) -> dict:
    """Map an Elasticsearch hit record to the unified SCHEMA_FIELDS."""
    source = hit.get("_source") or {}
    job_info = source.get("JobInformation") or {}
    job_loc = source.get("JobLocation") or {}
    blue_job = source.get("BlueXJobData") or {}
    blue_san = source.get("BlueXSanitized") or {}
    salary = source.get("Salary") or {}
    job_dates = source.get("JobDates") or {}

    job_id = blue_job.get("JobId") or source.get("JobId") or hit.get("_id") or ""
    title = blue_job.get("Title") or job_info.get("Title") or ""
    company = blue_job.get("CompanyName") or source.get("JobIdentity", {}).get("CompanyName") or "Randstad Hungary"
    
    city = job_loc.get("City") or blue_job.get("City") or ""
    region = job_loc.get("Region") or blue_job.get("Region") or ""
    location_full = region if region else city

    # Employment type mapping
    emp_type_raw = str(blue_san.get("Multilingual", {}).get("JobType", {}).get("en") or job_info.get("Hours") or "").lower()
    if "part" in emp_type_raw:
        emp_type = "PART_TIME"
    elif "temp" in emp_type_raw or "interim" in emp_type_raw or "szerződés" in emp_type_raw:
        emp_type = "TEMPORARY"
    elif "intern" in emp_type_raw or "diák" in emp_type_raw:
        emp_type = "INTERN"
    else:
        emp_type = "FULL_TIME"

    # Salary parsing
    sal_min_raw = salary.get("SalaryMin") or ""
    sal_max_raw = salary.get("SalaryMax") or ""
    
    # Randstad salary is sometimes in thousands, e.g. "600" for 600,000 HUF
    def clean_sal(val):
        if not val or val == "0":
            return ""
        try:
            num = int(float(str(val).replace(" ", "")))
            if num < 15000:  # clearly in thousands HUF
                num *= 1000
            return str(num)
        except Exception:
            return ""

    sal_min = clean_sal(sal_min_raw)
    sal_max = clean_sal(sal_max_raw)

    comp_type = str(blue_san.get("CompensationType") or salary.get("CompensationType") or "").lower()
    sal_per = "HOUR" if "óra" in comp_type or "hour" in comp_type else "MONTH"
    
    # Default currency to HUF for Hungary
    sal_cur = "HUF"

    # Date posted
    date_posted = job_dates.get("DateCreated") or ""
    if len(date_posted) > 10:
        date_posted = date_posted[:10]

    # Extract URL from dataLayer strings
    url = ""
    dl_str = source.get("dataLayerJobClick") or source.get("dataLayerApplyClickCommerce") or ""
    if dl_str:
        url_match = re.search(r'"url"\s*:\s*"([^"]+)"', dl_str)
        if url_match:
            url = url_match.group(1)
            
    if url and not url.startswith("http"):
        url = BASE_URL + url
    
    if not url:
        # Fallback to slug construction
        title_slug = re.sub(r'[^a-zA-Z0-9\-]+', '-', title.lower()).strip('-')
        city_slug = re.sub(r'[^a-zA-Z0-9\-]+', '-', city.lower()).strip('-')
        url = f"{BASE_URL}/allasok/{title_slug}_{city_slug}_{job_id}/"

    description = strip_html(blue_job.get("Description") or job_info.get("Description") or "")

    return {
        "source":          "randstad",
        "job_id":          str(job_id),
        "title":           title,
        "company":         company,
        "city":            city,
        "location_full":   location_full,
        "country":         "HU",
        "zip":             str(job_loc.get("Postcode") or ""),
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_per,
        "salary_currency": sal_cur,
        "employment_type": emp_type,
        "date_posted":     date_posted,
        "valid_through":   "",
        "tags":            blue_san.get("Specialism") or "",
        "category":        blue_san.get("Specialism") or "",
        "description":     description,
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             url,
        "direct_apply":    "True",
        "remote":          "",
    }

def scrape(max_jobs: int = 0, verbose: bool = True) -> list:
    """
    Scrape Randstad Hungary jobs using Route Data extraction.
    """
    if verbose:
        print("\n[randstad.hu] Starting scrape (Route Data parsing)")

    # Page 1 fetch to get total pages
    html = fetch(LISTING_URL)
    if not html:
        print("[randstad.hu] Failed to fetch listing page 1.")
        return []

    data = _extract_route_data(html)
    if not data:
        print("[randstad.hu] Failed to parse Route Data from page 1.")
        return []

    sr = data.get("searchResults") or {}
    hits_obj = sr.get("hits") or {}
    total_jobs = hits_obj.get("total") or 0
    first_page_hits = hits_obj.get("hits") or []

    if verbose:
        print(f"  Total jobs active: {total_jobs}")

    jobs = []
    # Process first page hits
    for hit in first_page_hits:
        if hit.get("_source"):
            jobs.append(_normalise(hit))

    # Determine pagination
    page_size = len(first_page_hits) or 30
    total_pages = math.ceil(total_jobs / page_size) if page_size > 0 else 1
    total_pages = min(total_pages, MAX_PAGES)

    if verbose:
        print(f"  Page 1: parsed {len(first_page_hits)} jobs. Total pages to fetch: {total_pages}")

    # Paginate remaining pages
    for page in range(2, total_pages + 1):
        if max_jobs and len(jobs) >= max_jobs:
            break
        
        polite_sleep(0.5)
        page_url = f"{LISTING_URL}page-{page}/"
        if verbose:
            print(f"  Fetching Page {page}/{total_pages}: {page_url}")
            
        page_html = fetch(page_url)
        if not page_html:
            print(f"    Failed to fetch page {page}")
            continue
            
        page_data = _extract_route_data(page_html)
        if not page_data:
            print(f"    Failed to extract route data for page {page}")
            continue
            
        page_hits = page_data.get("searchResults", {}).get("hits", {}).get("hits", [])
        if not page_hits:
            break
            
        added = 0
        for hit in page_hits:
            if hit.get("_source"):
                jobs.append(_normalise(hit))
                added += 1
                
        if verbose:
            print(f"    Parsed {added} jobs from Page {page}")

    if max_jobs:
        jobs = jobs[:max_jobs]

    if verbose:
        print(f"  Done: {len(jobs)} randstad.hu jobs total.")
    return jobs

if __name__ == "__main__":
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    save_json(jobs, "output/randstad_jobs.json")
    save_csv(jobs,  "output/randstad_jobs.csv", fields=SCHEMA_FIELDS)
