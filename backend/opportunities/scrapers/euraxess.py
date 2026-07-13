"""Public EURAXESS research-job search results."""

import datetime
import re

from .base import fetch, strip_html

BASE_URL = "https://euraxess.ec.europa.eu"
SEARCH_URL = BASE_URL + "/jobs/search?sort%5Bname%5D=created&sort%5Bdirection%5D=DESC&page={page}"
MAX_PAGES = 3


def _first(pattern, text):
    match = re.search(pattern, text, re.I | re.S)
    return strip_html(match.group(1)).strip() if match else ""

def _iso_date(value):
    try:
        return datetime.datetime.strptime(value, "%d %b %Y").strftime("%Y-%m-%d")
    except ValueError:
        return str(value or "")[:10]


def _normalise(article):
    href = _first(r'<h3[^>]*>.*?<a[^>]*href="([^"]+)"', article)
    url = BASE_URL + href if href.startswith("/") else href
    job_id = href.rstrip("/").split("/")[-1] if href else ""
    title = _first(r"<h3[^>]*>.*?<span>(.*?)</span>", article)
    company = _first(r'primary-meta-item[^>]*>\s*<a[^>]*>(.*?)</a>', article)
    date_posted = _first(r"Posted on:\s*([^<]+)", article)
    description = _first(r'ecl-content-block__description[^>]*>(.*?)</div>', article)
    location = _first(r"Work Locations:.*?<div[^>]*>\s*(.*?)\s*</div>\s*</div>\s*<div class=\"id-Research-Field", article)
    deadline = _first(r'Application Deadline:.*?<time[^>]*datetime="([^"]+)"', article)
    tags = re.findall(r'aria-label="Filter by ([^"]+)"', article, re.I)

    return {
        "source": "euraxess",
        "job_id": job_id,
        "title": title,
        "company": company,
        "city": "",
        "location_full": location,
        "country": "",
        "zip": "",
        "salary_min": "",
        "salary_max": "",
        "salary_period": "",
        "salary_currency": "",
        "employment_type": "",
        "date_posted": _iso_date(date_posted),
        "valid_through": deadline[:10],
        "tags": "; ".join(dict.fromkeys(tags)),
        "category": "research",
        "description": description,
        "requirements": "",
        "what_we_offer": "",
        "contact_name": "",
        "contact_email": "",
        "url": url,
        "direct_apply": "False",
        "remote": "",
    }


def scrape(verbose=True):
    if verbose:
        print("\n[euraxess.ec.europa.eu] Fetching recent research jobs...")

    jobs = []
    for page in range(MAX_PAGES):
        html = fetch(SEARCH_URL.format(page=page), extra_headers={"Accept": "text/html"})
        articles = re.findall(r'<article class="ecl-content-item">(.*?)</article>', html, re.I | re.S)
        if verbose:
            print(f"  Page {page + 1}: {len(articles)} rows")
        if not articles:
            break
        jobs.extend(_normalise(article) for article in articles)

    jobs = [job for job in jobs if job.get("job_id") and job.get("title") and job.get("url")]
    jobs = list({job["job_id"]: job for job in jobs}.values())
    if verbose:
        print(f"  Done: {len(jobs)} EURAXESS jobs.")
    return jobs
