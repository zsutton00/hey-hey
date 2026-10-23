-- Restore the registry-backed presentation inherited from the former Workflow
-- type. Keep project-owned icon choices intact while repairing missing copies.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'DIAGRAM'
  ) THEN
    RAISE EXCEPTION 'Cannot restore Diagram icon: canonical Diagram template is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET icon_key = 'workflow',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM'
  AND icon_key IS DISTINCT FROM 'workflow';

UPDATE work_item_type
SET icon_key = 'workflow',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM'
  AND icon_key IS NULL;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'DIAGRAM'
      AND icon_key IS DISTINCT FROM 'workflow'
  ) THEN
    RAISE EXCEPTION 'Canonical Diagram template does not use the workflow icon';
  END IF;
END
$migration$;
