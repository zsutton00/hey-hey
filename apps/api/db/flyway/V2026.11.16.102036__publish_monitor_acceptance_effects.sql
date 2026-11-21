-- Publish canonical lifecycle effects without rewriting explicit done rules or project overrides.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template,
      jsonb_array_elements(capabilities -> 'monitorKinds') AS declared(kind)
    WHERE type_key = 'TASK_MONITOR' AND declared.kind ->> 'key' = 'task'
  ) THEN
    RAISE EXCEPTION 'Cannot publish monitor acceptance: canonical TASK_MONITOR task kind is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET capabilities = jsonb_set(capabilities, '{monitorKinds}', (
  SELECT jsonb_agg(
    CASE WHEN kind ->> 'key' = 'task' THEN
      $acceptance$ { "acceptance": { "type": "COMPLETE_ITEM" } } $acceptance$::jsonb || kind
    ELSE kind END ORDER BY ordinal
  ) FROM jsonb_array_elements(capabilities -> 'monitorKinds') WITH ORDINALITY AS declared(kind, ordinal)
)), updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'TASK_MONITOR';
