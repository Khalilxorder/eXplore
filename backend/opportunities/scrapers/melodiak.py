"""
scrapers/melodiak.py
====================
Method : HTML listing parse
Site   : https://www.melodiak.hu/diakmunkak  (Meló-Diák student jobs, Hungary)

melodiak.hu is a SEPARATE platform from minddiak.hu / humancentrum.hu (it does
NOT use the api.humancentrum.hu LoopBack backend). Its student jobs are
server-rendered as `.job-list-item` cards on the /diakmunkak listing page, each
carrying a job-title / job-location / job-salary / job-day-hour / md-tag block
and a slug+id embedded in the card's `job-list-component-<slug>-<id>` class.

Usage:
  python -m scrapers.melodiak
"""

import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrapers.base import fetch, strip_html, save_json, save_csv, SCHEMA_FIELDS

LIST_URL = "https://www.melodiak.hu/diakmunkak"
BASE_URL = "https://www.melodiak.hu"

# Hungarian weekday initials used in the .job-day-hour widget.
_DAY_TOKENS = {"H", "K", "Sz", "Cs", "P", "V"}


def _text(node, selector):
    el = node.select_one(selector)
    return el.get_text(" ", strip=True) if el else ""


def _slug_and_id(card):
    """Pull the '<slug>-<id>' out of the job-list-component-* class token."""
    for cls in card.get("class", []):
        if cls.startswith("job-list-component-"):
            slug = cls[len("job-list-component-"):]
            m = re.search(r"-(\d+)$", slug)
            return slug, (m.group(1) if m else "")
    return "", ""


def _parse_salary(text):
    """'2500 Ft/óra' -> (2500, 'HOUR'); '450000 Ft/hó' -> (450000, 'MONTH')."""
    if not text:
        return "", ""
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return "", ""
    period = "HOUR" if re.search(r"/\s*ór", text, re.I) else (
        "MONTH" if re.search(r"/\s*(hó|hónap)", text, re.I) else "")
    return digits, period


def _normalise(card):
    slug, job_id = _slug_and_id(card)
    title = _text(card, ".job-title")
    location = _text(card, ".job-location")
    categories = _text(card, ".job-categories")
    salary_text = _text(card, ".job-salary")
    salary_min, salary_period = _parse_salary(salary_text)

    schedule_note = ""
    day_hour = card.select_one(".job-day-hour")
    if day_hour:
        # The free-text note (e.g. "egyeztetés szerint, rugalmas beosztásban")
        # sits in a sibling div after the weekday initials block.
        parts = [d.get_text(" ", strip=True) for d in day_hour.find_next_siblings("div")]
        schedule_note = next((p for p in parts if p and p not in _DAY_TOKENS), "")

    tags = [t.get_text(" ", strip=True) for t in card.select(".md-tag")]
    tags = [t for t in tags if t]

    url = f"{BASE_URL}/diakmunkak/{slug}" if slug else LIST_URL

    return {
        "source":          "melodiak",
        "job_id":          job_id,
        "title":           title,
        "company":         "Meló-Diák",
        "city":            location,
        "location_full":   location,
        "country":         "HU",
        "zip":             "",
        "salary_min":      salary_min,
        "salary_max":      "",
        "salary_period":   salary_period,
        "salary_currency": "HUF" if salary_min else "",
        "employment_type": "PART_TIME",
        "date_posted":     "",
        "valid_through":   "",
        "tags":            "; ".join(tags),
        "category":        categories,
        "description":     strip_html(schedule_note),
        "requirements":    "",
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             url,
        "direct_apply":    "",
        "remote":          "",
    }


def scrape(verbose=True):
    if verbose:
        print("\n[melodiak.hu] Fetching student jobs listing...")

    from bs4 import BeautifulSoup
    jobs, seen = [], set()
    MAX_PAGES = 10

    for page in range(1, MAX_PAGES + 1):
        url = f"{LIST_URL}?page={page}" if page > 1 else LIST_URL
        if verbose:
            print(f"  Fetching page {page}...")
        html = fetch(url)
        if not html:
            if verbose:
                print(f"  [!] Failed to fetch {url}")
            break

        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select(".job-list-item")
        if not cards:
            if verbose:
                print(f"  No more job cards found on page {page}.")
            break

        if verbose:
            print(f"    Found {len(cards)} job cards on page {page}")

        new_jobs_on_page = 0
        for card in cards:
            job = _normalise(card)
            if not job["title"]:
                continue
            key = job["job_id"] or job["url"]
            if key in seen:
                continue
            seen.add(key)
            jobs.append(job)
            new_jobs_on_page += 1

        if new_jobs_on_page == 0:
            if verbose:
                print("    No new jobs on this page. Stopping.")
            break

    if verbose:
        print(f"  Done: {len(jobs)} melodiak.hu jobs.")
    return jobs


if __name__ == "__main__":
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    if jobs:
        save_json(jobs, "output/melodiak_jobs.json")
        save_csv(jobs, "output/melodiak_jobs.csv", fields=SCHEMA_FIELDS)
    else:
        print("No jobs found.")
