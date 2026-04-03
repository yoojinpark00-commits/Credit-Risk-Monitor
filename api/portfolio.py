"""
Vercel Serverless Function: GET /api/portfolio
Serves cached portfolio data or fetches fresh from the tiered pipeline.

Usage:
  GET /api/portfolio?all=true          — returns all tickers
  GET /api/portfolio?ticker=LCID       — returns single ticker
  GET /api/portfolio?ticker=LCID&fresh=true — forces fresh fetch
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta

# Add scripts dir to path for the data fetcher
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

# Supabase connection (optional — falls back to JSON file)
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')
FMP_API_KEY = os.environ.get('FMP_API_KEY')

TICKERS = ['LCID', 'RIVN', 'CENT', 'IHRT', 'SMC', 'UPBD', 'WSC', 'BEUSA', 'JSWUSA']
FISCAL_YEAR = 2025

# In-memory cache (persists within a single warm Lambda instance)
_cache = {}
CACHE_TTL_HOURS = 6


def get_cached_data(ticker, fy):
    """Try to get data from cache, Supabase, or local JSON."""
    key = f"{ticker}_{fy}"

    # 1. Check in-memory cache
    if key in _cache:
        entry = _cache[key]
        if datetime.now() - entry['fetched_at'] < timedelta(hours=CACHE_TTL_HOURS):
            return entry['data']

    # 2. Try Supabase if configured
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            import requests
            resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/portfolio_data",
                params={
                    "ticker": f"eq.{ticker}",
                    "fiscal_year": f"eq.{fy}",
                    "select": "*",
                    "limit": "1",
                    "order": "fetched_at.desc",
                },
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                },
                timeout=5,
            )
            if resp.ok and resp.json():
                row = resp.json()[0]
                data = json.loads(row['data_json']) if isinstance(row['data_json'], str) else row['data_json']
                data['_source'] = 'supabase'
                data['_fetched_at'] = row.get('fetched_at')
                _cache[key] = {'data': data, 'fetched_at': datetime.now()}
                return data
        except Exception as e:
            print(f"Supabase read failed for {ticker}: {e}")

    # 3. Fall back to local JSON file
    json_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'portfolio_data.json')
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r') as f:
                all_data = json.load(f)
            if ticker in all_data:
                data = all_data[ticker]
                data['_source'] = 'local_json'
                _cache[key] = {'data': data, 'fetched_at': datetime.now()}
                return data
        except Exception as e:
            print(f"Local JSON read failed: {e}")

    return None


def fetch_fresh_data(ticker, fy):
    """Run the tiered data fetcher for fresh data."""
    try:
        from credit_data_fetcher import CreditDataFetcher
        fetcher = CreditDataFetcher(fmp_key=FMP_API_KEY)
        data = fetcher.fetch(ticker, fy)
        data['_source'] = 'fresh_fetch'
        data['_fetched_at'] = datetime.now().isoformat()

        # Cache it
        key = f"{ticker}_{fy}"
        _cache[key] = {'data': data, 'fetched_at': datetime.now()}

        # Save to Supabase if configured
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                import requests
                requests.post(
                    f"{SUPABASE_URL}/rest/v1/portfolio_data",
                    json={
                        "ticker": ticker,
                        "fiscal_year": fy,
                        "data_json": json.dumps(data, default=str),
                        "fetched_at": datetime.now().isoformat(),
                    },
                    headers={
                        "apikey": SUPABASE_KEY,
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=5,
                )
            except Exception as e:
                print(f"Supabase write failed: {e}")

        return data
    except Exception as e:
        print(f"Fresh fetch failed for {ticker}: {e}")
        return None


def get_all_portfolio(fy, fresh=False):
    """Get data for all tickers. Returns dict keyed by ticker."""
    results = {}
    for ticker in TICKERS:
        data = None
        if not fresh:
            data = get_cached_data(ticker, fy)
        if data is None and fresh:
            data = fetch_fresh_data(ticker, fy)
        if data is not None:
            results[ticker] = data
    return results


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        all_mode = params.get('all', ['false'])[0].lower() == 'true'
        fresh = params.get('fresh', ['false'])[0].lower() == 'true'
        fy = int(params.get('fy', [str(FISCAL_YEAR)])[0])

        if all_mode:
            # Return all tickers
            portfolio = get_all_portfolio(fy, fresh=fresh)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'public, max-age=21600')
            self.end_headers()
            self.wfile.write(json.dumps({
                "portfolio": portfolio,
                "tickers": list(portfolio.keys()),
                "count": len(portfolio),
                "source": "api",
                "fiscal_year": fy,
            }, default=str).encode())
            return

        # Single ticker mode
        ticker = params.get('ticker', ['LCID'])[0].upper()

        if ticker not in set(TICKERS):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": f"Ticker must be one of: {', '.join(TICKERS)}"
            }).encode())
            return

        data = None
        if not fresh:
            data = get_cached_data(ticker, fy)
        if data is None:
            data = fetch_fresh_data(ticker, fy)

        if data is None:
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": "Unable to fetch data from any source"
            }).encode())
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=21600')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())
