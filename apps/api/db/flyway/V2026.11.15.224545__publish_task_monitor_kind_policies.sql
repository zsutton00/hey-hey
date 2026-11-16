-- Publish the Task kind's start, done and supervision policies on the canonical
-- TASK_MONITOR type. The registry resolves any policy an older definition omits
-- from this canonical declaration, so it is the one source of Task defaults.
-- Only omitted policy keys are added; complete project overrides, explicitly
-- declared policies and unrelated capabilities are left unchanged.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'TASK_MONITOR'
      AND capabilities ? 'monitorKind'
  ) THEN
    RAISE EXCEPTION 'Cannot publish Task monitor kind policies: canonical TASK_MONITOR template has no monitorKind';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET capabilities = jsonb_set(
      capabilities,
      '{monitorKind}',
      $policies$ {
        "start": { "type": "STATUS_TRANSITION", "status": "ACTIVE" },
        "done": { "type": "ITEM_STATUS", "status": "COMPLETED" },
        "supervision": { "type": "COORDINATOR_REVIEW" }
      } $policies$::jsonb || (capabilities -> 'monitorKind')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'TASK_MONITOR'
  AND NOT (
    (capabilities -> 'monitorKind') ? 'start'
    AND (capabilities -> 'monitorKind') ? 'done'
    AND (capabilities -> 'monitorKind') ? 'supervision'
  );
