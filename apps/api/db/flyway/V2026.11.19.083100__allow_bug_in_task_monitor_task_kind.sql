-- Let the canonical Task monitor "task" kind select BUG nodes alongside
-- STANDARD. Only the published shape is changed; project overrides of
-- TASK_MONITOR keep their own kinds.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'TASK_MONITOR'
  ) THEN
    RAISE EXCEPTION 'Cannot allow BUG in the Task monitor kind: canonical TASK_MONITOR template is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET capabilities = jsonb_set(
      capabilities,
      '{monitorKinds}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN declared.kind ->> 'key' = 'task'
              AND declared.kind -> 'allowedNodeTypes' = '["STANDARD"]'::jsonb
              THEN jsonb_set(declared.kind, '{allowedNodeTypes}', '["STANDARD","BUG"]'::jsonb)
            ELSE declared.kind
          END
          ORDER BY declared.ordinal
        )
        FROM jsonb_array_elements(capabilities -> 'monitorKinds')
          WITH ORDINALITY AS declared(kind, ordinal)
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'TASK_MONITOR'
  AND jsonb_typeof(capabilities -> 'monitorKinds') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(capabilities -> 'monitorKinds') AS declared(kind)
    WHERE declared.kind ->> 'key' = 'task'
      AND declared.kind -> 'allowedNodeTypes' = '["STANDARD"]'::jsonb
  );
