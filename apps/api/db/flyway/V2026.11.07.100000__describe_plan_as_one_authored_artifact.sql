-- Describe Plan as one authored artifact. Project rows are updated only while they
-- still inherit the previous canonical text, so project-owned overrides are kept.
UPDATE work_item_type_template
SET description = 'A staged, reviewable sequence of work authored as one artifact with create_plan and divided into dependency-ordered stages, not assembled from existing tasks.',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN'
  AND description = 'A dependency-ordered collection of durable implementation stages.';

UPDATE work_item_type
SET description = 'A staged, reviewable sequence of work authored as one artifact with create_plan and divided into dependency-ordered stages, not assembled from existing tasks.',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN'
  AND project_id IS NOT NULL
  AND lifecycle_status = 'active'
  AND description = 'A dependency-ordered collection of durable implementation stages.';
