#!/usr/bin/env python3
"""
Credit Risk Data Fetcher — Tiered Fallback Architecture
=========================================================
EDGAR (SEC XBRL) → Financial Modeling Prep → Yahoo Finance

Pulls verified financial data for adjusted cash burn analysis.
Every data point is tagged with its source and verification status.

Usage:
    python credit_data_fetcher.py --tickers LCID RIVN
    python credit_data_fetcher.py --tickers LCID RIVN --fmp-key YOUR_API_KEY
    python credit_data_fetcher.py --tickers LCID --output lcid_data.json

Requirements:
    pip install requests yfinance pandas
"""

import argparse
import json
import logging
import pathlib
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from typing import Optional, Dict, List, Any

# ─── CONFIGURATION ──────────────────────────────────────────────────────────
EDGAR_BASE = "https://data.sec.gov"
EDGAR_SUBMISSIONS = f"{EDGAR_BASE}/submissions"
EDGAR_COMPANY_FACTS = f"{EDGAR_BASE}/api/xbrl/companyfacts"
FMP_BASE = "https://financialmodelingprep.com/api/v3"
EDGAR_HEADERS = {
    "User-Agent": "CreditRiskMonitor/1.0 (credit.risk@example.com)",
    "Accept": "application/json",
}

# CIK mapping for our portfolio companies — loaded from data/cik_map.json so
# this Python daily fetcher and scripts/fetch-edgar.mjs (the Node quarterly
# refresh) share a single source of truth. To add a new ticker, edit
# data/cik_map.json; no code changes needed here.
_CIK_MAP_PATH = pathlib.Path(__file__).resolve().parent.parent / "data" / "cik_map.json"
CIK_MAP: Dict[str, str] = json.loads(_CIK_MAP_PATH.read_text())

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


# ─── DATA MODEL ─────────────────────────────────────────────────────────────
@dataclass
class SourcedValue:
    """A financial value with full provenance tracking."""
    value: Optional[float] = None
    source: str = "unverified"          # "EDGAR", "FMP", "Yahoo", "unverified"
    filing: str = ""                    # e.g., "10-K FY2025", "Q4 2025 Earnings Release"
    xbrl_tag: str = ""                  # XBRL taxonomy tag if from EDGAR
    retrieved_at: str = ""
    notes: str = ""
    verified: bool = False

    def set(self, value, source, filing="", xbrl_tag="", notes=""):
        self.value = value
        self.source = source
        self.filing = filing
        self.xbrl_tag = xbrl_tag
        self.notes = notes
        self.retrieved_at = datetime.now().isoformat()
        self.verified = source in ("EDGAR", "FMP")
        return self


