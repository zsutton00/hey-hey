-- Add EVOLVES to the pending proposal edge enum so proposal-declared EVOLVES
-- relationships can be deferred while the target proposal is still unapproved.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'proposal_edge_type'
      AND e.enumlabel = 'EVOLVES'
  ) THEN
    ALTER TYPE "proposal_edge_type" ADD VALUE 'EVOLVES';
  END IF;
END $$;
