"""
SEC EDGAR companyfacts → annual financial statements extractor.

API:  GET https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
Docs: https://www.sec.gov/cgi-bin/viewer?action=view&cik=320193&type=10-K

JSON structure
--------------
{
  "cik": 320193,
  "entityName": "Apple Inc.",
  "facts": {
    "us-gaap": {
      "<ConceptName>": {
        "label": "...",
        "description": "...",
        "units": {
          "USD": [
            {
              "accn":  "0000320193-24-000123",   # accession number
              "fy":    2024,                       # fiscal year (int)
              "fp":    "FY",                       # fiscal period: FY | Q1 | Q2 | Q3 | Q4
              "form":  "10-K",                     # form type
              "filed": "2024-11-01",               # date filed
              "end":   "2024-09-28",               # period end date
              "val":   391035000000                # value in raw USD (NOT thousands)
            },
            ...
          ]
        }
      }
    },
    "dei": { ... }   # second taxonomy — issuer metadata, share counts, etc.
  }
}

Filtering rules
---------------
- Annual    : fp == "FY"  and  form in {"10-K", "10-K/A"}
- Quarterly : fp in {"Q1","Q2","Q3","Q4"}  and  form in {"10-Q", "10-Q/A"}
- Balance-sheet point-in-time concepts have no "fp" (frame key instead);
  match on form == "10-K" and take the entry whose "end" date is latest.
- Deduplicate by (fy, fp): if a 10-K/A supersedes a 10-K for the same FY,
  the amended one appears later in the array → reversed() iteration gives it first.

Concept fallback map (most common aliases in priority order)
------------------------------------------------------------
Revenue:
    RevenueFromContractWithCustomerExcludingAssessedTax  ← ASC 606 (post-2018)
    Revenues                                              ← older or multi-segment filers
    SalesRevenueNet                                       ← deprecated but still filed

Net Income:
    NetIncomeLoss                                         ← standard
    ProfitLoss                                            ← consolidated (includes NCI)

Total Debt (long-term non-current):
    LongTermDebtNoncurrent                                ← most common
    LongTermDebt                                          ← sometimes includes current portion
    LongTermDebtAndCapitalLeaseObligations                ← when leases are bundled

Cash:
    CashAndCashEquivalentsAtCarryingValue                 ← most filers
    CashCashEquivalentsAndShortTermInvestments            ← when STI is bundled in

Total Assets:
    Assets                                                ← universal

Stockholders Equity:
    StockholdersEquity                                    ← parent-only
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest

Interest Expense:
    InterestExpense                                       ← income-statement line
    InterestExpenseDebt                                   ← debt-only (excludes lease interest)

Operating Cash Flow:
    NetCashProvidedByUsedInOperatingActivities            ← canonical tag
    (no common alias — this one is universal)

Capital Expenditure:
    PaymentsToAcquirePropertyPlantAndEquipment            ← most common
    PaymentsToAcquireProductiveAssets                     ← broader (includes intangibles)
    NOTE: reported as a POSITIVE number in XBRL even though it is a cash outflow.
"""

import json
import urllib.request
import urllib.error
from collections import defaultdict
from typing import Optional

EDGAR_HEADERS = {
    "User-Agent": "CreditRiskMonitor/1.0 (creditrisk@monitor.app)",
    "Accept":     "application/json",
}

# Ordered fallback lists: first tag that has data wins.
CONCEPT_MAP: dict[str, list[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    "net_income": [
        "NetIncomeLoss",
        "ProfitLoss",
    ],
    "total_debt": [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
        "LongTermDebtAndCapitalLeaseObligations",
        "DebtAndCapitalLeaseObligations",
    ],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsAndShortTermInvestments",
        "Cash",
    ],
    "total_assets": [
        "Assets",
    ],
    "stockholders_equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    "interest_expense": [
        "InterestExpense",
        "InterestExpenseDebt",
        "InterestAndDebtExpense",
        "InterestExpenseNonoperating",
        "InterestIncomeExpenseNonoperatingNet",
    ],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
    ],
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ],
}

ANNUAL_FORMS = {"10-K", "10-K/A"}


