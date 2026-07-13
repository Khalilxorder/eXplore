"""
scrapers/profession.py
======================
Method : XML SITEMAPS  +  JSON-LD JobPosting  +  RSS feed
Site   : https://www.profession.hu  (largest Hungarian job board, 18,000+ listings)
Tech   : Server-Side Rendered (SSR) PHP/Java backend

Discovery path:
  /robots.txt  ->  reveals sitemap index URLs
  /sitemap-listings-index-hu.xml  ->  23 category sub-sitemaps
  Each sub-sitemap  ->  all job detail page URLs with <lastmod>
  Each detail page  ->  JSON-LD <script type="application/ld+json"> JobPosting
  /allasok?rss  ->  RSS feed of latest jobs (no auth, instant)

Sitemap categories found:
  admin, banking, building, custrserv, education, engineering, environment,
  finance, healthcare, hospitality, hr, itdev, itops, labor, legal, logistics,
  management, manufacturing, marketing, public, sales, skilled, ssc

RSS quick feed:
  https://www.profession.hu/allasok?rss
  -> Returns ~20 latest jobs as XML with title, URL, date, description bullets

Full scrape strategy (3 tiers):
  TIER 1 (fast, ~20 jobs):  RSS feed only
  TIER 2 (index, all URLs): Parse all 23 sitemaps -> get every job URL + date
  TIER 3 (full data):       Fetch each URL -> extract JSON-LD JobPosting schema
"""

import re
import json
import time
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import (fetch, strip_html, extract_job_posting_ld,
                   parse_sitemap_urls, parse_rss_items,
                   save_json, save_csv, SCHEMA_FIELDS, polite_sleep)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE            = "https://www.profession.hu"
SITEMAP_INDEX   = BASE + "/sitemap-listings-index-hu.xml"
RSS_URL         = BASE + "/allasok?rss"

EXTRA_HEADERS   = {
    "Referer": BASE + "/",
    "Accept":  "text/html,application/xhtml+xml,*/*",
}


# ---------------------------------------------------------------------------
# Tier 1: RSS quick feed
# ---------------------------------------------------------------------------

def scrape_rss() -> list:
    """Fetch the RSS feed and return the latest ~20 jobs."""
    print("[profession.hu] Fetching RSS feed...")
    xml   = fetch(RSS_URL, extra_headers=EXTRA_HEADERS)
    items = parse_rss_items(xml)
    jobs  = []
    for it in items:
        url = it["link"].split("?")[0]   # strip tracking params
        job_id = ""
        m = re.search(r"-(\d{7,})$", url)
        if m:
            job_id = m.group(1)
        # description in RSS is a JSON array string of task bullets
        desc = it["description"]
        try:
            bullets = json.loads(desc)
            desc = "; ".join(bullets) if isinstance(bullets, list) else desc
        except Exception:
            pass

        jobs.append({
            "source":          "profession",
            "job_id":          job_id,
            "title":           it["title"],
            "company":         "",
            "city":            "",
            "location_full":   "",
            "country":         "HU",
            "zip":             "",
            "salary_min":      "",
            "salary_max":      "",
            "salary_period":   "",
            "salary_currency": "HUF",
            "employment_type": "",
            "date_posted":     it["pub_date"][:10] if it["pub_date"] else "",
            "valid_through":   "",
            "tags":            "",
            "category":        "",
            "description":     strip_html(desc),
            "requirements":    "",
            "what_we_offer":   "",
            "contact_name":    "",
            "contact_email":   "",
            "url":             url,
            "direct_apply":    "",
        })
    print(f"  RSS returned {len(jobs)} jobs")
    return jobs


# ---------------------------------------------------------------------------
# Tier 2: Collect ALL job URLs from sitemaps
# ---------------------------------------------------------------------------

