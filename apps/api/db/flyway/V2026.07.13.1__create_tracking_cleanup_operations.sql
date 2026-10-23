CREATE TYPE "tracking_cleanup_operation_status" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "tracking_cleanup_operations" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "proposal_id" TEXT NOT NULL REFERENCES "proposals"("id") ON DELETE CASCADE,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "operation_kind" TEXT NOT NULL,
  "source_type_key" TEXT NOT NULL,
  "revoked_target_type_keys" JSONB NOT NULL,
  "status" "tracking_cleanup_operation_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "next_retry_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ,
  "claim_expires_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "cleared_relationship_count" INTEGER NOT NULL DEFAULT 0 CHECK ("cleared_relationship_count" >= 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_cleanup_operations_proposal_kind_key" UNIQUE ("proposal_id", "operation_kind")
);

CREATE INDEX "tracking_cleanup_operations_status_retry_idx"
  ON "tracking_cleanup_operations" ("status", "next_retry_at");
CREATE INDEX "tracking_cleanup_operations_status_claim_idx"
  ON "tracking_cleanup_operations" ("status", "claim_expires_at");
CREATE INDEX "tracking_cleanup_operations_scope_idx"
  ON "tracking_cleanup_operations" ("organization_id", "project_id");
