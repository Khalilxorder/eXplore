"""Public Arbeitnow EU job-board API with a profile-signal filter."""

import datetime
import re

from .base import fetch_json, strip_html

API_URL = "https://www.arbeitnow.com/api/job-board-api?page={page}"
MAX_PAGES = 3
PROFILE_SIGNAL = re.compile(
    r"\b(ai|artificial intelligence|machine learning|data|python|research|audio|music|creative|"
    r"content|writer|writing|english|tutor|teaching|psychology|media|video|editing|remote|"
    r"freelance|automation|developer|analyst|translation|design|ux|innovation)\b",
    re.I,
)
EXCLUDED_TITLE_SIGNAL = re.compile(r"\b(weiterbildung|upskilling|course|academy|bootcamp|zertifikatskurs)\b", re.I)

def _iso_date(value):
    try:
        return datetime.datetime.fromtimestamp(int(value)).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return str(value or "")[:10]


def _normalise(raw):
    tags = raw.get("tags") or []
    job_types = raw.get("job_types") or []
    return {
        "source": "arbeitnow",
        "job_id": raw.get("slug", ""),
        "title": raw.get("title", ""),
        "company": raw.get("company_name", ""),
        "city": "Remote" if raw.get("remote") else raw.get("location", ""),
        "location_full": raw.get("location", ""),
        "country": "",
        "zip": "",
        "salary_min": "",
        "salary_max": "",
        "salary_period": "",
        "salary_currency": "",
        "employment_type": "; ".join(job_types).upper().replace("-", "_"),
        "date_posted": _iso_date(raw.get("created_at", "")),
        "valid_through": "",
        "tags": "; ".join(tags),
        "category": "",
        "description": strip_html(raw.get("description", "")),
        "requirements": "",
        "what_we_offer": "",
        "contact_name": "",
        "contact_email": "",
        "url": raw.get("url", ""),
        "direct_apply": "True",
        "remote": str(bool(raw.get("remote"))),
    }


def scrape(verbose=True):
    if verbose:
        print("\n[arbeitnow.com] Fetching profile-relevant EU jobs...")

    rows = []
    for page in range(1, MAX_PAGES + 1):
        payload = fetch_json(API_URL.format(page=page), extra_headers={"Accept": "application/json"}) or {}
        batch = payload.get("data") or []
        rows.extend(batch)
        if verbose:
            print(f"  Page {page}: {len(batch)} rows")
        if not payload.get("links", {}).get("next"):
            break

    jobs = []
    for raw in rows:
        text = " ".join([
            str(raw.get("title", "")),
            strip_html(raw.get("description", "")),
            " ".join(raw.get("tags") or []),
        ])
        if PROFILE_SIGNAL.search(text) and not EXCLUDED_TITLE_SIGNAL.search(str(raw.get("title", ""))) and raw.get("slug") and raw.get("url"):
            jobs.append(_normalise(raw))

    if verbose:
        print(f"  Done: {len(jobs)} profile-relevant Arbeitnow jobs.")
    return jobs
