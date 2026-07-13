"""Official Hugging Face Workable job board."""

from .base import fetch_json, strip_html

API_URL = "https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true"


def _normalise(raw):
    locations = raw.get("locations") or []
    location = ", ".join(
        ", ".join(filter(None, [item.get("city", ""), item.get("country", "")]))
        for item in locations
        if isinstance(item, dict)
    )
    return {
        "source": "huggingface_workable",
        "job_id": raw.get("shortcode", ""),
        "title": raw.get("title", ""),
        "company": "Hugging Face",
        "city": raw.get("city", "") or ("Remote" if raw.get("telecommuting") else ""),
        "location_full": location or raw.get("country", ""),
        "country": raw.get("country", ""),
        "zip": "",
        "salary_min": "",
        "salary_max": "",
        "salary_period": "",
        "salary_currency": "",
        "employment_type": str(raw.get("employment_type", "")).upper().replace("-", "_"),
        "date_posted": str(raw.get("published_on", "") or raw.get("created_at", ""))[:10],
        "valid_through": "",
        "tags": "; ".join(filter(None, [raw.get("department", ""), raw.get("function", ""), raw.get("experience", "")])),
        "category": raw.get("function", ""),
        "description": strip_html(raw.get("description", "")),
        "requirements": "",
        "what_we_offer": "",
        "contact_name": "",
        "contact_email": "",
        "url": raw.get("application_url", "") or raw.get("url", ""),
        "direct_apply": "True",
        "remote": str(bool(raw.get("telecommuting"))),
    }


def scrape(verbose=True):
    if verbose:
        print("\n[apply.workable.com/huggingface] Fetching official board...")

    payload = fetch_json(API_URL, extra_headers={"Accept": "application/json"}) or {}
    jobs = [_normalise(raw) for raw in payload.get("jobs", []) if raw.get("shortcode")]

    if verbose:
        print(f"  Done: {len(jobs)} Hugging Face jobs.")
    return jobs

