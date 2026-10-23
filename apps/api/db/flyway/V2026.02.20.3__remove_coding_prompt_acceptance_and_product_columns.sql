ALTER TABLE "coding_prompts"
  DROP CONSTRAINT IF EXISTS "coding_prompts_accepted_by_fkey";

DROP INDEX IF EXISTS "coding_prompts_accepted_by_idx";

ALTER TABLE "coding_prompts"
  DROP COLUMN IF EXISTS "product_goal",
  DROP COLUMN IF EXISTS "product_outcome",
  DROP COLUMN IF EXISTS "accepted_date",
  DROP COLUMN IF EXISTS "accepted_by";