def collect_all_urls(max_categories: int = 999) -> list:
    """
    Parse the sitemap index -> each category sitemap -> list of job URLs.
    Returns list of (url, lastmod) tuples.
    """
    print("[profession.hu] Fetching sitemap index...")
    index_xml = fetch(SITEMAP_INDEX, extra_headers=EXTRA_HEADERS)
    cat_sitemaps, _ = parse_sitemap_urls(index_xml)
    print(f"  Found {len(cat_sitemaps)} category sitemaps")

    all_pairs = []
    for i, sm_url in enumerate(cat_sitemaps[:max_categories], 1):
        cat = sm_url.split("sitemap-listings-")[1].split("-hu")[0]
        xml = fetch(sm_url, extra_headers=EXTRA_HEADERS)
        # Extract loc + lastmod pairs
        locs    = re.findall(r"<loc>(.*?)</loc>",      xml, re.S)
        lastmod = re.findall(r"<lastmod>(.*?)</lastmod>", xml, re.S)
        pairs   = list(zip(
            [l.strip() for l in locs],
            [d.strip()[:10] for d in lastmod] + [""] * len(locs)
        ))
        print(f"  [{i:>2}/{len(cat_sitemaps)}] {cat:<20} -> {len(pairs)} URLs")
        all_pairs.extend(pairs)
        time.sleep(0.3)

    # Deduplicate by URL
    seen, unique = set(), []
    for url, date in all_pairs:
        if url not in seen:
            seen.add(url)
            unique.append((url, date))

    print(f"  Total unique job URLs: {len(unique)}")
    return unique


# ---------------------------------------------------------------------------
# Tier 3: Parse each job detail page
# ---------------------------------------------------------------------------

def _parse_html_fallback(html: str, url: str, date: str) -> dict:
    """
    When JSON-LD is absent, parse the SSR HTML directly.
    profession.hu detail pages have clearly labelled sections.
    """
    job_id = ""
    m = re.search(r"-(\d{7,})(?:/|$|\?)", url)
    if m:
        job_id = m.group(1)

    # Title
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S | re.I)
    title = strip_html(h1.group(1)) if h1 else ""

    # Company  (appears in "allasok/company-name" link or og:site_name)
    company_m = re.search(
        r'<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"', html, re.I)
    company = company_m.group(1) if company_m else ""

    # Location  (og:description often starts with city)
    desc_m = re.search(
        r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html, re.I)
    city = desc_m.group(1).split(",")[0].strip() if desc_m else ""

    # Salary
    sal_m = re.search(r"Br\.\s*([\d\s]+(?:\s*-\s*[\d\s]+)?)\s*Ft", html, re.I)
    sal_raw = sal_m.group(1).strip() if sal_m else ""
    sal_parts = sal_raw.split("-")
    sal_min = sal_parts[0].replace(" ", "") if sal_parts else ""
    sal_max = sal_parts[1].replace(" ", "") if len(sal_parts) > 1 else sal_min

    # Description sections
    def section(label):
        pat = rf"{label}[^<]*</[^>]+>(.*?)(?:<h\d|<div[^>]+class=\"(?:job|section)|$)"
        s = re.search(pat, html, re.S | re.I)
        return strip_html(s.group(1)) if s else ""

    return {
        "source":          "profession",
        "job_id":          job_id,
        "title":           title,
        "company":         company,
        "city":            city,
        "location_full":   city,
        "country":         "HU",
        "zip":             "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   "MONTH",
        "salary_currency": "HUF",
        "employment_type": "",
        "date_posted":     date,
        "valid_through":   "",
        "tags":            "",
        "category":        "",
        "description":     section("Főbb feladatok"),
        "requirements":    section("Elvárások"),
        "what_we_offer":   section("Amit kínálunk"),
        "contact_name":    "",
        "contact_email":   "",
        "url":             url.split("?")[0],
        "direct_apply":    "",
    }


