-- Agent Modes are launch configuration, not standalone Explorer entities.
-- Keep the canonical type out of the Explorer sidebar for every project
-- that uses the canonical definition.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot hide canonical MODE from the Explorer sidebar; its template is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET capabilities = jsonb_set(
      COALESCE(capabilities, '{}'::jsonb),
      '{showsInExplorerSidebar}',
      'false'::jsonb,
      true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'MODE';
