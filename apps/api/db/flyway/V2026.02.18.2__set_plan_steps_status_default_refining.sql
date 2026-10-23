-- Use the new enum value in a follow-up migration (separate transaction).
ALTER TABLE "plan_steps"
  ALTER COLUMN "status" SET DEFAULT 'REFINING';
