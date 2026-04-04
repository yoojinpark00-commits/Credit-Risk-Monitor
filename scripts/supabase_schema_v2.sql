-- ═══════════════════════════════════════════════════════════════
-- Credit Risk Monitor — Schema V2: Dynamic Ticker Support
-- Run this AFTER the original supabase_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. Company Registry
--    Replaces the hardcoded TICKERS list. Every company the system
--    knows about lives here. "portfolio" companies are monitored
--    on the refresh cron; "ad-hoc" companies were searched once.
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_registry (
    ticker          VARCHAR(10) PRIMARY KEY,
    name            TEXT,
    sector          TEXT,
    exchange        VARCHAR(20),
    cik             VARCHAR(20),          -- SEC Central Index Key
    is_portfolio    BOOLEAN NOT NULL DEFAULT FALSE,
    is_public       BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE for BEUSA, JSWUSA etc.
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by        VARCHAR(100) NOT NULL DEFAULT 'system',
    removed_at      TIMESTAMPTZ,          -- soft-delete: set this instead of deleting
    notes           TEXT
);

COMMENT ON TABLE company_registry IS
    'Canonical list of every company the system tracks or has ever searched.';

-- Indexes for company_registry
CREATE INDEX IF NOT EXISTS idx_company_portfolio
    ON company_registry (is_portfolio) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_company_sector
    ON company_registry (sector) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_company_cik
    ON company_registry (cik) WHERE cik IS NOT NULL;

