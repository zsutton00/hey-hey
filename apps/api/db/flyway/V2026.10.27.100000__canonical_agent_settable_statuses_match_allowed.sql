-- Agents start with no status restriction on canonical work-item types: every
-- status a built-in type allows is agent-settable. SUPERSEDED stays reachable
-- only through the supersede transition, which proposal validation enforces
-- independently of this list.
--
-- Only canonical templates change. Stored project overrides and custom types
-- in work_item_type are deliberately left as authored.
UPDATE work_item_type_template
SET agent_settable_statuses = allowed_statuses,
    updated_at = CURRENT_TIMESTAMP
WHERE agent_settable_statuses IS DISTINCT FROM allowed_statuses;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE agent_settable_statuses IS DISTINCT FROM allowed_statuses
  ) THEN
    RAISE EXCEPTION 'Canonical agent-settable statuses do not match allowed statuses';
  END IF;
END
$migration$;
