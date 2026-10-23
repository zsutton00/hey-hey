-- CODING_PROMPT was removed from the OpenAPI EntityType contract in
-- V2026.08.12.1. Remove the legacy enum member from every persisted work-item
-- definition so registry snapshots cannot continue serving it from JSONB.

UPDATE "work_item_type_template"
SET "parentage" = jsonb_set(
      "parentage",
      '{allowedParentEntityTypes}',
      ("parentage"->'allowedParentEntityTypes') - 'CODING_PROMPT',
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "parentage"->'allowedParentEntityTypes' @> '["CODING_PROMPT"]'::jsonb;

UPDATE "work_item_type"
SET "parentage" = jsonb_set(
      "parentage",
      '{allowedParentEntityTypes}',
      ("parentage"->'allowedParentEntityTypes') - 'CODING_PROMPT',
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "parentage"->'allowedParentEntityTypes' @> '["CODING_PROMPT"]'::jsonb;

UPDATE "work_item_type_template"
SET "tracking" = jsonb_set(
      "tracking",
      '{allowedSourceEntityTypes}',
      ("tracking"->'allowedSourceEntityTypes') - 'CODING_PROMPT',
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "tracking"->'allowedSourceEntityTypes' @> '["CODING_PROMPT"]'::jsonb;

UPDATE "work_item_type"
SET "tracking" = jsonb_set(
      "tracking",
      '{allowedSourceEntityTypes}',
      ("tracking"->'allowedSourceEntityTypes') - 'CODING_PROMPT',
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "tracking"->'allowedSourceEntityTypes' @> '["CODING_PROMPT"]'::jsonb;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "parentage"->'allowedParentEntityTypes' @> '["CODING_PROMPT"]'::jsonb
       OR "tracking"->'allowedSourceEntityTypes' @> '["CODING_PROMPT"]'::jsonb
    UNION ALL
    SELECT 1
    FROM "work_item_type"
    WHERE "parentage"->'allowedParentEntityTypes' @> '["CODING_PROMPT"]'::jsonb
       OR "tracking"->'allowedSourceEntityTypes' @> '["CODING_PROMPT"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'CODING_PROMPT remains in a persisted work-item type definition';
  END IF;
END
$migration$;
