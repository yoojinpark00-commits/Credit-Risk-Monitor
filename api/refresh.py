"""
Vercel Cron Function: GET /api/refresh
Triggered daily at 11:00 UTC (6:00 AM ET) by vercel.json cron config.
Refreshes all portfolio tickers via the tiered data pipeline.
"""
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

# Public tickers fetched from SEC EDGAR / FMP / Yahoo
PUBLIC_TICKERS = ['LCID', 'RIVN', 'CENT', 'IHRT', 'SMC', 'UPBD', 'WSC', 'GT']
# Private companies — skip automated fetch (use manual overrides)
PRIVATE_TICKERS = ['BEUSA', 'JSWUSA']

FISCAL_YEAR = 2025
FMP_API_KEY = os.environ.get('FMP_API_KEY')
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')
CRON_SECRET = os.environ.get('CRON_SECRET')


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Verify cron secret — fail closed if not configured
        auth = self.headers.get('Authorization', '')
        if not CRON_SECRET:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "CRON_SECRET not configured"}).encode())
            return
        if not hmac.compare_digest(auth, f"Bearer {CRON_SECRET}"):
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return

        results = {}
        errors = []

        # Skip private companies — no public data sources
        for ticker in PRIVATE_TICKERS:
            results[ticker] = {"status": "skipped_private_company"}

        # Instantiate fetcher once to reuse connection pooling
        from credit_data_fetcher import CreditDataFetcher
        fetcher = CreditDataFetcher(fmp_key=FMP_API_KEY)

        for ticker in PUBLIC_TICKERS:
            try:
                data = fetcher.fetch(ticker, FISCAL_YEAR)
                if data is None:
                    results[ticker] = {"status": "error", "error": "Fetch returned None"}
                    continue

                results[ticker] = {
                    "status": "success",
                    "verification": data.get("verification_summary", {}),
                    "adj_cash_burn": data.get("adjusted_cash_burn", {}).get("result_millions"),
                }

                # Persist to Supabase
                if SUPABASE_URL and SUPABASE_KEY:
                    try:
                        import requests
                        resp = requests.post(
                            f"{SUPABASE_URL}/rest/v1/portfolio_data",
                            json={
                                "ticker": ticker,
                                "fiscal_year": FISCAL_YEAR,
                                "data_json": json.dumps(data, default=str),
                                "fetched_at": datetime.now(timezone.utc).isoformat(),
                            },
                            headers={
                                "apikey": SUPABASE_KEY,
                                "Authorization": f"Bearer {SUPABASE_KEY}",
                                "Content-Type": "application/json",
                                "Prefer": "return=minimal",
                            },
                            timeout=10,
                        )
                        resp.raise_for_status()
                    except Exception as e:
                        results[ticker]["persisted"] = False
                        errors.append(f"Supabase write for {ticker}: {str(e)}")

            except Exception as e:
                results[ticker] = {"status": "error", "error": str(e)}
                errors.append(f"{ticker}: {str(e)}")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "completed",
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
            "tickers": results,
            "errors": errors if errors else None,
        }, default=str).encode())