@dataclass
class AdjCashBurnInputs:
    """All inputs needed for the Adjusted Cash Burn formula."""
    # Income Statement / Non-GAAP
    gaap_net_income: SourcedValue = field(default_factory=SourcedValue)
    depreciation_amortization: SourcedValue = field(default_factory=SourcedValue)
    interest_expense: SourcedValue = field(default_factory=SourcedValue)
    interest_income: SourcedValue = field(default_factory=SourcedValue)
    income_tax_provision: SourcedValue = field(default_factory=SourcedValue)
    stock_based_comp: SourcedValue = field(default_factory=SourcedValue)
    restructuring_charges: SourcedValue = field(default_factory=SourcedValue)
    other_non_cash_items: SourcedValue = field(default_factory=SourcedValue)

    # Derived: Adjusted EBITDA = Net Income + Interest Exp - Interest Inc + Tax + D&A + SBC + Restructuring + Other
    adj_ebitda: SourcedValue = field(default_factory=SourcedValue)

    # Cash Flow Statement
    total_capex: SourcedValue = field(default_factory=SourcedValue)
    maintenance_capex: SourcedValue = field(default_factory=SourcedValue)  # rarely disclosed
    cash_interest_paid: SourcedValue = field(default_factory=SourcedValue)
    cash_taxes_paid: SourcedValue = field(default_factory=SourcedValue)
    operating_cash_flow: SourcedValue = field(default_factory=SourcedValue)
    free_cash_flow: SourcedValue = field(default_factory=SourcedValue)

    # Balance Sheet
    cash_and_equivalents: SourcedValue = field(default_factory=SourcedValue)
    short_term_investments: SourcedValue = field(default_factory=SourcedValue)
    long_term_investments: SourcedValue = field(default_factory=SourcedValue)
    total_debt: SourcedValue = field(default_factory=SourcedValue)
    current_portion_ltd: SourcedValue = field(default_factory=SourcedValue)
    total_current_assets: SourcedValue = field(default_factory=SourcedValue)
    total_current_liabilities: SourcedValue = field(default_factory=SourcedValue)
    total_assets: SourcedValue = field(default_factory=SourcedValue)
    total_equity: SourcedValue = field(default_factory=SourcedValue)

    # Revenue & Operational
    revenue: SourcedValue = field(default_factory=SourcedValue)
    gross_profit: SourcedValue = field(default_factory=SourcedValue)
    ebitda_gaap: SourcedValue = field(default_factory=SourcedValue)

    # Preferred Dividends (for adjusted burn formula)
    preferred_dividends: SourcedValue = field(default_factory=SourcedValue)

    @property
    def computed_adj_ebitda(self) -> Optional[float]:
        """Compute Adjusted EBITDA from components if direct value unavailable."""
        ni = self.gaap_net_income.value
        ie = self.interest_expense.value or 0
        ii = self.interest_income.value or 0
        tax = self.income_tax_provision.value or 0
        da = self.depreciation_amortization.value or 0
        sbc = self.stock_based_comp.value or 0
        rst = self.restructuring_charges.value or 0
        other = self.other_non_cash_items.value or 0
        if ni is None:
            return None
        return ni + ie - ii + tax + da + sbc + rst + other

    @property
    def adjusted_cash_burn(self) -> Optional[float]:
        """
        Adjusted Cash Burn = Adj. EBITDA
                            - Recurring Income Taxes
                            - Priority Dividends
                            - Maintenance CapEx (or Total CapEx if unavailable)
                            - Current Portion of LTD
                            - Cash Interest Expense
        """
        ebitda = self.adj_ebitda.value if self.adj_ebitda.value is not None else self.computed_adj_ebitda
        if ebitda is None:
            return None

        taxes = self.cash_taxes_paid.value or 0
        divs = self.preferred_dividends.value or 0
        capex = self.maintenance_capex.value if self.maintenance_capex.value is not None else (self.total_capex.value or 0)
        current_ltd = self.current_portion_ltd.value or 0
        cash_int = self.cash_interest_paid.value or 0

        return ebitda - taxes - divs - abs(capex) - current_ltd - cash_int

    def verification_summary(self) -> Dict[str, Any]:
        """Return a summary of which fields are verified vs unverified."""
        fields = {}
        for fname in self.__dataclass_fields__:
            val = getattr(self, fname)
            if isinstance(val, SourcedValue):
                fields[fname] = {
                    "value": val.value,
                    "source": val.source,
                    "verified": val.verified,
                    "filing": val.filing,
                }
        verified = sum(1 for f in fields.values() if f["verified"])
        total = sum(1 for f in fields.values() if f["value"] is not None)
        return {
            "verified_count": verified,
            "populated_count": total,
            "total_fields": len(fields),
            "verification_rate": f"{verified}/{total}" if total > 0 else "0/0",
            "fields": fields,
        }


