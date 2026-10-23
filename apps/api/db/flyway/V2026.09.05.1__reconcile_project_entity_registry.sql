-- Reconcile every Project identity into the registry without deleting rows.
-- The project table remains authoritative for both the current name and
-- deletion state, so rerunning this migration is safe and restores missing or
-- stale PROJECT registry rows.
INSERT INTO "entity_registry" (
  "id",
  "organization_id",
  "entity_id",
  "entity_type",
  "entity_name",
  "name_search_text",
  "deleted_at"
)
SELECT
  gen_random_uuid()::text,
  p."organization_id",
  p."id",
  'PROJECT'::"EntityType",
  p."name",
  trim(
    regexp_replace(
      regexp_replace(lower(p."name"), '[^[:alnum:]]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  ),
  p."deleted_at"
FROM "projects" AS p
ON CONFLICT ("organization_id", "entity_id", "entity_type")
DO UPDATE SET
  "entity_name" = EXCLUDED."entity_name",
  "name_search_text" = EXCLUDED."name_search_text",
  "deleted_at" = EXCLUDED."deleted_at";
