"""
Vercel Serverless Function: GET /api/company?ticker=AAPL
Generates a complete company profile for any public ticker.
Uses Yahoo Finance public endpoints directly via requests (no yfinance dependency).
Free, no API key required.
"""
import json
import math
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import requests as req

# In-memory cache (persists across warm invocations)
_company_cache = {}
CACHE_TTL_HOURS = 6

# Yahoo Finance session cache (crumb + cookies persist across warm invocations)
_yf_session = None
_yf_crumb = None


def _get_yf_session():
    """Get an authenticated Yahoo Finance session with crumb + cookies."""
    global _yf_session, _yf_crumb
    if _yf_session and _yf_crumb:
        return _yf_session, _yf_crumb

    session = req.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})

    # Step 1: Hit Yahoo to get auth cookies
    session.get("https://fc.yahoo.com", timeout=5, allow_redirects=True)

    # Step 2: Get crumb token
    crumb_resp = session.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=5)
    if crumb_resp.status_code != 200 or not crumb_resp.text.strip():
        raise Exception(f"Failed to get Yahoo crumb: HTTP {crumb_resp.status_code}")

    _yf_session = session
    _yf_crumb = crumb_resp.text.strip()
    return _yf_session, _yf_crumb


def yf_quoteSummary(ticker, modules):
    """Fetch Yahoo Finance quoteSummary with proper crumb authentication."""
    try:
        session, crumb = _get_yf_session()
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
        params = {"modules": ",".join(modules), "crumb": crumb}
        r = session.get(url, params=params, timeout=8)
        if r.status_code == 401 or r.status_code == 403:
            # Crumb expired, refresh and retry once
            global _yf_session, _yf_crumb
            _yf_session = None
            _yf_crumb = None
            session, crumb = _get_yf_session()
            params["crumb"] = crumb
            r = session.get(url, params=params, timeout=8)
        if r.status_code == 200:
            data = r.json()
            result = data.get("quoteSummary", {}).get("result")
            if result and len(result) > 0:
                return result[0]
    except Exception:
        pass
    return {}



def extract_raw(obj, key, fallback=None):
    """Extract .raw from Yahoo Finance response objects like {'raw': 123, 'fmt': '123'}."""
    if obj is None:
        return fallback
    val = obj.get(key)
    if val is None:
        return fallback
    if isinstance(val, dict):
        r = val.get("raw")
        if r is None:
            return fallback
        try:
            f = float(r)
            return fallback if (math.isnan(f) or math.isinf(f)) else f
        except (ValueError, TypeError):
            return fallback
    try:
        f = float(val)
        return fallback if (math.isnan(f) or math.isinf(f)) else f
    except (ValueError, TypeError):
        return fallback


def z_to_rating(z):
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
    if b is None or b == 0:
        return fallback
    r = a / b
    return r if math.isfinite(r) else fallback


def to_m(val):
    if val is None:
        return 0
    try:
        f = float(val)
        return 0 if (math.isnan(f) or math.isinf(f)) else round(f / 1e6)
    except (ValueError, TypeError):
        return 0


