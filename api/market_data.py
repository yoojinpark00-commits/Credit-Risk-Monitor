"""
Market Data API — Vercel Serverless Function
Fetches live equity prices and basic market data.
Uses Yahoo Finance (free) as primary, FMP as fallback.

GET /api/market_data?ticker=LCID
GET /api/market_data?all=true
"""
import json
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass

TICKERS = ["LCID", "RIVN", "CENT", "IHRT", "SMC", "UPBD", "WSC"]
# BEUSA and JSWUSA are private — no market data available

FMP_API_KEY = os.environ.get("FMP_API_KEY", "")


def fetch_yahoo_quote(ticker):
    """Fetch current quote from Yahoo Finance v8 API."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; CreditRiskMonitor/1.0)")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = data.get("chart", {}).get("result", [{}])[0]
        meta = result.get("meta", {})
        price = meta.get("regularMarketPrice", 0)
        prev_close = meta.get("chartPreviousClose", meta.get("previousClose", price))
        chg = price - prev_close if prev_close else 0
        chg_pct = (chg / prev_close * 100) if prev_close else 0

        # Get 52-week data from indicators
        indicators = result.get("indicators", {}).get("quote", [{}])[0]
        closes = indicators.get("close", [])
        high_52 = meta.get("fiftyTwoWeekHigh", max(closes) if closes else 0)
        low_52 = meta.get("fiftyTwoWeekLow", min([c for c in closes if c]) if closes else 0)

        return {
            "price": round(price, 2),
            "change": round(chg, 2),
            "changePct": round(chg_pct, 2),
            "prevClose": round(prev_close, 2),
            "high52w": round(high_52, 2),
            "low52w": round(low_52, 2),
            "volume": meta.get("regularMarketVolume", 0),
            "marketCap": meta.get("marketCap", 0),
            "currency": meta.get("currency", "USD"),
            "exchange": meta.get("exchangeName", ""),
            "source": "yahoo",
        }
    except Exception as e:
        return {"error": str(e), "source": "yahoo"}


def fetch_fmp_quote(ticker):
    """Fallback: Fetch from Financial Modeling Prep."""
    if not FMP_API_KEY:
        return {"error": "No FMP API key configured", "source": "fmp"}
    url = f"https://financialmodelingprep.com/api/v3/quote/{ticker}?apikey={FMP_API_KEY}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data and len(data) > 0:
            q = data[0]
            return {
                "price": q.get("price", 0),
                "change": q.get("change", 0),
                "changePct": q.get("changesPercentage", 0),
                "prevClose": q.get("previousClose", 0),
                "high52w": q.get("yearHigh", 0),
                "low52w": q.get("yearLow", 0),
                "volume": q.get("volume", 0),
                "marketCap": q.get("marketCap", 0),
                "source": "fmp",
            }
        return {"error": "No data returned", "source": "fmp"}
    except Exception as e:
        return {"error": str(e), "source": "fmp"}


def get_quote(ticker):
    """Try Yahoo first, fall back to FMP."""
    result = fetch_yahoo_quote(ticker)
    if "error" not in result:
        return result
    result = fetch_fmp_quote(ticker)
    if "error" not in result:
        return result
    return {"ticker": ticker, "error": "Both Yahoo and FMP failed", "price": 0}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        ticker = params.get("ticker", [None])[0]
        fetch_all = params.get("all", ["false"])[0].lower() == "true"

        results = {}

        if ticker and ticker.upper() in TICKERS:
            t = ticker.upper()
            results[t] = get_quote(t)
            results[t]["ticker"] = t
        elif fetch_all:
            for t in TICKERS:
                results[t] = get_quote(t)
                results[t]["ticker"] = t

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=300")  # Cache 5 min
        self.end_headers()
        self.wfile.write(json.dumps({
            "quotes": results,
            "count": len(results),
            "generated": datetime.now().isoformat(),
        }).encode())
