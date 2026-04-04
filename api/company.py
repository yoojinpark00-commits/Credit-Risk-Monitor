"""
Vercel Serverless Function: GET /api/company?ticker=AAPL
Generates a complete company profile for any public ticker using yfinance (free, no API key).
Returns a portfolioData.js-shaped object for full UI rendering.
"""
import json
import math
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone


# In-memory cache (persists across warm invocations)
_company_cache = {}
CACHE_TTL_HOURS = 6


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
    if b is None or b == 0:
        return fallback
    r = a / b
    return r if math.isfinite(r) else fallback


def to_m(val):
    """Convert raw value to $M. Handles NaN and None."""
    if val is None:
        return 0
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return 0
        return round(f / 1e6)
    except (ValueError, TypeError):
        return 0


def safe_float(val, fallback=0):
    """Safely convert to float."""
    if val is None:
        return fallback
    try:
        f = float(val)
        return fallback if (math.isnan(f) or math.isinf(f)) else f
    except (ValueError, TypeError):
        return fallback


def df_val(df, key, col_idx=0, fallback=None):
    """Safely get a value from a yfinance DataFrame."""
    try:
        if df is None or df.empty:
            return fallback
        if key in df.index:
            val = df.iloc[df.index.get_loc(key), col_idx]
            f = float(val)
            return fallback if (math.isnan(f) or math.isinf(f)) else f
        return fallback
    except Exception:
        return fallback


