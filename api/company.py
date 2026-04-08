"""
Vercel Serverless Function: GET /api/company?ticker=AAPL

Primary: SEC EDGAR XBRL companyfacts API (free, no key, all financials)
Price:   Yahoo Finance v8/chart (free, no auth needed)
Rating:  5-factor S&P-style implied credit rating model

Persistence: When SUPABASE_URL + SUPABASE_ANON_KEY are configured, the
generated profile is also written to Supabase (company_registry as
is_portfolio=FALSE, portfolio_data as a fresh row) so the search history
view and recently_searched view in supabase_schema_v2.sql pick it up.
Persistence is best-effort and never blocks the API response.

Narrative enrichment: When data/narrative_cache/<TICKER>/<accession>.json
exists (produced by scripts/extract-filing-narrative.mjs via the quarterly
GitHub Actions workflow), the response is enriched with LLM-extracted
reconciliationItems, debtMaturities, and earningsCallSummary that XBRL
companyfacts cannot capture. This is the wiring for Phase 3 of the scaling
effort.
"""
import json
import math
import os
import pathlib
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

_company_cache = {}
CACHE_TTL_HOURS = 6
_cik_cache = {}

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')

# Narrative cache populated by scripts/extract-filing-narrative.mjs
_NARRATIVE_DIR = pathlib.Path(__file__).parent.parent / "data" / "narrative_cache"
_NARRATIVE_INDEX_PATH = _NARRATIVE_DIR / "_index.json"

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
    # Granular EBITDA reconciliation add-backs (each pulled live from SEC XBRL)
    "goodwill_impairment": [
        "GoodwillImpairmentLoss",
        "GoodwillAndIntangibleAssetImpairment",
    ],
    "asset_impairment": [
        "AssetImpairmentCharges",
        "ImpairmentOfLongLivedAssetsHeldForUse",
        "ImpairmentOfIntangibleAssetsExcludingGoodwill",
        "ImpairmentOfIntangibleAssetsFinitelived",
    ],
    "acquisition_costs": [
        "BusinessCombinationAcquisitionRelatedCosts",
    ],
    "gain_loss_disposal": [
        "GainLossOnDispositionOfAssets",
        "GainLossOnDispositionOfAssetsNet",
        "GainLossOnSaleOfBusiness",
    ],
    "other_nonop": [
        "OtherNonoperatingIncomeExpense",
    ],
    # Net non-operating income/expense — the single XBRL line that aggregates
    # interest income, investment gains/losses, FX, and "other" non-op. Used
    # to reverse non-op contribution out of the bottom-up EBITDA bridge so
    # the resulting "GAAP EBITDA" reflects operating performance only.
    "nonop_total": [
        "NonoperatingIncomeExpense",
    ],
    "interest_income": [
        "InvestmentIncomeInterest",
        "InterestIncomeOperating",
        "InterestAndDividendIncomeOperating",
    ],
    "gross_profit": ["GrossProfit"],
    "cogs": ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"],
    "rd_expense": ["ResearchAndDevelopmentExpense"],
    "sga_expense": ["SellingGeneralAndAdministrativeExpense"],
    "dividends_common": ["DividendsCommonStockCash", "PaymentsOfDividendsCommonStock"],
    "buybacks": ["StockRepurchasedAndRetiredDuringPeriodValue", "PaymentsForRepurchaseOfCommonStock"],
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
    # Credit facility / line-of-credit concepts
    "loc_capacity": [
        "LineOfCreditFacilityMaximumBorrowingCapacity",
        "LineOfCredit",
    ],
    "loc_remaining": ["LineOfCreditFacilityRemainingBorrowingCapacity"],
    "loc_drawn": ["LongTermLineOfCredit", "LineOfCreditFacilityAmountOutstanding"],
    # Debt maturity schedule
    "debt_mat_y1": ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
    "debt_mat_y2": ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
    "debt_mat_y3": ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"],
    "debt_mat_y4": ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
    "debt_mat_y5": ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"],
    "debt_mat_after5": ["LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
}

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A"}
QUARTERLY_FORMS = {"10-Q", "10-Q/A"}
FILING_FORMS_OF_INTEREST = {"8-K", "10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A"}

# 8-K item number -> human-readable description
EIGHT_K_ITEMS = {
    "1.01": "Entry into a Material Definitive Agreement",
    "1.02": "Termination of a Material Definitive Agreement",
    "1.03": "Bankruptcy or Receivership",
    "2.01": "Completion of Acquisition or Disposition of Assets",
    "2.02": "Results of Operations and Financial Condition",
    "2.03": "Creation of a Direct Financial Obligation",
    "2.04": "Triggering Events for Acceleration or Impairment",
    "2.05": "Costs Associated with Exit or Disposal Activities",
    "2.06": "Material Impairments",
    "3.01": "Notice of Delisting or Failure to Satisfy Listing Rule",
    "3.02": "Unregistered Sales of Equity Securities",
    "3.03": "Material Modifications to Rights of Security Holders",
    "4.01": "Changes in Registrant's Certifying Accountant",
    "4.02": "Non-Reliance on Previously Issued Financial Statements",
    "5.01": "Changes in Control of Registrant",
    "5.02": "Departure or Election of Directors or Officers",
    "5.03": "Amendments to Articles of Incorporation or Bylaws",
    "5.07": "Submission of Matters to a Vote of Security Holders",
    "5.08": "Shareholder Director Nominations",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
    "9.01": "Financial Statements and Exhibits",
}


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



def _fetch_recent_filings(cik):
    """Fetch recent 8-K, 10-K, and 10-Q filings from the EDGAR submissions endpoint.

    Returns a list of filing dicts for filings in the last 12 months, with
    8-K entries enriched with parsed item descriptions.
    """
    try:
        data = _edgar_get(f"https://data.sec.gov/submissions/CIK{cik}.json")
    except Exception:
        return []

    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    descriptions = recent.get("primaryDocDescription", [])
    items_raw = recent.get("items", [])  # present for 8-Ks; empty string otherwise
    accession_nums = recent.get("accessionNumber", [])

    cutoff = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    # 12-month lookback
    cutoff_year = cutoff.year - 1 if cutoff.month > 1 else cutoff.year - 1
    cutoff_str = f"{cutoff.year - 1}-{cutoff.month:02d}-{cutoff.day:02d}"

    result = []
    for i, form in enumerate(forms):
        if form not in FILING_FORMS_OF_INTEREST:
            continue
        filing_date = dates[i] if i < len(dates) else ""
        if filing_date < cutoff_str:
            # submissions are newest-first; once we pass the cutoff we can stop
            break
        description = descriptions[i] if i < len(descriptions) else ""
        accession = accession_nums[i] if i < len(accession_nums) else ""

        entry = {
            "type": form,
            "date": filing_date,
            "description": description or form,
            "accession": accession.replace("-", "") if accession else "",
        }

        # For 8-Ks, parse and expand the item numbers field
        if form == "8-K":
            raw_items = items_raw[i] if i < len(items_raw) else ""
            parsed_items = _parse_8k_items(raw_items)
            if parsed_items:
                entry["items"] = parsed_items

        result.append(entry)

    return result


def _parse_8k_items(raw_items_str):
    """Parse the comma-separated item string from the submissions endpoint.

    Example input:  "1.01,2.03,9.01"
    Returns a list: [{"item": "1.01", "description": "..."}, ...]
    """
    if not raw_items_str:
        return []
    items = []
    for token in str(raw_items_str).split(","):
        token = token.strip()
        if not token:
            continue
        desc = EIGHT_K_ITEMS.get(token, f"Item {token}")
        items.append({"item": token, "description": desc})
    return items


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


