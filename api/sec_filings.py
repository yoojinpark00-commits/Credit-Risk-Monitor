"""
SEC Filing Alerts API — Vercel Serverless Function
Fetches recent SEC filings (8-K, S-3, Form 4, 13D/G, 10-K, 10-Q) from EDGAR.
Uses EDGAR Full-Text Search System (EFTS) and company filing APIs.
Free, 10 req/sec limit — only needs User-Agent header.

GET /api/sec_filings?ticker=LCID&days=30
GET /api/sec_filings?all=true&days=14
"""
import json
import os
import pathlib
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass

# CIK mapping loaded from canonical data/cik_map.json (single source of truth
# shared with scripts/credit_data_fetcher.py and scripts/fetch-edgar.mjs).
# Falls back to an empty dict if the file is missing so the dynamic
# ticker_to_cik resolver still works.
_CIK_MAP_PATH = pathlib.Path(__file__).parent.parent / "data" / "cik_map.json"
try:
    CIK_MAP = json.loads(_CIK_MAP_PATH.read_text())
except (FileNotFoundError, json.JSONDecodeError):
    CIK_MAP = {}

# Module-level cache for dynamically resolved CIKs
_cik_cache = {}

# Filing types we care about and their credit significance
FILING_TYPES = {
    "8-K":   {"severity": "material",  "label": "Material Event",           "desc": "Current report — could signal M&A, executive changes, covenant breach, credit agreement amendments"},
    "8-K/A": {"severity": "notable",   "label": "Amended Material Event",   "desc": "Amendment to prior 8-K"},
    "S-3":   {"severity": "material",  "label": "Shelf Registration",       "desc": "Potential equity/debt offering — watch for dilution or refinancing"},
    "S-1":   {"severity": "material",  "label": "Registration Statement",   "desc": "New securities registration"},
    "4":     {"severity": "notable",   "label": "Insider Transaction",      "desc": "Officer/director buy or sell — sentiment indicator"},
    "SC 13D": {"severity": "critical", "label": "Activist/Large Stake",     "desc": "5%+ ownership with intent to influence — potential restructuring catalyst"},
    "SC 13G": {"severity": "notable",  "label": "Passive Large Stake",      "desc": "5%+ passive ownership change"},
    "10-K":  {"severity": "routine",   "label": "Annual Report",            "desc": "Full-year financials — update models"},
    "10-K/A": {"severity": "notable",  "label": "Amended Annual Report",    "desc": "Restatement risk — review changes"},
    "10-Q":  {"severity": "routine",   "label": "Quarterly Report",         "desc": "Quarterly financials — update models"},
    "10-Q/A": {"severity": "notable",  "label": "Amended Quarterly Report", "desc": "Restatement risk — review changes"},
    "13F-HR": {"severity": "routine",  "label": "Institutional Holdings",   "desc": "Quarterly institutional ownership changes"},
    "DEF 14A": {"severity": "routine", "label": "Proxy Statement",          "desc": "Annual meeting — compensation, governance"},
    "424B2": {"severity": "material",  "label": "Prospectus Supplement",    "desc": "Pricing of new offering — dilution or refinancing event"},
    "FWP":   {"severity": "notable",   "label": "Free Writing Prospectus",  "desc": "Marketing material for new offering"},
    "6-K":   {"severity": "routine",   "label": "Foreign Issuer Report",    "desc": "Foreign private issuer current report"},
    "SD":    {"severity": "routine",   "label": "Specialized Disclosure",   "desc": "Conflict minerals or other specialized disclosure"},
}

USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "CreditRiskMonitor/1.0 (creditrisk@monitor.app)")

def ticker_to_cik(ticker):
    """Resolve a ticker to a 10-digit zero-padded CIK via EDGAR company_tickers.json.
    Falls back to the hardcoded CIK_MAP first for speed, then hits EDGAR dynamically.
    Returns None if the ticker cannot be resolved.
    """
    ticker = ticker.upper()
    if ticker in CIK_MAP:
        return CIK_MAP[ticker]
    if ticker in _cik_cache:
        return _cik_cache[ticker]
    data = fetch_edgar("https://www.sec.gov/files/company_tickers.json")
    if "error" in data:
        return None
    for entry in data.values():
        t = entry["ticker"].upper()
        c = str(entry["cik_str"]).zfill(10)
        _cik_cache[t] = c
    return _cik_cache.get(ticker)

def fetch_edgar(url):
    """Fetch from EDGAR with proper headers."""
    req = urllib.request.Request(url)
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def get_filings_for_cik(cik, ticker, days=30):
    """Fetch recent filings for a specific CIK from EDGAR."""
    # Use EDGAR company submissions API
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    data = fetch_edgar(url)
    if "error" in data:
        return []

    filings = []
    cutoff = datetime.now() - timedelta(days=days)

    # Recent filings are in data["filings"]["recent"]
    recent = data.get("filings", {}).get("recent", {})
    if not recent:
        return []

    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])
    descriptions = recent.get("primaryDocDescription", [])

    for i in range(min(len(forms), len(dates), 100)):  # Cap at 100
        try:
            filing_date = datetime.strptime(dates[i], "%Y-%m-%d")
        except (ValueError, IndexError):
            continue

        if filing_date < cutoff:
            continue

        form_type = forms[i]
        # Check if this is a filing type we track
        type_info = FILING_TYPES.get(form_type)
        if not type_info:
            # Check partial matches (e.g., "8-K" matches "8-K/A")
            for ft_key, ft_val in FILING_TYPES.items():
                if form_type.startswith(ft_key) or ft_key.startswith(form_type):
                    type_info = ft_val
                    break
        if not type_info:
            continue

        acc_clean = accessions[i].replace("-", "")
        edgar_url = f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{acc_clean}/{primary_docs[i] if i < len(primary_docs) else ''}"
        filing_index_url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form_type}&dateb=&owner=include&count=10"

        filings.append({
            "ticker": ticker,
            "form": form_type,
            "date": dates[i],
            "label": type_info["label"],
            "severity": type_info["severity"],
            "desc": type_info["desc"],
            "description": descriptions[i] if i < len(descriptions) else "",
            "url": edgar_url,
            "accession": accessions[i],
        })

    return filings

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        days = int(params.get("days", ["30"])[0])
        ticker = params.get("ticker", [None])[0]
        fetch_all = params.get("all", ["false"])[0].lower() == "true"

        results = []

        if ticker:
            t = ticker.upper()
            cik = ticker_to_cik(t)
            if cik:
                results = get_filings_for_cik(cik, t, days)
        elif fetch_all:
            for t, cik in CIK_MAP.items():
                filings = get_filings_for_cik(cik, t, days)
                results.extend(filings)

        # Sort by date descending, then by severity
        severity_order = {"critical": 0, "material": 1, "notable": 2, "routine": 3}
        results.sort(key=lambda x: (-datetime.strptime(x["date"], "%Y-%m-%d").timestamp(), severity_order.get(x["severity"], 9)))

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=3600")  # Cache 1 hour
        self.end_headers()
        self.wfile.write(json.dumps({
            "filings": results,
            "count": len(results),
            "days": days,
            "generated": datetime.now().isoformat(),
        }).encode())
