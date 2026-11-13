-- Upgrade historical type proposal payloads to the generated definition shape.
-- Preserve proposal identities, decisions, names, order and all unrelated fields.
-- This follows the registry migration and changes no live work items.

CREATE TEMP TABLE historical_status_semantics (
  name       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  meaning    TEXT NOT NULL,
  completion TEXT
) ON COMMIT DROP;

INSERT INTO historical_status_semantics (name, label, meaning, completion) VALUES
  ('GENERATED',                          'Generated',               'NOT_STARTED', NULL),
  ('BACKLOG',                            'Backlog',                 'NOT_STARTED', NULL),
  ('READY',                              'Ready',                   'NOT_STARTED', NULL),
  ('REFINING',                           'Refining',                'NOT_STARTED', NULL),
  ('BLOCKED',                            'Blocked',                 'UNFINISHED', NULL),
  ('REFINING_DESCRIPTION',               'Needs review',            'NOT_STARTED', NULL),
  ('REFINING_DETAILS',                   'Refining details',        'NOT_STARTED', NULL),
  ('REFINING_ACCEPTANCE_CRITERIA',       'Refining criteria',       'NOT_STARTED', NULL),
  ('GENERATING_DESCRIPTION',             'Generating description',  'NOT_STARTED', NULL),
  ('GENERATING_DETAILS',                 'Generating details',      'NOT_STARTED', NULL),
  ('GENERATING_DESCRIPTION_AND_DETAILS', 'Generating content',      'NOT_STARTED', NULL),
  ('GENERATING_ACCEPTANCE_CRITERIA',     'Generating criteria',     'NOT_STARTED', NULL),
  ('GENERATING_ALL',                     'Generating all',          'NOT_STARTED', NULL),
  ('ACTIVE',                             'In progress',             'IN_PROGRESS', NULL),
  ('ON_HOLD',                            'On Hold',                 'UNFINISHED', NULL),
  ('VERIFYING',                          'Verifying',               'IN_PROGRESS', NULL),
  ('COMPLETED',                          'Completed',               'FINISHED',    'COMPLETED'),
  ('CANCELLED',                          'Cancelled',               'FINISHED',    'CANCELLED');

-- Converts a legacy status-name array into the ordered ordinary status
-- definitions. Fails loudly on a name the table does not cover rather than
-- inferring a meaning for it.
CREATE FUNCTION pg_temp.historical_statuses(allowed JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  unknown_names TEXT;
  converted JSONB;
BEGIN
  IF jsonb_typeof(allowed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cannot migrate allowed statuses that are not an array: %', allowed;
  END IF;

  SELECT string_agg(s.name, ', ') INTO unknown_names
  FROM jsonb_array_elements_text(allowed) AS s(name)
  WHERE s.name NOT IN ('ARCHIVED', 'SUPERSEDED')
    AND s.name NOT IN (SELECT name FROM historical_status_semantics);
  IF unknown_names IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot migrate allowed statuses without known semantics: %', unknown_names;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'name', semantics.name,
        'label', semantics.label,
        'meaning', semantics.meaning,
        'completionBehavior', semantics.completion
      ))
      ORDER BY s.position
    ),
    '[]'::jsonb
  ) INTO converted
  FROM (
    -- Legacy lists allowed duplicates; keep each name's first position.
    SELECT name, MIN(position) AS position
    FROM jsonb_array_elements_text(allowed) WITH ORDINALITY AS e(name, position)
    GROUP BY name
  ) AS s
  JOIN historical_status_semantics semantics ON semantics.name = s.name;

  IF jsonb_array_length(converted) = 0 THEN
    RAISE EXCEPTION 'Cannot migrate a type without an ordinary status: %', allowed;
  END IF;

  RETURN converted;
END;
$$;