def _latest_xbrl_val(facts, tag):
    """Return the most-recent filed value (any form/period) for a point-in-time
    XBRL balance-sheet tag, or None if the tag is absent.

    Credit-facility disclosures use 'instant' context (no start/end span and no
    fp= filter), so they are invisible to _extract_series which requires fp=FY
    or fp=Q*.  This helper scans all entries for the tag and returns the value
    with the latest 'end' date.
    """
    try:
        units = facts["facts"]["us-gaap"][tag]["units"]
    except KeyError:
        return None
    unit_key = "USD" if "USD" in units else next(iter(units), None)
    if not unit_key:
        return None
    entries = [e for e in units[unit_key] if e.get("end")]
    if not entries:
        return None
    best = max(entries, key=lambda e: e.get("end", ""))
    return best["val"]


def _build_credit_facilities(facts):
    """Extract credit-facility data directly from EDGAR XBRL companyfacts and
    return (facilities_list, total_available_m).

    Tags queried
    ------------
    LineOfCreditFacilityMaximumBorrowingCapacity   -> total committed size
    LineOfCreditFacilityRemainingBorrowingCapacity -> undrawn / available
    LongTermLineOfCredit                           -> drawn balance on revolver
    LineOfCreditFacilityCurrentBorrowingCapacity   -> current limit (fallback)
    LettersOfCreditOutstandingAmount               -> LC usage (reduces available)
    """
    committed = _latest_xbrl_val(facts, "LineOfCreditFacilityMaximumBorrowingCapacity")
    available = _latest_xbrl_val(facts, "LineOfCreditFacilityRemainingBorrowingCapacity")
    drawn     = _latest_xbrl_val(facts, "LongTermLineOfCredit")
    cur_cap   = _latest_xbrl_val(facts, "LineOfCreditFacilityCurrentBorrowingCapacity")
    lc_amount = _latest_xbrl_val(facts, "LettersOfCreditOutstandingAmount")

    # Nothing to show if no credit-facility data exists at all
    if all(v is None for v in (committed, available, drawn, cur_cap)):
        return [], 0

    # Prefer maximum borrowing capacity; fall back to current capacity
    committed_val = committed if committed is not None else cur_cap

    # Derive any missing piece from the two others
    if drawn is None and committed_val is not None and available is not None:
        lc = lc_amount if lc_amount is not None else 0
        drawn = committed_val - available - lc
    if available is None and committed_val is not None and drawn is not None:
        lc = lc_amount if lc_amount is not None else 0
        available = committed_val - drawn - lc

    facility = {
        "name": "Revolving Credit Facility",
        "committed": to_m(committed_val) if committed_val is not None else None,
        "drawn":     to_m(drawn)         if drawn     is not None else 0,
        "available": to_m(available)     if available is not None else None,
        "type": "revolver",
    }
    if lc_amount is not None:
        facility["lettersOfCredit"] = to_m(lc_amount)

    total_available_m = to_m(available) if available is not None else 0
    return [facility], total_available_m


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


# ─── Last earnings string from YoY comparison ───────────────────────────
def _compute_last_earnings(rev_s, ni_s):
    """Generate a lastEarnings summary string from YoY revenue/NI comparison."""
    if len(rev_s) < 2:
        return ""
    rev_cur = to_m(rev_s[0]["val"])
    rev_prev = to_m(rev_s[1]["val"])
    if rev_prev == 0:
        return ""
    rev_chg_pct = round((rev_cur - rev_prev) / abs(rev_prev) * 100, 1)
    ni_cur = to_m(ni_s[0]["val"]) if len(ni_s) >= 1 else None
    ni_prev = to_m(ni_s[1]["val"]) if len(ni_s) >= 2 else None
    ni_grew = (ni_cur is not None and ni_prev is not None and ni_cur > ni_prev)
    if rev_chg_pct >= 0:
        sign = "+" if rev_chg_pct > 0 else ""
        if ni_grew:
            return f"Beat \u2014 Revenue ${rev_cur:,}M ({sign}{rev_chg_pct}% YoY), EPS growth"
        else:
            return f"Mixed \u2014 Revenue ${rev_cur:,}M ({sign}{rev_chg_pct}% YoY), earnings pressure"
    else:
        return f"Miss \u2014 Revenue ${rev_cur:,}M ({rev_chg_pct}% YoY decline)"


