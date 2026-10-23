-- STANDARD service scope is optional only while genuinely unknown. Once
-- supplied, serviceIds is a complete assertion shared by every authoring path.
WITH complete_service_scope AS (
  SELECT $guidance$

## Complete known service scope

For a STANDARD work item, include `serviceIds` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit `serviceIds` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.$guidance$ AS value
)
UPDATE "work_item_type"
SET "writing_standards" = jsonb_build_object(
      'create', "writing_standards"->>'create' || complete_service_scope.value,
      'edit', "writing_standards"->>'edit' || complete_service_scope.value
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM complete_service_scope
WHERE "work_item_type"."type_key" = 'STANDARD'
  AND "work_item_type"."is_system" = true
  AND "work_item_type"."lifecycle_status" = 'active';
