-- Publish the Task kind on the canonical TASK_MONITOR type as the one entry of
-- its declared monitor kinds. Each monitor selects a declared kind by key.
-- Complete project overrides keep their own definition.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'TASK_MONITOR'
  ) THEN
    RAISE EXCEPTION 'Cannot publish the Task monitor kind: canonical TASK_MONITOR template is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET capabilities = capabilities || jsonb_build_object(
      'monitorKinds',
      jsonb_build_array($kind$ {
        "key": "task",
        "allowedNodeTypes": ["STANDARD"],
        "allowedLaunchMethods": ["plan", "open", "quick"],
        "allowedRuntimeProviders": ["claude", "codex", "opencode"],
        "allowedReasoningEfforts": ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "default"]
      } $kind$::jsonb)
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'TASK_MONITOR'
  AND NOT (capabilities ? 'monitorKinds');
