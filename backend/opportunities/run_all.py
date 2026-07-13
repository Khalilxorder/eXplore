"""
run_all.py
==========
Master runner for the Hungary Jobs Scraper project.
Runs every enabled scraper, merges results, saves combined output.

Usage:
  python run_all.py                        # run all scrapers
  python run_all.py --all-available        # run every registered scraper, including full Profession
  python run_all.py --only minddiak        # run one scraper by name
  python run_all.py --only minddiak randstad profession
  python run_all.py --list                 # show available scrapers
  python run_all.py --test                 # dry-run: 5 jobs per scraper
  python run_all.py --only randstad --test # test a single scraper
  python run_all.py --since 2026-05-01     # keep only jobs posted on/after date
  python run_all.py --merge-only           # skip scraping, re-merge output/*.json

Output files (in ./output/):
  <source>_jobs.json   - per-source full JSON
  <source>_jobs.csv    - per-source CSV (Excel-ready, UTF-8 BOM)
  ALL_jobs.json        - merged deduplicated database
  ALL_jobs.csv         - merged CSV
"""

import sys
import os
import json
import glob
import datetime

sys.path.insert(0, os.path.dirname(__file__))

from scrapers.base import save_json, save_csv, SCHEMA_FIELDS

os.makedirs("output", exist_ok=True)

TEST_LIMIT = 5   # jobs per scraper when --test flag is used

DEFAULT_SKIP = {"profession_full"}


# ---------------------------------------------------------------------------
# Scraper registry
# ---------------------------------------------------------------------------

