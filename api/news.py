"""
News Headlines API — Vercel Serverless Function
Fetches recent news headlines from Google News RSS for portfolio companies.
Free, no API key needed.

GET /api/news?ticker=LCID
GET /api/news?all=true
"""
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass

# Search terms for each company (company name + ticker for relevance)
COMPANY_SEARCH = {
    "LCID": {"name": "Lucid Group",           "queries": ["Lucid Group LCID", "Lucid Motors"]},
    "RIVN": {"name": "Rivian Automotive",      "queries": ["Rivian Automotive RIVN", "Rivian"]},
    "CENT": {"name": "Central Garden & Pet",   "queries": ["Central Garden Pet CENT"]},
    "IHRT": {"name": "iHeartMedia",            "queries": ["iHeartMedia IHRT"]},
    "SMC":  {"name": "Summit Midstream",       "queries": ["Summit Midstream SMC"]},
    "UPBD": {"name": "Upbound Group",          "queries": ["Upbound Group UPBD", "Rent-A-Center Acima"]},
    "WSC":  {"name": "WillScot Holdings",      "queries": ["WillScot Mobile Mini WSC"]},
    "BEUSA": {"name": "Beusa Energy",          "queries": ["Beusa Energy electric frac"]},
    "JSWUSA": {"name": "JSW Steel USA",        "queries": ["JSW Steel USA", "JSW Steel Ohio"]},
    "GT":   {"name": "Goodyear Tire & Rubber", "queries": ['"Goodyear Tire" earnings', '"Goodyear Rubber" stock', "Goodyear NASDAQ GT"]},
    "VSCO": {"name": "Victoria's Secret",      "queries": ['"Victoria\'s Secret" earnings', '"VS&Co" stock', "VSCO Victoria Secret"]},
    "URI":  {"name": "United Rentals",         "queries": ['"United Rentals" earnings', '"United Rentals" NYSE', "URI equipment rental"]},
    "CLF":  {"name": "Cleveland-Cliffs",       "queries": ['"Cleveland-Cliffs" earnings', '"Cleveland Cliffs" steel', "CLF NYSE steel"]},
    "HLMN": {"name": "Hillman Solutions",      "queries": ['"Hillman Solutions" earnings', '"Hillman Solutions" hardware', "HLMN NASDAQ"]},
    "KSS":  {"name": "Kohl's",                 "queries": ['"Kohl\'s Corporation" earnings', '"Kohls" department store', "KSS NYSE retail"]},
    "NGL":  {"name": "NGL Energy Partners",    "queries": ['"NGL Energy Partners" earnings', '"NGL Energy" MLP', "NGL NYSE water"]},
}

_NAME_SUFFIX_RE = re.compile(
    r'\b(inc\.?|corp\.?|corporation|co\.?|company|llc|holdings|limited|ltd\.?|l\.p\.?|lp)\b',
    re.IGNORECASE,
)

