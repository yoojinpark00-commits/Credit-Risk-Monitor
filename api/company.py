"""
Vercel Serverless Function: GET /api/company?ticker=AAPL
Generates a complete company profile object for any public ticker,
matching the portfolioData.js shape for full UI rendering.
"""
import json
import os
import sys
import math
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

FMP_API_KEY = os.environ.get('FMP_API_KEY')
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')

# In-memory cache
_company_cache = {}
CACHE_TTL_HOURS = 6


def fmp_get(endpoint, params=None):
    """Fetch from Financial Modeling Prep API."""
    import requests
    params = params or {}
    params["apikey"] = FMP_API_KEY
    url = f"https://financialmodelingprep.com/api{endpoint}"
    resp = requests.get(url, params=params, timeout=(5, 15))
    if resp.status_code == 200:
        return resp.json()
    return []


def resolve_cik(ticker):
    """Resolve ticker to SEC CIK via company_tickers.json."""
    import requests
    try:
        resp = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "CreditRiskMonitor/1.0 (credit.risk@monitor.com)"},
            timeout=5,
        )
        if resp.ok:
            for entry in resp.json().values():
                if entry["ticker"].upper() == ticker.upper():
                    return str(entry["cik_str"]).zfill(10)
    except Exception:
        pass
    return None


def z_to_rating(z):
    """Map Altman Z-Score to implied credit rating."""
    if z > 3.5: return "A+"
    if z > 3.0: return "A"
    if z > 2.7: return "BBB+"
    if z > 2.5: return "BBB"
    if z > 2.0: return "BB+"
    if z > 1.8: return "BB"
    if z > 1.5: return "B+"
    if z > 1.2: return "B"
    if z > 0.8: return "CCC+"
    return "CCC"


def safe_div(a, b, fallback=0):
    """Safe division with fallback."""
    if b is None or b == 0:
        return fallback
    r = a / b
    return r if math.isfinite(r) else fallback


def to_m(val):
    """Convert raw dollars to $M."""
    if val is None:
        return 0
    return round(val / 1e6)


