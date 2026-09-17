
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS migration_runs (
  migration_run_id UUID PRIMARY KEY,
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_size_bytes BIGINT NOT NULL,
  source_sheet_count INTEGER NOT NULL,
  source_row_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','APPLIED','FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  report JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_migration_runs_sha ON migration_runs(source_sha256, started_at DESC);
CREATE TABLE IF NOT EXISTS migration_sheet_rows (
  migration_run_id UUID NOT NULL REFERENCES migration_runs(migration_run_id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  row_data JSONB NOT NULL,
  row_checksum TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (migration_run_id, sheet_name, source_row_number)
);
CREATE INDEX IF NOT EXISTS idx_migration_sheet_rows_sheet ON migration_sheet_rows(migration_run_id, sheet_name);
CREATE TABLE IF NOT EXISTS migration_anomalies (
  anomaly_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_run_id UUID NOT NULL REFERENCES migration_runs(migration_run_id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  source_row_number INTEGER,
  anomaly_type TEXT NOT NULL,
  column_name TEXT,
  reference_table TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_migration_anomalies_run ON migration_anomalies(migration_run_id, sheet_name, anomaly_type);
CREATE TABLE IF NOT EXISTS migration_reconciliation (
  migration_run_id UUID NOT NULL REFERENCES migration_runs(migration_run_id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  source_rows INTEGER NOT NULL DEFAULT 0,
  raw_rows INTEGER NOT NULL DEFAULT 0,
  canonical_rows INTEGER NOT NULL DEFAULT 0,
  valid_canonical_rows INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  malformed INTEGER NOT NULL DEFAULT 0,
  orphans INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (migration_run_id, sheet_name)
);
CREATE TABLE IF NOT EXISTS sync_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  generation TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  legacy_sheets_cursor TEXT NOT NULL DEFAULT '',
  migration_run_id UUID,
  unsafe BOOLEAN NOT NULL DEFAULT FALSE,
  unsafe_reason TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sync_state(singleton, generation, schema_version)
VALUES (TRUE, 'uninitialized', 2)
ON CONFLICT (singleton) DO NOTHING;
