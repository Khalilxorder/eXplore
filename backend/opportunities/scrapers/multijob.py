"""
scrapers/multijob.py
====================
Method : SSR HTML pagination  (simplest possible approach)
Site   : https://multijobisz.hu  (Multi Job Iskolaszövetkezet, student jobs)
Tech   : ASP.NET MVC — fully Server-Side Rendered, zero JavaScript needed

Discovery path:
  Homepage  ->  pagination links ?page=1 ... ?page=9
  Each page ->  10 job cards with title, city, salary, age restriction, URL
  Detail URL->  /munkak/ID-job-title-slug

URL patterns:
  Listing : /munkak?page=N
  Detail  : /munkak/4156-konyhai-kisegito-diakmunka-csopak
  ID is the first numeric segment of the detail slug.

Special categories (separate listing pages):
  /mekimunka    -> McDonald's exclusive jobs
  /kfcmulti/munkak  -> KFC exclusive jobs

No authentication, no tokens, no JavaScript required.
"""

import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import (fetch, strip_html, save_json, save_csv,
                   SCHEMA_FIELDS, polite_sleep)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE          = "https://multijobisz.hu"
LISTING_URL   = BASE + "/munkak"
MAX_PAGES     = 15    # safety cap; actual pages ~9

EXTRA_HEADERS = {
    "Referer": BASE + "/",
}


# ---------------------------------------------------------------------------
# Listing page parser
# ---------------------------------------------------------------------------

def _parse_listing_page(html: str) -> list:
    """
    Extract job stubs from a listing page.
    Returns list of dicts with: title, city, salary, url, age_ok_under_18
    """
    stubs = []
    # Each job is in an <a href="/munkak/ID-slug"> block
    cards = re.findall(
        r'<a[^>]+href="(/munkak/(\d+)[^"]*)"[^>]*>(.*?)</a>',
        html, re.S | re.I
    )
    for href, job_id, inner in cards:
        if not job_id:
            continue
        title_m = re.search(r'class="[^"]*(?:title|name|job-name)[^"]*"[^>]*>(.*?)<', inner, re.S | re.I)
        if not title_m:
            # Fallback: first text node
            title_m = re.search(r'>\s*([A-ZÁÉÍÓÖŐÜŰ][^<]{3,80})\s*<', inner, re.S)
        title = strip_html(title_m.group(1)) if title_m else ""

        city_m  = re.search(r'map-marked|location.*?>(.*?)<', inner, re.S | re.I)
        city    = strip_html(city_m.group(1)) if city_m else ""

        sal_m   = re.search(r'money.*?([\d.,\s\-]+)\s*Ft', inner, re.S | re.I)
        salary  = sal_m.group(1).strip() if sal_m else ""

        under18 = bool(re.search(r"18 \u00e9v alatt v\u00e9gezhet\u0151", inner, re.I))

        stubs.append({
            "job_id":         job_id,
            "title":          title,
            "city":           city,
            "salary_raw":     salary,
            "url":            BASE + href,
            "age_under_18_ok": under18,
        })
    return stubs


def _get_total_pages(html: str) -> int:
    """Extract total page count from pagination block."""
    # Pattern: <a href="/munkak?page=N">N</a>
    page_nums = re.findall(r'/munkak\?page=(\d+)', html)
    if page_nums:
        return max(int(p) for p in page_nums)
    return 1


# ---------------------------------------------------------------------------
# Detail page parser
# ---------------------------------------------------------------------------

