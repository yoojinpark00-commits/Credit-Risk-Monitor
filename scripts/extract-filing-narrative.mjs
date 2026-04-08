#!/usr/bin/env node
// scripts/extract-filing-narrative.mjs
// ─────────────────────────────────────────────────────────────────────────────
// SEC filing narrative extractor — Node 20 ESM, zero npm dependencies, uses
// Claude API for structured extraction of filing narrative content (EBITDA
// reconciliation tables, debt maturity schedules, earnings call summaries)
// that XBRL companyfacts cannot capture.
//
// Phase 3 of the "search any ticker → dashboard" scaling effort. While
// scripts/fetch-edgar.mjs handles the structured XBRL layer (revenue,
// SBC, capex, FCF, etc.), this script handles the unstructured narrative
// layer that requires LLM extraction.
//
// ─── Output ──────────────────────────────────────────────────────────────────
// Per-filing JSON cached at:
//   data/narrative_cache/<TICKER>/<accession>.json
//
// Schema:
//   {
//     ticker, cik, accession, form, filing_date, primary_doc, source_url,
//     extracted_at, extracted_by, model,
//     reconciliationItems: [{label, amount, src}],   // adjBurn.reconciliationItems
//     debtMaturities:      [{year, amount, desc}],   // liquidityBreakdown.debtMaturities
//     earningsCallSummary: { quarter, source, keyFinancials, creditRelevant,
//                            strategicItems, analystQA }
//   }
//
// A summary index is written to data/narrative_cache/_index.json keyed by
// ticker.
//
// ─── Usage ───────────────────────────────────────────────────────────────────
//   node scripts/extract-filing-narrative.mjs --ticker GT
//   node scripts/extract-filing-narrative.mjs --ticker GT --accession 0000046104-26-000012
//   node scripts/extract-filing-narrative.mjs --all
//   node scripts/extract-filing-narrative.mjs --ticker GT --dry-run    # download + parse only
//
// Flags:
//   --ticker <T>           Single ticker to extract.
//   --all                  Every ticker in data/cik_map.json.
//   --accession <A>        Specific accession number (default: latest 10-K).
//   --form <F>             Form type to look for (default: 10-K). Try 10-Q for quarterly.
//   --dry-run              Download and parse the filing but skip the Claude API call
//                          and don't write any cache files.
//   --force                Re-extract even if a cache file already exists.
//   --max-chars <N>        Truncate the filing text before sending to Claude (default 350000).
//   -h, --help             Show this help message.
//
// ─── Environment ─────────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY      Required (unless --dry-run). Reads from process.env.
//   CLAUDE_MODEL           Optional override (default: claude-sonnet-4-6).
//
// ─── Relationship to other components ────────────────────────────────────────
// - scripts/fetch-edgar.mjs: produces structured XBRL facts cache.
// - api/company.py: reads data/narrative_cache/<TICKER>/<latest>.json (if
//   present) and merges reconciliationItems / debtMaturities /
//   earningsCallSummary into the /api/company response.
// - .github/workflows/edgar-quarterly-refresh.yml: runs both fetch-edgar.mjs
//   and this script back-to-back, then opens a single PR with both caches.
//
// ─── SEC EDGAR compliance ────────────────────────────────────────────────────
// - User-Agent must identify the requester (SEC Fair Access policy).
// - Rate limit: 10 req/sec. We wait 200ms between filings.
// - Filing archive URLs: https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{file}
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CIK_MAP_PATH = path.join(REPO_ROOT, "data", "cik_map.json");
const NARRATIVE_DIR = path.join(REPO_ROOT, "data", "narrative_cache");
const NARRATIVE_INDEX_PATH = path.join(NARRATIVE_DIR, "_index.json");

