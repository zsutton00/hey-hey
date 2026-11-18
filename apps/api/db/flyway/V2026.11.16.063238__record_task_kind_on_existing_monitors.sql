-- Every Task Monitor's execution definition records the key of the monitor
-- kind it runs. Monitors created before kinds were selectable ran the Task
-- kind, so each stored definition without a key records `task`. This is the
-- one place a monitor without a key is resolved; no reader defaults it.
--
-- Only the live `executionDefinition` section is rewritten. Each row runs in
-- its own sub-block: a section that is not a JSON object is left unchanged and
-- reported with a NOTICE naming the monitor and the cause, and never stops the
-- others. Section history and pending proposals are not rewritten.
-- Idempotent: a definition that already records a kind is left alone.
--
-- A project-owned TASK_MONITOR definition that still stores a single
-- `monitorKind` object (written before kinds became a list) gets it as the one
-- entry of `monitorKinds`, so the stored shape matches the contract.
UPDATE work_item_type
SET capabilities = (capabilities - 'monitorKind')
      || jsonb_build_object('monitorKinds', jsonb_build_array(capabilities -> 'monitorKind')),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'TASK_MONITOR'
  AND jsonb_typeof(capabilities -> 'monitorKind') = 'object'
  AND NOT (capabilities ? 'monitorKinds');

DO $migration$
DECLARE
  pending RECORD;
  definition jsonb;
  recorded integer := 0;
  skipped integer := 0;
BEGIN
  FOR pending IN
    SELECT s.id, s.task_id, s.materialized_markdown
    FROM task_sections s
    JOIN tasks t ON t.id = s.task_id
    WHERE t.type = 'TASK_MONITOR'
      AND s.key = 'executionDefinition'
      AND s.materialized_markdown IS NOT NULL
      AND btrim(s.materialized_markdown) <> ''
    ORDER BY s.task_id
  LOOP
    BEGIN
      definition := pending.materialized_markdown::jsonb;
      IF jsonb_typeof(definition) <> 'object' THEN
        RAISE EXCEPTION 'executionDefinition is a JSON %, not an object', jsonb_typeof(definition);
      END IF;

      IF NOT (definition ? 'kind') THEN
        UPDATE task_sections
        SET materialized_markdown = jsonb_set(definition, '{kind}', '"task"'::jsonb)::text,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = pending.id;
        recorded := recorded + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      skipped := skipped + 1;
      RAISE NOTICE 'task monitor kind backfill skipped monitor %: % (%)',
        pending.task_id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RAISE NOTICE 'task monitor kind backfill recorded "task" on % monitors and skipped %',
    recorded, skipped;
END
$migration$;
