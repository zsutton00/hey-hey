ALTER TABLE "browser_session_families"
  ADD COLUMN IF NOT EXISTS "current_organization_id" TEXT;

CREATE INDEX IF NOT EXISTS "browser_session_families_current_organization_id_idx"
  ON "browser_session_families" ("current_organization_id");