# ─── Main profile generator ─────────────────────────────────────────────
def generate_company_profile(ticker):
    ticker = ticker.upper()

    # Step 1: Resolve CIK (parallel with price fetch)
    cik = None
    yp = {"price": 0, "prevClose": 0, "name": "", "exchange": "", "currency": "USD"}

    with ThreadPoolExecutor(max_workers=3) as pool:
        cik_future = pool.submit(ticker_to_cik, ticker)
        price_future = pool.submit(yahoo_price, ticker)
        cik = cik_future.result(timeout=8)
        # Submit filings fetch now that CIK is resolved, runs in parallel with price
        filings_future = pool.submit(_fetch_recent_filings, cik) if cik else None
        yp = price_future.result(timeout=8)
        recent_filings = filings_future.result(timeout=12) if filings_future else []

    if not cik:
        return None

    # Step 2: Fetch companyfacts AND submissions in parallel
    def _fetch_facts():
        return _edgar_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")

    def _fetch_submissions():
        return _edgar_get(f"https://data.sec.gov/submissions/CIK{cik}.json")

    facts = None
    submissions = None
    with ThreadPoolExecutor(max_workers=2) as pool:
        facts_future = pool.submit(_fetch_facts)
        submissions_future = pool.submit(_fetch_submissions)
        try:
            facts = facts_future.result(timeout=12)
        except Exception:
            facts = None
        try:
            submissions = submissions_future.result(timeout=12)
        except Exception:
            submissions = None

    if facts is None:
        return None

    entity_name = facts.get("entityName", "") or yp.get("name", "") or ticker

    # Extract company metadata from submissions endpoint
    sic_description = ""
    state_of_incorporation = ""
    entity_type = ""
    fiscal_year_end = ""
    if submissions:
        sic_description = submissions.get("sicDescription", "") or ""
        state_of_incorporation = submissions.get("stateOfIncorporation", "") or ""
        entity_type = submissions.get("entityType", "") or ""
        fiscal_year_end = submissions.get("fiscalYearEnd", "") or ""

    # Step 3: Extract all financials
    rev_s = _get_field(facts, "revenue")
    ni_s = _get_field(facts, "net_income")
    oi_s = _get_field(facts, "operating_income")
    ie_s = _get_field(facts, "interest_expense")
    tx_s = _get_field(facts, "tax_expense")
    da_s = _get_field(facts, "depreciation")
    sbc_s = _get_field(facts, "sbc")
    restr_s = _get_field(facts, "restructuring")
    # Granular EBITDA reconciliation series (live from SEC XBRL companyfacts)
    gw_imp_s = _get_field(facts, "goodwill_impairment")
    asset_imp_s = _get_field(facts, "asset_impairment")
    acq_cost_s = _get_field(facts, "acquisition_costs")
    gain_disp_s = _get_field(facts, "gain_loss_disposal")
    other_nonop_s = _get_field(facts, "other_nonop")
    # Net non-op reversal (preferred single line)
    nonop_total_s = _get_field(facts, "nonop_total")
    int_income_s = _get_field(facts, "interest_income")
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
    gp_s = _get_field(facts, "gross_profit")
    cogs_s = _get_field(facts, "cogs")
    rd_s = _get_field(facts, "rd_expense")
    sga_s = _get_field(facts, "sga_expense")
    div_common_s = _get_field(facts, "dividends_common")
    buybacks_s = _get_field(facts, "buybacks")

    # Credit facility data
    loc_cap_s = _get_field(facts, "loc_capacity")
    loc_rem_s = _get_field(facts, "loc_remaining")
    loc_drawn_s = _get_field(facts, "loc_drawn")

    # Debt maturity schedule
    mat_y1_s = _get_field(facts, "debt_mat_y1")
    mat_y2_s = _get_field(facts, "debt_mat_y2")
    mat_y3_s = _get_field(facts, "debt_mat_y3")
    mat_y4_s = _get_field(facts, "debt_mat_y4")
    mat_y5_s = _get_field(facts, "debt_mat_y5")
    mat_after5_s = _get_field(facts, "debt_mat_after5")

    # Quarterly data for burns (fetch extra entries to support YTD de-cumulation)
    q_ocf = _get_field(facts, "ocf", forms=QUARTERLY_FORMS, n=8, quarterly=True)
    q_capex = _get_field(facts, "capex", forms=QUARTERLY_FORMS, n=8, quarterly=True)
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
    # Granular reconciliation add-backs ($M, signed where meaningful)
    goodwill_impairment = abs(latest_val_m(gw_imp_s))
    asset_impairment = abs(latest_val_m(asset_imp_s))
    acquisition_costs = abs(latest_val_m(acq_cost_s))
    # Disposal: a *gain* (positive XBRL value) reduces EBITDA add-backs; a loss increases.
    gain_loss_disposal = latest_val_m(gain_disp_s)
    # Other non-operating: typically signed; reverse for an EBITDA bridge.
    other_nonop = latest_val_m(other_nonop_s)
    # Net non-operating income/expense (signed): positive = net income from non-op
    nonop_total = latest_val_m(nonop_total_s)
    interest_income = latest_val_m(int_income_s)
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
    gross_profit = latest_val_m(gp_s)
    cogs = latest_val_m(cogs_s)
    rd_expense = latest_val_m(rd_s)
    sga_expense = latest_val_m(sga_s)
    dividends_common = abs(latest_val_m(div_common_s))
    buybacks = abs(latest_val_m(buybacks_s))

    # ─── Granular EBITDA Reconciliation (sourced live from SEC EDGAR XBRL) ────
    # Build a textbook bottom-up EBITDA bridge from the individual us-gaap concepts
    # already fetched above. Each line records the exact XBRL tag and 10-K period
    # so the UI can surface provenance and prove the figure came from SEC filings.
    def _xbrl_src(series):
        if not series:
            return None
        e = series[0]
        return {
            "concept": f"us-gaap:{e.get('tag', '?')}",
            "fy": e.get("fy"),
            "period_end": e.get("end", ""),
            "label": f"SEC EDGAR XBRL — us-gaap:{e.get('tag','?')} (FY{e.get('fy','?')} 10-K, period ending {e.get('end','?')})",
        }

    ebitda_walk = []
    if ni_s:
        ebitda_walk.append({"label": "Net Income", "amount": net_income, "isSubtotal": False, "category": "starting", "source": _xbrl_src(ni_s)})
    if tx_s:
        ebitda_walk.append({"label": "+ Income Tax Expense", "amount": tax_exp, "isSubtotal": False, "category": "tax", "source": _xbrl_src(tx_s)})
    if ie_s:
        ebitda_walk.append({"label": "+ Interest Expense", "amount": int_exp, "isSubtotal": False, "category": "interest", "source": _xbrl_src(ie_s)})
    if da_s:
        ebitda_walk.append({"label": "+ Depreciation & Amortization", "amount": da, "isSubtotal": False, "category": "da", "source": _xbrl_src(da_s)})

    # ─── Non-operating reversal ──────────────────────────────────────────────
    # The bottom-up bridge (NI + Tax + Int + D&A) carries every non-operating
    # income/expense item that hit net income (interest income, investment
    # gains/losses, FX, "other" non-op). To surface a clean *operating* EBITDA
    # we reverse the net non-op line back out. Preferred: the single aggregate
    # us-gaap:NonoperatingIncomeExpense concept. Fallback: sum of the component
    # concepts (interest income + other non-op + disposal gain/loss), used when
    # the issuer's filing doesn't emit the aggregate tag.
    #
    # Sign convention: `nonop_total` is positive when non-op is net INCOME
    # (inflating NI → inflating bottom-up EBITDA). Subtracting it neutralizes
    # the effect. Negative nonop_total (net expense) gets added back.
    if nonop_total_s:
        nonop_reversal = -nonop_total
        nonop_source = _xbrl_src(nonop_total_s)
        nonop_method = "aggregate us-gaap:NonoperatingIncomeExpense"
    else:
        # Fallback: reconstruct from components. Interest income and "other
        # non-op" are the common cases. Gains on disposal are non-op at some
        # issuers; include when NonoperatingIncomeExpense is absent.
        nonop_fallback = interest_income + other_nonop + gain_loss_disposal
        nonop_reversal = -nonop_fallback
        nonop_source = {
            "label": (
                f"Fallback sum: InvestmentIncomeInterest ({interest_income}M) "
                f"+ OtherNonoperatingIncomeExpense ({other_nonop}M) "
                f"+ GainLossOnDispositionOfAssets ({gain_loss_disposal}M)"
            ),
            "concept": "us-gaap:(InvestmentIncomeInterest + OtherNonoperatingIncomeExpense + GainLossOnDispositionOfAssets)",
            "fy": None,
            "period_end": "",
        }
        nonop_method = "component sum (aggregate concept unavailable)"

    if nonop_reversal:
        # Label reflects direction: a reversal of net non-op *income* shows
        # up as a negative line ("− Net Non-Op Income"); reversal of net
        # non-op *expense* shows up as a positive add-back.
        ebitda_walk.append({
            "label": ("− Net Non-Operating Income" if nonop_reversal < 0 else "+ Net Non-Operating Expense"),
            "amount": nonop_reversal,
            "isSubtotal": False,
            "category": "nonop_reversal",
            "source": nonop_source,
        })

    # GAAP EBITDA: bottom-up (NI + Tax + Int + D&A − NonOp) when the 4 core
    # building-blocks are available; fall back to OpInc + D&A otherwise. The
    # bottom-up result now equals Operating Income + D&A when the non-op
    # reversal lines up cleanly, which is the textbook definition.
    gaap_ebitda_bottomup = net_income + tax_exp + int_exp + da + nonop_reversal
    if ni_s and tx_s and ie_s and da_s:
        gaap_ebitda = gaap_ebitda_bottomup
        gaap_ebitda_method = (
            f"bottom-up: NI + Tax + Interest + D&A − NonOp ({nonop_method})"
        )
    elif oper_income and da:
        gaap_ebitda = oper_income + da
        gaap_ebitda_method = "top-down: Operating Income + D&A (2 XBRL concepts)"
    else:
        gaap_ebitda = gaap_ebitda_bottomup
        gaap_ebitda_method = "best-effort from available XBRL fields"
    ebitda_walk.append({
        "label": "= GAAP EBITDA",
        "amount": gaap_ebitda,
        "isSubtotal": True,
        "category": "subtotal",
        "source": {"label": f"Computed ({gaap_ebitda_method})"},
    })

    # Non-GAAP add-backs — each from a distinct SEC XBRL concept.
    # NOTE: `other_nonop` and `gain_loss_disposal` are intentionally NOT added
    # here. They were already reversed above via the non-op reversal line
    # (either through the aggregate NonoperatingIncomeExpense concept or the
    # component-sum fallback). Adding them again would double-count.
    addbacks = []
    if sbc:
        addbacks.append({"label": "+ Stock-Based Compensation", "amount": sbc, "isSubtotal": False, "category": "sbc", "source": _xbrl_src(sbc_s)})
    if restructuring:
        addbacks.append({"label": "+ Restructuring Charges", "amount": restructuring, "isSubtotal": False, "category": "restructuring", "source": _xbrl_src(restr_s)})
    if goodwill_impairment:
        addbacks.append({"label": "+ Goodwill Impairment", "amount": goodwill_impairment, "isSubtotal": False, "category": "impairment", "source": _xbrl_src(gw_imp_s)})
    if asset_impairment:
        addbacks.append({"label": "+ Asset / Intangible Impairment", "amount": asset_impairment, "isSubtotal": False, "category": "impairment", "source": _xbrl_src(asset_imp_s)})
    if acquisition_costs:
        addbacks.append({"label": "+ Acquisition-Related Costs", "amount": acquisition_costs, "isSubtotal": False, "category": "acquisition", "source": _xbrl_src(acq_cost_s)})

    ebitda_walk.extend(addbacks)
    total_addbacks = sum(item["amount"] for item in addbacks)
    adj_ebitda = gaap_ebitda + total_addbacks
    ebitda_walk.append({
        "label": "= Adjusted EBITDA",
        "amount": adj_ebitda,
        "isSubtotal": True,
        "category": "final",
        "source": {"label": f"Computed: GAAP EBITDA + {len(addbacks)} XBRL-sourced adjustments"},
    })

    # Aggregated bucket for the legacy compact view (kept for backwards-compat).
    # Only the clean non-cash / non-recurring items are included here; the
    # non-op reversal is surfaced separately via adjBurn.nonOpReversal so the
    # compact card doesn't double-count items that were already removed above
    # the GAAP EBITDA subtotal.
    other_non_cash_total = (
        goodwill_impairment + asset_impairment + acquisition_costs
    )

    # Ratios
    gross_leverage = round(safe_div(total_debt, adj_ebitda), 1)
    net_leverage = round(safe_div(total_debt - cash, adj_ebitda), 1)
    int_cov = round(safe_div(adj_ebitda, int_exp), 1)
    debt_to_equity = round(safe_div(total_debt, total_equity), 2)
    current_ratio = round(safe_div(current_assets, current_liab), 2)
    roic = round(safe_div(net_income, total_debt + total_equity) * 100, 1) if (total_debt + total_equity) > 0 else 0
    ebitda_margin = safe_div(adj_ebitda, revenue) if revenue > 0 else 0
    fcf_to_debt = safe_div(fcf, total_debt) if total_debt > 0 else 1.0
    # Operating metrics / margin ratios
    # Gross profit may come directly from XBRL; if absent, derive from revenue - COGS
    if gross_profit == 0 and cogs > 0 and revenue > 0:
        gross_profit = revenue - cogs
    gross_margin = round(safe_div(gross_profit, revenue), 4) if revenue > 0 else None
    ebitda_margin_pct = round(ebitda_margin, 4) if revenue > 0 else None
    rd_intensity = round(safe_div(rd_expense, revenue), 4) if revenue > 0 and rd_expense > 0 else None

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
        # Determine per-year EBITDA, guarding against:
        #   1. operator-precedence: wrap addition in parens before the ternary
        #   2. fiscal-year misalignment: verify oi_s and da_s entries share the same FY
        #   3. missing oi_s: fall back to NI + interest + tax + D&A
        oi_aligned = (i < len(oi_s) and oi_s[i].get("fy") == fy)
        da_aligned = (i < len(da_s) and da_s[i].get("fy") == fy)
        if oi_aligned and da_aligned:
            row_ebitda = (to_m(oi_s[i]["val"]) + to_m(da_s[i]["val"]))
        elif da_aligned and (i < len(ni_s) and ni_s[i].get("fy") == fy
                             and i < len(ie_s) and ie_s[i].get("fy") == fy
                             and i < len(tx_s) and tx_s[i].get("fy") == fy):
            row_ebitda = (to_m(ni_s[i]["val"]) + to_m(ie_s[i]["val"])
                          + to_m(tx_s[i]["val"]) + to_m(da_s[i]["val"]))
        else:
            row_ebitda = 0
        financials.append({
            "period": f"FY{fy}",
            "rev": to_m(rev_s[i]["val"]) if i < len(rev_s) else 0,
            "ebitda": row_ebitda,
            "ni": to_m(ni_s[i]["val"]) if i < len(ni_s) else 0,
            "debt": to_m(ltd_s[i]["val"]) if i < len(ltd_s) else 0,
            "cash": to_m(cash_s[i]["val"]) if i < len(cash_s) else 0,
        })

    # ── Trends: YoY changes across the 4-year financials array ─────────────
    # financials[0] is the most recent year; financials[1] is one year prior, etc.
    # YoY %: (current - prior) / abs(prior) * 100, rounded to 1 dp.
    # debtChange / cashChange are absolute $M deltas (current - prior).

    def _yoy_pct(cur, prev):
        """Percent change from prev to cur; None when prior is zero."""
        if prev == 0:
            return None
        return round((cur - prev) / abs(prev) * 100, 1)

    revenue_growth, ebitda_growth, debt_change, cash_change, leverage_change, margin_trend = (
        [], [], [], [], [], []
    )

    for i in range(len(financials) - 1):
        cur = financials[i]        # more recent
        prev = financials[i + 1]   # one year earlier
        period = cur["period"]

        revenue_growth.append({"period": period, "yoy": _yoy_pct(cur["rev"], prev["rev"])})
        ebitda_growth.append({"period": period, "yoy": _yoy_pct(cur["ebitda"], prev["ebitda"])})
        debt_change.append({"period": period, "change": cur["debt"] - prev["debt"]})
        cash_change.append({"period": period, "change": cur["cash"] - prev["cash"]})

        # Per-year leverage ratio = debt / ebitda (gross, no cash netting)
        cur_lev = round(safe_div(cur["debt"], cur["ebitda"]), 2) if cur["ebitda"] != 0 else None
        prev_lev = round(safe_div(prev["debt"], prev["ebitda"]), 2) if prev["ebitda"] != 0 else None
        lev_delta = (
            round(cur_lev - prev_lev, 2) if (cur_lev is not None and prev_lev is not None) else None
        )
        leverage_change.append({"period": period, "change": lev_delta})

    # marginTrend: one entry per year (no prior period needed)
    for row in financials:
        margin = round(safe_div(row["ebitda"], row["rev"]), 4) if row["rev"] != 0 else None
        margin_trend.append({"period": row["period"], "margin": margin})

    trends = {
        "revenueGrowth": revenue_growth,
        "ebitdaGrowth": ebitda_growth,
        "debtChange": debt_change,
        "cashChange": cash_change,
        "leverageChange": leverage_change,
        "marginTrend": margin_trend,
    }

    # ── creditTrend: "Improving" / "Deteriorating" / "Stable" ────────────
    # Compares the most-recent year (index 0) against the prior year (index 1).
    #   Improving    : leverage declining  AND  coverage increasing
    #   Deteriorating: leverage increasing AND  coverage declining
    #   Stable       : everything else
    credit_trend = "Stable"
    if leverage_change and len(financials) >= 2:
        latest_lev_chg = leverage_change[0]["change"]

        # Per-year interest expense for coverage; fall back to latest if FY misaligns.
        def _row_int_exp(idx):
            if idx < len(ie_s):
                fy_str = financials[idx]["period"][2:]   # "FY2024" -> "2024"
                if str(ie_s[idx].get("fy", "")) == fy_str:
                    return abs(to_m(ie_s[idx]["val"]))
            return int_exp  # fallback: latest year's interest expense

        cur_int = _row_int_exp(0)
        prev_int = _row_int_exp(1)
        cur_cov = safe_div(financials[0]["ebitda"], cur_int) if cur_int != 0 else None
        prev_cov = safe_div(financials[1]["ebitda"], prev_int) if prev_int != 0 else None

        lev_declining = (latest_lev_chg is not None and latest_lev_chg < 0)
        lev_increasing = (latest_lev_chg is not None and latest_lev_chg > 0)
        cov_increasing = (cur_cov is not None and prev_cov is not None and cur_cov > prev_cov)
        cov_declining = (cur_cov is not None and prev_cov is not None and cur_cov < prev_cov)

        if lev_declining and cov_increasing:
            credit_trend = "Improving"
        elif lev_increasing and cov_declining:
            credit_trend = "Deteriorating"

    # Quarterly burns - de-cumulate YTD cash flow values from 10-Q filings.
    # EDGAR reports Q2 OCF as Jan-Jun cumulative and Q3 as Jan-Sep cumulative.
    # Subtract the prior quarter's cumulative to recover single-quarter values.
    # Fall back to annual/4 if fewer than 2 individual quarters are available.
    def _decumulate_quarterly(series):
        """Convert raw XBRL quarterly entries (potentially YTD cumulative) into
        single-quarter dicts. Returns a list sorted newest-first."""
        # Build a lookup of (fy, qnum) -> entry so we can subtract prior cumulative.
        by_fy_q = {}
        for e in series:
            end = e.get("end", "")
            try:
                d = datetime.strptime(end, "%Y-%m-%d")
                qnum = ((d.month - 1) // 3) + 1  # 1-based quarter number
            except Exception:
                continue
            fy = e.get("fy", 0)
            # Keep the latest filing for a given (fy, qnum) key
            existing = by_fy_q.get((fy, qnum))
            if existing is None or e["end"] > existing["end"]:
                by_fy_q[(fy, qnum)] = dict(e, qnum=qnum)

        results = []
        for (fy, qnum), e in by_fy_q.items():
            ytd_val = e["val"]
            if qnum == 1:
                # Q1 is already a single quarter in EDGAR 10-Q filings
                single_val = ytd_val
            else:
                # Subtract the prior quarter's YTD cumulative to isolate this quarter
                prior = by_fy_q.get((fy, qnum - 1))
                if prior is not None:
                    single_val = ytd_val - prior["val"]
                else:
                    # Prior quarter not available; use the YTD value as-is
                    single_val = ytd_val
            results.append({
                "fy": fy, "qnum": qnum, "end": e["end"],
                "val": single_val, "tag": e.get("tag", ""),
            })

        results.sort(key=lambda x: x["end"], reverse=True)
        return results

    dq_ocf = _decumulate_quarterly(q_ocf)
    dq_capex = _decumulate_quarterly(q_capex)

    # Align OCF and CapEx on matching (fy, qnum) periods and build burn list
    capex_by_period = {(e["fy"], e["qnum"]): e for e in dq_capex}

    quarterly_burns = []
    for e_ocf in dq_ocf:
        period_key = (e_ocf["fy"], e_ocf["qnum"])
        e_cap = capex_by_period.get(period_key)
        if e_cap is None:
            continue
        q_o = to_m(e_ocf["val"])
        q_c = abs(to_m(e_cap["val"]))
        end = e_ocf["end"]
        try:
            d = datetime.strptime(end, "%Y-%m-%d")
            q_label = f"Q{e_ocf['qnum']} {d.year}"
        except Exception:
            q_label = f"Q{e_ocf['qnum']} {e_ocf['fy']}"
        quarterly_burns.append({
            "q": q_label, "burn": q_o - q_c,
            "note": f"OCF {q_o}M, CapEx {q_c}M",
        })
        if len(quarterly_burns) == 4:
            break

    # quarterly_burns is newest-first at this point; reverse to chronological order
    quarterly_burns.reverse()

    # Sparse data fallback: approximate using latest annual OCF and CapEx divided by 4
    if len(quarterly_burns) < 2 and ocf != 0:
        approx_burn = round((ocf - capex) / 4)
        fy_label_q = str(rev_s[0]["fy"]) if rev_s else "LTM"
        quarterly_burns = [
            {
                "q": f"Q{q} {fy_label_q}",
                "burn": approx_burn,
                "note": f"Annual/4 estimate (OCF {ocf}M, CapEx {capex}M)",
            }
            for q in range(1, 5)
        ]

    # adjBurn
    fy_label = str(rev_s[0]["fy"]) if rev_s else "LTM"
    adj_burn = {
        "adjEBITDA": adj_ebitda,
        "adjEBITDA_src": (
            f"SEC EDGAR XBRL companyfacts (CIK{cik}) — FY{fy_label}: "
            f"GAAP EBITDA via {gaap_ebitda_method} ({gaap_ebitda}M) "
            f"+ {len(addbacks)} non-GAAP add-backs = {adj_ebitda}M"
        ),
        "gaapEbitda": gaap_ebitda, "sbc": sbc, "restructuring": restructuring,
        "otherNonCash": other_non_cash_total,
        "goodwillImpairment": goodwill_impairment,
        "assetImpairment": asset_impairment,
        "acquisitionCosts": acquisition_costs,
        "gainLossDisposal": gain_loss_disposal,
        "otherNonOp": other_nonop,
        "interestIncome": interest_income,
        "nonOpTotal": nonop_total,
        "nonOpReversal": nonop_reversal,
        "nonOpReversalMethod": nonop_method,
        # Granular GAAP→Adjusted EBITDA bridge sourced live from SEC XBRL.
        # Each entry carries the exact us-gaap concept and 10-K period.
        "reconciliationWalk": ebitda_walk,
        "reconciliationSource": {
            "provider": "SEC EDGAR XBRL companyfacts API",
            "endpoint": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
            "cik": cik,
            "fy": fy_label,
            "method": gaap_ebitda_method,
        },
        "incomeTaxes": tax_exp, "incomeTaxes_src": f"FY{fy_label} 10-K",
        "prefDividends": 0, "prefDividends_src": "N/A",
        "maintCapex": None, "totalCapex": capex, "totalCapex_src": f"FY{fy_label} 10-K",
        "currentLTD": current_debt, "currentLTD_src": f"FY{fy_label} 10-K",
        "intExpCash": int_exp, "intExpCash_src": f"FY{fy_label} 10-K",
    }

    # Rating history (from filing dates)
    rating_history = [{"date": f"FY{fy_label}", "sp": "NR", "moodys": "NR", "fitch": "NR",
                       "event": f"Implied: {implied_rating} (5-factor score: {rating_score})"}]

    # ── Earnings call summary (generated from SEC financial data) ────────────
    def _fmt_m(val_m):
        """Format a $M integer as $XXM or $X.XB."""
        abs_v = abs(val_m)
        if abs_v >= 1000:
            sign = "-" if val_m < 0 else ""
            return f"{sign}${abs_v / 1000:.1f}B"
        return f"${val_m:,.0f}M"

    def _pct(val, decimals=1):
        return f"{val * 100:.{decimals}f}%"

    # Determine filing period label from the latest revenue data point
    latest_fy = rev_s[0]["fy"] if rev_s else datetime.now().year
    latest_end = rev_s[0]["end"] if rev_s else ""
    try:
        end_dt = datetime.strptime(latest_end, "%Y-%m-%d")
        cal_q = ((end_dt.month - 1) // 3) + 1
        ecs_quarter = f"Q{cal_q} FY{latest_fy}"
        ecs_date = latest_end
    except Exception:
        ecs_quarter = f"FY{latest_fy}"
        ecs_date = f"{latest_fy}-12-31"

    # YoY revenue growth
    rev_yoy_str = ""
    if len(rev_s) >= 2 and rev_s[1]["val"]:
        prior_rev = to_m(rev_s[1]["val"])
        if prior_rev != 0:
            rev_yoy = (revenue - prior_rev) / abs(prior_rev)
            direction = "up" if rev_yoy >= 0 else "down"
            rev_yoy_str = f", {direction} {abs(rev_yoy) * 100:.1f}% YoY"

    # YoY net income growth
    ni_yoy_str = ""
    if len(ni_s) >= 2 and ni_s[1]["val"]:
        prior_ni = to_m(ni_s[1]["val"])
        if prior_ni != 0:
            ni_yoy = (net_income - prior_ni) / abs(prior_ni)
            direction = "up" if ni_yoy >= 0 else "down"
            ni_yoy_str = f", {direction} {abs(ni_yoy) * 100:.1f}% YoY"

    # keyFinancials -- top-line P&L metrics
    ecs_key_financials = []
    if revenue:
        ecs_key_financials.append(f"Revenue of {_fmt_m(revenue)}{rev_yoy_str}")
    if adj_ebitda:
        margin_str = f", margin {_pct(ebitda_margin)}" if revenue else ""
        ecs_key_financials.append(f"Adjusted EBITDA of {_fmt_m(adj_ebitda)}{margin_str}")
    if net_income:
        ecs_key_financials.append(f"Net income of {_fmt_m(net_income)}{ni_yoy_str}")
    if oper_income:
        op_margin = safe_div(oper_income, revenue)
        ecs_key_financials.append(
            f"Operating income of {_fmt_m(oper_income)}" +
            (f", margin {_pct(op_margin)}" if revenue else "")
        )

    # production -- cash generation (UI section label: "Production & deliveries")
    ecs_production = []
    if ocf:
        ecs_production.append(f"Operating cash flow of {_fmt_m(ocf)}")
    if capex:
        ecs_production.append(f"Capital expenditures of {_fmt_m(capex)}")
    if fcf != 0:
        ecs_production.append(f"Free cash flow of {_fmt_m(fcf)}")
    if da:
        ecs_production.append(f"Depreciation & amortization of {_fmt_m(da)}")

    # creditRelevant -- debt, coverage, and leverage
    ecs_credit = []
    if total_debt:
        ecs_credit.append(f"Total debt of {_fmt_m(total_debt)}, gross leverage {gross_leverage:.1f}x")
    if int_exp:
        ecs_credit.append(f"Interest expense of {_fmt_m(int_exp)}, coverage ratio {int_cov:.1f}x")
    if total_debt and cash:
        ecs_credit.append(
            f"Net leverage {net_leverage:.1f}x (cash of {_fmt_m(cash)} netted against debt)"
        )
    if total_debt:
        capacity_label = "strong" if fcf_to_debt > 0.15 else ("moderate" if fcf_to_debt > 0.05 else "limited")
        ecs_credit.append(
            f"FCF / total debt {_pct(fcf_to_debt)}, debt service capacity {capacity_label}"
        )
    if debt_to_equity:
        ecs_credit.append(f"Debt-to-equity ratio {debt_to_equity:.2f}x")

    # strategicItems -- liquidity and balance-sheet positioning
    ecs_strategic = []
    if cash:
        cash_line = f"Cash & equivalents of {_fmt_m(cash)}"
        if st_investments:
            cash_line += f" plus {_fmt_m(st_investments)} short-term investments"
        ecs_strategic.append(cash_line)
    if current_ratio:
        liq_label = "strong" if current_ratio > 1.5 else ("adequate" if current_ratio >= 1.0 else "tight")
        ecs_strategic.append(f"Current ratio {current_ratio:.2f}x, near-term liquidity {liq_label}")
    if roic:
        ecs_strategic.append(f"Return on invested capital (ROIC) {roic:.1f}%")
    if total_assets:
        ecs_strategic.append(
            f"Total assets of {_fmt_m(total_assets)}" +
            (f", book equity of {_fmt_m(total_equity)}" if total_equity else "")
        )

    earnings_call_summary = None
    if ecs_key_financials or ecs_production or ecs_credit or ecs_strategic:
        earnings_call_summary = {
            "quarter": ecs_quarter,
            "date": ecs_date,
            "source": "SEC 10-K/10-Q filing analysis",
            "keyFinancials": ecs_key_financials,
            "production": ecs_production,
            "creditRelevant": ecs_credit,
            "strategicItems": ecs_strategic,
            "analystQA": [],
        }

    # Runway (computed early because research entries reference it)
    qtr_burn = quarterly_burns[-1]["burn"] if quarterly_burns else (round(fcf / 4) if fcf != 0 else 0)
    if qtr_burn > 0:
        runway = "Cash flow positive"
    elif qtr_burn < 0:
        qtrs = round(cash / abs(qtr_burn), 1) if abs(qtr_burn) > 0 else 999
        runway = f"~{qtrs} qtrs at current burn"
    else:
        runway = "N/A"

    # Research entries — 4 synthetic analyst-style assessments derived from financials
    _today = datetime.now().strftime("%Y-%m-%d")

    # 1. Credit Assessment
    _credit_summary = (
        f"5-factor credit model score {rating_score}: Leverage {gross_leverage}x, "
        f"Coverage {int_cov}x, FCF/Debt {fcf_to_debt:.0%}, "
        f"EBITDA margin {ebitda_margin:.0%}, Market cap ${mkt_cap_b}B. "
        f"Altman Z-Score {z_score}."
    )

    # 2. Liquidity Analysis
    _loc_cap = latest_val_m(loc_cap_s)
    _loc_rem = latest_val_m(loc_rem_s)
    _loc_drawn = latest_val_m(loc_drawn_s)
    if _loc_rem == 0 and _loc_cap > 0 and _loc_drawn > 0:
        _loc_rem = max(0, _loc_cap - _loc_drawn)
    _avail_liq = (cash + st_investments) + _loc_rem
    if current_ratio >= 1.5 and (cash + st_investments) > 0:
        _liq_action = "Strong"
    elif current_ratio >= 1.0 and (cash + st_investments) > 0:
        _liq_action = "Adequate"
    else:
        _liq_action = "Weak"
    _liq_summary = (
        f"Cash ${cash:,}M"
        + (f" + ST investments ${st_investments:,}M" if st_investments > 0 else "")
        + (f" + undrawn revolver ${_loc_rem:,}M" if _loc_rem > 0 else
           (f" + revolver capacity ${_loc_cap:,}M" if _loc_cap > 0 else ""))
        + f" = available liquidity ${_avail_liq:,}M. "
        f"Current ratio {current_ratio}x. Runway: {runway}."
    )

    # 3. Debt Structure
    _near_y1 = latest_val_m(mat_y1_s)
    _near_y2 = latest_val_m(mat_y2_s)
    _near_2y = _near_y1 + _near_y2
    if _near_2y > adj_ebitda or gross_leverage > 4.0:
        _debt_action = "High Risk"
    elif _near_2y > adj_ebitda * 0.5 or gross_leverage > 2.5:
        _debt_action = "Medium Risk"
    else:
        _debt_action = "Low Risk"
    _debt_summary = (
        f"Total debt ${total_debt:,}M ({lt_debt:,}M LT + {current_debt:,}M current). "
        + (f"Near-term maturities Y1 ${_near_y1:,}M, Y2 ${_near_y2:,}M. "
           if _near_y1 > 0 or _near_y2 > 0 else "")
        + f"Gross leverage {gross_leverage}x, net leverage {net_leverage}x, "
        f"debt/equity {debt_to_equity}x."
    )

    # 4. Earnings Trend
    _rev_cur = to_m(rev_s[0]["val"]) if len(rev_s) >= 1 else 0
    _rev_prev = to_m(rev_s[1]["val"]) if len(rev_s) >= 2 else 0
    _rev_chg = round(safe_div(_rev_cur - _rev_prev, abs(_rev_prev)) * 100, 1) if _rev_prev != 0 else 0
    _ni_cur = to_m(ni_s[0]["val"]) if len(ni_s) >= 1 else 0
    _ni_prev = to_m(ni_s[1]["val"]) if len(ni_s) >= 2 else 0
    if _rev_chg > 5 and _ni_cur >= _ni_prev:
        _trend_action = "Improving"
    elif _rev_chg < -5 or (_ni_cur < _ni_prev and _rev_chg < 0):
        _trend_action = "Declining"
    else:
        _trend_action = "Stable"
    _trend_summary = (
        f"Revenue ${_rev_cur:,}M"
        + (f" ({'+' if _rev_chg >= 0 else ''}{_rev_chg}% YoY)" if _rev_prev > 0 else "")
        + f", Adj. EBITDA ${adj_ebitda:,}M (margin {ebitda_margin:.0%})"
        + f", FCF ${fcf:,}M"
        + (f", net income ${_ni_cur:,}M" if _ni_cur != 0 else "")
        + f". ROIC {roic}%."
    )

    research = [
        {"date": _today, "firm": "Credit Model",
         "action": f"{implied_rating} (Implied)", "pt": 0,
         "summary": _credit_summary},
        {"date": _today, "firm": "Liquidity Model",
         "action": _liq_action, "pt": 0,
         "summary": _liq_summary},
        {"date": _today, "firm": "Debt Analysis",
         "action": _debt_action, "pt": 0,
         "summary": _debt_summary},
        {"date": _today, "firm": "Trend Analysis",
         "action": _trend_action, "pt": 0,
         "summary": _trend_summary},
    ]

    # Debt maturities — derive base calendar year from the balance-sheet end date of
    # the most recently filed maturity entry (Year 1 = base_year + 1, etc.).
    _mat_slots = [
        (mat_y1_s,     "Year 1",      1),
        (mat_y2_s,     "Year 2",      2),
        (mat_y3_s,     "Year 3",      3),
        (mat_y4_s,     "Year 4",      4),
        (mat_y5_s,     "Year 5",      5),
        (mat_after5_s, "After Year 5", 6),
    ]
    # Determine base year from the first non-empty maturity series
    _base_year = None
    for _s, _, _ in _mat_slots:
        if _s and _s[0].get("end"):
            try:
                _base_year = int(_s[0]["end"][:4])
            except (ValueError, TypeError):
                pass
            break
    if _base_year is None and rev_s and rev_s[0].get("fy"):
        _base_year = int(rev_s[0]["fy"])  # fallback: use latest fiscal year
    debt_maturities = []
    for _s, _label, _offset in _mat_slots:
        _amt = latest_val_m(_s)
        if _amt == 0:
            continue
        _year_str = str(_base_year + _offset) if _base_year else ""
        debt_maturities.append({"year": _year_str, "amount": _amt, "label": _label})

    # Credit facilities — use _build_credit_facilities which reads point-in-time
    # XBRL tags directly (credit facility disclosures use instant/balance-sheet
    # context, so _get_field / _extract_series miss them entirely).
    credit_facilities, fac_available_m = _build_credit_facilities(facts)

    # Liquidity — totalLiquidity includes undrawn revolver capacity
    liquidity_breakdown = {
        "totalLiquidity": cash + st_investments + fac_available_m,
        "components": [{"category": "Cash & Cash Equivalents", "amount": cash, "type": "cash", "sub": []}],
        "facilities": credit_facilities, "debtMaturities": debt_maturities,
    }
    if st_investments > 0:
        liquidity_breakdown["components"].append(
            {"category": "Short-Term Investments", "amount": st_investments, "type": "st_invest", "sub": []})
    if fac_available_m > 0:
        liquidity_breakdown["components"].append(
            {"category": "Undrawn Revolving Credit Facility", "amount": fac_available_m,
             "type": "revolver", "sub": []})


    # Sector: use sicDescription from the submissions endpoint
    sector = sic_description or "N/A"

    return {
        "id": ticker, "name": entity_name, "sector": sector,
        "stateOfIncorporation": state_of_incorporation,
        "entityType": entity_type,
        "fiscalYearEnd": fiscal_year_end,
        "sp": "NR", "moodys": "NR", "fitch": "NR",
        "impliedRating": implied_rating, "outlook": "Stable", "watchlist": False,
        "cds5y": None, "cds5yChg": None, "bondSpread": None, "bondSpreadChg": None,
        "eqPrice": price, "eqChg": price_chg, "mktCap": mkt_cap_b,
        "ltDebt": lt_debt, "totalDebt": total_debt, "cash": cash,
        "ebitda": adj_ebitda, "intExp": int_exp, "revenue": revenue,
        "netIncome": net_income, "totalAssets": total_assets, "totalEquity": total_equity,
        "fcf": fcf, "currentAssets": current_assets, "currentLiab": current_liab,
        # Operating metrics
        "grossProfit": gross_profit or None,
        "cogs": cogs or None,
        "rdExpense": rd_expense or None,
        "sgaExpense": sga_expense or None,
        "dividendsPaid": dividends_common or None,
        "buybacksPaid": buybacks or None,
        # Derived margin ratios (0–1 fractions; None when revenue unavailable)
        "grossMargin": gross_margin,
        "ebitdaMargin": ebitda_margin_pct,
        "rdIntensity": rd_intensity,
        "grossLeverage": gross_leverage, "netLeverage": net_leverage,
        "intCov": int_cov, "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio, "roic": roic,
        "cashBurnQtr": qtr_burn, "liquidityRunway": runway,
        "quarterlyBurns": quarterly_burns, "adjBurn": adj_burn,
        "liquidityBreakdown": liquidity_breakdown,
        "creditFacilities": credit_facilities,
        "analystRating": implied_rating, "targetPrice": 0,
        "earningsDate": None, "earningsTime": None,
        "lastEarnings": _compute_last_earnings(rev_s, ni_s), "earningsCallSummary": earnings_call_summary,
        "news": [], "ratingHistory": rating_history,
        "research": research, "financials": financials,
        "trends": trends, "creditTrend": credit_trend,
        "_generated": True, "_source": "sec_edgar",
        "_generatedAt": datetime.now(timezone.utc).isoformat(),
        "_zScore": z_score, "_ratingScore": rating_score,
        "_cik": cik,
        "_recentFilings": recent_filings,
    }


def _load_narrative_cache(ticker):
    """Read the latest LLM-extracted narrative cache for a ticker, if any.

    Looks up the ticker in data/narrative_cache/_index.json (managed by
    scripts/extract-filing-narrative.mjs), then loads the per-accession
    JSON file. Returns the parsed dict or None if no cache exists.

    Schema reference: scripts/extract-filing-narrative.mjs payload shape.
    """
    try:
        index = json.loads(_NARRATIVE_INDEX_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    entry = index.get(ticker.upper())
    if not entry or not entry.get("cache_path"):
        return None
    cache_file = pathlib.Path(__file__).parent.parent / entry["cache_path"]
    try:
        return json.loads(cache_file.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _enrich_with_narrative(profile, ticker):
    """Merge LLM-extracted narrative fields into a generated profile.

    Best-effort: only fills in fields that the narrative cache actually has.
    Never blanks out structured XBRL data. Adds an `_enriched_by_narrative`
    sentinel + accession provenance so the frontend can render a
    "narrative-enriched" badge if desired.
    """
    cache = _load_narrative_cache(ticker)
    if not cache:
        return profile

    accession = cache.get("accession", "")
    src_tag = f"LLM-extracted from {cache.get('form', '10-K')} (accession {accession}) by {cache.get('model', 'claude')}"

    # 1. reconciliationItems → adjBurn.reconciliationItems
    recon = cache.get("reconciliationItems") or []
    if recon:
        profile.setdefault("adjBurn", {})
        profile["adjBurn"]["reconciliationItems"] = recon
        # Also bucket into restructuring + otherNonCash so the existing UI
        # reconciliation card renders the LLM-extracted items. Mirrors the
        # GT data quality fix bucketing convention.
        restructuring_keywords = (
            "impair", "rationalization", "restructur", "severance",
            "pension", "forward", "transformation",
        )
        restructuring_total = 0
        other_total = 0
        for item in recon:
            label = (item.get("label") or "").lower()
            amt = item.get("amount") or 0
            if any(k in label for k in restructuring_keywords):
                restructuring_total += amt
            else:
                other_total += amt
        if restructuring_total:
            profile["adjBurn"]["restructuring"] = restructuring_total
            profile["adjBurn"]["restructuring_src"] = src_tag
        if other_total:
            profile["adjBurn"]["otherNonCash"] = other_total
            profile["adjBurn"]["otherNonCash_src"] = src_tag

    # 2. debtMaturities → liquidityBreakdown.debtMaturities (only if XBRL gave us nothing)
    nb_maturities = cache.get("debtMaturities") or []
    if nb_maturities:
        lb = profile.setdefault("liquidityBreakdown", {})
        existing_maturities = lb.get("debtMaturities") or []
        # Only override if the structured pipeline didn't find anything.
        # The LLM-extracted version usually has richer descriptions.
        if not existing_maturities:
            lb["debtMaturities"] = nb_maturities
            lb["debtMaturities_src"] = src_tag

    # 3. earningsCallSummary — overlay only when XBRL-derived summary is sparse
    ecs = cache.get("earningsCallSummary")
    if ecs:
        existing = profile.get("earningsCallSummary") or {}
        # Prefer LLM bullets when the auto-generated ones are empty
        merged = {
            "quarter": existing.get("quarter") or ecs.get("quarter", ""),
            "date": existing.get("date") or "",
            "source": ecs.get("source", "10-K MD&A (LLM-extracted)"),
            "keyFinancials": existing.get("keyFinancials") or ecs.get("keyFinancials") or [],
            "production": existing.get("production") or [],
            "creditRelevant": existing.get("creditRelevant") or ecs.get("creditRelevant") or [],
            "strategicItems": existing.get("strategicItems") or ecs.get("strategicItems") or [],
            "analystQA": existing.get("analystQA") or ecs.get("analystQA") or [],
        }
        profile["earningsCallSummary"] = merged

    profile["_enriched_by_narrative"] = {
        "accession": accession,
        "form": cache.get("form", ""),
        "model": cache.get("model", ""),
        "extracted_at": cache.get("extracted_at", ""),
    }
    return profile


def _persist_to_supabase(ticker, profile):
    """Best-effort persistence of an /api/company profile to Supabase.

    Writes two rows:
    1. company_registry: upserts the ticker with is_portfolio=FALSE so it
       appears in the search_history / recently_searched views without
       polluting the curated portfolio. Existing rows (e.g. portfolio
       tickers re-fetched ad-hoc) are not flipped to is_portfolio=FALSE.
    2. portfolio_data: appends a fresh fiscal-year row with the full
       generated JSON so the latest_portfolio view returns it.

    Schema reference: scripts/supabase_schema_v2.sql.

    Failures are logged and swallowed — never blocks the API response.
    """
    if not (SUPABASE_URL and SUPABASE_KEY):
        return
    try:
        import requests
    except ImportError:
        return

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
    fy = None
    if profile.get("financials") and len(profile["financials"]) > 0:
        period = profile["financials"][0].get("period", "")
        try:
            fy = int(period.replace("FY", ""))
        except (ValueError, AttributeError):
            fy = None
    if fy is None:
        fy = datetime.now(timezone.utc).year

    try:
        # Register the ticker (idempotent — ignore-duplicates means existing
        # portfolio rows are NOT downgraded to is_portfolio=FALSE).
        requests.post(
            f"{SUPABASE_URL}/rest/v1/company_registry",
            json={
                "ticker": ticker,
                "name": profile.get("name", ""),
                "sector": profile.get("sector", ""),
                "cik": profile.get("_cik", ""),
                "is_portfolio": False,
                "is_public": True,
                "added_by": "api/company",
            },
            headers=headers,
            timeout=5,
        )
    except Exception:
        pass

    try:
        # Append a fresh portfolio_data row for this fiscal year.
        requests.post(
            f"{SUPABASE_URL}/rest/v1/portfolio_data",
            json={
                "ticker": ticker,
                "fiscal_year": fy,
                "data_json": json.dumps(profile, default=str),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            },
            headers={**headers, "Prefer": "return=minimal"},
            timeout=5,
        )
    except Exception:
        pass


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

        # Phase 3: enrich with LLM-extracted narrative cache when available
        try:
            data = _enrich_with_narrative(data, ticker)
        except Exception:
            # Never let narrative enrichment break the API response
            pass

        _company_cache[ticker] = {'data': data, 'fetched_at': datetime.now()}
        # Best-effort persistence to Supabase (no-op when env vars are unset)
        try:
            _persist_to_supabase(ticker, data)
        except Exception:
            pass
        self._respond(200, data)

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        if code == 200:
            self.send_header('Cache-Control', 'public, max-age=21600')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())
