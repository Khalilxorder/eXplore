import sys, os, json, argparse, datetime
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from matcher.profile import load as load_profile
from matcher.filter import filter_jobs
from matcher.classifier import classify_all
from matcher.scorer import score_all

def _resolve(path):
    if os.path.isabs(path):
        return path
    # Prefer paths relative to this module (opportunities/), not the caller's CWD.
    candidate = os.path.join(ROOT, path)
    return candidate

def _load(p):
    with open(_resolve(p), encoding="utf-8") as f: return json.load(f)

def _save(data, path):
    full = _resolve(path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _sep(): print("=" * 64)

def _job_sort_key(job):
    category_priority = {"cat3": 0, "cat1": 1, "cat2": 2}
    return (
        -int(job.get("_score", 0)),
        category_priority.get(job.get("_category"), 3),
        str(job.get("source", "")),
        str(job.get("title", "")),
    )


def _diverse_top(cats, top_n, per_source_limit=3):
    ordered = sorted(
        [j for cat in ("cat3", "cat1", "cat2") for j in cats[cat]],
        key=_job_sort_key,
    )
    selected, deferred, counts = [], [], {}
    for job in ordered:
        source = str(job.get("source", "unknown"))
        score = int(job.get("_score", 0))
        # Never defer very high-fit jobs behind source diversity caps.
        if score < 70 and counts.get(source, 0) >= per_source_limit:
            deferred.append(job)
            continue
        selected.append(job)
        counts[source] = counts.get(source, 0) + 1
        if len(selected) >= top_n:
            return selected
    return (selected + deferred)[:top_n]


def _miss_nothing_pool(cats, min_score=50, hard_cap=250):
    """
    Full high-fit pool: every kept job at/above min_score, sorted by personal fit.
    Diversity caps are intentionally NOT applied — miss-nothing means miss nothing.
    """
    ordered = sorted(
        [j for cat in ("cat3", "cat1", "cat2") for j in cats[cat]],
        key=_job_sort_key,
    )
    high_fit = [j for j in ordered if int(j.get("_score", 0)) >= min_score]
    return high_fit[:hard_cap]

def _line(j, rank=None):
    s  = j.get("_score", 0)
    t  = str(j.get("title","?"))[:45]
    co = str(j.get("company",""))[:22]
    ci = str(j.get("city",""))[:14]
    sr = str(j.get("source",""))[:11]
    sl = (" | %s-%s %s" % (j["salary_min"],j.get("salary_max",""),j.get("salary_currency",""))) if j.get("salary_min") else ""
    bd = " | ".join("%s:%s"%(k,v) for k,v in list(j.get("_score_breakdown",{}).items())[:3])
    px = ("  #%-3s" % rank) if rank else "  "
    return "%s[%3d] %-45s | %-22s | %-14s | %-11s%s\n       %s" % (px,s,t,co,ci,sr,sl,bd)

def run(input_path="output/ALL_jobs.json", top_n=10):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    _sep(); print("  RANK PIPELINE  --  "+ts); _sep()
    load_profile()
    resolved_input = _resolve(input_path)
    if not os.path.exists(resolved_input):
        print("[!] Not found: "+resolved_input+"  run: python run_all.py"); return
    jobs = _load(resolved_input)
    print("  Loaded %d jobs" % len(jobs))
    kept, removed = filter_jobs(jobs)
    print("  Filter: kept %d, removed %d" % (len(kept), len(removed)))
    cats = classify_all(kept)
    print("  Classify: Cat1=%d  Cat2=%d  Cat3=%d" % (len(cats["cat1"]),len(cats["cat2"]),len(cats["cat3"])))
    for cat in ("cat1","cat2","cat3"):
        cats[cat] = score_all(cats[cat])
    top = _diverse_top(cats, top_n)
    miss_nothing = _miss_nothing_pool(cats, min_score=50, hard_cap=250)
    meta = {
        "_generated": ts,
        "_total": len(jobs),
        "_kept": len(kept),
        "_cat1": len(cats["cat1"]),
        "_cat2": len(cats["cat2"]),
        "_cat3": len(cats["cat3"]),
        "_miss_nothing": len(miss_nothing),
        "_miss_nothing_min_score": 50,
    }
    _save({**meta,"jobs":cats["cat1"]}, "ranked/cat1_fast.json")
    _save({**meta,"jobs":cats["cat2"]}, "ranked/cat2_longterm.json")
    _save({**meta,"jobs":cats["cat3"]}, "ranked/cat3_vision.json")
    _save({**meta,"jobs":top},          "ranked/top10.json")
    _save({**meta,"jobs":miss_nothing}, "ranked/miss_nothing.json")
    print(); _sep(); print("  TOP %d -- APPLY NOW" % top_n); _sep()
    for i,j in enumerate(top,1): print(_line(j,rank=i)); print()
    print(); _sep(); print("  TOP %d VISION [Cat3]" % top_n); _sep()
    for i,j in enumerate(cats["cat3"][:top_n],1): print(_line(j,rank=i)); print()
    print(); _sep(); print("  TOP %d FAST [Cat1]" % top_n); _sep()
    for i,j in enumerate(cats["cat1"][:top_n],1): print(_line(j,rank=i)); print()
    print("  cat1_fast.json=%d  cat2_longterm.json=%d  cat3_vision.json=%d  top10.json=%d  miss_nothing.json=%d" % (
        len(cats["cat1"]),len(cats["cat2"]),len(cats["cat3"]),len(top),len(miss_nothing)))
    return cats, top

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="output/ALL_jobs.json")
    ap.add_argument("--top", type=int, default=25)
    args = ap.parse_args()
    run(input_path=args.input, top_n=args.top)
