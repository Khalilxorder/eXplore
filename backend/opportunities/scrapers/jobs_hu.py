"""
scrapers/jobs_hu.py
===================
Method : WordPress RSS feed (detail pages return 500 - server-side bug)
Site   : jobs.hu  (general job board, WordPress + JobMonster theme)
Tech   : WordPress 6.9 with noo_job custom post type

Discovery:
  robots.txt -> WordPress, references wp-content/uploads/jobmonster
  wp-json/wp/v2/types -> confirms noo_job post type
  wp-json/wp/v2/noo_job -> 404 (endpoint disabled)
  wp-sitemap-posts-noo_job-1.xml -> 2000 URLs (works!)
  Detail pages -> HTTP 500 (WordPress PHP crash, server-side bug)
  RSS feed -> https://jobs.hu/allasok/feed/ -> WORKS PERFECTLY

RSS provides:
  title, link, dc:creator (company), pubDate, description, content:encoded (full HTML)

Limitation:
  RSS returns only the latest ~20 jobs. Sitemap has 6000+ but detail pages are broken.
  When jobs.hu fixes their server, switch to sitemap + JSON-LD mode.
"""

import sys
import os
import re
import xml.etree.ElementTree as ET
from html import unescape
from email.utils import parsedate_to_datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch, strip_html, save_json, save_csv, SCHEMA_FIELDS

RSS_URL = "https://jobs.hu/allasok/feed/"


def _parse_rss(xml_text):
    """Parse WordPress RSS feed into list of raw job dicts."""
    jobs = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return jobs

    ns = {
        "content": "http://purl.org/rss/1.0/modules/content/",
        "dc": "http://purl.org/dc/elements/1.1/",
    }

    for item in root.findall(".//item"):
        title = item.findtext("title", "").strip()
        link = item.findtext("link", "").strip()
        company = item.findtext("dc:creator", "", ns).strip()
        pub_date = item.findtext("pubDate", "").strip()
        desc = item.findtext("description", "").strip()
        content = item.findtext("content:encoded", "", ns).strip()
        guid = item.findtext("guid", "").strip()

        # Extract job ID from guid: ?post_type=noo_job&p=528476
        job_id = ""
        m = re.search(r"p=(\d+)", guid)
        if m:
            job_id = m.group(1)
        elif link:
            # Try from URL slug
            slug = link.rstrip("/").split("/")[-1]
            job_id = slug

        # Parse date
        date_posted = ""
        if pub_date:
            try:
                dt = parsedate_to_datetime(pub_date)
                date_posted = dt.strftime("%Y-%m-%d")
            except Exception:
                pass

        jobs.append({
            "title": title,
            "link": link,
            "company": company,
            "date_posted": date_posted,
            "description": strip_html(desc),
            "full_content": strip_html(content),
            "job_id": job_id,
        })

    return jobs


def _normalise(raw):
    """Map RSS item to unified schema."""
    # Try to extract city from content (often in the HTML)
    content = raw.get("full_content", "")
    city = ""
    city_m = re.search(r"(?:Budapest|Debrecen|Szeged|P.cs|Gy.r|Miskolc|Kecskem.t|Sz.kesfeh.rv.r)", content)
    if city_m:
        city = city_m.group(0)

    return {
        "source":          "jobs_hu",
        "job_id":          raw["job_id"],
        "title":           raw["title"],
        "company":         raw["company"],
        "city":            city,
        "location_full":   "",
        "country":         "HU",
        "zip":             "",
        "salary_min":      "",
        "salary_max":      "",
        "salary_period":   "",
        "salary_currency": "HUF",
        "employment_type": "FULL_TIME",
        "date_posted":     raw["date_posted"],
        "valid_through":   "",
        "tags":            "",
        "category":        "",
        "description":     raw.get("full_content", "") or raw.get("description", ""),
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             raw["link"],
        "direct_apply":    "",
    }


def scrape(verbose=True):
    """
    Scrape jobs.hu via WordPress RSS feed.
    Returns latest ~20 jobs (RSS limitation).
    """
    if verbose:
        print("\n[jobs.hu] Fetching RSS feed...")

    xml = fetch(RSS_URL)
    if not xml:
        print("  [!] Failed to fetch RSS feed")
        return []

    raw_jobs = _parse_rss(xml)
    if verbose:
        print(f"  RSS items: {len(raw_jobs)}")

    jobs = [_normalise(r) for r in raw_jobs]
    if verbose:
        print(f"  Done: {len(jobs)} jobs.hu jobs from RSS.")
    return jobs


if __name__ == "__main__":
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    save_json(jobs, "output/jobs_hu_jobs.json")
    save_csv(jobs, "output/jobs_hu_jobs.csv", fields=SCHEMA_FIELDS)
