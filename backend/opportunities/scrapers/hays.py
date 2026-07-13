"""
scrapers/hays.py
================
Method : TransferState Decrypt Bypass on SSR Page
Site   : https://www.hays.hu  (Hays Hungary – major international recruiter)

Description:
  Direct API calls to `mapi.hays.com` return 404 due to IP/Origin locking.
  Bypass: Programmatic HTTP requests to search pages (e.g., `https://www.hays.hu/allas-kereses?q=Python`)
  trigger a `301 Moved Permanently` to set cookies. Catching this `301 HTTPError` allows reading the
  response body of the redirect itself, which contains the complete SSR `TransferState` JSON block.
  Decrypt the encrypted `jobsv2` payload inside this script block using AES-256-CBC with the passphrase
  `"aDX5UzaKVndUKKfP"` and an evp-bytestokey routine to yield all matching job records.
"""

import base64
import json
import re
import ssl
import sys
import urllib.request
import urllib.parse
from hashlib import md5
from html import unescape
from Crypto.Cipher import AES

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from .base import (
    strip_html,
    save_json, save_csv,
    SCHEMA_FIELDS, polite_sleep,
)

PASSPHRASE = "aDX5UzaKVndUKKfP"
BASE = "https://www.hays.hu"

# ---------------------------------------------------------------------------
# Cryptography Helpers
# ---------------------------------------------------------------------------

def evp_bytestokey(password, salt, key_len, iv_len):
    """Derive key and IV from password and salt (OpenSSL EVP_BytesToKey)."""
    password = password.encode('utf-8')
    m = []
    i = 0
    while len(b''.join(m)) < (key_len + iv_len):
        data = password
        if i > 0:
            data = m[i-1] + password
        data += salt
        m.append(md5(data).digest())
        i += 1
    derived = b''.join(m)
    return derived[:key_len], derived[key_len:key_len+iv_len]

