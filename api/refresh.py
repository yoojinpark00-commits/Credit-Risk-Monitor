"""
Vercel Cron Function: GET /api/refresh
Triggered daily at 11:00 UTC (6:00 AM ET) by vercel.json cron config.
Refreshes all portfolio tickers via the tiered data pipeline.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

TICKERS = ['LCID', 'RIVN', 'CENT', 'IHRT', 'SMC', 'UPBD', 'WSC', 'BEUSA', 'JSWUSA']
FISCAL_YEAR = 2025
FMP_API_KEY = os.environ.get('FMP_API_KEY')
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')
CRON_SECRET = os.environ.get('CRON_SECRET')


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Verify cron secret (Vercel sends this header for cron invocations)
        auth = self.headers.get('Authorization')
        if CRON_SECRET and auth != f"Bearer {CRON_SECRET}":
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return

        results = {}
        errors = []

        for ticker in TICKERS:
            try:
                from credit_data_fetcher import CreditDataFetcher
                fetcher = CreditDataFetcher(fmp_key=FMP_API_KEY)
                data = fetcher.fetch(ticker, FISCAL_YEAR)
                results[ticker] = {
                    "status": "success",
                    "verification": data.get("verification_summary", {}),
                    "adj_cash_burn": data.get("adjusted_cash_burn", {}).get("result_millions"),
                }

                # Persist to Supabase
                if SUPABASE_URL and SUPABASE_KEY:
                    try:
                        import requests
                        requests.post(
                            f"{SUPABASE_URL}/rest/v1/portfolio_data",
                            json={
                                "ticker": ticker,
                                "fiscal_year": FISCAL_YEAR,
                                "data_json": json.dumps(data, default=str),
                                "fetched_at": datetime.now().isoformat(),
                            },
                            headers={
                                "apikey": SUPABASE_KEY,
                                "Authorization": f"Bearer {SUPABASE_KEY}",
                                "Content-Type": "application/json",
                                "Prefer": "return=minimal",
                            },
                            timeout=10,
                        )
                    except Exception as e:
                        errors.append(f"Supabase write for {ticker}: {str(e)}")

            except Exception as e:
                results[ticker] = {"status": "error", "error": str(e)}
                errors.append(f"{ticker}: {str(e)}")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "completed",
            "refreshed_at": datetime.now().isoformat(),
            "tickers": results,
            "errors": errors if errors else None,
        }, default=str).encode())