def generate_company_profile(ticker):
    """Build complete portfolioData.js-shaped company object from FMP + EDGAR."""
    if not FMP_API_KEY:
        return None

    # --- Fetch all data from FMP (10 API calls) ---
    profile_list = fmp_get(f"/v3/profile/{ticker}")
    if not profile_list:
        return None
    profile = profile_list[0]

    income_stmts = fmp_get(f"/v3/income-statement/{ticker}", {"limit": "4"})
    balance_sheets = fmp_get(f"/v3/balance-sheet-statement/{ticker}", {"limit": "4"})
    cash_flows = fmp_get(f"/v3/cash-flow-statement/{ticker}", {"limit": "4"})
    quarterly_inc = fmp_get(f"/v3/income-statement/{ticker}", {"period": "quarter", "limit": "4"})
    quarterly_cf = fmp_get(f"/v3/cash-flow-statement/{ticker}", {"period": "quarter", "limit": "4"})
    rating_list = fmp_get(f"/v3/rating/{ticker}")
    analyst_list = fmp_get(f"/v3/analyst-estimates/{ticker}", {"limit": "1"})
    hist_rating = fmp_get(f"/v3/historical-rating/{ticker}", {"limit": "4"})

    if not income_stmts or not balance_sheets:
        return None

    # --- Extract latest annual data ---
    inc = income_stmts[0]
    bs = balance_sheets[0]
    cf = cash_flows[0] if cash_flows else {}

    revenue = to_m(inc.get("revenue"))
    net_income = to_m(inc.get("netIncome"))
    da = to_m(inc.get("depreciationAndAmortization"))
    sbc_val = to_m(inc.get("stockBasedCompensation") or cf.get("stockBasedCompensation"))
    int_exp = to_m(inc.get("interestExpense"))
    tax_exp = to_m(inc.get("incomeTaxExpense"))
    oper_income = to_m(inc.get("operatingIncome"))
    restructuring = abs(to_m(inc.get("otherExpenses")))

    total_debt = to_m(bs.get("totalDebt"))
    cash = to_m(bs.get("cashAndCashEquivalents"))
    total_assets = to_m(bs.get("totalAssets"))
    total_equity = to_m(bs.get("totalStockholdersEquity"))
    current_assets = to_m(bs.get("totalCurrentAssets"))
    current_liab = to_m(bs.get("totalCurrentLiabilities"))
    lt_debt = to_m(bs.get("longTermDebt"))
    current_ltd = to_m(bs.get("shortTermDebt") or bs.get("currentPortionOfLongTermDebt"))
    st_investments = to_m(bs.get("shortTermInvestments"))

    total_capex = abs(to_m(cf.get("capitalExpenditure")))
    ocf = to_m(cf.get("operatingCashFlow"))
    fcf = to_m(cf.get("freeCashFlow"))
    cash_taxes = abs(to_m(cf.get("incomeTaxesPaid")))
    cash_interest = abs(to_m(cf.get("interestPaid")))

    # --- Compute EBITDA ---
    gaap_ebitda = net_income + int_exp + tax_exp + da
    adj_ebitda = gaap_ebitda + sbc_val + restructuring

    # --- Derived ratios ---
    gross_leverage = round(safe_div(total_debt, adj_ebitda), 1)
    net_leverage = round(safe_div(total_debt - cash, adj_ebitda), 1)
    int_cov = round(safe_div(adj_ebitda, int_exp), 1)
    debt_to_equity = round(safe_div(total_debt, total_equity), 2)
    current_ratio = round(safe_div(current_assets, current_liab), 2)
    roic = round(safe_div(net_income, total_debt + total_equity) * 100, 1) if (total_debt + total_equity) > 0 else 0

    # --- Altman Z-Score ---
    working_capital = current_assets - current_liab
    total_liabilities = total_assets - total_equity if total_assets > total_equity else 1
    market_cap_m = to_m(profile.get("mktCap"))
    z_score = 0
    if total_assets > 0 and total_liabilities > 0:
        z_score = round(
            1.2 * safe_div(working_capital, total_assets) +
            1.4 * safe_div(total_equity, total_assets) +
            3.3 * safe_div(oper_income, total_assets) +
            0.6 * safe_div(market_cap_m, total_liabilities) +
            0.999 * safe_div(revenue, total_assets),
        2)
    implied_rating = z_to_rating(z_score)

    # --- Financials array (trailing 4 years) ---
    financials = []
    for i in range(min(len(income_stmts), len(balance_sheets), 4)):
        fy = income_stmts[i].get("calendarYear", str(2025 - i))
        financials.append({
            "period": f"FY{fy}",
            "rev": to_m(income_stmts[i].get("revenue")),
            "ebitda": to_m(income_stmts[i].get("ebitda")),
            "ni": to_m(income_stmts[i].get("netIncome")),
            "debt": to_m(balance_sheets[i].get("totalDebt")),
            "cash": to_m(balance_sheets[i].get("cashAndCashEquivalents")),
        })

    # --- Quarterly burns ---
    quarterly_burns = []
    for i in range(min(len(quarterly_inc), len(quarterly_cf), 4)):
        qi = quarterly_inc[i]
        qc = quarterly_cf[i]
        q_label = f"{qi.get('period', 'Q?')} {qi.get('calendarYear', '')}"
        q_ebitda = to_m(qi.get("ebitda"))
        q_capex = abs(to_m(qc.get("capitalExpenditure")))
        q_interest = abs(to_m(qc.get("interestPaid")))
        q_burn = q_ebitda - q_capex - q_interest
        quarterly_burns.append({
            "q": q_label,
            "burn": q_burn,
            "note": f"EBITDA {q_ebitda}M, CapEx {q_capex}M",
        })
    quarterly_burns.reverse()

    # --- adjBurn section ---
    fy_label = income_stmts[0].get("calendarYear", "2025")
    adj_burn = {
        "adjEBITDA": adj_ebitda,
        "adjEBITDA_src": f"FY{fy_label} computed: GAAP EBITDA ({gaap_ebitda}M) + SBC ({sbc_val}M) + non-recurring ({restructuring}M)",
        "gaapEbitda": gaap_ebitda,
        "sbc": sbc_val,
        "restructuring": restructuring,
        "otherNonCash": 0,
        "incomeTaxes": cash_taxes,
        "incomeTaxes_src": f"FY{fy_label} cash flow statement",
        "prefDividends": 0,
        "prefDividends_src": "Not disclosed / N/A",
        "maintCapex": None,
        "totalCapex": total_capex,
        "totalCapex_src": f"FY{fy_label} cash flow statement",
        "currentLTD": current_ltd,
        "currentLTD_src": f"FY{fy_label} balance sheet — current debt",
        "intExpCash": cash_interest,
        "intExpCash_src": f"FY{fy_label} cash flow statement — interest paid",
    }

    # --- Rating history ---
    rating_history = []
    for hr in (hist_rating or [])[:4]:
        rating_history.append({
            "date": (hr.get("date", ""))[:7],
            "sp": "NR", "moodys": "NR", "fitch": "NR",
            "event": f"FMP Rating: {hr.get('ratingRecommendation', 'N/A')} (Score: {hr.get('ratingScore', 'N/A')})",
        })
    if not rating_history:
        rating_history = [{"date": f"FY{fy_label}", "sp": "NR", "moodys": "NR", "fitch": "NR", "event": "Initial lookup — no rating history"}]

    # --- Research ---
    research = []
    for est in (analyst_list or [])[:4]:
        research.append({
            "date": est.get("date", ""),
            "firm": "Consensus",
            "action": f"Rev Est ${to_m(est.get('estimatedRevenueAvg'))}M",
            "pt": round(est.get("estimatedEpsAvg", 0), 2),
            "summary": f"Consensus revenue estimate ${to_m(est.get('estimatedRevenueAvg'))}M, EPS estimate ${est.get('estimatedEpsAvg', 0):.2f}",
        })
    if not research:
        research = [{"date": "", "firm": "N/A", "action": "N/A", "pt": 0, "summary": "No analyst estimates available"}]

    # --- Liquidity breakdown ---
    liquidity_breakdown = {
        "totalLiquidity": cash + st_investments,
        "components": [
            {"category": "Cash & Cash Equivalents", "amount": cash, "type": "cash", "sub": []},
        ],
        "facilities": [],
        "debtMaturities": [],
    }
    if st_investments > 0:
        liquidity_breakdown["components"].append(
            {"category": "Short-Term Investments", "amount": st_investments, "type": "st_invest", "sub": []}
        )

    # --- Runway string ---
    qtr_burn = quarterly_burns[-1]["burn"] if quarterly_burns else round(fcf / 4) if fcf != 0 else 0
    if qtr_burn > 0:
        runway = "Cash flow positive"
    elif qtr_burn < 0:
        qtrs = round(cash / abs(qtr_burn), 1) if abs(qtr_burn) > 0 else 999
        runway = f"~{qtrs} qtrs at current burn"
    else:
        runway = "N/A"

    # --- FMP rating ---
    fmp_rating = rating_list[0].get("ratingRecommendation", "N/A") if rating_list else "N/A"

    return {
        "id": ticker.upper(),
        "name": profile.get("companyName", ticker.upper()),
        "sector": profile.get("industry") or profile.get("sector") or "N/A",
        "sp": "NR",
        "moodys": "NR",
        "fitch": "NR",
        "impliedRating": implied_rating,
        "outlook": "Stable",
        "watchlist": False,
        "cds5y": None, "cds5yChg": None,
        "bondSpread": None, "bondSpreadChg": None,
        "eqPrice": profile.get("price"),
        "eqChg": profile.get("changes"),
        "mktCap": round(profile.get("mktCap", 0) / 1e9, 2),
        "ltDebt": lt_debt,
        "totalDebt": total_debt,
        "cash": cash,
        "ebitda": adj_ebitda,
        "intExp": int_exp,
        "revenue": revenue,
        "netIncome": net_income,
        "totalAssets": total_assets,
        "totalEquity": total_equity,
        "fcf": fcf,
        "currentAssets": current_assets,
        "currentLiab": current_liab,
        "grossLeverage": gross_leverage,
        "netLeverage": net_leverage,
        "intCov": int_cov,
        "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio,
        "roic": roic,
        "cashBurnQtr": qtr_burn,
        "liquidityRunway": runway,
        "quarterlyBurns": quarterly_burns,
        "adjBurn": adj_burn,
        "liquidityBreakdown": liquidity_breakdown,
        "analystRating": profile.get("recommendation") or fmp_rating or "N/A",
        "targetPrice": profile.get("dcf") or 0,
        "earningsDate": None,
        "earningsTime": None,
        "lastEarnings": "",
        "earningsCallSummary": None,
        "news": [],  # Fetched separately via /api/news
        "ratingHistory": rating_history,
        "research": research,
        "financials": financials,
        "_generated": True,
        "_source": "fmp",
        "_generatedAt": datetime.now(timezone.utc).isoformat(),
        "_zScore": z_score,
        "_fmpRating": fmp_rating,
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        ticker = params.get('ticker', [''])[0].upper().strip()

        if not ticker or len(ticker) > 10:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid ticker"}).encode())
            return

        # Check cache
        if ticker in _company_cache:
            entry = _company_cache[ticker]
            age_hours = (datetime.now() - entry['fetched_at']).total_seconds() / 3600
            if age_hours < CACHE_TTL_HOURS:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'public, max-age=21600')
                self.end_headers()
                self.wfile.write(json.dumps(entry['data'], default=str).encode())
                return

        # Generate profile
        data = generate_company_profile(ticker)

        if data is None:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": f"Could not find data for ticker '{ticker}'. Check the symbol and try again."
            }).encode())
            return

        # Cache it
        _company_cache[ticker] = {'data': data, 'fetched_at': datetime.now()}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=21600')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())