def _get_scrapers():
    registry = {}

    try:
        from scrapers.minddiak import scrape as md_scrape
        registry["minddiak"]               = lambda: md_scrape(site_type=20)
        registry["humancentrum"]           = lambda: md_scrape(site_type=10)
        registry["humancentrum_nyugdijas"] = lambda: md_scrape(site_type=30)
    except ImportError as e:
        print(f"[warn] minddiak/humancentrum scraper unavailable: {e}")

    try:
        from scrapers.profession import scrape_rss, scrape_full
        registry["profession"]      = scrape_rss
        registry["profession_full"] = scrape_full
    except ImportError as e:
        print(f"[warn] profession scraper unavailable: {e}")

    try:
        from scrapers.randstad import scrape as rs_scrape
        registry["randstad"] = rs_scrape
    except ImportError as e:
        print(f"[warn] randstad scraper unavailable: {e}")

    try:
        from scrapers.multijob import scrape as mj_scrape
        registry["multijob"] = mj_scrape
    except ImportError as e:
        print(f"[warn] multijob scraper unavailable: {e}")

    try:
        from scrapers.nofluffjobs import scrape as nfj_scrape
        registry["nofluffjobs"] = nfj_scrape
    except ImportError as e:
        print(f"[warn] nofluffjobs scraper unavailable: {e}")

    try:
        from scrapers.melodiak import scrape as mel_scrape
        registry["melodiak"] = mel_scrape
    except ImportError:
        pass   # not yet confirmed - silent skip

    try:
        from scrapers.jooble import scrape as jooble_scrape
        registry["jooble"] = jooble_scrape
    except ImportError:
        pass

    try:
        from scrapers.cvonline import scrape as cvo_scrape
        registry["cvonline"] = cvo_scrape
    except ImportError as e:
        print(f"[warn] cvonline scraper unavailable: {e}")

    try:
        from scrapers.jobs_hu import scrape as jhu_scrape
        registry["jobs_hu"] = jhu_scrape
    except ImportError as e:
        print(f"[warn] jobs_hu scraper unavailable: {e}")

    try:
        from scrapers.remoteok import scrape as rok_scrape
        registry["remoteok"] = rok_scrape
    except ImportError as e:
        print(f"[warn] remoteok scraper unavailable: {e}")

    try:
        from scrapers.remotive import scrape as remotive_scrape
        registry["remotive"] = remotive_scrape
    except ImportError as e:
        print(f"[warn] remotive scraper unavailable: {e}")

    try:
        from scrapers.huggingface_workable import scrape as hf_scrape
        registry["huggingface_workable"] = hf_scrape
    except ImportError as e:
        print(f"[warn] Hugging Face scraper unavailable: {e}")

    try:
        from scrapers.euraxess import scrape as euraxess_scrape
        registry["euraxess"] = euraxess_scrape
    except ImportError as e:
        print(f"[warn] EURAXESS scraper unavailable: {e}")

    try:
        from scrapers.arbeitnow import scrape as arbeitnow_scrape
        registry["arbeitnow"] = arbeitnow_scrape
    except ImportError as e:
        print(f"[warn] Arbeitnow scraper unavailable: {e}")

    try:
        from scrapers.hays import scrape as hays_scrape
        registry["hays"] = hays_scrape
    except ImportError as e:
        print(f"[warn] hays scraper unavailable: {e}")

    try:
        from scrapers.linkedin import scrape as linkedin_scrape
        registry["linkedin"] = linkedin_scrape
    except ImportError as e:
        print(f"[warn] linkedin scraper unavailable: {e}")

    try:
        from scrapers.indeed import scrape as indeed_scrape
        registry["indeed"] = indeed_scrape
    except ImportError as e:
        print(f"[warn] indeed scraper unavailable: {e}")

    try:
        from scrapers.indeed_playwright import scrape as indeed_playwright_scrape
        registry["indeed_playwright"] = indeed_playwright_scrape
    except ImportError as e:
        print(f"[warn] indeed_playwright scraper unavailable: {e}")

    # ── Worldwide ──────────────────────────────────────────────────────────
    try:
        from scrapers.weworkremotely import scrape as wwr_scrape
        registry["weworkremotely"] = wwr_scrape
    except ImportError as e:
        print(f"[warn] weworkremotely scraper unavailable: {e}")

    try:
        from scrapers.jobicy import scrape as jobicy_scrape
        registry["jobicy"] = jobicy_scrape
    except ImportError as e:
        print(f"[warn] jobicy scraper unavailable: {e}")

    try:
        from scrapers.himalayas import scrape as himalayas_scrape
        registry["himalayas"] = himalayas_scrape
    except ImportError as e:
        print(f"[warn] himalayas scraper unavailable: {e}")

    return registry


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def _parse_args(raw_args):
    """
    Parse CLI args into a config dict.
    Supported flags:
      --list                  print scraper names and exit
      --only <name> [<name>]  run only these scrapers
      --test                  cap each scraper to TEST_LIMIT jobs
      --since YYYY-MM-DD      keep only jobs posted on/after this date
      --merge-only            skip scraping; re-merge existing output files
      --all-available         include long exhaustive scrapers, not just daily-safe ones
    """
    cfg = {
        "list":       False,
        "only":       None,
        "test":       False,
        "since":      None,
        "merge_only": False,
        "all_available": False,
    }

    i = 0
    while i < len(raw_args):
        arg = raw_args[i]
        if arg == "--list":
            cfg["list"] = True
        elif arg == "--test":
            cfg["test"] = True
        elif arg == "--merge-only":
            cfg["merge_only"] = True
        elif arg == "--all-available":
            cfg["all_available"] = True
        elif arg == "--since":
            i += 1
            if i < len(raw_args):
                cfg["since"] = raw_args[i]
        elif arg == "--only":
            names = []
            i += 1
            while i < len(raw_args) and not raw_args[i].startswith("--"):
                names.append(raw_args[i])
                i += 1
            cfg["only"] = names
            continue
        i += 1
    return cfg


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_key(value):
    return " ".join(str(value or "").lower().replace("\u00a0", " ").split())


def _canonical_job_key(job):
    source = _norm_key(job.get("source", ""))
    job_id = _norm_key(job.get("job_id") or job.get("id") or "")
    if source and job_id:
        return ("id", source, job_id)

    url = _norm_key(str(job.get("url", "")).split("?", 1)[0])
    if url:
        return ("url", url)

    title = _norm_key(job.get("title", ""))
    company = _norm_key(job.get("company", ""))
    city = _norm_key(job.get("city") or job.get("location") or job.get("location_full") or job.get("country") or "")
    if title:
        return ("text", title, company, city or source)
    return None


def deduplicate(jobs):
    """Remove duplicates by stable id/url, then title + company + place."""
    seen, unique = set(), []
    for job in jobs:
        key = _canonical_job_key(job)
        if key and key not in seen:
            seen.add(key)
            unique.append(job)
    return unique


def _filter_since(jobs, since):
    """Keep jobs with date_posted >= since, or with no date (keep safe)."""
    out = []
    for j in jobs:
        d = str(j.get("date_posted", ""))[:10]
        if not d or d >= since:
            out.append(j)
    return out


