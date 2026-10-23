-- PLAN and PLAN_STAGE were seeded after the global capability cleanup, so
-- remove the retired key from their canonical and project-scoped definitions.
UPDATE work_item_type_template
SET capabilities = capabilities - 'isHierarchyNode',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('PLAN', 'PLAN_STAGE')
  AND capabilities ? 'isHierarchyNode';

UPDATE work_item_type
SET capabilities = capabilities - 'isHierarchyNode',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('PLAN', 'PLAN_STAGE')
  AND capabilities ? 'isHierarchyNode';
