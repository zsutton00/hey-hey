-- Migrate tasks.type from the task_type pg enum to a plain TEXT column.
-- Existing values (STANDARD/BUG/FEATURE/GOAL) are preserved verbatim by the
-- USING clause. Validation moves to the registry rather than the DB enum.
--
-- Two CHECK constraints embed task_type literals in their expressions, so they
-- must be dropped before the column type changes (otherwise ALTER re-evaluates
-- them as `text <> task_type`, an operator that does not exist) and recreated
-- against TEXT afterwards. The literal values are identical, so the invariants
-- they enforce are unchanged.
ALTER TABLE "tasks"
    DROP CONSTRAINT "tasks_goal_invariants",
    DROP CONSTRAINT "tasks_tag_feature_only";

ALTER TABLE "tasks"
    ALTER COLUMN "type" DROP DEFAULT,
    ALTER COLUMN "type" TYPE TEXT USING "type"::text,
    ALTER COLUMN "type" SET DEFAULT 'STANDARD';

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_goal_invariants"
        CHECK ("type" <> 'GOAL' OR ("due_date" IS NOT NULL AND "parent_task_id" IS NULL)),
    ADD CONSTRAINT "tasks_tag_feature_only"
        CHECK ("tag" IS NULL OR "type" = 'FEATURE');

-- task_type is now referenced by nothing — safe to drop.
DROP TYPE "task_type";
