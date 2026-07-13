import sys, os, json, datetime
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrapers.base import fetch, strip_html, save_json, save_csv, SCHEMA_FIELDS

API_URL  = "https://remoteok.com/remote-jobs.json"
BASE_URL = "https://remoteok.com"

# Only keep jobs that are relevant to Hungary/Europe or remote and skill-matching
RELEVANT_TAGS = {
    "ai","machine-learning","python","data","nlp","audio","music","creative",
    "writing","content","research","analyst","javascript","typescript","react",
    "node","backend","frontend","fullstack","developer","engineer","design",
    "ux","product","automation","remote","english","marketing","seo","video",
    "editor","copywriting","social-media","project-manager","operations",
    "support","customer-success","qa","testing","devops","cloud","aws",
    "go","rust","java","php","ruby","data-science","analytics","bi",
    "finance","accounting","recruiting","hr","legal","healthcare","education"
}

def _normalise(raw):
    tags_list = raw.get("tags") or []
    tag_str = "; ".join(tags_list)

    posted_epoch = raw.get("epoch", 0)
    date_posted = ""
    if posted_epoch:
        try:
            date_posted = datetime.datetime.fromtimestamp(int(posted_epoch)).strftime("%Y-%m-%d")
        except Exception:
            pass

    sal_min = str(raw.get("salary_min","") or "")
    sal_max = str(raw.get("salary_max","") or "")
    url_sfx = raw.get("url","") or raw.get("slug","")
    url = BASE_URL + url_sfx if url_sfx.startswith("/") else url_sfx

    return {
        "source":           "remoteok",
        "job_id":           str(raw.get("id","")),
        "title":            raw.get("position",""),
        "company":          raw.get("company",""),
        "city":             "Remote",
        "location_full":    "Remote / Worldwide",
        "country":          "REMOTE",
        "zip":              "",
        "salary_min":       sal_min,
        "salary_max":       sal_max,
        "salary_period":    "MONTH",
        "salary_currency":  "USD",
        "employment_type":  "FULL_TIME",
        "date_posted":      date_posted,
        "valid_through":    "",
        "tags":             tag_str,
        "category":         "; ".join(tags_list[:3]),
        "description":      strip_html(raw.get("description","")),
        "requirements":     "",
        "what_we_offer":    "",
        "contact_name":     "",
        "contact_email":    "",
        "url":              url,
        "direct_apply":     "",
        "remote":           "True",
    }

def scrape(verbose=True):
    if verbose:
        print("\n[remoteok.com] Fetching JSON feed...")

    raw_text = fetch(API_URL, extra_headers={
        "Accept": "application/json",
        "Referer": "https://remoteok.com/",
    })
    if not raw_text:
        print("  [!] Failed to fetch remoteok.com feed")
        return []

    try:
        data = json.loads(raw_text)
    except Exception as e:
        print("  [!] JSON parse error:", e)
        return []

    # First item is metadata, skip it
    postings = [r for r in data if isinstance(r, dict) and r.get("id")]
    if verbose:
        print("  Total postings:", len(postings))

    # Filter: keep only jobs with relevant tags
    relevant = []
    for p in postings:
        tags = set(t.lower().replace(" ","-") for t in (p.get("tags") or []))
        if tags & RELEVANT_TAGS:
            relevant.append(p)

    if verbose:
        print("  Relevant (skill-matched):", len(relevant))

    jobs = [_normalise(r) for r in relevant]
    if verbose:
        print("  Done:", len(jobs), "remoteok.com jobs.")
    return jobs

if __name__ == "__main__":
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    save_json(jobs, "output/remoteok_jobs.json")
    save_csv(jobs, "output/remoteok_jobs.csv", fields=SCHEMA_FIELDS)
