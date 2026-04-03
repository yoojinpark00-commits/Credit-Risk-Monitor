-- ═══════════════════════════════════════════════════════════════
-- Credit Risk Monitor — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- Portfolio data snapshots (one row per ticker per fetch)
CREATE TABLE IF NOT EXISTS portfolio_data (
    id          BIGSERIAL PRIMARY KEY,
    ticker      VARCHAR(10) NOT NULL,
    fiscal_year INTEGER NOT NULL,
    data_json   JSONB NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_ticker_fy
    ON portfolio_data (ticker, fiscal_year, fetched_at DESC);

-- Manual overrides (analyst corrections to computed values)
CREATE TABLE IF NOT EXISTS manual_overrides (
    id              BIGSERIAL PRIMARY KEY,
    ticker          VARCHAR(10) NOT NULL,
    fiscal_year     INTEGER NOT NULL,
    field_name      VARCHAR(100) NOT NULL,
    original_value  NUMERIC,
    override_value  NUMERIC NOT NULL,
    source_citation TEXT NOT NULL,
    reason          TEXT,
    created_by      VARCHAR(100) NOT NULL DEFAULT 'analyst',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Audit log for all data changes
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    action      VARCHAR(50) NOT NULL,
    ticker      VARCHAR(10),
    details     JSONB,
    user_id     VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security (enable in Supabase Dashboard → Auth → Policies)
ALTER TABLE portfolio_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Allow anon read access to portfolio data (for the dashboard)
CREATE POLICY "Allow anon read" ON portfolio_data
    FOR SELECT USING (true);

-- Allow service role to insert (for the cron job)
CREATE POLICY "Allow service insert" ON portfolio_data
    FOR INSERT WITH CHECK (true);

-- Allow anon read on overrides
CREATE POLICY "Allow anon read overrides" ON manual_overrides
    FOR SELECT USING (true);

-- Allow anon read on audit log
CREATE POLICY "Allow anon read audit" ON audit_log
    FOR SELECT USING (true);

-- View: Latest portfolio data per ticker (most recent fetch)
CREATE OR REPLACE VIEW latest_portfolio AS
SELECT DISTINCT ON (ticker, fiscal_year)
    id, ticker, fiscal_year, data_json, fetched_at, created_at
FROM portfolio_data
ORDER BY ticker, fiscal_year, fetched_at DESC;

-- Prevent duplicate fetches within the same minute
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_no_dupe
    ON portfolio_data (ticker, fiscal_year, date_trunc('minute', fetched_at));