# ─── TIER 1: SEC EDGAR XBRL ────────────────────────────────────────────────
class EdgarFetcher:
    """
    Fetches financial data directly from SEC EDGAR XBRL API.
    This is the gold standard — data comes from actual SEC filings.
    """

    def __init__(self):
        import requests
        self.session = requests.Session()
        self.session.headers.update(EDGAR_HEADERS)

    def get_company_facts(self, cik: str) -> dict:
        """Fetch all XBRL facts for a company."""
        url = f"{EDGAR_COMPANY_FACTS}/CIK{cik}.json"
        log.info(f"EDGAR: Fetching company facts from {url}")
        resp = self.session.get(url, timeout=(5, 30))
        resp.raise_for_status()
        return resp.json()

    def extract_value(self, facts: dict, taxonomy: str, tag: str,
                      fiscal_year: int, form: str = "10-K") -> Optional[float]:
        """Extract a specific XBRL value for a given fiscal year."""
        try:
            tag_data = facts["facts"][taxonomy][tag]["units"]
            # Most financial values are in USD
            unit_key = "USD" if "USD" in tag_data else list(tag_data.keys())[0]
            entries = tag_data[unit_key]

            # Filter for the specific fiscal year annual filing
            for entry in reversed(entries):  # most recent first
                fy = entry.get("fy")
                fp = entry.get("fp", "")
                filing_form = entry.get("form", "")
                if fy == fiscal_year and fp == "FY" and filing_form == form:
                    return entry.get("val")
                # Also check 10-K/A
                if fy == fiscal_year and fp == "FY" and filing_form in ("10-K", "10-K/A"):
                    return entry.get("val")
            return None
        except (KeyError, IndexError):
            return None

    def fetch(self, ticker: str, fiscal_year: int = 2025) -> AdjCashBurnInputs:
        """Fetch all required data points from EDGAR."""
        data = AdjCashBurnInputs()
        cik = CIK_MAP.get(ticker)
        if not cik:
            log.warning(f"EDGAR: No CIK mapping for {ticker}")
            return data

        try:
            facts = self.get_company_facts(cik)
        except Exception as e:
            log.error(f"EDGAR: Failed to fetch facts for {ticker}: {e}")
            return data

        us_gaap = "us-gaap"
        fy = fiscal_year
        filing = f"10-K FY{fy}"

        # ── Income Statement ────────────────────────────────────────
        tag_map = {
            "gaap_net_income": [
                ("NetIncomeLoss", us_gaap),
                ("ProfitLoss", us_gaap),
            ],
            "revenue": [
                ("RevenueFromContractWithCustomerExcludingAssessedTax", us_gaap),
                ("Revenues", us_gaap),
                ("SalesRevenueNet", us_gaap),
            ],
            "depreciation_amortization": [
                ("DepreciationDepletionAndAmortization", us_gaap),
                ("DepreciationAndAmortization", us_gaap),
            ],
            "interest_expense": [
                ("InterestExpense", us_gaap),
                ("InterestExpenseDebt", us_gaap),
                ("InterestAndDebtExpense", us_gaap),
                ("InterestExpenseNonoperating", us_gaap),
                ("InterestCostsIncurred", us_gaap),
                ("InterestIncomeExpenseNonoperatingNet", us_gaap),
            ],
            "interest_income": [
                ("InvestmentIncomeInterest", us_gaap),
                ("InterestIncomeExpenseNet", us_gaap),
            ],
            "income_tax_provision": [
                ("IncomeTaxExpenseBenefit", us_gaap),
            ],
            "stock_based_comp": [
                ("ShareBasedCompensation", us_gaap),
                ("AllocatedShareBasedCompensationExpense", us_gaap),
            ],
            "restructuring_charges": [
                ("RestructuringCharges", us_gaap),
                ("RestructuringSettlementAndImpairmentProvisions", us_gaap),
            ],
            "gross_profit": [
                ("GrossProfit", us_gaap),
            ],

            # ── Cash Flow Statement ─────────────────────────────────
            "operating_cash_flow": [
                ("NetCashProvidedByUsedInOperatingActivities", us_gaap),
            ],
            "total_capex": [
                ("PaymentsToAcquirePropertyPlantAndEquipment", us_gaap),
                ("PaymentsToAcquireProductiveAssets", us_gaap),
            ],
            "cash_interest_paid": [
                ("InterestPaidNet", us_gaap),
                ("InterestPaid", us_gaap),
            ],
            "cash_taxes_paid": [
                ("IncomeTaxesPaidNet", us_gaap),
                ("IncomeTaxesPaid", us_gaap),
            ],

            # ── Balance Sheet ───────────────────────────────────────
            "cash_and_equivalents": [
                ("CashAndCashEquivalentsAtCarryingValue", us_gaap),
                ("CashCashEquivalentsAndShortTermInvestments", us_gaap),
            ],
            "short_term_investments": [
                ("ShortTermInvestments", us_gaap),
                ("AvailableForSaleSecuritiesDebtSecuritiesCurrent", us_gaap),
                ("MarketableSecuritiesCurrent", us_gaap),
            ],
            "long_term_investments": [
                ("LongTermInvestments", us_gaap),
                ("AvailableForSaleSecuritiesDebtSecuritiesNoncurrent", us_gaap),
                ("MarketableSecuritiesNoncurrent", us_gaap),
            ],
            "current_portion_ltd": [
                ("LongTermDebtCurrent", us_gaap),
                ("CurrentPortionOfLongTermDebt", us_gaap),
                ("DebtCurrent", us_gaap),
            ],
            "total_debt": [
                ("LongTermDebtAndCapitalLeaseObligations", us_gaap),
                ("LongTermDebt", us_gaap),
                ("DebtAndCapitalLeaseObligations", us_gaap),
            ],
            "total_current_assets": [
                ("AssetsCurrent", us_gaap),
            ],
            "total_current_liabilities": [
                ("LiabilitiesCurrent", us_gaap),
            ],
            "total_assets": [
                ("Assets", us_gaap),
            ],
            "total_equity": [
                ("StockholdersEquity", us_gaap),
                ("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", us_gaap),
            ],
        }

        for field_name, tag_options in tag_map.items():
            sv: SourcedValue = getattr(data, field_name)
            for tag_name, taxonomy in tag_options:
                val = self.extract_value(facts, taxonomy, tag_name, fy)
                if val is not None:
                    # CapEx is reported as positive in XBRL but represents cash outflow
                    if field_name == "total_capex":
                        val = abs(val)
                    # Convert from raw (thousands/units as filed) — EDGAR reports in actual dollars
                    sv.set(
                        value=round(val / 1_000_000, 1),  # Convert to $M
                        source="EDGAR",
                        filing=filing,
                        xbrl_tag=f"{taxonomy}:{tag_name}",
                        notes=f"FY{fy} annual from 10-K via EDGAR XBRL API"
                    )
                    log.info(f"  EDGAR [{ticker}] {field_name} = {sv.value}M (tag: {tag_name})")
                    break
            if sv.value is None:
                log.debug(f"  EDGAR [{ticker}] {field_name} = NOT FOUND in XBRL")

        # Compute Adjusted EBITDA from components
        computed = data.computed_adj_ebitda
        if computed is not None:
            data.adj_ebitda.set(
                value=round(computed, 1),
                source="EDGAR",
                filing=filing,
                notes="Computed from XBRL components: NI + IntExp - IntInc + Tax + D&A + SBC + Restructuring"
            )

        # Compute FCF
        if data.operating_cash_flow.value is not None and data.total_capex.value is not None:
            data.free_cash_flow.set(
                value=round(data.operating_cash_flow.value - data.total_capex.value, 1),
                source="EDGAR",
                filing=filing,
                notes="Computed: OCF - CapEx"
            )

        return data


