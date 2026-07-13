"""
scrapers/jobicy.py
==================
Source : https://jobicy.com  (Jobicy)
Method : Public RSS feed (no auth, no key required)
Scope  : Worldwide remote jobs — updated continuously

Feed URL
--------
https://jobicy.com/?feed=job_feed

Note: the `count` query param is blocked by the server.
The plain feed returns the latest 50 jobs by default.
"""

import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import fetch, parse_rss_items, strip_html, empty_job

_FEED_URL = "https://jobicy.com/?feed=job_feed"


def _job_id(link: str) -> str:
    m = re.search(r"/jobs/(\d+)", link)
    return m.group(1) if m else link


def _extract(text: str) -> str:
    """Strip CDATA wrappers if present."""
    if not text:
        return ""
    m = re.match(r"<!\[CDATA\[(.*?)\]\]>", text, re.S)
    return (m.group(1) if m else text).strip()


def _normalise(item: dict) -> dict:
    link  = _extract(item.get("link", ""))
    title = _extract(item.get("title", ""))
    desc  = strip_html(_extract(item.get("description", "")))

    job = empty_job()
    job.update({
        "source":        "jobicy",
        "job_id":        _job_id(link),
        "title":         title,
        "city":          "Remote",
        "location_full": "Worldwide / Remote",
        "country":       "REMOTE",
        "date_posted":   item.get("pub_date", "")[:10],
        "description":   desc[:3000],
        "url":           link,
        "direct_apply":  "True",
        "remote":        "True",
    })
    return job


def scrape(verbose=True):
    if verbose:
        print("\n[jobicy.com] Fetching public remote-job RSS feed...")

    xml = fetch(_FEED_URL, extra_headers={"Accept": "application/rss+xml, application/xml"})
    if not xml:
        if verbose:
            print("  [!] Could not fetch Jobicy feed.")
        return []

    items = parse_rss_items(xml)
    seen, jobs = set(), []

    for item in items:
        link = _extract(item.get("link", ""))
        jid  = _job_id(link)
        if not jid or jid in seen:
            continue
        seen.add(jid)
        jobs.append(_normalise(item))

    if verbose:
        print(f"  Done: {len(jobs)} Jobicy jobs.")
    return jobs


if __name__ == "__main__":
    from .base import save_both
    jobs = scrape()
    if jobs:
        save_both(jobs, "jobicy_jobs")
