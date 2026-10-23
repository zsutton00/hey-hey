DROP INDEX IF EXISTS "proposal_group_members_due_enactment_idx";

ALTER TABLE "proposal_group_members"
  DROP COLUMN IF EXISTS "next_attempt_at";
