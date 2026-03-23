import { useState, useEffect, useMemo, useCallback, Component } from "react";

// ─── ERROR BOUNDARY ────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: "#1c1917", borderRadius: 8, margin: 16, border: "1px solid #dc2626" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fca5a5", marginBottom: 8 }}>{"\u26A0"} Rendering Error</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>{this.state.error?.message || "An unexpected error occurred"}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, border: "1px solid #334155", background: "#1e293b", color: "#94a3b8", cursor: "pointer" }}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Safe division — returns fallback on zero/NaN/Infinity
const safeDiv = (a, b, fallback = 0) => { const r = a / b; return (isFinite(r) && !isNaN(r)) ? r : fallback; };

// ─── PORTFOLIO DATA: LCID & RIVN ────────────────────────────────────────────
const PORTFOLIO = [
  {
    id: "LCID",
    name: "Lucid Group Inc.",
    sector: "EV / Automotive",
    exposure: 25000000,
    sp: "NR",
    moodys: "NR",
    fitch: "NR",
    impliedRating: "CCC+",
    outlook: "Negative",
    watchlist: true,
    cds5y: 1850,
    cds5yChg: 95,
    bondSpread: 980,
    bondSpreadChg: 45,
    eqPrice: 10.06,
    eqChg: -3.5,
    mktCap: 3.26,
    ltDebt: 2740,
    totalDebt: 2740,
    cash: 4600,
    ebitda: -2890,
    intExp: 145,
    revenue: 1354,
    netIncome: -3682,
    totalAssets: 8400,
    totalEquity: 3000,
    fcf: -2650,
    currentAssets: 3300,
    currentLiab: 2600,
    grossLeverage: -0.95,
    netLeverage: -0.63,
    intCov: -19.9,
    debtToEquity: 0.91,
    currentRatio: 1.27,
    roic: -52.4,
    deliveries2025: 15841,
    deliveriesGuidance2026: "25,000 - 27,000",
    productionGuidance2026: "25,000 - 27,000",
    cashBurnQtr: -814,
    liquidityRunway: "~5-6 qtrs at current burn",
    // Adjusted Cash Burn Components (FY2025, $M)
    // Source: Q4 FY2025 Earnings Release, 10-K, Earnings Presentation
    adjBurn: {
      adjEBITDA: -2130,         // Company-reported Non-GAAP Adj. EBITDA FY2025
      adjEBITDA_src: "Q4 2025 Earnings Release — GAAP-to-Non-GAAP reconciliation",
      incomeTaxes: 5,            // Recurring income taxes (minimal — pre-profit, NOL carryforwards)
      incomeTaxes_src: "10-K FY2025; near-zero cash taxes due to NOLs",
      prefDividends: 0,          // No cash preferred dividends (PIF converts accrue, non-cash)
      prefDividends_src: "No cash preferred dividends; PIF redeemable converts are non-cash accretion",
      maintCapex: null,          // Maintenance capex not separately disclosed
      totalCapex: 868,           // Total CapEx FY2025
      totalCapex_src: "Stocktitan / 10-K: $868.2M; 2026 guidance: $1.2B-$1.4B",
      currentLTD: 0,             // Current portion of LT debt (2026 converts retired in Nov 2025)
      currentLTD_src: "2026 converts retired via $975M 2031 note proceeds; no near-term maturities",
      intExpCash: 95,            // Cash interest expense FY2025
      intExpCash_src: "10-K FY2025; converts + SIDF + GIB draws",
    },
    liquidityBreakdown: {
      totalLiquidity: 4600,
      components: [
        { category: "Cash & Cash Equivalents", amount: 998, type: "cash", sub: [
          { label: "Bank Deposits & Money Market Funds", amount: 612 },
          { label: "U.S. Treasury Bills (< 3 mo.)", amount: 268 },
          { label: "Restricted Cash", amount: 118 },
        ]},
        { category: "Short-Term Investments (< 1 yr)", amount: 820, type: "st_invest", sub: [
          { label: "U.S. Treasury Securities", amount: 385 },
          { label: "U.S. Agency Securities", amount: 195 },
          { label: "Corporate Debt Securities (IG)", amount: 155 },
          { label: "Related Party Investments (PIF)", amount: 85 },
        ]},
        { category: "Long-Term Investments (> 1 yr)", amount: 282, type: "lt_invest", sub: [
          { label: "U.S. Treasury Securities", amount: 142 },
          { label: "Corporate Bonds (IG-rated)", amount: 90 },
          { label: "Related Party Investments (PIF)", amount: 50 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 2415, type: "facility", sub: [] },
      ],
      // Source: Lucid Q4 FY2025 Earnings Presentation, Slide 9 — "Liquidity Supports Execution and Growth"
      // Total Liquidity $4.6B = Cash/Inv $2.1B + DDTL $2.0B + ABL $397M + GIB $38M
      facilities: [
        { name: "PIF Delayed Draw Term Loan (DDTL)", committed: 1980, drawn: 0, available: 1980, maturity: "Aug 2029", rate: "Negotiated", secured: "Unsecured", notes: "Increased from $750M to ~$2.0B (Nov 2025); 5-yr term from Aug 2024; fully undrawn; PIF (majority shareholder) is counterparty" },
        { name: "ABL Revolving Credit Facility", committed: 1000, drawn: 0, available: 397, maturity: "Jun 2027", rate: "SOFR + spread", secured: "Senior Secured", notes: "BofA-led syndicate (10 banks); availability = lesser of (committed amount, borrowing base); borrowing base driven by eligible inventory + receivables minus reserves; $350M LC sublimit, $100M swingline sublimit; springing maturity 91 days prior to any >$500M debt maturity; Q4 2025 availability: $397M per earnings presentation" },
        { name: "GIB Revolving Credit Facility", committed: 507, drawn: 469, available: 38, maturity: "Feb 2028", rate: "SAIBOR + 1.40%", secured: "Unsecured", notes: "SAR 1.9B (~$507M) with Gulf International Bank S.A. (PIF-related party); renewed Feb 2025; 0.25%/yr commitment fee on unused; loans up to 12-mo tenor; general corporate purposes; Q4 2025 availability: $38M per earnings presentation — majority drawn for KSA operations" },
        { name: "SIDF Term Loan", committed: 1400, drawn: 735, available: 665, maturity: "2029-2032 (amortizing)", rate: "Subsidized (KSA)", secured: "Senior Secured", notes: "Saudi Industrial Development Fund; for AMP-2 factory construction in KSA; partially drawn; disbursements tied to project milestones; SAR-denominated; not included in reported $4.6B total liquidity figure" },
      ],
      debtMaturities: [
        { year: "2026", amount: 0, desc: "2026 converts retired via 2031 note proceeds" },
        { year: "2027", amount: 0, desc: "No maturities; SIDF amortization ongoing" },
        { year: "2028", amount: 469, desc: "GIB Revolving Facility ($469M drawn; matures Feb 2028)" },
        { year: "2029", amount: 0, desc: "DDTL maturity window (5-yr from Aug 2024)" },
        { year: "2030", amount: 1100, desc: "5.00% Convertible Senior Notes (Apr 2030)" },
        { year: "2031", amount: 975, desc: "1.75% Convertible Senior Notes (Nov 2031)" },
        { year: "Other", amount: 665, desc: "SIDF draws + other KSA obligations" },
      ],
    },
    earningsDate: "2026-05-04",
    earningsTime: "After Close",
    lastEarnings: "Miss — EPS -$3.62 vs -$2.89 est.",
    earningsCallSummary: {
      date: "February 24, 2026",
      quarter: "Q4 FY2025",
      source: "SEC Filing: Exhibit 99.1 (Q4 FY2025 Earnings Release) + Earnings Call Transcript",
      keyFinancials: [
        "Q4 revenue of $522.7M, up 123% YoY; FY2025 revenue $1,353.8M, up 68% YoY",
        "GAAP diluted net loss per share of $(3.62) in Q4; $(12.09) for FY2025",
        "Total liquidity of ~$4.6B at quarter-end (cash/investments $2.1B + undrawn facilities $2.5B)",
      ],
      production: [
        "Q4 production of 7,874 vehicles (up 133% YoY); FY2025 production 17,840 vehicles (nearly doubled YoY)",
        "538 vehicles reclassified — did not complete final validation at AMP-2 Saudi Arabia facility; shifted to 2026",
        "Q4 deliveries of 5,345 (up 72% YoY) — eighth consecutive quarter of record deliveries",
        "2026 production guidance: 25,000–27,000 vehicles (40-50% increase)",
      ],
      creditRelevant: [
        "CEO Winterhoff cited 'extraordinary macro turbulences' — tariffs, incentive roll-offs, shifting EV demand, supply chain disruptions",
        "Focus on improving gross margin through lower material costs, fixed cost absorption via scale, and operational efficiencies",
        "Cost actions intended to extend liquidity runway into first half of 2027",
        "Layoffs of 12% of U.S. workforce announced post-earnings to improve cost structure",
        "Robotaxi partnership with Uber/Nuro announced; Lucid Lunar concept revealed at March Investor Day",
      ],
      strategicItems: [
        "Gravity SUV ramp continues — primary 2026 revenue growth driver",
        "Midsize vehicle platform in development; first production expected in 2026-2027 timeframe",
        "PIF remains majority shareholder and primary liquidity backstop via undrawn $1.98B DDTL",
        "Path to profitability details deferred to March 12 Investor Day",
      ],
      analystQA: [
        "Clearest path to positive gross margin? — CFO: Better material costs, scale absorption, efficiencies; more detail at Investor Day",
        "Tesla competitive threat? — CEO: Lucid is natural successor to Model S/X; seeing uptick in Tesla owner inquiries",
      ],
    },
    analystRating: "Hold",
    targetPrice: 12.86,
    news: [
      { date: "2026-03-19", src: "CNBC", headline: "Lucid receives first Buy rating in months as Citi initiates coverage", sentiment: "positive" },
      { date: "2026-03-17", src: "Reuters", headline: "Uber expands robotaxi deal with Nvidia; Lucid partnership in focus", sentiment: "positive" },
      { date: "2026-03-12", src: "Bloomberg", headline: "Lucid reveals Lunar robotaxi concept and Uber partnership at Investor Day", sentiment: "positive" },
      { date: "2026-03-09", src: "CNBC", headline: "Lucid lays off 12% of U.S. workforce to cut costs and improve gross margin", sentiment: "negative" },
      { date: "2026-02-25", src: "CNBC", headline: "Lucid widely misses earnings expectations, forecasts slowing EV growth in 2026", sentiment: "negative" },
      { date: "2026-02-24", src: "Bloomberg", headline: "Lucid files prospectus to register 69M shares for resale by PIF and Uber affiliates", sentiment: "negative" },
    ],
    ratingHistory: [
      { date: "2025-11", sp: "NR", moodys: "NR", fitch: "NR", event: "$975M convertible notes issued (2031 maturity)" },
      { date: "2025-06", sp: "NR", moodys: "NR", fitch: "NR", event: "Gravity SUV production begins" },
      { date: "2024-06", sp: "NR", moodys: "NR", fitch: "NR", event: "1.25% convertible notes issued (2026 maturity)" },
    ],
    financials: [
      { period: "FY2025", rev: 1354, ebitda: -2890, ni: -3682, debt: 2740, cash: 4600 },
      { period: "FY2024", rev: 875, ebitda: -3050, ni: -3420, debt: 2000, cash: 4500 },
      { period: "FY2023", rev: 595, ebitda: -3290, ni: -2828, debt: 2050, cash: 4850 },
      { period: "FY2022", rev: 608, ebitda: -3050, ni: -1304, debt: 2000, cash: 6260 },
    ],
    research: [
      { date: "2026-03-18", firm: "Citi", action: "Initiate Buy", pt: 16, summary: "Gravity SUV ramp + robotaxi partnership with Uber creates optionality; PIF backing provides liquidity floor." },
      { date: "2026-03-12", firm: "RBC Capital", action: "Hold", pt: 11, summary: "Investor Day laid out path to FCF positive but execution remains high-risk; 2026 deliveries of 25-27K still uncertain." },
      { date: "2026-02-25", firm: "Wolfe Research", action: "Underperform", pt: 6, summary: "Q4 miss underscores cash burn challenge; $975M convert offering extends runway but dilution concerns persist." },
      { date: "2026-02-15", firm: "Morgan Stanley", action: "Hold", pt: 10, summary: "Gravity driving demand visibility but negative gross margins remain a structural concern." },
    ],
  },
  {
    id: "RIVN",
    name: "Rivian Automotive Inc.",
    sector: "EV / Automotive",
    exposure: 35000000,
    sp: "NR",
    moodys: "NR",
    fitch: "NR",
    impliedRating: "B-",
    outlook: "Developing",
    watchlist: true,
    cds5y: 1280,
    cds5yChg: -65,
    bondSpread: 720,
    bondSpreadChg: -30,
    eqPrice: 15.02,
    eqChg: -6.8,
    mktCap: 19.3,
    ltDebt: 4967,
    totalDebt: 4400,
    cash: 7100,
    ebitda: -2750,
    intExp: 320,
    revenue: 5390,
    netIncome: -3630,
    totalAssets: 14900,
    totalEquity: 4600,
    fcf: -1870,
    currentAssets: 8600,
    currentLiab: 3700,
    grossLeverage: -1.60,
    netLeverage: 0.97,
    intCov: -8.6,
    debtToEquity: 0.97,
    currentRatio: 2.32,
    roic: -18.6,
    deliveries2025: 42284,
    deliveriesGuidance2026: "62,000 - 67,000 (incl. R2)",
    productionGuidance2026: "48,000 - 52,000",
    cashBurnQtr: -530,
    liquidityRunway: "~8-10 qtrs (incl. DOE loan)",
    // Adjusted Cash Burn Components (FY2025, $M)
    adjBurn: {
      adjEBITDA: -1860,         // Company-reported Adj. EBITDA FY2025 (within -$2.0B to -$2.25B guidance; improved from -$3.1B in FY2024)
      adjEBITDA_src: "Q4 2025 Earnings; FY2025 guidance range was -$2.0B to -$2.25B",
      incomeTaxes: 8,            // Recurring income taxes (minimal — pre-profit)
      incomeTaxes_src: "10-K FY2025; nominal cash taxes; substantial NOL carryforwards",
      prefDividends: 0,          // No preferred dividends
      prefDividends_src: "No preferred stock outstanding",
      maintCapex: null,          // Not disclosed separately
      totalCapex: 1720,          // Total CapEx FY2025 (within $1.7B-$1.9B guidance; Georgia plant + R2 tooling)
      totalCapex_src: "10-K FY2025; 2025 guidance was $1.7B-$1.9B; heavy growth CapEx for R2/Georgia",
      currentLTD: 0,             // 2026 floating rate notes retired via green note proceeds
      currentLTD_src: "2026 notes retired Jun 2025; next maturity 2028 converts",
      intExpCash: 285,           // Cash interest expense FY2025
      intExpCash_src: "10-K FY2025; green notes + convertible notes",
    },
    liquidityBreakdown: {
      totalLiquidity: 7100,
      components: [
        { category: "Cash & Cash Equivalents", amount: 2180, type: "cash", sub: [
          { label: "Bank Deposits & Money Market Funds", amount: 1340 },
          { label: "U.S. Treasury Bills (< 3 mo.)", amount: 620 },
          { label: "Restricted Cash", amount: 220 },
        ]},
        { category: "Short-Term Investments (< 1 yr)", amount: 3420, type: "st_invest", sub: [
          { label: "U.S. Treasury Securities", amount: 1580 },
          { label: "U.S. Agency Securities", amount: 680 },
          { label: "Corporate Debt Securities (IG)", amount: 540 },
          { label: "Asset-Backed Securities (AAA)", amount: 420 },
          { label: "Commercial Paper", amount: 200 },
        ]},
        { category: "Long-Term Investments (> 1 yr)", amount: 1500, type: "lt_invest", sub: [
          { label: "U.S. Treasury Securities", amount: 720 },
          { label: "U.S. Agency Securities", amount: 380 },
          { label: "Corporate Bonds (IG-rated)", amount: 260 },
          { label: "Asset-Backed Securities", amount: 140 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 0, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "DOE ATVM Loan (Conditional)", committed: 6600, drawn: 0, available: 0, maturity: "TBD", rate: "Subsidized (DOE)", secured: "Secured by New Horizon assets", notes: "Up to $6.6B conditionally approved for Georgia plant (R2 production); NOT a confirmed liquidity source — final terms, closing conditions, and disbursement schedule still pending; availability begins only after final loan closing and project milestone draws" },
        { name: "Uber Robotaxi Investment", committed: 1250, drawn: 0, available: 1250, maturity: "N/A (equity)", rate: "N/A", secured: "Equity Investment", notes: "Up to $1.25B from Uber (announced Mar 2026) for 10,000 autonomous R2 robotaxis; structured as equity investment, not debt; disbursement tied to delivery milestones through 2031" },
      ],
      debtMaturities: [
        { year: "2026", amount: 0, desc: "Retired via green note proceeds" },
        { year: "2027", amount: 0, desc: "No maturities" },
        { year: "2028", amount: 1500, desc: "Convertible Notes (4.625%)" },
        { year: "2029", amount: 0, desc: "No maturities" },
        { year: "2030", amount: 1500, desc: "Convertible Notes (3.625%)" },
        { year: "2031", amount: 1250, desc: "Green Secured Notes (issued Jun 2025)" },
        { year: "Other", amount: 150, desc: "Other obligations & leases" },
      ],
    },
    earningsDate: "2026-05-12",
    earningsTime: "After Close",
    lastEarnings: "Beat — EPS -$0.53 vs -$0.71 est.",
    earningsCallSummary: {
      date: "February 12, 2026",
      quarter: "Q4 FY2025",
      source: "SEC Filing: Exhibit 99.1 (Q4 FY2025 Earnings Release) + Earnings Call Transcript",
      keyFinancials: [
        "Q4 consolidated revenue of $1,286M; automotive revenue $839M (down 45% YoY due to loss of $270M regulatory credits + expired tax incentives)",
        "Software & services revenue surged to $447M in Q4 (up 109% YoY), driven by Volkswagen JV",
        "Q4 consolidated gross profit of $120M; FY2025 gross profit $144M — first full year of positive gross profit (>$1.3B improvement vs FY2024)",
        "Q4 adjusted EBITDA loss of -$465M; FY2025 adjusted EBITDA guided at -$1.8B to -$2.1B",
        "Liquidity of ~$6.1B at year-end (cash, equivalents, and short-term investments)",
      ],
      production: [
        "Q4 production of 10,974 vehicles; Q4 deliveries of 9,745 vehicles",
        "FY2025 deliveries of 42,247 vehicles (down 18% YoY due to tax credit expiration impact)",
        "2026 delivery guidance: 62,000–67,000 vehicles",
        "R2 pre-production builds receiving outstanding reviews; customer deliveries expected Q2 2026",
      ],
      creditRelevant: [
        "First full year of positive consolidated gross profit — a major credit inflection point",
        "Automotive gross profit still negative at -$59M in Q4 and -$432M for FY2025; software/services ($576M GP) offsets losses",
        "2026 capex guidance: $1.95B–$2.05B (Georgia plant + R2 launch)",
        "Adjusted EBITDA positive no longer expected in 2027 — pushed further out",
        "Cash burn remains elevated; FY2025 cash position declined from $7.9B to $6.1B (-$1.8B)",
      ],
      strategicItems: [
        "R2 SUV launch at $45,000–$57,990 pricing opens mass-market addressable opportunity",
        "Volkswagen JV progressing — vehicles delivered for winter testing 13 months after formation; ~60% of Q4 software revenue",
        "Unveiled RAP1 in-house autonomy processor at December AI Day; Universal Hands-Free expanded to 3.5M+ miles of roads",
        "Uber $1.25B equity-linked investment for 10,000 autonomous R2 robotaxis (milestone-based, announced March 2026)",
        "DOE ATVM $6.6B conditional loan — disbursement still pending final closing",
      ],
      analystQA: [
        "R2 demand signals? — CEO Scaringe: Pre-production reviews very strong; fills gap for quality EVs under $50K",
        "Path to auto gross profit positive? — CFO: Targeting automotive gross profit positive by end of 2026 through R2 economics + continued R1 cost reductions",
        "VW JV revenue sustainability? — Management: Expect continued growth; VW product launches using Rivian architecture in 2027",
      ],
    },
    analystRating: "Buy",
    targetPrice: 17.74,
    news: [
      { date: "2026-03-20", src: "Bloomberg", headline: "Rivian shares fall 6.8% as Middle East tensions weigh on cyclical stocks", sentiment: "negative" },
      { date: "2026-03-19", src: "Reuters", headline: "Uber invests $1.25B in Rivian for 10,000 autonomous R2 robotaxis", sentiment: "positive" },
      { date: "2026-03-19", src: "CNBC", headline: "Rivian no longer expects to be adjusted EBITDA positive in 2027", sentiment: "negative" },
      { date: "2026-03-12", src: "CNBC", headline: "Rivian launches R2 SUV at $57,990; deliveries begin spring 2026", sentiment: "positive" },
      { date: "2026-03-10", src: "Bloomberg", headline: "TD Cowen upgrades Rivian to Buy on R2 demand potential", sentiment: "positive" },
      { date: "2026-02-13", src: "Reuters", headline: "Deutsche Bank and UBS both upgrade Rivian on improving fundamentals", sentiment: "positive" },
    ],
    ratingHistory: [
      { date: "2025-06", sp: "NR", moodys: "NR", fitch: "NR", event: "$1.25B green notes issued (2031), redeemed 2026 floating-rate notes" },
      { date: "2024-10", sp: "NR", moodys: "NR", fitch: "NR", event: "DOE ATVM loan of up to $6.6B conditionally approved" },
      { date: "2024-06", sp: "NR", moodys: "NR", fitch: "NR", event: "VW invests $5B; joint venture announced" },
    ],
    financials: [
      { period: "FY2025", rev: 5390, ebitda: -2750, ni: -3630, debt: 4400, cash: 7100 },
      { period: "FY2024", rev: 4970, ebitda: -3200, ni: -4700, debt: 5400, cash: 7900 },
      { period: "FY2023", rev: 4434, ebitda: -4760, ni: -5432, debt: 4430, cash: 9410 },
      { period: "FY2022", rev: 1658, ebitda: -6340, ni: -6752, debt: 1500, cash: 11570 },
    ],
    research: [
      { date: "2026-03-19", firm: "Evercore ISI", action: "Outperform", pt: 22, summary: "Uber robotaxi deal validates R2 platform; $1.25B investment de-risks 2027-28 production ramp." },
      { date: "2026-03-12", firm: "TD Cowen", action: "Upgrade to Buy", pt: 20, summary: "R2 reveal stronger than expected; $45K-$58K pricing opens mass-market addressable opportunity." },
      { date: "2026-03-10", firm: "Goldman Sachs", action: "Buy", pt: 19, summary: "Physical AI and autonomous driving optionality underappreciated; R2 + Georgia plant are catalysts." },
      { date: "2026-02-17", firm: "DA Davidson", action: "Downgrade to UW", pt: 11, summary: "Cash burn unsustainable without R2 success; EBITDA positive pushed beyond 2027." },
      { date: "2026-02-13", firm: "Deutsche Bank", action: "Upgrade to Buy", pt: 18, summary: "R1 cost reductions improving; R2 platform economics fundamentally better than R1." },
    ],
  },
  // ─── NEW PORTFOLIO ADDITIONS ─────────────────────────────────────────────
  {
    id: "CENT",
    name: "Central Garden & Pet Co.",
    sector: "Consumer Products",
    exposure: 15000000,
    sp: "BB",
    moodys: "B1",
    fitch: "BB",
    impliedRating: "BB-",
    outlook: "Stable",
    watchlist: false,
    cds5y: 320,
    cds5yChg: -10,
    bondSpread: 285,
    bondSpreadChg: -8,
    eqPrice: 34.48,
    eqChg: 1.8,
    mktCap: 2.1,
    ltDebt: 1200,
    totalDebt: 1200,
    cash: 721,
    ebitda: 430,
    intExp: 62,
    revenue: 3350,
    netIncome: 165,
    totalAssets: 4800,
    totalEquity: 1600,
    fcf: 280,
    currentAssets: 1450,
    currentLiab: 780,
    grossLeverage: 2.8,
    netLeverage: 1.1,
    intCov: 6.9,
    debtToEquity: 0.75,
    currentRatio: 1.86,
    roic: 8.2,
    cashBurnQtr: 70,
    liquidityRunway: "Adequate — investment grade profile",
    adjBurn: {
      adjEBITDA: 430,
      adjEBITDA_src: "FY2025 10-K; non-GAAP adj EBITDA",
      incomeTaxes: 55,
      incomeTaxes_src: "FY2025 10-K; ~25% effective rate",
      prefDividends: 0,
      prefDividends_src: "No preferred stock outstanding",
      maintCapex: 30,
      totalCapex: 55,
      totalCapex_src: "FY2026 guidance $50-60M; FY2025 actual ~$55M",
      currentLTD: 0,
      currentLTD_src: "No near-term debt maturities until 2028",
      intExpCash: 62,
      intExpCash_src: "FY2025 10-K; senior notes interest",
    },
    liquidityBreakdown: {
      totalLiquidity: 1471,
      components: [
        { category: "Cash & Cash Equivalents", amount: 721, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 680 },
          { label: "Restricted Cash", amount: 41 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 750, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "ABL Revolving Credit Facility", committed: 750, drawn: 0, available: 750, maturity: "2028", rate: "SOFR + spread", secured: "Senior Secured", notes: "No borrowings outstanding at FY2025 year-end; availability based on borrowing base of eligible inventory & receivables" },
      ],
      debtMaturities: [
        { year: "2026", amount: 0, desc: "No maturities" },
        { year: "2027", amount: 0, desc: "No maturities" },
        { year: "2028", amount: 600, desc: "6.125% Senior Notes due 2028" },
        { year: "2029", amount: 0, desc: "No maturities" },
        { year: "2030", amount: 600, desc: "4.125% Senior Notes due 2030" },
        { year: "Other", amount: 0, desc: "" },
      ],
    },
    earningsDate: "2026-05-06",
    earningsTime: "After Close",
    lastEarnings: "Beat — EPS $0.21 vs $0.14 est.",
    earningsCallSummary: {
      date: "February 4, 2026",
      quarter: "Q1 FY2026 (Dec 2025)",
      source: "SEC Filing: Exhibit 99.1 (Q1 FY2026 Earnings Release)",
      keyFinancials: [
        "Q1 net sales $617M, down 6% YoY — driven by shipment timing shift into Q2 and portfolio optimization",
        "Gross margin expanded 110 bps to 30.9%; non-GAAP gross margin 30.8%",
        "GAAP diluted EPS $0.11; non-GAAP EPS $0.21 (flat YoY, beat consensus of $0.14)",
        "Net interest expense $8M, consistent with prior year",
      ],
      production: [
        "Revenue decline attributed to retailer spring inventory shipment timing, not demand destruction",
        "Continued portfolio optimization — rationalizing lower-margin pet durables and select live plants",
        "Closed UK operations; transitioning European business to direct model",
        "Completed Champion USA tuck-in acquisition post-quarter (livestock feed-through fly control)",
      ],
      creditRelevant: [
        "Total debt $1.2B unchanged; gross leverage 2.9x (within 3.0-3.5x target range)",
        "No ABL borrowings outstanding at quarter-end — $750M revolver fully available",
        "Cash position of $721M — record level",
        "Reaffirmed FY2026 non-GAAP diluted EPS guidance of $2.70 or better",
        "CapEx guidance $50-60M for fiscal 2026",
      ],
      strategicItems: [
        "Cost & Simplicity program embedded in operations — closed 16 legacy facilities to date",
        "Central to Home strategy focused on pet and garden consumables and innovation",
        "Increased M&A activity anticipated, particularly in consumable businesses",
        "Investing in digital capabilities and e-commerce to adapt to shifting consumer behaviors",
      ],
      analystQA: [
        "Path to growth? — CEO Lahanas: Embedding innovation in culture alongside cost discipline; results will build over time",
        "Consumer headwinds? — Management: Consumer still value-focused; portfolio optimization improving margin mix despite top-line pressure",
      ],
    },
    analystRating: "Hold",
    targetPrice: 42.00,
    news: [
      { date: "2026-02-04", src: "Business Wire", headline: "Central Garden & Pet Q1 FY2026 earnings beat on margins despite 6% revenue decline", sentiment: "positive" },
      { date: "2026-01-15", src: "Reuters", headline: "Central Garden completes Champion USA tuck-in acquisition for livestock segment", sentiment: "positive" },
      { date: "2025-11-24", src: "Zacks", headline: "Central Garden delivers record FY2025 bottom-line results and cash position", sentiment: "positive" },
    ],
    ratingHistory: [
      { date: "2025-06", sp: "BB", moodys: "B1", fitch: "BB", event: "Stable outlook reaffirmed; Cost & Simplicity driving margin improvement" },
      { date: "2024-01", sp: "BB", moodys: "B1", fitch: "BB", event: "Moody's affirms B1 CFR with stable outlook" },
    ],
    financials: [
      { period: "FY2025", rev: 3350, ebitda: 430, ni: 165, debt: 1200, cash: 721 },
      { period: "FY2024", rev: 3280, ebitda: 385, ni: 118, debt: 1200, cash: 580 },
      { period: "FY2023", rev: 3170, ebitda: 340, ni: 89, debt: 1250, cash: 510 },
      { period: "FY2022", rev: 3640, ebitda: 410, ni: 156, debt: 1300, cash: 450 },
    ],
    research: [
      { date: "2026-02-05", firm: "Zacks", action: "Hold", pt: 40, summary: "Q1 beat on margins but revenue miss on shipment timing; portfolio optimization ongoing." },
      { date: "2025-11-25", firm: "KeyBanc", action: "Overweight", pt: 45, summary: "Record cash position and deleveraging track support credit improvement thesis." },
    ],
    debtMaturities: {
      items: [
        { year: "2028", amount: 600, desc: "6.125% Senior Notes due 2028" },
        { year: "2030", amount: 600, desc: "4.125% Senior Notes due 2030" },
      ],
    },
  },
  {
    id: "IHRT",
    name: "iHeartMedia Inc.",
    sector: "Media / Broadcasting",
    exposure: 20000000,
    sp: "CCC+",
    moodys: "Caa2",
    fitch: "NR",
    impliedRating: "CCC",
    outlook: "Negative",
    watchlist: true,
    cds5y: 2800,
    cds5yChg: 150,
    bondSpread: 1450,
    bondSpreadChg: 85,
    eqPrice: 1.22,
    eqChg: -28.5,
    mktCap: 0.18,
    ltDebt: 4800,
    totalDebt: 4800,
    cash: 271,
    ebitda: 768,
    intExp: 440,
    revenue: 3730,
    netIncome: -320,
    totalAssets: 9200,
    totalEquity: -1600,
    fcf: 138,
    currentAssets: 1200,
    currentLiab: 950,
    grossLeverage: 6.3,
    netLeverage: 5.9,
    intCov: 1.7,
    debtToEquity: -3.0,
    currentRatio: 1.26,
    roic: -3.5,
    cashBurnQtr: 35,
    liquidityRunway: "Tight — $640M total liquidity",
    adjBurn: {
      adjEBITDA: 768,
      adjEBITDA_src: "FY2025 Earnings Release; consolidated adj EBITDA",
      incomeTaxes: 15,
      incomeTaxes_src: "Minimal cash taxes; NOL carryforwards from 2019 bankruptcy",
      prefDividends: 0,
      prefDividends_src: "No preferred stock",
      maintCapex: 40,
      totalCapex: 80,
      totalCapex_src: "FY2025 estimated; technology + infrastructure maintenance",
      currentLTD: 51,
      currentLTD_src: "Term loans due 2026 ($5.1M + $1.5M) + 6.375% notes ($44.6M) — most exchanged Dec 2024",
      intExpCash: 440,
      intExpCash_src: "FY2025; weighted avg ~9% on ~$4.8B total debt",
    },
    liquidityBreakdown: {
      totalLiquidity: 640,
      components: [
        { category: "Cash & Cash Equivalents", amount: 271, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 271 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 369, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "ABL Revolving Credit Facility", committed: 450, drawn: 81, available: 369, maturity: "2027", rate: "SOFR + spread", secured: "Senior Secured", notes: "Asset-based revolver; availability = cash + AR borrowing base; total liquidity $640M per Q4 2025 earnings release" },
      ],
      debtMaturities: [
        { year: "2026", amount: 51, desc: "Remaining term loans + 6.375% notes not exchanged" },
        { year: "2027", amount: 79, desc: "5.25% secured notes ($7M) + 8.375% unsecured ($72M)" },
        { year: "2028", amount: 277, desc: "4.75% Senior Secured Notes" },
        { year: "2029", amount: 2858, desc: "Term Loan ($2,140M) + 9.125% 1L Notes ($718M)" },
        { year: "2030", amount: 1336, desc: "7.75% 1L Notes ($661M) + 10.875% 2L Notes ($675M)" },
        { year: "2031", amount: 178, desc: "7.00% First Lien Notes" },
        { year: "Other", amount: 0, desc: "" },
      ],
    },
    earningsDate: "2026-05-11",
    earningsTime: "After Close",
    lastEarnings: "Miss — adj. EBITDA $220M vs $246M prior yr",
    earningsCallSummary: {
      date: "March 2, 2026",
      quarter: "Q4 FY2025",
      source: "SEC Filing: Q4 FY2025 Earnings Release + Earnings Call",
      keyFinancials: [
        "Q4 consolidated revenue: results announced March 2, 2026",
        "Q4 adjusted EBITDA $220M, down 10.5% YoY from $246M",
        "Q4 operating income $86M, down 18% from $105M in Q4 2024",
        "FY2025 GAAP operating loss of -$21M (improved from -$763M in 2024 which included $923M impairment)",
        "Cash balance $271M, total liquidity $640M as of Dec 31, 2025",
      ],
      production: [
        "Q4 free cash flow of $138M; FCF including real estate sales of $158M",
        "Cash provided by operating activities $156M in Q4",
        "No. 1 audio company in America, reaching 250M+ people monthly",
      ],
      creditRelevant: [
        "Completed $4.8B comprehensive debt exchange in Dec 2024 — reduced total debt by $440M",
        "Exchanged near-term maturities (2026-2028 notes) into new 2029-2031 first/second lien notes",
        "Remaining debt stack: $2.14B Term Loan (2029), $718M 9.125% 1L (2029), $661M 7.75% 1L (2030), $178M 7.00% 1L (2031), $675M 10.875% 2L (2030)",
        "Very high leverage at ~6.3x gross; interest coverage thin at 1.7x",
        "Negative stockholders equity of -$1.6B reflects accumulated impairments",
      ],
      strategicItems: [
        "Digital revenue growth from podcasting and streaming platforms",
        "iHeartPodcasts is #1 podcast publisher globally",
        "Secular headwinds in traditional radio advertising",
        "Focus on cost management and digital transformation",
      ],
      analystQA: [
        "Revenue outlook for Q1 2026? — Management provided Q1 2026 revenue and EBITDA guidance during earnings call",
        "Debt sustainability? — Exchange transaction extended maturities but total burden remains very high at ~6x leverage",
      ],
    },
    analystRating: "Sell",
    targetPrice: 2.50,
    news: [
      { date: "2026-03-02", src: "Business Wire", headline: "iHeartMedia reports Q4/FY2025 results; adj EBITDA declines 10.5%", sentiment: "negative" },
      { date: "2025-12-22", src: "Reuters", headline: "iHeartMedia completes $4.8B debt restructuring, reduces debt by $440M", sentiment: "positive" },
      { date: "2025-11-10", src: "CNBC", headline: "iHeartMedia Q3 revenue flat as traditional radio ad spend stagnates", sentiment: "negative" },
    ],
    ratingHistory: [
      { date: "2025-12", sp: "CCC+", moodys: "Caa2", fitch: "NR", event: "Completed $4.8B comprehensive debt exchange" },
      { date: "2024-11", sp: "CCC+", moodys: "Caa2", fitch: "NR", event: "Entered TSA with 80% of debt holders for exchange" },
    ],
    financials: [
      { period: "FY2025", rev: 3730, ebitda: 768, ni: -320, debt: 4800, cash: 271 },
      { period: "FY2024", rev: 3800, ebitda: 820, ni: -714, debt: 5200, cash: 315 },
      { period: "FY2023", rev: 3820, ebitda: 845, ni: -175, debt: 5400, cash: 290 },
      { period: "FY2022", rev: 3960, ebitda: 880, ni: -210, debt: 5580, cash: 380 },
    ],
    research: [
      { date: "2026-03-03", firm: "Wells Fargo", action: "Underweight", pt: 1.00, summary: "Leverage unsustainable at 6x+; radio ad market in structural decline; digital pivot insufficient." },
      { date: "2025-12-23", firm: "B. Riley", action: "Neutral", pt: 2.00, summary: "Debt exchange extends maturities but doesn't solve fundamental over-leverage problem." },
    ],
    debtMaturities: {
      items: [
        { year: "2029", amount: 2858, desc: "Term Loan ($2.14B) + 9.125% 1L Notes ($718M)" },
        { year: "2030", amount: 1336, desc: "7.75% 1L Notes ($661M) + 10.875% 2L Notes ($675M)" },
        { year: "2031", amount: 178, desc: "7.00% First Lien Notes" },
        { year: "Other", amount: 400, desc: "Remaining near-term maturities + ABL" },
      ],
    },
  },
  {
    id: "BEUSA",
    name: "Beusa Investments LLC",
    sector: "Energy / Oilfield Services",
    exposure: 10000000,
    sp: "NR",
    moodys: "NR",
    fitch: "NR",
    impliedRating: "B-",
    outlook: "Stable",
    watchlist: true,
    cds5y: null,
    cds5yChg: null,
    bondSpread: null,
    bondSpreadChg: null,
    eqPrice: null,
    eqChg: null,
    mktCap: null,
    ltDebt: 200,
    totalDebt: 200,
    cash: 45,
    ebitda: 55,
    intExp: 20,
    revenue: 250,
    netIncome: 10,
    totalAssets: 500,
    totalEquity: 150,
    fcf: 25,
    currentAssets: 120,
    currentLiab: 80,
    grossLeverage: 3.6,
    netLeverage: 2.8,
    intCov: 2.8,
    debtToEquity: 1.33,
    currentRatio: 1.50,
    roic: 5.0,
    cashBurnQtr: 6,
    liquidityRunway: "Private — limited visibility",
    adjBurn: {
      adjEBITDA: 55,
      adjEBITDA_src: "Estimated from bank group information; private company",
      incomeTaxes: 5,
      incomeTaxes_src: "Estimated; pass-through entity structure likely",
      prefDividends: 0,
      prefDividends_src: "No preferred stock known",
      maintCapex: 15,
      totalCapex: 25,
      totalCapex_src: "Estimated; equipment fleet maintenance + growth capex",
      currentLTD: 10,
      currentLTD_src: "Estimated current portion of equipment financing",
      intExpCash: 20,
      intExpCash_src: "Estimated; ~10% rate on $200M total debt",
    },
    liquidityBreakdown: {
      totalLiquidity: 75,
      components: [
        { category: "Cash & Cash Equivalents", amount: 45, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 45 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 30, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "Revolving Credit Facility", committed: 50, drawn: 20, available: 30, maturity: "2027", rate: "SOFR + 3.50%", secured: "Senior Secured", notes: "Private — estimated from bank group data; asset-based facility secured by equipment" },
      ],
      debtMaturities: [
        { year: "2026", amount: 10, desc: "Current portion of equipment term loans" },
        { year: "2027", amount: 60, desc: "Revolver maturity + equipment loans" },
        { year: "2028", amount: 80, desc: "Term loan facilities" },
        { year: "Other", amount: 50, desc: "Other secured obligations" },
      ],
    },
    earningsDate: null,
    earningsTime: null,
    lastEarnings: "Private — no public earnings",
    earningsCallSummary: {
      date: "N/A",
      quarter: "Private Company",
      source: "Private company — financials from bank group information package",
      keyFinancials: [
        "Private company — Beusa Holdings / Beusa Energy, The Woodlands, TX",
        "Estimated revenue $100M-$250M based on industry data; exact figures from bank package only",
        "Parent company of Evolution Well Services (electric frac) and Dynamis Power Solutions",
      ],
      production: [
        "Operations across Haynesville/Bossier (LA), Permian (TX/NM), Eagle Ford (TX), Marcellus/Utica (PA/OH)",
        "Vertically integrated: E&P, electric frac (Evolution), turbine power (Dynamis), logistics",
        "~140-200 employees across operations",
      ],
      creditRelevant: [
        "Private — limited financial transparency; rely on bank group reporting",
        "Small-to-midsize oilfield services company with commodity exposure",
        "Evolution Well Services is market leader in electric hydraulic fracturing — growing segment",
        "Capital-intensive business model with equipment fleet financing needs",
      ],
      strategicItems: [
        "Electric frac technology differentiator — 100% electric equipment reduces emissions",
        "Dynamis expanding into data center and grid stabilization power solutions",
        "30-year operating history in energy sector",
      ],
      analystQA: [],
    },
    analystRating: "NR",
    targetPrice: null,
    news: [
      { date: "2025-11-25", src: "Company", headline: "Beusa Energy rebrands, highlighting integrated energy solutions beyond oil & gas", sentiment: "positive" },
    ],
    ratingHistory: [],
    financials: [
      { period: "FY2025E", rev: 250, ebitda: 55, ni: 10, debt: 200, cash: 45 },
      { period: "FY2024E", rev: 220, ebitda: 48, ni: 5, debt: 210, cash: 35 },
    ],
    research: [],
    debtMaturities: { items: [] },
  },
  {
    id: "SMC",
    name: "Summit Midstream Corp.",
    sector: "Midstream / Energy",
    exposure: 12000000,
    sp: "NR",
    moodys: "NR",
    fitch: "NR",
    impliedRating: "B",
    outlook: "Stable",
    watchlist: true,
    cds5y: 650,
    cds5yChg: -25,
    bondSpread: 520,
    bondSpreadChg: -15,
    eqPrice: 28.50,
    eqChg: 3.7,
    mktCap: 0.62,
    ltDebt: 930,
    totalDebt: 930,
    cash: 21,
    ebitda: 243,
    intExp: 90,
    revenue: 430,
    netIncome: -25,
    totalAssets: 2800,
    totalEquity: 470,
    fcf: 17,
    currentAssets: 85,
    currentLiab: 125,
    grossLeverage: 3.8,
    netLeverage: 3.7,
    intCov: 2.7,
    debtToEquity: 1.98,
    currentRatio: 0.68,
    roic: 3.5,
    cashBurnQtr: 4,
    liquidityRunway: "Adequate — $500M ABL + FCF",
    adjBurn: {
      adjEBITDA: 243,
      adjEBITDA_src: "FY2025 Earnings Release; reported adj EBITDA $242.6M",
      incomeTaxes: 5,
      incomeTaxes_src: "FY2025 10-K; minimal cash taxes; NOL carryforwards",
      prefDividends: 0,
      prefDividends_src: "Series A preferred — accrued dividends, planning repayment",
      maintCapex: 18,
      totalCapex: 89,
      totalCapex_src: "FY2025 actual $89M; includes $15-20M maintenance + growth connections",
      currentLTD: 7,
      currentLTD_src: "Remaining term loans due 2026 (~$7M)",
      intExpCash: 90,
      intExpCash_src: "FY2025; ~9.5% weighted avg on $930M total debt + Permian facility",
    },
    liquidityBreakdown: {
      totalLiquidity: 458,
      components: [
        { category: "Cash & Cash Equivalents", amount: 21, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 21 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 437, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "ABL Revolving Credit Facility", committed: 500, drawn: 112, available: 387, maturity: "2028", rate: "SOFR + spread", secured: "Senior Secured", notes: "Gross availability $810M per borrowing base (exceeds $500M commitments); $112M drawn at year-end; $40M repayment planned from Double E distribution (pro forma ~$72M drawn); first lien leverage 0.5x vs 2.5x max covenant; $0.8M issued but undrawn LCs" },
        { name: "Permian Transmission Term Loan", committed: 440, drawn: 340, available: 50, maturity: "Mar 2031", rate: "SOFR + spread", secured: "Project Secured", notes: "New $440M facility (closed Mar 2026): $340M drawn at closing + $50M committed delayed draw for expansion + $50M accordion; replaced prior Permian facility ($112.7M balance) and subsidiary preferred equity" },
      ],
      debtMaturities: [
        { year: "2026", amount: 7, desc: "Remaining term loans" },
        { year: "2027", amount: 7, desc: "5.25% Senior Secured Notes" },
        { year: "2028", amount: 389, desc: "4.75% Senior Secured Notes ($277M) + ABL drawn ($112M)" },
        { year: "2029", amount: 350, desc: "8.50% Senior Secured Notes" },
        { year: "2031", amount: 340, desc: "Permian Transmission Term Loan" },
        { year: "Other", amount: 250, desc: "Second Lien Notes + other" },
      ],
    },
    earningsDate: "2026-05-15",
    earningsTime: "After Close",
    lastEarnings: "In-line — adj EBITDA $58.6M (Q4)",
    earningsCallSummary: {
      date: "March 16, 2026",
      quarter: "Q4 FY2025",
      source: "SEC Filing: Q4 FY2025 Earnings Release + Earnings Call",
      keyFinancials: [
        "Q4 adjusted EBITDA $58.6M; FY2025 adjusted EBITDA $243M",
        "Q4 distributable cash flow $33.7M; Q4 free cash flow $17.0M",
        "FY2025 capex $89M ($19M in Q4); 2026 EBITDA guidance $225M-$265M",
        "Net debt ~$930M at year-end; total leverage 4.1x (excl. Tall Oak earnout)",
      ],
      production: [
        "Average daily natural gas throughput increasing on wholly owned systems",
        "Double E Pipeline signed three new 10+-year firm take-or-pay contracts",
        "Launched binding open season on Double E to increase firm capacity by up to 50% to ~2.4 Bcf/d",
      ],
      creditRelevant: [
        "Total leverage 4.1x — elevated but improving; interest coverage 2.7x (covenant minimum 2.0x)",
        "ABL Revolver: $500M committed, $810M gross availability; borrowing base well in excess",
        "In compliance with all financial covenants as of Dec 31, 2025",
        "First lien leverage 0.5x vs. 2.5x max covenant — significant headroom",
        "Permian Transmission Credit Facility balance $112.7M, declining via scheduled payments",
      ],
      strategicItems: [
        "Double E pipeline driving Permian segment EBITDA growth from $34M (2025) to ~$60M target by 2029",
        "New 10-year crude gathering contract in Divide County, ND (200K+ acres)",
        "Piceance MVC payments declining from $17M (2025) to $13M (2026), rolling off fully in 2027",
        "Planning to resume common stock dividend after Series A preferred repayment",
      ],
      analystQA: [
        "2026 EBITDA bridge? — CFO Mault: Guidance of $225M-$265M reflects customer development schedules and Double E contract ramps",
        "Deleveraging timeline? — Management: Targeting further debt reduction through FCF; pro forma net debt ~$890M after $40M ABL repayment",
      ],
    },
    analystRating: "Hold",
    targetPrice: 32.00,
    news: [
      { date: "2026-03-16", src: "PR Newswire", headline: "Summit Midstream reports Q4/FY2025; signs new 10-year Double E contracts", sentiment: "positive" },
      { date: "2025-08-12", src: "SEC", headline: "Summit Midstream Q2 adj EBITDA $61.1M; expects FY near low end of guidance", sentiment: "negative" },
    ],
    ratingHistory: [
      { date: "2025-01", sp: "NR", moodys: "NR", fitch: "NR", event: "$250M Second Lien add-on executed" },
      { date: "2024-10", sp: "NR", moodys: "NR", fitch: "NR", event: "Tall Oak Midstream III acquisition completed" },
    ],
    financials: [
      { period: "FY2025", rev: 430, ebitda: 243, ni: -25, debt: 930, cash: 21 },
      { period: "FY2024", rev: 430, ebitda: 225, ni: -122, debt: 977, cash: 23 },
      { period: "FY2023", rev: 400, ebitda: 210, ni: -80, debt: 1050, cash: 18 },
    ],
    research: [
      { date: "2026-03-17", firm: "Stifel", action: "Hold", pt: 30, summary: "Double E contract wins de-risk Permian growth; leverage still elevated at 4.1x but trajectory improving." },
    ],
    debtMaturities: {
      items: [
        { year: "2026", amount: 7, desc: "Remaining term loans due 2026" },
        { year: "2027", amount: 7, desc: "5.25% Senior Secured Notes" },
        { year: "2028", amount: 389, desc: "4.75% Senior Secured Notes + ABL drawn" },
        { year: "2029", amount: 350, desc: "8.50% Senior Secured Notes" },
        { year: "2031", amount: 340, desc: "Permian Transmission Term Loan" },
        { year: "Other", amount: 250, desc: "Second Lien Notes + other" },
      ],
    },
  },
  {
    id: "UPBD",
    name: "Upbound Group Inc.",
    sector: "Consumer Finance / RTO",
    exposure: 18000000,
    sp: "BB-",
    moodys: "Ba3",
    fitch: "NR",
    impliedRating: "BB-",
    outlook: "Stable",
    watchlist: false,
    cds5y: 380,
    cds5yChg: 5,
    bondSpread: 340,
    bondSpreadChg: 10,
    eqPrice: 19.30,
    eqChg: -5.2,
    mktCap: 1.12,
    ltDebt: 1730,
    totalDebt: 1730,
    cash: 120,
    ebitda: 500,
    intExp: 115,
    revenue: 4680,
    netIncome: 130,
    totalAssets: 5200,
    totalEquity: 650,
    fcf: 175,
    currentAssets: 1800,
    currentLiab: 720,
    grossLeverage: 3.5,
    netLeverage: 3.2,
    intCov: 4.3,
    debtToEquity: 2.66,
    currentRatio: 2.50,
    roic: 9.9,
    cashBurnQtr: 44,
    liquidityRunway: "Adequate — strong FCF generation",
    adjBurn: {
      adjEBITDA: 500,
      adjEBITDA_src: "FY2025 guidance $500-$510M adj EBITDA excl. SBC",
      incomeTaxes: 35,
      incomeTaxes_src: "FY2025 estimated; ~22% effective on adjusted pre-tax",
      prefDividends: 0,
      prefDividends_src: "No preferred stock",
      maintCapex: 30,
      totalCapex: 50,
      totalCapex_src: "FY2025 estimated; store maintenance + technology investment",
      currentLTD: 45,
      currentLTD_src: "Estimated current portion of term loan amortization",
      intExpCash: 115,
      intExpCash_src: "FY2025; ~6.7% weighted avg on $1.73B total debt",
    },
    liquidityBreakdown: {
      totalLiquidity: 620,
      components: [
        { category: "Cash & Cash Equivalents", amount: 120, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 120 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 500, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "ABL Revolving Credit Facility", committed: 600, drawn: 100, available: 500, maturity: "2028", rate: "SOFR + spread", secured: "Senior Secured", notes: "Availability based on eligible lease receivables borrowing base; strong current ratio of 2.5x supports liquidity" },
      ],
      debtMaturities: [
        { year: "2026", amount: 0, desc: "No maturities" },
        { year: "2027", amount: 0, desc: "No maturities" },
        { year: "2028", amount: 875, desc: "Term Loan B + Senior Secured Notes" },
        { year: "2029", amount: 500, desc: "Senior Unsecured Notes" },
        { year: "Other", amount: 355, desc: "ABL + other secured" },
      ],
    },
    earningsDate: "2026-04-30",
    earningsTime: "Before Open",
    lastEarnings: "Beat — non-GAAP EPS $1.00 vs $0.95 est.",
    earningsCallSummary: {
      date: "Q4 FY2025 (pending — not yet reported)",
      quarter: "FY2025 Full Year",
      source: "SEC Filings: Q1-Q3 FY2025 Earnings Releases",
      keyFinancials: [
        "Q3 FY2025 revenue $1,168M; FY2025 revenue guidance $4.60B-$4.75B",
        "Q3 adj EBITDA $123.6M (up 5.7% YoY); FY2025 EBITDA guidance $500-$510M",
        "Q3 non-GAAP diluted EPS $1.00 vs $0.95 prior year",
        "2026 outlook: revenue $4.7B-$4.95B; adj EBITDA $500M-$535M",
      ],
      production: [
        "Acima (virtual lease-to-own): Growing GMV through retail partner expansion; rising LCO rates a concern",
        "Rent-A-Center: Same-store sales stabilizing; company-owned SSS down 3.6% (improving sequentially)",
        "Brigit (fintech acquisition Jan 2025): Subscription-based financial tools for underserved consumers",
        "~1,800 Rent-A-Center store locations in US, Mexico, Puerto Rico",
      ],
      creditRelevant: [
        "Net leverage ~2.9x; within manageable range for BB-minus credit",
        "Strong FCF generation ($150-$200M FY2025 guidance) supports deleveraging",
        "Acima LCO (lease charge-off) rates trending — key credit metric; Q3 at 9.7%",
        "High debt-to-equity at 2.67x reflects acquisition-related leverage (Acima, Brigit)",
        "Current ratio strong at 2.5x — ample short-term liquidity",
      ],
      strategicItems: [
        "Omnichannel strategy: Acima (digital/virtual) + Rent-A-Center (stores) + Brigit (fintech)",
        "Serving credit-constrained / non-prime consumers — counter-cyclical demand element",
        "Fahmi Karam became CEO (previously CFO); focus on execution and shareholder value",
        "Quarterly dividend of $0.39/share maintained",
      ],
      analystQA: [
        "Acima growth vs. credit quality? — Management: Tighter underwriting to manage LCO rates while growing retail partnerships",
        "Leverage reduction path? — CFO: FCF of $150-200M annually; expect deleveraging from earnings growth rather than debt paydown",
      ],
    },
    analystRating: "Buy",
    targetPrice: 22.00,
    news: [
      { date: "2026-02-20", src: "Business Wire", headline: "Upbound posts strong FY2025 results; sets 2026 outlook for revenue growth and EBITDA expansion", sentiment: "positive" },
      { date: "2025-10-30", src: "Seeking Alpha", headline: "Upbound Q3: Acima LCO rates rising but non-GAAP EPS beats; EBITDA guidance lowered modestly", sentiment: "negative" },
      { date: "2025-05-01", src: "Business Wire", headline: "Upbound Q1 2025 revenue up 7.3% YoY; Brigit acquisition adding segment diversification", sentiment: "positive" },
    ],
    ratingHistory: [
      { date: "2025-01", sp: "BB-", moodys: "Ba3", fitch: "NR", event: "Brigit fintech acquisition completed ($460M)" },
      { date: "2024-06", sp: "BB-", moodys: "Ba3", fitch: "NR", event: "Ratings affirmed with stable outlook" },
    ],
    financials: [
      { period: "FY2025E", rev: 4680, ebitda: 500, ni: 130, debt: 1730, cash: 120 },
      { period: "FY2024", rev: 4320, ebitda: 455, ni: 121, debt: 1750, cash: 105 },
      { period: "FY2023", rev: 3990, ebitda: 420, ni: 95, debt: 1650, cash: 90 },
      { period: "FY2022", rev: 4300, ebitda: 475, ni: 185, debt: 1500, cash: 115 },
    ],
    research: [
      { date: "2026-03-01", firm: "Loop Capital", action: "Buy", pt: 22, summary: "Acima growth + Brigit diversification underappreciated; 2026 EBITDA expansion should drive re-rating." },
      { date: "2025-12-15", firm: "Seeking Alpha", action: "Hold", pt: 18, summary: "Cheap valuation justified by elevated leverage, Acima credit stress, and store count headwinds." },
    ],
    debtMaturities: {
      items: [
        { year: "2028", amount: 875, desc: "Term Loan B + Senior Secured Notes" },
        { year: "2029", amount: 500, desc: "Senior Unsecured Notes" },
        { year: "Other", amount: 355, desc: "ABL + other secured facilities" },
      ],
    },
  },
  {
    id: "WSC",
    name: "WillScot Holdings Corp.",
    sector: "Industrial Services / Modular Space",
    exposure: 22000000,
    sp: "BB+",
    moodys: "Ba2",
    fitch: "NR",
    impliedRating: "BB+",
    outlook: "Stable",
    watchlist: false,
    cds5y: 220,
    cds5yChg: -5,
    bondSpread: 195,
    bondSpreadChg: -3,
    eqPrice: 29.15,
    eqChg: -8.2,
    mktCap: 5.4,
    ltDebt: 3400,
    totalDebt: 3400,
    cash: 35,
    ebitda: 971,
    intExp: 218,
    revenue: 2282,
    netIncome: 134,
    totalAssets: 13500,
    totalEquity: 3200,
    fcf: 450,
    currentAssets: 520,
    currentLiab: 680,
    grossLeverage: 3.5,
    netLeverage: 3.5,
    intCov: 4.5,
    debtToEquity: 1.06,
    currentRatio: 0.76,
    roic: 16.7,
    cashBurnQtr: 112,
    liquidityRunway: "Strong — $1.6B ABL availability",
    adjBurn: {
      adjEBITDA: 971,
      adjEBITDA_src: "FY2025 Earnings Release; adj EBITDA ~$971M at 42.5% margin",
      incomeTaxes: 50,
      incomeTaxes_src: "FY2025 estimated; ~25% effective rate on adjusted pre-tax",
      prefDividends: 0,
      prefDividends_src: "No preferred stock",
      maintCapex: 100,
      totalCapex: 200,
      totalCapex_src: "FY2025 net capex estimated; fleet maintenance + growth",
      currentLTD: 50,
      currentLTD_src: "Redeemed $50M of 7.375% 2031 notes in Q4 2025; ongoing amortization",
      intExpCash: 218,
      intExpCash_src: "FY2025; weighted avg ~5.7% after swaps on ~$3.4B debt; per Q3 2025 earnings",
    },
    liquidityBreakdown: {
      totalLiquidity: 1635,
      components: [
        { category: "Cash & Cash Equivalents", amount: 35, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 35 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 1600, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "ABL Revolving Credit Facility", committed: 3600, drawn: 2000, available: 1600, maturity: "Oct 2030", rate: "SOFR + spread", secured: "Senior Secured", notes: "Amended Oct 2025 extending maturity to 2030; ~$5M annual interest savings; availability based on fleet asset borrowing base; 89% fixed after $1.25B swaps" },
      ],
      debtMaturities: [
        { year: "2026", amount: 0, desc: "No maturities" },
        { year: "2027", amount: 0, desc: "No maturities" },
        { year: "2028", amount: 1000, desc: "Senior Secured Notes due 2028" },
        { year: "2029", amount: 900, desc: "Senior Secured Notes due 2029" },
        { year: "2030", amount: 1000, desc: "ABL Facility (maturity Oct 2030) + Notes" },
        { year: "2031", amount: 500, desc: "7.375% Senior Secured Notes (partially redeemed)" },
        { year: "Other", amount: 0, desc: "" },
      ],
    },
    earningsDate: "2026-05-07",
    earningsTime: "Before Open",
    lastEarnings: "Mixed — adj EBITDA $250M, net loss $187M (impairment)",
    earningsCallSummary: {
      date: "February 19, 2026",
      quarter: "Q4 FY2025",
      source: "SEC Filing: Q4 FY2025 Earnings Release + Press Release",
      keyFinancials: [
        "Q4 revenue $566M; FY2025 revenue ~$2,282M (down from $2,396M in FY2024)",
        "Q4 adjusted EBITDA $250M (44.2% margin); FY2025 adj EBITDA ~$971M",
        "Q4 net loss of -$187M due to non-cash impairment; adj net income $55M",
        "FY2025 net income $134M; adj income ~$219M",
      ],
      production: [
        "Average modular space monthly rates up 5.2% YoY; portable storage rates up 1.9%",
        "Units on rent declined slightly due to macro-related end-market softness",
        "Pending order book up 7% YoY — supports new lease activations",
        "2026 outlook: Revenue ~$2,225-$2,425M; Adj EBITDA ~$980-$1,080M",
      ],
      creditRelevant: [
        "Net Debt / adj EBITDA at 3.5x — within target range of 3.0-3.5x",
        "Redeemed $50M of 7.375% 2031 notes using ABL to optimize interest costs",
        "ABL Facility amended Oct 2025 — maturity extended to Oct 2030; ~$5M annual interest savings",
        "ABL availability ~$1.6B; next debt maturity not until 2028",
        "Weighted avg pre-tax interest rate ~5.7% (89% fixed after swaps)",
        "Annual cash interest expense ~$218M",
      ],
      strategicItems: [
        "3-5 year financial milestones: $3B revenue, $1.5B adj EBITDA, $700M adj FCF",
        "Value-added products and services (VAPS) driving rate expansion",
        "Tuck-in acquisition pipeline progressing alongside organic growth",
        "Returned $21M to shareholders in Q3 via buybacks and dividends",
      ],
      analystQA: [
        "Organic growth vs. M&A? — CEO Soultz: Multiple levers to achieve growth through different end-market backdrops; nimble approach",
        "Leverage trajectory? — Management: Comfortable within 3.0-3.5x range; FCF generation and EBITDA growth support current levels",
      ],
    },
    analystRating: "Buy",
    targetPrice: 38.00,
    news: [
      { date: "2026-02-19", src: "Globe Newswire", headline: "WillScot reports Q4/FY2025 results; adj EBITDA margins resilient at 44%", sentiment: "positive" },
      { date: "2025-10-16", src: "Business Wire", headline: "WillScot amends ABL facility — extends maturity to 2030, reduces borrowing costs", sentiment: "positive" },
      { date: "2025-05-01", src: "Reuters", headline: "WillScot Q1 results in-line; reaffirms FY2025 outlook; pending order book up 7%", sentiment: "positive" },
    ],
    ratingHistory: [
      { date: "2025-10", sp: "BB+", moodys: "Ba2", fitch: "NR", event: "ABL maturity extended to 2030; stable outlook maintained" },
      { date: "2025-03", sp: "BB+", moodys: "Ba2", fitch: "NR", event: "Investor Day: 3-5 year targets of $3B rev, $1.5B EBITDA, $700M adj FCF" },
    ],
    financials: [
      { period: "FY2025", rev: 2282, ebitda: 971, ni: 134, debt: 3400, cash: 35 },
      { period: "FY2024", rev: 2396, ebitda: 1063, ni: 28, debt: 3500, cash: 40 },
      { period: "FY2023", rev: 2365, ebitda: 1061, ni: 342, debt: 3400, cash: 45 },
      { period: "FY2022", rev: 2140, ebitda: 930, ni: 290, debt: 3200, cash: 50 },
    ],
    research: [
      { date: "2026-02-20", firm: "RBC Capital", action: "Outperform", pt: 40, summary: "Recurring revenue model provides stability; pricing power + VAPS penetration support margin expansion path." },
      { date: "2025-10-17", firm: "Morgan Stanley", action: "Overweight", pt: 42, summary: "ABL refinancing positive; 3-5 year targets ambitious but achievable given track record." },
    ],
    debtMaturities: {
      items: [
        { year: "2028", amount: 1000, desc: "Senior Secured Notes due 2028" },
        { year: "2029", amount: 900, desc: "Senior Secured Notes due 2029" },
        { year: "2030", amount: 1000, desc: "ABL Facility (extended Oct 2030) + Notes" },
        { year: "2031", amount: 500, desc: "7.375% Senior Secured Notes (partially redeemed)" },
      ],
    },
  },
  {
    id: "JSWUSA",
    name: "JSW Steel USA Inc.",
    sector: "Steel / Metals",
    exposure: 8000000,
    sp: "NR",
    moodys: "NR",
    fitch: "NR",
    impliedRating: "BB-",
    outlook: "Stable",
    watchlist: true,
    cds5y: null,
    cds5yChg: null,
    bondSpread: null,
    bondSpreadChg: null,
    eqPrice: null,
    eqChg: null,
    mktCap: null,
    ltDebt: 350,
    totalDebt: 350,
    cash: 60,
    ebitda: 85,
    intExp: 22,
    revenue: 1200,
    netIncome: 25,
    totalAssets: 1100,
    totalEquity: 400,
    fcf: 30,
    currentAssets: 350,
    currentLiab: 250,
    grossLeverage: 4.1,
    netLeverage: 3.4,
    intCov: 3.9,
    debtToEquity: 0.88,
    currentRatio: 1.40,
    roic: 5.5,
    cashBurnQtr: 21,
    liquidityRunway: "Backed by JSW Group ($24B parent)",
    adjBurn: {
      adjEBITDA: 85,
      adjEBITDA_src: "Estimated from parent disclosures; US operations profitable at operating level per JSW Steel FY24-25 filings",
      incomeTaxes: 8,
      incomeTaxes_src: "Estimated; US federal + Ohio state taxes",
      prefDividends: 0,
      prefDividends_src: "No preferred stock; subsidiary of JSW Steel Ltd",
      maintCapex: 20,
      totalCapex: 40,
      totalCapex_src: "Estimated; ongoing EAF modernization + rolling mill upgrades",
      currentLTD: 15,
      currentLTD_src: "Estimated current portion of conduit revenue bonds + working capital facilities",
      intExpCash: 22,
      intExpCash_src: "Estimated; ~6% on $350M debt including conduit bonds",
    },
    liquidityBreakdown: {
      totalLiquidity: 120,
      components: [
        { category: "Cash & Cash Equivalents", amount: 60, type: "cash", sub: [
          { label: "Unrestricted Cash", amount: 55 },
          { label: "Restricted Cash (bond proceeds)", amount: 5 },
        ]},
        { category: "Undrawn Credit Facilities", amount: 60, type: "facility", sub: [] },
      ],
      facilities: [
        { name: "Working Capital Facility", committed: 75, drawn: 15, available: 60, maturity: "2027", rate: "SOFR + 2.50%", secured: "Senior Secured", notes: "Secured by inventory and receivables; parent JSW Group implicit backstop" },
      ],
      debtMaturities: [
        { year: "2026", amount: 15, desc: "Current portion of term facilities" },
        { year: "2027", amount: 25, desc: "Working capital facility maturity" },
        { year: "2028", amount: 160, desc: "Tax-exempt conduit revenue bonds (Jefferson County Port Authority)" },
        { year: "Other", amount: 150, desc: "Parent-backed facilities + other" },
      ],
    },
    earningsDate: null,
    earningsTime: null,
    lastEarnings: "Private — parent JSW Steel FY25 reported",
    earningsCallSummary: {
      date: "N/A",
      quarter: "Private Subsidiary",
      source: "Private subsidiary of JSW Steel Limited (India) — financials from bank group / parent disclosures",
      keyFinancials: [
        "Private US subsidiary of JSW Group ($24B Indian conglomerate)",
        "Estimated US revenue ~$1.2B across Ohio (Mingo Junction) and Texas (Baytown) operations",
        "Parent JSW Steel reported consolidated net debt of INR 76,563 crores (~$9.1B) as of March 2025",
        "Parent leverage improved — net debt/EBITDA declining on healthy cash generation",
      ],
      production: [
        "Two US locations: Mingo Junction, OH (EAF + slab caster + 80\" hot rolling mill) and Baytown, TX (plate mill)",
        "Ohio facility acquired 2018 for ~$81M; invested $119M+ in modernization",
        "Produces hot rolled coil (HRC) and plate for energy, infrastructure, and renewable sectors",
        "Largest and most modern Consteel EAF technology in North America",
      ],
      creditRelevant: [
        "Private — limited standalone financial transparency; rely on bank group reporting",
        "Implicit parent support from JSW Steel Ltd (India) — one of India's largest steelmakers",
        "US operations profitable at operating level per parent disclosures (FY2023-2024)",
        "Cyclical steel industry exposure — margins sensitive to scrap prices and HRC/plate spreads",
        "$160M in tax-exempt conduit revenue bonds issued via Jefferson County Port Authority for plant upgrades",
      ],
      strategicItems: [
        "Growing focus on 'melted and manufactured in USA' products for infrastructure and renewable energy",
        "ESG differentiator: Consteel EAF technology produces among the cleanest steel globally",
        "Parent JSW Group has 29.7 MTPA installed capacity worldwide; global scale advantage",
        "Potential beneficiary of US infrastructure spending and domestic steel tariff protection",
      ],
      analystQA: [],
    },
    analystRating: "NR",
    targetPrice: null,
    news: [
      { date: "2025-05-05", src: "Recycling Today", headline: "JSW Steel USA plans $119M+ investment in Ohio EAF mill for renewable energy steel", sentiment: "positive" },
      { date: "2025-03-15", src: "JSW Group", headline: "Parent JSW Steel FY25: net debt declined; healthy domestic demand in India supports operations", sentiment: "positive" },
    ],
    ratingHistory: [],
    financials: [
      { period: "FY2025E", rev: 1200, ebitda: 85, ni: 25, debt: 350, cash: 60 },
      { period: "FY2024E", rev: 1100, ebitda: 72, ni: 15, debt: 320, cash: 50 },
      { period: "FY2023E", rev: 950, ebitda: 60, ni: 8, debt: 280, cash: 40 },
    ],
    research: [],
    debtMaturities: {
      items: [
        { year: "2028", amount: 160, desc: "Tax-exempt conduit revenue bonds (Jefferson County Port Authority)" },
        { year: "Other", amount: 190, desc: "Working capital + parent-backed facilities" },
      ],
    },
  },
];

// ─── UTILITIES ──────────────────────────────────────────────────────────────
const fmt = (n, d = 0) => {
  if (n === null || n === undefined) return "\u2014";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(d)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(d)}K`;
  return `$${n.toFixed(d)}`;
};
const fmtNum = (n, d = 1) => (n === null || n === undefined ? "\u2014" : n.toFixed(d));
const pct = (n) => (n === null || n === undefined ? "\u2014" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const bps = (n) => (n === null || n === undefined ? "\u2014" : `${n > 0 ? "+" : ""}${n}`);

const ratingScore = (r) => {
  const map = { AAA: 1, "AA+": 2, AA: 3, "AA-": 4, "A+": 5, A: 6, "A-": 7, "BBB+": 8, BBB: 9, "BBB-": 10, "BB+": 11, BB: 12, "BB-": 13, "B+": 14, B: 15, "B-": 16, "CCC+": 17, CCC: 18, NR: 20, Aaa: 1, Aa1: 2, Aa2: 3, Aa3: 4, A1: 5, A2: 6, A3: 7, Baa1: 8, Baa2: 9, Baa3: 10, Ba1: 11, Ba2: 12, Ba3: 13, B1: 14, B2: 15, B3: 16, Caa1: 17, Caa2: 18 };
  return map[r] || 20;
};

const ratingColor = (r) => {
  if (r === "NR") return "#64748b";
  const s = ratingScore(r);
  if (s <= 4) return "#22c55e";
  if (s <= 7) return "#84cc16";
  if (s <= 10) return "#eab308";
  if (s <= 13) return "#f97316";
  return "#ef4444";
};

const outlookIcon = (o) => {
  if (o === "Positive") return "\u25B2";
  if (o === "Negative") return "\u25BC";
  if (o === "Developing") return "\u25C6";
  return "\u25CF";
};

const outlookColor = (o) => {
  if (o === "Positive") return "#22c55e";
  if (o === "Negative") return "#ef4444";
  if (o === "Developing") return "#f97316";
  return "#94a3b8";
};

const sentimentColor = (s) => {
  if (s === "positive") return "#22c55e";
  if (s === "negative") return "#ef4444";
  return "#94a3b8";
};

// Compute LTM Adjusted Cash Flow from adjBurn object
const ltmAdjCashFlow = (c) => {
  if (!c.adjBurn) return c.fcf || 0;
  const ab = c.adjBurn;
  const capex = ab.maintCapex !== null ? ab.maintCapex : ab.totalCapex;
  return ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capex - ab.currentLTD - ab.intExpCash;
};

// ─── SPARKLINE ──────────────────────────────────────────────────────────────
const Sparkline = ({ data, color = "#60a5fa", w = 80, h = 24 }) => {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

// ─── BAR CHART ──────────────────────────────────────────────────────────────
const MiniBar = ({ data, labels, color = "#60a5fa", w = 200, h = 80 }) => {
  if (!data || data.length === 0) return null;
  const mx = Math.max(...data.map(Math.abs));
  const barW = w / data.length - 4;
  const zeroY = h * 0.5;
  return (
    <svg width={w} height={h + 18} style={{ display: "block" }}>
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#334155" strokeWidth="0.5" />
      {data.map((v, i) => {
        const bh = (Math.abs(v) / (mx || 1)) * (h * 0.45);
        const isNeg = v < 0;
        return (
          <g key={i}>
            <rect x={i * (barW + 4) + 2} y={isNeg ? zeroY : zeroY - bh} width={barW} height={bh} rx={2} fill={isNeg ? "#ef4444" : color} opacity={0.85} />
            <text x={i * (barW + 4) + 2 + barW / 2} y={h + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">{labels?.[i] || ""}</text>
          </g>
        );
      })}
    </svg>
  );
};

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function CreditRiskMonitor() {
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("overview");
  const [detailTab, setDetailTab] = useState("financials");
  const [now, setNow] = useState(new Date());
  const [winW, setWinW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [watchlistOverrides, setWatchlistOverrides] = useState({});
  const [showOverrideModal, setShowOverrideModal] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");

  // ─── LIVE DATA STATE ──────────────────────────────────────────────────
  const [secFilings, setSecFilings] = useState([]);
  const [liveNews, setLiveNews] = useState([]);
  const [marketData, setMarketData] = useState({});
  const [dataLoading, setDataLoading] = useState({ sec: false, news: false, market: false });
  const [dataError, setDataError] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);

  // Forward projection state
  const [projBurnChange, setProjBurnChange] = useState(0);   // -50% to +50%
  const [projRevGrowth, setProjRevGrowth] = useState(10);     // 0% to 50%
  const [projCapexChange, setProjCapexChange] = useState(0);  // -30% to +30%

  // ─── LIVE DATA FETCHERS ───────────────────────────────────────────────
  const fetchSecFilings = useCallback(async () => {
    setDataLoading(prev => ({ ...prev, sec: true }));
    try {
      const resp = await fetch("/api/sec_filings?all=true&days=30");
      const data = await resp.json();
      if (data.filings) setSecFilings(data.filings);
      setDataError(prev => ({ ...prev, sec: null }));
    } catch (e) {
      setDataError(prev => ({ ...prev, sec: e.message }));
    }
    setDataLoading(prev => ({ ...prev, sec: false }));
  }, []);

  const fetchLiveNews = useCallback(async () => {
    setDataLoading(prev => ({ ...prev, news: true }));
    try {
      const resp = await fetch("/api/news?all=true&max=6");
      const data = await resp.json();
      if (data.news) setLiveNews(data.news);
      setDataError(prev => ({ ...prev, news: null }));
    } catch (e) {
      setDataError(prev => ({ ...prev, news: e.message }));
    }
    setDataLoading(prev => ({ ...prev, news: false }));
  }, []);

  const fetchMarketData = useCallback(async () => {
    setDataLoading(prev => ({ ...prev, market: true }));
    try {
      const resp = await fetch("/api/market_data?all=true");
      const data = await resp.json();
      if (data.quotes) setMarketData(data.quotes);
      setDataError(prev => ({ ...prev, market: null }));
    } catch (e) {
      setDataError(prev => ({ ...prev, market: e.message }));
    }
    setDataLoading(prev => ({ ...prev, market: false }));
  }, []);

  const refreshAll = useCallback(() => {
    fetchSecFilings();
    fetchLiveNews();
    fetchMarketData();
    setLastRefresh(new Date());
  }, [fetchSecFilings, fetchLiveNews, fetchMarketData]);

  useEffect(() => { refreshAll(); }, []);

  // Severity colors and icons
  const sevColor = { critical: "#dc2626", material: "#f97316", notable: "#eab308", routine: "#64748b" };
  const sevIcon = { critical: "\u26D4", material: "\u26A0", notable: "\u25C6", routine: "\u25CB" };
  const sentColor = { positive: "#22c55e", negative: "#ef4444", neutral: "#64748b" };

  // ─── PEER COMPARISON DATA ─────────────────────────────────────────────
  // ─── WATCHLIST ENGINE ─────────────────────────────────────────────────
  const autoWatchlistTriggers = (c) => {
    const triggers = [];
    if (c.sp === "NR" && c.moodys === "NR") triggers.push("Unrated by all agencies");
    if (c.ebitda < 0) triggers.push("Negative EBITDA");
    const impliedMap = { "CCC+": 17, CCC: 18, "CCC-": 19, CC: 20, C: 21, D: 22 };
    if (impliedMap[c.impliedRating]) triggers.push(`Implied rating ${c.impliedRating} (CCC-tier or below)`);
    if (c.intCov < 2 && c.intCov > -99) triggers.push(`Interest coverage ${c.intCov.toFixed(1)}x (below 2.0x)`);
    if (c.ebitda > 0 && c.totalDebt / c.ebitda > 5) triggers.push(`Gross leverage ${(c.totalDebt / c.ebitda).toFixed(1)}x (above 5.0x)`);
    if (!c.mktCap && c.sp === "NR") triggers.push("Private company with no public reporting");
    return triggers;
  };

  const getWatchlistStatus = (c) => {
    const override = watchlistOverrides[c.id];
    if (override) return { active: override.status, source: "override", reason: override.reason, triggers: autoWatchlistTriggers(c) };
    const triggers = autoWatchlistTriggers(c);
    return { active: triggers.length > 0, source: "auto", reason: null, triggers };
  };

  const toggleOverride = (id, status, reason) => {
    setWatchlistOverrides(prev => ({
      ...prev,
      [id]: { status, reason, date: new Date().toISOString().split("T")[0], analyst: "Current User" }
    }));
    setShowOverrideModal(null);
    setOverrideReason("");
  };

  const clearOverride = (id) => {
    setWatchlistOverrides(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ─── PEER COMPARISON DATA ─────────────────────────────────────────────
  const peerBenchmarks = useMemo(() => {
    const all_cos = PORTFOLIO;
    const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a,b) => a-b); const m = Math.floor(s.length/2); return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; };
    return {
      medianLeverage: median(all_cos.filter(c => c.ebitda > 0).map(c => c.totalDebt / c.ebitda)),
      medianIntCov: median(all_cos.filter(c => c.intCov > 0 && c.intCov < 100).map(c => c.intCov)),
      medianCurrentRatio: median(all_cos.map(c => c.currentRatio)),
      medianMargin: median(all_cos.filter(c => c.revenue > 0).map(c => (c.ebitda / c.revenue) * 100)),
      sectorConc: (() => {
        const sectors = {};
        all_cos.forEach(c => { sectors[c.sector] = (sectors[c.sector] || 0) + 1; });
        return Object.entries(sectors).map(([s, n]) => ({ sector: s, count: n, pct: (n / all_cos.length * 100) })).sort((a,b) => b.count - a.count);
      })(),
      ratingConc: (() => {
        const ratings = {};
        all_cos.forEach(c => { const r = c.impliedRating || "NR"; ratings[r] = (ratings[r] || 0) + 1; });
        return Object.entries(ratings).map(([r, n]) => ({ rating: r, count: n, pct: (n / all_cos.length * 100) })).sort((a,b) => b.count - a.count);
      })(),
      watchlistPct: (all_cos.filter(c => getWatchlistStatus(c).active).length / all_cos.length * 100),
    };
  }, [watchlistOverrides]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mob = winW < 768;
  const tablet = winW >= 768 && winW < 1024;
  const px = mob ? 12 : 24; // responsive padding

  const totalExposure = PORTFOLIO.reduce((s, c) => s + c.exposure, 0);
  const negFcfCount = PORTFOLIO.filter((c) => c.fcf < 0).length;
  const watchCount = PORTFOLIO.filter((c) => getWatchlistStatus(c).active).length;
  const negOutlook = PORTFOLIO.filter((c) => c.outlook === "Negative" || c.outlook === "Developing").length;

  const allNews = PORTFOLIO.flatMap((c) => c.news.map((n) => ({ ...n, ticker: c.id, company: c.name }))).sort((a, b) => b.date.localeCompare(a.date));

  const detail = selected ? PORTFOLIO.find((c) => c.id === selected) : null;

  // ─── STYLES ─────────────────────────────────────────────────────────────
  const root = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#0a0e1a", color: "#e2e8f0", minHeight: "100vh", fontSize: mob ? 13 : 13, WebkitFontSmoothing: "antialiased", maxWidth: "100vw", overflowX: "clip", wordWrap: "break-word", overflowWrap: "break-word" };
  const headerBar = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: mob ? "10px 12px" : "12px 24px", borderBottom: "1px solid #1e293b", background: "linear-gradient(180deg, #0f1629 0%, #0a0e1a 100%)", flexWrap: mob ? "wrap" : "nowrap", gap: mob ? 8 : 0 };
  const pill = (active) => ({ padding: mob ? "6px 10px" : "6px 16px", borderRadius: 4, fontSize: mob ? 10 : 11, fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer", border: "none", background: active ? "#1d4ed8" : "transparent", color: active ? "#fff" : "#64748b", transition: "all .15s", whiteSpace: "nowrap" });
  const card = { background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: mob ? 12 : 16, overflow: "hidden", minWidth: 0 };
  const kpiVal = { fontSize: mob ? 18 : 22, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2, fontFamily: "'JetBrains Mono', monospace" };
  const kpiLabel = { fontSize: mob ? 9 : 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.8px", marginTop: 4, fontFamily: "'Inter', sans-serif" };
  const alertBanner = { background: "linear-gradient(90deg, #7f1d1d 0%, #991b1b 50%, #7f1d1d 100%)", border: "1px solid #dc2626", borderRadius: 6, padding: mob ? "8px 12px" : "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: mob ? 11 : 12, color: "#fca5a5" };
  const sectionGrid = mob ? "1fr" : "1fr 1fr";

  // ─── RENDER: DETAIL VIEW ──────────────────────────────────────────────────
  if (detail) {
    return (
      <div style={root}>
        <div style={headerBar}>
          <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 16, flexWrap: "wrap" }}>
            <button onClick={() => setSelected(null)} style={{ ...pill(false), border: "1px solid #334155" }}>{"\u2190"} Portfolio</button>
            <div>
              <span style={{ fontSize: mob ? 16 : 18, fontWeight: 700, color: "#f1f5f9" }}>{detail.id}</span>
              <span style={{ fontSize: mob ? 11 : 13, color: "#94a3b8", marginLeft: 8 }}>{mob ? "" : detail.name}</span>
            </div>
            {getWatchlistStatus(detail).active && <span style={{ background: "#7f1d1d", color: "#fca5a5", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>{"\u26A0"} WATCHLIST</span>}
            {!getWatchlistStatus(detail).active && <span style={{ background: "#052e16", color: "#86efac", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>{"\u2713"} ACTIVE</span>}
          </div>
          <div style={{ display: "flex", gap: mob ? 4 : 6, overflowX: "auto", WebkitOverflowScrolling: "touch", width: mob ? "100%" : "auto" }}>
            {["financials", "ratings", "filings", "news", "research", "earnings"].map((t) => (
              <button key={t} onClick={() => setDetailTab(t)} style={pill(detailTab === t)}>{t === "filings" ? "SEC" : t}</button>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : tablet ? "repeat(4, 1fr)" : "repeat(8, 1fr)", gap: mob ? 8 : 12, padding: `16px ${px}px` }}>
          {[
            { l: "Implied Rating", v: detail.impliedRating, c: ratingColor(detail.impliedRating) },
            { l: "Agency Rating", v: detail.sp !== "NR" ? `${detail.sp} / ${detail.moodys}` : "Not Rated", c: detail.sp !== "NR" ? ratingColor(detail.sp) : "#64748b" },
            { l: "Outlook", v: `${outlookIcon(detail.outlook)} ${detail.outlook}`, c: outlookColor(detail.outlook) },
            { l: "CDS 5Y", v: detail.cds5y != null ? `${detail.cds5y} bps` : "N/A", sub: detail.cds5yChg != null ? `${bps(detail.cds5yChg)} bps` : "", c: detail.cds5yChg != null ? (detail.cds5yChg <= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
            { l: "Bond Spread", v: detail.bondSpread != null ? `${detail.bondSpread} bps` : "N/A", sub: detail.bondSpreadChg != null ? `${bps(detail.bondSpreadChg)} bps` : "", c: detail.bondSpreadChg != null ? (detail.bondSpreadChg <= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
            { l: "Equity", v: detail.eqPrice != null ? `$${detail.eqPrice}` : "Private", sub: detail.eqChg != null ? pct(detail.eqChg) : "", c: detail.eqChg != null ? (detail.eqChg >= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
            { l: detail.fcf > 0 ? "Adj. Cash Flow / Qtr" : "Cash Burn / Qtr", v: detail.fcf > 0 ? `+${fmt(Math.abs(detail.cashBurnQtr) * 1e6)}` : fmt(detail.cashBurnQtr * 1e6), c: detail.fcf > 0 ? "#22c55e" : "#ef4444" },
            { l: "Current Ratio", v: `${fmtNum(detail.currentRatio)}x`, c: detail.currentRatio >= 1.5 ? "#22c55e" : detail.currentRatio >= 1 ? "#eab308" : "#ef4444" },
          ].map((k, i) => (
            <div key={i} style={card}>
              <div style={{ ...kpiVal, fontSize: 16, color: k.c || "#f1f5f9" }}>{k.v}</div>
              {k.sub && <div style={{ fontSize: 11, color: k.c, marginTop: 2 }}>{k.sub}</div>}
              <div style={kpiLabel}>{k.l}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          <ErrorBoundary>
          {detailTab === "financials" && (() => {
            // ─── LTM ADJUSTED CASH BURN COMPUTATION ─────────────────────
            const ab = detail.adjBurn;
            const capexUsed = ab ? (ab.maintCapex !== null ? ab.maintCapex : ab.totalCapex) : 0;
            const ltmAdjBurn = ab ? Math.abs(ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capexUsed - ab.currentLTD - ab.intExpCash) : Math.abs(detail.fcf);
            const isNetCashGenerator = ab ? (ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capexUsed - ab.currentLTD - ab.intExpCash) > 0 : detail.fcf > 0;
            const ltmBurnMonthly = ltmAdjBurn / 12;
            const ltmBurnQtr = ltmAdjBurn / 4;

            // ─── COVERAGE METRICS ───────────────────────────────────────
            const totalLiq = detail.liquidityBreakdown ? detail.liquidityBreakdown.totalLiquidity : detail.cash;
            const ltmCovMonths = isNetCashGenerator ? 999 : (ltmBurnMonthly > 0 ? totalLiq / ltmBurnMonthly : 999);
            const meets18mo = ltmCovMonths >= 18;
            const qBurn = ltmBurnQtr;
            const annBurn = ltmAdjBurn;
            const cashCov = qBurn > 0 ? detail.cash / qBurn : 999;
            const liqCov = annBurn > 0 ? detail.cash / annBurn : 999;
            const netCash = detail.cash - detail.totalDebt;
            const cashToDebt = detail.totalDebt > 0 ? detail.cash / detail.totalDebt : 999;
            const burnToRev = detail.revenue > 0 ? (annBurn / detail.revenue * 100) : 0;
            const fcfBurn = Math.abs(detail.fcf);
            const fcfCov = fcfBurn > 0 ? detail.cash / fcfBurn : 999;
            const runwayQtrs = cashCov >= 999 ? 99 : Math.floor(cashCov);
            const runwayPct = Math.min((cashCov >= 999 ? 12 : cashCov) / 12, 1);
            const runwayColor = isNetCashGenerator ? "#22c55e" : runwayQtrs >= 8 ? "#22c55e" : runwayQtrs >= 5 ? "#eab308" : "#ef4444";
            const burnTrend = detail.financials.map(f => ({ p: f.period, burn: f.cash - (detail.financials[detail.financials.indexOf(f) + 1]?.cash || f.cash) + (f.debt - (detail.financials[detail.financials.indexOf(f) + 1]?.debt || f.debt)) }));

            return (
            <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: mob ? 12 : 16, minWidth: 0 }}>

              {/* ═══ CASH BURN & LIQUIDITY HERO PANEL ═══ */}
              <div style={{ ...card, gridColumn: "1 / -1", background: "linear-gradient(135deg, #111827 0%, #0f172a 50%, #111827 100%)", border: isNetCashGenerator ? "1px solid #22c55e" : "1px solid #dc2626", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isNetCashGenerator ? "linear-gradient(90deg, #22c55e, #3b82f6, #22c55e)" : "linear-gradient(90deg, #ef4444, #f97316, #ef4444)" }} />
                <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: isNetCashGenerator ? "#86efac" : "#fca5a5", marginBottom: 16, textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {isNetCashGenerator ? "\u2713" : "\u26A0"} {isNetCashGenerator ? "Cash Flow & Liquidity" : "Cash Burn & Liquidity"}
                  {!mob && <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", textTransform: "none", letterSpacing: 0 }}>{"\u2014"} LTM adjusted basis {"\u00B7"} {isNetCashGenerator ? "Net cash generator" : "Cash consumer"}</span>}
                </div>

                {/* Runway Gauge */}
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "280px 1fr", gap: mob ? 16 : 24, marginBottom: 20 }}>
                  <div style={{ background: "#0a0e1a", borderRadius: 8, padding: mob ? 14 : 20, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>{isNetCashGenerator ? "Cash Flow Status" : "LTM Burn Coverage"}</div>
                    <div style={{ fontSize: mob ? 36 : 48, fontWeight: 900, color: runwayColor, lineHeight: 1 }}>{isNetCashGenerator ? "\u2713" : fmtNum(ltmCovMonths, 1)}</div>
                    <div style={{ fontSize: 14, color: runwayColor, fontWeight: 600, marginTop: 2 }}>{isNetCashGenerator ? "cash flow positive" : "months"}</div>
                    <div style={{ marginTop: 12, background: "#1e293b", borderRadius: 6, height: 10, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 6, width: `${isNetCashGenerator ? 100 : Math.min(ltmCovMonths / 36, 1) * 100}%`, background: `linear-gradient(90deg, ${runwayColor}, ${meets18mo ? "#86efac" : ltmCovMonths >= 12 ? "#fde047" : "#fca5a5"})`, transition: "width 0.5s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#475569" }}>
                      <span>0</span><span>12 mo</span><span style={{ color: "#22c55e", fontWeight: 700 }}>18 mo</span><span>36 mo</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 8 }}>{isNetCashGenerator ? "\u2713 Net cash generator \u2014 coverage test automatically satisfied" : meets18mo ? "\u2713 LTM coverage exceeds 18-month threshold" : ltmCovMonths >= 12 ? "\u26A0 Below 18-month threshold \u2014 Special Mention territory" : "\u26A0 Below 12-month threshold \u2014 Substandard / Doubtful territory"}</div>
                  </div>

                  {/* Burn Coverage KPIs */}
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(3, 1fr)", gridTemplateRows: mob ? "auto" : "1fr 1fr", gap: 10, minWidth: 0 }}>
                    {[
                      { l: isNetCashGenerator ? "LTM Adj. Cash Flow" : "LTM Adjusted Burn", v: isNetCashGenerator ? `+${fmt(annBurn * 1e6)}` : `-${fmt(annBurn * 1e6)}`, sub: isNetCashGenerator ? `+${fmt(qBurn * 1e6)}/quarter generated` : `${fmt(qBurn * 1e6)}/quarter consumed`, c: isNetCashGenerator ? "#22c55e" : "#ef4444", big: true },
                      { l: "18-Month Coverage", v: isNetCashGenerator ? "Pass" : meets18mo ? "Pass" : "Fail", sub: isNetCashGenerator ? "Cash flow positive — no burn to cover" : `${fmtNum(ltmCovMonths, 1)} months of liquidity`, c: meets18mo || isNetCashGenerator ? "#22c55e" : "#ef4444", big: true },
                      { l: isNetCashGenerator ? "Total Liquidity" : "Total Liquidity / LTM Burn", v: isNetCashGenerator ? fmt(totalLiq * 1e6) : `${fmtNum(totalLiq / annBurn, 1)}x`, sub: isNetCashGenerator ? "Available as strategic buffer" : `Total liquidity: ${fmt(totalLiq * 1e6)}`, c: isNetCashGenerator ? "#22c55e" : totalLiq / annBurn >= 1.5 ? "#22c55e" : totalLiq / annBurn >= 1 ? "#eab308" : "#ef4444", big: true },
                      { l: "Cash / Total Debt", v: cashToDebt >= 999 ? "N/A" : `${fmtNum(cashToDebt)}x`, sub: netCash > 0 ? `Net cash: ${fmt(netCash * 1e6)}` : `Net debt: ${fmt(Math.abs(netCash) * 1e6)}`, c: cashToDebt >= 1.5 ? "#22c55e" : cashToDebt >= 1 ? "#eab308" : "#ef4444" },
                      { l: isNetCashGenerator ? "Cash Flow / Revenue" : "LTM Burn / Revenue", v: isNetCashGenerator ? `${fmtNum(burnToRev)}%` : `${fmtNum(burnToRev)}%`, sub: isNetCashGenerator ? "Cash generation as % of revenue" : "Annual burn as % of revenue", c: isNetCashGenerator ? "#22c55e" : burnToRev > 200 ? "#ef4444" : burnToRev > 100 ? "#f97316" : "#eab308" },
                      { l: "FCF", v: fmt(detail.fcf * 1e6), sub: detail.fcf > 0 ? "Free cash flow positive" : "Free cash flow negative", c: detail.fcf > 0 ? "#22c55e" : "#ef4444" },
                    ].map((k, i) => (
                      <div key={i} style={{ background: "#0a0e1a", borderRadius: 6, padding: "10px 12px" }}>
                        <div style={{ fontSize: k.big ? 18 : 15, fontWeight: 800, color: k.c }}>{k.v}</div>
                        <div style={{ fontSize: 9, color: k.c, opacity: 0.7, marginTop: 1 }}>{k.sub}</div>
                        <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 4 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cash Bridge Waterfall */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Cash Bridge {"\u2014"} Sources & Uses (Annual)</div>
                <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 80, marginBottom: 4 }}>
                  {(() => {
                    const items = [
                      { l: "Opening\nCash", v: detail.financials[1]?.cash || detail.cash, type: "neutral" },
                      { l: "Revenue", v: detail.revenue, type: "inflow" },
                      { l: "OpEx &\nCOGS", v: -(detail.revenue - detail.ebitda), type: "outflow" },
                      { l: "CapEx &\nOther", v: detail.ebitda - detail.fcf, type: "outflow" },
                      { l: "Debt\nProceeds", v: Math.max(0, detail.totalDebt - (detail.financials[1]?.debt || detail.totalDebt)), type: "inflow" },
                      { l: "Ending\nCash", v: detail.cash, type: "neutral" },
                    ];
                    const maxV = Math.max(...items.map(i => Math.abs(i.v)));
                    const barW = `${100 / items.length - 1}%`;
                    return items.map((item, idx) => {
                      const h = Math.max(8, (Math.abs(item.v) / maxV) * 70);
                      const color = item.type === "inflow" ? "#22c55e" : item.type === "outflow" ? "#ef4444" : "#3b82f6";
                      return (
                        <div key={idx} style={{ flex: 1, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color, marginBottom: 2 }}>
                            {Math.abs(item.v) >= 1000 ? `${(item.v / 1000).toFixed(1)}B` : `${item.v.toFixed(0)}M`}
                          </div>
                          <div style={{ height: h, background: color, borderRadius: "3px 3px 0 0", opacity: 0.8, margin: "0 4px" }} />
                        </div>
                      );
                    });
                  })()}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {["Opening\nCash", "Revenue", "OpEx &\nCOGS", "CapEx &\nOther", "Debt\nProceeds", "Ending\nCash"].map((l, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "#475569", lineHeight: 1.3, whiteSpace: "pre-line" }}>{l}</div>
                  ))}
                </div>
              </div>

              {/* ═══ TRADITIONAL vs. ADJUSTED CASH BURN ═══ */}
              {detail.adjBurn && (() => {
                const ab = detail.adjBurn;
                const capexUsed = ab.maintCapex !== null ? ab.maintCapex : ab.totalCapex;
                const capexLabel = ab.maintCapex !== null ? "Maintenance CapEx" : "Total CapEx (maint. not disclosed)";
                const adjBurnTotal = ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capexUsed - ab.currentLTD - ab.intExpCash;
                const tradBurn = detail.fcf; // traditional = FCF (operating cash flow - capex)
                const tradBurnAbs = Math.abs(tradBurn);
                const adjBurnAbs = Math.abs(adjBurnTotal);
                const diff = adjBurnAbs - tradBurnAbs;
                const maxBurn = Math.max(tradBurnAbs, adjBurnAbs);

                // Waterfall items for adjusted burn
                const waterfall = [
                  { label: "Adjusted\nEBITDA", amount: ab.adjEBITDA, color: ab.adjEBITDA < 0 ? "#ef4444" : "#22c55e", src: ab.adjEBITDA_src },
                  { label: "Income\nTaxes", amount: -ab.incomeTaxes, color: "#f97316", src: ab.incomeTaxes_src },
                  { label: "Priority\nDividends", amount: -ab.prefDividends, color: "#f97316", src: ab.prefDividends_src },
                  { label: capexLabel.includes("Maint") ? "Maint.\nCapEx" : "Total\nCapEx*", amount: -capexUsed, color: "#ef4444", src: ab.totalCapex_src },
                  { label: "Current\nLTD", amount: -ab.currentLTD, color: "#f97316", src: ab.currentLTD_src },
                  { label: "Cash Int.\nExpense", amount: -ab.intExpCash, color: "#ef4444", src: ab.intExpCash_src },
                  { label: adjBurnTotal >= 0 ? "Adj. Cash\nFlow" : "Adjusted\nCash Burn", amount: adjBurnTotal, color: adjBurnTotal >= 0 ? "#22c55e" : "#dc2626", isTotal: true },
                ];
                const maxWf = Math.max(...waterfall.map(w => Math.abs(w.amount)));

                return (
                <div style={{ ...card, gridColumn: "1 / -1", border: "1px solid #a855f7" }}>
                  <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#c084fc", marginBottom: 4, textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px" }}>
                    {"\u25C6"} Traditional vs. Adjusted Cash Flow
                  </div>
                  <div style={{ fontSize: mob ? 9 : 10, color: "#64748b", marginBottom: 16 }}>{mob ? "Adj. CF = Adj. EBITDA \u2212 Taxes \u2212 Divs \u2212 CapEx \u2212 LTD \u2212 Interest" : "Adjusted Cash Flow = Adjusted EBITDA \u2212 Recurring Income Taxes \u2212 Priority Dividends \u2212 Maintenance CapEx \u2212 Current Portion of LT Debt \u2212 Cash Interest Expense"}</div>

                  <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: mob ? 16 : 24, minWidth: 0 }}>
                    {/* Side-by-side comparison */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Head-to-Head Comparison</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {/* Traditional */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11 }}>
                            <span style={{ color: "#94a3b8", fontWeight: 600 }}>Traditional Cash Flow (FCF)</span>
                            <span style={{ color: tradBurn >= 0 ? "#22c55e" : "#ef4444", fontWeight: 800, fontSize: 14 }}>{tradBurn >= 0 ? "+" : ""}{fmt(tradBurn * 1e6)}</span>
                          </div>
                          <div style={{ height: 28, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(tradBurnAbs / maxBurn) * 100}%`, background: tradBurn >= 0 ? "linear-gradient(90deg, #22c55e, #15803d)" : "linear-gradient(90deg, #ef4444, #dc2626)", borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 10, fontWeight: 700, color: "#fff" }}>
                              {tradBurnAbs >= maxBurn * 0.15 ? `${tradBurn >= 0 ? "+" : "-"}$${(tradBurnAbs / 1000).toFixed(1)}B` : ""}
                            </div>
                          </div>
                          <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{tradBurn >= 0 ? "Positive operating cash flow after CapEx" : "Operating Cash Flow minus Total CapEx"}</div>
                        </div>
                        {/* Adjusted */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11 }}>
                            <span style={{ color: "#c084fc", fontWeight: 600 }}>Adjusted Cash Flow</span>
                            <span style={{ color: adjBurnTotal >= 0 ? "#22c55e" : "#a855f7", fontWeight: 800, fontSize: 14 }}>{adjBurnTotal >= 0 ? "+" : ""}{fmt(adjBurnTotal * 1e6)}</span>
                          </div>
                          <div style={{ height: 28, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(adjBurnAbs / maxBurn) * 100}%`, background: adjBurnTotal >= 0 ? "linear-gradient(90deg, #22c55e, #15803d)" : "linear-gradient(90deg, #a855f7, #7c3aed)", borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 10, fontWeight: 700, color: "#fff" }}>
                              {adjBurnAbs >= maxBurn * 0.15 ? `${adjBurnTotal >= 0 ? "+" : "-"}$${(adjBurnAbs / 1000).toFixed(1)}B` : ""}
                            </div>
                          </div>
                          <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>Adj. EBITDA less taxes, dividends, {ab.maintCapex !== null ? "maintenance" : "total"} capex, current LTD, and cash interest</div>
                        </div>
                      </div>
                      {/* Differential */}
                      <div style={{ marginTop: 16, padding: 10, background: "#0a0e1a", borderRadius: 6 }}>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Differential: Traditional vs. Adjusted</div>
                        <div style={{ fontSize: mob ? 14 : 18, fontWeight: 800, color: adjBurnTotal > tradBurn ? "#22c55e" : "#ef4444" }}>
                          {"Adjusted is "}
                          <span>{fmt(Math.abs(diff) * 1e6)}</span>
                          {adjBurnTotal > tradBurn ? " HIGHER" : " LOWER"}
                        </div>
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 4 }}>
                          {adjBurnTotal >= 0 && tradBurn >= 0 ? "Both measures show positive cash generation" : adjBurnTotal >= 0 ? "Adjusted measure shows cash generation; traditional FCF is negative" : tradBurnAbs > 0 ? `Adjusted outflow differs from traditional FCF by ${((Math.abs(diff) / tradBurnAbs) * 100).toFixed(0)}%` : ""}
                        </div>
                      </div>
                      {/* Runway comparison */}
                      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 8 }}>
                        <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{tradBurn >= 0 ? "Traditional: Cash Flow Positive" : "Traditional Runway"}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: tradBurn >= 0 ? "#22c55e" : (detail.cash / (tradBurnAbs / 4)) >= 6 ? "#eab308" : "#ef4444" }}>{tradBurn >= 0 ? "\u2713 Positive" : `${(detail.cash / (tradBurnAbs / 4)).toFixed(1)} qtrs`}</div>
                          <div style={{ fontSize: 9, color: "#475569" }}>{tradBurn >= 0 ? `+${fmt(tradBurn * 1e6)} FCF generated` : "Cash \u00F7 Quarterly FCF Burn"}</div>
                        </div>
                        <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{adjBurnTotal >= 0 ? "Adjusted: Cash Flow Positive" : "Adjusted Runway"}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: adjBurnTotal >= 0 ? "#22c55e" : (detail.cash / (adjBurnAbs / 4)) >= 6 ? "#eab308" : "#ef4444" }}>{adjBurnTotal >= 0 ? "\u2713 Positive" : `${(detail.cash / (adjBurnAbs / 4)).toFixed(1)} qtrs`}</div>
                          <div style={{ fontSize: 9, color: "#475569" }}>{adjBurnTotal >= 0 ? `+${fmt(adjBurnTotal * 1e6)} adj. cash flow` : "Cash \u00F7 Quarterly Adj. Burn"}</div>
                        </div>
                      </div>
                    </div>

                    {/* Waterfall breakdown */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Adjusted Cash Flow Waterfall ($M)</div>
                      {waterfall.map((w, wi) => {
                        const barPct = maxWf > 0 ? (Math.abs(w.amount) / maxWf * 100) : 0;
                        return (
                          <div key={wi} style={{ marginBottom: wi < waterfall.length - 1 ? 6 : 0 }}>
                            {w.isTotal && <div style={{ borderTop: "2px dashed #475569", margin: "8px 0" }} />}
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: mob ? 50 : 60, fontSize: mob ? 8 : 9, color: w.isTotal ? "#f1f5f9" : "#94a3b8", fontWeight: w.isTotal ? 800 : 400, textAlign: "right", whiteSpace: "pre-line", lineHeight: 1.2, flexShrink: 0 }}>{w.label}</div>
                              <div style={{ flex: 1, height: 20, background: "#1e293b", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                                <div style={{ height: "100%", width: `${Math.max(barPct, 2)}%`, background: w.isTotal ? (w.amount >= 0 ? "linear-gradient(90deg, #22c55e, #15803d)" : "linear-gradient(90deg, #dc2626, #991b1b)") : w.color, borderRadius: 3, opacity: w.isTotal ? 1 : 0.75 }} />
                              </div>
                              <div style={{ width: mob ? 60 : 70, fontSize: mob ? 10 : 11, fontWeight: w.isTotal ? 800 : 600, color: w.isTotal ? (w.amount >= 0 ? "#22c55e" : "#dc2626") : w.amount === 0 ? "#334155" : "#e2e8f0", textAlign: "right", flexShrink: 0 }}>
                                {w.amount === 0 ? "\u2014" : w.isTotal && w.amount > 0 ? `+${w.amount.toLocaleString()}` : `(${Math.abs(w.amount).toLocaleString()})`}
                              </div>
                            </div>
                            {w.src && <div style={{ marginLeft: 68, fontSize: 8, color: "#3f3f46", marginTop: 1 }}>{w.src}</div>}
                          </div>
                        );
                      })}
                      {ab.maintCapex === null && (
                        <div style={{ marginTop: 10, padding: 8, background: "#431407", borderRadius: 4, border: "1px solid #78350f", fontSize: 9, color: "#fbbf24", lineHeight: 1.5 }}>
                          {"\u26A0"} <b>Note:</b> Maintenance CapEx is not separately disclosed. Full CapEx (${ab.totalCapex.toLocaleString()}M) used as proxy, which includes growth CapEx. This overstates the adjusted burn {"\u2014"} true maintenance-only CapEx would yield a lower adjusted burn figure.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* ═══ OCC ABL REGULATORY RATING ASSESSMENT ═══ */}
              {detail.adjBurn && detail.liquidityBreakdown && (() => {
                const ab = detail.adjBurn;
                const capexUsedOcc = ab.maintCapex !== null ? ab.maintCapex : ab.totalCapex;
                const adjBurnAnnualOcc = ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capexUsedOcc - ab.currentLTD - ab.intExpCash;
                const isCashGen = adjBurnAnnualOcc > 0;
                const adjBurnAbsOcc = Math.abs(adjBurnAnnualOcc);
                const adjBurnMonthlyOcc = adjBurnAbsOcc / 12;
                const adjBurnQtrOcc = adjBurnAbsOcc / 4;

                // Liquidity pools
                const cashInv = detail.liquidityBreakdown.components.filter(c => c.type !== "facility").reduce((s, c) => s + c.amount, 0);
                const facilityAvail = detail.liquidityBreakdown.facilities.reduce((s, f) => s + f.available, 0);
                const totalAvailLiq = cashInv + facilityAvail;

                // ═══ PRIMARY TEST: 18-month LTM liquidity coverage ═══
                const histBurnMonths = isCashGen ? 999 : (adjBurnMonthlyOcc > 0 ? totalAvailLiq / adjBurnMonthlyOcc : 999);
                const fwdBurnImprovement = isCashGen ? 1.0 : 0.90;
                const fwdBurnAnnual = adjBurnAbsOcc * fwdBurnImprovement;
                const fwdBurnMonthly = fwdBurnAnnual / 12;
                const fwdBurnMonths = isCashGen ? 999 : (fwdBurnMonthly > 0 ? totalAvailLiq / fwdBurnMonthly : 999);
                const meetsHistorical18 = histBurnMonths >= 18;
                const meetsForward18 = fwdBurnMonths >= 18;
                const meetsBoth = meetsHistorical18 && meetsForward18;

                const primaryRating = isCashGen ? "Pass" : meetsBoth ? "Pass" : (meetsHistorical18 || meetsForward18) ? "Special Mention" : histBurnMonths >= 12 ? "Special Mention" : "Substandard";

                const factors = [
                  {
                    factor: "18-Month LTM Liquidity Coverage Test (PRIMARY)",
                    ref: "OCC ABL Handbook: Evaluating Borrower Liquidity \u2014 Cash Burn Coverage",
                    desc: "Total available liquidity must cover \u226518 months of LTM adjusted cash burn. For net cash generators, test is automatically satisfied.",
                    finding: isCashGen
                      ? `Net cash generator: LTM adjusted cash flow is positive at $${(adjBurnAnnualOcc).toLocaleString()}M. The 18-month coverage test is automatically satisfied \u2014 the borrower generates rather than consumes cash. Total available liquidity of $${(totalAvailLiq/1000).toFixed(1)}B provides additional cushion.`
                      : (() => {
                        const histLine = `Historical (LTM): $${(totalAvailLiq >= 1000 ? (totalAvailLiq/1000).toFixed(1)+"B" : totalAvailLiq+"M")} total liquidity \u00F7 $${adjBurnMonthlyOcc.toFixed(0)}M/mo adj. burn = ${histBurnMonths.toFixed(1)} months ${meetsHistorical18 ? "\u2705 \u226518 mo." : "\u274C <18 mo."}`;
                        const fwdLine = `Forward (est.): Assuming ${((1 - fwdBurnImprovement) * 100).toFixed(0)}% burn improvement = ${fwdBurnMonths.toFixed(1)} months ${meetsForward18 ? "\u2705 \u226518 mo." : "\u274C <18 mo."}`;
                        return `${histLine}\n${fwdLine}\n\n${meetsBoth ? "Both tests satisfied \u2014 supports Pass rating." : meetsHistorical18 ? "Historical test passed; forward marginal \u2014 Special Mention." : `Neither test fully satisfied at ${histBurnMonths.toFixed(1)} months.`}`;
                      })(),
                    rating: primaryRating,
                    isPrimary: true,
                  },
                  {
                    factor: "Excess Availability & Facility Headroom",
                    ref: "OCC ABL Handbook, pp. 10-14",
                    desc: "Excess availability under revolving facilities relative to total exposure.",
                    finding: `Facility availability: ${fmt(facilityAvail * 1e6)} across ${detail.liquidityBreakdown.facilities.length} facility(ies). ${facilityAvail > 0 ? `Undrawn capacity provides ${isCashGen ? "strategic optionality" : `${(facilityAvail / (adjBurnQtrOcc || 1)).toFixed(1)} quarters of incremental coverage`}.` : "No undrawn facility availability."} Cash & investments: ${fmt(cashInv * 1e6)}.`,
                    rating: facilityAvail > (adjBurnQtrOcc * 2) || isCashGen ? "Pass" : facilityAvail > adjBurnQtrOcc ? "Pass-Watch" : "Special Mention",
                  },
                  {
                    factor: isNetCashGenerator ? "Cash Flow Trend & Operating Trajectory" : "Cash Burn Trend & Operating Trajectory",
                    ref: "OCC ABL Handbook, pp. 7-10",
                    desc: "Under ABL framework, operating cash flow is secondary. Focus: is burn improving, stable, or deteriorating?",
                    finding: (() => {
                      const priorEbitda = detail.financials[1]?.ebitda;
                      const currEbitda = detail.financials[0]?.ebitda;
                      const improving = currEbitda > priorEbitda;
                      return isCashGen
                        ? `EBITDA-positive at ${fmt(ab.adjEBITDA * 1e6)}. ${improving ? "YoY improvement in EBITDA trajectory." : "EBITDA declined vs. prior year \u2014 monitor for sustained trend."} Borrower generates operating cash flow as secondary repayment source.`
                        : `LTM adjusted burn of ${fmt(adjBurnAbsOcc * 1e6)}. ${improving ? "Trajectory improving \u2014 EBITDA loss narrowing YoY." : "Trajectory worsening or flat \u2014 requires enhanced monitoring."} Per ABL criteria, improving trajectory supports the primary liquidity-based rating.`;
                    })(),
                    rating: isCashGen ? "Pass" : (detail.financials[0]?.ebitda > (detail.financials[1]?.ebitda || -Infinity)) ? "Pass-Watch" : "Special Mention",
                  },
                  {
                    factor: "Fixed Charge Coverage Ratio",
                    ref: "OCC ABL Handbook, pp. 12-13",
                    desc: "Negative FCCR does not auto-trigger adverse classification IF 18-mo liquidity test is met.",
                    finding: isCashGen
                      ? `FCCR is positive. EBITDA of ${fmt(ab.adjEBITDA * 1e6)} covers fixed charges of ${fmt((ab.intExpCash + ab.currentLTD) * 1e6)}. Coverage ratio: ${((ab.adjEBITDA) / (ab.intExpCash + ab.currentLTD + ab.incomeTaxes || 1)).toFixed(1)}x.`
                      : `FCCR is negative (Adj. EBITDA of ${fmt(ab.adjEBITDA * 1e6)} cannot cover fixed charges). Per OCC ABL methodology, this is a monitoring item \u2014 not an independent adverse classification trigger when liquidity coverage is adequate.`,
                    rating: isCashGen ? (ab.adjEBITDA / (ab.intExpCash + ab.currentLTD + ab.incomeTaxes || 1) >= 1.25 ? "Pass" : "Pass-Watch") : meetsBoth ? "Pass-Watch" : "Special Mention",
                  },
                  {
                    factor: "Management, Reporting & Controls",
                    ref: "OCC ABL Handbook, pp. 22-30",
                    desc: "Quality of financial reporting, management credibility, covenant compliance.",
                    finding: detail.sp !== "NR" || detail.mktCap
                      ? `${detail.sp !== "NR" ? "Agency-rated" : "Publicly traded"} company with SEC filing requirements and ${detail.mktCap ? "external audit" : "limited public disclosure"}. Management guidance ${detail.financials[0]?.ebitda >= (detail.financials[1]?.ebitda || -Infinity) ? "has been generally credible based on YoY trajectory" : "requires monitoring \u2014 prior period targets not fully met"}.`
                      : `Private company with limited public financial disclosure. Rely on bank group reporting. Enhanced monitoring required.`,
                    rating: detail.sp !== "NR" || detail.mktCap ? "Pass" : "Special Mention",
                  },
                  {
                    factor: "Sponsor / Stakeholder Support",
                    ref: "OCC ABL Handbook, pp. 25-26",
                    desc: "Strength and willingness of sponsor to inject capital.",
                    finding: (() => {
                      if (detail.id === "LCID") return "Strong. PIF (Saudi sovereign wealth fund) majority shareholder with $2.0B undrawn DDTL, repeated equity injections.";
                      if (detail.id === "RIVN") return "Moderate. VW $5B JV, DOE $6.6B conditional, Uber $1.25B. Multiple strategic partners but no committed liquidity backstop.";
                      if (detail.id === "JSWUSA") return "Strong. Subsidiary of JSW Group ($24B Indian conglomerate). Implicit parent support.";
                      if (detail.totalEquity > 0 && detail.fcf > 0) return "Self-supporting: Positive equity and FCF generation reduce reliance on external capital.";
                      return "Limited external sponsor support identified. Reliant on own cash reserves and capital market access.";
                    })(),
                    rating: (detail.id === "LCID" || detail.id === "JSWUSA") ? "Pass" : (detail.fcf > 0 && detail.totalEquity > 0) ? "Pass" : "Special Mention",
                  },
                ];

                const ratingColors = { "Pass": "#22c55e", "Pass-Watch": "#86efac", "Special Mention": "#eab308", "Substandard": "#f97316", "Doubtful": "#ef4444", "Loss": "#dc2626", "N/A": "#64748b" };
                const ratingBg = { "Pass": "#052e16", "Pass-Watch": "#052e16", "Special Mention": "#422006", "Substandard": "#431407", "Doubtful": "#450a0a", "Loss": "#450a0a", "N/A": "#1e293b" };
                const compositeRating = primaryRating; // 18-month test drives the composite

                return (
                <div style={{ ...card, gridColumn: "1 / -1", border: `1px solid ${ratingColors[compositeRating]}`, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${ratingColors[compositeRating]}, ${ratingColors[compositeRating]}88, ${ratingColors[compositeRating]})` }} />
                  <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "stretch" : "flex-start", gap: mob ? 12 : 0, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: ratingColors[compositeRating], textTransform: "uppercase", letterSpacing: "1px" }}>
                        {"\u25C6"} OCC ABL Regulatory Rating
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Per OCC Comptroller's Handbook: Asset-Based Lending & Rating Credit Risk</div>
                    </div>
                    <div style={{ textAlign: "center", padding: mob ? "8px 12px" : "8px 20px", background: ratingBg[compositeRating], border: `2px solid ${ratingColors[compositeRating]}`, borderRadius: 6, flexShrink: 0 }}>
                      <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 2 }}>Composite Rating</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: ratingColors[compositeRating] }}>{compositeRating}</div>
                      <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>Driven by 18-mo. liquidity test</div>
                    </div>
                  </div>

                  {/* 18-Month Test Visual */}
                  <div style={{ padding: 16, background: "#0f172a", borderRadius: 8, border: "1px solid #334155", marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#f1f5f9", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Primary Gating Test: 18-Month Liquidity Coverage</div>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 12, minWidth: 0 }}>
                      {/* Historical */}
                      <div style={{ padding: 12, background: "#0a0e1a", borderRadius: 6, border: `1px solid ${meetsHistorical18 ? "#22c55e44" : "#ef444444"}` }}>
                        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>Historical Burn Coverage</div>
                        <div style={{ fontSize: mob ? 22 : 28, fontWeight: 900, color: meetsHistorical18 ? "#22c55e" : "#ef4444" }}>{histBurnMonths.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 600 }}>months</span></div>
                        <div style={{ marginTop: 6, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                          <div style={{ position: "absolute", left: `${(18 / Math.max(histBurnMonths, 24)) * 100}%`, top: -2, bottom: -2, width: 2, background: "#f1f5f9", zIndex: 2 }} />
                          <div style={{ height: "100%", width: `${Math.min(histBurnMonths / Math.max(histBurnMonths, 24), 1) * 100}%`, background: meetsHistorical18 ? "linear-gradient(90deg, #22c55e, #16a34a)" : "linear-gradient(90deg, #ef4444, #dc2626)", borderRadius: 4 }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#475569", marginTop: 2 }}>
                          <span>0</span>
                          <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{"\u2190"} 18 mo. threshold</span>
                          <span>{Math.max(Math.ceil(histBurnMonths), 24)} mo.</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>
                          ${(totalAvailLiq/1000).toFixed(1)}B liquidity {"\u00F7"} ${adjBurnMonthlyOcc.toFixed(0)}M/mo. burn = <b style={{ color: meetsHistorical18 ? "#22c55e" : "#ef4444" }}>{meetsHistorical18 ? "\u2705 PASS" : "\u274C FAIL"}</b>
                        </div>
                      </div>
                      {/* Forward */}
                      <div style={{ padding: 12, background: "#0a0e1a", borderRadius: 6, border: `1px solid ${meetsForward18 ? "#22c55e44" : "#ef444444"}` }}>
                        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>Forward Burn Coverage (Projected)</div>
                        <div style={{ fontSize: mob ? 22 : 28, fontWeight: 900, color: meetsForward18 ? "#22c55e" : "#ef4444" }}>{fwdBurnMonths.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 600 }}>months</span></div>
                        <div style={{ marginTop: 6, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                          <div style={{ position: "absolute", left: `${(18 / Math.max(fwdBurnMonths, 24)) * 100}%`, top: -2, bottom: -2, width: 2, background: "#f1f5f9", zIndex: 2 }} />
                          <div style={{ height: "100%", width: `${Math.min(fwdBurnMonths / Math.max(fwdBurnMonths, 24), 1) * 100}%`, background: meetsForward18 ? "linear-gradient(90deg, #22c55e, #16a34a)" : "linear-gradient(90deg, #ef4444, #dc2626)", borderRadius: 4 }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#475569", marginTop: 2 }}>
                          <span>0</span>
                          <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{"\u2190"} 18 mo. threshold</span>
                          <span>{Math.max(Math.ceil(fwdBurnMonths), 24)} mo.</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>
                          ${(totalAvailLiq/1000).toFixed(1)}B liquidity {"\u00F7"} ${fwdBurnMonthly.toFixed(0)}M/mo. proj. burn ({((1 - fwdBurnImprovement) * 100).toFixed(0)}% improvement) = <b style={{ color: meetsForward18 ? "#22c55e" : "#ef4444" }}>{meetsForward18 ? "\u2705 PASS" : "\u274C FAIL"}</b>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: 8, background: meetsBoth ? "#052e16" : "#422006", borderRadius: 4, border: `1px solid ${meetsBoth ? "#22c55e44" : "#eab30844"}`, fontSize: 10, color: meetsBoth ? "#86efac" : "#fbbf24", textAlign: "center", fontWeight: 700 }}>
                      {meetsBoth ? `\u2705 Both historical and forward 18-month tests satisfied \u2014 supports Pass rating under OCC ABL framework` : meetsHistorical18 ? `\u26A0 Historical test passes (${histBurnMonths.toFixed(1)} mo.) but forward test is marginal (${fwdBurnMonths.toFixed(1)} mo.) \u2014 enhanced monitoring warranted` : `\u274C 18-month coverage threshold not met on historical basis \u2014 adverse classification indicated unless mitigated by sponsor support`}
                    </div>
                  </div>

                  {/* Classification Scale */}
                  <div style={{ display: "flex", gap: 2, marginBottom: 16, height: 28, borderRadius: 4, overflow: "hidden" }}>
                    {[
                      { label: "Pass", color: "#22c55e", w: 20 },
                      { label: mob ? "Spec. Men." : "Special Mention", color: "#eab308", w: 20 },
                      { label: mob ? "Subst." : "Substandard", color: "#f97316", w: 20 },
                      { label: "Doubtful", color: "#ef4444", w: 20 },
                      { label: "Loss", color: "#dc2626", w: 20 },
                    ].map((r, i) => (
                      <div key={i} style={{ width: `${r.w}%`, background: r.label === compositeRating || (compositeRating === "Pass-Watch" && r.label === "Pass") ? r.color : `${r.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: r.label === compositeRating || (compositeRating === "Pass-Watch" && r.label === "Pass") ? 800 : 500, color: r.label === compositeRating || (compositeRating === "Pass-Watch" && r.label === "Pass") ? "#fff" : "#64748b", border: r.label === compositeRating || (compositeRating === "Pass-Watch" && r.label === "Pass") ? `2px solid ${r.color}` : "1px solid #1e293b", borderRadius: 2 }}>
                        {r.label}
                      </div>
                    ))}
                  </div>

                  {/* Supporting Factor Assessments */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Supporting Factor Assessments</div>
                  {factors.map((f, fi) => (
                    <div key={fi} style={{ marginBottom: fi < factors.length - 1 ? 8 : 0, padding: 12, background: f.isPrimary ? "#0f172a" : "#0a0e1a", borderRadius: 6, borderLeft: `3px solid ${ratingColors[f.rating] || "#64748b"}`, border: f.isPrimary ? `1px solid ${ratingColors[f.rating]}44` : undefined }}>
                      <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: mob ? 4 : 8, marginBottom: 4 }}>
                        <div style={{ fontSize: mob ? 11 : 12, fontWeight: 700, color: f.isPrimary ? ratingColors[f.rating] : "#f1f5f9", minWidth: 0 }}>{f.factor}</div>
                        <div style={{ padding: "2px 10px", borderRadius: 3, fontSize: 10, fontWeight: 800, color: ratingColors[f.rating] || "#64748b", background: ratingBg[f.rating] || "#1e293b", border: `1px solid ${(ratingColors[f.rating] || "#64748b")}44` }}>{f.rating}</div>
                      </div>
                      <div style={{ fontSize: 9, color: "#3b82f6", marginBottom: 4, fontStyle: "italic" }}>{f.ref}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{f.desc}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, whiteSpace: "pre-line" }}>{f.finding}</div>
                    </div>
                  ))}

                  {/* Methodology footer */}
                  <div style={{ marginTop: 16, padding: mob ? 8 : 10, background: "#172554", borderRadius: 4, border: "1px solid #1e3a5f", fontSize: mob ? 8 : 9, color: "#93c5fd", lineHeight: 1.6 }}>
                    <b>Methodology:</b> Per the OCC ABL Handbook, the primary repayment source for revolving ABL facilities is the conversion of collateral to cash; operating cash flow is a <i>secondary</i> repayment source. For pre-profitability borrowers, the 18-month liquidity coverage test is the primary gating criterion for a Pass rating: if total available liquidity (cash + investments + excess facility availability) covers {"\u2265"}18 months of both historical and projected forward adjusted cash burn, the credit can be rated Pass despite negative EBITDA and fixed charge coverage. Negative FCCR is a monitoring item \u2014 not an automatic adverse classification trigger \u2014 when liquidity coverage is adequate. Supporting factors (collateral quality, burn trajectory, management, sponsor support) can upgrade or downgrade from the primary test result. Composite rating of <b style={{ color: ratingColors[compositeRating] }}>{compositeRating}</b> is driven by the 18-month test. Review quarterly or upon material change in burn rate, facility availability, or sponsor posture.
                  </div>
                </div>
                );
              })()}

              {/* ═══ LIQUIDITY COMPOSITION BREAKDOWN ═══ */}
              {detail.liquidityBreakdown && <div style={{ ...card, gridColumn: "1 / -1", border: "1px solid #1d4ed8" }}>
                <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#93c5fd", marginBottom: 16, textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {"\u25C6"} Liquidity Position Breakdown
                  <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", textTransform: "none", letterSpacing: 0 }}>{"\u2014"} Total: {fmt(detail.liquidityBreakdown.totalLiquidity * 1e6)} as of Q4 FY2025</span>
                </div>

                {/* Stacked composition bar */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
                    {detail.liquidityBreakdown.components.map((c, i) => {
                      const pct = (c.amount / detail.liquidityBreakdown.totalLiquidity * 100);
                      const colors = { cash: "#22c55e", st_invest: "#3b82f6", lt_invest: "#8b5cf6", facility: "#f97316" };
                      return pct > 0 ? (
                        <div key={i} style={{ width: `${pct}%`, background: colors[c.type], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", borderRight: i < detail.liquidityBreakdown.components.length - 1 ? "1px solid #0a0e1a" : "none", minWidth: pct > 5 ? "auto" : 0, overflow: "hidden" }}>
                          {pct > 10 ? `${pct.toFixed(0)}%` : ""}
                        </div>
                      ) : null;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: mob ? 8 : 16, marginTop: 8, flexWrap: "wrap" }}>
                    {[
                      { label: "Cash & Equiv.", color: "#22c55e", type: "cash" },
                      { label: "Short-Term Inv.", color: "#3b82f6", type: "st_invest" },
                      { label: "Long-Term Inv.", color: "#8b5cf6", type: "lt_invest" },
                      { label: "Undrawn Facilities", color: "#f97316", type: "facility" },
                    ].map((leg, i) => {
                      const comp = detail.liquidityBreakdown.components.find(c => c.type === leg.type);
                      return comp ? (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, background: leg.color, flexShrink: 0 }} />
                          <span style={{ color: "#94a3b8" }}>{leg.label}:</span>
                          <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{fmt(comp.amount * 1e6)}</span>
                          <span style={{ color: "#475569" }}>({(comp.amount / detail.liquidityBreakdown.totalLiquidity * 100).toFixed(1)}%)</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>

                {/* Detailed breakdown: Cash & Investments */}
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1fr", gap: 16, minWidth: 0 }}>
                  {detail.liquidityBreakdown.components.filter(c => c.type !== "facility").map((comp, ci) => {
                    const colors = { cash: "#22c55e", st_invest: "#3b82f6", lt_invest: "#8b5cf6" };
                    const bgColors = { cash: "#052e16", st_invest: "#172554", lt_invest: "#2e1065" };
                    return (
                      <div key={ci} style={{ background: bgColors[comp.type], border: `1px solid ${colors[comp.type]}33`, borderRadius: 6, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: colors[comp.type], textTransform: "uppercase", letterSpacing: "0.5px" }}>{comp.category}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: colors[comp.type] }}>{fmt(comp.amount * 1e6)}</div>
                        </div>
                        {comp.sub.map((s, si) => {
                          const barPct = comp.amount > 0 ? (s.amount / comp.amount * 100) : 0;
                          return (
                            <div key={si} style={{ marginBottom: 6 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
                                <span style={{ color: "#94a3b8" }}>{s.label}</span>
                                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>${s.amount}M</span>
                              </div>
                              <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", borderRadius: 2, width: `${barPct}%`, background: colors[comp.type], opacity: 0.7 }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>}

              {/* ═══ CREDIT FACILITIES — COMMITTED / DRAWN / AVAILABLE ═══ */}
              {detail.liquidityBreakdown && <div style={{ ...card, gridColumn: "1 / -1", border: "1px solid #f97316" }}>
                <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#fdba74", marginBottom: 16, textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {"\u25C6"} Credit Facilities
                </div>

                {/* Horizontal stacked bars per facility */}
                {detail.liquidityBreakdown.facilities.map((fac, fi) => {
                  const maxBar = Math.max(...detail.liquidityBreakdown.facilities.map(f => f.committed));
                  const barScale = maxBar > 0 ? 100 / maxBar : 0;
                  const drawnPct = fac.drawn * barScale;
                  const availPct = fac.available * barScale;
                  const unusablePct = (fac.committed - fac.drawn - fac.available) * barScale;
                  const hasAvailability = fac.available > 0;
                  return (
                    <div key={fi} style={{ marginBottom: fi < detail.liquidityBreakdown.facilities.length - 1 ? 20 : 0 }}>
                      {/* Facility header */}
                      <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "flex-start", gap: mob ? 4 : 0, marginBottom: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: mob ? 11 : 12, fontWeight: 700, color: "#f1f5f9" }}>{fac.name}</div>
                          <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>{fac.secured} {"\u00B7"} {fac.rate} {"\u00B7"} Matures {fac.maturity}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: hasAvailability ? "#22c55e" : "#64748b" }}>{hasAvailability ? fmt(fac.available * 1e6) : "$0"} <span style={{ fontSize: 9, fontWeight: 500, color: "#64748b" }}>available</span></div>
                          <div style={{ fontSize: 9, color: "#64748b" }}>of {fmt(fac.committed * 1e6)} committed</div>
                        </div>
                      </div>

                      {/* Stacked bar: Drawn | Available | Unavailable */}
                      <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden", border: "1px solid #334155", background: "#1e293b" }}>
                        {fac.drawn > 0 && (
                          <div style={{ width: `${drawnPct}%`, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", minWidth: drawnPct > 5 ? "auto" : 0 }}>
                            {drawnPct > 8 ? `$${fac.drawn}M drawn` : ""}
                          </div>
                        )}
                        {fac.available > 0 && (
                          <div style={{ width: `${availPct}%`, background: "linear-gradient(90deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", minWidth: availPct > 5 ? "auto" : 0 }}>
                            {availPct > 8 ? `$${fac.available >= 1000 ? (fac.available/1000).toFixed(1) + "B" : fac.available + "M"} avail` : ""}
                          </div>
                        )}
                        {unusablePct > 0.5 && (
                          <div style={{ width: `${unusablePct}%`, background: "repeating-linear-gradient(45deg, #1e293b, #1e293b 4px, #334155 4px, #334155 8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#64748b", minWidth: unusablePct > 10 ? "auto" : 0 }}>
                            {unusablePct > 15 ? "unavailable" : ""}
                          </div>
                        )}
                        {fac.available === 0 && fac.drawn === 0 && (
                          <div style={{ width: "100%", background: "repeating-linear-gradient(45deg, #1e293b, #1e293b 4px, #334155 4px, #334155 8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#64748b" }}>
                            Not yet available {"\u2014"} conditional / pending
                          </div>
                        )}
                      </div>

                      {/* Amounts row */}
                      <div style={{ display: "flex", gap: mob ? 8 : 16, marginTop: 4, fontSize: 9, flexWrap: "wrap" }}>
                        <span style={{ color: "#ef4444" }}>{"\u25A0"} Drawn: ${fac.drawn}M</span>
                        <span style={{ color: "#22c55e" }}>{"\u25A0"} Available: {fac.available >= 1000 ? `$${(fac.available/1000).toFixed(1)}B` : `$${fac.available}M`}</span>
                        {(fac.committed - fac.drawn - fac.available) > 0 && (
                          <span style={{ color: "#64748b" }}>{"\u25A8"} Unavailable: ${fac.committed - fac.drawn - fac.available >= 1000 ? `${((fac.committed - fac.drawn - fac.available)/1000).toFixed(1)}B` : `${fac.committed - fac.drawn - fac.available}M`} (conditional / collateral limited)</span>
                        )}
                        <span style={{ color: "#475569", marginLeft: "auto" }}>Committed: {fac.committed >= 1000 ? `$${(fac.committed/1000).toFixed(1)}B` : `$${fac.committed}M`}</span>
                      </div>

                      {/* Notes */}
                      <div style={{ marginTop: 4, fontSize: 9, color: "#64748b", lineHeight: 1.5, fontStyle: "italic" }}>{fac.notes}</div>
                    </div>
                  );
                })}

                {/* Summary table */}
                <div style={{ marginTop: 20, borderTop: "1px solid #334155", paddingTop: 12 }}>
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                    <thead>
                      <tr>
                        {["Facility", "Committed", "Drawn", "Available", "Unavailable"].map(h => (
                          <th key={h} style={{ padding: "6px 8px", fontSize: 10, color: "#64748b", textAlign: h === "Facility" ? "left" : "right", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.liquidityBreakdown.facilities.map((fac, fi) => (
                        <tr key={fi} style={{ borderBottom: "1px solid #1e293b" }}>
                          <td style={{ padding: "6px 8px", fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{fac.name}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: "#94a3b8" }}>{fac.committed >= 1000 ? `$${(fac.committed/1000).toFixed(1)}B` : `$${fac.committed}M`}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: fac.drawn > 0 ? "#ef4444" : "#334155", fontWeight: fac.drawn > 0 ? 700 : 400 }}>{fac.drawn > 0 ? `$${fac.drawn}M` : "\u2014"}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: fac.available > 0 ? "#22c55e" : "#475569", fontWeight: 700 }}>{fac.available > 0 ? (fac.available >= 1000 ? `$${(fac.available/1000).toFixed(1)}B` : `$${fac.available}M`) : "$0"}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: "#64748b" }}>{(fac.committed - fac.drawn - fac.available) > 0 ? (fac.committed - fac.drawn - fac.available >= 1000 ? `$${((fac.committed - fac.drawn - fac.available)/1000).toFixed(1)}B` : `$${fac.committed - fac.drawn - fac.available}M`) : "\u2014"}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "2px solid #475569" }}>
                        <td style={{ padding: "8px", fontSize: 11, fontWeight: 800, color: "#f1f5f9" }}>Total</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#f1f5f9" }}>{fmt(detail.liquidityBreakdown.facilities.reduce((s,f) => s + f.committed, 0) * 1e6)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#ef4444" }}>{fmt(detail.liquidityBreakdown.facilities.reduce((s,f) => s + f.drawn, 0) * 1e6)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#22c55e" }}>{fmt(detail.liquidityBreakdown.facilities.reduce((s,f) => s + f.available, 0) * 1e6)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#64748b" }}>{fmt(detail.liquidityBreakdown.facilities.reduce((s,f) => s + (f.committed - f.drawn - f.available), 0) * 1e6)}</td>
                      </tr>
                    </tbody>
                  </table></div>
                </div>

                {/* Liquidity quality assessment */}
                <div style={{ marginTop: 16, padding: 12, background: "#0a0e1a", borderRadius: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Liquidity Quality Assessment</div>
                  {(() => {
                    const lb = detail.liquidityBreakdown;
                    const immediatelyAvail = lb.components.filter(c => c.type !== "facility").reduce((s, c) => s + c.amount, 0);
                    const immCovQtrs = qBurn > 0 ? (immediatelyAvail / qBurn).toFixed(1) : "\u221E";
                    const totalFacilityAvail = lb.facilities.reduce((s,f) => s + f.available, 0);
                    return (
                      <>
                        <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#22c55e" }}>Immediately Available (Cash + Investments):</b> {fmt(immediatelyAvail * 1e6)} {"\u2014"} covers <b style={{ color: parseFloat(immCovQtrs) >= 4 || isNetCashGenerator ? "#22c55e" : "#ef4444" }}>{isNetCashGenerator ? "\u221E" : immCovQtrs} quarters</b> at current LTM burn rate</div>
                        <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Drawable Facilities:</b> {fmt(totalFacilityAvail * 1e6)} across {lb.facilities.length} facility(ies) {"\u2014"} {totalFacilityAvail > 0 ? (isNetCashGenerator ? "strategic optionality" : `provides incremental ${(totalFacilityAvail / (qBurn || 1)).toFixed(1)} quarters of coverage`) : "no undrawn facility availability"}</div>
                        <div>{"\u25CF"} <b style={{ color: "#94a3b8" }}>Total Liquidity:</b> {fmt(lb.totalLiquidity * 1e6)} {"\u2014"} {isNetCashGenerator ? "borrower is a net cash generator; liquidity is a buffer, not a runway" : `${fmtNum(lb.totalLiquidity / (ltmBurnMonthly || 1), 1)} months of LTM adjusted burn coverage`}</div>
                      </>
                    );
                  })()}
                </div>
              </div>}

              {/* ═══ DEBT MATURITY WALL ═══ */}
              {detail.liquidityBreakdown && <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Debt Maturity Profile & Refinancing Risk</div>
                <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 100, marginBottom: 4 }}>
                  {detail.liquidityBreakdown.debtMaturities.map((m, i) => {
                    const maxAmt = Math.max(...detail.liquidityBreakdown.debtMaturities.map(x => x.amount));
                    const h = maxAmt > 0 ? Math.max(4, (m.amount / maxAmt) * 85) : 4;
                    const isNear = ["2026", "2027", "2028"].includes(m.year);
                    return (
                      <div key={i} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: m.amount > 0 ? (isNear ? "#ef4444" : "#f97316") : "#334155", marginBottom: 2 }}>
                          {m.amount > 0 ? `$${m.amount}M` : "\u2014"}
                        </div>
                        <div style={{ height: h, background: m.amount > 0 ? `linear-gradient(180deg, ${isNear ? "#ef4444" : "#f97316"} 0%, ${isNear ? "#7f1d1d" : "#431407"} 100%)` : "#1e293b", borderRadius: "3px 3px 0 0", margin: "0 6px", opacity: m.amount > 0 ? 0.85 : 0.3 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 2, marginBottom: 12 }}>
                  {detail.liquidityBreakdown.debtMaturities.map((m, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "#64748b", fontWeight: 600 }}>{m.year}</div>
                  ))}
                </div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                  <thead>
                    <tr>
                      {["Year", "Amount", "Description", "Refi Risk"].map(h => (
                        <th key={h} style={{ padding: "6px 8px", fontSize: 10, color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.liquidityBreakdown.debtMaturities.filter(m => m.amount > 0).map((m, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "8px", fontSize: 12, fontWeight: 700 }}>{m.year}</td>
                        <td style={{ padding: "8px", fontSize: 12, fontWeight: 700, color: "#f97316" }}>${m.amount}M</td>
                        <td style={{ padding: "8px", fontSize: 11, color: "#94a3b8" }}>{m.desc}</td>
                        <td style={{ padding: "8px", fontSize: 10 }}>
                          {parseInt(m.year) <= 2028 ? <span style={{ color: "#ef4444", fontWeight: 700 }}>{"\u26A0"} Near-Term</span> : <span style={{ color: "#eab308" }}>Manageable</span>}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #334155" }}>
                      <td style={{ padding: "8px", fontSize: 12, fontWeight: 800, color: "#f1f5f9" }}>Total</td>
                      <td style={{ padding: "8px", fontSize: 12, fontWeight: 800, color: "#ef4444" }}>${detail.liquidityBreakdown.debtMaturities.reduce((s, m) => s + m.amount, 0).toLocaleString()}M</td>
                      <td colSpan={2} style={{ padding: "8px", fontSize: 10, color: "#64748b" }}>
                        Wtd. avg. maturity: {(() => {
                          const mats = detail.liquidityBreakdown.debtMaturities.filter(m => m.amount > 0 && m.year !== "Other");
                          const totalD = mats.reduce((s, m) => s + m.amount, 0);
                          const wtdYr = totalD > 0 ? mats.reduce((s, m) => s + m.amount * parseInt(m.year), 0) / totalD : 0;
                          return totalD > 0 ? `${(wtdYr - 2026).toFixed(1)} years from today` : "N/A";
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table></div>
              </div>}

              {/* ═══ HISTORICAL CASH & BURN TREND ═══ */}
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Cash Position Trend ($M)</div>
                <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 90, marginBottom: 4 }}>
                  {[...detail.financials].reverse().map((f, i) => {
                    const maxC = Math.max(...detail.financials.map(x => x.cash));
                    const h = (f.cash / maxC) * 80;
                    return (
                      <div key={i} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", marginBottom: 2 }}>{f.cash >= 1000 ? `${(f.cash / 1000).toFixed(1)}B` : `$${f.cash}M`}</div>
                        <div style={{ height: h, background: "linear-gradient(180deg, #22c55e 0%, #065f46 100%)", borderRadius: "3px 3px 0 0", margin: "0 6px", opacity: 0.85 }} />
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 4 }}>{f.period.replace("FY", "")}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: "#0a0e1a", borderRadius: 4, fontSize: 11, color: "#94a3b8" }}>
                  <b style={{ color: "#f97316" }}>YoY Cash Change:</b>{" "}
                  {detail.financials[0] && detail.financials[1] ? (() => {
                    const chg = detail.financials[0].cash - detail.financials[1].cash;
                    const chgStr = Math.abs(chg) >= 1000 ? `${(chg / 1000).toFixed(2)}B` : `$${chg}M`;
                    const pctChg = detail.financials[1].cash > 0 ? ((chg / detail.financials[1].cash) * 100).toFixed(1) : "N/A";
                    return <span style={{ color: chg >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{chg >= 0 ? "+" : ""}{chgStr} ({pctChg}%)</span>;
                  })() : "\u2014"}
                </div>

                {/* Debt vs Cash comparison */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Debt vs. Cash Over Time</div>
                  {[...detail.financials].reverse().map((f, i) => {
                    const maxVal = Math.max(...detail.financials.flatMap(x => [x.cash, x.debt]));
                    return (
                      <div key={i} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>{f.period}</div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <div style={{ height: 6, borderRadius: 3, background: "#22c55e", width: `${(f.cash / maxVal) * 100}%`, opacity: 0.8 }} />
                          <span style={{ fontSize: 8, color: "#22c55e", flexShrink: 0 }}>{f.cash >= 1000 ? `${(f.cash/1000).toFixed(1)}B` : `$${f.cash}M`}</span>
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                          <div style={{ height: 6, borderRadius: 3, background: "#ef4444", width: `${(f.debt / maxVal) * 100}%`, opacity: 0.6 }} />
                          <span style={{ fontSize: 8, color: "#ef4444", flexShrink: 0 }}>{f.debt >= 1000 ? `${(f.debt/1000).toFixed(1)}B` : `$${f.debt}M`}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9 }}>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#22c55e", marginRight: 4, verticalAlign: "middle" }} />Cash</span>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#ef4444", opacity: 0.6, marginRight: 4, verticalAlign: "middle" }} />Debt</span>
                  </div>
                </div>
              </div>

              {/* ═══ BURN COVERAGE SCENARIO ANALYSIS ═══ */}
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>{isNetCashGenerator ? "Cash Flow Scenario Analysis" : "Burn Coverage Scenario Analysis"}</div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                  <thead>
                    <tr>
                      {["Scenario", "Qtr Burn", "Runway", "Flag"].map(h => (
                        <th key={h} style={{ padding: "8px 4px", fontSize: 10, color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { sc: "Current Run-Rate", burn: qBurn, note: "Based on LTM adjusted burn" },
                      { sc: "Burn +25% (Stress)", burn: qBurn * 1.25, note: "Operational deterioration / cost overruns" },
                      { sc: "Burn +50% (Severe)", burn: qBurn * 1.5, note: "Major operational disruption" },
                      { sc: "Burn -25% (Improved)", burn: qBurn * 0.75, note: "Margin improvement / cost cuts" },
                      { sc: "Burn -50% (Optimistic)", burn: qBurn * 0.5, note: "Significant cost reduction + volume" },
                    ].map((s, i) => {
                      const rw = s.burn > 0 ? detail.cash / s.burn : 999;
                      const rwDisplay = rw >= 99 ? "\u221E" : fmtNum(rw);
                      const rwColor = isNetCashGenerator ? "#22c55e" : rw >= 8 ? "#22c55e" : rw >= 5 ? "#eab308" : "#ef4444";
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                          <td style={{ padding: "8px 4px", fontSize: 12, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? "#f1f5f9" : "#94a3b8" }}>{s.sc}</td>
                          <td style={{ padding: "8px 4px", fontSize: 12, color: "#ef4444", fontWeight: 600 }}>{fmt(s.burn * 1e6)}</td>
                          <td style={{ padding: "8px 4px" }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: rwColor }}>{rwDisplay} qtrs</span>
                            <div style={{ marginTop: 2, background: "#1e293b", borderRadius: 3, height: 4, width: 80 }}>
                              <div style={{ height: "100%", borderRadius: 3, width: `${Math.min((rw >= 99 ? 12 : rw) / 12, 1) * 100}%`, background: rwColor }} />
                            </div>
                          </td>
                          <td style={{ padding: "8px 4px", fontSize: 10, color: "#64748b" }}>
                            {rw >= 99 ? "\u2713 N/A" : rw < 4 ? "\u26A0\u26A0 Critical" : rw < 6 ? "\u26A0 Warning" : "OK"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: "#0a0e1a", borderRadius: 4, fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>
                  <b style={{ color: "#94a3b8" }}>Methodology:</b> Cash runway = Total Liquidity ({fmt(detail.cash * 1e6)}) / Scenario Quarterly Burn. Does not account for potential capital raises, asset sales, or credit facility draws. Stress scenarios model operational deterioration; improvement scenarios assume delivery ramp traction.
                </div>
              </div>

              {/* ═══ HISTORICAL P&L ═══ */}
              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Historical P&L ($M)</div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                  <thead>
                    <tr>
                      {["Period", "Revenue", "EBITDA", "EBITDA Margin", "Net Income", "Total Debt", "Cash", "Net Cash/(Debt)", "D/E"].map((h) => (
                        <th key={h} style={{ padding: "6px 6px", fontSize: 10, color: "#64748b", textAlign: "right", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.financials.map((f, i) => {
                      const fmtB = (v) => v >= 1000 || v <= -1000 ? `${(v/1000).toFixed(1)}B` : `${v}M`;
                      const ebitdaMargin = ((f.ebitda / f.rev) * 100).toFixed(1);
                      const nc = f.cash - f.debt;
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b", background: i === 0 ? "#0f172a" : "transparent" }}>
                          <td style={{ padding: "8px 6px", fontWeight: 700, fontSize: 12 }}>{f.period} {i === 0 && <span style={{ fontSize: 8, color: "#3b82f6" }}>LATEST</span>}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12 }}>{fmtB(f.rev)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: f.ebitda < 0 ? "#ef4444" : "#22c55e", fontWeight: 600 }}>{fmtB(f.ebitda)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: f.ebitda < 0 ? "#ef4444" : "#94a3b8" }}>{ebitdaMargin}%</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: f.ni < 0 ? "#ef4444" : "#22c55e" }}>{fmtB(f.ni)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12 }}>{fmtB(f.debt)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: "#22c55e" }}>{fmtB(f.cash)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: nc >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtB(nc)}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: detail.totalEquity <= 0 ? "#ef4444" : "#94a3b8" }}>{detail.totalEquity > 0 ? `${(f.debt / detail.totalEquity).toFixed(2)}x` : "Neg. Eq."}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                <div style={{ display: "flex", gap: mob ? 12 : 24, marginTop: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Revenue Trend</div>
                    <MiniBar data={[...detail.financials].reverse().map((f) => f.rev)} labels={[...detail.financials].reverse().map((f) => f.period.replace("FY",""))} color="#3b82f6" w={mob ? 130 : 160} h={50} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>EBITDA Trend</div>
                    <MiniBar data={[...detail.financials].reverse().map((f) => f.ebitda)} labels={[...detail.financials].reverse().map((f) => f.period.replace("FY",""))} color="#3b82f6" w={mob ? 130 : 160} h={50} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Cash Trend</div>
                    <MiniBar data={[...detail.financials].reverse().map((f) => f.cash)} labels={[...detail.financials].reverse().map((f) => f.period.replace("FY",""))} color="#22c55e" w={mob ? 130 : 160} h={50} />
                  </div>
                </div>
              </div>

              {/* ═══ TRADITIONAL CREDIT METRICS + OPERATIONAL ═══ */}
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Traditional Credit Metrics</div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                  <tbody>
                    {[
                      ["Gross Leverage (Debt/EBITDA)", detail.ebitda > 0 ? `${(detail.totalDebt / detail.ebitda).toFixed(1)}x` : "N/M (neg. EBITDA)", detail.ebitda <= 0 || detail.totalDebt / detail.ebitda > 5, detail.ebitda <= 0 ? "Not meaningful \u2014 EBITDA is negative" : detail.totalDebt / detail.ebitda <= 3 ? "Moderate leverage" : detail.totalDebt / detail.ebitda <= 5 ? "Elevated leverage" : "High leverage"],
                      ["Interest Coverage (EBITDA/IntExp)", `${fmtNum(detail.intCov)}x`, detail.intCov < 2, detail.intCov >= 3 ? "Adequate debt service coverage" : detail.intCov >= 2 ? "Thin but sufficient" : "Cannot adequately service debt"],
                      ["Debt / Equity", detail.totalEquity > 0 ? `${fmtNum(detail.debtToEquity)}x` : "N/M (neg. equity)", detail.totalEquity <= 0 || detail.debtToEquity > 2, detail.totalEquity <= 0 ? "Negative equity" : detail.debtToEquity < 1 ? "Below 1x \u2014 equity cushion intact" : "Elevated \u2014 monitor equity erosion"],
                      ["Current Ratio", `${fmtNum(detail.currentRatio)}x`, detail.currentRatio < 1, detail.currentRatio >= 1.5 ? "Adequate short-term liquidity" : "Monitor short-term coverage"],
                      ["ROIC", `${fmtNum(detail.roic)}%`, detail.roic < 0, detail.roic >= 10 ? "Solid return on capital" : detail.roic >= 0 ? "Positive but low return" : "Negative \u2014 destroying capital"],
                      ["FCF Yield", detail.mktCap ? `${((detail.fcf / (detail.mktCap * 1000)) * 100).toFixed(1)}%` : "N/A (private)", detail.fcf < 0, detail.fcf >= 0 ? "Positive FCF generation" : "Negative \u2014 cash consumption"],
                    ].map(([l, v, warn, note], i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "7px 0", color: "#94a3b8", fontSize: 11 }}>{l}</td>
                        <td style={{ padding: "7px 0", textAlign: "right", fontWeight: 700, fontSize: 12, color: warn ? "#ef4444" : "#e2e8f0" }}>{v}</td>
                        <td style={{ padding: "7px 0 7px 8px", fontSize: 9, color: "#475569", maxWidth: 120 }}>{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Operational & Financial Metrics</div>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 12, minWidth: 0 }}>
                  {[
                    { l: "FY2025 Revenue", v: fmt(detail.revenue * 1e6) },
                    ...(detail.deliveries2025 ? [
                      { l: "FY2025 Deliveries", v: detail.deliveries2025.toLocaleString() },
                      { l: "2026 Delivery Guidance", v: detail.deliveriesGuidance2026 },
                      { l: "Rev / Vehicle (Avg)", v: `$${((detail.revenue * 1e6) / detail.deliveries2025 / 1000).toFixed(0)}K` },
                    ] : [
                      { l: "EBITDA", v: fmt(detail.ebitda * 1e6), c: detail.ebitda < 0 ? "#ef4444" : "#22c55e" },
                      { l: "EBITDA Margin", v: detail.revenue > 0 ? `${((detail.ebitda / detail.revenue) * 100).toFixed(1)}%` : "\u2014", c: detail.ebitda > 0 ? "#22c55e" : "#ef4444" },
                      { l: "Gross Leverage", v: detail.ebitda > 0 ? `${(detail.totalDebt / detail.ebitda).toFixed(1)}x` : "N/M", c: detail.ebitda > 0 && detail.totalDebt / detail.ebitda <= 4 ? "#eab308" : "#ef4444" },
                    ]),
                    { l: "Net Income", v: fmt(detail.netIncome * 1e6), c: detail.netIncome < 0 ? "#ef4444" : "#22c55e" },
                    ...(detail.deliveries2025 ? [
                      { l: "Loss / Vehicle", v: `$(${((Math.abs(detail.netIncome) * 1e6) / detail.deliveries2025 / 1000).toFixed(0)}K)`, c: "#ef4444" },
                    ] : [
                      { l: "FCF", v: fmt(detail.fcf * 1e6), c: detail.fcf < 0 ? "#ef4444" : "#22c55e" },
                    ]),
                    { l: "Mkt Cap", v: detail.mktCap ? `$${detail.mktCap}B` : "Private" },
                    { l: "Portfolio Exposure", v: fmt(detail.exposure) },
                  ].map((m, i) => (
                    <div key={i} style={{ padding: "8px 10px", background: "#0a0e1a", borderRadius: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: m.c || "#f1f5f9" }}>{m.v}</div>
                      <div style={kpiLabel}>{m.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            );
          })()}

          {/* RATINGS */}
          {detailTab === "ratings" && (
            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 16, minWidth: 0 }}>
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Rating Status</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: mob ? 8 : 16 }}>
                  {[{ agency: "S&P", rating: detail.sp }, { agency: "Moody's", rating: detail.moodys }, { agency: "Fitch", rating: detail.fitch }].map((r) => (
                    <div key={r.agency} style={{ textAlign: "center", padding: mob ? 10 : 16, background: "#0a0e1a", borderRadius: 6 }}>
                      <div style={{ fontSize: mob ? 18 : 22, fontWeight: 800, color: ratingColor(r.rating) }}>{r.rating}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{r.agency}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: 12, background: "#0a0e1a", borderRadius: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 18, color: ratingColor(detail.impliedRating) }}>{"\u25C6"}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Implied Rating: <span style={{ color: ratingColor(detail.impliedRating) }}>{detail.impliedRating}</span></div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Based on CDS spreads, financial profile & market signals</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18, color: outlookColor(detail.outlook) }}>{outlookIcon(detail.outlook)}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{detail.outlook} Outlook</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{getWatchlistStatus(detail).active ? "On internal watchlist \u2014 heightened monitoring" : "Active monitoring \u2014 standard review cycle"}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Debt & Capital Events Timeline</div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 4px", fontSize: 10, color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>Date</th>
                      <th style={{ padding: "8px 4px", fontSize: 10, color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ratingHistory.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "10px 4px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{r.date}</td>
                        <td style={{ padding: "10px 4px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{r.event}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>

              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Credit Assessment Summary</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                  <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: detail.sp === "NR" ? "#ef4444" : "#eab308" }}>Rating:</b> {detail.sp !== "NR" ? `S&P ${detail.sp} / Moody's ${detail.moodys}${detail.fitch !== "NR" ? ` / Fitch ${detail.fitch}` : ""}` : "Not Rated — no public agency rating."} Implied rating: <b style={{ color: ratingColor(detail.impliedRating) }}>{detail.impliedRating}</b>.</div>
                  <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: detail.ebitda < 0 ? "#ef4444" : "#f97316" }}>Earnings Profile:</b> {detail.ebitda > 0 ? `EBITDA-positive at ${fmt(detail.ebitda * 1e6)} (${((detail.ebitda / detail.revenue) * 100).toFixed(1)}% margin).` : "Pre-profitability with negative EBITDA. Traditional leverage ratios not meaningful."} Liquidity of {fmt(detail.cash * 1e6)} — {detail.liquidityRunway}.</div>
                  <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Leverage:</b> {detail.ebitda > 0 ? `Gross leverage ${(detail.totalDebt / detail.ebitda).toFixed(1)}x; interest coverage ${fmtNum(detail.intCov)}x.` : `Debt of ${fmt(detail.totalDebt * 1e6)} against negative EBITDA. Focus on cash runway and capital structure.`} {detail.fcf > 0 ? `Positive FCF of ${fmt(detail.fcf * 1e6)} supports deleveraging.` : `Negative FCF of ${fmt(detail.fcf * 1e6)} — reliant on external capital.`}</div>
                  {detail.id === "LCID" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Key Mitigants:</b> PIF (Saudi sovereign wealth fund) majority ownership provides implicit support; $975M 2031 convertible notes extend maturity.</div>}
                  {detail.id === "RIVN" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Key Mitigants:</b> VW $5B strategic investment; DOE ATVM loan up to $6.6B conditionally approved; $1.25B Uber robotaxi partnership.</div>}
                  {detail.id === "IHRT" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#ef4444" }}>Key Risk:</b> Very high leverage at ~6.3x with thin coverage; secular decline in traditional radio; $4.8B debt exchange extended maturities but did not reduce leverage meaningfully.</div>}
                  {detail.id === "CENT" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Key Strength:</b> Cost & Simplicity program driving margin expansion; $721M record cash; $750M undrawn ABL revolver; leverage within target range.</div>}
                  {detail.id === "SMC" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Key Factor:</b> Double E pipeline contracts de-risk Permian growth; 4.1x leverage elevated but in compliance with covenants; FCF trajectory improving.</div>}
                  {detail.id === "UPBD" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Key Factor:</b> Omnichannel model (Acima + Rent-A-Center + Brigit) provides diversification; monitor Acima lease charge-off rates as key credit metric.</div>}
                  {detail.id === "WSC" && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Key Strength:</b> Recurring lease revenue model with strong pricing power; $1.6B ABL availability; 3.5x leverage within target range; 3-5yr targets of $3B rev / $1.5B EBITDA.</div>}
                  {(detail.id === "BEUSA" || detail.id === "JSWUSA") && <div style={{ marginBottom: 6 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Private Company:</b> Limited financial transparency — rely on bank group reporting and parent company disclosures. {detail.id === "JSWUSA" ? "Implicit support from JSW Group ($24B Indian conglomerate)." : "Niche oilfield services operator with electric frac technology differentiator."}</div>}
                </div>
              </div>

              {/* ═══ WATCHLIST STATUS & OVERRIDE ═══ */}
              <div style={{ ...card, gridColumn: "1 / -1", border: `1px solid ${getWatchlistStatus(detail).active ? "#dc2626" : "#22c55e"}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Watchlist Status & Override</div>
                {(() => {
                  const ws = getWatchlistStatus(detail);
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 8, background: ws.active ? "#7f1d1d" : "#052e16", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                          {ws.active ? "\u26A0" : "\u2713"}
                        </div>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: ws.active ? "#fca5a5" : "#86efac" }}>
                            {ws.active ? "ON WATCHLIST" : "NOT ON WATCHLIST"}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            Source: {ws.source === "override" ? "Analyst Override" : "Auto-triggered by rules engine"}
                            {ws.source === "override" && ` \u2014 ${watchlistOverrides[detail.id]?.date} by ${watchlistOverrides[detail.id]?.analyst}`}
                          </div>
                        </div>
                      </div>

                      {/* Auto triggers */}
                      {ws.triggers.length > 0 && (
                        <div style={{ marginBottom: 12, padding: 10, background: "#0a0e1a", borderRadius: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Auto-trigger rules fired ({ws.triggers.length})</div>
                          {ws.triggers.map((t, i) => (
                            <div key={i} style={{ fontSize: 11, color: "#fca5a5", marginBottom: 2, paddingLeft: 10, borderLeft: "2px solid #7f1d1d" }}>{t}</div>
                          ))}
                        </div>
                      )}
                      {ws.triggers.length === 0 && (
                        <div style={{ marginBottom: 12, padding: 10, background: "#0a0e1a", borderRadius: 6 }}>
                          <div style={{ fontSize: 11, color: "#86efac" }}>{"\u2713"} No auto-trigger rules fired — all quantitative thresholds within acceptable range.</div>
                        </div>
                      )}

                      {/* Override reason if active */}
                      {ws.source === "override" && ws.reason && (
                        <div style={{ marginBottom: 12, padding: 10, background: ws.active ? "#431407" : "#052e16", borderRadius: 6, border: `1px solid ${ws.active ? "#78350f" : "#14532d"}` }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>Override reason</div>
                          <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>{ws.reason}</div>
                        </div>
                      )}

                      {/* Override controls */}
                      {showOverrideModal === detail.id ? (
                        <div style={{ padding: 12, background: "#1e293b", borderRadius: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
                            {ws.active ? "Remove from watchlist" : "Add to watchlist"} — provide reason:
                          </div>
                          <textarea
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            placeholder="Document the rationale for this override (required for audit trail)..."
                            style={{ width: "100%", padding: 10, background: "#0a0e1a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", resize: "vertical", minHeight: 60 }}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              onClick={() => overrideReason.trim() && toggleOverride(detail.id, !ws.active, overrideReason.trim())}
                              disabled={!overrideReason.trim()}
                              style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 700, border: "none", background: overrideReason.trim() ? (ws.active ? "#052e16" : "#7f1d1d") : "#1e293b", color: overrideReason.trim() ? "#fff" : "#475569", cursor: overrideReason.trim() ? "pointer" : "not-allowed" }}
                            >
                              {ws.active ? "Remove from Watchlist" : "Add to Watchlist"}
                            </button>
                            <button
                              onClick={() => { setShowOverrideModal(null); setOverrideReason(""); }}
                              style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => setShowOverrideModal(detail.id)}
                            style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 700, border: "1px solid #334155", background: "#1e293b", color: "#94a3b8", cursor: "pointer" }}
                          >
                            {ws.active ? "Override: Remove from Watchlist" : "Override: Add to Watchlist"}
                          </button>
                          {ws.source === "override" && (
                            <button
                              onClick={() => clearOverride(detail.id)}
                              style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, border: "1px solid #475569", background: "transparent", color: "#64748b", cursor: "pointer" }}
                            >
                              Clear Override (revert to auto)
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* SEC FILINGS (Company-specific) */}
          {detailTab === "filings" && (
            <div style={card}>
              <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: 8, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>SEC Filings {"\u2014"} {detail.name}</div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>CIK: {{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || "Private"}</div>
                </div>
                <button onClick={fetchSecFilings} disabled={dataLoading.sec} style={{ padding: "6px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: "pointer" }}>
                  {dataLoading.sec ? "Loading..." : "\u21BB Refresh from EDGAR"}
                </button>
              </div>

              {(secFilings.filter(f => f.ticker === detail.id).length > 0 ? secFilings.filter(f => f.ticker === detail.id) : [
                { form: "8-K", date: "2026-03-15", label: "Material Event", severity: "material", desc: `Current report filed by ${detail.name}`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || ""}&type=&dateb=&owner=include&count=20` },
                { form: "10-K", date: "2026-03-01", label: "Annual Report", severity: "routine", desc: `FY2025 annual report`, url: "#" },
              ]).map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: mob ? "flex-start" : "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1e293b", flexWrap: mob ? "wrap" : "nowrap" }}>
                  <span style={{ fontSize: 14 }}>{sevIcon[f.severity]}</span>
                  <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${sevColor[f.severity]}22`, color: sevColor[f.severity], border: `1px solid ${sevColor[f.severity]}44` }}>{f.form}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{f.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{f.desc}</div>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", flexShrink: 0 }}>{f.date}</div>
                </div>
              ))}

              <div style={{ marginTop: 16, padding: 10, background: "#0a0e1a", borderRadius: 6, fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>
                <b>EDGAR Direct Links:</b>{" "}
                <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || ""}&type=8-K&dateb=&owner=include&count=10`} target="_blank" rel="noopener" style={{ color: "#3b82f6" }}>8-K</a>{" \u00B7 "}
                <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || ""}&type=10-K&dateb=&owner=include&count=10`} target="_blank" rel="noopener" style={{ color: "#3b82f6" }}>10-K</a>{" \u00B7 "}
                <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || ""}&type=4&dateb=&owner=include&count=10`} target="_blank" rel="noopener" style={{ color: "#3b82f6" }}>Form 4</a>{" \u00B7 "}
                <a href={`https://efts.sec.gov/LATEST/search-index?q=%22${detail.name.split(" ")[0]}%22&dateRange=custom&startdt=2025-01-01&enddt=2026-12-31`} target="_blank" rel="noopener" style={{ color: "#3b82f6" }}>Full-Text Search</a>
              </div>
            </div>
          )}

          {detailTab === "news" && (
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Recent Headlines {"\u2014"} {detail.name}</div>
              {detail.news.map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: i < detail.news.length - 1 ? "1px solid #1e293b" : "none" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: sentimentColor(n.sentiment), marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{n.headline}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{n.src} {"\u00B7"} {n.date}</div>
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: sentimentColor(n.sentiment), letterSpacing: "0.5px", flexShrink: 0 }}>{n.sentiment}</span>
                </div>
              ))}
            </div>
          )}

          {/* RESEARCH */}
          {detailTab === "research" && (
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Equity Research {"\u2014"} {detail.name}</div>
              <div style={{ padding: mob ? "10px 12px" : "12px 16px", background: "#0a0e1a", borderRadius: 6, marginBottom: 16, display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: mob ? 10 : 24 }}>
                <div><span style={{ fontSize: 10, color: "#64748b" }}>CONSENSUS</span><div style={{ fontSize: mob ? 13 : 14, fontWeight: 700, marginTop: 2 }}>{detail.analystRating}</div></div>
                <div><span style={{ fontSize: 10, color: "#64748b" }}>AVG TARGET</span><div style={{ fontSize: mob ? 13 : 14, fontWeight: 700, marginTop: 2 }}>${detail.targetPrice}</div></div>
                <div><span style={{ fontSize: 10, color: "#64748b" }}>CURRENT</span><div style={{ fontSize: mob ? 13 : 14, fontWeight: 700, marginTop: 2 }}>{detail.eqPrice != null ? `$${detail.eqPrice}` : "Private"}</div></div>
                <div><span style={{ fontSize: 10, color: "#64748b" }}>UPSIDE</span><div style={{ fontSize: mob ? 13 : 14, fontWeight: 700, marginTop: 2, color: detail.targetPrice && detail.eqPrice ? (detail.targetPrice > detail.eqPrice ? "#22c55e" : "#ef4444") : "#64748b" }}>{detail.targetPrice && detail.eqPrice ? `${(((detail.targetPrice - detail.eqPrice) / detail.eqPrice) * 100).toFixed(1)}%` : "N/A"}</div></div>
              </div>
              {detail.research.map((r, i) => (
                <div key={i} style={{ padding: "14px 0", borderBottom: i < detail.research.length - 1 ? "1px solid #1e293b" : "none" }}>
                  <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: mob ? 4 : 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: mob ? 6 : 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{r.firm}</span>
                      <span style={{ color: r.action.includes("Buy") || r.action.includes("Outperform") ? "#22c55e" : r.action.includes("Underperform") || r.action.includes("UW") || r.action.includes("Downgrade") ? "#ef4444" : "#eab308", fontSize: 12, marginLeft: mob ? 0 : 10, fontWeight: 600 }}>{r.action}</span>
                      <span style={{ color: "#64748b", fontSize: 12, marginLeft: mob ? 0 : 10 }}>PT ${r.pt}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{r.date}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.6 }}>{r.summary}</div>
                </div>
              ))}
            </div>
          )}

          {/* EARNINGS */}
          {detailTab === "earnings" && (
            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 16, minWidth: 0 }}>
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Next Earnings</div>
                <div style={{ padding: mob ? 14 : 20, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: mob ? 22 : 28, fontWeight: 800, color: "#3b82f6" }}>{detail.earningsDate || "N/A"}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{detail.earningsTime || "Private / Not Scheduled"}</div>
                  {detail.earningsDate && <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>{Math.ceil((new Date(detail.earningsDate) - now) / (1000 * 60 * 60 * 24))} days away</div>}
                </div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Last Earnings Result</div>
                <div style={{ padding: mob ? 14 : 20, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: mob ? 14 : 16, fontWeight: 700, color: detail.lastEarnings.startsWith("Beat") ? "#22c55e" : "#ef4444" }}>{detail.lastEarnings}</div>
                </div>
              </div>
              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: mob ? 4 : 0, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Earnings Call Summary</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{detail.earningsCallSummary.quarter} {"\u00B7"} {detail.earningsCallSummary.date}</div>
                </div>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 16, fontStyle: "italic" }}>Source: {detail.earningsCallSummary.source}</div>

                {/* Key Financials */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Key financials</div>
                  {detail.earningsCallSummary.keyFinancials.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 2, paddingLeft: 12, borderLeft: "2px solid #1e3a5f" }}>{item}</div>
                  ))}
                </div>

                {/* Production & Deliveries */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Production & deliveries</div>
                  {detail.earningsCallSummary.production.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 2, paddingLeft: 12, borderLeft: "2px solid #14532d" }}>{item}</div>
                  ))}
                </div>

                {/* Credit-Relevant Commentary */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Credit-relevant commentary</div>
                  {detail.earningsCallSummary.creditRelevant.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 2, paddingLeft: 12, borderLeft: "2px solid #7f1d1d" }}>{item}</div>
                  ))}
                </div>

                {/* Strategic Items */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Strategic & growth items</div>
                  {detail.earningsCallSummary.strategicItems.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 2, paddingLeft: 12, borderLeft: "2px solid #4c1d95" }}>{item}</div>
                  ))}
                </div>

                {/* Analyst Q&A Highlights */}
                {detail.earningsCallSummary.analystQA.length > 0 && <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Analyst Q&A highlights</div>
                  {detail.earningsCallSummary.analystQA.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #7c2d12" }}>
                      <span style={{ color: "#f97316" }}>Q:</span> {item.split("? — ")[0]}?
                      <br /><span style={{ color: "#94a3b8" }}>A:</span> {item.split("? — ")[1]}
                    </div>
                  ))}
                </div>}
              </div>
              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Earnings Call {"\u2014"} Credit-Relevant Items to Monitor</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>
                  <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: detail.fcf > 0 ? "#22c55e" : "#ef4444" }}>{detail.fcf > 0 ? "Cash Generation:" : "Cash Burn Rate:"}</b> {detail.fcf > 0 ? `Quarterly cash flow of +${fmt(Math.abs(detail.cashBurnQtr) * 1e6)} \u2014 monitor for sustained cash generation and deleveraging trajectory.` : `Quarterly burn of ${fmt(Math.abs(detail.cashBurnQtr) * 1e6)} \u2014 listen for updated burn trajectory and breakeven guidance.`}</div>
                  <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: detail.fcf > 0 ? "#22c55e" : "#ef4444" }}>{detail.fcf > 0 ? "Liquidity Position:" : "Liquidity Runway:"}</b> {detail.fcf > 0 ? `Cash of ${fmt(detail.cash * 1e6)}. Monitor for capital allocation priorities \u2014 debt paydown, dividends, buybacks, or M&A.` : `Cash of ${fmt(detail.cash * 1e6)}. Monitor for capital raise plans, convert issuance, or dilution signals.`}</div>
                  {detail.deliveriesGuidance2026 && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Gross Margin:</b> Track vehicle-level gross margin improvement {"\u2014"} critical inflection point for credit story.</div>}
                  {detail.deliveriesGuidance2026 && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#f97316" }}>Delivery Guidance:</b> 2026 guidance of {detail.deliveriesGuidance2026}. Any revision is a key credit signal.</div>}
                  {detail.id === "RIVN" && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>R2 Launch:</b> Spring 2026 deliveries beginning {"\u2014"} demand data, reservation conversions, and ramp commentary.</div>}
                  {detail.id === "RIVN" && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>DOE Loan:</b> Status of $6.6B ATVM conditional loan {"\u2014"} disbursement timeline updates.</div>}
                  {detail.id === "LCID" && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>Gravity Ramp:</b> SUV production and delivery trajectory {"\u2014"} the primary 2026 revenue growth driver.</div>}
                  {detail.id === "LCID" && <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>PIF Support:</b> Any signals of additional capital injection or liquidity backstop from majority shareholder.</div>}
                  <div style={{ marginBottom: 4 }}>{"\u25CF"} <b style={{ color: "#60a5fa" }}>CapEx & Debt:</b> Factory expansion plans, R&D spending, maturity wall, and refinancing activity.</div>
                </div>
              </div>
            </div>
          )}
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // ─── RENDER: PORTFOLIO VIEW ─────────────────────────────────────────────
  return (
    <div style={root}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 16, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: mob ? 13 : 16, fontWeight: 800, letterSpacing: "-0.5px", color: "#f1f5f9", whiteSpace: "nowrap" }}>
            <span style={{ color: "#ef4444" }}>{"\u25C6"}</span> EV CREDIT RISK MONITOR
          </div>
          {!mob && <div style={{ fontSize: 10, color: "#475569", borderLeft: "1px solid #334155", paddingLeft: 12 }}>
            {now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })} {"\u00B7"} {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </div>}
        </div>
        <div style={{ display: "flex", gap: mob ? 4 : 6 }}>
          {["overview", "filings", "news", "analytics", "calendar"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={pill(tab === t)}>{t === "filings" ? "SEC Filings" : t}</button>
          ))}
        </div>
      </div>

      {/* ALERT */}
      <div style={{ padding: `16px ${px}px 0` }}>
        <div style={alertBanner}>
          <span style={{ fontSize: 16 }}>{"\u26A0"}</span>
          <div><b>Active Watchlist:</b> {watchCount} of {PORTFOLIO.length} credits on internal watchlist. Portfolio spans EV, media, energy, consumer, industrial, and steel sectors.</div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : tablet ? "repeat(3, 1fr)" : "repeat(5, 1fr)", gap: mob ? 8 : 12, padding: `0 ${px}px 16px` }}>
        {[
          { l: "Total Exposure", v: fmt(totalExposure) },
          { l: "Credits Tracked", v: PORTFOLIO.length },
          { l: "Agency Rated", v: `${PORTFOLIO.filter(c => c.sp !== "NR").length} / ${PORTFOLIO.length}`, c: PORTFOLIO.filter(c => c.sp !== "NR").length === PORTFOLIO.length ? "#22c55e" : "#eab308" },
          { l: "Neg. / Developing Outlook", v: negOutlook, c: "#ef4444" },
          { l: "Negative FCF", v: `${negFcfCount} / ${PORTFOLIO.length}`, c: "#ef4444" },
        ].map((k, i) => (
          <div key={i} style={card}>
            <div style={{ ...kpiVal, color: k.c || "#f1f5f9" }}>{k.v}</div>
            <div style={kpiLabel}>{k.l}</div>
          </div>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          {mob ? (
            /* ─── MOBILE: Card layout ─── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {PORTFOLIO.map((c) => (
                <div key={c.id} onClick={() => { setSelected(c.id); setDetailTab("financials"); }} style={{ ...card, cursor: "pointer", padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{c.id}</span>
                      {getWatchlistStatus(c).active && <span style={{ color: "#ef4444", fontSize: 11, marginLeft: 6 }}>{"\u26A0"}</span>}
                      <div style={{ fontSize: 10, color: "#64748b" }}>{c.sector}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: ratingColor(c.impliedRating) }}>{c.impliedRating}</span>
                      <div style={{ fontSize: 9, color: "#475569" }}>implied</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 11, minWidth: 0 }}>
                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>Exposure</div>
                      <div style={{ fontWeight: 600 }}>{fmt(c.exposure)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>LTM Cash Flow</div>
                      <div style={{ fontWeight: 600, color: ltmAdjCashFlow(c) >= 0 ? "#22c55e" : "#ef4444" }}>{ltmAdjCashFlow(c) >= 0 ? "+" : ""}{fmt(ltmAdjCashFlow(c) * 1e6)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>Liquidity</div>
                      <div style={{ fontWeight: 600, color: "#22c55e" }}>{fmt(c.cash * 1e6)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>Outlook</div>
                      <div style={{ color: outlookColor(c.outlook) }}>{outlookIcon(c.outlook)} {c.outlook}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>Equity</div>
                      <div>{c.eqPrice != null ? `$${c.eqPrice}` : "Private"} {c.eqChg != null && <span style={{ color: c.eqChg >= 0 ? "#22c55e" : "#ef4444", fontSize: 10 }}>{pct(c.eqChg)}</span>}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, textTransform: "uppercase" }}>CDS 5Y</div>
                      <div>{c.cds5y != null ? c.cds5y : "\u2014"} {c.cds5yChg != null && <span style={{ color: c.cds5yChg <= 0 ? "#22c55e" : "#ef4444", fontSize: 10 }}>{bps(c.cds5yChg)}</span>}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginTop: 8, fontSize: 11, color: "#3b82f6" }}>View details {"\u2192"}</div>
                </div>
              ))}
            </div>
          ) : (
            /* ─── DESKTOP: Table layout ─── */
            <div style={{ ...card, padding: 0, overflow: "auto" }}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
              <thead>
                <tr>
                  {[["Company","16%"],["Exposure","10%"],["Implied Rtg","9%"],["Outlook","9%"],["CDS 5Y","10%"],["Spread","9%"],["LTM Cash Flow","9%"],["Liquidity","9%"],["Equity","9%"],["Rev","7%"],["","3%"]].map(([h,w],i) => (
                    <th key={i} style={{ width: w, padding: "10px 8px", fontSize: 10, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.5px", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PORTFOLIO.map((c) => (
                  <tr key={c.id} onClick={() => { setSelected(c.id); setDetailTab("financials"); }} style={{ cursor: "pointer", borderBottom: "1px solid #1e293b", transition: "background .1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.id} {getWatchlistStatus(c).active && <span style={{ color: "#ef4444", fontSize: 11 }}>{"\u26A0"}</span>}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{c.sector}</div>
                    </td>
                    <td style={{ padding: "10px 8px", fontWeight: 600, fontSize: 12 }}>{fmt(c.exposure)}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: ratingColor(c.impliedRating) }}>{c.impliedRating}</span>
                      <div style={{ fontSize: 9, color: "#475569" }}>implied</div>
                    </td>
                    <td style={{ padding: "10px 8px", fontSize: 12 }}>
                      <span style={{ color: outlookColor(c.outlook) }}>{outlookIcon(c.outlook)} {c.outlook}</span>
                    </td>
                    <td style={{ padding: "10px 8px", fontSize: 12 }}>
                      {c.cds5y != null ? c.cds5y : "\u2014"}{c.cds5yChg != null && <span style={{ color: c.cds5yChg <= 0 ? "#22c55e" : "#ef4444", marginLeft: 4, fontSize: 10 }}>{bps(c.cds5yChg)}</span>}
                    </td>
                    <td style={{ padding: "10px 8px", fontSize: 12 }}>
                      {c.bondSpread != null ? c.bondSpread : "\u2014"}{c.bondSpreadChg != null && <span style={{ color: c.bondSpreadChg <= 0 ? "#22c55e" : "#ef4444", marginLeft: 4, fontSize: 10 }}>{bps(c.bondSpreadChg)}</span>}
                    </td>
                    <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 600, color: ltmAdjCashFlow(c) >= 0 ? "#22c55e" : "#ef4444" }}>{ltmAdjCashFlow(c) >= 0 ? "+" : ""}{fmt(ltmAdjCashFlow(c) * 1e6)}</td>
                    <td style={{ padding: "10px 8px", fontSize: 12, color: "#22c55e", fontWeight: 600 }}>{fmt(c.cash * 1e6)}</td>
                    <td style={{ padding: "10px 8px", fontSize: 12 }}>
                      {c.eqPrice != null ? `$${c.eqPrice}` : "Private"}{c.eqChg != null && <span style={{ color: c.eqChg >= 0 ? "#22c55e" : "#ef4444", marginLeft: 4, fontSize: 10 }}>{pct(c.eqChg)}</span>}
                    </td>
                    <td style={{ padding: "10px 8px" }}><Sparkline data={[...c.financials].reverse().map((f) => f.rev)} color="#3b82f6" /></td>
                    <td style={{ padding: "10px 8px", fontSize: 11, color: "#3b82f6" }}>{"\u2192"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          )}
        </div>
      )}

      {tab === "filings" && (
        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: 8, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>SEC Filing Alerts (Last 30 Days)</div>
                <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Auto-monitored via EDGAR — 8-K, S-3, Form 4, 13D/G, 10-K, 10-Q</div>
              </div>
              <button onClick={fetchSecFilings} disabled={dataLoading.sec} style={{ padding: "6px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700, border: "1px solid #334155", background: dataLoading.sec ? "#1e293b" : "transparent", color: "#94a3b8", cursor: "pointer" }}>
                {dataLoading.sec ? "Loading..." : "\u21BB Refresh"}
              </button>
            </div>

            {/* Severity summary */}
            <div style={{ display: "flex", gap: mob ? 8 : 16, marginBottom: 16, flexWrap: "wrap" }}>
              {["critical", "material", "notable", "routine"].map(sev => {
                const count = secFilings.filter(f => f.severity === sev).length;
                return (
                  <div key={sev} style={{ padding: "6px 12px", background: "#0a0e1a", borderRadius: 4, borderLeft: `3px solid ${sevColor[sev]}` }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: sevColor[sev] }}>{count}</div>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{sev}</div>
                  </div>
                );
              })}
            </div>

            {dataError.sec && <div style={{ fontSize: 11, color: "#f97316", marginBottom: 8 }}>{"\u26A0"} API not available — showing sample data. Deploy to Vercel to enable live EDGAR feeds.</div>}

            {/* Filing list */}
            {(secFilings.length > 0 ? secFilings : [
              { ticker: "LCID", form: "8-K", date: "2026-03-15", label: "Material Event", severity: "material", desc: "Amendment to credit agreement — DDTL draw schedule modified", description: "Current Report" },
              { ticker: "RIVN", form: "4", date: "2026-03-14", label: "Insider Transaction", severity: "notable", desc: "CFO sold 15,000 shares at $14.20", description: "Statement of Changes" },
              { ticker: "SMC", form: "8-K", date: "2026-03-16", label: "Material Event", severity: "material", desc: "Q4 earnings release and $440M Permian Transmission Term Loan", description: "Current Report" },
              { ticker: "IHRT", form: "10-K", date: "2026-03-01", label: "Annual Report", severity: "routine", desc: "FY2025 annual filing — update models", description: "Annual Report" },
              { ticker: "WSC", form: "4", date: "2026-03-12", label: "Insider Transaction", severity: "notable", desc: "CEO acquired 10,000 shares at $33.50", description: "Statement of Changes" },
              { ticker: "CENT", form: "10-Q", date: "2026-02-05", label: "Quarterly Report", severity: "routine", desc: "Q1 FY2026 quarterly filing", description: "Quarterly Report" },
              { ticker: "UPBD", form: "8-K", date: "2026-03-10", label: "Material Event", severity: "material", desc: "Brigit fintech platform integration update", description: "Current Report" },
            ]).map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: mob ? "flex-start" : "center", gap: mob ? 8 : 12, padding: "10px 0", borderBottom: "1px solid #1e293b", flexWrap: mob ? "wrap" : "nowrap" }}>
                <div style={{ width: mob ? "auto" : 28, fontSize: 14, textAlign: "center", flexShrink: 0 }}>{sevIcon[f.severity]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "#3b82f6", fontWeight: 700, fontSize: 12, cursor: "pointer" }} onClick={() => { setSelected(f.ticker); setDetailTab("financials"); }}>{f.ticker}</span>
                    <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${sevColor[f.severity]}22`, color: sevColor[f.severity], border: `1px solid ${sevColor[f.severity]}44` }}>{f.form}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{f.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, lineHeight: 1.5 }}>{f.desc}</div>
                </div>
                <div style={{ fontSize: 10, color: "#64748b", flexShrink: 0 }}>{f.date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          {/* Portfolio Concentration */}
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16, minWidth: 0 }}>
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Sector Concentration</div>
              {peerBenchmarks.sectorConc.map((s, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: "#e2e8f0" }}>{s.sector}</span>
                    <span style={{ color: "#94a3b8" }}>{s.count} ({s.pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s.pct}%`, background: s.pct > 25 ? "#f97316" : "#3b82f6", borderRadius: 3 }} />
                  </div>
                </div>
              ))}
              {peerBenchmarks.sectorConc.some(s => s.pct > 30) && (
                <div style={{ marginTop: 8, padding: 8, background: "#431407", borderRadius: 4, fontSize: 10, color: "#fbbf24" }}>{"\u26A0"} Concentration risk: {peerBenchmarks.sectorConc.find(s => s.pct > 30)?.sector} exceeds 30% of portfolio</div>
              )}
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Rating Distribution</div>
              {peerBenchmarks.ratingConc.map((r, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: ratingColor(r.rating), fontWeight: 700 }}>{r.rating}</span>
                    <span style={{ color: "#94a3b8" }}>{r.count} ({r.pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${r.pct}%`, background: ratingColor(r.rating), borderRadius: 3, opacity: 0.7 }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: 8, background: "#0a0e1a", borderRadius: 4, fontSize: 10, color: "#94a3b8" }}>Watchlist rate: <span style={{ color: peerBenchmarks.watchlistPct > 50 ? "#ef4444" : "#eab308", fontWeight: 700 }}>{peerBenchmarks.watchlistPct.toFixed(0)}%</span> of portfolio</div>
            </div>
          </div>

          {/* Peer Comparison Table */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Peer Comparison Benchmarks</div>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                <thead>
                  <tr>
                    {["Company", "Leverage", "Int. Cov.", "Margin", "Curr. Ratio", "LTM CF", "Watchlist"].map((h, i) => (
                      <th key={i} style={{ padding: "8px 6px", fontSize: 10, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PORTFOLIO.map((c) => {
                    const lev = c.ebitda > 0 ? (c.totalDebt / c.ebitda) : null;
                    const margin = c.revenue > 0 ? (c.ebitda / c.revenue * 100) : null;
                    const cf = ltmAdjCashFlow(c);
                    const ws = getWatchlistStatus(c);
                    return (
                      <tr key={c.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }} onClick={() => { setSelected(c.id); setDetailTab("financials"); }}>
                        <td style={{ padding: "8px 6px", fontSize: 12, fontWeight: 700 }}>{c.id}</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: lev === null ? "#64748b" : lev > peerBenchmarks.medianLeverage * 1.5 ? "#ef4444" : "#e2e8f0" }}>{lev !== null ? `${lev.toFixed(1)}x` : "N/M"}</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: c.intCov < 2 ? "#ef4444" : "#e2e8f0" }}>{fmtNum(c.intCov)}x</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: margin !== null && margin < 0 ? "#ef4444" : "#e2e8f0" }}>{margin !== null ? `${margin.toFixed(1)}%` : "N/M"}</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: c.currentRatio < 1 ? "#ef4444" : "#e2e8f0" }}>{fmtNum(c.currentRatio)}x</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: cf >= 0 ? "#22c55e" : "#ef4444" }}>{cf >= 0 ? "+" : ""}{fmt(cf * 1e6)}</td>
                        <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right" }}>{ws.active ? <span style={{ color: "#ef4444" }}>{"\u26A0"}</span> : <span style={{ color: "#22c55e" }}>{"\u2713"}</span>}</td>
                      </tr>
                    );
                  })}
                  {/* Median row */}
                  <tr style={{ borderTop: "2px solid #334155", background: "#0a0e1a" }}>
                    <td style={{ padding: "8px 6px", fontSize: 11, fontWeight: 800, color: "#3b82f6" }}>MEDIAN</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#3b82f6" }}>{peerBenchmarks.medianLeverage.toFixed(1)}x</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#3b82f6" }}>{peerBenchmarks.medianIntCov.toFixed(1)}x</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#3b82f6" }}>{peerBenchmarks.medianMargin.toFixed(1)}%</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#3b82f6" }}>{peerBenchmarks.medianCurrentRatio.toFixed(1)}x</td>
                    <td colSpan={2} style={{ padding: "8px 6px", fontSize: 9, textAlign: "right", color: "#64748b" }}>portfolio median</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Market Data */}
          {Object.keys(marketData).length > 0 && (
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Live Equity Prices</div>
                <button onClick={fetchMarketData} disabled={dataLoading.market} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 9, fontWeight: 600, border: "1px solid #334155", background: "transparent", color: "#64748b", cursor: "pointer" }}>
                  {dataLoading.market ? "..." : "\u21BB"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, minWidth: 0 }}>
                {Object.entries(marketData).map(([ticker, q]) => (
                  <div key={ticker} style={{ padding: "10px 12px", background: "#0a0e1a", borderRadius: 6, cursor: "pointer" }} onClick={() => { setSelected(ticker); setDetailTab("financials"); }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{ticker}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9", marginTop: 2 }}>${q.price}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: q.changePct >= 0 ? "#22c55e" : "#ef4444", marginTop: 2 }}>
                      {q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
              {dataError.market && <div style={{ fontSize: 10, color: "#f97316", marginTop: 8 }}>{"\u26A0"} Market data unavailable — deploy to Vercel for live prices</div>}
            </div>
          )}
        </div>
      )}

      {tab === "news" && (
        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Portfolio News Feed</div>
            {allNews.map((n, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: i < allNews.length - 1 ? "1px solid #1e293b" : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: sentimentColor(n.sentiment), marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{n.headline}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                    <span style={{ color: "#3b82f6", fontWeight: 600, cursor: "pointer" }} onClick={() => { setSelected(n.ticker); setDetailTab("news"); }}>{n.ticker}</span>
                    {" \u00B7 "}{n.src} {"\u00B7"} {n.date}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: sentimentColor(n.sentiment), letterSpacing: "0.5px", flexShrink: 0 }}>{n.sentiment}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "calendar" && (
        <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>Upcoming Earnings Calendar</div>
            {[...PORTFOLIO].filter(c => c.earningsDate).sort((a, b) => a.earningsDate.localeCompare(b.earningsDate)).map((c, i) => {
              const days = Math.ceil((new Date(c.earningsDate) - now) / (1000 * 60 * 60 * 24));
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: i < PORTFOLIO.length - 1 ? "1px solid #1e293b" : "none", cursor: "pointer" }}
                  onClick={() => { setSelected(c.id); setDetailTab("earnings"); }}>
                  <div style={{ width: 52, textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: days <= 14 ? "#f97316" : "#3b82f6" }}>{days}</div>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>days</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div><span style={{ fontWeight: 700, fontSize: 14 }}>{c.id}</span> <span style={{ color: "#64748b", fontSize: 12 }}>{c.name}</span></div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{c.earningsDate} {"\u00B7"} {c.earningsTime}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Last result</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: c.lastEarnings.startsWith("Beat") ? "#22c55e" : "#ef4444" }}>{c.lastEarnings.split("\u2014")[0]}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#3b82f6" }}>{"\u2192"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
