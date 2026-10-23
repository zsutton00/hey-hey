-- Add the feature_tag enum and a nullable `tag` column on tasks. Only FEATURE
-- rows may carry a tag; the CHECK constraint enforces this at the storage
-- layer so the invariant survives any service-layer drift. The column is
-- nullable to accommodate pre-tag features (back-fill is owned by the parent
-- task).
CREATE TYPE "feature_tag" AS ENUM ('product', 'frontend', 'backend', 'infra', 'design');

ALTER TABLE "tasks" ADD COLUMN "tag" "feature_tag";

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_tag_feature_only"
  CHECK (tag IS NULL OR type = 'FEATURE');
