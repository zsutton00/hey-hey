-- V2026.07.09.2 promoted CONTRACT to a canonical system work-item type and
-- archived any project-scoped CONTRACT definitions that predated the
-- promotion. Tasks retain the type key itself and do not reference definition
-- row IDs, so those archived rows are definition tombstones only.
--
-- Remove those tombstones before V2026.08.03.1 materializes a canonical
-- CONTRACT definition for every project. Active project-scoped CONTRACT rows
-- are deliberately not removed: the following migration's collision guard
-- must continue to surface them as unresolved data conflicts.

DO $migration$
BEGIN
  -- With out-of-order migrations enabled, an environment that has already
  -- completed V2026.08.03.1 can encounter this migration after is_system was
  -- dropped. Such an environment necessarily had no collision and needs no
  -- cleanup, so keep this repair safe on both sides of the cutover.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'work_item_type'
      AND column_name = 'is_system'
  ) THEN
    EXECUTE $cleanup$
      DELETE FROM "work_item_type"
      WHERE "type_key" = 'CONTRACT'
        AND "is_system" = false
        AND "project_id" IS NOT NULL
        AND "lifecycle_status" = 'archived'
    $cleanup$;
  END IF;
END
$migration$;
