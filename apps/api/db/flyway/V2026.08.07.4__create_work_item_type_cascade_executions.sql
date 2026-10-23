DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'work_item_type_cascade_execution_state'
  ) THEN
    CREATE TYPE "work_item_type_cascade_execution_state" AS ENUM (
      'PENDING',
      'PROCESSING',
      'GRAPH_CLEANED',
      'COMPLETED',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE "work_item_type_cascade_executions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "proposal_id" TEXT NOT NULL UNIQUE REFERENCES "proposals"("id") ON DELETE CASCADE,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "type_key" TEXT NOT NULL,
  "work_item_ids" JSONB NOT NULL,
  "state" "work_item_type_cascade_execution_state" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "next_retry_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_token" TEXT,
  "claimed_at" TIMESTAMPTZ,
  "claim_expires_at" TIMESTAMPTZ,
  "graph_completed_at" TIMESTAMPTZ,
  "graph_deleted_edge_count" INTEGER NOT NULL DEFAULT 0 CHECK ("graph_deleted_edge_count" >= 0),
  "last_error" TEXT,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "work_item_type_cascade_executions_state_retry_idx"
  ON "work_item_type_cascade_executions" ("state", "next_retry_at");
CREATE INDEX "work_item_type_cascade_executions_state_claim_idx"
  ON "work_item_type_cascade_executions" ("state", "claim_expires_at");
CREATE INDEX "work_item_type_cascade_executions_scope_type_idx"
  ON "work_item_type_cascade_executions" ("organization_id", "project_id", "type_key");