-- ───────────────────────────────────────────────────────────────
-- 2. Ticker Metadata Cache
--    Stores basic company info fetched from FMP/Yahoo/EDGAR so we
--    don't re-fetch it on every search or dashboard load.
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ticker_metadata_cache (
    ticker          VARCHAR(10) PRIMARY KEY REFERENCES company_registry(ticker),
    company_name    TEXT,
    sector          TEXT,
    industry        TEXT,
    exchange        VARCHAR(20),
    market_cap      NUMERIC,
    currency        VARCHAR(10) DEFAULT 'USD',
    country         VARCHAR(50),
    description     TEXT,
    website         TEXT,
    logo_url        TEXT,
    employees       INTEGER,
    ipo_date        DATE,
    raw_json        JSONB,               -- full API response for anything else
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

COMMENT ON TABLE ticker_metadata_cache IS
    'Cached company metadata from external APIs. Expires after 7 days by default.';

CREATE INDEX IF NOT EXISTS idx_metadata_expires
    ON ticker_metadata_cache (expires_at)
    WHERE expires_at < NOW();  -- partial index for cleanup queries

-- ───────────────────────────────────────────────────────────────
-- 3. Search History
--    Tracks every ticker search for "recently viewed" and analytics.
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS search_history (
    id              BIGSERIAL PRIMARY KEY,
    ticker          VARCHAR(10) NOT NULL REFERENCES company_registry(ticker),
    searched_by     VARCHAR(100) NOT NULL DEFAULT 'anon',
    session_id      TEXT,                 -- browser session for anon grouping
    searched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE search_history IS
    'Log of every ticker search. Powers "recently viewed" and usage analytics.';

CREATE INDEX IF NOT EXISTS idx_search_by_user
    ON search_history (searched_by, searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_recent
    ON search_history (searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_ticker
    ON search_history (ticker, searched_at DESC);

-- ───────────────────────────────────────────────────────────────
-- 4. Data Freshness Tracking
--    One row per ticker: when was data last fetched, when should
--    it be refreshed next, and what was the outcome.
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_freshness (
    ticker              VARCHAR(10) PRIMARY KEY REFERENCES company_registry(ticker),
    last_fetched_at     TIMESTAMPTZ,
    last_fetch_status   VARCHAR(20) DEFAULT 'pending'
                            CHECK (last_fetch_status IN (
                                'pending', 'success', 'partial', 'error'
                            )),
    last_error_message  TEXT,
    next_refresh_at     TIMESTAMPTZ,
    refresh_interval    INTERVAL NOT NULL DEFAULT INTERVAL '24 hours',
    -- Partial data source tracking (requirement 5)
    has_edgar           BOOLEAN NOT NULL DEFAULT FALSE,
    has_fmp             BOOLEAN NOT NULL DEFAULT FALSE,
    has_yahoo           BOOLEAN NOT NULL DEFAULT FALSE,
    has_ratings         BOOLEAN NOT NULL DEFAULT FALSE,
    -- Per-source timestamps for fine-grained staleness
    edgar_fetched_at    TIMESTAMPTZ,
    fmp_fetched_at      TIMESTAMPTZ,
    yahoo_fetched_at    TIMESTAMPTZ,
    ratings_fetched_at  TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE data_freshness IS
    'Tracks when each ticker was last fetched, per-source availability, and next refresh time.';

CREATE INDEX IF NOT EXISTS idx_freshness_next_refresh
    ON data_freshness (next_refresh_at ASC)
    WHERE last_fetch_status != 'pending';

CREATE INDEX IF NOT EXISTS idx_freshness_stale
    ON data_freshness (next_refresh_at)
    WHERE next_refresh_at < NOW();

-- ───────────────────────────────────────────────────────────────
-- 5. Modifications to Existing Tables
--    Add FK references so portfolio_data, manual_overrides, and
--    audit_log relate to the company registry.
-- ───────────────────────────────────────────────────────────────

-- Add foreign keys. These are safe even with existing data as long
-- as the migration seed (below) runs first.
-- NOTE: We use DO blocks to make these idempotent.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_portfolio_data_ticker'
    ) THEN
        ALTER TABLE portfolio_data
            ADD CONSTRAINT fk_portfolio_data_ticker
            FOREIGN KEY (ticker) REFERENCES company_registry(ticker);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_manual_overrides_ticker'
    ) THEN
        ALTER TABLE manual_overrides
            ADD CONSTRAINT fk_manual_overrides_ticker
            FOREIGN KEY (ticker) REFERENCES company_registry(ticker);
    END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 6. Updated View: Latest Portfolio with Freshness
--    Replaces the old latest_portfolio view, joining freshness.
-- ───────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW latest_portfolio AS
SELECT DISTINCT ON (pd.ticker, pd.fiscal_year)
    pd.id,
    pd.ticker,
    cr.name          AS company_name,
    cr.sector,
    cr.is_portfolio,
    cr.is_public,
    pd.fiscal_year,
    pd.data_json,
    pd.fetched_at,
    pd.created_at,
    df.last_fetch_status,
    df.has_edgar,
    df.has_fmp,
    df.has_yahoo,
    df.has_ratings,
    df.next_refresh_at,
    CASE
        WHEN df.next_refresh_at IS NULL THEN 'unknown'
        WHEN df.next_refresh_at < NOW() THEN 'stale'
        ELSE 'fresh'
    END AS freshness_status
FROM portfolio_data pd
LEFT JOIN company_registry cr ON cr.ticker = pd.ticker
LEFT JOIN data_freshness df   ON df.ticker = pd.ticker
WHERE cr.removed_at IS NULL
ORDER BY pd.ticker, pd.fiscal_year, pd.fetched_at DESC;

-- View: Companies due for refresh (used by the cron job)
CREATE OR REPLACE VIEW companies_due_refresh AS
SELECT
    cr.ticker,
    cr.name,
    cr.is_public,
    df.last_fetched_at,
    df.last_fetch_status,
    df.next_refresh_at,
    df.has_edgar,
    df.has_fmp,
    df.has_yahoo,
    df.has_ratings
FROM company_registry cr
LEFT JOIN data_freshness df ON df.ticker = cr.ticker
WHERE cr.is_portfolio = TRUE
  AND cr.removed_at IS NULL
  AND (
      df.next_refresh_at IS NULL          -- never fetched
      OR df.next_refresh_at <= NOW()      -- overdue
  )
ORDER BY df.next_refresh_at ASC NULLS FIRST;

-- View: Recently searched tickers (last 50, deduplicated)
CREATE OR REPLACE VIEW recently_searched AS
SELECT DISTINCT ON (sh.ticker)
    sh.ticker,
    cr.name AS company_name,
    cr.sector,
    cr.is_portfolio,
    sh.searched_at
FROM search_history sh
JOIN company_registry cr ON cr.ticker = sh.ticker
WHERE cr.removed_at IS NULL
ORDER BY sh.ticker, sh.searched_at DESC;

-- Wrap in a subquery to get the truly recent ones, ordered by time
-- (DISTINCT ON forces ordering by ticker first)
CREATE OR REPLACE VIEW recently_searched AS
SELECT * FROM (
    SELECT DISTINCT ON (sh.ticker)
        sh.ticker,
        cr.name AS company_name,
        cr.sector,
        cr.is_portfolio,
        sh.searched_at
    FROM search_history sh
    JOIN company_registry cr ON cr.ticker = sh.ticker
    WHERE cr.removed_at IS NULL
    ORDER BY sh.ticker, sh.searched_at DESC
) sub
ORDER BY searched_at DESC
LIMIT 50;

-- ───────────────────────────────────────────────────────────────
-- 7. Row Level Security for New Tables
-- ───────────────────────────────────────────────────────────────

ALTER TABLE company_registry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticker_metadata_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_freshness         ENABLE ROW LEVEL SECURITY;

-- company_registry: anyone can read, only service_role can mutate
CREATE POLICY "anon_read_company_registry" ON company_registry
    FOR SELECT USING (true);

CREATE POLICY "service_insert_company_registry" ON company_registry
    FOR INSERT WITH CHECK (
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

CREATE POLICY "service_update_company_registry" ON company_registry
    FOR UPDATE USING (
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

-- ticker_metadata_cache: anyone can read, only service_role can mutate
CREATE POLICY "anon_read_metadata_cache" ON ticker_metadata_cache
    FOR SELECT USING (true);

CREATE POLICY "service_upsert_metadata_cache" ON ticker_metadata_cache
    FOR ALL USING (
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

-- search_history: anyone can insert (for search tracking), only
-- authenticated can read (for recently-viewed)
CREATE POLICY "anon_insert_search_history" ON search_history
    FOR INSERT WITH CHECK (true);

CREATE POLICY "authenticated_read_search_history" ON search_history
    FOR SELECT USING (
        current_setting('request.jwt.claim.role', true) != 'anon'
        OR TRUE   -- allow anon reads too for "recently viewed" on dashboard
    );

-- data_freshness: anyone can read, only service_role can mutate
CREATE POLICY "anon_read_data_freshness" ON data_freshness
    FOR SELECT USING (true);

CREATE POLICY "service_mutate_data_freshness" ON data_freshness
    FOR ALL USING (
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

-- ───────────────────────────────────────────────────────────────
-- 8. Helper Functions
-- ───────────────────────────────────────────────────────────────

-- Upsert a company into the registry (called when a user searches
-- a new ticker, or when adding to portfolio)
CREATE OR REPLACE FUNCTION upsert_company(
    p_ticker    VARCHAR(10),
    p_name      TEXT DEFAULT NULL,
    p_sector    TEXT DEFAULT NULL,
    p_exchange  VARCHAR(20) DEFAULT NULL,
    p_cik       VARCHAR(20) DEFAULT NULL,
    p_is_portfolio BOOLEAN DEFAULT FALSE,
    p_is_public BOOLEAN DEFAULT TRUE,
    p_added_by  VARCHAR(100) DEFAULT 'system'
)
RETURNS company_registry
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result company_registry;
BEGIN
    INSERT INTO company_registry (ticker, name, sector, exchange, cik,
                                  is_portfolio, is_public, added_by)
    VALUES (p_ticker, p_name, p_sector, p_exchange, p_cik,
            p_is_portfolio, p_is_public, p_added_by)
    ON CONFLICT (ticker) DO UPDATE SET
        name         = COALESCE(EXCLUDED.name, company_registry.name),
        sector       = COALESCE(EXCLUDED.sector, company_registry.sector),
        exchange     = COALESCE(EXCLUDED.exchange, company_registry.exchange),
        cik          = COALESCE(EXCLUDED.cik, company_registry.cik),
        is_portfolio = GREATEST(EXCLUDED.is_portfolio, company_registry.is_portfolio),
        is_public    = EXCLUDED.is_public,
        removed_at   = NULL  -- re-activate if previously soft-deleted
    RETURNING * INTO result;

    -- Ensure a data_freshness row exists
    INSERT INTO data_freshness (ticker)
    VALUES (p_ticker)
    ON CONFLICT (ticker) DO NOTHING;

    RETURN result;
END;
$$;

-- Record a completed fetch and update freshness
CREATE OR REPLACE FUNCTION record_fetch_complete(
    p_ticker            VARCHAR(10),
    p_status            VARCHAR(20),
    p_error_message     TEXT DEFAULT NULL,
    p_has_edgar         BOOLEAN DEFAULT FALSE,
    p_has_fmp           BOOLEAN DEFAULT FALSE,
    p_has_yahoo         BOOLEAN DEFAULT FALSE,
    p_has_ratings       BOOLEAN DEFAULT FALSE
)
RETURNS data_freshness
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result data_freshness;
BEGIN
    UPDATE data_freshness SET
        last_fetched_at    = NOW(),
        last_fetch_status  = p_status,
        last_error_message = p_error_message,
        next_refresh_at    = NOW() + refresh_interval,
        has_edgar          = p_has_edgar,
        has_fmp            = p_has_fmp,
        has_yahoo          = p_has_yahoo,
        has_ratings        = p_has_ratings,
        edgar_fetched_at   = CASE WHEN p_has_edgar  THEN NOW() ELSE edgar_fetched_at  END,
        fmp_fetched_at     = CASE WHEN p_has_fmp    THEN NOW() ELSE fmp_fetched_at    END,
        yahoo_fetched_at   = CASE WHEN p_has_yahoo  THEN NOW() ELSE yahoo_fetched_at  END,
        ratings_fetched_at = CASE WHEN p_has_ratings THEN NOW() ELSE ratings_fetched_at END,
        updated_at         = NOW()
    WHERE ticker = p_ticker
    RETURNING * INTO result;

    RETURN result;
END;
$$;

-- Prune old search history (keep last 90 days)
CREATE OR REPLACE FUNCTION prune_search_history()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM search_history
    WHERE searched_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- 9. Migration Seed: Insert Current Hardcoded Tickers
--    This must run before FK constraints are applied.
-- ───────────────────────────────────────────────────────────────

-- Public portfolio companies (from api/portfolio.py and api/refresh.py)
INSERT INTO company_registry (ticker, name, is_portfolio, is_public, added_by) VALUES
    ('LCID',   'Lucid Group, Inc.',                TRUE, TRUE,  'migration_v2'),
    ('RIVN',   'Rivian Automotive, Inc.',           TRUE, TRUE,  'migration_v2'),
    ('CENT',   'Central Garden & Pet Co.',          TRUE, TRUE,  'migration_v2'),
    ('IHRT',   'iHeartMedia, Inc.',                 TRUE, TRUE,  'migration_v2'),
    ('SMC',    'Smile Brands Group, Inc.',          TRUE, TRUE,  'migration_v2'),
    ('UPBD',   'Upbound Group, Inc.',               TRUE, TRUE,  'migration_v2'),
    ('WSC',    'WillScot Holdings Corporation',     TRUE, TRUE,  'migration_v2')
ON CONFLICT (ticker) DO UPDATE SET
    is_portfolio = TRUE,
    removed_at = NULL;

-- Private portfolio companies
INSERT INTO company_registry (ticker, name, is_portfolio, is_public, added_by) VALUES
    ('BEUSA',  'BE Semiconductor Industries (US)',  TRUE, FALSE, 'migration_v2'),
    ('JSWUSA', 'JSW Steel (USA)',                   TRUE, FALSE, 'migration_v2')
ON CONFLICT (ticker) DO UPDATE SET
    is_portfolio = TRUE,
    is_public = FALSE,
    removed_at = NULL;

-- Seed data_freshness rows for all portfolio companies
INSERT INTO data_freshness (ticker, last_fetch_status)
SELECT ticker, 'pending'
FROM company_registry
WHERE is_portfolio = TRUE
ON CONFLICT (ticker) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- 10. Trigger: Auto-update updated_at on data_freshness
-- ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_data_freshness_updated_at
    BEFORE UPDATE ON data_freshness
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────
-- Done. Summary of changes:
--
--   NEW TABLES:
--     company_registry       — replaces hardcoded TICKERS lists
--     ticker_metadata_cache  — caches FMP/Yahoo company info
--     search_history         — powers "recently viewed"
--     data_freshness         — staleness + partial data tracking
--
--   MODIFIED:
--     portfolio_data     — FK to company_registry
--     manual_overrides   — FK to company_registry
--     latest_portfolio   — view now joins freshness + registry
--
--   NEW VIEWS:
--     companies_due_refresh  — cron job picks up stale tickers
--     recently_searched      — last 50 unique tickers searched
--
--   NEW FUNCTIONS:
--     upsert_company()          — add/update a company
--     record_fetch_complete()   — mark a fetch done + update sources
--     prune_search_history()    — cleanup old search rows
--
-- ═══════════════════════════════════════════════════════════════