const USER_AGENT = "CreditRiskMonitor/1.0 (credit.risk@example.com)";
const RATE_LIMIT_MS = 200;
const DEFAULT_MAX_CHARS = 350_000;     // ~85k tokens worst-case → fits Sonnet's 200k context
const DEFAULT_FORM = "10-K";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    ticker: null,
    all: false,
    accession: null,
    form: DEFAULT_FORM,
    dryRun: false,
    force: false,
    maxChars: DEFAULT_MAX_CHARS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--ticker") args.ticker = (argv[++i] || "").toUpperCase();
    else if (a === "--accession") args.accession = argv[++i] || null;
    else if (a === "--form") args.form = argv[++i] || DEFAULT_FORM;
    else if (a === "--max-chars") args.maxChars = parseInt(argv[++i] || `${DEFAULT_MAX_CHARS}`, 10);
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/extract-filing-narrative.mjs --ticker GT
  node scripts/extract-filing-narrative.mjs --all
  node scripts/extract-filing-narrative.mjs --ticker GT --accession 0000046104-26-000012
  node scripts/extract-filing-narrative.mjs --ticker GT --dry-run

Flags:
  --ticker <T>     Single ticker to extract.
  --all            Every ticker in data/cik_map.json.
  --accession <A>  Specific accession (default: latest matching --form).
  --form <F>       Form to look for (default: 10-K).
  --dry-run        Download and parse only; skip Claude API call.
  --force          Re-extract even if a cache file already exists.
  --max-chars <N>  Truncate filing text before LLM call (default ${DEFAULT_MAX_CHARS}).
  -h, --help       Show this help message.

Environment:
  ANTHROPIC_API_KEY   Required unless --dry-run.
  CLAUDE_MODEL        Optional override (default: ${CLAUDE_MODEL}).`);
}

// ─── EDGAR fetch helpers ─────────────────────────────────────────────────────
async function edgarFetch(url, accept = "application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": accept },
  });
  if (!res.ok) {
    throw new Error(`EDGAR ${res.status} ${res.statusText} for ${url}`);
  }
  return accept === "application/json" ? res.json() : res.text();
}

let _tickerDirectoryCache = null;
async function fetchTickerDirectory() {
  if (_tickerDirectoryCache) return _tickerDirectoryCache;
  const data = await edgarFetch("https://www.sec.gov/files/company_tickers.json");
  const directory = {};
  for (const entry of Object.values(data)) {
    if (!entry?.ticker || entry.cik_str == null) continue;
    directory[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, "0");
  }
  _tickerDirectoryCache = directory;
  return directory;
}

async function resolveCik(ticker, cikMap) {
  if (cikMap[ticker]) return cikMap[ticker];
  const directory = await fetchTickerDirectory();
  const cik = directory[ticker];
  if (!cik) throw new Error(`ticker not found in EDGAR directory: ${ticker}`);
  return cik;
}

// ─── Find latest filing of a given form ──────────────────────────────────────
async function findFiling(cik, form, explicitAccession) {
  const submissions = await edgarFetch(
    `https://data.sec.gov/submissions/CIK${cik}.json`
  );
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) {
    throw new Error("submissions endpoint returned no recent filings");
  }
  // Search across the entire `recent` block. EDGAR returns filings
  // newest-first so the first match is the latest.
  for (let i = 0; i < recent.form.length; i++) {
    const accession = recent.accessionNumber[i];
    if (explicitAccession && accession !== explicitAccession) continue;
    if (!explicitAccession && recent.form[i] !== form) continue;
    return {
      accession,
      form: recent.form[i],
      filing_date: recent.filingDate[i] || "",
      primary_doc: recent.primaryDocument[i] || "",
      report_date: recent.reportDate?.[i] || "",
      entity: submissions.name || "",
    };
  }
  throw new Error(
    explicitAccession
      ? `accession ${explicitAccession} not found in recent submissions`
      : `no ${form} filings found in recent submissions`
  );
}