def _fetch_company_facts(cik: str) -> dict:
    """
    Fetch the full companyfacts JSON from EDGAR.
    CIK must be zero-padded to 10 digits, e.g. '0000320193'.
    """
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    req = urllib.request.Request(url, headers=EDGAR_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _extract_annual_series(
    facts: dict,
    tag: str,
    n: int = 4,
) -> list[dict]:
    """
    Return up to n annual (10-K) data points for a us-gaap concept, sorted
    newest-first.  Each item: {"fy": int, "end": str, "val": float, "filed": str}.

    Deduplication: if the same fiscal year appears multiple times (10-K then
    10-K/A), the LAST entry in the array wins (amendments are appended later).
    """
    try:
        units = facts["facts"]["us-gaap"][tag]["units"]
    except KeyError:
        return []

    unit_key = "USD" if "USD" in units else next(iter(units), None)
    if unit_key is None:
        return []

    # Deduplicate by fiscal year — last writer wins (amendment supersedes original)
    by_fy: dict[int, dict] = {}
    for entry in units[unit_key]:
        if entry.get("fp") != "FY":
            continue
        if entry.get("form") not in ANNUAL_FORMS:
            continue
        fy = entry.get("fy")
        if fy is None:
            continue
        by_fy[fy] = entry  # overwrite; later entries (amendments) win

    sorted_entries = sorted(by_fy.values(), key=lambda e: e["fy"], reverse=True)
    return [
        {
            "fy":    e["fy"],
            "end":   e.get("end", ""),
            "filed": e.get("filed", ""),
            "val":   e["val"],
            "tag":   tag,
            "form":  e.get("form", ""),
        }
        for e in sorted_entries[:n]
    ]


def get_annual_financials(cik: str, years: int = 4) -> dict:
    """
    Fetch the latest `years` annual values for 9 core financial concepts.

    Parameters
    ----------
    cik   : str  — 10-digit zero-padded CIK, e.g. '0000320193'
    years : int  — how many fiscal years to return (default 4)

    Returns
    -------
    {
      "cik": "0000320193",
      "entity": "Apple Inc.",
      "fields": {
        "revenue": [
          {"fy": 2024, "end": "2024-09-28", "val": 391035000000,
           "val_m": 391035.0, "tag": "...", "form": "10-K", "filed": "..."},
          ...   # up to `years` entries, newest first
        ],
        "net_income": [...],
        ...
      },
      "errors": {"revenue": "no data found", ...}   # only if a concept failed
    }

    Notes
    -----
    - val      : raw USD as reported in XBRL (actual dollars, NOT thousands)
    - val_m    : val / 1_000_000  (millions, rounded to 1 dp)
    - capex    : stored as positive even though it is a cash outflow
    - Fallback : the function tries each alias in CONCEPT_MAP in order and
                 uses the first one that returns data.
    """
    facts = _fetch_company_facts(cik)
    entity = facts.get("entityName", "")

    result: dict = {
        "cik":    cik,
        "entity": entity,
        "fields": {},
        "errors": {},
    }

    for field_name, tags in CONCEPT_MAP.items():
        series: list[dict] = []
        used_tag: Optional[str] = None

        for tag in tags:
            series = _extract_annual_series(facts, tag, n=years)
            if series:
                used_tag = tag
                break

        if not series:
            result["errors"][field_name] = (
                f"no annual 10-K data found; tried: {', '.join(tags)}"
            )
            result["fields"][field_name] = []
            continue

        # Enrich with $M values for convenience
        for row in series:
            row["val_m"] = round(row["val"] / 1_000_000, 1)

        result["fields"][field_name] = series

    return result


# ── Quick smoke-test ────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    cik = sys.argv[1] if len(sys.argv) > 1 else "0000320193"  # Apple
    data = get_annual_financials(cik)
    print(f"\n{data['entity']}  (CIK {data['cik']})\n{'─'*50}")
    for field, rows in data["fields"].items():
        if rows:
            vals = "  |  ".join(f"FY{r['fy']}: ${r['val_m']:,.0f}M" for r in rows)
            print(f"  {field:<22} {vals}  [{rows[0]['tag']}]")
        else:
            print(f"  {field:<22} !! {data['errors'].get(field,'')}")
