"""
scrapers/base.py
================
Shared utilities used by every scraper in this project.
- HTTP fetch (with retries, polite delay)
- JSON-LD JobPosting extractor
- HTML stripper
- JSON / CSV savers
- Unified job schema definition
"""

import re
import json
import csv
import time
import sys
import urllib.request
import urllib.error
import socket
from html import unescape

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Shared HTTP headers  (looks like a real browser visiting from Hungary)
# ---------------------------------------------------------------------------
BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DNS_FALLBACKS = {
    "minddiak.hu": "217.13.97.196",
    "www.minddiak.hu": "217.13.97.196",
    "humancentrum.hu": "217.13.97.196",
    "www.humancentrum.hu": "217.13.97.196",
    "admin.minddiak.hu": "217.13.97.196",
    "api.humancentrum.hu": "217.13.97.196",
}

_ORIGINAL_GETADDRINFO = socket.getaddrinfo


def _getaddrinfo_with_known_fallbacks(host, port, *args, **kwargs):
    try:
        return _ORIGINAL_GETADDRINFO(host, port, *args, **kwargs)
    except socket.gaierror:
        fallback_ip = DNS_FALLBACKS.get(str(host).lower())
        if not fallback_ip:
            raise
        return _ORIGINAL_GETADDRINFO(fallback_ip, port, *args, **kwargs)


socket.getaddrinfo = _getaddrinfo_with_known_fallbacks

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def fetch(url: str, retries: int = 3, delay: float = 0.4,
          extra_headers: dict = None, json_body: dict = None) -> str:
    """
    Fetch a URL and return the response body as a string.
    If json_body is provided, issues a POST with that JSON payload.
    Returns "" on failure.
    """
    import urllib.parse
    try:
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.quote(parts.path, safe="/%")
        query = urllib.parse.quote(parts.query, safe="=&%")
        netloc = parts.netloc
        try:
            netloc = netloc.encode('idna').decode('ascii')
        except Exception:
            pass
        url = urllib.parse.urlunsplit((parts.scheme, netloc, path, query, parts.fragment))
    except Exception as e:
        print(f"    [!] URL quoting failed for {url}: {e}")

    headers = dict(BASE_HEADERS)
    if extra_headers:
        headers.update(extra_headers)

    data = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers,
                                  method="POST" if data else "GET")
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                for enc in ("utf-8", "iso-8859-2", "cp1250"):
                    try:
                        return raw.decode(enc)
                    except UnicodeDecodeError:
                        continue
                return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503) and attempt < retries:
                time.sleep(4 * attempt)
            elif attempt == retries:
                print(f"    [!] HTTP {e.code} on {url}")
            else:
                time.sleep(2 * attempt)
        except Exception as exc:
            if attempt < retries:
                time.sleep(2 * attempt)
            else:
                print(f"    [!] Failed {url}: {exc}")
    return ""


def fetch_json(url: str, retries: int = 3,
               extra_headers: dict = None, json_body: dict = None):
    """Fetch a URL and parse the response as JSON. Returns None on failure."""
    text = fetch(url, retries=retries, extra_headers=extra_headers,
                 json_body=json_body)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# JSON-LD extractor  (works on any page with schema.org JobPosting)
# ---------------------------------------------------------------------------

_LD_JSON_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.S | re.I,
)