def _merge_existing():
    """Load all *_jobs.json files from output/ and return combined list."""
    all_jobs = []
    files = sorted(glob.glob("output/*_jobs.json"))
    for fpath in files:
        if "ALL_jobs" in fpath:
            continue
        with open(fpath, encoding="utf-8") as f:
            data = json.load(f)
        print(f"  Loaded {len(data):>4} jobs  <-  {fpath}")
        all_jobs.extend(data)
    return all_jobs


def print_summary(all_jobs):
    import time
    from collections import Counter
    sources = Counter(j.get("source", "unknown") for j in all_jobs)
    print("\n" + "=" * 80)
    print(f"  TOTAL JOBS IN DATABASE: {len(all_jobs)}")
    print("=" * 80)
    print(f"  {'Source':<25} {'Jobs':>6}   {'Status':<10} {'Age (days)':>10}")
    print(f"  {'-'*25} {'-'*6}   {'-'*10} {'-'*10}")
    for src, count in sorted(sources.items(), key=lambda x: -x[1]):
        fpath = os.path.join("output", f"{src}_jobs.json")
        status = "OK"
        age_str = "N/A"
        if os.path.exists(fpath):
            mtime = os.path.getmtime(fpath)
            age_seconds = time.time() - mtime
            age_days = age_seconds / (24 * 3600)
            age_str = f"{age_days:.1f}"
            if age_seconds > 3 * 24 * 3600:
                status = "STALE"
        else:
            status = "MISSING"
        print(f"  {src:<25} {count:>6}   {status:<10} {age_str:>10}")
    print("=" * 80)


def main():
    cfg      = _parse_args(sys.argv[1:])
    scrapers = _get_scrapers()

    if cfg["list"]:
        print("Available scrapers:")
        for name in sorted(scrapers):
            print(f"  {name}")
        return

    if cfg["merge_only"]:
        print("=" * 60)
        print("  Hungary Jobs - merge-only mode")
        print("=" * 60)
        all_jobs = deduplicate(_merge_existing())
        if all_jobs:
            save_json(all_jobs, "output/ALL_jobs.json")
            save_csv(all_jobs,  "output/ALL_jobs.csv", fields=SCHEMA_FIELDS)
            print_summary(all_jobs)
        else:
            print("[!] No source files found in output/.")
        return

    if cfg["only"] is not None:
        to_run  = cfg["only"]
        unknown = [n for n in to_run if n not in scrapers]
        if unknown:
            print(f"Unknown scrapers: {unknown}")
            print(f"Available: {sorted(scrapers.keys())}")
            return
    else:
        skip = set() if cfg["all_available"] else DEFAULT_SKIP
        to_run = [n for n in scrapers if n not in skip]

    test_mode = cfg["test"]
    since     = cfg["since"]

    print("=" * 60)
    print(f"  Hungary Jobs Scraper  --  {datetime.date.today()}")
    if test_mode:
        print(f"  Mode : TEST  (first {TEST_LIMIT} jobs per scraper)")
    if since:
        print(f"  Since: {since}")
    if cfg["all_available"]:
        print("  Mode : ALL AVAILABLE SOURCES")
    print(f"  Running: {', '.join(to_run)}")
    print("=" * 60)

    all_jobs = []

    for name in to_run:
        fn = scrapers[name]
        try:
            jobs = fn()
        except Exception as exc:
            print(f"\n[ERROR] Scraper '{name}' failed: {exc}")
            import traceback
            traceback.print_exc()
            jobs = []

        if test_mode and jobs:
            jobs = jobs[:TEST_LIMIT]
            print(f"  [test] Capped to {len(jobs)} jobs")

        if since and jobs:
            before = len(jobs)
            jobs = _filter_since(jobs, since)
            print(f"  [since {since}] {before} -> {len(jobs)} jobs kept")

        if jobs and not test_mode:
            save_json(jobs, f"output/{name}_jobs.json")
            save_csv(jobs,  f"output/{name}_jobs.csv", fields=SCHEMA_FIELDS)
            all_jobs.extend(jobs)

    if test_mode:
        print("\n  Test mode leaves production output files unchanged.")
        return

    # Always rebuild the unified database from all per-source outputs. This keeps
    # `--only hays` or any other partial refresh from shrinking ALL_jobs.json.
    all_jobs = deduplicate(_merge_existing())

    if all_jobs:
        save_json(all_jobs, "output/ALL_jobs.json")
        save_csv(all_jobs,  "output/ALL_jobs.csv", fields=SCHEMA_FIELDS)
        print_summary(all_jobs)
    else:
        print("\n[!] No jobs collected.")


if __name__ == "__main__":
    main()
