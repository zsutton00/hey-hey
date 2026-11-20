-- A Feature's ACTIVE status is shown as "Ready" and a Plan's BACKLOG status as
-- "Draft". The status migration (V2026.10.29.232600) wrote the generic platform
-- labels "In progress" and "Backlog" for them, so those two labels now belong
-- in the built-in definitions.
--
-- A label is replaced only when all of these hold:
--   * it is still exactly the label the status migration wrote;
--   * no other status of the type already shows the new label, so a type can
--     never end up with two statuses of the same name (a Feature that also has
--     a READY status keeps "In progress" for ACTIVE);
--   * for a project's own definition, it has not been saved since the status
--     migration ran. Before that migration a status had no label, so any label
--     on a definition saved afterwards may be the owner's own choice, and a
--     definition saved then is left exactly as its owner left it.
-- The built-in templates are platform-owned and have no owner edits to protect.

CREATE FUNCTION pg_temp.relabel_status(
  statuses JSONB,
  status_name TEXT,
  from_label TEXT,
  to_label TEXT
) RETURNS JSONB
LANGUAGE sql AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(statuses) AS other(entry)
      WHERE other.entry ->> 'name' <> status_name
        AND lower(COALESCE(other.entry ->> 'label', other.entry ->> 'name')) = lower(to_label)
    ) THEN statuses
    ELSE (
      SELECT jsonb_agg(
        CASE
          WHEN entry ->> 'name' = status_name AND entry ->> 'label' = from_label
            THEN jsonb_set(entry, '{label}', to_jsonb(to_label))
          ELSE entry
        END
        ORDER BY position
      )
      FROM jsonb_array_elements(statuses) WITH ORDINALITY AS e(entry, position)
    )
  END
$$;

-- When the status migration ran, as a UTC timestamp comparable with
-- updated_at. Definitions saved by the application carry UTC times, so the
-- earlier of the two readings of the install time is used. Without a record of
-- the migration no project definition qualifies.
CREATE FUNCTION pg_temp.status_migration_cutoff() RETURNS TIMESTAMP
LANGUAGE sql AS $$
  SELECT COALESCE(
    (
      SELECT LEAST(
        installed_on,
        (installed_on AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC'
      )
      FROM flyway_schema_history
      WHERE version = '2026.10.29.232600' AND success
    ),
    '-infinity'::timestamp
  )
$$;

UPDATE work_item_type_template
SET statuses = pg_temp.relabel_status(statuses, 'ACTIVE', 'In progress', 'Ready')
WHERE type_key = 'FEATURE'
  AND statuses <> pg_temp.relabel_status(statuses, 'ACTIVE', 'In progress', 'Ready');

UPDATE work_item_type_template
SET statuses = pg_temp.relabel_status(statuses, 'BACKLOG', 'Backlog', 'Draft')
WHERE type_key = 'PLAN'
  AND statuses <> pg_temp.relabel_status(statuses, 'BACKLOG', 'Backlog', 'Draft');

UPDATE work_item_type
SET statuses = pg_temp.relabel_status(statuses, 'ACTIVE', 'In progress', 'Ready')
WHERE type_key = 'FEATURE'
  AND updated_at <= pg_temp.status_migration_cutoff()
  AND statuses <> pg_temp.relabel_status(statuses, 'ACTIVE', 'In progress', 'Ready');

UPDATE work_item_type
SET statuses = pg_temp.relabel_status(statuses, 'BACKLOG', 'Backlog', 'Draft')
WHERE type_key = 'PLAN'
  AND updated_at <= pg_temp.status_migration_cutoff()
  AND statuses <> pg_temp.relabel_status(statuses, 'BACKLOG', 'Backlog', 'Draft');
