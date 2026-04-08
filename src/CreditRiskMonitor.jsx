import { useState, useEffect, useMemo, useCallback, useRef, Component } from "react";
import { PORTFOLIO, CREDIT_AGREEMENTS } from "./portfolioData.js";

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

// ─── UTILITIES ──────────────────────────────────────────────────────────────
const _loc = (v, d) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (n, d = 0) => {
if (n === null || n === undefined) return "\u2014";
const a = Math.abs(n);
if (a >= 1e9) return `$${_loc(n / 1e9, 1)}B`;
if (a >= 1e6) return `$${_loc(n / 1e6, d)}M`;
if (a >= 1e3) return `$${_loc(n / 1e3, d)}K`;
return `$${_loc(n, d)}`;
};
const fmtNum = (n, d = 1) => (n === null || n === undefined ? "\u2014" : _loc(n, d));
// fmtM: values already denominated in $M (as stored in portfolioData facilities / credit agreements).
// Adds thousands separators to $M values and rolls up to $X.XB once the $M value reaches 1,000.
const fmtM = (n) => {
  if (n === null || n === undefined) return "\u2014";
  const r = Math.round(n);
  if (Math.abs(r) >= 1000) return `$${_loc(r / 1000, 1)}B`;
  return `$${r.toLocaleString()}M`;
};
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

const isPubliclyRated = (c) => c.sp !== "NR" || c.moodys !== "NR" || c.fitch !== "NR";

const sentimentColor = (s) => {
if (s === "positive") return "#22c55e";
if (s === "negative") return "#ef4444";
return "#94a3b8";
};

// Compute LTM Adjusted Cash Flow from adjBurn object
const ltmAdjCashFlow = (c) => {
if (!c.adjBurn) return c.fcf || 0;
const ab = c.adjBurn;
const capex = ab.maintCapex != null ? ab.maintCapex : (ab.totalCapex || 0);
const result = (ab.adjEBITDA || 0) - (ab.incomeTaxes || 0) - (ab.prefDividends || 0) - capex - (ab.currentLTD || 0) - (ab.intExpCash || 0);
return isFinite(result) ? result : (c.fcf || 0);
};

// ─── SKELETON LOADER ────────────────────────────────────────────────────────
const Skeleton = ({ w = "100%", h = 16, r = 4 }) => (
<div className="skeleton" style={{ width: w, height: h, borderRadius: r }} />
);

// ─── SPARKLINE ──────────────────────────────────────────────────────────────
const Sparkline = ({ data, color = "#60a5fa", w = 80, h = 24, label }) => {
if (!data || data.length < 2) return null;
const mn = Math.min(...data);
const mx = Math.max(...data);
const range = mx - mn || 1;
const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(" ");
const latest = data[data.length - 1];
const first = data[0];
const trendPct = ((latest - first) / Math.abs(first || 1) * 100).toFixed(0);
return (
<svg width={w} height={h} style={{ display: "block" }} aria-label={label ? `${label}: ${trendPct > 0 ? "+" : ""}${trendPct}% trend` : undefined} role="img">
{label && <title>{label}: {trendPct > 0 ? "+" : ""}{trendPct}% trend</title>}
<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
<circle cx={w} cy={h - ((latest - mn) / range) * h} r="2" fill={color} />
</svg>
);
};

// ─── BAR CHART ──────────────────────────────────────────────────────────────
const MiniBar = ({ data, labels, color = "#60a5fa", w = 200, h = 80, ariaLabel }) => {
if (!data || data.length === 0) return null;
const mx = Math.max(...data.map(Math.abs));
const barW = w / data.length - 4;
const zeroY = h * 0.5;
return (
<svg width={w} height={h + 18} style={{ display: "block" }} role="img" aria-label={ariaLabel || "Bar chart"}>
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
const [searchQuery, setSearchQuery] = useState("");
const [sortCol, setSortCol] = useState(null);
const [sortDir, setSortDir] = useState("asc");
const [dbPortfolio, setDbPortfolio] = useState(null);
const [portfolioSource, setPortfolioSource] = useState("static");
const [expandedNews, setExpandedNews] = useState({});
// Ad-hoc lookup state. Persisted to localStorage with a 24-hour TTL so a
// page reload after `lookupTicker("MSFT")` re-shows the same generated
// dashboard instead of dropping the user back into the static portfolio.
const AD_HOC_STORAGE_KEY = "crm.adHocCompany.v1";
const AD_HOC_TTL_MS = 24 * 60 * 60 * 1000;
const [adHocCompany, setAdHocCompany] = useState(() => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AD_HOC_STORAGE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    if (!data || !savedAt) return null;
    if (Date.now() - savedAt > AD_HOC_TTL_MS) {
      window.localStorage.removeItem(AD_HOC_STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
});
const [adHocLoading, setAdHocLoading] = useState(false); // "static" | "api" | "error"

// ─── NAVIGATION HISTORY ───────────────────────────────────────────────
const [navHistory, setNavHistory] = useState([{ selected: null, tab: "overview", detailTab: "financials" }]);
const [navPos, setNavPos] = useState(0);
const isNavigating = useRef(false); // prevent popstate feedback loops

const navigate = useCallback((newSelected, newTab, newDetailTab) => {
const entry = { selected: newSelected, tab: newTab || (newSelected ? tab : "overview"), detailTab: newDetailTab || "financials" };
setSelected(entry.selected);
setTab(entry.tab);
setDetailTab(entry.detailTab);
setNavHistory(prev => {
const trimmed = prev.slice(0, navPos + 1);
return [...trimmed, entry];
});
setNavPos(prev => prev + 1);
// Push to browser history so phone back button works
try {
if (!isNavigating.current) {
window.history.pushState(entry, "", newSelected ? `#${newSelected}` : "#");
}
} catch(e) {}
}, [tab, navPos]);

const canGoBack = navPos > 0;
const canGoForward = navPos < navHistory.length - 1;

const goBack = useCallback(() => {
if (!canGoBack) return;
const newPos = navPos - 1;
const entry = navHistory[newPos];
isNavigating.current = true;
setNavPos(newPos);
setSelected(entry.selected);
setTab(entry.tab);
setDetailTab(entry.detailTab);
try { window.history.back(); } catch(e) {}
setTimeout(() => { isNavigating.current = false; }, 100);
}, [navPos, navHistory, canGoBack]);

const goForward = useCallback(() => {
if (!canGoForward) return;
const newPos = navPos + 1;
const entry = navHistory[newPos];
isNavigating.current = true;
setNavPos(newPos);
setSelected(entry.selected);
setTab(entry.tab);
setDetailTab(entry.detailTab);
try { window.history.forward(); } catch(e) {}
setTimeout(() => { isNavigating.current = false; }, 100);
}, [navPos, navHistory, canGoForward]);

// Listen for browser back/forward buttons
useEffect(() => {
const onPopState = (e) => {
if (isNavigating.current) return;
if (e.state) {
setSelected(e.state.selected);
setTab(e.state.tab || "overview");
setDetailTab(e.state.detailTab || "financials");
// Find matching position in our history
setNavPos(prev => Math.max(0, prev - 1));
} else {
setSelected(null);
setTab("overview");
setNavPos(prev => Math.max(0, prev - 1));
}
};
window.addEventListener("popstate", onPopState);
return () => window.removeEventListener("popstate", onPopState);
}, []);

// ─── LIVE DATA STATE ──────────────────────────────────────────────────
const [secFilings, setSecFilings] = useState([]);
const [liveNews, setLiveNews] = useState([]);
const [marketData, setMarketData] = useState({});
const [dataLoading, setDataLoading] = useState({ sec: false, news: false, market: false, portfolio: false });
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

const fetchPortfolio = useCallback(async () => {
  setDataLoading(prev => ({ ...prev, portfolio: true }));
  try {
    const resp = await fetch("/api/portfolio?all=true");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.portfolio && Object.keys(data.portfolio).length > 0) {
      setDbPortfolio(data.portfolio);
      setPortfolioSource("api");
    }
  } catch (e) {
    console.warn("Portfolio API unavailable, using static data:", e.message);
    setPortfolioSource("error");
  }
  setDataLoading(prev => ({ ...prev, portfolio: false }));
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
fetchPortfolio();
fetchSecFilings();
fetchLiveNews();
fetchMarketData();
setLastRefresh(new Date());
}, [fetchPortfolio, fetchSecFilings, fetchLiveNews, fetchMarketData]);

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

// ─── NORMALIZE DB DATA TO MATCH STATIC SHAPE ────────────────────────
// The credit_data_fetcher returns snake_case keys with SourcedValue wrappers
// and raw dollar amounts. This maps them to the camelCase primitives in $M
// that the UI expects.
const normalizeDbEntry = (db) => {
  if (!db) return null;
  const sv = (key) => { const v = db[key]; return v && typeof v === "object" && "value" in v ? v.value : v; };
  const toM = (val) => val != null ? +(val / 1e6).toFixed(0) : null;
  const kf = db.key_financials || db;
  const bs = db.balance_sheet || db;
  const mapped = {};
  // Map fetcher fields → static field names (snake_case → camelCase, raw$ → $M)
  const pairs = [
    ["revenue", () => toM(sv("gaap_revenue") ?? sv("revenue"))],
    ["ebitda", () => toM(sv("adj_ebitda") ?? sv("ebitda_gaap"))],
    ["netIncome", () => toM(sv("gaap_net_income") ?? sv("net_income"))],
    ["totalDebt", () => toM(sv("total_debt"))],
    ["cash", () => toM(sv("cash_and_equivalents"))],
    ["totalAssets", () => toM(sv("total_assets"))],
    ["totalEquity", () => toM(sv("stockholders_equity"))],
    ["fcf", () => toM(sv("free_cash_flow"))],
    ["intExp", () => toM(sv("cash_interest_paid") ?? sv("interest_expense"))],
  ];
  for (const [key, getter] of pairs) {
    const val = getter();
    if (val != null) mapped[key] = val;
  }
  return Object.keys(mapped).length > 0 ? mapped : null;
};

// ─── APPLY LIVE MARKET DATA TO PORTFOLIO ─────────────────────────────
// Overlay live equity prices from API onto portfolio entries so all views
// (KPIs, detail headers, tables) reflect current market data.
const basePortfolio = useMemo(() => {
  if (!dbPortfolio) return PORTFOLIO;
  return PORTFOLIO.map((staticEntry) => {
    const dbEntry = dbPortfolio[staticEntry.id];
    if (!dbEntry) return staticEntry;
    // Normalize DB shape → static shape, then overlay only non-null values
    const normalized = normalizeDbEntry(dbEntry);
    if (!normalized) return staticEntry;
    return { ...staticEntry, ...normalized, _dbSource: true };
  });
}, [dbPortfolio]);

const enrichedPortfolio = useMemo(() => {
  if (Object.keys(marketData).length === 0) return basePortfolio;
  return basePortfolio.map((c) => {
    const quote = marketData[c.id];
    if (!quote || quote.error) return c;
    return {
      ...c,
      eqPrice: quote.price ?? c.eqPrice,
      eqChg: quote.changePct ?? c.eqChg,
      mktCap: quote.marketCap ? +(quote.marketCap / 1e9).toFixed(2) : c.mktCap,
      _liveEquity: true,
    };
  });
}, [basePortfolio, marketData]);

// ─── SEARCH & SORT ──────────────────────────────────────────────────
const filteredPortfolio = useMemo(() => {
  let list = enrichedPortfolio;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter(c => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.sector.toLowerCase().includes(q) || (c.sp !== "NR" && c.sp.toLowerCase().includes(q)) || (c.impliedRating || "").toLowerCase().includes(q));
  }
  if (sortCol) {
    const getSortVal = (c) => {
      switch (sortCol) {
        case "company": return c.id;
        case "pm": return c.pm || "";
        case "rating": return isPubliclyRated(c) ? ratingScore(c.sp) : ratingScore(c.impliedRating);
        case "outlook": return c.outlook;
        case "cds": return c.cds5y ?? 99999;
        case "spread": return c.bondSpread ?? 99999;
        case "cashflow": return ltmAdjCashFlow(c);
        case "liquidity": return c.cash;
        case "equity": return c.eqPrice ?? -99999;
        case "rev": return c.revenue;
        default: return 0;
      }
    };
    list = [...list].sort((a, b) => {
      const va = getSortVal(a), vb = getSortVal(b);
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }
  return list;
}, [enrichedPortfolio, searchQuery, sortCol, sortDir]);

const handleSort = useCallback((col) => {
  if (sortCol === col) {
    setSortDir(d => d === "asc" ? "desc" : "asc");
  } else {
    setSortCol(col);
    setSortDir("asc");
  }
}, [sortCol]);

const negFcfCount = enrichedPortfolio.filter((c) => c.fcf < 0).length;
const watchCount = enrichedPortfolio.filter((c) => getWatchlistStatus(c).active).length;
const negOutlook = enrichedPortfolio.filter((c) => c.outlook === "Negative" || c.outlook === "Developing").length;

// ─── MERGE LIVE + STATIC NEWS ────────────────────────────────────────
// Use live API news when available, fall back to hardcoded portfolio news.
const allNews = useMemo(() => {
  if (liveNews.length > 0) {
    // Merge live news (from API) with static news, dedup by headline prefix
    const seen = new Set();
    const merged = [];
    for (const n of liveNews) {
      const key = (n.headline || "").slice(0, 50).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({ ...n, src: n.source || n.src, _live: true });
      }
    }
    // Add static news not already covered
    for (const c of enrichedPortfolio) {
      for (const n of c.news) {
        const key = (n.headline || "").slice(0, 50).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ ...n, ticker: c.id, company: c.name });
        }
      }
    }
    return merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return enrichedPortfolio.flatMap((c) => c.news.map((n) => ({ ...n, ticker: c.id, company: c.name }))).sort((a, b) => b.date.localeCompare(a.date));
}, [liveNews, enrichedPortfolio]);