def _normalize_name(name):
    """Strip common corporate suffixes/punctuation and lowercase."""
    if not name:
        return ""
    n = name.replace("&", " ")
    n = _NAME_SUFFIX_RE.sub(" ", n)
    n = re.sub(r'[,\.\-\'"]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip().lower()
    return n

_NAME_STOPWORDS = {
    "the", "and", "group", "energy", "partners", "solutions", "industries",
    "international", "global", "motor", "motors", "stores", "retail", "financial",
    "tire", "rubber", "steel", "secret", "rentals", "corporation",
}

def _is_relevant(headline, summary, ticker, name=None):
    """Protect against common-word ticker false positives.

    Returns True if the combined text mentions the ticker as a whole word,
    OR contains any significant token of the normalized company name as a
    whole word (tokens shorter than 4 chars and generic stopwords are ignored).
    """
    if not ticker and not name:
        return True
    text = f"{headline or ''} {summary or ''}"
    if ticker:
        if re.search(rf'\b{re.escape(ticker)}\b', text, re.IGNORECASE):
            return True
    norm_name = _normalize_name(name)
    if norm_name:
        norm_text = _normalize_name(text)
        # Full-name whole-phrase match (best signal)
        if re.search(rf'\b{re.escape(norm_name)}\b', norm_text):
            return True
        # Token match — any distinctive name token >=4 chars, not a stopword
        tokens = [t for t in norm_name.split() if len(t) >= 4 and t not in _NAME_STOPWORDS]
        for tok in tokens:
            if re.search(rf'\b{re.escape(tok)}\b', norm_text):
                return True
    return False

# Credit-relevant keyword scoring
CREDIT_POSITIVE = [
    "upgrade", "raised", "beats", "beat expectations", "outperform", "profit",
    "revenue growth", "debt reduction", "refinancing", "investment grade",
    "dividend", "buyback", "record revenue", "margin expansion", "cash flow positive",
    "partnership", "contract win", "acquisition", "DOE loan", "approved",
    "EBITDA growth", "deleveraging", "covenant compliance", "rating upgrade",
]
CREDIT_NEGATIVE = [
    "downgrade", "miss", "loss", "layoff", "restructuring", "default",
    "bankruptcy", "covenant breach", "going concern", "dilution", "cash burn",
    "SEC investigation", "restatement", "recall", "lawsuit", "fraud",
    "debt exchange", "distressed", "junk", "negative outlook", "liquidity concern",
    "credit watch", "maturity wall", "shelf registration", "insider selling",
    "production delay", "guidance cut", "revenue decline", "margin compression",
]
CREDIT_CRITICAL = [
    "bankruptcy", "default", "going concern", "SEC enforcement", "fraud",
    "covenant breach", "missed payment", "Chapter 11", "insolvency",
    "material weakness", "delisted", "suspended",
]

def score_headline(headline):
    """Score a headline for credit sentiment and severity."""
    h_lower = headline.lower()

    pos_hits = sum(1 for kw in CREDIT_POSITIVE if kw in h_lower)
    neg_hits = sum(1 for kw in CREDIT_NEGATIVE if kw in h_lower)
    crit_hits = sum(1 for kw in CREDIT_CRITICAL if kw in h_lower)

    if crit_hits > 0:
        return "negative", "critical"
    elif neg_hits > pos_hits:
        return "negative", "material" if neg_hits >= 2 else "notable"
    elif pos_hits > neg_hits:
        return "positive", "notable" if pos_hits >= 2 else "routine"
    else:
        return "neutral", "routine"

def fetch_google_news(query, max_results=8):
    """Fetch headlines from Google News RSS."""
    encoded_query = quote(query)
    url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"

    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; CreditRiskMonitor/1.0)")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
    except Exception as e:
        return []

    headlines = []
    try:
        root = ET.fromstring(xml_data)
        channel = root.find("channel")
        if channel is None:
            return []
        for item in channel.findall("item")[:max_results]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub_date = item.findtext("pubDate", "")
            source = item.findtext("source", "")

            # Parse date
            date_str = ""
            if pub_date:
                try:
                    # Google News RSS format: "Sat, 22 Mar 2026 12:00:00 GMT"
                    dt = datetime.strptime(pub_date.strip(), "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y-%m-%d")
                except ValueError:
                    try:
                        dt = datetime.strptime(pub_date.strip()[:25], "%a, %d %b %Y %H:%M:%S")
                        date_str = dt.strftime("%Y-%m-%d")
                    except ValueError:
                        date_str = pub_date[:10]

            # Clean title (remove source suffix like " - Reuters")
            clean_title = re.sub(r'\s*-\s*[^-]+$', '', title).strip() if " - " in title else title

            sentiment, severity = score_headline(title)

            headlines.append({
                "headline": clean_title,
                "source": source or "Unknown",
                "date": date_str,
                "url": link,
                "sentiment": sentiment,
                "severity": severity,
                "raw_title": title,
            })
    except ET.ParseError:
        return []

    return headlines

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        ticker = params.get("ticker", [None])[0]
        fetch_all = params.get("all", ["false"])[0].lower() == "true"
        max_per = int(params.get("max", ["8"])[0])

        results = {}

        if ticker and ticker.upper() in COMPANY_SEARCH:
            t = ticker.upper()
            info = COMPANY_SEARCH[t]
            all_headlines = []
            for q in info["queries"]:
                all_headlines.extend(fetch_google_news(q, max_per))
            # Deduplicate by headline similarity
            seen = set()
            unique = []
            for h in all_headlines:
                key = h["headline"][:60].lower()
                if key not in seen:
                    seen.add(key)
                    h["ticker"] = t
                    unique.append(h)
            # Universal post-filter: guard against common-word ticker false positives
            filtered = [
                h for h in unique
                if _is_relevant(h.get("headline", ""), h.get("raw_title", ""), t, info.get("name"))
            ]
            results[t] = filtered[:max_per]

        elif fetch_all:
            for t, info in COMPANY_SEARCH.items():
                all_headlines = []
                for q in info["queries"]:
                    all_headlines.extend(fetch_google_news(q, max_per))
                seen = set()
                unique = []
                for h in all_headlines:
                    key = h["headline"][:60].lower()
                    if key not in seen:
                        seen.add(key)
                        h["ticker"] = t
                        unique.append(h)
                # Universal post-filter: guard against common-word ticker false positives
                filtered = [
                    h for h in unique
                    if _is_relevant(h.get("headline", ""), h.get("raw_title", ""), t, info.get("name"))
                ]
                results[t] = filtered[:max_per]

        # Flatten for portfolio-wide view
        all_news = []
        for t, headlines in results.items():
            all_news.extend(headlines)
        all_news.sort(key=lambda x: x.get("date", ""), reverse=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=1800")  # Cache 30 min
        self.end_headers()
        self.wfile.write(json.dumps({
            "news": all_news,
            "by_ticker": results,
            "count": len(all_news),
            "generated": datetime.now().isoformat(),
        }).encode())
