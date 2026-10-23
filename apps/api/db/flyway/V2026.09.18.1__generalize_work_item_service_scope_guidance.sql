-- Service scope guidance follows the registry role, not a built-in type key.
-- Only canonical system definitions are updated here; project-owned writing
-- standards remain authoritative and are never overwritten by this migration.
WITH service_scope AS (
  SELECT $guidance$

## Complete known service scope

For a work-item type whose registry role is `work-item`, include `serviceIds` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit `serviceIds` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.$guidance$ AS value
), legacy_scope AS (
  SELECT $legacy$

## Complete known service scope

For a STANDARD work item, include `serviceIds` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit `serviceIds` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.$legacy$ AS value
)
UPDATE "work_item_type_template" AS wit
SET "writing_standards" = jsonb_build_object(
      'create',
        replace(
          COALESCE(wit."writing_standards"->>'create', ''),
          legacy_scope.value,
          ''
        ) || E'\n\n' || service_scope.value,
      'edit',
        replace(
          COALESCE(wit."writing_standards"->>'edit', ''),
          legacy_scope.value,
          ''
        ) || E'\n\n' || service_scope.value
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM service_scope, legacy_scope
WHERE wit."role" = 'work-item';
