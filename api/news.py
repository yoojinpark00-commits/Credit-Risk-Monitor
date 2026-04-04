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
}

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

        if ticker:
            t = ticker.upper()
            if t in COMPANY_SEARCH:
                info = COMPANY_SEARCH[t]
                queries = info["queries"]
            else:
                # Unknown ticker — fall back to generic search using the ticker symbol
                queries = [t]
            all_headlines = []
            for q in queries:
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
            results[t] = unique[:max_per]

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
                results[t] = unique[:max_per]

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
