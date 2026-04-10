#!/usr/bin/env node
// scripts/fetch-edgar.mjs
// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR quarterly refresh — Node 20 ESM, zero dependencies.
//
// Fetches the canonical SEC XBRL companyfacts API for each ticker in
// data/cik_map.json, extracts the latest annual (10-K) values for a small set
// of credit-relevant concepts, and writes per-ticker JSON facts files to
// data/edgar_facts/<TICKER>.json with full provenance.
//
// A summary index is written to data/edgar_facts/_index.json so the quarterly
// workflow PR description can summarize what changed without a full diff scan.
//
// ─── Usage ───────────────────────────────────────────────────────────────────
//   node scripts/fetch-edgar.mjs --tickers GT [WSC ...]   # refresh specific
//   node scripts/fetch-edgar.mjs --all                    # refresh everything
//   node scripts/fetch-edgar.mjs --dry-run --tickers GT   # parse, write none
//
// ─── Adding a new ticker ─────────────────────────────────────────────────────
// Tickers not present in data/cik_map.json are resolved on-the-fly via the
// EDGAR `company_tickers.json` directory and the resolved CIK is written back
// to the cik_map cache so subsequent runs (and the Python fetcher, which reads
// the same file) hit the cache directly. To pre-seed a ticker manually:
// 1. Append the ticker → 10-digit zero-padded CIK to data/cik_map.json
// 2. Run:  npm run fetch-edgar -- --tickers NEW
// 3. Inspect data/edgar_facts/NEW.json and commit.
//
// ─── Relationship to other components ────────────────────────────────────────
// - scripts/credit_data_fetcher.py: Python daily data fetcher called by the
//   Vercel cron at /api/refresh. Reads the same data/cik_map.json so there is
//   a single source of truth for ticker→CIK.
// - scripts/edgar_annual_financials.py: Standalone Python EDGAR extractor.
//   This .mjs script mirrors its concept-fallback structure but covers the
//   additional credit-relevant concepts (SBC, InterestPaid, D&A).
// - Follow-up "data refresh" PRs move values from data/edgar_facts/*.json into
//   the hand-curated narrative in src/portfolioData.js via manual review. We
//   deliberately do NOT AST-patch portfolioData.js because it is 1500+ lines
//   of human-authored commentary, news arrays, and analyst Q&A.
//
// ─── SEC EDGAR compliance ────────────────────────────────────────────────────
// - User-Agent must identify the requester (SEC Fair Access policy).
// - Rate limit: 10 requests/sec max. We wait 200ms between tickers.
// - API: https://www.sec.gov/os/accessing-edgar-data
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CIK_MAP_PATH = path.join(REPO_ROOT, "data", "cik_map.json");
const FACTS_DIR = path.join(REPO_ROOT, "data", "edgar_facts");
const INDEX_PATH = path.join(FACTS_DIR, "_index.json");

const USER_AGENT = "CreditRiskMonitor/1.0 (credit.risk@example.com)";
const RATE_LIMIT_MS = 200;
const ANNUAL_FORMS = new Set(["10-K", "10-K/A"]);

// Ordered fallback lists — first tag that returns data wins. Mirrors the
// structure of scripts/edgar_annual_financials.py:99–139.
const CONCEPT_MAP = {
  sbc: [
    "ShareBasedCompensation",
    "AllocatedShareBasedCompensationExpense",
  ],
  cash_interest_paid: [
    "InterestPaidNet",
    "InterestPaid",
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ],
  operating_cash_flow: [
    "NetCashProvidedByUsedInOperatingActivities",
  ],
  depreciation_amortization: [
    "DepreciationAndAmortization",          // IS-level (preferred)
    "Depreciation",
    "DepreciationDepletionAndAmortization", // CF stmt (fallback — may include financing amort)
  ],
};

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { tickers: [], all: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--tickers") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.tickers.push(argv[++i].toUpperCase());
      }
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/fetch-edgar.mjs --tickers GT [WSC ...]
  node scripts/fetch-edgar.mjs --all
  node scripts/fetch-edgar.mjs --dry-run --tickers GT

