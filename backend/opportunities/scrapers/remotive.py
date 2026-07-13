"""Public Remotive remote-job feed."""

from .base import fetch_json, strip_html

API_URL = "https://remotive.com/api/remote-jobs"


def _normalise(raw):
    tags = raw.get("tags") or []
    return {
        "source": "remotive",
        "job_id": str(raw.get("id", "")),
        "title": raw.get("title", ""),
        "company": raw.get("company_name", ""),
        "city": "Remote",
        "location_full": raw.get("candidate_required_location", "") or "Remote",
        "country": "REMOTE",
        "zip": "",
        "salary_min": "",
        "salary_max": "",
        "salary_period": "",
        "salary_currency": "",
        "employment_type": str(raw.get("job_type", "")).upper().replace("-", "_"),
        "date_posted": str(raw.get("publication_date", ""))[:10],
        "valid_through": "",
        "tags": "; ".join(tags),
        "category": raw.get("category", ""),
        "description": strip_html(raw.get("description", "")),
        "requirements": "",
        "what_we_offer": "",
        "contact_name": "",
        "contact_email": "",
        "url": raw.get("url", ""),
        "direct_apply": "True",
        "remote": "True",
    }


def scrape(verbose=True):
    if verbose:
        print("\n[remotive.com] Fetching public remote-job feed...")

    payload = fetch_json(API_URL, extra_headers={"Accept": "application/json"}) or {}
    jobs = [_normalise(raw) for raw in payload.get("jobs", []) if raw.get("id") and raw.get("url")]

    if verbose:
        print(f"  Done: {len(jobs)} Remotive jobs.")
    return jobs

