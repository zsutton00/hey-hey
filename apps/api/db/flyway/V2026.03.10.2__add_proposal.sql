CREATE TYPE "proposal_type" AS ENUM ('SINGLE', 'BATCH');
CREATE TYPE "proposal_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
CREATE TYPE "proposal_status" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "target_entity_type" AS ENUM ('TASK', 'DESIGN_DOC');

CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "proposal_type" NOT NULL DEFAULT 'SINGLE',
    "action" "proposal_action" NOT NULL,
    "status" "proposal_status" NOT NULL DEFAULT 'DRAFT',
    "target_entity_id" TEXT NOT NULL,
    "target_entity_type" "target_entity_type" NOT NULL,
    "updates" JSONB NOT NULL,
    "requestor_id" TEXT NOT NULL,
    "requestor_context" JSONB,
    "validation_session_id" TEXT,
    "conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposals_organization_id_idx" ON "proposals"("organization_id");
CREATE INDEX "proposals_organization_id_project_id_idx" ON "proposals"("organization_id", "project_id");
CREATE INDEX "proposals_organization_id_status_idx" ON "proposals"("organization_id", "status");
CREATE INDEX "proposals_target_entity_id_target_entity_type_idx" ON "proposals"("target_entity_id", "target_entity_type");
CREATE INDEX "proposals_validation_session_id_idx" ON "proposals"("validation_session_id");
CREATE INDEX "proposals_conversation_id_idx" ON "proposals"("conversation_id");
CREATE INDEX "proposals_requestor_id_idx" ON "proposals"("requestor_id");

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_validation_session_id_fkey" FOREIGN KEY ("validation_session_id") REFERENCES "validation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