def _from_ld(ld: dict, url: str, date: str) -> dict:
    """Map a JSON-LD JobPosting dict to unified schema."""
    job_id = ""
    m = re.search(r"-(\d{7,})(?:/|$|\?)", url)
    if m:
        job_id = m.group(1)

    loc  = ld.get("jobLocation") or {}
    addr = loc.get("address", {}) if isinstance(loc, dict) else {}
    if isinstance(addr, str):
        city = addr
    else:
        city = addr.get("addressLocality", "")

    sal      = ld.get("baseSalary") or {}
    sal_val  = sal.get("value", {}) if isinstance(sal, dict) else {}
    sal_min  = str(sal_val.get("minValue", sal_val.get("value", "")))
    sal_max  = str(sal_val.get("maxValue", sal_val.get("value", "")))
    sal_unit = sal_val.get("unitText", "MONTH")

    org  = ld.get("hiringOrganization") or {}
    comp = org.get("name", "") if isinstance(org, dict) else ""

    # industry / category from industry or occupationalCategory
    cat = ld.get("industry", "") or ld.get("occupationalCategory", "")

    return {
        "source":          "profession",
        "job_id":          job_id,
        "title":           ld.get("title", ""),
        "company":         comp,
        "city":            city,
        "location_full":   city,
        "country":         addr.get("addressCountry", "HU") if isinstance(addr, dict) else "HU",
        "zip":             addr.get("postalCode", "") if isinstance(addr, dict) else "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_unit,
        "salary_currency": sal.get("currency", "HUF") if isinstance(sal, dict) else "HUF",
        "employment_type": ld.get("employmentType", ""),
        "date_posted":     ld.get("datePosted", date),
        "valid_through":   ld.get("validThrough", ""),
        "tags":            "",
        "category":        str(cat),
        "description":     strip_html(ld.get("description", "")),
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             ld.get("url", url).split("?")[0],
        "direct_apply":    str(ld.get("directApply", "")),
    }


def scrape_full(max_jobs: int = 0, verbose: bool = True,
                categories: list = None) -> list:
    """
    Full scrape: sitemap index -> all category sitemaps -> each job detail page.

    Args:
        max_jobs: cap the number of jobs fetched (0 = no cap, fetch all)
        verbose:  print progress

    Returns:
        List of normalised job dicts.
    """
    if verbose:
        print("\n[profession.hu] Starting full scrape via sitemaps + JSON-LD")

    url_pairs = collect_all_urls()
    # Filter by category if specified (e.g. ["itdev","marketing"])
    if categories:
        cats_set = set(c.lower() for c in categories)
        url_pairs = [(u,d) for u,d in url_pairs
                     if any(c in u.lower() for c in cats_set)]
        if verbose:
            print(f"  Filtered to {len(url_pairs)} URLs for categories: {categories}")
    if max_jobs:
        url_pairs = url_pairs[:max_jobs]

    jobs, total = [], len(url_pairs)
    for i, (url, date) in enumerate(url_pairs, 1):
        if verbose and i % 50 == 0:
            print(f"  [{i:>5}/{total}] fetching detail pages...")

        html = fetch(url, extra_headers=EXTRA_HEADERS)
        if not html:
            continue

        ld = extract_job_posting_ld(html)
        if ld:
            jobs.append(_from_ld(ld, url, date))
        else:
            jobs.append(_parse_html_fallback(html, url, date))

        polite_sleep(0.35)

    if verbose:
        print(f"  Done: {len(jobs)} profession.hu jobs scraped.")
    return jobs


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os, sys
    os.makedirs("output", exist_ok=True)

    # Default: RSS quick run; pass --full for complete sitemap scrape
    if "--full" in sys.argv:
        jobs = scrape_full()
    else:
        print("Tip: run with --full to fetch all 18,000+ jobs via sitemaps.")
        jobs = scrape_rss()

    save_json(jobs, "output/profession_jobs.json")
    save_csv(jobs,  "output/profession_jobs.csv", fields=SCHEMA_FIELDS)