def parse_detail(html: str, stub: dict) -> dict:
    """Enrich a job stub with full description from the detail page."""

    def section(label_hu: str, label_en: str = "") -> str:
        for lbl in [label_hu, label_en]:
            if not lbl:
                continue
            pat = rf"{re.escape(lbl)}[^<]*</[^>]+>(.*?)(?=<h[2-4]|<div[^>]+class=\"(?:col|row|section|job)|$)"
            m = re.search(pat, html, re.S | re.I)
            if m and len(m.group(1)) > 5:
                return strip_html(m.group(1))
        return ""

    description  = (section("A munka le\u00edr\u00e1sa") or
                    section("Le\u00edr\u00e1s") or
                    section("A munkak\u00f6rr\u0151l"))
    requirements = section("Elv\u00e1r\u00e1sok", "Requirements")
    offer        = section("Amit k\u00edn\u00e1lunk", "What we offer")

    # Salary parsing: "2.000-3.000,-Ft/óra" or "3.000,-Ft/óra"
    sal_m = re.search(r"([\d.,]+)\s*-?\s*([\d.,]*)\s*,?-?\s*Ft/\u00f3ra", html, re.I)
    sal_min = sal_max = ""
    if sal_m:
        sal_min = sal_m.group(1).replace(".", "").replace(",", "")
        sal_max = sal_m.group(2).replace(".", "").replace(",", "") or sal_min

    # Contact
    email_m = re.search(r"[\w.+-]+@[\w.-]+\.\w{2,}", html)
    email   = email_m.group(0) if email_m else ""

    # Date posted
    date_m = re.search(
        r"(\d{4})\.\s*(\d{2})\.\s*(\d{2})", html)
    date_posted = (f"{date_m.group(1)}-{date_m.group(2)}-{date_m.group(3)}"
                   if date_m else "")

    return {
        "source":          "multijob",
        "job_id":          stub["job_id"],
        "title":           stub["title"],
        "company":         "Multi Job Iskolaszövetkezet",
        "city":            stub["city"],
        "location_full":   stub["city"],
        "country":         "HU",
        "zip":             "",
        "salary_min":      sal_min or stub.get("salary_raw", "").split("-")[0].replace(".", "").replace(",", "").strip(),
        "salary_max":      sal_max or "",
        "salary_period":   "HOUR",
        "salary_currency": "HUF",
        "employment_type": "TEMPORARY",
        "date_posted":     date_posted,
        "valid_through":   "",
        "tags":            "18 alatt is" if stub.get("age_under_18_ok") else "",
        "category":        "",
        "description":     description,
        "requirements":    requirements,
        "what_we_offer":   offer,
        "contact_name":    "",
        "contact_email":   email,
        "url":             stub["url"],
        "direct_apply":    "True",
    }


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

def scrape(verbose: bool = True) -> list:
    """
    Scrape all Multi Job listings via SSR HTML pagination.
    No auth, no JS, no tokens needed.

    Returns:
        List of normalised job dicts.
    """
    if verbose:
        print("\n[multijobisz.hu] Starting SSR HTML scrape")

    # Get page 1 to find total pages
    html_p1 = fetch(LISTING_URL + "?page=1", extra_headers=EXTRA_HEADERS)
    total_pages = min(_get_total_pages(html_p1), MAX_PAGES)
    if verbose:
        print(f"  Total pages: {total_pages}")

    # Collect all stubs from all listing pages
    all_stubs = []
    for page in range(1, total_pages + 1):
        html = fetch(f"{LISTING_URL}?page={page}", extra_headers=EXTRA_HEADERS)
        stubs = _parse_listing_page(html)
        if verbose:
            print(f"  Page {page:>2}/{total_pages}  -> {len(stubs)} stubs")
        all_stubs.extend(stubs)
        polite_sleep(0.4)

    # Fetch detail pages
    jobs, total = [], len(all_stubs)
    for i, stub in enumerate(all_stubs, 1):
        if verbose:
            print(f"  [{i:>3}/{total}]  {stub['url']}")
        html = fetch(stub["url"], extra_headers=EXTRA_HEADERS)
        if html:
            jobs.append(parse_detail(html, stub))
        polite_sleep(0.35)

    if verbose:
        print(f"  Done: {len(jobs)} multijob.hu jobs scraped.")
    return jobs


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    save_json(jobs, "output/multijob_jobs.json")
    save_csv(jobs,  "output/multijob_jobs.csv", fields=SCHEMA_FIELDS)
