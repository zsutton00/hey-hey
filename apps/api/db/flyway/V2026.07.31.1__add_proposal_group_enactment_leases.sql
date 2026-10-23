ALTER TABLE "proposal_group_members"
  ADD COLUMN IF NOT EXISTS "claim_token" TEXT,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proposal_group_members_applying_claim_check'
      AND conrelid = 'proposal_group_members'::regclass
  ) THEN
    ALTER TABLE "proposal_group_members"
      ADD CONSTRAINT "proposal_group_members_applying_claim_check"
      CHECK (
        "execution_state" <> 'APPLYING'
        OR (
          "attempt_id" IS NOT NULL
          AND "claim_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "proposal_group_members_due_enactment_idx"
  ON "proposal_group_members" ("next_attempt_at", "lease_expires_at", "updated_at")
  WHERE "execution_state" IN ('READY', 'RETRYABLE_FAILURE', 'APPLYING');