-- Settled proposal payloads must remain readable by the current proposal UI.
UPDATE proposals
SET updates = (updates - 'allowedStatuses')
      || jsonb_build_object('statuses', pg_temp.historical_statuses(updates -> 'allowedStatuses'))
      || CASE
        WHEN updates -> 'allowedStatuses' ? 'SUPERSEDED' THEN jsonb_build_object(
          'capabilities',
          COALESCE(updates -> 'capabilities', '{}'::jsonb) || '{"supportsSupersession": true}'::jsonb
        )
        ELSE '{}'::jsonb
      END
      || CASE
        WHEN updates ? 'agentSettableStatuses' THEN jsonb_build_object(
          'agentSettableStatuses',
          (updates -> 'agentSettableStatuses') - 'SUPERSEDED'
        )
        ELSE '{}'::jsonb
      END
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND status IN ('APPROVED', 'REJECTED')
  AND jsonb_typeof(updates -> 'allowedStatuses') = 'array';

-- A JSON-null `allowedStatuses` carries no status list. Drop the key so the
-- proposal parses against the strict current shape (a root-level edit then
-- leaves statuses unchanged; a complete definition still fails approval for
-- lacking statuses, as it already did).
UPDATE proposals
SET updates = updates - 'allowedStatuses'
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND status IN ('APPROVED', 'REJECTED')
  AND jsonb_typeof(updates -> 'allowedStatuses') = 'null';

UPDATE proposals
SET updates = jsonb_set(updates, '{definition}', (updates -> 'definition') - 'allowedStatuses')
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND status IN ('APPROVED', 'REJECTED')
  AND jsonb_typeof(updates #> '{definition,allowedStatuses}') = 'null';

UPDATE proposals
SET retained_original_target_content = jsonb_set(retained_original_target_content, '{definition}',
    (retained_original_target_content -> 'definition') - 'allowedStatuses')
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND jsonb_typeof(retained_original_target_content #> '{definition,allowedStatuses}') = 'null';

-- Edit proposals wrap the complete definition instead of placing it at the
-- updates root. Preserve their reviewed operation and customization metadata.
UPDATE proposals
SET updates = jsonb_set(updates, '{definition}',
    ((updates -> 'definition') - 'allowedStatuses')
    || jsonb_build_object('statuses', pg_temp.historical_statuses(updates #> '{definition,allowedStatuses}'))
    || CASE
      WHEN updates #> '{definition,allowedStatuses}' ? 'SUPERSEDED' THEN jsonb_build_object(
        'capabilities', COALESCE(updates #> '{definition,capabilities}', '{}'::jsonb)
          || '{"supportsSupersession": true}'::jsonb)
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN (updates -> 'definition') ? 'agentSettableStatuses' THEN jsonb_build_object(
        'agentSettableStatuses', (updates #> '{definition,agentSettableStatuses}') - 'SUPERSEDED')
      ELSE '{}'::jsonb
    END)
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND status IN ('APPROVED', 'REJECTED')
  AND jsonb_typeof(updates #> '{definition,allowedStatuses}') = 'array';


-- Retained before-images drive historical edit comparisons, including drafts.
UPDATE proposals
SET retained_original_target_content = jsonb_set(retained_original_target_content, '{definition}',
    ((retained_original_target_content -> 'definition') - 'allowedStatuses')
    || jsonb_build_object('statuses', pg_temp.historical_statuses(retained_original_target_content #> '{definition,allowedStatuses}'))
    || CASE
      WHEN retained_original_target_content #> '{definition,allowedStatuses}' ? 'SUPERSEDED' THEN jsonb_build_object(
        'capabilities', COALESCE(retained_original_target_content #> '{definition,capabilities}', '{}'::jsonb)
          || '{"supportsSupersession": true}'::jsonb)
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN (retained_original_target_content -> 'definition') ? 'agentSettableStatuses' THEN jsonb_build_object(
        'agentSettableStatuses', (retained_original_target_content #> '{definition,agentSettableStatuses}') - 'SUPERSEDED')
      ELSE '{}'::jsonb
    END)
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND jsonb_typeof(retained_original_target_content #> '{definition,allowedStatuses}') = 'array';