def generate_company_profile(ticker):
    """Build complete company profile from Yahoo Finance quoteSummary API."""

    # Fetch all needed modules in a single HTTP call
    modules = [
        "assetProfile", "summaryDetail", "financialData", "defaultKeyStatistics",
        "incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory",
        "incomeStatementHistoryQuarterly", "cashflowStatementHistoryQuarterly",
        "recommendationTrend", "upgradeDowngradeHistory", "price",
    ]
    data = yf_quoteSummary(ticker, modules)
    if not data:
        return None

    profile = data.get("assetProfile", {})
    summary = data.get("summaryDetail", {})
    fin_data = data.get("financialData", {})
    key_stats = data.get("defaultKeyStatistics", {})
    price_mod = data.get("price", {})

    name = price_mod.get("longName") or price_mod.get("shortName") or profile.get("longBusinessSummary", "")[:50] or ticker.upper()
    if name == ticker.upper() and not profile and not fin_data:
        return None  # Ticker doesn't exist

    sector = profile.get("industry") or profile.get("sector") or "N/A"

    # --- Price ---
    price = extract_raw(price_mod, "regularMarketPrice", 0)
    prev_close = extract_raw(summary, "previousClose", 0)
    price_chg = round(((price / prev_close) - 1) * 100, 2) if prev_close > 0 and price > 0 else 0
    mkt_cap = extract_raw(price_mod, "marketCap") or extract_raw(summary, "marketCap") or 0

    # --- Annual income statements ---
    inc_history = data.get("incomeStatementHistory", {}).get("incomeStatementHistory", [])
    bs_history = data.get("balanceSheetHistory", {}).get("balanceSheetStatements", [])
    cf_history = data.get("cashflowStatementHistory", {}).get("cashflowStatements", [])
    q_inc = data.get("incomeStatementHistoryQuarterly", {}).get("incomeStatementHistory", [])
    q_cf = data.get("cashflowStatementHistoryQuarterly", {}).get("cashflowStatements", [])

    # --- Latest annual data ---
    inc = inc_history[0] if inc_history else {}
    bs = bs_history[0] if bs_history else {}
    cf = cf_history[0] if cf_history else {}

    revenue = to_m(extract_raw(inc, "totalRevenue"))
    net_income = to_m(extract_raw(inc, "netIncome"))
    oper_income = to_m(extract_raw(inc, "operatingIncome"))
    int_exp = to_m(extract_raw(inc, "interestExpense"))
    tax_exp = to_m(extract_raw(inc, "incomeTaxExpense"))
    ebitda_raw = to_m(extract_raw(inc, "ebitda"))

    total_debt = to_m(extract_raw(bs, "longTermDebt", 0) + extract_raw(bs, "shortLongTermDebt", 0))
    cash = to_m(extract_raw(bs, "cash"))
    total_assets = to_m(extract_raw(bs, "totalAssets"))
    total_equity = to_m(extract_raw(bs, "totalStockholderEquity"))
    current_assets = to_m(extract_raw(bs, "totalCurrentAssets"))
    current_liab = to_m(extract_raw(bs, "totalCurrentLiabilities"))
    lt_debt = to_m(extract_raw(bs, "longTermDebt"))
    current_ltd = to_m(extract_raw(bs, "shortLongTermDebt") or extract_raw(bs, "currentLongTermDebt"))
    st_investments = to_m(extract_raw(bs, "shortTermInvestments"))

    total_capex = abs(to_m(extract_raw(cf, "capitalExpenditures")))
    fcf = to_m(extract_raw(cf, "totalCashFromOperatingActivities", 0)) - total_capex

    # Also pull from financialData module (more current)
    if revenue == 0:
        revenue = to_m(extract_raw(fin_data, "totalRevenue"))
    if total_debt == 0:
        total_debt = to_m(extract_raw(fin_data, "totalDebt"))
    if cash == 0:
        cash = to_m(extract_raw(fin_data, "totalCash"))
    if fcf == 0:
        fcf = to_m(extract_raw(fin_data, "freeCashflow"))
    if ebitda_raw == 0:
        ebitda_raw = to_m(extract_raw(fin_data, "ebitda"))

    # --- Compute EBITDA ---
    gaap_ebitda = ebitda_raw if ebitda_raw != 0 else (net_income + abs(int_exp) + tax_exp)
    adj_ebitda = gaap_ebitda  # No SBC data from quoteSummary

    # --- Derived ratios ---
    gross_leverage = round(safe_div(total_debt, adj_ebitda), 1)
    net_leverage = round(safe_div(total_debt - cash, adj_ebitda), 1)
    int_cov = round(safe_div(adj_ebitda, abs(int_exp) if int_exp else 0), 1)
    debt_to_equity = round(safe_div(total_debt, total_equity), 2)
    current_ratio = round(safe_div(current_assets, current_liab), 2)
    roic = round(safe_div(net_income, total_debt + total_equity) * 100, 1) if (total_debt + total_equity) > 0 else 0

    # --- Altman Z-Score ---
    working_capital = current_assets - current_liab
    total_liabilities = total_assets - total_equity if total_assets > total_equity else 1
    market_cap_m = to_m(mkt_cap)
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

    # --- Financials array (trailing years) ---
    financials = []
    num_years = min(len(inc_history), len(bs_history), 4)
    for i in range(num_years):
        end_date = inc_history[i].get("endDate", {})
        fy = end_date.get("fmt", "")[:4] if isinstance(end_date, dict) else str(2025 - i)
        if not fy:
            fy = str(2025 - i)
        financials.append({
            "period": f"FY{fy}",
            "rev": to_m(extract_raw(inc_history[i], "totalRevenue")),
            "ebitda": to_m(extract_raw(inc_history[i], "ebitda")),
            "ni": to_m(extract_raw(inc_history[i], "netIncome")),
            "debt": to_m(extract_raw(bs_history[i], "longTermDebt", 0) + extract_raw(bs_history[i], "shortLongTermDebt", 0)),
            "cash": to_m(extract_raw(bs_history[i], "cash")),
        })

    # --- Quarterly burns ---
    quarterly_burns = []
    num_q = min(len(q_inc), len(q_cf), 4)
    for i in range(num_q):
        end_date = q_inc[i].get("endDate", {})
        if isinstance(end_date, dict):
            date_fmt = end_date.get("fmt", "")
        else:
            date_fmt = ""
        try:
            from datetime import datetime as dt
            d = dt.strptime(date_fmt, "%Y-%m-%d")
            q_label = f"Q{((d.month - 1) // 3) + 1} {d.year}"
        except Exception:
            q_label = f"Q{4-i}"
        q_ebitda = to_m(extract_raw(q_inc[i], "ebitda"))
        q_ocf = to_m(extract_raw(q_cf[i], "totalCashFromOperatingActivities"))
        q_capex = abs(to_m(extract_raw(q_cf[i], "capitalExpenditures")))
        q_burn = q_ocf - q_capex if q_ocf != 0 else q_ebitda - q_capex
        quarterly_burns.append({
            "q": q_label,
            "burn": q_burn,
            "note": f"EBITDA {q_ebitda}M, CapEx {q_capex}M",
        })
    quarterly_burns.reverse()

    # --- adjBurn ---
    fy_label = financials[0]["period"][2:] if financials else "LTM"
    adj_burn = {
        "adjEBITDA": adj_ebitda,
        "adjEBITDA_src": f"FY{fy_label}: GAAP EBITDA ({gaap_ebitda}M)",
        "gaapEbitda": gaap_ebitda,
        "sbc": 0,
        "restructuring": 0,
        "otherNonCash": 0,
        "incomeTaxes": abs(tax_exp),
        "incomeTaxes_src": f"FY{fy_label} income statement",
        "prefDividends": 0,
        "prefDividends_src": "N/A",
        "maintCapex": None,
        "totalCapex": total_capex,
        "totalCapex_src": f"FY{fy_label} cash flow statement",
        "currentLTD": current_ltd,
        "currentLTD_src": f"FY{fy_label} balance sheet",
        "intExpCash": abs(int_exp),
        "intExpCash_src": f"FY{fy_label} income statement",
    }

    # --- Rating history (from upgrades/downgrades) ---
    rating_history = []
    ud_history = data.get("upgradeDowngradeHistory", {}).get("history", [])
    for item in ud_history[:4]:
        epoch = item.get("epochGradeDate", 0)
        date_str = datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d") if epoch else "N/A"
        rating_history.append({
            "date": date_str,
            "sp": "NR", "moodys": "NR", "fitch": "NR",
            "event": f"{item.get('firm', 'Analyst')}: {item.get('fromGrade', '?')} → {item.get('toGrade', '?')} ({item.get('action', '')})",
        })
    if not rating_history:
        rating_history = [{"date": "N/A", "sp": "NR", "moodys": "NR", "fitch": "NR", "event": "No rating history available"}]

    # --- Research (analyst consensus) ---
    rec_key = (fin_data.get("recommendationKey") or "").replace("_", " ").title()
    target_price = extract_raw(fin_data, "targetMeanPrice", 0)
    target_high = extract_raw(fin_data, "targetHighPrice", 0)
    target_low = extract_raw(fin_data, "targetLowPrice", 0)
    num_analysts = extract_raw(fin_data, "numberOfAnalystOpinions", 0)

    research = []
    if rec_key or target_price:
        research.append({
            "date": datetime.now().strftime("%Y-%m-%d"),
            "firm": f"Consensus ({int(num_analysts)} analysts)" if num_analysts else "Consensus",
            "action": rec_key or "N/A",
            "pt": target_price,
            "summary": f"Target: ${target_price:.0f} (${target_low:.0f}–${target_high:.0f}). Recommendation: {rec_key or 'N/A'}",
        })
    if not research:
        research = [{"date": "", "firm": "N/A", "action": "N/A", "pt": 0, "summary": "No analyst coverage available"}]

    # --- Liquidity ---
    liquidity_breakdown = {
        "totalLiquidity": cash + st_investments,
        "components": [{"category": "Cash & Cash Equivalents", "amount": cash, "type": "cash", "sub": []}],
        "facilities": [],
        "debtMaturities": [],
    }
    if st_investments > 0:
        liquidity_breakdown["components"].append(
            {"category": "Short-Term Investments", "amount": st_investments, "type": "st_invest", "sub": []}
        )

    # --- Runway ---
    qtr_burn = quarterly_burns[-1]["burn"] if quarterly_burns else (round(fcf / 4) if fcf != 0 else 0)
    if qtr_burn > 0:
        runway = "Cash flow positive"
    elif qtr_burn < 0:
        qtrs = round(cash / abs(qtr_burn), 1) if abs(qtr_burn) > 0 else 999
        runway = f"~{qtrs} qtrs at current burn"
    else:
        runway = "N/A"

    return {
        "id": ticker.upper(),
        "name": name,
        "sector": sector,
        "sp": "NR", "moodys": "NR", "fitch": "NR",
        "impliedRating": implied_rating,
        "outlook": "Stable",
        "watchlist": False,
        "cds5y": None, "cds5yChg": None,
        "bondSpread": None, "bondSpreadChg": None,
        "eqPrice": price,
        "eqChg": price_chg,
        "mktCap": round(mkt_cap / 1e9, 2),
        "ltDebt": lt_debt,
        "totalDebt": total_debt,
        "cash": cash,
        "ebitda": adj_ebitda,
        "intExp": abs(int_exp),
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
        "analystRating": rec_key or "N/A",
        "targetPrice": target_price,
        "earningsDate": None, "earningsTime": None,
        "lastEarnings": "",
        "earningsCallSummary": None,
        "news": [],
        "ratingHistory": rating_history,
        "research": research,
        "financials": financials,
        "_generated": True,
        "_source": "yahoo",
        "_generatedAt": datetime.now(timezone.utc).isoformat(),
        "_zScore": z_score,
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
        try:
            data = generate_company_profile(ticker)
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Failed to fetch data: {str(e)}"}).encode())
            return

        if data is None:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": f"Could not find data for '{ticker}'. Check the symbol and try again."
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
