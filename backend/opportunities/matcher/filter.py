"""
matcher/filter.py
=================
Stage 1: Loose blacklist filter.
PHILOSOPHY: Be very loose here. Better to keep a borderline job than miss a good one.
Only remove things that are truly impossible or deeply irrelevant.
The AI scorer in stage 2 will handle the ranking.
"""
import re
from .profile import get as get_profile


def _text(*fields):
    """Join multiple fields into one lowercase searchable string."""
    return " ".join(str(f) for f in fields if f).lower()


def is_blacklisted(job):
    """Return True if this job should be removed entirely."""
    p = get_profile()
    bl = p.get("filter_blacklist", {})

    title = str(job.get("title", "")).lower()
    desc  = _text(job.get("description",""), job.get("requirements",""))
    company = str(job.get("company","")).lower()

    # 1. Blacklisted title keywords
    for kw in bl.get("titles", []):
        kw_l = kw.lower()
        # Match whole word or hyphenated variant
        if re.search(r'\b' + re.escape(kw_l) + r'\b', title):
            return True, f"blacklist title: {kw}"

    # 2. Blacklisted companies
    for co in bl.get("companies", []):
        if co.lower() in company:
            return True, f"blacklist company: {co}"

    # 3. Blacklisted description keywords
    for kw in bl.get("keywords_in_description", []):
        if kw.lower() in desc:
            return True, f"blacklist desc: {kw}"

    return False, ""


def passes_location(job):
    """Return True if job is in Budapest or remote."""
    p = get_profile()
    user_city = p["personal"]["location"].lower()
    remote_ok = p["employment_preferences"].get("remote_ok", True)

    city   = str(job.get("city","")).lower()
    remote = str(job.get("remote","")).lower()
    emp_t  = str(job.get("employment_type","")).lower()
    desc   = _text(job.get("description",""), job.get("title",""))

    # Empty city = unknown = keep it
    if not city:
        return True

    if user_city in city:
        return True

    if remote_ok and (remote == "true" or "remote" in city or "remote" in desc):
        return True

    # Allow nearby / Hungary-wide postings
    if city in ("hu", "hungary", "magyarország", ""):
        return True

    return True   # <<< Be LOOSE: keep everything, scorer will penalise far jobs


def filter_jobs(jobs):
    """
    Apply Stage 1 filter. Returns (kept, removed) lists.
    Each removed item is (job, reason).
    """
    kept    = []
    removed = []

    for job in jobs:
        blacklisted, reason = is_blacklisted(job)
        if blacklisted:
            removed.append((job, reason))
            continue
        if not passes_location(job):
            removed.append((job, "location filter"))
            continue
        kept.append(job)

    return kept, removed