# ─── TIER 2: FINANCIAL MODELING PREP ────────────────────────────────────────
class FMPFetcher:
    """
    Financial Modeling Prep API — has pre-calculated Adjusted EBITDA
    and clean financial statement data. Requires free API key.
    """

    def __init__(self, api_key: str):
        import requests
        self.api_key = api_key
        self.session = requests.Session()

    def _get(self, endpoint: str, params: dict = None) -> dict:
        params = params or {}
        params["apikey"] = self.api_key
        url = f"{FMP_BASE}/{endpoint}"
        log.info(f"FMP: Fetching {url}")
        resp = self.session.get(url, params=params, timeout=(5, 15))
        resp.raise_for_status()
        return resp.json()

    def fetch(self, ticker: str, fiscal_year: int = 2025, existing: AdjCashBurnInputs = None) -> AdjCashBurnInputs:
        """Fetch data from FMP, filling in gaps from existing data."""
        data = existing or AdjCashBurnInputs()

        try:
            # Income statement (annual)
            income = self._get(f"income-statement/{ticker}", {"period": "annual", "limit": 3})
            cf = self._get(f"cash-flow-statement/{ticker}", {"period": "annual", "limit": 3})
            bs = self._get(f"balance-sheet-statement/{ticker}", {"period": "annual", "limit": 3})

            # Find the right fiscal year
            inc_fy = next((r for r in income if str(r.get("calendarYear")) == str(fiscal_year)), None)
            cf_fy = next((r for r in cf if str(r.get("calendarYear")) == str(fiscal_year)), None)
            bs_fy = next((r for r in bs if str(r.get("calendarYear")) == str(fiscal_year)), None)

            filing = f"FMP — FY{fiscal_year}"

            # Only fill in fields that are still unverified
            def fill(field_name: str, value, source_detail: str = ""):
                sv: SourcedValue = getattr(data, field_name)
                if not sv.verified and value is not None:
                    sv.set(
                        value=round(value / 1_000_000, 1),
                        source="FMP",
                        filing=filing,
                        notes=f"FMP API — {source_detail}" if source_detail else "FMP API"
                    )
                    log.info(f"  FMP [{ticker}] {field_name} = {sv.value}M")

            if inc_fy:
                fill("gaap_net_income", inc_fy.get("netIncome"), "income-statement")
                fill("revenue", inc_fy.get("revenue"), "income-statement")
                fill("depreciation_amortization", inc_fy.get("depreciationAndAmortization"), "income-statement")
                fill("interest_expense", inc_fy.get("interestExpense"), "income-statement")
                fill("income_tax_provision", inc_fy.get("incomeTaxExpense"), "income-statement")
                fill("stock_based_comp", inc_fy.get("stockBasedCompensation") or inc_fy.get("generalAndAdministrativeExpenses"), "income-statement")
                fill("gross_profit", inc_fy.get("grossProfit"), "income-statement")
                fill("ebitda_gaap", inc_fy.get("ebitda"), "income-statement — GAAP EBITDA")

            if cf_fy:
                fill("operating_cash_flow", cf_fy.get("operatingCashFlow"), "cash-flow-statement")
                capex_val = cf_fy.get("capitalExpenditure")
                if capex_val is not None:
                    fill("total_capex", abs(capex_val), "cash-flow-statement")
                fill("free_cash_flow", cf_fy.get("freeCashFlow"), "cash-flow-statement")
                interest_val = cf_fy.get("interestPaid")
                if interest_val is not None:
                    fill("cash_interest_paid", abs(interest_val), "cash-flow-statement supplemental")
                taxes_val = cf_fy.get("incomeTaxesPaid")
                if taxes_val is not None:
                    fill("cash_taxes_paid", abs(taxes_val), "cash-flow-statement supplemental")

            if bs_fy:
                fill("cash_and_equivalents", bs_fy.get("cashAndCashEquivalents"), "balance-sheet")
                fill("short_term_investments", bs_fy.get("shortTermInvestments"), "balance-sheet")
                fill("long_term_investments", bs_fy.get("longTermInvestments"), "balance-sheet")
                fill("current_portion_ltd", bs_fy.get("currentPortionOfLongTermDebt") or bs_fy.get("shortTermDebt"), "balance-sheet")
                fill("total_debt", bs_fy.get("totalDebt"), "balance-sheet")
                fill("total_current_assets", bs_fy.get("totalCurrentAssets"), "balance-sheet")
                fill("total_current_liabilities", bs_fy.get("totalCurrentLiabilities"), "balance-sheet")
                fill("total_assets", bs_fy.get("totalAssets"), "balance-sheet")
                fill("total_equity", bs_fy.get("totalStockholdersEquity"), "balance-sheet")

            # FMP has a dedicated endpoint for key metrics that may include Adj. EBITDA
            try:
                metrics = self._get(f"key-metrics/{ticker}", {"period": "annual", "limit": 3})
                met_fy = next((r for r in metrics if str(r.get("calendarYear")) == str(fiscal_year)), None)
                if met_fy and not data.adj_ebitda.verified:
                    # FMP doesn't always have "adjustedEBITDA" — check
                    pass
            except Exception:
                pass

            # Recompute Adj. EBITDA if we got more components
            if not data.adj_ebitda.verified:
                computed = data.computed_adj_ebitda
                if computed is not None:
                    data.adj_ebitda.set(
                        value=round(computed, 1),
                        source="FMP",
                        filing=filing,
                        notes="Computed from FMP components: NI + IntExp - IntInc + Tax + D&A + SBC + Restructuring"
                    )

        except Exception as e:
            log.error(f"FMP: Failed for {ticker}: {e}")

        return data