function buildArchiveUrl(cik, accession, primaryDoc) {
  // CIK in archive paths is *not* zero-padded; accession has hyphens stripped.
  const cikInt = String(parseInt(cik, 10));
  const accNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${primaryDoc}`;
}

// ─── Naive HTML → plain text (zero-deps) ─────────────────────────────────────
// Good enough as input to Claude. Strips tags, decodes a small set of common
// entities, normalizes whitespace, and preserves table layout reasonably by
// keeping line breaks at block-level boundaries.
function htmlToText(html) {
  // Drop script/style/svg blocks entirely
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");
  // Convert block-level closers to newlines so paragraphs survive
  s = s.replace(/<\/(p|div|tr|table|h[1-6]|li|br|td|th)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common entities (no need for a full DOMParser)
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Collapse runs of whitespace; preserve paragraph breaks
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ─── Claude API call ─────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are a credit analyst extracting structured data from a SEC filing.
Extract THREE sections from the filing text below and return ONLY valid JSON
with no commentary, no markdown fences, no preamble.

Required JSON shape (use null for any section the filing doesn't disclose):

{
  "reconciliationItems": [
    {"label": "Goodwill Impairment", "amount": 674, "src": "10-K Item 7 non-GAAP reconciliation table"}
  ],
  "debtMaturities": [
    {"year": "2026", "amount": 248, "desc": "Current portion of long-term debt"}
  ],
  "earningsCallSummary": {
    "quarter": "Q4 FY2025",
    "source": "10-K Item 7 MD&A",
    "keyFinancials": ["Revenue of $18.3B, down 3.1% YoY", "Adjusted EBITDA of $2.0B"],
    "creditRelevant": ["Total debt reduced $1.58B YoY to $6.2B", "Net leverage 2.7x"],
    "strategicItems": ["Goodyear Forward program at $1.5B run-rate", "Completed divestitures"],
    "analystQA": []
  }
}

EXTRACTION RULES:
1. reconciliationItems: ONLY items explicitly listed in a non-GAAP reconciliation
   table (GAAP→Adjusted EBITDA walk, GAAP→Adjusted EPS walk, etc). Amounts in
   USD millions, integers. Include the SIGN as it appears in the bridge: gains
   are negative (subtracted from GAAP), charges are positive (added back). Do
   NOT invent items or compute derivations. If no reconciliation table is
   disclosed, return [].
2. debtMaturities: ONLY rows from a debt maturity schedule (typically in the
   long-term debt footnote or contractual obligations table). Amounts in USD
   millions, integers. Year as a string ("2026", "2027", "After 5 years").
   Description from the filing's own labeling. Return [] if absent.
3. earningsCallSummary: 2-5 bullet points per array, drawn from the MD&A
   discussion of results, liquidity, and strategy. Each bullet is a single
   sentence under 100 characters. analystQA stays [] (transcripts aren't on
   EDGAR). Return null if the filing has no MD&A discussion.
4. NEVER fabricate numbers. If you can't find a value in the text below,
   omit that item or return null/[].
5. Return ONLY the JSON object. No \`\`\`json fences. No "Here is...".

FILING TEXT:
`;

async function callClaudeExtraction(filingText, apiKey) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT + filingText,
      },
    ],
  };
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  // Concatenate any text content blocks (Claude returns an array of blocks)
  const text = (json.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("Claude returned empty content");
  }
  // Defensive: strip ```json ``` fences if the model included them
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Claude returned non-JSON content: ${err.message}\n--- raw ---\n${text.slice(0, 800)}`);
  }
  return {
    parsed,
    usage: json.usage || null,
    stop_reason: json.stop_reason || null,
  };
}

// ─── Per-ticker processing ───────────────────────────────────────────────────
async function processTicker(ticker, cik, args) {
  const filing = await findFiling(cik, args.form, args.accession);
  const accNoDash = filing.accession.replace(/-/g, "");
  const cacheDir = path.join(NARRATIVE_DIR, ticker);
  const cachePath = path.join(cacheDir, `${accNoDash}.json`);

  // Skip if cache exists and not --force
  if (!args.force) {
    try {
      await fs.access(cachePath);
      return {
        ticker,
        status: "cached",
        accession: filing.accession,
        cache_path: path.relative(REPO_ROOT, cachePath),
      };
    } catch {
      // not cached → proceed
    }
  }

  const sourceUrl = buildArchiveUrl(cik, filing.accession, filing.primary_doc);
  const html = await edgarFetch(sourceUrl, "text/html");
  const text = htmlToText(html);
  const truncated = text.length > args.maxChars;
  const filingText = truncated ? text.slice(0, args.maxChars) : text;

  if (args.dryRun) {
    return {
      ticker,
      status: "dry_run",
      accession: filing.accession,
      form: filing.form,
      filing_date: filing.filing_date,
      source_url: sourceUrl,
      raw_chars: text.length,
      sent_chars: filingText.length,
      truncated,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Use --dry-run to test the download/parse path without calling Claude."
    );
  }

  const { parsed, usage } = await callClaudeExtraction(filingText, apiKey);

  const payload = {
    ticker,
    cik,
    accession: filing.accession,
    form: filing.form,
    filing_date: filing.filing_date,
    report_date: filing.report_date,
    primary_doc: filing.primary_doc,
    source_url: sourceUrl,
    extracted_at: new Date().toISOString(),
    extracted_by: "scripts/extract-filing-narrative.mjs",
    model: CLAUDE_MODEL,
    raw_chars: text.length,
    sent_chars: filingText.length,
    truncated,
    usage,
    reconciliationItems: parsed.reconciliationItems ?? [],
    debtMaturities: parsed.debtMaturities ?? [],
    earningsCallSummary: parsed.earningsCallSummary ?? null,
  };

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  return {
    ticker,
    status: "extracted",
    accession: filing.accession,
    form: filing.form,
    filing_date: filing.filing_date,
    cache_path: path.relative(REPO_ROOT, cachePath),
    recon_items: payload.reconciliationItems.length,
    debt_rows: payload.debtMaturities.length,
    has_earnings_summary: payload.earningsCallSummary != null,
    truncated,
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
  } else if (args.ticker) {
    targets = [args.ticker];
  } else {
    console.error("ERROR: must specify --ticker <T> or --all");
    printHelp();
    process.exit(1);
  }

  console.log(
    `Narrative extraction: ${targets.length} ticker(s) | form=${args.form}` +
      `${args.dryRun ? " [DRY RUN — no Claude calls]" : ""}` +
      `${args.force ? " [FORCE re-extract]" : ""}`
  );

  const summaries = [];
  for (const ticker of targets) {
    process.stdout.write(`  ${ticker} ... `);
    try {
      const cik = await resolveCik(ticker, cikMap);
      const summary = await processTicker(ticker, cik, args);
      summaries.push(summary);
      if (summary.status === "cached") {
        console.log(`cached (${summary.accession})`);
      } else if (summary.status === "dry_run") {
        console.log(
          `dry-run ok (${summary.accession}, ${summary.raw_chars} chars` +
            `${summary.truncated ? `, truncated to ${summary.sent_chars}` : ""})`
        );
      } else {
        console.log(
          `extracted (${summary.recon_items} recon, ${summary.debt_rows} maturities` +
            `${summary.has_earnings_summary ? ", call summary" : ""})`
        );
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      summaries.push({ ticker, status: "error", error: err.message });
    }
    if (ticker !== targets[targets.length - 1]) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Update the per-ticker index (newest extraction wins)
  if (!args.dryRun) {
    let index = {};
    try {
      index = JSON.parse(await fs.readFile(NARRATIVE_INDEX_PATH, "utf8"));
    } catch {
      // first run
    }
    for (const s of summaries) {
      if (s.status === "extracted" || s.status === "cached") {
        index[s.ticker] = {
          accession: s.accession,
          form: s.form || index[s.ticker]?.form || args.form,
          cache_path: s.cache_path,
          updated_at: new Date().toISOString(),
        };
      }
    }
    await fs.mkdir(NARRATIVE_DIR, { recursive: true });
    await fs.writeFile(
      NARRATIVE_INDEX_PATH,
      JSON.stringify(index, null, 2) + "\n",
      "utf8"
    );
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
