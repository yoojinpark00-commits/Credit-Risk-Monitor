"""
Vercel Serverless Function: GET /api/company?ticker=AAPL

Primary: SEC EDGAR XBRL companyfacts API (free, no key, all financials)
Price:   Yahoo Finance v8/chart (free, no auth needed)
Rating:  5-factor S&P-style implied credit rating model
"""
import json
import math
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

_company_cache = {}
CACHE_TTL_HOURS = 6
_cik_cache = {}

EDGAR_UA = "CreditRiskMonitor/1.0 (creditrisk@monitor.app)"
EDGAR_HEADERS = {"User-Agent": EDGAR_UA, "Accept": "application/json"}

# ─── XBRL concept fallback map ──────────────────────────────────────────
CONCEPT_MAP = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues", "SalesRevenueNet",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "operating_income": ["OperatingIncomeLoss"],
    "interest_expense": ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense"],
    "tax_expense": ["IncomeTaxExpenseBenefit"],
    "depreciation": [
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization", "Depreciation",
    ],
    "sbc": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    "restructuring": ["RestructuringCharges", "RestructuringSettlementAndImpairmentProvisions"],
    "total_debt_lt": ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"],
    "current_debt": ["DebtCurrent", "ShortTermBorrowings", "LongTermDebtCurrent"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsAndShortTermInvestments", "Cash"],
    "st_investments": ["ShortTermInvestments", "AvailableForSaleSecuritiesCurrent", "MarketableSecuritiesCurrent"],
    "total_assets": ["Assets"],
    "total_equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "current_assets": ["AssetsCurrent"],
    "current_liab": ["LiabilitiesCurrent"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "dividends_paid": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "shares_outstanding": ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
}

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A"}
QUARTERLY_FORMS = {"10-Q", "10-Q/A"}


# ─── EDGAR helpers ───────────────────────────────────────────────────────
def _edgar_get(url):
    r = urllib.request.Request(url, headers=EDGAR_HEADERS)
    with urllib.request.urlopen(r, timeout=10) as resp:
        return json.loads(resp.read().decode())


def ticker_to_cik(ticker):
    if ticker in _cik_cache:
        return _cik_cache[ticker]
    data = _edgar_get("https://www.sec.gov/files/company_tickers.json")
    for entry in data.values():
        t = entry["ticker"].upper()
        c = str(entry["cik_str"]).zfill(10)
        _cik_cache[t] = c
        if t == ticker.upper():
            result = c
    return _cik_cache.get(ticker.upper())


def _extract_series(facts, tag, forms, n=4, quarterly=False):
    """Extract up to n data points from companyfacts for a given XBRL tag."""
    try:
        units = facts["facts"]["us-gaap"][tag]["units"]
    except KeyError:
        # Try dei taxonomy for shares
        try:
            units = facts["facts"]["dei"][tag]["units"]
        except KeyError:
            return []
    unit_key = "USD" if "USD" in units else ("shares" if "shares" in units else next(iter(units), None))
    if not unit_key:
        return []

    by_key = {}
    for e in units[unit_key]:
        form = e.get("form", "")
        if form not in forms:
            continue
        if quarterly:
            fp = e.get("fp", "")
            if fp not in ("Q1", "Q2", "Q3", "Q4"):
                continue
            key = (e.get("fy", 0), fp)
        else:
            if e.get("fp") != "FY":
                continue
            key = e.get("fy", 0)
        by_key[key] = e

    sorted_entries = sorted(by_key.values(), key=lambda x: x.get("end", ""), reverse=True)
    return [{"fy": e.get("fy"), "end": e.get("end", ""), "val": e["val"], "tag": tag} for e in sorted_entries[:n]]


def _get_field(facts, field_name, forms=ANNUAL_FORMS, n=4, quarterly=False):
    """Try each XBRL tag alias until one returns data."""
    for tag in CONCEPT_MAP.get(field_name, []):
        series = _extract_series(facts, tag, forms, n, quarterly)
        if series:
            return series
    return []


def to_m(val):
    if val is None:
        return 0
    try:
        f = float(val)
        return 0 if (math.isnan(f) or math.isinf(f)) else round(f / 1e6)
    except (ValueError, TypeError):
        return 0


def safe_div(a, b, fallback=0):
    if b is None or b == 0:
        return fallback
    r = a / b
    return r if math.isfinite(r) else fallback


def latest_val_m(series):
    """Get the latest value from a series, converted to $M."""
    if not series:
        return 0
    return to_m(series[0]["val"])


# ─── Yahoo v8 price (no auth needed) ────────────────────────────────────
def yahoo_price(ticker):
    """Fetch current price data from Yahoo v8/chart — no auth required."""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
        r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(r, timeout=6) as resp:
            data = json.loads(resp.read().decode())
        meta = data["chart"]["result"][0]["meta"]
        return {
            "price": meta.get("regularMarketPrice", 0),
            "prevClose": meta.get("chartPreviousClose") or meta.get("previousClose", 0),
            "name": meta.get("longName") or meta.get("shortName") or "",
            "exchange": meta.get("exchangeName", ""),
            "currency": meta.get("currency", "USD"),
        }
    except Exception:
        return {"price": 0, "prevClose": 0, "name": "", "exchange": "", "currency": "USD"}


# ─── 5-factor implied credit rating (S&P methodology) ───────────────────
def ratio_to_rating(leverage, coverage, fcf_to_debt, ebitda_margin, mkt_cap_b):
    def s_lev(x):
        if x <= 0: return 6
        if x < 0.5: return 6
        if x < 1.5: return 5
        if x < 2.0: return 4
        if x < 3.0: return 3
        if x < 4.0: return 2
        if x < 5.5: return 1
        return 0

    def s_cov(x):
        if x > 21: return 6
        if x > 10: return 5
        if x > 6: return 4
        if x > 4: return 3
        if x > 2.5: return 2
        if x > 1.5: return 1
        return 0

    def s_fcf(x):
        if x > 0.50: return 6
        if x > 0.35: return 5
        if x > 0.20: return 4
        if x > 0.10: return 3
        if x > 0.05: return 2
        if x > 0.00: return 1
        return 0

    def s_mar(x):
        if x > 0.30: return 6
        if x > 0.20: return 5
        if x > 0.15: return 4
        if x > 0.10: return 3
        if x > 0.08: return 2
        if x > 0.05: return 1
        return 0

    def s_size(x):
        if x > 100: return 6
        if x > 25: return 5
        if x > 10: return 4
        if x > 5: return 3
        if x > 1: return 2
        if x > 0.3: return 1
        return 0

    composite = (0.35 * s_lev(leverage) + 0.30 * s_cov(coverage) +
                 0.20 * s_fcf(fcf_to_debt) + 0.10 * s_mar(ebitda_margin) +
                 0.05 * s_size(mkt_cap_b))
    for threshold, rating in [
        (5.5, "AAA"), (4.8, "AA"), (4.2, "AA-"), (3.8, "A"), (3.3, "A-"),
        (2.8, "BBB"), (2.3, "BBB-"), (1.8, "BB"), (1.3, "BB-"),
        (0.8, "B"), (0.3, "B-"), (0.0, "CCC"),
    ]:
        if composite >= threshold:
            return rating, round(composite, 2)
    return "CCC", round(composite, 2)


# ─── Main profile generator ─────────────────────────────────────────────
def generate_company_profile(ticker):
    ticker = ticker.upper()

    # Step 1: Resolve CIK (parallel with price fetch)
    cik = None
    yp = {"price": 0, "prevClose": 0, "name": "", "exchange": "", "currency": "USD"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        cik_future = pool.submit(ticker_to_cik, ticker)
        price_future = pool.submit(yahoo_price, ticker)
        cik = cik_future.result(timeout=8)
        yp = price_future.result(timeout=8)

    if not cik:
        return None

    # Step 2: Fetch all EDGAR companyfacts (single HTTP call)
    try:
        facts = _edgar_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    except Exception:
        return None

    entity_name = facts.get("entityName", "") or yp.get("name", "") or ticker

    # Step 3: Extract all financials
    rev_s = _get_field(facts, "revenue")
    ni_s = _get_field(facts, "net_income")
    oi_s = _get_field(facts, "operating_income")
    ie_s = _get_field(facts, "interest_expense")
    tx_s = _get_field(facts, "tax_expense")
    da_s = _get_field(facts, "depreciation")
    sbc_s = _get_field(facts, "sbc")
    restr_s = _get_field(facts, "restructuring")
    ltd_s = _get_field(facts, "total_debt_lt")
    cd_s = _get_field(facts, "current_debt")
    cash_s = _get_field(facts, "cash")
    sti_s = _get_field(facts, "st_investments")
    ta_s = _get_field(facts, "total_assets")
    te_s = _get_field(facts, "total_equity")
    ca_s = _get_field(facts, "current_assets")
    cl_s = _get_field(facts, "current_liab")
    ocf_s = _get_field(facts, "ocf")
    capex_s = _get_field(facts, "capex")

    # Quarterly data for burns
    q_ocf = _get_field(facts, "ocf", forms=QUARTERLY_FORMS, n=4, quarterly=True)
    q_capex = _get_field(facts, "capex", forms=QUARTERLY_FORMS, n=4, quarterly=True)
    q_rev = _get_field(facts, "revenue", forms=QUARTERLY_FORMS, n=4, quarterly=True)

    # Latest annual values (in $M)
    revenue = latest_val_m(rev_s)
    net_income = latest_val_m(ni_s)
    oper_income = latest_val_m(oi_s)
    int_exp = abs(latest_val_m(ie_s))
    tax_exp = latest_val_m(tx_s)
    da = latest_val_m(da_s)
    sbc = latest_val_m(sbc_s)
    restructuring = abs(latest_val_m(restr_s))
    lt_debt = latest_val_m(ltd_s)
    current_debt = latest_val_m(cd_s)
    total_debt = lt_debt + current_debt
    cash = latest_val_m(cash_s)
    st_investments = latest_val_m(sti_s)
    total_assets = latest_val_m(ta_s)
    total_equity = latest_val_m(te_s)
    current_assets = latest_val_m(ca_s)
    current_liab = latest_val_m(cl_s)
    ocf = latest_val_m(ocf_s)
    capex = abs(latest_val_m(capex_s))
    fcf = ocf - capex

    # EBITDA
    gaap_ebitda = oper_income + da if (oper_income and da) else net_income + int_exp + tax_exp + da
    adj_ebitda = gaap_ebitda + sbc + restructuring

    # Ratios
    gross_leverage = round(safe_div(total_debt, adj_ebitda), 1)
    net_leverage = round(safe_div(total_debt - cash, adj_ebitda), 1)
    int_cov = round(safe_div(adj_ebitda, int_exp), 1)
    debt_to_equity = round(safe_div(total_debt, total_equity), 2)
    current_ratio = round(safe_div(current_assets, current_liab), 2)
    roic = round(safe_div(net_income, total_debt + total_equity) * 100, 1) if (total_debt + total_equity) > 0 else 0
    ebitda_margin = safe_div(adj_ebitda, revenue) if revenue > 0 else 0
    fcf_to_debt = safe_div(fcf, total_debt) if total_debt > 0 else 1.0

    # Price
    price = yp["price"]
    prev_close = yp["prevClose"]
    price_chg = round(((price / prev_close) - 1) * 100, 2) if prev_close > 0 and price > 0 else 0

    # Market cap from shares outstanding + price
    shares_s = _get_field(facts, "shares_outstanding")
    shares = shares_s[0]["val"] if shares_s else 0
    mkt_cap = (shares * price) if shares and price else 0
    mkt_cap_b = round(mkt_cap / 1e9, 2) if mkt_cap else 0

    # 5-factor implied rating
    implied_rating, rating_score = ratio_to_rating(
        gross_leverage, int_cov, fcf_to_debt, ebitda_margin, mkt_cap_b
    )

    # Altman Z-Score (kept for reference)
    working_capital = current_assets - current_liab
    total_liabilities = total_assets - total_equity if total_assets > total_equity else 1
    z_score = 0
    if total_assets > 0 and total_liabilities > 0:
        z_score = round(
            1.2 * safe_div(working_capital, total_assets) +
            1.4 * safe_div(total_equity, total_assets) +
            3.3 * safe_div(oper_income, total_assets) +
            0.6 * safe_div(to_m(mkt_cap), total_liabilities) +
            0.999 * safe_div(revenue, total_assets),
        2)

    # Financials array (trailing 4 years)
    financials = []
    for i in range(min(len(rev_s), 4)):
        fy = rev_s[i].get("fy", 2025 - i)
        financials.append({
            "period": f"FY{fy}",
            "rev": to_m(rev_s[i]["val"]) if i < len(rev_s) else 0,
            "ebitda": to_m(oi_s[i]["val"]) + to_m(da_s[i]["val"]) if i < len(oi_s) and i < len(da_s) else 0,
            "ni": to_m(ni_s[i]["val"]) if i < len(ni_s) else 0,
            "debt": to_m(ltd_s[i]["val"]) if i < len(ltd_s) else 0,
            "cash": to_m(cash_s[i]["val"]) if i < len(cash_s) else 0,
        })

    # Quarterly burns
    quarterly_burns = []
    for i in range(min(len(q_ocf), len(q_capex), 4)):
        q_o = to_m(q_ocf[i]["val"])
        q_c = abs(to_m(q_capex[i]["val"]))
        end = q_ocf[i].get("end", "")
        try:
            d = datetime.strptime(end, "%Y-%m-%d")
            q_label = f"Q{((d.month - 1) // 3) + 1} {d.year}"
        except Exception:
            q_label = f"Q{4-i}"
        quarterly_burns.append({
            "q": q_label, "burn": q_o - q_c,
            "note": f"OCF {q_o}M, CapEx {q_c}M",
        })
    quarterly_burns.reverse()

    # adjBurn
    fy_label = str(rev_s[0]["fy"]) if rev_s else "LTM"
    adj_burn = {
        "adjEBITDA": adj_ebitda,
        "adjEBITDA_src": f"FY{fy_label} SEC 10-K: OpInc ({oper_income}M) + D&A ({da}M) + SBC ({sbc}M) + Restructuring ({restructuring}M)",
        "gaapEbitda": gaap_ebitda, "sbc": sbc, "restructuring": restructuring, "otherNonCash": 0,
        "incomeTaxes": tax_exp, "incomeTaxes_src": f"FY{fy_label} 10-K",
        "prefDividends": 0, "prefDividends_src": "N/A",
        "maintCapex": None, "totalCapex": capex, "totalCapex_src": f"FY{fy_label} 10-K",
        "currentLTD": current_debt, "currentLTD_src": f"FY{fy_label} 10-K",
        "intExpCash": int_exp, "intExpCash_src": f"FY{fy_label} 10-K",
    }

    # Rating history (from filing dates)
    rating_history = [{"date": f"FY{fy_label}", "sp": "NR", "moodys": "NR", "fitch": "NR",
                       "event": f"Implied: {implied_rating} (5-factor score: {rating_score})"}]

    # Research placeholder
    research = [{"date": datetime.now().strftime("%Y-%m-%d"), "firm": "5-Factor Model",
                 "action": implied_rating, "pt": 0,
                 "summary": f"Implied {implied_rating}: Leverage {gross_leverage}x, Coverage {int_cov}x, FCF/Debt {fcf_to_debt:.0%}, Margin {ebitda_margin:.0%}"}]

    # Liquidity
    liquidity_breakdown = {
        "totalLiquidity": cash + st_investments,
        "components": [{"category": "Cash & Cash Equivalents", "amount": cash, "type": "cash", "sub": []}],
        "facilities": [], "debtMaturities": [],
    }
    if st_investments > 0:
        liquidity_breakdown["components"].append(
            {"category": "Short-Term Investments", "amount": st_investments, "type": "st_invest", "sub": []})

    # Runway
    qtr_burn = quarterly_burns[-1]["burn"] if quarterly_burns else (round(fcf / 4) if fcf != 0 else 0)
    if qtr_burn > 0:
        runway = "Cash flow positive"
    elif qtr_burn < 0:
        qtrs = round(cash / abs(qtr_burn), 1) if abs(qtr_burn) > 0 else 999
        runway = f"~{qtrs} qtrs at current burn"
    else:
        runway = "N/A"

    # Sector from SEC filing (use SIC if available)
    sector = "N/A"
    try:
        sic_data = _edgar_get(f"https://efts.sec.gov/LATEST/search-index?q=%22{cik.lstrip('0')}%22&dateRange=custom&startdt=2020-01-01&forms=10-K")
        # Fallback: just use entity name
    except Exception:
        pass

    return {
        "id": ticker, "name": entity_name, "sector": sector,
        "sp": "NR", "moodys": "NR", "fitch": "NR",
        "impliedRating": implied_rating, "outlook": "Stable", "watchlist": False,
        "cds5y": None, "cds5yChg": None, "bondSpread": None, "bondSpreadChg": None,
        "eqPrice": price, "eqChg": price_chg, "mktCap": mkt_cap_b,
        "ltDebt": lt_debt, "totalDebt": total_debt, "cash": cash,
        "ebitda": adj_ebitda, "intExp": int_exp, "revenue": revenue,
        "netIncome": net_income, "totalAssets": total_assets, "totalEquity": total_equity,
        "fcf": fcf, "currentAssets": current_assets, "currentLiab": current_liab,
        "grossLeverage": gross_leverage, "netLeverage": net_leverage,
        "intCov": int_cov, "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio, "roic": roic,
        "cashBurnQtr": qtr_burn, "liquidityRunway": runway,
        "quarterlyBurns": quarterly_burns, "adjBurn": adj_burn,
        "liquidityBreakdown": liquidity_breakdown,
        "analystRating": implied_rating, "targetPrice": 0,
        "earningsDate": None, "earningsTime": None,
        "lastEarnings": "", "earningsCallSummary": None,
        "news": [], "ratingHistory": rating_history,
        "research": research, "financials": financials,
        "_generated": True, "_source": "sec_edgar",
        "_generatedAt": datetime.now(timezone.utc).isoformat(),
        "_zScore": z_score, "_ratingScore": rating_score,
        "_cik": cik,
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
            self._respond(400, {"error": "Invalid ticker"})
            return

        if ticker in _company_cache:
            entry = _company_cache[ticker]
            age_hours = (datetime.now() - entry['fetched_at']).total_seconds() / 3600
            if age_hours < CACHE_TTL_HOURS:
                self._respond(200, entry['data'])
                return

        try:
            data = generate_company_profile(ticker)
        except Exception as e:
            self._respond(500, {"error": f"Failed: {str(e)}"})
            return

        if data is None:
            self._respond(404, {"error": f"No SEC filings found for '{ticker}'. Verify the ticker symbol."})
            return

        _company_cache[ticker] = {'data': data, 'fetched_at': datetime.now()}
        self._respond(200, data)

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        if code == 200:
            self.send_header('Cache-Control', 'public, max-age=21600')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())
