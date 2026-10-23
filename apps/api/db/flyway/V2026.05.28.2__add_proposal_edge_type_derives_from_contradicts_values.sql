-- Add enum values in their own migration so PostgreSQL commits them before any usage.
-- DERIVES_FROM and CONTRADICTS are appended to match the order declared in
-- src/generated/model/proposalEdgeType.ts and prisma/schema.prisma.
-- A proposal may declare DERIVES_FROM or CONTRADICTS edges; these values let those
-- declarations persist as PendingProposalEdge rows when their target is a
-- still-DRAFT sibling proposal, keeping the proposal edge vocabulary aligned with
-- the five-value agent relationship vocabulary used by create_edge.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'proposal_edge_type'
      AND e.enumlabel = 'DERIVES_FROM'
  ) THEN
    ALTER TYPE "proposal_edge_type" ADD VALUE 'DERIVES_FROM';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'proposal_edge_type'
      AND e.enumlabel = 'CONTRADICTS'
  ) THEN
    ALTER TYPE "proposal_edge_type" ADD VALUE 'CONTRADICTS';
  END IF;
END $$;
