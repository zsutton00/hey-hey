-- Publish the settled user-facing Agent Mode terminology through the
-- canonical registry template. Complete project-owned overrides remain
-- authoritative and are not rewritten.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot publish Agent Mode terminology; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH canonical AS (
  SELECT
    'Agent Mode'::text AS display_name,
    'An Agent Mode is a reusable set of instructions, analogous to a skill, for how an agent approaches recurring work.'::text AS purpose
)
UPDATE work_item_type_template AS mode
SET name = canonical.display_name,
    description = canonical.purpose,
    updated_at = CURRENT_TIMESTAMP
FROM canonical
WHERE mode.type_key = 'MODE'
  AND (
    mode.name IS DISTINCT FROM canonical.display_name
    OR mode.description IS DISTINCT FROM canonical.purpose
  );