# ─── TIER 3: YAHOO FINANCE ─────────────────────────────────────────────────
class YahooFetcher:
    """
    Yahoo Finance via yfinance library — tertiary fallback.
    Good coverage, free, but data is third-party aggregated.
    """

    def fetch(self, ticker: str, fiscal_year: int = 2025, existing: AdjCashBurnInputs = None) -> AdjCashBurnInputs:
        data = existing or AdjCashBurnInputs()

        try:
            import yfinance as yf
            stock = yf.Ticker(ticker)

            filing = f"Yahoo Finance — FY{fiscal_year}"

            # Get annual financials
            inc = stock.income_stmt  # columns are dates, rows are line items
            cf = stock.cashflow
            bs = stock.balance_sheet

            if inc is None or inc.empty:
                log.warning(f"Yahoo: No income statement data for {ticker}")
                return data

            # Find the column closest to fiscal year end
            target_year = fiscal_year
            col = None
            for c in inc.columns:
                if hasattr(c, 'year') and c.year == target_year:
                    col = c
                    break
            if col is None and len(inc.columns) > 0:
                col = inc.columns[0]  # most recent
                log.warning(f"Yahoo: Using most recent period {col} (target was FY{target_year})")

            def safe_get(df, row_name, col_idx):
                """Safely extract a value from a DataFrame."""
                if df is None or df.empty:
                    return None
                for name in (row_name if isinstance(row_name, list) else [row_name]):
                    if name in df.index:
                        try:
                            val = df.loc[name, col_idx]
                            if val is not None and str(val) != 'nan':
                                return float(val)
                        except (KeyError, TypeError):
                            pass
                return None

            def fill(field_name, value, source_detail=""):
                sv: SourcedValue = getattr(data, field_name)
                if not sv.verified and value is not None:
                    sv.set(
                        value=round(value / 1_000_000, 1),
                        source="Yahoo",
                        filing=filing,
                        notes=f"yfinance — {source_detail}" if source_detail else "yfinance"
                    )
                    log.info(f"  Yahoo [{ticker}] {field_name} = {sv.value}M")

            # Income statement
            fill("gaap_net_income", safe_get(inc, "Net Income", col), "income_stmt")
            fill("revenue", safe_get(inc, ["Total Revenue", "Revenue"], col), "income_stmt")
            fill("gross_profit", safe_get(inc, "Gross Profit", col), "income_stmt")
            fill("interest_expense", safe_get(inc, ["Interest Expense", "Interest Expense Non Operating"], col), "income_stmt")
            fill("income_tax_provision", safe_get(inc, "Tax Provision", col), "income_stmt")
            fill("depreciation_amortization", safe_get(inc, ["Depreciation And Amortization In Income Statement", "Reconciled Depreciation"], col), "income_stmt")
            fill("stock_based_comp", safe_get(inc, "Stock Based Compensation", col), "income_stmt")
            fill("ebitda_gaap", safe_get(inc, ["EBITDA", "Normalized EBITDA"], col), "income_stmt")

            # Cash flow (find matching column)
            cf_col = None
            if cf is not None and not cf.empty:
                for c in cf.columns:
                    if hasattr(c, 'year') and c.year == target_year:
                        cf_col = c
                        break
                if cf_col is None and len(cf.columns) > 0:
                    cf_col = cf.columns[0]

            if cf_col is not None:
                fill("operating_cash_flow", safe_get(cf, ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"], cf_col), "cashflow")
                capex_val = safe_get(cf, ["Capital Expenditure", "Capital Expenditures"], cf_col)
                if capex_val is not None:
                    fill("total_capex", abs(capex_val), "cashflow")
                fill("free_cash_flow", safe_get(cf, "Free Cash Flow", cf_col), "cashflow")
                interest_val = safe_get(cf, "Interest Paid Supplemental Data", cf_col)
                if interest_val is not None:
                    fill("cash_interest_paid", abs(interest_val), "cashflow supplemental")
                taxes_val = safe_get(cf, "Income Tax Paid Supplemental Data", cf_col)
                if taxes_val is not None:
                    fill("cash_taxes_paid", abs(taxes_val), "cashflow supplemental")

            # Balance sheet
            bs_col = None
            if bs is not None and not bs.empty:
                for c in bs.columns:
                    if hasattr(c, 'year') and c.year == target_year:
                        bs_col = c
                        break
                if bs_col is None and len(bs.columns) > 0:
                    bs_col = bs.columns[0]

            if bs_col is not None:
                fill("cash_and_equivalents", safe_get(bs, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"], bs_col), "balance_sheet")
                fill("short_term_investments", safe_get(bs, ["Other Short Term Investments", "Available For Sale Securities"], bs_col), "balance_sheet")
                fill("long_term_investments", safe_get(bs, ["Long Term Equity Investment", "Investments And Advances", "Other Non Current Assets"], bs_col), "balance_sheet")
                fill("current_portion_ltd", safe_get(bs, ["Current Debt And Capital Lease Obligation", "Current Debt", "Current Long Term Debt"], bs_col), "balance_sheet")
                fill("total_debt", safe_get(bs, ["Total Debt", "Long Term Debt And Capital Lease Obligation"], bs_col), "balance_sheet")
                fill("total_current_assets", safe_get(bs, "Current Assets", bs_col), "balance_sheet")
                fill("total_current_liabilities", safe_get(bs, "Current Liabilities", bs_col), "balance_sheet")
                fill("total_assets", safe_get(bs, "Total Assets", bs_col), "balance_sheet")
                fill("total_equity", safe_get(bs, ["Stockholders Equity", "Total Equity Gross Minority Interest"], bs_col), "balance_sheet")

            # Recompute Adj. EBITDA if needed
            if not data.adj_ebitda.verified and not data.adj_ebitda.value:
                computed = data.computed_adj_ebitda
                if computed is not None:
                    data.adj_ebitda.set(
                        value=round(computed, 1),
                        source="Yahoo",
                        filing=filing,
                        notes="Computed from Yahoo components: NI + IntExp - IntInc + Tax + D&A + SBC + Restructuring"
                    )

        except ImportError:
            log.error("Yahoo: yfinance not installed. Run: pip install yfinance")
        except Exception as e:
            log.error(f"Yahoo: Failed for {ticker}: {e}")

        return data


# ─── ORCHESTRATOR ───────────────────────────────────────────────────────────
class CreditDataFetcher:
    """
    Tiered data fetcher: EDGAR → FMP → Yahoo
    Each tier only fills in fields that previous tiers couldn't source.
    """

    def __init__(self, fmp_key: str = None):
        self.fmp_key = fmp_key

    def fetch(self, ticker: str, fiscal_year: int = 2025) -> dict:
        log.info(f"{'='*60}")
        log.info(f"Fetching {ticker} FY{fiscal_year} — Tiered: EDGAR → FMP → Yahoo")
        log.info(f"{'='*60}")

        data = AdjCashBurnInputs()

        # ── Tier 1: EDGAR ───────────────────────────────────────────
        log.info(f"\n--- TIER 1: SEC EDGAR XBRL ---")
        try:
            edgar = EdgarFetcher()
            data = edgar.fetch(ticker, fiscal_year)
            log.info(f"EDGAR complete: {data.verification_summary()['verified_count']} fields sourced")
        except Exception as e:
            log.error(f"EDGAR tier failed: {e}")

        # ── Tier 2: FMP (if API key provided) ───────────────────────
        if self.fmp_key:
            log.info(f"\n--- TIER 2: Financial Modeling Prep ---")
            try:
                fmp = FMPFetcher(self.fmp_key)
                data = fmp.fetch(ticker, fiscal_year, existing=data)
                log.info(f"FMP complete: {data.verification_summary()['verified_count']} fields now sourced")
            except Exception as e:
                log.error(f"FMP tier failed: {e}")
        else:
            log.info("Skipping Tier 2 (FMP): No API key provided")

        # ── Tier 3: Yahoo Finance ───────────────────────────────────
        log.info(f"\n--- TIER 3: Yahoo Finance ---")
        try:
            yahoo = YahooFetcher()
            data = yahoo.fetch(ticker, fiscal_year, existing=data)
            log.info(f"Yahoo complete: {data.verification_summary()['verified_count']} verified + {data.verification_summary()['populated_count']} total populated")
        except Exception as e:
            log.error(f"Yahoo tier failed: {e}")

        # ── Build output ────────────────────────────────────────────
        summary = data.verification_summary()
        adj_burn = data.adjusted_cash_burn

        output = {
            "ticker": ticker,
            "fiscal_year": fiscal_year,
            "fetched_at": datetime.now().isoformat(),
            "verification_summary": {
                "verified_count": summary["verified_count"],
                "populated_count": summary["populated_count"],
                "verification_rate": summary["verification_rate"],
            },
            "adjusted_cash_burn": {
                "formula": "Adj. EBITDA - Income Taxes Paid - Preferred Dividends - CapEx - Current LTD - Cash Interest",
                "result_millions": round(adj_burn, 1) if adj_burn is not None else None,
                "result_annualized_quarterly": round(adj_burn / 4, 1) if adj_burn is not None else None,
                "components": {
                    "adj_ebitda": {"value": data.adj_ebitda.value, "source": data.adj_ebitda.source, "verified": data.adj_ebitda.verified},
                    "cash_taxes_paid": {"value": data.cash_taxes_paid.value, "source": data.cash_taxes_paid.source, "verified": data.cash_taxes_paid.verified},
                    "preferred_dividends": {"value": data.preferred_dividends.value, "source": data.preferred_dividends.source},
                    "capex_used": {
                        "value": data.maintenance_capex.value if data.maintenance_capex.value is not None else data.total_capex.value,
                        "type": "maintenance" if data.maintenance_capex.value is not None else "total (proxy)",
                        "source": data.maintenance_capex.source if data.maintenance_capex.value is not None else data.total_capex.source,
                    },
                    "current_portion_ltd": {"value": data.current_portion_ltd.value, "source": data.current_portion_ltd.source, "verified": data.current_portion_ltd.verified},
                    "cash_interest_paid": {"value": data.cash_interest_paid.value, "source": data.cash_interest_paid.source, "verified": data.cash_interest_paid.verified},
                },
            },
            "key_financials": {
                "revenue": asdict(data.revenue),
                "gaap_net_income": asdict(data.gaap_net_income),
                "adj_ebitda": asdict(data.adj_ebitda),
                "ebitda_gaap": asdict(data.ebitda_gaap),
                "total_capex": asdict(data.total_capex),
                "free_cash_flow": asdict(data.free_cash_flow),
                "operating_cash_flow": asdict(data.operating_cash_flow),
                "cash_interest_paid": asdict(data.cash_interest_paid),
                "cash_taxes_paid": asdict(data.cash_taxes_paid),
            },
            "balance_sheet": {
                "cash_and_equivalents": asdict(data.cash_and_equivalents),
                "short_term_investments": asdict(data.short_term_investments),
                "long_term_investments": asdict(data.long_term_investments),
                "current_portion_ltd": asdict(data.current_portion_ltd),
                "total_debt": asdict(data.total_debt),
                "total_current_assets": asdict(data.total_current_assets),
                "total_current_liabilities": asdict(data.total_current_liabilities),
                "total_assets": asdict(data.total_assets),
                "total_equity": asdict(data.total_equity),
            },
            "all_fields": summary["fields"],
        }

        return output


# ─── CLI ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Credit Risk Data Fetcher — EDGAR → FMP → Yahoo")
    parser.add_argument("--tickers", nargs="+", default=["LCID", "RIVN"], help="Tickers to fetch")
    parser.add_argument("--fiscal-year", type=int, default=2025, help="Fiscal year to fetch (default: 2025)")
    parser.add_argument("--fmp-key", default=None, help="Financial Modeling Prep API key (optional)")
    parser.add_argument("--output", default=None, help="Output JSON file path (default: stdout)")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    fetcher = CreditDataFetcher(fmp_key=args.fmp_key)
    results = {}

    for ticker in args.tickers:
        results[ticker] = fetcher.fetch(ticker, args.fiscal_year)

        # Print summary
        r = results[ticker]
        print(f"\n{'='*60}")
        print(f"  {ticker} FY{args.fiscal_year} — RESULTS")
        print(f"{'='*60}")
        print(f"  Verification: {r['verification_summary']['verification_rate']} fields verified")
        print(f"  Adj. EBITDA:  ${r['adjusted_cash_burn']['components']['adj_ebitda']['value']}M" if r['adjusted_cash_burn']['components']['adj_ebitda']['value'] else "  Adj. EBITDA:  NOT AVAILABLE")
        print(f"  Adj. Cash Burn: ${r['adjusted_cash_burn']['result_millions']}M/yr" if r['adjusted_cash_burn']['result_millions'] else "  Adj. Cash Burn: CANNOT COMPUTE")
        print(f"  Source: {r['adjusted_cash_burn']['components']['adj_ebitda']['source']}")
        print()

        # Print unverified fields
        unverified = [k for k, v in r['all_fields'].items() if v['value'] is not None and not v['verified']]
        if unverified:
            print(f"  ⚠ Unverified fields ({len(unverified)}):")
            for f in unverified:
                print(f"    - {f}: ${r['all_fields'][f]['value']}M (source: {r['all_fields'][f]['source']})")

        missing = [k for k, v in r['all_fields'].items() if v['value'] is None]
        if missing:
            print(f"  ❌ Missing fields ({len(missing)}):")
            for f in missing:
                print(f"    - {f}")

    # Output
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nResults saved to {args.output}")
    else:
        print(f"\n{'='*60}")
        print("  Full JSON output:")
        print(f"{'='*60}")
        print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
