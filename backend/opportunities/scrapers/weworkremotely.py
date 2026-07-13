"""
scrapers/weworkremotely.py
==========================
Source : https://weworkremotely.com  (We Work Remotely)
Method : Public RSS feeds (no auth, no key)
Scope  : Worldwide remote jobs — tech, design, product, devops

Category feeds used (where 200 OK):
  Programming, DevOps, Design, Product + main feed for everything else.
"""

import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch, parse_rss_items, strip_html, empty_job

# Category-specific feeds that reliably return 200
_CATEGORY_FEEDS = [
    ("https://weworkremotely.com/categories/remote-programming-jobs.rss",     "Programming"),
    ("https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss", "DevOps"),
    ("https://weworkremotely.com/categories/remote-design-jobs.rss",          "Design"),
    ("https://weworkremotely.com/categories/remote-product-jobs.rss",         "Product"),
]

# Main feed catches everything else (Management, Sales, Marketing, etc.)
_MAIN_FEED = ("https://weworkremotely.com/remote-jobs.rss", "All")


def _job_id(link: str) -> str:
    m = re.search(r"/listings/(\d+)", link)
    return m.group(1) if m else link


def _company_from_title(title: str):
    """WWR RSS titles are 'Company: Job Title' — split on first colon."""
    if ":" in title:
        parts = title.split(":", 1)
        return parts[0].strip(), parts[1].strip()
    return "", title.strip()


def _normalise(item: dict, category: str) -> dict:
    company, title = _company_from_title(item.get("title", ""))
    link = item.get("link", "").strip()
    desc = strip_html(item.get("description", ""))

    job = empty_job()
    job.update({
        "source":        "weworkremotely",
        "job_id":        _job_id(link),
        "title":         title,
        "company":       company,
        "city":          "Remote",
        "location_full": "Worldwide / Remote",
        "country":       "REMOTE",
        "date_posted":   item.get("pub_date", "")[:10],
        "category":      category,
        "description":   desc[:3000],
        "url":           link,
        "direct_apply":  "True",
        "remote":        "True",
    })
    return job


def _fetch_feed(url: str, label: str, seen: set, verbose: bool) -> list:
    xml = fetch(url, extra_headers={"Accept": "application/rss+xml, application/xml"})
    if not xml:
        if verbose:
            print(f"  [warn] Could not fetch {label} feed.")
        return []
    items = parse_rss_items(xml)
    jobs, new = [], 0
    for item in items:
        jid = _job_id(item.get("link", ""))
        if not jid or jid in seen:
            continue
        seen.add(jid)
        jobs.append(_normalise(item, label))
        new += 1
    if verbose:
        print(f"  {label}: {new} jobs")
    return jobs


def scrape(verbose=True):
    if verbose:
        print("\n[weworkremotely.com] Fetching RSS feeds...")

    seen = set()
    jobs = []

    # 1. Category-specific feeds first (richer category metadata)
    for feed_url, category in _CATEGORY_FEEDS:
        jobs.extend(_fetch_feed(feed_url, category, seen, verbose))

    # 2. Main feed — catches all remaining categories
    jobs.extend(_fetch_feed(_MAIN_FEED[0], _MAIN_FEED[1], seen, verbose))

    if verbose:
        print(f"  Done: {len(jobs)} We Work Remotely jobs.")
    return jobs


if __name__ == "__main__":
    from .base import save_both
    jobs = scrape()
    if jobs:
        save_both(jobs, "weworkremotely_jobs")