Flags:
  --tickers <T1> <T2> ...   Tickers to refresh. Unknown tickers are resolved
                            via the SEC EDGAR company_tickers.json directory
                            and the resolved CIK is cached back into cik_map.
  --all                     Refresh every ticker currently in data/cik_map.json
  --dry-run                 Fetch and parse only; do not write any files
  -h, --help                Show this help message`);
}

// ─── EDGAR fetch ─────────────────────────────────────────────────────────────
async function fetchCompanyFacts(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`EDGAR returned ${res.status} ${res.statusText} for CIK ${cik}`);
  }
  return res.json();
}

// ─── Dynamic ticker → CIK resolution ─────────────────────────────────────────
// Falls back to EDGAR's company_tickers.json directory when a ticker isn't in
// the local cik_map.json. Mirrors api/sec_filings.py:ticker_to_cik so the .mjs
// pipeline supports arbitrary SEC-registered US issuers, not just the curated
// portfolio. Resolved CIKs are written back to data/cik_map.json so the next
// run (and the Python fetcher) skip the directory lookup.
let _tickerDirectoryCache = null;
async function fetchTickerDirectory() {
  if (_tickerDirectoryCache) return _tickerDirectoryCache;
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`EDGAR ticker directory returned ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // Build ticker → 10-digit-padded CIK lookup
  const directory = {};
  for (const entry of Object.values(data)) {
    if (!entry?.ticker || entry.cik_str == null) continue;
    directory[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, "0");
  }
  _tickerDirectoryCache = directory;
  return directory;
}

async function resolveCik(ticker, cikMap) {
  if (cikMap[ticker]) return { cik: cikMap[ticker], source: "cik_map" };
  const directory = await fetchTickerDirectory();
  const cik = directory[ticker];
  if (!cik) {
    throw new Error(`ticker not found in EDGAR directory: ${ticker}`);
  }
  return { cik, source: "edgar_directory" };
}

// ─── Concept extraction ──────────────────────────────────────────────────────
// Returns the latest annual (10-K) entry for the first tag that has data, or
// null if none of the fallback tags yield a match. Selects by max `end` date,
// NOT by hardcoded fiscal year — tickers like WSC/UPBD/CENT have non-calendar
// fiscal years.
function extractLatestAnnual(facts, tags) {
  const gaap = facts?.facts?.["us-gaap"];
  if (!gaap) return null;

  for (const tag of tags) {
    const node = gaap[tag];
    if (!node?.units) continue;

    const unitKey = node.units.USD ? "USD" : Object.keys(node.units)[0];
    if (!unitKey) continue;

    // Deduplicate by fiscal year — last writer wins (10-K/A supersedes 10-K)
    const byFy = new Map();
    for (const entry of node.units[unitKey]) {
      if (entry.fp !== "FY") continue;
      if (!ANNUAL_FORMS.has(entry.form)) continue;
      if (entry.fy == null) continue;
      byFy.set(entry.fy, entry);
    }
    if (byFy.size === 0) continue;

    // Pick the latest by `end` date (handles non-calendar filers)
    const latest = [...byFy.values()].sort(
      (a, b) => (b.end || "").localeCompare(a.end || "")
    )[0];

    return {
      value: latest.val,
      value_m: Math.round((latest.val / 1_000_000) * 10) / 10,
      xbrl_concept: tag,
      fy: latest.fy,
      end: latest.end || "",
      form: latest.form || "",
      accession: latest.accn || "",
      filed: latest.filed || "",
      _src: `SEC EDGAR companyfacts API — us-gaap:${tag}, ${latest.form} filed ${latest.filed}`,
    };
  }
  return null;
}

