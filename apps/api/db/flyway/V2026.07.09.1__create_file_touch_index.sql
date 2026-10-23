CREATE TABLE IF NOT EXISTS "file_touch_index" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "service_id" UUID NOT NULL,
  "feature_id" UUID,
  "attached_entity_type" "EntityType" NOT NULL,
  "attached_entity_id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "agent_session_id" UUID NOT NULL,
  "normalized_path" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_touch_index_report_fkey"
    FOREIGN KEY ("report_id")
    REFERENCES "reports"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "file_touch_index_report_path_unique"
  ON "file_touch_index"("report_id", "normalized_path");

CREATE INDEX IF NOT EXISTS "file_touch_index_file_lookup_idx"
  ON "file_touch_index"(
    "organization_id",
    "project_id",
    "service_id",
    "normalized_path",
    "created_at"
  );

CREATE INDEX IF NOT EXISTS "file_touch_index_work_lookup_idx"
  ON "file_touch_index"(
    "organization_id",
    "project_id",
    "attached_entity_type",
    "attached_entity_id",
    "created_at"
  );

CREATE INDEX IF NOT EXISTS "file_touch_index_report_idx"
  ON "file_touch_index"("report_id");

CREATE INDEX IF NOT EXISTS "file_touch_index_agent_session_idx"
  ON "file_touch_index"("agent_session_id");

CREATE INDEX IF NOT EXISTS "file_touch_index_feature_idx"
  ON "file_touch_index"("feature_id");
