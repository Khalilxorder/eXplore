"""
matcher/classifier.py
=====================
Stage 2: Assigns each job to one of 3 categories.

CAT 1 - FAST & PHYSICAL
  Student jobs, warehouse, cafe, delivery, cashier, gig work.
  Start this week. Minimal barrier. Immediate income.

CAT 2 - LONG-TERM / OFF-VISION
  Stable full-time job. Needs interview. Not vision-aligned.
  Accounting, logistics, HR, engineering, manufacturing, sales.

CAT 3 - VISION-ALIGNED
  Matches SPHERE: AI, creative, writing, research, automatable, remote.
  The Einstein-clerk: you can do it AND build SPHERE simultaneously.

PRIORITY ORDER (important):
  1. Cat1 SOURCE check first (minddiak/multijob = always student jobs)
  2. Cat1 TITLE check (physical keywords)
  3. Cat3 TITLE check (vision keywords in the actual title)
  4. Cat3 SOURCE check (nofluffjobs = always tech)
  5. Cat2 by default (everything else)
  6. Cat3 by description ONLY if very strong signal (5+ vision keywords)

The old bug: Cat3 was checked before Cat1, so minddiak internships
with "AI" anywhere in description all went to Cat3 instead of Cat1.
"""
from .profile import get as get_profile

# ── Category 1 signals ─────────────────────────────────────────────
CAT1_SOURCES = {"minddiak", "multijob", "melodiak"}

CAT1_TITLE_KW = [
    "diak", "diák", "student", "diakmunka", "diákmunka",
    "penztaros", "pénztáros", "cashier",
    "elado", "eladó", "bolti",
    "pultos",
    "felszolgalo", "felszolgáló", "barista",
    "raktar", "raktár", "warehouse",
    "csomagolo", "csomagoló",
    "arufeltolto", "árufeltöltő", "picker", "komissiozas",
    "kisegito", "kisegítő",
    "takarito", "takarító", "cleaning",
    "futar", "futár", "courier", "delivery",
    "wolt", "foodora", "bolt driver",
    "promoter", "hostess",
    "mosogato", "mosogató", "dishwasher",
    "betanitott", "betanított",
    "konyhai", "kitchen",
    "ettermi", "éttermi",
    "mcdonald", "kfc", "burger", "pizza",
    "strandbufe", "strand",
    "packer", "pakolo", "pakoló",
    "segedmunka", "segédmunka",
    "fizikai munka",
    "takaritas", "takarítás",
    "arufeltoltes",
    "logisztikai kisegito",
    "raktari",
    "gyari", "gyártó", "gyarban",
]

# ── Category 3 title signals (must appear in TITLE, not just desc) ──
# These are strong enough that title alone = Cat3
CAT3_TITLE_STRONG = [
    "artificial intelligence", "machine learning", "deep learning",
    "data scientist", "data analyst", "data engineer",
    "nlp", "llm", "gpt", "chatbot", "prompt engineer",
    "python developer", "python engineer",
    "automation engineer", "rpa developer",
    "copywriter", "content writer", "content creator",
    "szövegíró", "tartalomgyártó", "tartalomgyarto",
    "audio engineer", "sound designer", "music producer",
    "ux researcher", "ux designer", "ux writer",
    "ai researcher", "ai engineer", "ai specialist",
    "research analyst", "research assistant",
    "translator", "fordito", "fordító",
    "annotator", "transcriber",
    "freelance", "szabadúszó",
    "podcast", "video editor", "video producer",
    "community manager",
    "social media manager", "social media specialist",
    "english teacher", "angol tanár", "tutor",
    "psychologist", "pszichológus", "pszichologus",
    "psychology", "pszichológia", "pszichologia",
    "research assistant", "lab assistant", "laboratory assistant",
    "kutatási asszisztens", "kutatasi asszisztens",
    "junior developer", "junior python", "junior data",
    "it support", "helpdesk",
    "annotator", "data labeler", "data labelling",
]

