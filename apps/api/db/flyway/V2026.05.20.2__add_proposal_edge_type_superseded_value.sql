-- Add enum value in its own migration so PostgreSQL commits it before any usage.
-- SUPERSEDES is appended last to match the order declared in
-- src/generated/model/proposalEdgeType.ts and prisma/schema.prisma.
-- The supersede transition declares a SUPERSEDES edge on the same proposal
-- that sets a task's status to SUPERSEDED; this value lets that declaration
-- persist as a PendingProposalEdge when its successor is a still-DRAFT
-- sibling proposal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'proposal_edge_type'
      AND e.enumlabel = 'SUPERSEDES'
  ) THEN
    ALTER TYPE "proposal_edge_type" ADD VALUE 'SUPERSEDES';
  END IF;
END $$;
