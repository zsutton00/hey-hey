-- Reversible audit prerequisite for the Plan-to-Work-Item data conversion.
-- This intentionally precedes destructive retirement so the TypeScript
-- backfill can preserve source proposal rows before rewriting them.
CREATE TABLE IF NOT EXISTS plan_work_item_migration_archive (
  source_table text NOT NULL,
  source_id text NOT NULL,
  source_record jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_id)
);
