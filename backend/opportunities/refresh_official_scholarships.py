"""
refresh_official_scholarships.py
================================
Lightweight official-source scholarship refresh for eXplore.

This does not pretend that every official portal has a perfect parser. It keeps
two levels of evidence distinct:
  - official_portal rows prove that a priority official portal was checked
  - scholarship rows prove that an application-ready listing was discovered
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


DB_PATH = os.path.join(os.path.dirname(__file__), "scholarships.db")

OFFICIAL_SOURCES = [
    {
        "id": "daad",
        "label": "DAAD Germany scholarship database",
        "url": "https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/",
        "domain": "daad.de",
        "fit": ["Germany", "graduate", "research", "fully funded"],
    },
    {
        "id": "fulbright",
        "label": "Fulbright foreign student program",
        "url": "https://foreign.fulbrightonline.org/",
        "domain": "fulbrightonline.org",
        "fit": ["United States", "graduate", "research"],
    },
    {
        "id": "fulbright_hungary",
        "label": "Fulbright Hungary",
        "url": "https://fulbright.hu/",
        "domain": "fulbright.hu",
        "fit": ["Hungary", "United States", "graduate", "research"],
    },
    {
        "id": "erasmus_mundus",
        "label": "Erasmus Mundus catalogue",
        "url": "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en",
        "domain": "eacea.ec.europa.eu",
        "fit": ["Europe", "masters", "fully funded"],
    },
    {
        "id": "maeci",
        "label": "Italy MAECI grants",
        "url": "https://studyinitaly.esteri.it/ListaBandi",
        "domain": "studyinitaly.esteri.it",
        "fit": ["Italy", "graduate", "research"],
    },
    {
        "id": "campus_france",
        "label": "Campus France scholarship catalogue",
        "url": "https://www.campusfrance.org/en/bursaries-foreign-students",
        "domain": "campusfrance.org",
        "fit": ["France", "masters", "research"],
    },
    {
        "id": "chevening",
        "label": "Chevening scholarships",
        "url": "https://www.chevening.org/scholarships/",
        "domain": "chevening.org",
        "fit": ["United Kingdom", "masters", "fully funded"],
    },
    {
        "id": "commonwealth",
        "label": "Commonwealth scholarships",
        "url": "https://cscuk.fcdo.gov.uk/scholarships/",
        "domain": "cscuk.fcdo.gov.uk",
        "fit": ["United Kingdom", "masters", "phd", "fully funded"],
    },
    {
        "id": "gates_cambridge",
        "label": "Gates Cambridge",
        "url": "https://www.gatescambridge.org/",
        "domain": "gatescambridge.org",
        "fit": ["United Kingdom", "graduate", "fully funded"],
    },
    {
        "id": "study_in_sweden",
        "label": "Study in Sweden scholarships",
        "url": "https://studyinsweden.se/scholarships/",
        "domain": "studyinsweden.se",
        "fit": ["Sweden", "masters"],
    },
    {
        "id": "study_in_nl",
        "label": "Study in NL scholarships",
        "url": "https://www.studyinnl.org/finances",
        "domain": "studyinnl.org",
        "fit": ["Netherlands", "masters"],
    },
    {
        "id": "pannonia",
        "label": "Pannonia scholarship programme",
        "url": "https://pannoniaosztondij.hu/about-the-pannonia-scholarship-programme",
        "domain": "pannoniaosztondij.hu",
        "fit": ["Hungary", "student mobility", "Europe", "international"],
    },
    {
        "id": "erasmus_plus",
        "label": "Erasmus+ student mobility",
        "url": "https://erasmus-plus.ec.europa.eu/opportunities/individuals/students/studying-abroad",
        "domain": "erasmus-plus.ec.europa.eu",
        "fit": ["Hungary", "student mobility", "Europe"],
    },
    {
        "id": "ceepus",
        "label": "CEEPUS student mobility",
        "url": "https://en.tka.hu/central_european_exchange_programme_for_university_studies",
        "domain": "tka.hu",
        "fit": ["Hungary", "student mobility", "Central Europe"],
    },
    {
        "id": "tka_bilateral",
        "label": "TKA bilateral state scholarships",
        "url": "https://tka.hu/international-programmes/4127/bilateral-state-scholarships",
        "domain": "tka.hu",
        "fit": ["Hungary", "student mobility", "international"],
    },
    {
        "id": "stipendium_hungaricum",
        "label": "Stipendium Hungaricum",
        "url": "https://stipendiumhungaricum.hu/apply/",
        "domain": "stipendiumhungaricum.hu",
        "fit": ["Hungary", "international", "fully funded"],
    },
]

LISTING_TERMS = re.compile(
    r"\b(scholarship|fellowship|grant|bursary|studentship|mobility|exchange|"
    r"erasmus|daad|fulbright|chevening|application|apply|call|programme|program)\b",
    re.I,
)
NOISE_TERMS = re.compile(
    r"\b(cookie|privacy|terms|contact|login|sign in|newsletter|facebook|instagram|"
    r"youtube|linkedin|accessibility|sitemap|press|media|staff)\b",
    re.I,
)
YEAR_SIGNAL = re.compile(r"\b20(?:2[6-9]|3[0-5])\b")


@dataclass
class Link:
    url: str
    text: str


class LinkParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.links: list[Link] = []
        self.title = ""
        self._in_anchor = False
        self._in_title = False
        self._href = ""
        self._buffer: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag.lower() == "a" and attrs_dict.get("href"):
            self._in_anchor = True
            self._href = urllib.parse.urljoin(self.base_url, attrs_dict["href"])
            self._buffer = []
        elif tag.lower() == "title":
            self._in_title = True
            self._buffer = []

    def handle_data(self, data):
        if self._in_anchor or self._in_title:
            self._buffer.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._in_anchor:
            text = normalize_space(" ".join(self._buffer))
            if text:
                self.links.append(Link(url=self._href, text=text))
            self._in_anchor = False
            self._href = ""
            self._buffer = []
        elif tag.lower() == "title" and self._in_title:
            self.title = normalize_space(" ".join(self._buffer))
            self._in_title = False
            self._buffer = []


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def stable_id(*parts: str) -> str:
    return hashlib.sha256("||".join(parts).encode("utf-8")).hexdigest()[:24]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_url(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "eXplore scholarship source monitor/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        raw = response.read(2_000_000)
    for encoding in ("utf-8", "iso-8859-1", "cp1250"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_links(source_url: str, html_text: str) -> tuple[str, list[Link]]:
    parser = LinkParser(source_url)
    parser.feed(html_text or "")
    return parser.title, parser.links


def is_candidate_link(source: dict, link: Link) -> bool:
    parsed = urllib.parse.urlparse(link.url)
    if parsed.scheme not in ("http", "https"):
        return False
    if parsed.netloc and source["domain"] not in parsed.netloc:
        # Keep official subdomains, but avoid social networks and unrelated redirects.
        source_host = urllib.parse.urlparse(source["url"]).netloc.replace("www.", "")
        link_host = parsed.netloc.replace("www.", "")
        if source_host not in link_host and link_host not in source_host:
            return False

    text = normalize_space(f"{link.text} {link.url}")
    if not text or NOISE_TERMS.search(text):
        return False
    return bool(LISTING_TERMS.search(text) or YEAR_SIGNAL.search(text))


def record_hash(source_id: str, url: str, kind: str) -> str:
    return stable_id("official-scholarship", source_id, kind, url)


def json_array(values) -> str:
    return json.dumps(list(values or []), ensure_ascii=False)


def build_portal_record(source: dict, scraped_at: str, page_title: str, status_note: str, fetch_ok: bool = True) -> dict:
    title = f"Official portal: {source['label']}"
    description = (
        f"{source['label']} is a priority official scholarship source for this profile. "
        f"Last checked by eXplore at {scraped_at}. {status_note}".strip()
    )
    return {
        "id": record_hash(source["id"], source["url"], "portal"),
        "hash": record_hash(source["id"], source["url"], "portal"),
        "title": title,
        "description": description,
        "source_url": source["url"],
        "apply_url": source["url"],
        "source_site": source["domain"],
        "provider": source["label"],
        "ingestion_layer": 4,
        "ingestion_source_id": source["id"],
        "deadline": "",
        "deadline_raw": "",
        "is_rolling": 1,
        "is_expired": 0,
        "amount_description": "Official portal",
        "amount_usd_min": None,
        "amount_usd_max": None,
        "is_fully_funded": int("fully funded" in " ".join(source.get("fit", [])).lower()),
        "levels": json_array(source.get("fit", [])),
        "fields_of_study": json_array(["AI", "psychology", "research", "creative work"]),
        "host_countries": json_array(source.get("fit", [])),
        "eligible_countries": json_array([]),
        "eligible_regions": json_array([]),
        "opportunity_type": "official_portal",
        "tags": json_array(["official", "portal", *source.get("fit", [])]),
        "published_at": "",
        "scraped_at": scraped_at,
        "updated_at": scraped_at,
        "is_active": int(fetch_ok),
        "is_verified": int(fetch_ok),
        "raw_content": page_title or source["label"],
    }


def build_listing_record(source: dict, link: Link, scraped_at: str) -> dict:
    title = normalize_space(link.text)[:240] or source["label"]
    description = (
        f"Official listing discovered from {source['label']}. "
        f"Profile relevance: {', '.join(source.get('fit', []))}."
    )
    return {
        "id": record_hash(source["id"], link.url, "listing"),
        "hash": record_hash(source["id"], link.url, "listing"),
        "title": title,
        "description": description,
        "source_url": source["url"],
        "apply_url": link.url,
        "source_site": source["domain"],
        "provider": source["label"],
        "ingestion_layer": 4,
        "ingestion_source_id": source["id"],
        "deadline": "",
        "deadline_raw": "",
        "is_rolling": 1,
        "is_expired": 0,
        "amount_description": "",
        "amount_usd_min": None,
        "amount_usd_max": None,
        "is_fully_funded": int("fully funded" in " ".join(source.get("fit", [])).lower()),
        "levels": json_array(source.get("fit", [])),
        "fields_of_study": json_array(["AI", "psychology", "research", "creative work"]),
        "host_countries": json_array(source.get("fit", [])),
        "eligible_countries": json_array([]),
        "eligible_regions": json_array([]),
        "opportunity_type": "scholarship",
        "tags": json_array(["official", *source.get("fit", [])]),
        "published_at": "",
        "scraped_at": scraped_at,
        "updated_at": scraped_at,
        "is_active": 1,
        "is_verified": 1,
        "raw_content": link.url,
    }


def ensure_schema(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS scholarships (
          id TEXT PRIMARY KEY,
          hash TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          source_url TEXT,
          apply_url TEXT,
          source_site TEXT,
          provider TEXT,
          ingestion_layer INTEGER,
          ingestion_source_id TEXT,
          deadline TEXT,
          deadline_raw TEXT,
          is_rolling INTEGER DEFAULT 0,
          is_expired INTEGER DEFAULT 0,
          amount_description TEXT,
          amount_usd_min REAL,
          amount_usd_max REAL,
          is_fully_funded INTEGER DEFAULT 0,
          levels TEXT,
          fields_of_study TEXT,
          host_countries TEXT,
          eligible_countries TEXT,
          eligible_regions TEXT,
          opportunity_type TEXT DEFAULT 'scholarship',
          tags TEXT,
          published_at TEXT,
          scraped_at TEXT,
          updated_at TEXT,
          is_active INTEGER DEFAULT 1,
          is_verified INTEGER DEFAULT 0,
          raw_content TEXT
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_source ON scholarships(source_site)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_active ON scholarships(is_active)")


def upsert_record(db: sqlite3.Connection, row: dict) -> None:
    columns = list(row.keys())
    placeholders = ", ".join("?" for _ in columns)
    assignments = ", ".join(
        f"{column}=excluded.{column}"
        for column in columns
        if column not in ("id", "hash")
    )
    db.execute(
        f"""
        INSERT INTO scholarships ({", ".join(columns)})
        VALUES ({placeholders})
        ON CONFLICT(hash) DO UPDATE SET {assignments}
        """,
        [row[column] for column in columns],
    )


def refresh_sources(
    db_path: str,
    sources: list[dict],
    fetcher=fetch_url,
    max_links_per_source: int = 24,
    dry_run: bool = False,
) -> dict:
    scraped_at = now_iso()
    rows: list[dict] = []
    source_results = []
    active_hashes_by_source: dict[str, set[str]] = {}

    for source in sources:
        page_title = ""
        status_note = "Portal fetch failed; keep this official source visible for manual checking."
        candidates: list[Link] = []
        fetch_ok = False
        try:
            html_text = fetcher(source["url"])
            fetch_ok = True
            page_title, links = parse_links(source["url"], html_text)
            candidates = [link for link in links if is_candidate_link(source, link)]
            deduped = {}
            for link in candidates:
                deduped.setdefault(link.url, link)
            candidates = list(deduped.values())[:max_links_per_source]
            status_note = f"Found {len(candidates)} candidate official listing links."
        except Exception as exc:
            status_note = f"Fetch error: {exc}"

        rows.append(build_portal_record(source, scraped_at, page_title, status_note, fetch_ok=fetch_ok))
        rows.extend(build_listing_record(source, link, scraped_at) for link in candidates)
        if fetch_ok:
            active_hashes_by_source[source["id"]] = {
                row["hash"]
                for row in rows
                if row.get("ingestion_source_id") == source["id"]
            }
        source_results.append({
            "id": source["id"],
            "label": source["label"],
            "candidate_links": len(candidates),
            "status": status_note,
        })

    if not dry_run:
        db = sqlite3.connect(db_path)
        try:
            ensure_schema(db)
            with db:
                for row in rows:
                    upsert_record(db, row)
                for source_id, active_hashes in active_hashes_by_source.items():
                    placeholders = ", ".join("?" for _ in active_hashes)
                    params = [scraped_at, source_id, *active_hashes]
                    db.execute(
                        f"""
                        UPDATE scholarships
                        SET is_active = 0, updated_at = ?
                        WHERE ingestion_layer = 4
                          AND ingestion_source_id = ?
                          AND hash NOT IN ({placeholders})
                        """,
                        params,
                    )
        finally:
            db.close()

    return {
        "checked_at": scraped_at,
        "db_path": db_path,
        "dry_run": dry_run,
        "sources_checked": len(sources),
        "records_ready": len(rows),
        "candidate_listings": sum(result["candidate_links"] for result in source_results),
        "sources": source_results,
    }


def select_sources(source_ids: list[str]) -> list[dict]:
    if not source_ids:
        return OFFICIAL_SOURCES
    wanted = {source_id.strip() for source_id in source_ids if source_id.strip()}
    return [source for source in OFFICIAL_SOURCES if source["id"] in wanted]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--source", action="append", default=[])
    parser.add_argument("--max-links", type=int, default=24)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sources = select_sources(args.source)
    if not sources:
        print("No matching official scholarship sources.")
        return 2

    result = refresh_sources(
        db_path=args.db,
        sources=sources,
        max_links_per_source=max(0, args.max_links),
        dry_run=args.dry_run,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
