-- Add the optional Explorer Sidebar capability to existing system definitions.
-- The definition remains stored in the existing capabilities JSONB column.
-- System types default to fail-closed; active FEATURE and GOAL definitions
-- retain the existing Explorer sections explicitly.

UPDATE "work_item_type"
SET
  "capabilities" = jsonb_set(
    COALESCE("capabilities", '{}'::jsonb),
    '{showsInExplorerSidebar}',
    'false'::jsonb,
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "is_system" = true
  AND "project_id" IS NULL;

UPDATE "work_item_type"
SET
  "capabilities" = jsonb_set(
    COALESCE("capabilities", '{}'::jsonb),
    '{showsInExplorerSidebar}',
    'true'::jsonb,
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" IN ('FEATURE', 'GOAL')
  AND "is_system" = true
  AND "project_id" IS NULL
  AND "lifecycle_status" = 'active';
