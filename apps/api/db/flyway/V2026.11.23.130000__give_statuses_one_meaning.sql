-- A status is its name plus exactly one meaning. The legacy display label, the
-- four-way category (NOT_STARTED / IN_PROGRESS / UNFINISHED / FINISHED) and the
-- completed-versus-cancelled flag collapse into `meaning: { kind, text? }`:
--
--   FINISHED, cancelled behavior        -> CANCELLED
--   FINISHED (completed or no behavior) -> COMPLETED
--   IN_PROGRESS                         -> IN_PROGRESS
--   NOT_STARTED, UNFINISHED             -> CUSTOM, worded from the stored label
--                                          (or the name when there is none),
--                                          cut to 50 characters, so the status
--                                          stays not finished.
--
-- The stored definitions already carry the label, meaning and behavior that
-- V2026.10.29.232600 derived from its legacy lookup, so they are read as they
-- are rather than looked up a third time. Status names, their order, and every
-- item's stored status are untouched. Statuses renamed through the editor may
-- keep old wording as their custom text until the user edits them.

-- BEGIN status meaning conversion
-- Converts one stored status. A status already in the new shape is returned
-- unchanged, so the conversion is safe to repeat. A status in neither shape
-- fails the migration with its name rather than being guessed at.
CREATE FUNCTION pg_temp.one_meaning_status(status JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  legacy_meaning TEXT := status ->> 'meaning';
  legacy_text TEXT;
BEGIN
  IF jsonb_typeof(status -> 'meaning') = 'object' THEN
    RETURN status;
  END IF;

  IF legacy_meaning = 'FINISHED' THEN
    RETURN jsonb_build_object(
      'name', status -> 'name',
      'meaning', jsonb_build_object(
        'kind',
        CASE WHEN status ->> 'completionBehavior' = 'CANCELLED' THEN 'CANCELLED' ELSE 'COMPLETED' END
      )
    );
  END IF;

  IF legacy_meaning = 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('name', status -> 'name', 'meaning', jsonb_build_object('kind', 'IN_PROGRESS'));
  END IF;

  IF legacy_meaning IN ('NOT_STARTED', 'UNFINISHED') THEN
    legacy_text := left(
      COALESCE(NULLIF(btrim(status ->> 'label'), ''), btrim(status ->> 'name')),
      50
    );
    -- Preserve the unfinished behavior even when the old wording is reserved.
    IF lower(btrim(legacy_text)) IN ('completed', 'cancelled', 'canceled', 'in progress', 'in-progress', 'in_progress') THEN
      legacy_text := 'Legacy label: ' || btrim(legacy_text);
    END IF;
    RETURN jsonb_build_object(
      'name', status -> 'name',
      'meaning', jsonb_build_object('kind', 'CUSTOM', 'text', legacy_text)
    );
  END IF;

  RAISE EXCEPTION 'Cannot give status % one meaning from stored meaning %', status ->> 'name', legacy_meaning;
END;
$$;

CREATE FUNCTION pg_temp.one_meaning_statuses(statuses JSONB) RETURNS JSONB
LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(pg_temp.one_meaning_status(status) ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(statuses) WITH ORDINALITY AS s(status, position)
$$;
-- END status meaning conversion

UPDATE work_item_type
SET statuses = pg_temp.one_meaning_statuses(statuses)
WHERE jsonb_typeof(statuses) = 'array';

UPDATE work_item_type_template
SET statuses = pg_temp.one_meaning_statuses(statuses)
WHERE jsonb_typeof(statuses) = 'array';

-- Type proposals and their retained before-images carry the same definitions.
UPDATE proposals
SET updates = jsonb_set(updates, '{statuses}', pg_temp.one_meaning_statuses(updates -> 'statuses'))
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND jsonb_typeof(updates -> 'statuses') = 'array';

UPDATE proposals
SET updates = jsonb_set(updates, '{definition,statuses}', pg_temp.one_meaning_statuses(updates #> '{definition,statuses}'))
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND jsonb_typeof(updates #> '{definition,statuses}') = 'array';

UPDATE proposals
SET retained_original_target_content = jsonb_set(
  retained_original_target_content,
  '{definition,statuses}',
  pg_temp.one_meaning_statuses(retained_original_target_content #> '{definition,statuses}')
)
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND jsonb_typeof(retained_original_target_content #> '{definition,statuses}') = 'array';