def generate_company_profile(ticker):
    """Build complete portfolioData.js-shaped company object from yfinance."""
    import yfinance as yf

    stock = yf.Ticker(ticker)

    # --- Company info ---
    try:
        info = stock.info or {}
    except Exception:
        info = {}

    if not info.get("shortName") and not info.get("longName"):
        return None

    name = info.get("longName") or info.get("shortName") or ticker.upper()
    sector = info.get("industry") or info.get("sector") or "N/A"

    # --- Price data ---
    price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice"), 0)
    prev_close = safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose"), 0)
    price_chg = round(((price / prev_close) - 1) * 100, 2) if prev_close > 0 and price > 0 else 0
    mkt_cap = safe_float(info.get("marketCap"), 0)

    # --- Financial statements (annual) ---
    try:
        inc_stmt = stock.income_stmt
    except Exception:
        inc_stmt = None
    try:
        bal_sheet = stock.balance_sheet
    except Exception:
        bal_sheet = None
    try:
        cf_stmt = stock.cashflow
    except Exception:
        cf_stmt = None

    if inc_stmt is None or inc_stmt.empty or bal_sheet is None or bal_sheet.empty:
        # Minimal profile if no financials available
        return {
            "id": ticker.upper(),
            "name": name,
            "sector": sector,
            "sp": "NR", "moodys": "NR", "fitch": "NR",
            "impliedRating": "NR", "outlook": "Stable",
            "watchlist": False,
            "cds5y": None, "cds5yChg": None,
            "bondSpread": None, "bondSpreadChg": None,
            "eqPrice": price, "eqChg": price_chg,
            "mktCap": round(mkt_cap / 1e9, 2),
            "ltDebt": 0, "totalDebt": 0, "cash": 0,
            "ebitda": 0, "intExp": 0, "revenue": 0,
            "netIncome": 0, "totalAssets": 0, "totalEquity": 0,
            "fcf": 0, "currentAssets": 0, "currentLiab": 0,
            "grossLeverage": 0, "netLeverage": 0,
            "intCov": 0, "debtToEquity": 0, "currentRatio": 0,
            "roic": 0, "cashBurnQtr": 0,
            "liquidityRunway": "N/A",
            "quarterlyBurns": [], "adjBurn": None,
            "liquidityBreakdown": {"totalLiquidity": 0, "components": [], "facilities": [], "debtMaturities": []},
            "analystRating": info.get("recommendationKey", "N/A"),
            "targetPrice": safe_float(info.get("targetMeanPrice"), 0),
            "earningsDate": None, "earningsTime": None,
            "lastEarnings": "", "earningsCallSummary": None,
            "news": [], "ratingHistory": [{"date": "N/A", "sp": "NR", "moodys": "NR", "fitch": "NR", "event": "Initial lookup"}],
            "research": [{"date": "", "firm": "N/A", "action": "N/A", "pt": 0, "summary": "No financials available"}],
            "financials": [],
            "_generated": True, "_source": "yfinance",
            "_generatedAt": datetime.now(timezone.utc).isoformat(),
            "_zScore": 0,
        }

    # --- Extract latest annual data (column 0 = most recent) ---
    revenue = to_m(df_val(inc_stmt, "Total Revenue"))
    net_income = to_m(df_val(inc_stmt, "Net Income"))
    oper_income = to_m(df_val(inc_stmt, "Operating Income"))
    int_exp = to_m(df_val(inc_stmt, "Interest Expense"))
    tax_exp = to_m(df_val(inc_stmt, "Tax Provision"))
    da = to_m(df_val(inc_stmt, "Depreciation And Amortization In Income Statement")
              or df_val(inc_stmt, "Reconciled Depreciation"))
    ebitda_raw = to_m(df_val(inc_stmt, "EBITDA"))
    sbc_val = to_m(df_val(cf_stmt, "Stock Based Compensation") if cf_stmt is not None else None)

    total_debt = to_m(df_val(bal_sheet, "Total Debt"))
    cash = to_m(df_val(bal_sheet, "Cash And Cash Equivalents")
                or df_val(bal_sheet, "Cash Cash Equivalents And Short Term Investments"))
    total_assets = to_m(df_val(bal_sheet, "Total Assets"))
    total_equity = to_m(df_val(bal_sheet, "Stockholders Equity")
                        or df_val(bal_sheet, "Total Equity Gross Minority Interest"))
    current_assets = to_m(df_val(bal_sheet, "Current Assets"))
    current_liab = to_m(df_val(bal_sheet, "Current Liabilities"))
    lt_debt = to_m(df_val(bal_sheet, "Long Term Debt"))
    current_ltd = to_m(df_val(bal_sheet, "Current Debt")
                       or df_val(bal_sheet, "Current Debt And Capital Lease Obligation"))
    st_investments = to_m(df_val(bal_sheet, "Other Short Term Investments"))

    total_capex = abs(to_m(df_val(cf_stmt, "Capital Expenditure") if cf_stmt is not None else None))
    ocf = to_m(df_val(cf_stmt, "Operating Cash Flow") if cf_stmt is not None else None)
    fcf = to_m(df_val(cf_stmt, "Free Cash Flow") if cf_stmt is not None else None)
    cash_taxes = abs(to_m(df_val(cf_stmt, "Income Tax Paid Supplemental Data") if cf_stmt is not None else None))
    cash_interest = abs(to_m(df_val(cf_stmt, "Interest Paid Supplemental Data") if cf_stmt is not None else None))

    # --- Compute EBITDA ---
    gaap_ebitda = ebitda_raw if ebitda_raw != 0 else (net_income + int_exp + tax_exp + da)
    adj_ebitda = gaap_ebitda + sbc_val

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

    # --- Financials array (trailing years from DataFrame columns) ---
    financials = []
    num_years = min(inc_stmt.shape[1], bal_sheet.shape[1], 4)
    for i in range(num_years):
        try:
            col_date = inc_stmt.columns[i]
            fy = str(col_date.year) if hasattr(col_date, 'year') else str(2025 - i)
        except Exception:
            fy = str(2025 - i)
        financials.append({
            "period": f"FY{fy}",
            "rev": to_m(df_val(inc_stmt, "Total Revenue", i)),
            "ebitda": to_m(df_val(inc_stmt, "EBITDA", i)),
            "ni": to_m(df_val(inc_stmt, "Net Income", i)),
            "debt": to_m(df_val(bal_sheet, "Total Debt", i)),
            "cash": to_m(df_val(bal_sheet, "Cash And Cash Equivalents", i)
                         or df_val(bal_sheet, "Cash Cash Equivalents And Short Term Investments", i)),
        })

    # --- Quarterly burns ---
    quarterly_burns = []
    try:
        q_inc = stock.quarterly_income_stmt
        q_cf = stock.quarterly_cashflow
        if q_inc is not None and not q_inc.empty and q_cf is not None and not q_cf.empty:
            num_q = min(q_inc.shape[1], q_cf.shape[1], 4)
            for i in range(num_q):
                try:
                    qd = q_inc.columns[i]
                    q_label = f"Q{((qd.month - 1) // 3) + 1} {qd.year}" if hasattr(qd, 'month') else f"Q{4-i}"
                except Exception:
                    q_label = f"Q{4-i}"
                q_ebitda = to_m(df_val(q_inc, "EBITDA", i))
                q_capex = abs(to_m(df_val(q_cf, "Capital Expenditure", i)))
                q_interest = abs(to_m(df_val(q_cf, "Interest Paid Supplemental Data", i)))
                q_burn = q_ebitda - q_capex - q_interest
                quarterly_burns.append({
                    "q": q_label,
                    "burn": q_burn,
                    "note": f"EBITDA {q_ebitda}M, CapEx {q_capex}M",
                })
            quarterly_burns.reverse()
    except Exception:
        pass

    # --- adjBurn section ---
    fy_label = str(inc_stmt.columns[0].year) if hasattr(inc_stmt.columns[0], 'year') else "LTM"
    adj_burn = {
        "adjEBITDA": adj_ebitda,
        "adjEBITDA_src": f"FY{fy_label}: GAAP EBITDA ({gaap_ebitda}M) + SBC ({sbc_val}M)",
        "gaapEbitda": gaap_ebitda,
        "sbc": sbc_val,
        "restructuring": 0,
        "otherNonCash": 0,
        "incomeTaxes": cash_taxes,
        "incomeTaxes_src": f"FY{fy_label} cash flow statement",
        "prefDividends": 0,
        "prefDividends_src": "Not disclosed / N/A",
        "maintCapex": None,
        "totalCapex": total_capex,
        "totalCapex_src": f"FY{fy_label} cash flow statement",
        "currentLTD": current_ltd,
        "currentLTD_src": f"FY{fy_label} balance sheet",
        "intExpCash": cash_interest,
        "intExpCash_src": f"FY{fy_label} cash flow statement",
    }

    # --- Rating history (from yfinance upgrades/downgrades) ---
    rating_history = []
    try:
        upgrades = stock.upgrades_downgrades
        if upgrades is not None and not upgrades.empty:
            recent = upgrades.head(4)
            for idx, row in recent.iterrows():
                date_str = str(idx)[:10] if hasattr(idx, 'strftime') else str(idx)[:10]
                rating_history.append({
                    "date": date_str,
                    "sp": "NR", "moodys": "NR", "fitch": "NR",
                    "event": f"{row.get('Firm', 'Analyst')}: {row.get('FromGrade', '?')} → {row.get('ToGrade', '?')} ({row.get('Action', '')})",
                })
    except Exception:
        pass
    if not rating_history:
        rating_history = [{"date": f"FY{fy_label}", "sp": "NR", "moodys": "NR", "fitch": "NR", "event": "Initial lookup — no rating history"}]

    # --- Research (analyst recommendations) ---
    research = []
    rec_key = info.get("recommendationKey", "")
    target_price = safe_float(info.get("targetMeanPrice"), 0)
    target_high = safe_float(info.get("targetHighPrice"), 0)
    target_low = safe_float(info.get("targetLowPrice"), 0)
    num_analysts = info.get("numberOfAnalystOpinions", 0)
    if rec_key or target_price:
        research.append({
            "date": datetime.now().strftime("%Y-%m-%d"),
            "firm": f"Consensus ({num_analysts} analysts)" if num_analysts else "Consensus",
            "action": (rec_key or "N/A").replace("_", " ").title(),
            "pt": target_price,
            "summary": f"Target: ${target_price:.0f} (${target_low:.0f}–${target_high:.0f}). Recommendation: {(rec_key or 'N/A').replace('_', ' ').title()}",
        })
    if not research:
        research = [{"date": "", "firm": "N/A", "action": "N/A", "pt": 0, "summary": "No analyst coverage available"}]

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
        "sp": "NR",
        "moodys": "NR",
        "fitch": "NR",
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
        "analystRating": (rec_key or "N/A").replace("_", " ").title(),
        "targetPrice": target_price,
        "earningsDate": None,
        "earningsTime": None,
        "lastEarnings": "",
        "earningsCallSummary": None,
        "news": [],
        "ratingHistory": rating_history,
        "research": research,
        "financials": financials,
        "_generated": True,
        "_source": "yfinance",
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
