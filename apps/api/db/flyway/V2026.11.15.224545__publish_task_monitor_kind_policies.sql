-- Publish the Task kind's start, done and supervision policies on the canonical
-- TASK_MONITOR type. The registry resolves any policy a declared kind omits from
-- this canonical `task` kind, so it is the one source of Task defaults. Only
-- policy keys the `task` entry omits are added; complete project overrides,
-- explicitly declared policies, other kinds and unrelated capabilities are left
-- unchanged.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template,
      jsonb_array_elements(capabilities -> 'monitorKinds') AS declared(kind)
    WHERE type_key = 'TASK_MONITOR'
      AND jsonb_typeof(capabilities -> 'monitorKinds') = 'array'
      AND declared.kind ->> 'key' = 'task'
  ) THEN
    RAISE EXCEPTION 'Cannot publish Task monitor kind policies: canonical TASK_MONITOR template declares no "task" entry in monitorKinds';
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
            WHEN declared.kind ->> 'key' = 'task' THEN
              $policies$ {
                "start": { "type": "STATUS_TRANSITION", "status": "ACTIVE" },
                "done": { "type": "ITEM_STATUS", "status": "COMPLETED" },
                "supervision": { "type": "COORDINATOR_REVIEW" }
              } $policies$::jsonb || declared.kind
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
      AND NOT (declared.kind ? 'start' AND declared.kind ? 'done' AND declared.kind ? 'supervision')
  );