# Weaker title signals — only Cat3 if MULTIPLE appear, or with strong desc support
CAT3_TITLE_WEAK = [
    "developer", "fejlesztő", "fejleszto",
    "analyst", "elemző",
    "designer", "graphic",
    "creative", "kreativ",
    "content", "tartalomgy",
    "research", "kutato", "kutató",
    "remote", "home office", "tavmunka", "távmunka",
    "digital", "digitalis",
    "marketing asszisztens", "marketing assistant",
    "project coordinator", "project assistant",
    "english", "angol",
    "audio", "music", "zene", "sound",
    "writer", "iro", "iró",
    "editor", "vago", "vágó",
    "teacher", "tanar", "tanár", "oktato",
]

CAT3_SOURCES = {
    "nofluffjobs",
    "remoteok",
    "remotive",
    "euraxess",
    "huggingface_workable",
    "weworkremotely",
    "jobicy",
    "himalayas",
    "arbeitnow",
}

# Vision keywords that are unambiguous enough to trigger Cat3 from description
# (must have 5+ of these, not just "AI" appearing once in boilerplate)
CAT3_DESC_UNAMBIGUOUS = [
    "artificial intelligence", "machine learning", "deep learning",
    "prompt engineering", "large language model",
    "natural language processing", "computer vision",
    "audio engineering", "sound design", "music production",
    "content creation", "copywriting", "creative writing",
    "ux research", "user experience research",
    "data annotation", "data labeling", "text annotation",
    "python scripting", "automation scripting",
    "transcription", "translation services",
    "online tutoring", "english teaching",
]

def _has(text, keywords):
    t = text.lower()
    return any(kw.lower() in t for kw in keywords)

def _count(text, keywords):
    t = text.lower()
    return sum(1 for kw in keywords if kw.lower() in t)

def classify(job):
    source = str(job.get("source","")).lower()
    title  = str(job.get("title","")).lower()
    desc   = str(job.get("description","")).lower()
    emp_t  = str(job.get("employment_type","")).upper()
    tags   = str(job.get("tags","")).lower()

    full = title + " " + desc + " " + tags

    # ══ STEP 1: Cat1 by source (minddiak/multijob = student job platform)
    # These are ALWAYS cat1 UNLESS the title strongly signals vision work.
    # A Python Developer internship on minddiak is still a relevant find.
    if source in CAT1_SOURCES:
        # Exception: strong vision title overrides the student source
        if _has(title, CAT3_TITLE_STRONG):
            return "cat3"
        return "cat1"

    # ══ STEP 2: Cat1 by title keywords (physical/service jobs anywhere)
    if _has(title, CAT1_TITLE_KW):
        return "cat1"

    # ══ STEP 3: Cat3 by source (nofluffjobs / remoteok = always tech)
    if source in CAT3_SOURCES:
        return "cat3"

    # ══ STEP 4: Cat3 by STRONG title keyword
    if _has(title, CAT3_TITLE_STRONG):
        return "cat3"

    # ══ STEP 5: Cat3 by WEAK title — need 2+ weak signals
    weak_hits = _count(title, CAT3_TITLE_WEAK)
    if weak_hits >= 2:
        return "cat3"

    # ══ STEP 6: Cat3 by description — only with VERY strong signals
    # (5+ unambiguous vision phrases, not just "AI" appearing in boilerplate)
    unambiguous_hits = _count(full, CAT3_DESC_UNAMBIGUOUS)
    if unambiguous_hits >= 3:
        return "cat3"

    # ══ STEP 7: Cat1 by employment type (part-time/temp, not already cat3)
    if emp_t in ("PART_TIME", "TEMPORARY"):
        return "cat1"

    # ══ Default: Cat2
    return "cat2"


def classify_all(jobs):
    result = {"cat1": [], "cat2": [], "cat3": []}
    for job in jobs:
        cat = classify(job)
        job["_category"] = cat
        result[cat].append(job)
    return result
