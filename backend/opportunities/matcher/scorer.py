"""
matcher/scorer.py
=================
Stage 3: Score each job 0-100 against user_profile.json

The score reflects HOW GOOD this specific job is FOR THIS SPECIFIC PERSON.
Not how good the job is in general — purely personal fit.

Score components:
  Vision alignment   (0-37)
  Skills overlap     (0-15)
  Practicalities     (0-30)  remote, location, salary, freshness
  Penalties          (-50 max)

Final score is clamped to 0-100.
"""
import re
import datetime
import email.utils
from .profile import get as get_profile


def _text(*fields):
    return " ".join(str(f) for f in fields if f).lower()


def _count_matches(text, keywords):
    """Count how many unique keywords appear in text."""
    t = text.lower()
    return sum(1 for kw in keywords if _keyword_matches(t, kw))


def _has_any(text, keywords):
    t = text.lower()
    return any(_keyword_matches(t, kw) for kw in keywords)


def _keyword_matches(text, keyword):
    kw = str(keyword or "").strip().lower()
    if not kw:
        return False

    escaped = re.escape(kw)
    if re.fullmatch(r"[a-z0-9]+", kw):
        return re.search(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", text, re.IGNORECASE) is not None

    prefix = r"(?<![a-z0-9])" if re.match(r"^[a-z0-9]", kw) else ""
    suffix = r"(?![a-z0-9])" if re.search(r"[a-z0-9]$", kw) else ""
    return re.search(rf"{prefix}{escaped}{suffix}", text, re.IGNORECASE) is not None


def _parse_date(date_str):
    raw = str(date_str or "").strip()
    if not raw:
        return None

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(raw[:10], fmt)
        except Exception:
            pass

    try:
        parsed = email.utils.parsedate_to_datetime(raw)
        if parsed.tzinfo:
            return parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def _days_ago(date_str):
    """Return how many days ago a YYYY-MM-DD date was. None if unparseable."""
    dt = _parse_date(date_str)
    if dt is None:
        return None
    return (datetime.datetime.now() - dt).days

def _date_timestamp(date_str):
    dt = _parse_date(date_str)
    return dt.timestamp() if dt is not None else 0


def score(job):
    """
    Score a single job. Returns int 0-100.
    Also adds _score_breakdown dict to the job for transparency.
    """
    p       = get_profile()
    w       = p["scoring_weights"]
    prefs   = p["employment_preferences"]
    vision  = p["vision"]
    skills  = [s.lower() for s in p["skills"]]
    vis_kw  = [k.lower() for k in vision["keywords"]]

    title   = str(job.get("title","")).lower()
    desc    = _text(job.get("description",""), job.get("requirements",""),
                    job.get("what_we_offer",""))
    tags    = str(job.get("tags","")).lower()
    city    = str(job.get("city","")).lower()
    remote  = str(job.get("remote","")).lower()
    emp_t   = str(job.get("employment_type","")).upper()
    source  = str(job.get("source","")).lower()
    sal_min = 0
    sal_cur = str(job.get("salary_currency","HUF")).upper()
    sal_per = str(job.get("salary_period","MONTH")).upper()

    try:
        sal_min = float(str(job.get("salary_min","0")).replace(",",".") or 0)
    except Exception:
        sal_min = 0

    full = f"{title} {desc} {tags}"
    breakdown = {}
    points = 18  # a listing must earn its way into the recommended queue

    # ── VISION ALIGNMENT ─────────────────────────────────────────
    # Vision keyword in title (strongest signal)
    title_vis_hits = _count_matches(title, vis_kw)
    if title_vis_hits >= 2:
        pts = w["vision_keyword_in_title"]
        points += pts
        breakdown["vision_title_2+"] = f"+{pts}"
    elif title_vis_hits == 1:
        pts = int(w["vision_keyword_in_title"] * 0.7)
        points += pts
        breakdown["vision_title_1"] = f"+{pts}"

    # Vision keyword in description
    desc_vis_hits = _count_matches(desc + tags, vis_kw)
    if desc_vis_hits >= 3:
        pts = w["vision_keyword_in_description"]
        points += pts
        breakdown["vision_desc_3+"] = f"+{pts}"
    elif desc_vis_hits >= 1:
        pts = int(w["vision_keyword_in_description"] * 0.5)
        points += pts
        breakdown["vision_desc_1+"] = f"+{pts}"

    # ── SKILLS OVERLAP ───────────────────────────────────────────
    skill_hits = _count_matches(full, skills)
    if skill_hits >= 3:
        pts = w["skill_match"]
        points += pts
        breakdown["skills_3+"] = f"+{pts}"
    elif skill_hits >= 1:
        pts = int(w["skill_match"] * 0.5)
        points += pts
        breakdown["skills_1+"] = f"+{pts}"

    # ── PRACTICALITIES ───────────────────────────────────────────
    # Remote / flexible
    is_remote = (remote == "true" or "remote" in city or
                 "home office" in full or "távmunka" in full or
                 "remote" in full)
    if is_remote:
        pts = w["remote_or_flexible"]
        points += pts
        breakdown["remote"] = f"+{pts}"

    # Budapest
    if "budapest" in city or "budapest" in full[:100]:
        pts = w["budapest_location"]
        points += pts
        breakdown["budapest"] = f"+{pts}"

    # English language job (big bonus — you speak English natively)
    eng_signals = ["english", "angol", "anglophone", "native english",
                   "english speaking", "english required"]
    if _has_any(full, eng_signals):
        pts = w["english_language"]
        points += pts
        breakdown["english_job"] = f"+{pts}"

    # Salary
    min_monthly = prefs.get("min_salary_huf_monthly", 150000)
    min_hourly  = prefs.get("min_salary_huf_hourly", 1200)
    if sal_min > 0:
        sal_ok = False
        if sal_per == "MONTH" and sal_cur == "HUF" and sal_min >= min_monthly:
            sal_ok = True
        elif sal_per == "MONTH" and sal_cur == "EUR" and sal_min >= 400:
            sal_ok = True
        elif sal_per == "HOUR" and sal_cur == "HUF" and sal_min >= min_hourly:
            sal_ok = True
        elif sal_per in ("MONTH","YEAR") and sal_min >= 400000:
            sal_ok = True
        if sal_ok:
            pts = w["salary_above_minimum"]
            points += pts
            breakdown["salary_ok"] = f"+{pts}"

    # Fresh posting
    days = _days_ago(job.get("date_posted",""))
    if days is not None:
        if days <= 7:
            pts = w["fresh_posting_days_7"]
            points += pts
            breakdown["fresh_7days"] = f"+{pts}"
        elif days > 30:
            pts = abs(w["penalties"]["old_posting_days_30"])
            points -= pts
            breakdown["old_30days"] = f"-{pts}"

    # Part-time (leaves time for SPHERE)
    if emp_t == "PART_TIME":
        pts = w["part_time"]
        points += pts
        breakdown["part_time"] = f"+{pts}"

    # ── PENALTIES ────────────────────────────────────────────────
    pen = w["penalties"]

    # Application portals should not promote dead-end or implausible cards.
    if not str(job.get("url", "")).strip():
        points = min(points - 35, 35)
        breakdown["missing_apply_link"] = "cap≤35 (-35)"

    valid_days = _days_ago(job.get("valid_through", ""))
    if valid_days is not None and valid_days > 0:
        points = 0
        breakdown["expired"] = "-80"

    if days is not None and days < -1:
        points = min(points - 20, 30)
        breakdown["future_date_review"] = "cap≤30 (-20)"

    seniority_text = f"{title} {tags}"
    if _has_any(seniority_text, ["senior", "principal", "staff engineer", "lead engineer", "head of", "director"]):
        points = min(points - 28, 55)
        breakdown["seniority_review"] = "cap≤55 (-28)"

    management_title = ["manager", "management lead", "team lead", "vezető", "vezeto"]
    junior_title = ["assistant", "intern", "internship", "trainee", "junior", "student", "gyakornok"]
    if _has_any(title, management_title) and not _has_any(title, junior_title):
        points = min(points - 32, 45)
        breakdown["management_review"] = "cap≤45 (-32)"

    unsupported_language_title = [
        "german", "deutsch", "french", "francia", "italian", "olasz",
        "czech", "slovak", "spanish", "dutch", "swedish", "polish",
    ]
    if _has_any(title, unsupported_language_title):
        points = min(points - 30, 45)
        breakdown["language_review"] = "cap≤45 (-30)"

    german_title_markers = [
        "(m/w/d)", "(w/m/d)", "(m/f/d)", "praktikum", "werkstudent", "pflicht-",
        "für ", "mit schwerpunkt", "content creator*in", "bis zu",
    ]
    if _has_any(title, german_title_markers):
        points = min(points - 30, 45)
        breakdown["german_title_review"] = "cap≤45 (-30)"

    unsupported_language_requirement = [
        "deutschkenntnisse auf mindestens", "deutschkenntnisse c1", "deutschkenntnisse b2",
        "german required", "german language required", "fluent german",
        "czech-speaking", "french-speaking", "italian-speaking", "spanish-speaking",
    ]
    if _has_any(full, unsupported_language_requirement):
        points = min(points - 45, 45)
        breakdown["language_requirement_review"] = "cap≤45 (-45)"

    technical_title = ["engineer", "developer", "data scientist", "architect"]
    multi_year_requirement = [
        "3+ years", "4+ years", "5+ years", "five years",
        "years of professional experience", "practice for years",
        "public track record", "extensive experience", "proven experience",
    ]
    if _has_any(title, technical_title) and _has_any(full, multi_year_requirement):
        points = min(points - 24, 55)
        breakdown["experience_review"] = "cap≤55 (-24)"

    # Heavy physical signals in title
    heavy = ["nehéz fizikai", "fizikai munkavégzés", "testi munkavégzés",
             "kétkezi", "ketkezi", "erős fizikai"]
    if _has_any(title + desc[:200], heavy):
        pts = abs(pen["heavy_physical"])
        points = min(points - pts, 35)
        breakdown["heavy_physical"] = f"cap≤35 (-{pts})"

    # Requires degree not held
    degree_req = ["mesterképzés", "doktori", "phd", "mba",
                  "jogi diploma", "orvosi diploma", "mérnöki diploma"]
    if _has_any(desc, degree_req):
        pts = abs(pen["requires_degree_not_held"])
        points = min(points - pts, 45)
        breakdown["degree_penalty"] = f"cap≤45 (-{pts})"

    # Far from Budapest and not remote
    if city and "budapest" not in city and not is_remote:
        non_budapest_cities = [c for c in [city] if c not in
                               ("hu", "hungary", "remote", "")]
        if non_budapest_cities:
            pts = max(20, abs(pen["outside_budapest_not_remote"]))
            points = min(points - pts, 60)
            breakdown["far_location"] = f"cap≤60 (-{pts})"

    # Hungarian-only strict (hard for non-native)
    hu_strict = ["csak magyarul", "kizárólag magyar anyanyelvű",
                 "anyanyelvi szintű magyar", "C1 magyar"]
    if _has_any(desc, hu_strict):
        pts = abs(pen["hungarian_only_strict"])
        points = min(points - pts, 55)
        breakdown["hungarian_strict"] = f"cap≤55 (-{pts})"

    # Clamp to 0-100
    final = max(0, min(100, points))

    job["_score"] = final
    job["_score_breakdown"] = breakdown
    return final


def score_all(jobs):
    """Score all jobs. Returns jobs sorted by score descending."""
    for job in jobs:
        score(job)
    return sorted(jobs, key=lambda j: (
        -int(j.get("_score", 0)),
        -int(bool(str(j.get("url", "")).strip())),
        -_date_timestamp(j.get("date_posted", "")),
        str(j.get("source", "")),
        str(j.get("title", "")),
    ))