// ─── AD-HOC TICKER LOOKUP ────────────────────────────────────────────
const lookupTicker = useCallback(async (ticker) => {
  ticker = ticker.toUpperCase().trim();
  if (!ticker || ticker.length > 10) return;

  // Check if already in portfolio
  const existing = enrichedPortfolio.find(c => c.id === ticker);
  if (existing) {
    navigate(ticker, tab, "financials");
    return;
  }

  setAdHocLoading(true);
  try {
    const resp = await fetch(`/api/company?ticker=${ticker}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const company = await resp.json();
    // Also fetch news for this ticker
    try {
      const newsResp = await fetch(`/api/news?ticker=${ticker}&max=6`);
      const newsData = await newsResp.json();
      if (newsData.news) company.news = newsData.news;
    } catch(e) { /* news fetch is non-critical */ }
    setAdHocCompany(company);
    // Persist to localStorage so page reloads survive (TTL: 24h)
    try {
      window.localStorage.setItem(
        AD_HOC_STORAGE_KEY,
        JSON.stringify({ data: company, savedAt: Date.now() })
      );
    } catch { /* localStorage may be unavailable in private mode */ }
    navigate(ticker, tab, "financials");
  } catch (e) {
    setDataError(prev => ({ ...prev, lookup: e.message }));
  }
  setAdHocLoading(false);
}, [enrichedPortfolio, navigate, tab]);

// ─── DETAIL LOOKUP (portfolio + ad-hoc) ────────────────────────────────
const rawDetail = selected ? (enrichedPortfolio.find((c) => c.id === selected) || adHocCompany) : null;
// Normalize: default all required fields so generated/partial objects render safely
const detail = useMemo(() => {
  if (!rawDetail) return null;
  return {
    ...rawDetail,
    news: rawDetail.news || [],
    financials: rawDetail.financials || [],
    ratingHistory: rawDetail.ratingHistory || [{ date: "N/A", sp: "NR", moodys: "NR", fitch: "NR", event: "No rating history available" }],
    research: rawDetail.research || [{ date: "", firm: "N/A", action: "N/A", pt: 0, summary: "No analyst coverage data available" }],
    lastEarnings: rawDetail.lastEarnings || "",
    impliedRating: rawDetail.impliedRating || "NR",
    outlook: rawDetail.outlook || "Stable",
    sp: rawDetail.sp || "NR",
    moodys: rawDetail.moodys || "NR",
    fitch: rawDetail.fitch || "NR",
    liquidityRunway: rawDetail.liquidityRunway || "N/A",
    analystRating: rawDetail.analystRating || "N/A",
    targetPrice: rawDetail.targetPrice || 0,
    cash: rawDetail.cash ?? 0,
    totalDebt: rawDetail.totalDebt ?? 0,
    ebitda: rawDetail.ebitda ?? 0,
    revenue: rawDetail.revenue ?? 0,
    fcf: rawDetail.fcf ?? 0,
    netIncome: rawDetail.netIncome ?? 0,
    intExp: rawDetail.intExp ?? 0,
    totalAssets: rawDetail.totalAssets ?? 0,
    totalEquity: rawDetail.totalEquity ?? 0,
    intCov: rawDetail.intCov ?? 0,
    currentRatio: rawDetail.currentRatio ?? 0,
    debtToEquity: rawDetail.debtToEquity ?? 0,
    roic: rawDetail.roic ?? 0,
    cashBurnQtr: rawDetail.cashBurnQtr ?? 0,
    currentAssets: rawDetail.currentAssets ?? 0,
    currentLiab: rawDetail.currentLiab ?? 0,
  };
}, [rawDetail]);

// ─── STYLES ─────────────────────────────────────────────────────────────
const root = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#060a14", color: "#e2e8f0", minHeight: "100vh", fontSize: mob ? 13 : 14, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale", maxWidth: "100vw", overflowX: "clip", wordWrap: "break-word", overflowWrap: "break-word" };
const headerBar = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: mob ? "12px 16px" : "14px 28px", borderBottom: "1px solid rgba(148,163,184,0.08)", background: "rgba(15,22,41,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", flexWrap: mob ? "wrap" : "nowrap", gap: mob ? 10 : 0, position: "sticky", top: 0, zIndex: 50 };
const pill = (active) => ({ padding: mob ? "8px 14px" : "7px 18px", borderRadius: 6, fontSize: mob ? 11 : 11, fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer", border: active ? "1px solid rgba(59,130,246,0.5)" : "1px solid transparent", background: active ? "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)" : "transparent", color: active ? "#fff" : "#94a3b8", transition: "all .2s ease", whiteSpace: "nowrap", textTransform: "capitalize" });
const card = { background: "rgba(17,24,39,0.6)", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 10, padding: mob ? 14 : 18, overflow: "hidden", minWidth: 0, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" };
const kpiVal = { fontSize: mob ? 20 : 24, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2, fontFamily: "'JetBrains Mono', monospace" };
const kpiLabel = { fontSize: mob ? 9 : 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginTop: 6, fontFamily: "'Inter', sans-serif" };
const alertBanner = { background: "linear-gradient(135deg, rgba(127,29,29,0.6) 0%, rgba(153,27,27,0.4) 100%)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: mob ? "10px 14px" : "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, fontSize: mob ? 11 : 12, color: "#fca5a5", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" };
const sectionGrid = mob ? "1fr" : "1fr 1fr";

// ─── RENDER: DETAIL VIEW ──────────────────────────────────────────────────
if (detail) {
return (
<div style={{ ...root, animation: "fadeIn 0.25s ease forwards" }}>
<div style={headerBar}>
<div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 10, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
<div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
<button onClick={goBack} disabled={!canGoBack} style={{ ...pill(false), border: "1px solid rgba(148,163,184,0.15)", opacity: canGoBack ? 1 : 0.3, cursor: canGoBack ? "pointer" : "default", padding: mob ? "6px 10px" : "7px 12px", borderRadius: 6 }}>{"\u2190"}</button>
<button onClick={goForward} disabled={!canGoForward} style={{ ...pill(false), border: "1px solid rgba(148,163,184,0.15)", opacity: canGoForward ? 1 : 0.3, cursor: canGoForward ? "pointer" : "default", padding: mob ? "6px 10px" : "7px 12px", borderRadius: 6 }}>{"\u2192"}</button>
</div>
<button onClick={() => navigate(null, "overview", "financials")} style={{ ...pill(false), border: "1px solid rgba(148,163,184,0.15)", flexShrink: 0, borderRadius: 6 }}>Portfolio</button>
<div style={{ minWidth: 0, overflow: "hidden", display: "flex", alignItems: "baseline", gap: 8 }}>
<span style={{ fontSize: mob ? 16 : 19, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.3px" }}>{detail.id}</span>
<span style={{ fontSize: mob ? 11 : 13, color: "#64748b", fontWeight: 500 }}>{mob ? "" : detail.name}</span>
</div>
{getWatchlistStatus(detail).active && <span style={{ background: "rgba(127,29,29,0.5)", color: "#fca5a5", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(220,38,38,0.2)" }}>{"\u26A0"} WATCHLIST</span>}
{!getWatchlistStatus(detail).active && <span style={{ background: "rgba(5,46,22,0.5)", color: "#86efac", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(34,197,94,0.2)" }}>{"\u2713"} ACTIVE</span>}
{isPubliclyRated(detail) ? <span style={{ background: "rgba(234,179,8,0.15)", color: "#fcd34d", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(234,179,8,0.2)" }}>RATED</span> : <span style={{ background: "rgba(100,116,139,0.15)", color: "#94a3b8", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(100,116,139,0.2)" }}>NOT RATED</span>}
{detail._generated && <span style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(59,130,246,0.2)" }}>API Generated {detail._zScore ? `\u00B7 Z=${detail._zScore}` : ""}</span>}
{detail.pm && <span style={{ background: "rgba(30,41,59,0.6)", color: "#cbd5e1", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, border: "1px solid rgba(148,163,184,0.18)" }}>PM {detail.pm}</span>}
</div>
<div style={{ position: "relative", width: mob ? "100%" : "auto", marginTop: mob ? 2 : 0 }}>
{mob && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 24, background: "linear-gradient(to right, transparent, rgba(15,22,41,0.85))", zIndex: 1, pointerEvents: "none" }} />}
<div style={{ display: "flex", gap: mob ? 4 : 6, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: mob ? 2 : 0, scrollbarWidth: "none" }}>
{["financials", "ratings", "filings", "news", "research", "earnings"].map((t) => (
<button key={t} onClick={() => setDetailTab(t)} style={pill(detailTab === t)}>{t === "filings" ? "SEC" : t}</button>
))}
</div>
</div>
</div>

    {/* KPI strip */}
    <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : tablet ? "repeat(4, 1fr)" : "repeat(8, 1fr)", gap: mob ? 8 : 12, padding: `16px ${px}px` }}>
      {[
        { l: isPubliclyRated(detail) ? "Agency Rating" : "Implied Rating", v: isPubliclyRated(detail) ? `${detail.sp}${detail.moodys !== "NR" ? ` / ${detail.moodys}` : ""}` : (detail.impliedRating || "N/A"), c: isPubliclyRated(detail) ? ratingColor(detail.sp) : ratingColor(detail.impliedRating) },
        { l: isPubliclyRated(detail) ? "Implied Rating" : "Agency Rating", v: isPubliclyRated(detail) ? (detail.impliedRating || "N/A") : "Not Rated", c: isPubliclyRated(detail) ? ratingColor(detail.impliedRating) : "#64748b" },
        { l: "Outlook", v: detail.outlook ? `${outlookIcon(detail.outlook)} ${detail.outlook}` : "N/A", c: outlookColor(detail.outlook) },
        { l: "CDS 5Y", v: detail.cds5y != null ? `${detail.cds5y} bps` : "N/A", sub: detail.cds5yChg != null ? `${bps(detail.cds5yChg)} bps` : "", c: detail.cds5yChg != null ? (detail.cds5yChg <= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
        { l: "Bond Spread", v: detail.bondSpread != null ? `${detail.bondSpread} bps` : "N/A", sub: detail.bondSpreadChg != null ? `${bps(detail.bondSpreadChg)} bps` : "", c: detail.bondSpreadChg != null ? (detail.bondSpreadChg <= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
        { l: "Equity", v: detail.eqPrice != null ? `$${detail.eqPrice}` : "Private", sub: detail.eqChg != null ? pct(detail.eqChg) : "", c: detail.eqChg != null ? (detail.eqChg >= 0 ? "#22c55e" : "#ef4444") : "#64748b" },
        { l: detail.fcf != null && detail.fcf > 0 ? "Adj. Cash Flow / Qtr" : "Cash Burn / Qtr", v: detail.cashBurnQtr != null ? (detail.fcf != null && detail.fcf > 0 ? `+${fmt(Math.abs(detail.cashBurnQtr) * 1e6)}` : fmt(detail.cashBurnQtr * 1e6)) : "N/A", c: detail.fcf != null && detail.fcf > 0 ? "#22c55e" : detail.cashBurnQtr != null ? "#ef4444" : "#64748b" },
        { l: "Current Ratio", v: detail.currentRatio != null ? `${fmtNum(detail.currentRatio)}x` : "N/A", c: detail.currentRatio != null ? (detail.currentRatio >= 1.5 ? "#22c55e" : detail.currentRatio >= 1 ? "#eab308" : "#ef4444") : "#64748b" },
      ].map((k, i) => (
        <div key={i} style={{ ...card, position: "relative", overflow: "hidden", animation: "fadeIn 0.3s ease forwards", animationDelay: `${i * 30}ms`, opacity: 0 }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: k.c || "#3b82f6", opacity: 0.5 }} />
          <div style={{ ...kpiVal, fontSize: mob ? 15 : 17, color: k.c || "#f1f5f9", marginTop: 4 }}>{k.v}</div>
          {k.sub && <div style={{ fontSize: 11, color: k.c, marginTop: 2, fontWeight: 600 }}>{k.sub}</div>}
          <div style={kpiLabel}>{k.l}</div>
        </div>
      ))}
    </div>

    <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
      <ErrorBoundary>
      {detailTab === "financials" && (() => {
        // ─── LTM ADJUSTED CASH FLOW COMPUTATION ─────────────────────
        // Signed value preserves direction (positive = cash generator, negative = burner);
        // ltmAdjBurn carries the magnitude used by downstream coverage math.
        const ab = detail.adjBurn;
        const capexUsed = ab ? (ab.maintCapex !== null ? ab.maintCapex : ab.totalCapex) : 0;
        const ltmCashFlow = ab
          ? (ab.adjEBITDA - ab.incomeTaxes - ab.prefDividends - capexUsed - ab.currentLTD - ab.intExpCash)
          : (detail.fcf || 0);
        const ltmAdjBurn = Math.abs(ltmCashFlow);
        const isNetCashGenerator = ltmCashFlow > 0;
        const ltmBurnMonthly = ltmAdjBurn / 12;
        const ltmBurnQtr = ltmAdjBurn / 4;

        // ─── COVERAGE METRICS ───────────────────────────────────────
        const totalLiq = detail.liquidityBreakdown ? detail.liquidityBreakdown.totalLiquidity : detail.cash;
        const ltmCovMonths = isNetCashGenerator ? 999 : (ltmBurnMonthly > 0 ? totalLiq / ltmBurnMonthly : 999);
        const meets18mo = ltmCovMonths >= 18;
        const qBurn = ltmBurnQtr;
        const annBurn = ltmAdjBurn;          // magnitude (unsigned) — existing callers
        const annCashFlow = ltmCashFlow;     // signed — used by scenario block
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
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#64748b" }}>
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
                        {fmtM(item.v)}
                      </div>
                      <div style={{ height: h, background: color, borderRadius: "3px 3px 0 0", opacity: 0.8, margin: "0 4px" }} />
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              {["Opening\nCash", "Revenue", "OpEx &\nCOGS", "CapEx &\nOther", "Debt\nProceeds", "Ending\nCash"].map((l, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "#64748b", lineHeight: 1.3, whiteSpace: "pre-line" }}>{l}</div>
              ))}
            </div>
          </div>

          {/* ═══ EBITDA RECONCILIATION: GAAP → ADJUSTED ═══ */}
          {detail.adjBurn && (() => {
            const ab = detail.adjBurn;
            // Prefer the granular bottom-up walk built by api/company.py from individual
            // SEC XBRL concepts. Falls back to the legacy 3-bucket view when the backend
            // didn't provide a walk (older cached responses or static portfolioData entries).
            const walk = Array.isArray(ab.reconciliationWalk) ? ab.reconciliationWalk : null;
            const reconSource = ab.reconciliationSource || null;

            const colorForCategory = (cat, amount, isSubtotal) => {
              if (isSubtotal) return amount >= 0 ? "#22c55e" : "#ef4444";
              switch (cat) {
                case "starting":     return "#60a5fa";
                case "tax":          return "#fbbf24";
                case "interest":     return "#f59e0b";
                case "da":           return "#38bdf8";
                case "sbc":          return "#a78bfa";
                case "restructuring":return "#f97316";
                case "impairment":   return "#ef4444";
                case "acquisition":  return "#ec4899";
                case "disposal":     return "#14b8a6";
                case "other_nonop":  return "#94a3b8";
                default:             return "#94a3b8";
              }
            };

            let reconItems;
            let totalAdj;
            let gaapEbitda;
            let noReconDisclosed = false;

            if (walk && walk.length > 0) {
              // Granular path — render the full bridge straight from SEC XBRL.
              reconItems = walk.map(w => ({
                label: w.label,
                amount: w.amount,
                isSubtotal: !!w.isSubtotal,
                color: colorForCategory(w.category, w.amount, w.isSubtotal),
                source: w.source || null,
                category: w.category,
              }));
              const gaapItem = walk.find(w => w.category === "subtotal");
              gaapEbitda = gaapItem ? gaapItem.amount : (ab.gaapEbitda ?? 0);
              totalAdj = (ab.adjEBITDA ?? 0) - gaapEbitda;
            } else {
              // Legacy fallback (no walk available)
              const sbc           = ab.sbc ?? 0;
              const restructuring = ab.restructuring ?? 0;
              const otherNonCash  = ab.otherNonCash ?? 0;
              totalAdj            = sbc + restructuring + otherNonCash;
              gaapEbitda          = ab.gaapEbitda != null ? ab.gaapEbitda : (ab.adjEBITDA - totalAdj);
              noReconDisclosed    = ab.gaapEbitda == null && totalAdj === 0;
              reconItems = [
                { label: "GAAP EBITDA", amount: gaapEbitda, isSubtotal: true, color: "#60a5fa" },
                ...(sbc ? [{ label: "Stock-Based Compensation", amount: sbc, color: "#a78bfa" }] : []),
                ...(restructuring ? [{ label: "Restructuring & Impairments", amount: restructuring, color: "#f97316" }] : []),
                ...(otherNonCash ? [{ label: "Other Non-Cash Items", amount: otherNonCash, color: otherNonCash >= 0 ? "#94a3b8" : "#64748b" }] : []),
                { label: "Adjusted EBITDA", amount: ab.adjEBITDA, isSubtotal: true, color: ab.adjEBITDA >= 0 ? "#22c55e" : "#ef4444" },
              ];
            }
            const maxRecon = Math.max(...reconItems.map(r => Math.abs(r.amount)), 1);

            return (
            <div style={{ ...card, gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px" }}>
                  EBITDA Reconciliation {"\u2014"} GAAP to Adjusted
                </div>
                <div style={{ fontSize: 9, color: "#64748b", textAlign: "right" }}>
                  Total Adjustments: <span style={{ color: totalAdj >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{totalAdj >= 0 ? "+" : ""}{fmtM(totalAdj).replace("$", "")}</span>
                </div>
              </div>
              <div style={{ fontSize: mob ? 9 : 10, color: "#64748b", marginBottom: 16 }}>
                {noReconDisclosed
                  ? "Issuer's 10-K does not separately disclose a GAAP-to-Adjusted EBITDA walk; reported figure is shown as both GAAP and Adjusted."
                  : walk
                    ? "Bottom-up bridge built from individual us-gaap XBRL concepts pulled live from SEC EDGAR companyfacts. Hover any line for the exact concept and 10-K period."
                    : "Reconciles reported GAAP EBITDA to company-reported Non-GAAP Adjusted EBITDA by adding back non-cash and non-recurring items."}
              </div>
              {reconSource && (
                <div style={{ fontSize: 9, color: "#475569", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>
                  Source: {reconSource.provider}
                  {reconSource.endpoint && <> — <a href={reconSource.endpoint} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>{reconSource.endpoint}</a></>}
                  {reconSource.fy && <> · FY{reconSource.fy}</>}
                  {reconSource.method && <> · {reconSource.method}</>}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: mob ? 16 : 24, minWidth: 0 }}>
                {/* Waterfall bars */}
                <div>
                  {reconItems.map((r, ri) => {
                    const barPct = (maxRecon > 0 && isFinite(r.amount)) ? (Math.abs(r.amount) / maxRecon * 100) : 0;
                    const tooltip = r.source && r.source.label ? r.source.label : (r.source && r.source.concept ? `${r.source.concept} · FY${r.source.fy ?? "?"}` : "");
                    return (
                      <div key={ri} style={{ marginBottom: ri < reconItems.length - 1 ? 8 : 0 }} title={tooltip || undefined}>
                        {r.isSubtotal && ri > 0 && <div style={{ borderTop: "2px dashed rgba(148,163,184,0.2)", margin: "10px 0" }} />}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: mob ? 80 : 110, fontSize: mob ? 9 : 10, color: r.isSubtotal ? "#e2e8f0" : "#94a3b8", fontWeight: r.isSubtotal ? 700 : 400, textAlign: "right", flexShrink: 0, lineHeight: 1.2 }}>{r.label}</div>
                          <div style={{ flex: 1, height: 22, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.max(barPct, 2)}%`, background: r.isSubtotal ? (r.amount >= 0 ? "linear-gradient(90deg, #22c55e, #15803d)" : "linear-gradient(90deg, #ef4444, #dc2626)") : r.color, borderRadius: 3, opacity: r.isSubtotal ? 1 : 0.7 }} />
                          </div>
                          <div style={{ width: mob ? 65 : 80, fontSize: mob ? 11 : 12, fontWeight: r.isSubtotal ? 800 : 600, color: r.isSubtotal ? r.color : "#e2e8f0", textAlign: "right", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                            {r.amount === 0 ? "\u2014" : r.amount < 0 ? `(${Math.abs(r.amount).toLocaleString()})` : r.isSubtotal ? `${r.amount > 0 ? "" : ""}${r.amount.toLocaleString()}` : `+${r.amount.toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Summary table */}
                <div style={{ background: "#0a0e1a", borderRadius: 8, padding: mob ? 12 : 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Reconciliation Summary ($M)</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: mob ? 11 : 12 }}>
                    <tbody>
                      {reconItems.map((r, ri) => {
                        const conceptShort = r.source && r.source.concept ? r.source.concept : "";
                        const periodShort = r.source && r.source.period_end ? r.source.period_end : "";
                        const tipFull = r.source && r.source.label ? r.source.label : conceptShort;
                        // For walks the labels already include their own +/=/− prefix.
                        const labelText = walk ? r.label : `${r.isSubtotal && ri > 0 ? "= " : ri > 0 && !r.isSubtotal ? "+ " : ""}${r.label}`;
                        return (
                        <tr key={ri} style={{ borderTop: r.isSubtotal && ri > 0 ? "2px solid rgba(148,163,184,0.15)" : "none" }} title={tipFull || undefined}>
                          <td style={{ padding: "6px 0", color: r.isSubtotal ? "#e2e8f0" : "#94a3b8", fontWeight: r.isSubtotal ? 700 : 400 }}>
                            <div>{labelText}</div>
                            {conceptShort && (
                              <div style={{ fontSize: 8, color: "#475569", fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                                {conceptShort}{periodShort ? ` · ${periodShort}` : ""}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "6px 0", textAlign: "right", fontWeight: r.isSubtotal ? 800 : 600, color: r.isSubtotal ? r.color : "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>
                            {r.amount === 0 ? "\u2014" : r.amount < 0 ? `(${Math.abs(r.amount).toLocaleString()})` : `${r.amount.toLocaleString()}`}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 12, padding: 8, background: "rgba(96,165,250,0.05)", borderRadius: 4, border: "1px solid rgba(96,165,250,0.1)", fontSize: 9, color: "#64748b", lineHeight: 1.5 }}>
                    {ab.sbc > 0 && ab.gaapEbitda !== 0 && <div><b>SBC:</b> Stock-based compensation is the largest non-cash add-back ({((ab.sbc / Math.abs(ab.gaapEbitda)) * 100).toFixed(0)}% of GAAP EBITDA).</div>}
                    {ab.sbc > 0 && ab.gaapEbitda === 0 && <div><b>SBC:</b> ${ab.sbc.toLocaleString()}M stock-based compensation added back (GAAP EBITDA is zero).</div>}
                    {ab.restructuring > 0 && <div><b>Restructuring:</b> ${ab.restructuring}M in non-recurring charges added back.</div>}
                    {totalAdj > 0 && ab.gaapEbitda !== 0 && <div style={{ marginTop: 4 }}>Total adjustments of <b>${totalAdj.toLocaleString()}M</b> improve EBITDA by {((totalAdj / Math.abs(ab.gaapEbitda)) * 100).toFixed(0)}%.</div>}
                    {totalAdj > 0 && ab.gaapEbitda === 0 && <div style={{ marginTop: 4 }}>Total adjustments of <b>${totalAdj.toLocaleString()}M</b> applied (GAAP EBITDA is zero).</div>}
                  </div>
                </div>
              </div>
            </div>
            );
          })()}

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
            const maxBurn = Math.max(tradBurnAbs, adjBurnAbs, 1); // guard against zero to avoid NaN bar widths

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
                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{tradBurn >= 0 ? "Positive operating cash flow after CapEx" : "Operating Cash Flow minus Total CapEx"}</div>
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
                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>Adj. EBITDA less taxes, dividends, {ab.maintCapex !== null ? "maintenance" : "total"} capex, current LTD, and cash interest</div>
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
                      {adjBurnTotal >= 0 && tradBurn >= 0 ? "Both measures show positive cash generation" : adjBurnTotal >= 0 ? "Adjusted measure shows cash generation; traditional FCF is negative" : tradBurnAbs > 0 ? `Adjusted outflow differs from traditional FCF by ${((Math.abs(diff) / tradBurnAbs) * 100).toFixed(0)}%` : tradBurnAbs === 0 ? "Traditional FCF is zero; adjusted measure reflects non-FCF items" : ""}
                    </div>
                  </div>
                  {/* Runway comparison */}
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 8 }}>
                    <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{tradBurn >= 0 ? "Traditional: Cash Flow Positive" : "Traditional Runway"}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: tradBurn >= 0 ? "#22c55e" : tradBurnAbs > 0 ? ((detail.cash / (tradBurnAbs / 4)) >= 6 ? "#eab308" : "#ef4444") : "#22c55e" }}>{tradBurn >= 0 ? "\u2713 Positive" : tradBurnAbs > 0 ? `${(detail.cash / (tradBurnAbs / 4)).toFixed(1)} qtrs` : "\u2014"}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{tradBurn >= 0 ? `+${fmt(tradBurn * 1e6)} FCF generated` : "Cash \u00F7 Quarterly FCF Burn"}</div>
                    </div>
                    <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{adjBurnTotal >= 0 ? "Adjusted: Cash Flow Positive" : "Adjusted Runway"}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: adjBurnTotal >= 0 ? "#22c55e" : adjBurnAbs > 0 ? ((detail.cash / (adjBurnAbs / 4)) >= 6 ? "#eab308" : "#ef4444") : "#22c55e" }}>{adjBurnTotal >= 0 ? "\u2713 Positive" : adjBurnAbs > 0 ? `${(detail.cash / (adjBurnAbs / 4)).toFixed(1)} qtrs` : "\u2014"}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{adjBurnTotal >= 0 ? `+${fmt(adjBurnTotal * 1e6)} adj. cash flow` : "Cash \u00F7 Quarterly Adj. Burn"}</div>
                    </div>
                  </div>
                </div>

                {/* Waterfall breakdown */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Adjusted Cash Flow Waterfall ($M)</div>
                  {waterfall.map((w, wi) => {
                    const barPct = (maxWf > 0 && isFinite(w.amount)) ? (Math.abs(w.amount) / maxWf * 100) : 0;
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
                      {"\u26A0"} <b>Note:</b> Maintenance CapEx is not separately disclosed. Full CapEx ({fmtM(ab.totalCapex)}) used as proxy, which includes growth CapEx. This overstates the adjusted burn {"\u2014"} true maintenance-only CapEx would yield a lower adjusted burn figure.
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
                  ? `Net cash generator: LTM adjusted cash flow is positive at ${fmtM(adjBurnAnnualOcc)}. The 18-month coverage test is automatically satisfied \u2014 the borrower generates rather than consumes cash. Total available liquidity of ${fmtM(totalAvailLiq)} provides additional cushion.`
                  : (() => {
                    const histLine = `Historical (LTM): ${fmtM(totalAvailLiq)} total liquidity \u00F7 ${fmtM(adjBurnMonthlyOcc)}/mo adj. burn = ${histBurnMonths.toFixed(1)} months ${meetsHistorical18 ? "\u2705 \u226518 mo." : "\u274C <18 mo."}`;
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
                  <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>Driven by 18-mo. liquidity test</div>
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
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b", marginTop: 2 }}>
                      <span>0</span>
                      <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{"\u2190"} 18 mo. threshold</span>
                      <span>{Math.max(Math.ceil(histBurnMonths), 24)} mo.</span>
                    </div>
                    <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>
                      {fmtM(totalAvailLiq)} liquidity {"\u00F7"} {fmtM(adjBurnMonthlyOcc)}/mo. burn = <b style={{ color: meetsHistorical18 ? "#22c55e" : "#ef4444" }}>{meetsHistorical18 ? "\u2705 PASS" : "\u274C FAIL"}</b>
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
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b", marginTop: 2 }}>
                      <span>0</span>
                      <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{"\u2190"} 18 mo. threshold</span>
                      <span>{Math.max(Math.ceil(fwdBurnMonths), 24)} mo.</span>
                    </div>
                    <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>
                      {fmtM(totalAvailLiq)} liquidity {"\u00F7"} {fmtM(fwdBurnMonthly)}/mo. proj. burn ({((1 - fwdBurnImprovement) * 100).toFixed(0)}% improvement) = <b style={{ color: meetsForward18 ? "#22c55e" : "#ef4444" }}>{meetsForward18 ? "\u2705 PASS" : "\u274C FAIL"}</b>
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
                      <span style={{ color: "#64748b" }}>({(comp.amount / detail.liquidityBreakdown.totalLiquidity * 100).toFixed(1)}%)</span>
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
            <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#fdba74", textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {"\u25C6"} Credit Facilities
            </div>
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 2, marginBottom: 16, fontWeight: 400, lineHeight: 1.5 }}>
              Drawn = revolver outstandings {"\u00B7"} Available = mgmt-disclosed undrawn {"\u00B7"} Gross Avail = Drawn + Available {"\u00B7"} BB Restricted = Committed {"\u2212"} Gross Avail (when borrowing base &lt; commitment)
            </div>

            {/* Horizontal stacked bars per facility — each bar fills 100% of its row. */}
            {detail.liquidityBreakdown.facilities.map((fac, fi) => {
              // ABL model: drawn + available = gross availability (collateral-supported capacity).
              // If gross availability >= commitment, bar shows drawn+available covering 100% of the row.
              // If gross availability <  commitment, residual is borrowing-base restricted (striped).
              const committed    = fac.committed || 0;
              const drawn        = fac.drawn || 0;
              const availability = fac.available || 0;
              const grossAvail   = drawn + availability;
              const bbRestricted = Math.max(0, committed - grossAvail);
              const isBBConstrained = committed > 0 && grossAvail < committed;
              // Denominator = commitment when committed > 0, otherwise gross avail (handles private / committed=0 facilities).
              const denom = committed > 0 ? committed : grossAvail;
              const drawnPct        = denom > 0 ? (drawn        / denom) * 100 : 0;
              const availPct        = denom > 0 ? (availability / denom) * 100 : 0;
              const bbRestrictedPct = denom > 0 && isBBConstrained ? (bbRestricted / denom) * 100 : 0;
              const hasAvailability = availability > 0;
              return (
                <div key={fi} style={{ marginBottom: fi < detail.liquidityBreakdown.facilities.length - 1 ? 20 : 0 }}>
                  {/* Facility header */}
                  <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "flex-start", gap: mob ? 4 : 0, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: mob ? 11 : 12, fontWeight: 700, color: "#f1f5f9" }}>{fac.name}</div>
                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>{fac.secured} {"\u00B7"} {fac.rate} {"\u00B7"} Matures {fac.maturity}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: hasAvailability ? "#22c55e" : "#64748b" }}>{hasAvailability ? fmtM(availability) : "$0"} <span style={{ fontSize: 9, fontWeight: 500, color: "#64748b" }}>available</span></div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>of {fmtM(committed)} committed</div>
                      {isBBConstrained && grossAvail > 0 && (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>Gross Avail: {fmtM(grossAvail)}</div>
                      )}
                    </div>
                  </div>

                  {/* Stacked bar: Drawn | Available | BB Restricted — fills 100% of the row per facility */}
                  <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden", border: "1px solid #334155", background: "#1e293b" }}>
                    {drawn > 0 && (
                      <div style={{ width: `${drawnPct}%`, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", minWidth: drawnPct > 5 ? "auto" : 0 }}>
                        {drawnPct > 12 ? `${fmtM(drawn)} drawn` : ""}
                      </div>
                    )}
                    {availability > 0 && (
                      <div style={{ width: `${availPct}%`, background: "linear-gradient(90deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", minWidth: availPct > 5 ? "auto" : 0 }}>
                        {availPct > 12 ? `${fmtM(availability)} avail` : ""}
                      </div>
                    )}
                    {bbRestrictedPct > 0.5 && (
                      <div style={{ width: `${bbRestrictedPct}%`, background: "repeating-linear-gradient(45deg, #1e293b, #1e293b 4px, #334155 4px, #334155 8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#64748b", minWidth: bbRestrictedPct > 10 ? "auto" : 0 }}>
                        {bbRestrictedPct > 15 ? "BB restricted" : ""}
                      </div>
                    )}
                    {drawn === 0 && availability === 0 && (
                      <div style={{ width: "100%", background: "repeating-linear-gradient(45deg, #1e293b, #1e293b 4px, #334155 4px, #334155 8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#64748b" }}>
                        Not yet available {"\u2014"} conditional / pending
                      </div>
                    )}
                  </div>

                  {/* Amounts row */}
                  <div style={{ display: "flex", gap: mob ? 8 : 16, marginTop: 4, fontSize: 9, flexWrap: "wrap" }}>
                    <span style={{ color: "#ef4444" }}>{"\u25A0"} Drawn: {fmtM(drawn)}</span>
                    <span style={{ color: "#22c55e" }}>{"\u25A0"} Available: {fmtM(availability)}</span>
                    {grossAvail > 0 && isBBConstrained && (
                      <span style={{ color: "#94a3b8" }}>Gross Avail: {fmtM(grossAvail)}</span>
                    )}
                    {isBBConstrained && bbRestricted > 0 && (
                      <span style={{ color: "#64748b" }}>{"\u25A8"} BB Restricted: {fmtM(bbRestricted)} (borrowing base &lt; commitment)</span>
                    )}
                    <span style={{ color: "#475569", marginLeft: "auto" }}>Committed: {fmtM(committed)}</span>
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
                    {["Facility", "Committed", "Drawn", "Available", "Gross Avail", "BB Restricted"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", fontSize: 10, color: "#64748b", textAlign: h === "Facility" ? "left" : "right", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.liquidityBreakdown.facilities.map((fac, fi) => {
                    const gross = (fac.drawn || 0) + (fac.available || 0);
                    const restricted = Math.max(0, (fac.committed || 0) - gross);
                    return (
                    <tr key={fi} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "6px 8px", fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{fac.name}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: "#94a3b8" }}>{fmtM(fac.committed)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: fac.drawn > 0 ? "#ef4444" : "#334155", fontWeight: fac.drawn > 0 ? 700 : 400 }}>{fac.drawn > 0 ? fmtM(fac.drawn) : "\u2014"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: fac.available > 0 ? "#22c55e" : "#475569", fontWeight: 700 }}>{fac.available > 0 ? fmtM(fac.available) : "$0"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: gross > 0 ? "#94a3b8" : "#475569" }}>{gross > 0 ? fmtM(gross) : "\u2014"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", color: "#64748b" }}>{restricted > 0 ? fmtM(restricted) : "\u2014"}</td>
                    </tr>
                    );
                  })}
                  {(() => {
                    const facs = detail.liquidityBreakdown.facilities;
                    const totCom = facs.reduce((s,f) => s + (f.committed || 0), 0);
                    const totDr  = facs.reduce((s,f) => s + (f.drawn || 0), 0);
                    const totAv  = facs.reduce((s,f) => s + (f.available || 0), 0);
                    const totGross = totDr + totAv;
                    const totRestricted = facs.reduce((s,f) => s + Math.max(0, (f.committed || 0) - (f.drawn || 0) - (f.available || 0)), 0);
                    return (
                      <tr style={{ borderTop: "2px solid #475569" }}>
                        <td style={{ padding: "8px", fontSize: 11, fontWeight: 800, color: "#f1f5f9" }}>Total</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#f1f5f9" }}>{fmtM(totCom)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#ef4444" }}>{fmtM(totDr)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#22c55e" }}>{fmtM(totAv)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#94a3b8" }}>{fmtM(totGross)}</td>
                        <td style={{ padding: "8px", fontSize: 11, textAlign: "right", fontWeight: 800, color: "#64748b" }}>{fmtM(totRestricted)}</td>
                      </tr>
                    );
                  })()}
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

          {/* ═══ CREDIT AGREEMENT SUMMARY ═══ */}
          {(() => {
            const _caStatic = CREDIT_AGREEMENTS[detail.id];
            const _cfEdgar = !_caStatic && detail.creditFacilities && detail.creditFacilities.length > 0
              ? detail.creditFacilities[0] : null;
            const ca = _caStatic || (_cfEdgar ? {
              facilityName: _cfEdgar.name || "Revolving Credit Facility",
              agent: "See SEC filings",
              committed: _cfEdgar.committed,
              accordion: 0,
              maturity: "See SEC filings",
              availCurrent: _cfEdgar.available,
              bbFormula: "",
              borrowingBase: "",
              bbComponents: [],
              bbAvailCalc: null,
              pricing: "",
              pricingGrid: [],
              pricingNotes: null,
              security: "",
              lcSublimit: 0,
              swinglineSublimit: 0,
              securityDetail: null,
              financialCovenants: [],
              negativeCov: "",
              otherFacilities: null,
              covenantCompliance: "Not available (EDGAR XBRL data)",
              syndicate: "See SEC filings",
              src: _cfEdgar.source || "SEC EDGAR XBRL",
            } : null);
            if (!ca || ca.committed <= 0) return null;
            return (
            <div style={{ ...card, gridColumn: "1 / -1", border: "1px solid #8b5cf6" }}>
              <div style={{ fontSize: mob ? 11 : 13, fontWeight: 800, color: "#c4b5fd", marginBottom: 4, textTransform: "uppercase", letterSpacing: mob ? "0.5px" : "1px" }}>
                {"\u25C6"} Credit Agreement Summary
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 16 }}>{ca.facilityName} {"\u2014"} Agent: {ca.agent}</div>

              {/* Key Terms Grid */}
              <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, marginBottom: 16, minWidth: 0 }}>
                {[
                  { l: "Committed", v: fmtM(ca.committed), c: "#8b5cf6" },
                  { l: "Accordion", v: ca.accordion > 0 ? `+${fmtM(ca.accordion)}` : "None", c: ca.accordion > 0 ? "#22c55e" : "#64748b" },
                  { l: "Maturity", v: ca.maturity, c: "#f1f5f9" },
                  { l: "Availability", v: ca.availCurrent > 0 ? fmtM(ca.availCurrent) : "N/A", c: ca.availCurrent > 0 ? "#22c55e" : "#64748b" },
                ].map((k, i) => (
                  <div key={i} style={{ padding: "8px 10px", background: "#0a0e1a", borderRadius: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: k.c }}>{k.v}</div>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>{k.l}</div>
                  </div>
                ))}
              </div>

              {/* Borrowing Base Formula */}
              <div style={{ padding: 12, background: "#0a0e1a", borderRadius: 6, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 6 }}>Borrowing Base Formula</div>
                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, marginBottom: 8 }}>{ca.bbFormula}</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5, marginBottom: 10 }}>{ca.borrowingBase}</div>

                {/* BB Components Table */}
                {ca.bbComponents && ca.bbComponents.length > 0 && (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginTop: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 480 : "auto" }}>
                      <thead>
                        <tr>
                          {["Component", "Advance Rate", "Description", "Source"].map((h) => (
                            <th key={h} style={{ padding: "6px 8px", fontSize: 9, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", textAlign: "left" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ca.bbComponents.map((comp, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, color: comp.advanceRate === "N/A (deducted)" ? "#ef4444" : "#e2e8f0", whiteSpace: "nowrap" }}>{comp.category}</td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, color: comp.advanceRate === "N/A (deducted)" ? "#ef4444" : "#22c55e", whiteSpace: "nowrap" }}>{comp.advanceRate}</td>
                            <td style={{ padding: "6px 8px", fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>{comp.description}</td>
                            <td style={{ padding: "6px 8px", fontSize: 9, color: "#64748b", whiteSpace: "nowrap" }}>{comp.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* BB Availability Calculation */}
                {ca.bbAvailCalc && (
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
                    {[
                      { l: "Gross BB", v: ca.bbAvailCalc.grossBB, c: "#94a3b8" },
                      { l: "Less Reserves", v: ca.bbAvailCalc.lessReserves, c: "#ef4444" },
                      { l: "Net Availability", v: ca.bbAvailCalc.netAvailability, c: "#22c55e" },
                      { l: "Excess Availability", v: ca.bbAvailCalc.excessAvailability, c: "#3b82f6" },
                    ].map((k, i) => (
                      <div key={i} style={{ padding: "6px 8px", background: "#111827", borderRadius: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: k.c }}>{k.v}</div>
                        <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>{k.l}</div>
                      </div>
                    ))}
                    {ca.bbAvailCalc.trigger && <div style={{ gridColumn: "1 / -1", fontSize: 9, color: "#eab308", fontStyle: "italic", marginTop: 4 }}>{"\u26A0"} {ca.bbAvailCalc.trigger}</div>}
                  </div>
                )}
              </div>

              {/* Pricing Grid */}
              <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: mob ? 12 : 16, marginBottom: 16, minWidth: 0 }}>
                <div style={{ padding: 12, background: "#0a0e1a", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 6 }}>Pricing</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, marginBottom: 8 }}>{ca.pricing}</div>

                  {ca.pricingGrid && ca.pricingGrid.length > 0 && (
                    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                        <thead>
                          <tr>
                            {["Level", "Condition", "SOFR+", "Base Rate+", "Unused Fee"].map((h) => (
                              <th key={h} style={{ padding: "5px 6px", fontSize: 9, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", textAlign: "left" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ca.pricingGrid.map((pg, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                              <td style={{ padding: "5px 6px", fontSize: 10, fontWeight: 600, color: "#e2e8f0" }}>{pg.level}</td>
                              <td style={{ padding: "5px 6px", fontSize: 9, color: "#94a3b8" }}>{pg.condition}</td>
                              <td style={{ padding: "5px 6px", fontSize: 11, fontWeight: 700, color: "#22c55e" }}>{pg.sofrSpread}</td>
                              <td style={{ padding: "5px 6px", fontSize: 11, fontWeight: 700, color: "#60a5fa" }}>{pg.baseRateSpread}</td>
                              <td style={{ padding: "5px 6px", fontSize: 10, color: "#94a3b8" }}>{pg.unusedFee}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {ca.pricingNotes && <div style={{ fontSize: 9, color: "#64748b", marginTop: 8, lineHeight: 1.5, fontStyle: "italic" }}>{ca.pricingNotes}</div>}
                </div>

                {/* Security Detail */}
                <div style={{ padding: 12, background: "#0a0e1a", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 6 }}>Security & Collateral</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, marginBottom: 6 }}>{ca.security}</div>
                  {ca.lcSublimit > 0 && <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>LC Sublimit: {fmtM(ca.lcSublimit)} {ca.swinglineSublimit > 0 ? `| Swingline: ${fmtM(ca.swinglineSublimit)}` : ""}</div>}

                  {ca.securityDetail && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", marginBottom: 4, marginTop: 8 }}>Pledged Assets</div>
                      {ca.securityDetail.pledgedAssets.map((a, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.6, paddingLeft: 8, borderLeft: "2px solid #22c55e", marginBottom: 3 }}>{a}</div>
                      ))}

                      <div style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", marginBottom: 4, marginTop: 10 }}>Excluded Assets</div>
                      {ca.securityDetail.excludedAssets.map((a, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.6, paddingLeft: 8, borderLeft: "2px solid #ef4444", marginBottom: 3 }}>{a}</div>
                      ))}

                      {ca.securityDetail.intercreditorNotes && (
                        <>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#eab308", textTransform: "uppercase", marginBottom: 4, marginTop: 10 }}>Intercreditor / Lien Priority</div>
                          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.6 }}>{ca.securityDetail.intercreditorNotes}</div>
                        </>
                      )}

                      {ca.securityDetail.controlAgreements && (
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}><b>Control Agreements:</b> {ca.securityDetail.controlAgreements}</div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Financial Covenants */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 8 }}>Financial Covenants</div>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
                    <thead>
                      <tr>
                        {["Covenant", "Test", "Status", "Notes"].map((h, i) => (
                          <th key={i} style={{ padding: "6px 8px", fontSize: 9, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ca.financialCovenants.map((fc, i) => {
                        // Defensive: some data sources store covenants as plain strings
                        // (legacy format) instead of {covenant,test,status,notes} objects,
                        // and others use {name,level,current,headroom} alternates. Normalize
                        // so the table never crashes on missing fields and surfaces
                        // whatever detail the source provides.
                        const norm = typeof fc === "string"
                          ? { covenant: fc, test: "\u2014", status: "\u2014", notes: "" }
                          : {
                              covenant: fc.covenant ?? fc.name    ?? "\u2014",
                              test:     fc.test     ?? fc.level   ?? "\u2014",
                              status:   fc.status   ?? fc.current ?? fc.cur ?? "\u2014",
                              notes:    fc.notes    ?? [fc.current, fc.headroom].filter(Boolean).join(" \u00B7 ") ?? "",
                            };
                        const statusStr = String(norm.status);
                        const statusColor = statusStr.includes("Pass") || statusStr === "Active"
                          ? "#22c55e"
                          : statusStr.includes("Not") ? "#eab308" : "#64748b";
                        return (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                          <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>{norm.covenant}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, color: "#94a3b8" }}>{norm.test}</td>
                          <td style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: statusColor }}>{norm.status}</td>
                          <td style={{ padding: "6px 8px", fontSize: 10, color: "#64748b" }}>{norm.notes}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Negative Covenants + Other */}
              <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 4 }}>Negative Covenants</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>{ca.negativeCov}</div>
              </div>

              {ca.otherFacilities && (
                <div style={{ padding: 10, background: "#0a0e1a", borderRadius: 6, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", marginBottom: 4 }}>Other Credit Facilities</div>
                  <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>{ca.otherFacilities}</div>
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 9, color: "#64748b" }}>
                <span><b>Compliance:</b> {ca.covenantCompliance}</span>
                <span>{"\u00B7"} <b>Syndicate:</b> {ca.syndicate}</span>
                <span>{"\u00B7"} <b>Source:</b> {ca.src}</span>
              </div>
            </div>
            );
          })()}

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
                      {m.amount > 0 ? fmtM(m.amount) : "\u2014"}
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
                  <td style={{ padding: "8px", fontSize: 12, fontWeight: 800, color: "#ef4444" }}>{fmtM(detail.liquidityBreakdown.debtMaturities.reduce((s, m) => s + m.amount, 0))}</td>
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
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", marginBottom: 2 }}>{fmtM(f.cash)}</div>
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
                const chgStr = fmtM(chg);
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
                      <span style={{ fontSize: 8, color: "#22c55e", flexShrink: 0 }}>{fmtM(f.cash)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                      <div style={{ height: 6, borderRadius: 3, background: "#ef4444", width: `${(f.debt / maxVal) * 100}%`, opacity: 0.6 }} />
                      <span style={{ fontSize: 8, color: "#ef4444", flexShrink: 0 }}>{fmtM(f.debt)}</span>
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

          {/* ═══ CASH FLOW / BURN SCENARIO ANALYSIS ═══ */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{isNetCashGenerator ? "Cash Flow Scenario Analysis" : "Burn Coverage Scenario Analysis"} — LTM Basis</div>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 16 }}>All scenarios use LTM adjusted cash burn of <b style={{ color: isNetCashGenerator ? "#22c55e" : "#ef4444" }}>{annBurn > 0 ? `${isNetCashGenerator ? "+" : "-"}${fmt(annBurn * 1e6)}` : "N/A (insufficient data)"}</b> as the baseline.</div>

            {/* Trailing 4-Quarter Trend */}
            {(!detail.quarterlyBurns || detail.quarterlyBurns.length === 0) && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#0a0e1a", borderRadius: 6, border: "1px solid #1e293b", fontSize: 10, color: "#64748b", fontStyle: "italic" }}>
                Quarterly trend data not available — showing annual estimates.
              </div>
            )}
            {detail.quarterlyBurns && detail.quarterlyBurns.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {(() => {
                  const burns = detail.quarterlyBurns;
                  const nQ = burns.length;
                  const absVals = burns.map(b => Math.abs(b.burn ?? 0));
                  const maxB = absVals.length > 0 ? Math.max(...absVals) : 0;
                  const ltmTotal = burns.reduce((s, b) => s + (b.burn ?? 0), 0);
                  const qLabel = nQ === 4 ? "Trailing 4-Quarter" : `Trailing ${nQ}-Quarter`;
                  return (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>{qLabel} {isNetCashGenerator ? "Cash Flow" : "Cash Burn"} Trend ($M)</div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${nQ}, 1fr)`, gap: mob ? 6 : 10 }}>
                        {burns.map((b, i) => {
                          const burnVal = b.burn ?? 0;
                          const pct = maxB > 0 ? (Math.abs(burnVal) / maxB * 100) : 0;
                          const isPos = burnVal >= 0;
                          const prev = i > 0 ? (burns[i - 1].burn ?? 0) : null;
                          const delta = prev != null ? burnVal - prev : null;
                          return (
                            <div key={i} style={{ background: "#0a0e1a", borderRadius: 6, padding: mob ? 8 : 10, textAlign: "center" }}>
                              <div style={{ fontSize: 9, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>{b.q}</div>
                              <div style={{ fontSize: mob ? 16 : 20, fontWeight: 800, color: isPos ? "#22c55e" : "#ef4444" }}>{isPos ? "+" : ""}{burnVal}</div>
                              <div style={{ margin: "6px auto", height: 4, background: "#1e293b", borderRadius: 2, width: "80%" }}>
                                <div style={{ height: "100%", borderRadius: 2, width: `${Math.max(pct, 5)}%`, background: isPos ? "#22c55e" : "#ef4444", opacity: 0.7 }} />
                              </div>
                              {delta != null && <div style={{ fontSize: 9, color: delta > 0 ? (isNetCashGenerator ? "#22c55e" : "#ef4444") : (isNetCashGenerator ? "#ef4444" : "#22c55e"), fontWeight: 600 }}>{delta > 0 ? "\u25B2" : "\u25BC"} {Math.abs(delta)}M QoQ</div>}
                              <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>{b.note}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, padding: "6px 10px", background: "#0a0e1a", borderRadius: 4 }}>
                        <span style={{ fontSize: 10, color: "#64748b" }}>LTM Total (sum of {nQ}Q{nQ < 4 ? " \u2014 partial" : ""}):</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: ltmTotal >= 0 ? "#22c55e" : "#ef4444" }}>
                          {ltmTotal >= 0 ? "+" : ""}{fmt(Math.abs(ltmTotal) * 1e6)} ({isNetCashGenerator ? "generated" : "consumed"})
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Scenario Table (LTM basis) */}
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: mob ? 380 : "auto" }}>
              <thead>
                <tr>
                  {["Scenario", isNetCashGenerator ? "LTM CF" : "LTM Burn", "Qtr Avg", "Runway", "Flag"].map(h => (
                    <th key={h} style={{ padding: "8px 4px", fontSize: 10, color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(isNetCashGenerator
                  ? [
                      { sc: "LTM Run-Rate",         mult: 1.00, note: "Trailing 12-month adjusted cash flow" },
                      { sc: "CF -25% (Stress)",     mult: 0.75, note: "Margin pressure / operational slippage" },
                      { sc: "CF -50% (Severe)",     mult: 0.50, note: "Major deterioration" },
                      { sc: "CF +25% (Improved)",   mult: 1.25, note: "Cost cuts / margin expansion" },
                      { sc: "CF +50% (Optimistic)", mult: 1.50, note: "Significant improvement" },
                    ]
                  : [
                      { sc: "LTM Run-Rate",          mult: 1.00, note: "Based on LTM adjusted burn" },
                      { sc: "Burn +25% (Stress)",    mult: 1.25, note: "Operational deterioration / cost overruns" },
                      { sc: "Burn +50% (Severe)",    mult: 1.50, note: "Major operational disruption" },
                      { sc: "Burn -25% (Improved)",  mult: 0.75, note: "Margin improvement / cost cuts" },
                      { sc: "Burn -50% (Optimistic)",mult: 0.50, note: "Significant cost reduction + volume" },
                    ]
                ).map((s, i) => {
                  // Signed annual + quarterly figure: positive = generated, negative = burned.
                  const scenarioAnnCF = annCashFlow * s.mult;
                  const scenarioQtrCF = scenarioAnnCF / 4;
                  const scenarioAnnAbs = Math.abs(scenarioAnnCF);
                  const scenarioQtrAbs = Math.abs(scenarioQtrCF);
                  const scenarioGenerating = scenarioAnnCF > 0;
                  const rw = scenarioGenerating
                    ? 999
                    : (scenarioQtrAbs > 0 ? detail.cash / scenarioQtrAbs : 999);
                  const rwColor = scenarioGenerating
                    ? "#22c55e"
                    : rw >= 8 ? "#22c55e" : rw >= 5 ? "#eab308" : "#ef4444";
                  const cfColor = scenarioGenerating ? "#22c55e" : "#ef4444";
                  const annLabel = scenarioAnnAbs > 0
                    ? `${scenarioGenerating ? "+" : "-"}${fmt(scenarioAnnAbs * 1e6)}`
                    : "\u2014";
                  const qtrLabel = scenarioQtrAbs > 0
                    ? `${scenarioGenerating ? "+" : "-"}${fmt(scenarioQtrAbs * 1e6)}/qtr`
                    : "\u2014";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "8px 4px", fontSize: 12, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? "#f1f5f9" : "#94a3b8" }}>{s.sc}</td>
                      <td style={{ padding: "8px 4px", fontSize: 12, color: cfColor, fontWeight: 600 }}>{annLabel}</td>
                      <td style={{ padding: "8px 4px", fontSize: 11, color: "#64748b" }}>{qtrLabel}</td>
                      <td style={{ padding: "8px 4px" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: rwColor }}>{scenarioGenerating ? "Self-funding" : rw >= 99 ? "\u221E" : `${fmtNum(rw)} qtrs`}</span>
                        <div style={{ marginTop: 2, background: "#1e293b", borderRadius: 3, height: 4, width: 80 }}>
                          <div style={{ height: "100%", borderRadius: 3, width: `${scenarioGenerating ? 100 : Math.min((rw >= 99 ? 12 : rw) / 12, 1) * 100}%`, background: rwColor }} />
                        </div>
                      </td>
                      <td style={{ padding: "8px 4px", fontSize: 10, color: "#64748b" }}>
                        {scenarioGenerating ? "\u2713 Self-funding" : rw >= 99 ? "\u2713 N/A" : rw < 4 ? "\u26A0\u26A0 Critical" : rw < 6 ? "\u26A0 Warning" : "OK"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <div style={{ marginTop: 12, padding: "8px 10px", background: "#0a0e1a", borderRadius: 4, fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>
              <b style={{ color: "#94a3b8" }}>Methodology:</b> Scenarios apply multipliers to LTM adjusted {isNetCashGenerator ? "cash flow" : "cash burn"} ({annBurn > 0 ? `${isNetCashGenerator ? "+" : "-"}${fmt(annBurn * 1e6)}` : "N/A"}). Runway = Total Liquidity ({fmt(detail.cash * 1e6)}) / Scenario Quarterly Burn; scenarios that remain cash-generative are marked Self-funding. Trailing {detail.quarterlyBurns ? detail.quarterlyBurns.length : 0}Q trend shows quarter-by-quarter progression of adjusted cash flow.
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
                  const fmtB = (v) => {
                    if (v === null || v === undefined) return "\u2014";
                    if (Math.abs(v) >= 1000) return `${_loc(v / 1000, 1)}B`;
                    return `${Math.round(v).toLocaleString()}M`;
                  };
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

          {/* ═══ LEVERAGE & COVERAGE TREND ═══ */}
          {detail.financials.length >= 2 && (() => {
            // Build per-year leverage and intCov data from the financials array.
            // Works for both hardcoded portfolio entries and EDGAR-generated companies.
            const levRows = [...detail.financials].reverse().map((f) => ({
              period: f.period.replace("FY", ""),
              lev: (f.ebitda > 0 && f.debt != null) ? +(f.debt / f.ebitda).toFixed(2) : null,
              intCovRow: null, // per-year intCov not stored in financials; shown only at LTM level
            }));
            const hasAnyLev = levRows.some(r => r.lev !== null);
            const levValues = levRows.map(r => r.lev).filter(v => v !== null);
            const maxLev = levValues.length ? Math.max(...levValues, peerBenchmarks.medianLeverage) * 1.25 : 10;
            const medLevPct = Math.min(peerBenchmarks.medianLeverage / maxLev, 1) * 100;

            // Margin trend from financials (works for all companies)
            const marginRows = [...detail.financials].reverse().map((f) => ({
              period: f.period.replace("FY", ""),
              margin: f.rev > 0 ? +((f.ebitda / f.rev) * 100).toFixed(1) : null,
            }));
            const hasAnyMargin = marginRows.some(r => r.margin !== null);
            const allMargins = marginRows.map(r => r.margin).filter(v => v !== null);
            const minMargin = allMargins.length ? Math.min(...allMargins, peerBenchmarks.medianMargin, 0) : 0;
            const maxMargin = allMargins.length ? Math.max(...allMargins, peerBenchmarks.medianMargin) * 1.25 || 20 : 20;
            const marginRange = maxMargin - minMargin || 1;
            const medMarginPct = Math.min((peerBenchmarks.medianMargin - minMargin) / marginRange, 1) * 100;

            return (
              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Leverage & Margin Trend
                  {detail._generated && <span style={{ fontSize: 9, fontWeight: 500, color: "#60a5fa", textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>— EDGAR data</span>}
                  <span style={{ fontSize: 9, fontWeight: 400, color: "#64748b", textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>Blue line = portfolio median</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: mob ? 16 : 24, minWidth: 0 }}>

                  {/* Leverage trend */}
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8, textTransform: "uppercase" }}>Gross Leverage (Debt / EBITDA)</div>
                    {!hasAnyLev ? (
                      <div style={{ padding: "10px 12px", background: "#0a0e1a", borderRadius: 6, fontSize: 10, color: "#64748b", fontStyle: "italic" }}>
                        Not calculable — EBITDA is negative across all periods
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginBottom: 4, position: "relative" }}>
                          {/* Median reference line */}
                          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${medLevPct}%`, height: 1, background: "#3b82f6", opacity: 0.6, zIndex: 1, borderTop: "1px dashed #3b82f6" }} />
                          {levRows.map((r, idx) => {
                            const barH = r.lev !== null ? Math.max(4, (r.lev / maxLev) * 74) : 4;
                            const barColor = r.lev === null ? "#334155" : r.lev > peerBenchmarks.medianLeverage * 1.5 ? "#ef4444" : r.lev > peerBenchmarks.medianLeverage ? "#f97316" : "#22c55e";
                            return (
                              <div key={idx} style={{ flex: 1, textAlign: "center" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: barColor, marginBottom: 2 }}>
                                  {r.lev !== null ? `${r.lev.toFixed(1)}x` : "N/M"}
                                </div>
                                <div style={{ height: barH, background: barColor, borderRadius: "3px 3px 0 0", margin: "0 4px", opacity: r.lev !== null ? 0.85 : 0.3 }} />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {levRows.map((r, idx) => (
                            <div key={idx} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "#64748b" }}>{r.period}</div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9, color: "#64748b" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 16, height: 1, borderTop: "1px dashed #3b82f6", verticalAlign: "middle" }} />Portfolio median ({peerBenchmarks.medianLeverage.toFixed(1)}x)</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* EBITDA Margin trend */}
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8, textTransform: "uppercase" }}>EBITDA Margin (%)</div>
                    {!hasAnyMargin ? (
                      <div style={{ padding: "10px 12px", background: "#0a0e1a", borderRadius: 6, fontSize: 10, color: "#64748b", fontStyle: "italic" }}>
                        Not calculable — revenue data unavailable
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginBottom: 4, position: "relative" }}>
                          {/* Median reference line */}
                          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${Math.max(0, Math.min(medMarginPct, 100))}%`, height: 1, background: "#3b82f6", opacity: 0.6, zIndex: 1, borderTop: "1px dashed #3b82f6" }} />
                          {marginRows.map((r, idx) => {
                            const normH = r.margin !== null ? Math.max(4, ((r.margin - minMargin) / marginRange) * 74) : 4;
                            const barColor = r.margin === null ? "#334155" : r.margin < 0 ? "#ef4444" : r.margin < peerBenchmarks.medianMargin * 0.5 ? "#f97316" : "#22c55e";
                            return (
                              <div key={idx} style={{ flex: 1, textAlign: "center" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: barColor, marginBottom: 2 }}>
                                  {r.margin !== null ? `${r.margin.toFixed(0)}%` : "N/M"}
                                </div>
                                <div style={{ height: normH, background: barColor, borderRadius: "3px 3px 0 0", margin: "0 4px", opacity: r.margin !== null ? 0.85 : 0.3 }} />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {marginRows.map((r, idx) => (
                            <div key={idx} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "#64748b" }}>{r.period}</div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9, color: "#64748b" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 16, height: 1, borderTop: "1px dashed #3b82f6", verticalAlign: "middle" }} />Portfolio median ({peerBenchmarks.medianMargin.toFixed(1)}%)</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

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
                    <td style={{ padding: "7px 0 7px 8px", fontSize: 9, color: "#64748b", maxWidth: 120 }}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            {/* ── vs Portfolio Median bars (always shown; works for both portfolio + generated companies) ── */}
            {(() => {
              const detailLev = detail.ebitda > 0 ? detail.totalDebt / detail.ebitda : null;
              const detailMargin = detail.revenue > 0 ? (detail.ebitda / detail.revenue) * 100 : null;
              const peers = [
                {
                  label: "Gross Leverage",
                  company: detailLev,
                  median: peerBenchmarks.medianLeverage,
                  fmt: (v) => `${v.toFixed(1)}x`,
                  // lower is better for leverage
                  color: (v, med) => v > med * 1.5 ? "#ef4444" : v > med ? "#f97316" : "#22c55e",
                  note: detailLev !== null ? (detailLev > peerBenchmarks.medianLeverage ? "above" : "below") + " portfolio median" : "N/M \u2014 negative EBITDA",
                  maxScale: Math.max((detailLev || 0), peerBenchmarks.medianLeverage) * 1.4 || 10,
                },
                {
                  label: "Interest Coverage",
                  company: detail.intCov > 0 && detail.intCov < 999 ? detail.intCov : null,
                  median: peerBenchmarks.medianIntCov,
                  fmt: (v) => `${v.toFixed(1)}x`,
                  // higher is better for coverage
                  color: (v, med) => v < med * 0.5 ? "#ef4444" : v < med ? "#f97316" : "#22c55e",
                  note: (detail.intCov > 0 && detail.intCov < 999) ? (detail.intCov > peerBenchmarks.medianIntCov ? "above" : "below") + " portfolio median" : "N/M",
                  maxScale: Math.max((detail.intCov > 0 && detail.intCov < 999 ? detail.intCov : 0), peerBenchmarks.medianIntCov) * 1.4 || 10,
                },
                {
                  label: "EBITDA Margin",
                  company: detailMargin,
                  median: peerBenchmarks.medianMargin,
                  fmt: (v) => `${v.toFixed(1)}%`,
                  // higher is better for margin
                  color: (v, med) => v < 0 ? "#ef4444" : v < med * 0.5 ? "#f97316" : "#22c55e",
                  note: detailMargin !== null ? (detailMargin > peerBenchmarks.medianMargin ? "above" : "below") + " portfolio median" : "N/M",
                  // support negative margins: scale from min(0, company, median) to max
                  maxScale: null, // computed inline
                },
                {
                  label: "Current Ratio",
                  company: detail.currentRatio > 0 ? detail.currentRatio : null,
                  median: peerBenchmarks.medianCurrentRatio,
                  fmt: (v) => `${v.toFixed(1)}x`,
                  // higher is better
                  color: (v, med) => v < 1 ? "#ef4444" : v < med ? "#f97316" : "#22c55e",
                  note: detail.currentRatio > 0 ? (detail.currentRatio > peerBenchmarks.medianCurrentRatio ? "above" : "below") + " portfolio median" : "N/M",
                  maxScale: Math.max((detail.currentRatio || 0), peerBenchmarks.medianCurrentRatio) * 1.4 || 4,
                },
              ];
              return (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                    vs Portfolio Median <span style={{ fontSize: 9, fontWeight: 400, color: "#64748b", textTransform: "none" }}>({PORTFOLIO.length}-company benchmark)</span>
                  </div>
                  {peers.map((p, pi) => {
                    const hasValue = p.company !== null && p.company !== undefined && isFinite(p.company);
                    // For margin, compute scale supporting negatives
                    let scale = p.maxScale;
                    let lo = 0;
                    if (p.label === "EBITDA Margin") {
                      lo = Math.min(0, hasValue ? p.company : 0, p.median);
                      const hi = Math.max(hasValue ? p.company : 0, p.median) * 1.3 || 20;
                      scale = (hi - lo) || 1;
                    }
                    const companyBarPct = hasValue
                      ? Math.min(Math.max((p.company - lo) / (scale || 1), 0), 1) * 100
                      : 0;
                    const medianBarPct = Math.min(Math.max((p.median - lo) / (scale || 1), 0), 1) * 100;
                    const barColor = hasValue ? p.color(p.company, p.median) : "#64748b";
                    return (
                      <div key={pi} style={{ marginBottom: pi < peers.length - 1 ? 12 : 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.label}</span>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>{hasValue ? p.fmt(p.company) : "N/M"}</span>
                            <span style={{ fontSize: 9, color: "#64748b" }}>median: {p.fmt(p.median)}</span>
                          </div>
                        </div>
                        <div style={{ position: "relative", height: 10, background: "#1e293b", borderRadius: 4, overflow: "visible" }}>
                          {/* Company bar */}
                          {hasValue && (
                            <div style={{ height: "100%", width: `${Math.max(companyBarPct, hasValue ? 2 : 0)}%`, background: barColor, borderRadius: 4, opacity: 0.85 }} />
                          )}
                          {/* Median marker */}
                          <div style={{ position: "absolute", top: -2, bottom: -2, left: `${Math.min(medianBarPct, 98)}%`, width: 2, background: "#3b82f6", borderRadius: 1, zIndex: 2 }} />
                        </div>
                        <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>{p.note}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
            {/* Agency rating cards — dimmed with note for generated (unrated) companies */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: mob ? 8 : 16 }}>
              {[{ agency: "S&P", rating: detail.sp }, { agency: "Moody's", rating: detail.moodys }, { agency: "Fitch", rating: detail.fitch }].map((r) => (
                <div key={r.agency} style={{ textAlign: "center", padding: mob ? 10 : 16, background: r.rating !== "NR" ? "rgba(234,179,8,0.05)" : "#0a0e1a", borderRadius: 6, border: r.rating !== "NR" ? "1px solid rgba(234,179,8,0.15)" : "1px solid rgba(100,116,139,0.1)", opacity: detail._generated && r.rating === "NR" ? 0.5 : 1 }}>
                  <div style={{ fontSize: mob ? 18 : 22, fontWeight: 800, color: ratingColor(r.rating) }}>{r.rating}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{r.agency}</div>
                  {detail._generated && r.rating === "NR" && (
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 5, lineHeight: 1.4 }}>Not publicly<br />rated</div>
                  )}
                </div>
              ))}
            </div>
            {detail._generated && (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(59,130,246,0.06)", borderRadius: 5, border: "1px solid rgba(59,130,246,0.12)", fontSize: 10, color: "#60a5fa", lineHeight: 1.5 }}>
                Not publicly rated \u2014 implied rating derived from SEC filings via 5-factor model
              </div>
            )}

            {/* Implied rating — large prominent display for generated companies */}
            <div style={{ marginTop: 16, padding: detail._generated ? 16 : 12, background: "#0a0e1a", borderRadius: 6, border: detail._generated ? `1px solid ${ratingColor(detail.impliedRating)}33` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: detail._generated ? 28 : 18, color: ratingColor(detail.impliedRating) }}>{"\u25C6"}</span>
                <div>
                  {detail._generated ? (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Implied Credit Rating</div>
                      <div style={{ fontSize: mob ? 28 : 34, fontWeight: 800, color: ratingColor(detail.impliedRating), lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>{detail.impliedRating}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>5-factor model{detail._ratingScore != null ? ` \u00B7 composite score\u00A0${detail._ratingScore}` : ""}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Implied Rating: <span style={{ color: ratingColor(detail.impliedRating) }}>{detail.impliedRating}</span></div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Based on CDS spreads, financial profile & market signals</div>
                    </>
                  )}
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

          {/* 5-factor model breakdown — generated companies only */}
          {detail._generated && detail._ratingScore != null && (() => {
            const lev = detail.ebitda > 0 ? detail.totalDebt / detail.ebitda : Infinity;
            const cov = detail.intCov;
            const fcfToDebt = detail.totalDebt > 0 ? detail.fcf / detail.totalDebt : 0;
            const margin = detail.revenue > 0 ? detail.ebitda / detail.revenue : 0;
            const size = detail.mktCap || 0;
            const sLev = lev <= 0 || lev < 0.5 ? 6 : lev < 1.5 ? 5 : lev < 2.0 ? 4 : lev < 3.0 ? 3 : lev < 4.0 ? 2 : lev < 5.5 ? 1 : 0;
            const sCov = cov > 21 ? 6 : cov > 10 ? 5 : cov > 6 ? 4 : cov > 4 ? 3 : cov > 2.5 ? 2 : cov > 1.5 ? 1 : 0;
            const sFcf = fcfToDebt > 0.50 ? 6 : fcfToDebt > 0.35 ? 5 : fcfToDebt > 0.20 ? 4 : fcfToDebt > 0.10 ? 3 : fcfToDebt > 0.05 ? 2 : fcfToDebt > 0 ? 1 : 0;
            const sMar = margin > 0.30 ? 6 : margin > 0.20 ? 5 : margin > 0.15 ? 4 : margin > 0.10 ? 3 : margin > 0.08 ? 2 : margin > 0.05 ? 1 : 0;
            const sSize = size > 100 ? 6 : size > 25 ? 5 : size > 10 ? 4 : size > 5 ? 3 : size > 1 ? 2 : size > 0.3 ? 1 : 0;
            const factors = [
              { label: "Leverage", weight: "35%", score: sLev, value: !isFinite(lev) ? "N/M" : `${lev.toFixed(1)}x gross`, desc: "Debt / EBITDA" },
              { label: "Coverage", weight: "30%", score: sCov, value: `${fmtNum(cov)}x`, desc: "EBITDA / Interest" },
              { label: "FCF / Debt", weight: "20%", score: sFcf, value: detail.totalDebt > 0 ? `${(fcfToDebt * 100).toFixed(1)}%` : "N/M", desc: "Free cash flow yield on debt" },
              { label: "Margin", weight: "10%", score: sMar, value: detail.revenue > 0 ? `${(margin * 100).toFixed(1)}%` : "N/M", desc: "EBITDA margin" },
              { label: "Size", weight: "5%", score: sSize, value: size ? `$${size.toFixed(1)}B mkt cap` : "Private", desc: "Market capitalisation" },
            ];
            const scoreColor = (s) => s >= 4 ? "#22c55e" : s >= 2 ? "#eab308" : "#ef4444";
            return (
              <div style={{ ...card, gridColumn: "1 / -1", border: "1px solid rgba(59,130,246,0.15)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>5-Factor Model Breakdown</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Composite: <span style={{ fontWeight: 700, color: ratingColor(detail.impliedRating) }}>{detail._ratingScore}</span> &rarr; <span style={{ fontWeight: 700, color: ratingColor(detail.impliedRating) }}>{detail.impliedRating}</span></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 10 }}>
                  {factors.map((f) => (
                    <div key={f.label} style={{ padding: 12, background: "#0a0e1a", borderRadius: 6, border: `1px solid ${scoreColor(f.score)}22` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.label}</span>
                        <span style={{ fontSize: 9, color: "#475569" }}>{f.weight}</span>
                      </div>
                      {/* Score bar: 0–6 */}
                      <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < f.score ? scoreColor(f.score) : "rgba(148,163,184,0.1)" }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: scoreColor(f.score), fontFamily: "'JetBrains Mono', monospace" }}>{f.value}</div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{f.desc}</div>
                      <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>Score {f.score}/6</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: "#475569", lineHeight: 1.5 }}>
                  Weights: leverage 35% + coverage 30% + FCF/debt 20% + margin 10% + size 5%. Data sourced from SEC EDGAR filings.
                </div>
              </div>
            );
          })()}

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
                          style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 700, border: "none", background: overrideReason.trim() ? (ws.active ? "#052e16" : "#7f1d1d") : "#1e293b", color: overrideReason.trim() ? "#fff" : "#64748b", cursor: overrideReason.trim() ? "pointer" : "not-allowed" }}
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
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>CIK: {{"LCID":"0001811210","RIVN":"0001874178","CENT":"0000887733","IHRT":"0001400891","SMC":"0002024218","UPBD":"0000933036","WSC":"0001647088"}[detail.id] || "Private"}</div>
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
          {detail.news.map((n, i) => {
            const newsKey = `${detail.id}-${i}`;
            const isOpen = expandedNews[newsKey];
            return (
            <div key={i} style={{ borderBottom: i < detail.news.length - 1 ? "1px solid #1e293b" : "none" }}>
              <div onClick={() => n.summary && setExpandedNews(prev => ({ ...prev, [newsKey]: !prev[newsKey] }))} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", cursor: n.summary ? "pointer" : "default", transition: "background .15s ease", borderRadius: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: sentimentColor(n.sentiment), marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{n.headline}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{n.src} {"\u00B7"} {n.date}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: sentimentColor(n.sentiment), letterSpacing: "0.5px" }}>{n.sentiment}</span>
                  {n.summary && <span style={{ fontSize: 10, color: "#64748b", transition: "transform .2s ease", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>{"\u25BC"}</span>}
                </div>
              </div>
              {isOpen && n.summary && (
                <div style={{ padding: "0 0 12px 20px", animation: "fadeIn 0.2s ease forwards" }}>
                  <div style={{ padding: "10px 14px", background: "#0a0e1a", borderRadius: 6, borderLeft: `3px solid ${sentimentColor(n.sentiment)}`, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
                    {n.summary}
                  </div>
                </div>
              )}
            </div>
            );
          })}
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
              <div style={{ fontSize: mob ? 14 : 16, fontWeight: 700, color: (detail.lastEarnings || "").startsWith("Beat") ? "#22c55e" : "#ef4444" }}>{detail.lastEarnings}</div>
            </div>
          </div>
          {detail.earningsCallSummary ? <div style={{ ...card, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", flexDirection: mob ? "column" : "row", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center", gap: mob ? 4 : 0, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Earnings Call Summary</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{detail.earningsCallSummary.quarter} {"\u00B7"} {detail.earningsCallSummary.date}</div>
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 16, fontStyle: "italic" }}>Source: {detail.earningsCallSummary.source}</div>

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
          </div> : <div style={{ ...card, gridColumn: "1 / -1", textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>Earnings Call Summary</div>
            <div style={{ fontSize: 11, color: "#475569" }}>Add to portfolio for curated earnings analysis</div>
          </div>}
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
<div style={{ ...root, animation: "fadeIn 0.25s ease forwards" }}>
<div style={headerBar}>
<div style={{ display: "flex", alignItems: "center", gap: mob ? 6 : 16, flex: 1, minWidth: 0 }}>
<div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
<button onClick={goBack} disabled={!canGoBack} style={{ ...pill(false), border: "1px solid rgba(148,163,184,0.15)", opacity: canGoBack ? 1 : 0.3, cursor: canGoBack ? "pointer" : "default", padding: mob ? "6px 10px" : "7px 12px", borderRadius: 6 }}>{"\u2190"}</button>
<button onClick={goForward} disabled={!canGoForward} style={{ ...pill(false), border: "1px solid rgba(148,163,184,0.15)", opacity: canGoForward ? 1 : 0.3, cursor: canGoForward ? "pointer" : "default", padding: mob ? "6px 10px" : "7px 12px", borderRadius: 6 }}>{"\u2192"}</button>
</div>
<div style={{ fontSize: mob ? 14 : 17, fontWeight: 800, letterSpacing: "-0.5px", color: "#f1f5f9", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
<span style={{ color: "#ef4444", fontSize: mob ? 12 : 14, filter: "drop-shadow(0 0 6px rgba(239,68,68,0.4))" }}>{"\u25C6"}</span>
<span>CREDIT RISK MONITOR</span>
</div>
{!mob && <div style={{ fontSize: 10, color: "#64748b", borderLeft: "1px solid rgba(148,163,184,0.1)", paddingLeft: 14, fontVariantNumeric: "tabular-nums" }}>
{now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })} {"\u00B7"} {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
</div>}
</div>
<div style={{ position: "relative", width: mob ? "100%" : "auto", marginTop: mob ? 2 : 0 }}>
{mob && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 24, background: "linear-gradient(to right, transparent, rgba(15,22,41,0.85))", zIndex: 1, pointerEvents: "none" }} />}
<div style={{ display: "flex", gap: mob ? 4 : 6, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: mob ? 2 : 0, scrollbarWidth: "none" }}>
{["overview", "filings", "news", "analytics", "calendar"].map((t) => (
<button key={t} onClick={() => setTab(t)} style={pill(tab === t)}>{t === "filings" ? "SEC Filings" : t}</button>
))}
</div>
</div>
</div>

  {/* Data Source Indicator */}
  <div style={{ padding: `8px ${px}px 0`, display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: portfolioSource === "api" ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.08)", borderRadius: 4, border: `1px solid ${portfolioSource === "api" ? "rgba(34,197,94,0.2)" : "rgba(148,163,184,0.1)"}` }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: portfolioSource === "api" ? "#22c55e" : portfolioSource === "error" ? "#f97316" : "#64748b", boxShadow: portfolioSource === "api" ? "0 0 6px rgba(34,197,94,0.4)" : "none" }} />
      <span style={{ fontSize: 9, color: portfolioSource === "api" ? "#86efac" : "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {dataLoading.portfolio ? "Connecting..." : portfolioSource === "api" ? "Live Data" : portfolioSource === "error" ? "Static (API unavailable)" : "Static Data"}
      </span>
    </div>
    {lastRefresh && <span style={{ fontSize: 9, color: "#64748b" }}>Last refresh: {lastRefresh.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>}
  </div>

  {/* ALERT */}
  <div style={{ padding: `16px ${px}px 0` }}>
    <div style={alertBanner}>
      <span style={{ fontSize: 16 }}>{"\u26A0"}</span>
      <div><b>Active Watchlist:</b> {watchCount} of {enrichedPortfolio.length} credits on internal watchlist. Portfolio spans EV, media, energy, consumer, industrial, and steel sectors.</div>
    </div>
  </div>

  {/* KPIs */}
  <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : tablet ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: mob ? 8 : 12, padding: `0 ${px}px 20px` }}>
    {[
      { l: "Credits Tracked", v: enrichedPortfolio.length, accent: "#8b5cf6" },
      { l: "Agency Rated", v: `${enrichedPortfolio.filter(c => c.sp !== "NR").length} / ${enrichedPortfolio.length}`, c: enrichedPortfolio.filter(c => c.sp !== "NR").length === enrichedPortfolio.length ? "#22c55e" : "#eab308", accent: "#eab308" },
      { l: "Neg. / Developing Outlook", v: negOutlook, c: "#ef4444", accent: "#ef4444" },
      { l: "Negative FCF", v: `${negFcfCount} / ${enrichedPortfolio.length}`, c: "#ef4444", accent: "#ef4444" },
    ].map((k, i) => (
      <div key={i} style={{ ...card, position: "relative", overflow: "hidden", transition: "border-color .2s ease, transform .2s ease", animation: dataLoading.portfolio ? "shimmer 1.5s ease infinite" : "none", backgroundImage: dataLoading.portfolio ? "linear-gradient(90deg, transparent 25%, rgba(59,130,246,0.04) 50%, transparent 75%)" : "none", backgroundSize: "200% 100%" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: k.accent || "#3b82f6", opacity: 0.6 }} />
        <div style={{ ...kpiVal, color: k.c || "#f1f5f9", marginTop: 4 }}>{k.v}</div>
        <div style={kpiLabel}>{k.l}</div>
      </div>
    ))}
  </div>

  {tab === "overview" && (
    <div style={{ padding: `0 ${px}px 24px`, minWidth: 0, maxWidth: "100%" }}>
      {/* Search bar */}
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 13, pointerEvents: "none" }}>{"\u{1F50D}"}</span>
          <input type="text" placeholder="Search by ticker, name, sector, or rating..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: "100%", padding: "8px 10px 8px 32px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.15)", background: "rgba(15,22,41,0.8)", color: "#e2e8f0", fontSize: 12, outline: "none", fontFamily: "inherit" }} />
        </div>
        {searchQuery && <button onClick={() => setSearchQuery("")} style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.15)", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>}
        {searchQuery && <span style={{ fontSize: 11, color: "#64748b" }}>{filteredPortfolio.length} of {enrichedPortfolio.length} credits</span>}
      </div>
      {filteredPortfolio.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>{"\u{1F50D}"}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>No portfolio credits match "{searchQuery}"</div>
          {searchQuery.match(/^[A-Za-z]{1,6}$/) ? (
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Look up <b style={{ color: "#60a5fa" }}>{searchQuery.toUpperCase()}</b> as a public company?</div>
              <button onClick={() => lookupTicker(searchQuery)} disabled={adHocLoading} style={{ padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700, border: "1px solid rgba(59,130,246,0.4)", background: "linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.15) 100%)", color: "#60a5fa", cursor: adHocLoading ? "wait" : "pointer", transition: "all .15s ease" }}>
                {adHocLoading ? "\u21BB Generating full analysis..." : `\u{1F50D} Look up ${searchQuery.toUpperCase()}`}
              </button>
              {dataError.lookup && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 8 }}>{"\u26A0"} {dataError.lookup}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Try a ticker symbol (e.g., AAPL, TSLA, MSFT) to look up any public company</div>
              <button onClick={() => setSearchQuery("")} style={{ padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.1)", color: "#60a5fa", cursor: "pointer" }}>Clear Search</button>
            </div>
          )}
        </div>
      ) : mob ? (
        /* ─── MOBILE: Card layout ─── */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredPortfolio.map((c) => (
            <div key={c.id} onClick={() => { navigate(c.id, tab, "financials"); }} style={{ ...card, cursor: "pointer", padding: 16, transition: "border-color .2s ease", borderColor: getWatchlistStatus(c).active ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{c.id}</span>
                  {c.pm && <span style={{ marginLeft: 8, padding: "2px 6px", borderRadius: 8, fontSize: 9, fontWeight: 700, background: "rgba(148,163,184,0.12)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.18)" }}>{c.pm}</span>}
                  {getWatchlistStatus(c).active && <span style={{ color: "#ef4444", fontSize: 11, marginLeft: 6 }}>{"\u26A0"}</span>}
                  {isPubliclyRated(c) ? <span style={{ fontSize: 8, fontWeight: 700, color: "#eab308", background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)", padding: "1px 5px", borderRadius: 3, marginLeft: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>RATED</span> : <span style={{ fontSize: 8, color: "#64748b", marginLeft: 6 }}>NR</span>}
                  <div style={{ fontSize: 10, color: "#64748b" }}>{c.sector}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {isPubliclyRated(c) ? (<>
                    <span style={{ fontWeight: 700, fontSize: 14, color: ratingColor(c.sp) }}>{c.sp}</span>
                    {c.moodys !== "NR" && <span style={{ fontWeight: 600, fontSize: 11, color: ratingColor(c.moodys), marginLeft: 3 }}>/ {c.moodys}</span>}
                    <div style={{ fontSize: 9, color: "#eab308" }}>agency</div>
                  </>) : (<>
                    <span style={{ fontWeight: 700, fontSize: 14, color: ratingColor(c.impliedRating) }}>{c.impliedRating}</span>
                    <div style={{ fontSize: 9, color: "#64748b" }}>implied</div>
                  </>)}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 11, minWidth: 0 }}>
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
              {[["Company","12%","company"],["PM","6%","pm"],["Rating","10%","rating"],["Outlook","10%","outlook"],["CDS 5Y","11%","cds"],["Spread","10%","spread"],["LTM Cash Flow","10%","cashflow"],["Liquidity","10%","liquidity"],["Equity","10%","equity"],["Rev","8%","rev"],["","3%",null]].map(([h,w,col],i) => (
                <th key={i} onClick={col ? () => handleSort(col) : undefined} style={{ width: w, padding: "12px 10px", fontSize: 10, color: sortCol === col ? "#e2e8f0" : "#64748b", borderBottom: "1px solid rgba(148,163,184,0.08)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.8px", textAlign: "left", background: "rgba(6,10,20,0.95)", position: "sticky", top: 0, zIndex: 2, cursor: col ? "pointer" : "default", userSelect: "none", transition: "color .15s ease" }}>{h}{sortCol === col ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPortfolio.map((c) => (
              <tr key={c.id} onClick={() => { navigate(c.id, tab, "financials"); }} style={{ cursor: "pointer", borderBottom: "1px solid rgba(148,163,184,0.06)", transition: "background .15s ease" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(30,41,59,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{c.id} {getWatchlistStatus(c).active && <span style={{ color: "#ef4444", fontSize: 11 }}>{"\u26A0"}</span>}{isPubliclyRated(c) ? <span style={{ fontSize: 8, fontWeight: 700, color: "#eab308", background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)", padding: "1px 5px", borderRadius: 3, marginLeft: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>RATED</span> : <span style={{ fontSize: 8, color: "#64748b", marginLeft: 6 }}>NR</span>}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{c.sector}</div>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "rgba(148,163,184,0.12)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.18)", letterSpacing: "0.5px" }}>{c.pm || "\u2014"}</span>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  {isPubliclyRated(c) ? (<>
                    <span style={{ fontWeight: 700, fontSize: 12, color: ratingColor(c.sp) }}>{c.sp}</span>
                    {c.moodys !== "NR" && <span style={{ fontWeight: 600, fontSize: 10, color: ratingColor(c.moodys), marginLeft: 4 }}>/ {c.moodys}</span>}
                    <div style={{ fontSize: 9, color: "#eab308" }}>agency</div>
                  </>) : (<>
                    <span style={{ fontWeight: 700, fontSize: 12, color: ratingColor(c.impliedRating) }}>{c.impliedRating}</span>
                    <div style={{ fontSize: 9, color: "#64748b" }}>implied</div>
                  </>)}
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
                <td style={{ padding: "10px 8px" }}><Sparkline data={[...c.financials].reverse().map((f) => f.rev)} color="#3b82f6" label={`${c.id} Revenue`} /></td>
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
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Auto-monitored via EDGAR — 8-K, S-3, Form 4, 13D/G, 10-K, 10-Q</div>
          </div>
          <button onClick={fetchSecFilings} disabled={dataLoading.sec} style={{ padding: "6px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700, border: "1px solid #334155", background: dataLoading.sec ? "#1e293b" : "transparent", color: "#94a3b8", cursor: "pointer", transition: "all .15s ease" }}>
            {dataLoading.sec ? "\u21BB Loading..." : "\u21BB Refresh"}
          </button>
        </div>

        {dataLoading.sec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Skeleton w={60} h={20} />
                <div style={{ flex: 1 }}>
                  <Skeleton w="70%" h={12} />
                  <div style={{ marginTop: 6 }}><Skeleton w="40%" h={10} /></div>
                </div>
              </div>
            ))}
          </div>
        )}

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
                <span style={{ color: "#3b82f6", fontWeight: 700, fontSize: 12, cursor: "pointer" }} onClick={() => { navigate(f.ticker, tab, "financials"); }}>{f.ticker}</span>
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
              {enrichedPortfolio.map((c) => {
                const lev = c.ebitda > 0 ? (c.totalDebt / c.ebitda) : null;
                const margin = c.revenue > 0 ? (c.ebitda / c.revenue * 100) : null;
                const cf = ltmAdjCashFlow(c);
                const ws = getWatchlistStatus(c);
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }} onClick={() => { navigate(c.id, tab, "financials"); }}>
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
              {/* Generated (ad-hoc) company row — shown when user has looked up a ticker not in the portfolio */}
              {adHocCompany && (() => {
                const c = adHocCompany;
                const lev = c.ebitda > 0 ? (c.totalDebt / c.ebitda) : null;
                const margin = c.revenue > 0 ? (c.ebitda / c.revenue * 100) : null;
                const cf = c.fcf ?? 0;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer", background: "rgba(59,130,246,0.04)", borderLeft: "3px solid rgba(59,130,246,0.4)" }} onClick={() => { navigate(c.id, tab, "financials"); }}>
                    <td style={{ padding: "8px 6px", fontSize: 12, fontWeight: 700 }}>
                      {c.id}
                      <div style={{ fontSize: 8, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.3px" }}>API generated</div>
                    </td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: lev === null ? "#64748b" : lev > peerBenchmarks.medianLeverage * 1.5 ? "#ef4444" : "#e2e8f0" }}>{lev !== null ? `${lev.toFixed(1)}x` : "N/M"}</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: (c.intCov ?? 0) < 2 ? "#ef4444" : "#e2e8f0" }}>{fmtNum(c.intCov ?? 0)}x</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: margin !== null && margin < 0 ? "#ef4444" : "#e2e8f0" }}>{margin !== null ? `${margin.toFixed(1)}%` : "N/M"}</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: (c.currentRatio ?? 0) < 1 ? "#ef4444" : "#e2e8f0" }}>{fmtNum(c.currentRatio ?? 0)}x</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: cf >= 0 ? "#22c55e" : "#ef4444" }}>{cf >= 0 ? "+" : ""}{fmt(cf * 1e6)}</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, textAlign: "right", color: "#64748b" }}>{"\u2014"}</td>
                  </tr>
                );
              })()}
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
              <div key={ticker} style={{ padding: "12px 14px", background: "rgba(6,10,20,0.6)", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(148,163,184,0.06)", transition: "all .2s ease" }} onClick={() => { navigate(ticker, tab, "financials"); }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,0.2)"; e.currentTarget.style.background = "rgba(15,23,42,0.8)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(148,163,184,0.06)"; e.currentTarget.style.background = "rgba(6,10,20,0.6)"; }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px" }}>{ticker}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>${q.price}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: q.changePct >= 0 ? "#22c55e" : "#ef4444", marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 16, textTransform: "uppercase", letterSpacing: "1px" }}>Portfolio News Feed</div>
        {allNews.map((n, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0", borderBottom: i < allNews.length - 1 ? "1px solid rgba(148,163,184,0.06)" : "none", transition: "background .15s ease" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: sentimentColor(n.sentiment), marginTop: 5, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{n.headline}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                <span style={{ color: "#3b82f6", fontWeight: 600, cursor: "pointer" }} onClick={() => { navigate(n.ticker, tab, "news"); }}>{n.ticker}</span>
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
        {[...enrichedPortfolio].filter(c => c.earningsDate).sort((a, b) => a.earningsDate.localeCompare(b.earningsDate)).map((c, i) => {
          const days = Math.ceil((new Date(c.earningsDate) - now) / (1000 * 60 * 60 * 24));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: i < enrichedPortfolio.length - 1 ? "1px solid #1e293b" : "none", cursor: "pointer" }}
              onClick={() => { navigate(c.id, tab, "earnings"); }}>
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
                <div style={{ fontSize: 12, fontWeight: 600, color: (c.lastEarnings || "").startsWith("Beat") ? "#22c55e" : "#ef4444" }}>{c.lastEarnings.split("\u2014")[0]}</div>
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