// ─── Per-ticker processing ───────────────────────────────────────────────────
async function processTicker(ticker, cik, { dryRun }) {
  let facts;
  try {
    facts = await fetchCompanyFacts(cik);
  } catch (err) {
    return {
      ticker,
      status: "error",
      error: err.message,
      last_refreshed: new Date().toISOString(),
    };
  }

  const extracted = {};
  const missing = [];
  for (const [field, tags] of Object.entries(CONCEPT_MAP)) {
    const result = extractLatestAnnual(facts, tags);
    if (result) {
      extracted[field] = result;
    } else {
      missing.push(field);
    }
  }

  // Derived metric: FCF = OCF − CapEx (capex is stored as a positive outflow)
  if (extracted.operating_cash_flow && extracted.capex) {
    const ocf = extracted.operating_cash_flow.value;
    const capex = extracted.capex.value;
    extracted.fcf = {
      value: ocf - capex,
      value_m: Math.round(((ocf - capex) / 1_000_000) * 10) / 10,
      xbrl_concept: "derived",
      fy: extracted.operating_cash_flow.fy,
      end: extracted.operating_cash_flow.end,
      form: extracted.operating_cash_flow.form,
      accession: extracted.operating_cash_flow.accession,
      filed: extracted.operating_cash_flow.filed,
      _src: "Derived: NetCashProvidedByUsedInOperatingActivities − PaymentsToAcquirePropertyPlantAndEquipment",
    };
  }

  // Use the latest fiscal period we saw across all concepts as the coverage marker
  const fyCovered = Object.values(extracted)
    .filter((v) => v && typeof v.fy === "number")
    .map((v) => v.fy)
    .reduce((max, fy) => (fy > max ? fy : max), 0) || null;

  const payload = {
    ticker,
    cik,
    entity: facts.entityName || "",
    last_refreshed: new Date().toISOString(),
    fy_covered: fyCovered,
    fields: extracted,
    missing_concepts: missing,
  };

  if (!dryRun) {
    await fs.mkdir(FACTS_DIR, { recursive: true });
    const outPath = path.join(FACTS_DIR, `${ticker}.json`);
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  return {
    ticker,
    status: missing.length === 0 ? "ok" : "partial",
    fy_covered: fyCovered,
    missing_concepts: missing,
    last_refreshed: payload.last_refreshed,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  let cikMap;
  try {
    cikMap = JSON.parse(await fs.readFile(CIK_MAP_PATH, "utf8"));
  } catch (err) {
    console.error(`FATAL: could not read ${CIK_MAP_PATH}: ${err.message}`);
    process.exit(1);
  }

  let targets;
  if (args.all) {
    targets = Object.keys(cikMap);
  } else if (args.tickers.length > 0) {
    targets = args.tickers;
  } else {
    console.error("ERROR: must specify --tickers <...> or --all");
    printHelp();
    process.exit(1);
  }

  console.log(`EDGAR refresh: ${targets.length} ticker(s)${args.dryRun ? " [DRY RUN]" : ""}`);

  // Resolve any tickers missing from cik_map.json via the EDGAR directory.
  // Newly-resolved CIKs are written back to cik_map.json so the next run
  // (and the Python fetcher that reads the same file) hit the cache directly.
  const resolvedNewCiks = {};
  for (const ticker of targets) {
    if (cikMap[ticker]) continue;
    try {
      const { cik, source } = await resolveCik(ticker, cikMap);
      cikMap[ticker] = cik;
      resolvedNewCiks[ticker] = cik;
      console.log(`  ${ticker}: resolved CIK ${cik} via ${source}`);
    } catch (err) {
      console.error(`  ${ticker}: CIK resolution failed — ${err.message}`);
    }
  }
  // Drop any tickers we still couldn't resolve (avoid confusing per-ticker errors below)
  const targetable = targets.filter((t) => cikMap[t]);
  if (targetable.length === 0) {
    console.error("ERROR: no targets could be resolved to a CIK");
    process.exit(1);
  }

  const summaries = [];
  for (const ticker of targetable) {
    const cik = cikMap[ticker];
    process.stdout.write(`  ${ticker} (CIK ${cik}) ... `);
    const summary = await processTicker(ticker, cik, { dryRun: args.dryRun });
    summaries.push(summary);
    if (summary.status === "error") {
      console.log(`ERROR: ${summary.error}`);
    } else if (summary.status === "partial") {
      console.log(`partial (FY${summary.fy_covered}, missing: ${summary.missing_concepts.join(", ")})`);
    } else {
      console.log(`ok (FY${summary.fy_covered})`);
    }
    // Rate limit between tickers (well under SEC's 10 req/sec cap)
    if (ticker !== targets[targets.length - 1]) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  if (!args.dryRun) {
    // Merge summaries into the index (preserve entries for tickers we didn't refresh this run)
    let existingIndex = {};
    try {
      existingIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
    } catch {
      // First run — no existing index
    }
    const nextIndex = { ...existingIndex };
    for (const s of summaries) {
      nextIndex[s.ticker] = s;
    }
    await fs.mkdir(FACTS_DIR, { recursive: true });
    await fs.writeFile(INDEX_PATH, JSON.stringify(nextIndex, null, 2) + "\n", "utf8");

    // Persist any newly-resolved CIKs back to cik_map.json so the next run
    // (and scripts/credit_data_fetcher.py, which reads the same file) hit the
    // cache directly.
    if (Object.keys(resolvedNewCiks).length > 0) {
      const sortedMap = Object.fromEntries(
        Object.entries(cikMap).sort(([a], [b]) => a.localeCompare(b))
      );
      await fs.writeFile(CIK_MAP_PATH, JSON.stringify(sortedMap, null, 2) + "\n", "utf8");
      console.log(
        `\nCached ${Object.keys(resolvedNewCiks).length} new CIK(s) to data/cik_map.json: ${Object.keys(resolvedNewCiks).join(", ")}`
      );
    }
  }

  const errorCount = summaries.filter((s) => s.status === "error").length;
  if (errorCount > 0) {
    console.error(`\n${errorCount} ticker(s) failed.`);
    process.exit(1);
  }
  console.log(`\nDone.${args.dryRun ? " (no files written)" : ""}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
