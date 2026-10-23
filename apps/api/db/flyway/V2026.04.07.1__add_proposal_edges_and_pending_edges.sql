-- Add edges column to proposals for storing declared edge relationships
ALTER TABLE "proposals" ADD COLUMN "edges" JSONB;

-- Create pending_proposal_edges table for deferred edge materialization
CREATE TYPE "proposal_edge_type" AS ENUM ('DEPENDS_ON', 'BLOCKS', 'RELATED_TO');

CREATE TABLE "pending_proposal_edges" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_proposal_id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "target_proposal_id" TEXT NOT NULL,
    "edge_type" "proposal_edge_type" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_proposal_edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pending_proposal_edges_target_proposal_id_idx" ON "pending_proposal_edges"("target_proposal_id");
CREATE INDEX "pending_proposal_edges_source_proposal_id_idx" ON "pending_proposal_edges"("source_proposal_id");
CREATE INDEX "pending_proposal_edges_org_project_idx" ON "pending_proposal_edges"("organization_id", "project_id");

ALTER TABLE "pending_proposal_edges" ADD CONSTRAINT "pending_proposal_edges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_proposal_edges" ADD CONSTRAINT "pending_proposal_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_proposal_edges" ADD CONSTRAINT "pending_proposal_edges_source_proposal_id_fkey" FOREIGN KEY ("source_proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_proposal_edges" ADD CONSTRAINT "pending_proposal_edges_target_proposal_id_fkey" FOREIGN KEY ("target_proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
