-- Persist typed launch defaults on generic work items and make config-kind
-- eligibility an explicit axis of the effective work-item type definition.
-- Flyway is the schema authority; Prisma mirrors these columns only.

ALTER TABLE "tasks"
  ADD COLUMN "config" JSONB;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_config_shape_check"
  CHECK (
    "config" IS NULL
    OR (
      jsonb_typeof("config") = 'object'
      AND jsonb_typeof("config" -> 'kind') = 'string'
      AND jsonb_typeof("config" -> 'version') = 'string'
    )
  );

ALTER TABLE "work_item_type_template"
  ADD COLUMN "accepted_config_kinds" JSONB;

ALTER TABLE "work_item_type"
  ADD COLUMN "accepted_config_kinds" JSONB;

UPDATE "work_item_type_template"
SET "accepted_config_kinds" = CASE
  WHEN "type_key" = 'STANDARD' THEN '["INITIAL_WORKTREE"]'::jsonb
  ELSE '[]'::jsonb
END;

UPDATE "work_item_type"
SET "accepted_config_kinds" = CASE
  WHEN "type_key" = 'STANDARD' THEN '["INITIAL_WORKTREE"]'::jsonb
  ELSE '[]'::jsonb
END;

ALTER TABLE "work_item_type_template"
  ALTER COLUMN "accepted_config_kinds" SET NOT NULL;

ALTER TABLE "work_item_type"
  ALTER COLUMN "accepted_config_kinds" SET NOT NULL;

ALTER TABLE "work_item_type_template"
  ADD CONSTRAINT "work_item_type_template_accepted_config_kinds_shape_check"
  CHECK (
    jsonb_typeof("accepted_config_kinds") = 'array'
    AND "accepted_config_kinds" <@ '["INITIAL_WORKTREE"]'::jsonb
  );

ALTER TABLE "work_item_type"
  ADD CONSTRAINT "work_item_type_accepted_config_kinds_shape_check"
  CHECK (
    jsonb_typeof("accepted_config_kinds") = 'array'
    AND "accepted_config_kinds" <@ '["INITIAL_WORKTREE"]'::jsonb
  );