def extract_job_posting_ld(html: str) -> dict:
    """
    Find and return the first JobPosting JSON-LD block in an HTML page.
    Returns {} if none found.
    """
    for block in _LD_JSON_RE.findall(html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("@type") == "JobPosting":
            return data
        # Sometimes it's wrapped in @graph array
        if isinstance(data, dict) and "@graph" in data:
            for item in data["@graph"]:
                if isinstance(item, dict) and item.get("@type") == "JobPosting":
                    return item
    return {}


# ---------------------------------------------------------------------------
# XML sitemap parser
# ---------------------------------------------------------------------------

def parse_sitemap_urls(xml: str) -> list:
    """
    Extract all <loc> URLs from a sitemap XML string.
    Also handles sitemap index files (list of sitemap URLs).
    Returns (urls_list, is_index) where is_index=True means these are
    sub-sitemap URLs rather than page URLs.
    """
    locs = re.findall(r"<loc>(.*?)</loc>", xml, re.S)
    locs = [l.strip() for l in locs]
    # Detect sitemap index (contains .xml links)
    is_index = bool(locs) and all(l.endswith(".xml") for l in locs[:5])
    return locs, is_index


# ---------------------------------------------------------------------------
# RSS / Atom feed parser
# ---------------------------------------------------------------------------

def parse_rss_items(xml: str) -> list:
    """
    Parse an RSS 2.0 feed and return a list of dicts with:
    title, link, pubDate, description
    """
    items = []
    for item_xml in re.findall(r"<item>(.*?)</item>", xml, re.S | re.I):
        def get(tag):
            m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", item_xml, re.S | re.I)
            return unescape(m.group(1).strip()) if m else ""
        items.append({
            "title":       get("title"),
            "link":        get("link"),
            "pub_date":    get("pubDate"),
            "description": get("description"),
        })
    return items


# ---------------------------------------------------------------------------
# HTML text cleaner
# ---------------------------------------------------------------------------

def strip_html(html_str: str) -> str:
    """Remove HTML tags, decode entities, collapse whitespace."""
    if not html_str:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(html_str))
    text = unescape(text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Unified output schema
# ---------------------------------------------------------------------------
# Every scraper MUST produce dicts with at least these keys.
# Extra keys are welcome but will be stripped from CSV output.

SCHEMA_FIELDS = [
    "source",           # which scraper produced this record
    "job_id",           # unique ID on source site
    "title",            # job title
    "company",          # employer name
    "city",             # city / district
    "location_full",    # full address or region string
    "country",          # ISO-2 country code (always HU for this project)
    "zip",              # postal code if known
    "salary_min",       # numeric minimum salary (HUF, per hour or per month)
    "salary_max",       # numeric maximum salary
    "salary_period",    # HOUR / MONTH / YEAR
    "salary_currency",  # HUF / EUR
    "employment_type",  # FULL_TIME / PART_TIME / TEMPORARY / INTERN / FREELANCE
    "date_posted",      # ISO date string YYYY-MM-DD
    "valid_through",    # ISO date string YYYY-MM-DD (expiry)
    "tags",             # semicolon-separated tag / category strings
    "category",         # primary job category
    "description",      # plain-text full description
    "requirements",     # plain-text requirements
    "what_we_offer",    # plain-text benefits / offer
    "contact_name",     # recruiter / contact person
    "contact_email",    # contact email
    "url",              # canonical job URL
    "direct_apply",     # True/False
    "remote",           # True/False/empty — explicitly remote-eligible
]


# ---------------------------------------------------------------------------
# Save helpers
# ---------------------------------------------------------------------------

def save_json(jobs: list, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(jobs, f, ensure_ascii=False, indent=2)
    print(f"  Saved {len(jobs)} jobs -> {path}")


def save_csv(jobs: list, path: str, fields: list = None) -> None:
    if fields is None:
        fields = SCHEMA_FIELDS
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(jobs)
    print(f"  Saved {len(jobs)} jobs -> {path}")


def polite_sleep(seconds: float = 0.4) -> None:
    """Sleep to be polite to servers."""
    time.sleep(seconds)


# ---------------------------------------------------------------------------
# Convenience aliases & helpers used by all scrapers
# ---------------------------------------------------------------------------

import datetime
import os

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def now_iso() -> str:
    """Current timestamp as ISO-8601 string."""
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def empty_job() -> dict:
    """Return a blank job record with all SCHEMA_FIELDS set to empty string."""
    return {f: "" for f in SCHEMA_FIELDS}


def save_both(jobs: list, stem: str) -> None:
    """Save jobs to both JSON and CSV in the output/ folder.
    stem = base filename without extension, e.g. 'minddiak_jobs'"""
    save_json(jobs, os.path.join(OUTPUT_DIR, f"{stem}.json"))
    save_csv(jobs,  os.path.join(OUTPUT_DIR, f"{stem}.csv"))


# Aliases for consistent naming across scrapers
def parse_sitemap(xml: str) -> list:
    """
    Alias for parse_sitemap_urls that returns list of dicts {url, lastmod}.
    Handles both sitemap index files and regular URL sitemaps.
    """
    locs, is_index = parse_sitemap_urls(xml)
    entries = []
    # Extract lastmod alongside each loc
    url_blocks = re.findall(r"<url>(.*?)</url>", xml, re.S)
    if url_blocks:
        for block in url_blocks:
            loc_m = re.search(r"<loc>(.*?)</loc>", block)
            mod_m = re.search(r"<lastmod>(.*?)</lastmod>", block)
            if loc_m:
                entries.append({
                    "url":     loc_m.group(1).strip(),
                    "lastmod": mod_m.group(1).strip() if mod_m else "",
                })
    else:
        # sitemap index — no <url> blocks, just <loc>
        for loc in locs:
            entries.append({"url": loc, "lastmod": ""})
    return entries


def extract_jsonld(html: str, target_type: str = "JobPosting") -> dict:
    """Alias for extract_job_posting_ld supporting any target @type."""
    if target_type == "JobPosting":
        return extract_job_posting_ld(html)
    for block in _LD_JSON_RE.findall(html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict) and item.get("@type") == target_type:
                return item
    return {}
