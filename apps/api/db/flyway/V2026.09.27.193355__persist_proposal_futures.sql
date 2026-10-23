ALTER TYPE "proposal_action" ADD VALUE 'VERSIONED_UPDATE';

CREATE TABLE "proposal_futures" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "target_entity_id" TEXT NOT NULL,
  "target_entity_type" "target_entity_type" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "outcome" TEXT NOT NULL DEFAULT 'STAGED' CHECK ("outcome" IN ('STAGED', 'APPLIED', 'CANCELLED')),
  "originating_proposal_id" TEXT NOT NULL,
  "latest_proposal_id" TEXT NOT NULL,
  "baseline" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "applied_at" TIMESTAMP(3),
  "applied_revision" INTEGER,
  "cancelled_at" TIMESTAMP(3)
);
CREATE INDEX ON "proposal_futures" ("organization_id", "project_id", "target_entity_type", "target_entity_id");
CREATE TABLE "proposal_future_revisions" (
  "future_id" TEXT NOT NULL REFERENCES "proposal_futures"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "proposal_id" TEXT NOT NULL UNIQUE,
  "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mutation" JSONB NOT NULL,
  PRIMARY KEY ("future_id", "revision")
);
-- These are future-owned completion links. They do not alter generic graph
-- dependency semantics or proposal-group enactment ordering.
CREATE TABLE "proposal_future_dependencies" (
  "future_id" TEXT NOT NULL REFERENCES "proposal_futures"("id") ON DELETE CASCADE,
  "target_entity_id" TEXT NOT NULL,
  PRIMARY KEY ("future_id", "target_entity_id")
);
CREATE INDEX ON "proposal_future_dependencies" ("target_entity_id");