def decrypt_cryptojs(encrypted_b64, passphrase):
    """Decrypt CryptoJS AES-256-CBC encrypted data."""
    data = base64.b64decode(encrypted_b64)
    if not data.startswith(b'Salted__'):
        raise ValueError("Data does not start with Salted__")
    salt = data[8:16]
    ciphertext = data[16:]
    key, iv = evp_bytestokey(passphrase, salt, 32, 16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    decrypted = cipher.decrypt(ciphertext)
    padding_len = decrypted[-1]
    if padding_len < 1 or padding_len > 16:
        raise ValueError("Invalid PKCS7 padding")
    return decrypted[:-padding_len].decode('utf-8')

# ---------------------------------------------------------------------------
# Custom HTTP Redirect Handler
# ---------------------------------------------------------------------------

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """HTTP redirect handler that halts redirect and throws HTTPError 301."""
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        return None

# ---------------------------------------------------------------------------
# Normalization Helper
# ---------------------------------------------------------------------------

def _normalise_job(j) -> dict:
    """Map a raw decrypted Hays job record to the unified SCHEMA_FIELDS."""
    # Extract unique job ID
    job_id = ""
    filterable = j.get("filterableCustomFields", {})
    if "JobRef" in filterable:
        vals = filterable["JobRef"].get("values", [])
        if vals:
            job_id = str(vals[0])
    
    if not job_id:
        url = j.get("trackingUrl") or j.get("applicationUrl") or ""
        match = re.search(r'JOB_(\d+)', url)
        if match:
            job_id = match.group(1)
        else:
            name = j.get("name", "")
            if name and "/" in name:
                job_id = name.split("/")[-1]
            else:
                import uuid
                job_id = str(uuid.uuid4())[:8]

    title = j.get("title", "")
    company = j.get("companyTitle", "") or "Hays Hungary"
    if company == "hays-gcj-v4-pd-online":
        company = "Hays Hungary"
    
    city = j.get("location", "")
    
    locations = j.get("locations", [])
    location_full = locations[0] if locations else city
    
    # Salary min/max/currency
    sal_min = ""
    comp_min = j.get("compensationAmountMin") or {}
    if isinstance(comp_min, dict) and "units" in comp_min:
        sal_min = str(comp_min.get("units") or "")
        
    sal_max = ""
    comp_max = j.get("compensationAmountMax") or {}
    if isinstance(comp_max, dict) and "units" in comp_max:
        sal_max = str(comp_max.get("units") or "")
        
    sal_cur = "HUF"
    comp_amt = j.get("compensationAmount") or {}
    if isinstance(comp_amt, dict) and "currencyCode" in comp_amt:
        sal_cur = comp_amt.get("currencyCode") or "HUF"
        
    sal_per = "MONTH"
    
    # Employment Type
    emp_types = j.get("employmentTypes", [])
    emp_raw = emp_types[0] if emp_types else "FULL_TIME"
    _EMP_MAP = {
        "FULL_TIME": "FULL_TIME",
        "PART_TIME": "PART_TIME",
        "TEMPORARY": "TEMPORARY",
        "CONTRACT": "TEMPORARY",
        "INTERN": "INTERN",
        "FREELANCE": "FREELANCE",
    }
    emp_type = _EMP_MAP.get(emp_raw.upper(), "FULL_TIME")
    
    # Formatting dates: yyyy-MM-dd
    date_posted = ""
    c_date = j.get("createDate") or j.get("publishDate") or {}
    if isinstance(c_date, dict) and "year" in c_date and "month" in c_date and "day" in c_date:
        try:
            date_posted = f"{c_date['year']:04d}-{c_date['month']:02d}-{c_date['day']:02d}"
        except Exception:
            pass
            
    valid_through = ""
    exp_date = j.get("postingExpiryDate") or j.get("endDate") or {}
    if isinstance(exp_date, dict) and "year" in exp_date and "month" in exp_date and "day" in exp_date:
        try:
            valid_through = f"{exp_date['year']:04d}-{exp_date['month']:02d}-{exp_date['day']:02d}"
        except Exception:
            pass

    # Extract tags and category
    tags_list = []
    specialism = filterable.get("xSpecialism", {}).get("values", [])
    if specialism:
        tags_list.extend(specialism)
    industry = filterable.get("xIndustryId", {}).get("values", [])
    if industry:
        tags_list.extend(industry)
    dept = j.get("department", "")
    if dept:
        tags_list.append(dept)
    tags = "; ".join(filter(None, tags_list))
    
    category = dept or (specialism[0] if specialism else "")
    
    # Clean HTML descriptions
    description = strip_html(j.get("description", ""))
    requirements = strip_html(j.get("responsibilities", ""))
    
    url = j.get("trackingUrl") or j.get("applicationUrl") or j.get("jobRequisitionId") or ""
    
    return {
        "source":          "hays",
        "job_id":          job_id,
        "title":           title,
        "company":         company,
        "city":            city,
        "location_full":   location_full,
        "country":         "HU",
        "zip":             "",
        "salary_min":      sal_min,
        "salary_max":      sal_max,
        "salary_period":   sal_per,
        "salary_currency": sal_cur,
        "employment_type": emp_type,
        "date_posted":     date_posted,
        "valid_through":   valid_through,
        "tags":            tags,
        "category":        category,
        "description":     description,
        "requirements":    requirements,
        "what_we_offer":   "",
        "contact_name":    "",
        "contact_email":   "",
        "url":             url,
        "direct_apply":    "",
    }

# ---------------------------------------------------------------------------
# Scrape Single Keyword Helper
# ---------------------------------------------------------------------------

def _scrape_keyword(keyword: str, verbose: bool = True) -> list:
    """Queries Hays Hungary for a specific keyword and returns parsed jobs."""
    url = f"https://www.hays.hu/allas-kereses?q={urllib.parse.quote(keyword)}"
    if verbose:
        print(f"  [hays.hu] Querying keyword: '{keyword}' via URL: {url}")
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
    }
    
    # Create request and opener
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    https_handler = urllib.request.HTTPSHandler(context=ctx)
    opener = urllib.request.build_opener(NoRedirectHandler, https_handler)
    req = urllib.request.Request(url, headers=headers)
    
    html = ""
    try:
        with opener.open(req) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        if hasattr(e, "read"):
            html = e.read().decode("utf-8", errors="ignore")
        else:
            if verbose:
                print(f"  [hays.hu] Failed to query keyword '{keyword}': {e}")
            return []
            
    if not html:
        if verbose:
            print(f"  [hays.hu] Empty response body for keyword '{keyword}'")
        return []
        
    # Extract scripts
    script_blocks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)
    state_json_str = None
    for block in script_blocks:
        if "jobportalapi" in block and "U2FsdGVkX1" in block:
            state_json_str = block.strip()
            break
            
    if not state_json_str:
        if verbose:
            print(f"  [hays.hu] Could not find TransferState script tag for keyword '{keyword}'")
        return []
        
    try:
        state_json_str = unescape(state_json_str.replace("&q;", '"'))
        state_dict = json.loads(state_json_str)
    except Exception as e:
        if verbose:
            print(f"  [hays.hu] Failed to parse script JSON for keyword '{keyword}': {e}")
        return []
        
    jobs_found = []
    for key, val in state_dict.items():
        if "jobsv2" in key and len(val) > 5000:
            try:
                decrypted = decrypt_cryptojs(val, PASSPHRASE)
                js_data = json.loads(decrypted)
                result_val = js_data.get("data", {}).get("result", {})
                
                # Check for "jobs" key
                raw_jobs = result_val.get("jobs", [])
                if not raw_jobs and "jobList" in result_val:
                    raw_jobs = result_val["jobList"]
                    
                if raw_jobs:
                    for rj in raw_jobs:
                        jobs_found.append(_normalise_job(rj))
                        
                if verbose:
                    print(f"  [hays.hu] Decrypted TransferState successfully: {len(raw_jobs)} jobs found.")
            except Exception as e:
                if verbose:
                    print(f"  [hays.hu] Failed to decrypt/parse jobs payload for keyword '{keyword}': {e}")
                    
    return jobs_found

# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

def scrape(max_jobs: int = 0, verbose: bool = True) -> list:
    """
    Scrape Hays Hungary jobs by querying a list of core keywords.
    Deduplicates and merges jobs.
    
    Args:
        max_jobs: 0 = no limit; positive = cap at that many jobs.
        verbose:  Print progress to stdout.
        
    Returns:
        List of normalised job dicts matching SCHEMA_FIELDS.
    """
    if verbose:
        print("\n[hays.hu] Starting TransferState Scrape Bypass")
        
    keywords = ["", "Python", "AI", "developer", "writer", "research"]
    all_jobs = []
    seen_ids = set()
    
    for kw in keywords:
        kw_jobs = _scrape_keyword(kw, verbose=verbose)
        for job in kw_jobs:
            jid = job.get("job_id")
            if jid and jid not in seen_ids:
                seen_ids.add(jid)
                all_jobs.append(job)
                
        # Be polite between requests
        polite_sleep(1.0)
        
    if verbose:
        print(f"[hays.hu] Finished scraping. Found {len(all_jobs)} unique jobs across keywords.")
        
    if max_jobs and all_jobs:
        all_jobs = all_jobs[:max_jobs]
        
    return all_jobs

# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    os.makedirs("output", exist_ok=True)
    jobs = scrape()
    if jobs:
        save_json(jobs, "output/hays_jobs.json")
        save_csv(jobs,  "output/hays_jobs.csv", fields=SCHEMA_FIELDS)
        print(f"\nSaved {len(jobs)} jobs to output/hays_jobs.json and output/hays_jobs.csv")
    else:
        print("No jobs fetched. Check API availability.")
