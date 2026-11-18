-- New-versus-existing moves off a coding case's Mockup checklist onto the Coding
-- section's `target`, so every coding case says it the same way. For each Coding
-- section, and each case recorded in an EVAL_RUN report, a checklist `kind` of
-- NEW becomes `target.kind` NEW and UPDATE becomes EXISTING, with no path. The
-- checklist keeps its Mockup and items. A `target` that already exists is kept.
-- A missing or unrecognised `kind` is only removed and no target is guessed, so
-- that case fails at its next launch with a message naming the missing target.
-- Recorded runs are rewritten so old results still say new versus existing.
-- Section history is left as it was.
-- Idempotent: a section or case whose checklist has no `kind` is untouched.
CREATE FUNCTION pg_temp.target_kind(checklist_kind text) RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE checklist_kind WHEN 'NEW' THEN 'NEW' WHEN 'UPDATE' THEN 'EXISTING' END
$function$;

-- A checklist kind this migration cannot turn into a target, with no target already set.
CREATE FUNCTION pg_temp.kind_unrecognised(coding jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(
    jsonb_typeof(coding) = 'object'
    AND jsonb_typeof(coding -> 'mockupChecklist') = 'object'
    AND coding -> 'mockupChecklist' ? 'kind'
    AND NOT (coding ? 'target')
    AND pg_temp.target_kind(coding #>> '{mockupChecklist,kind}') IS NULL,
    false)
$function$;

CREATE FUNCTION pg_temp.parse_json(content text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $function$
BEGIN
  IF content IS NULL OR btrim(content) = '' THEN
    RETURN NULL;
  END IF;
  RETURN content::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$function$;

CREATE FUNCTION pg_temp.coding_with_target(coding jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  kind text;
BEGIN
  IF coding IS NULL OR jsonb_typeof(coding) <> 'object'
     OR jsonb_typeof(coding -> 'mockupChecklist') IS DISTINCT FROM 'object'
     OR NOT (coding -> 'mockupChecklist' ? 'kind') THEN
    RETURN coding;
  END IF;

  kind := pg_temp.target_kind(coding #>> '{mockupChecklist,kind}');
  coding := jsonb_set(coding, '{mockupChecklist}', (coding -> 'mockupChecklist') - 'kind');
  IF kind IS NOT NULL AND NOT (coding ? 'target') THEN
    coding := coding || jsonb_build_object('target', jsonb_build_object('kind', kind));
  END IF;
  RETURN coding;
END
$function$;

CREATE FUNCTION pg_temp.coding_section_with_target(content text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  parsed jsonb;
BEGIN
  IF content IS NULL OR btrim(content) = '' THEN
    RETURN content;
  END IF;
  BEGIN
    parsed := content::jsonb;
  EXCEPTION WHEN others THEN
    -- Not JSON: leave it for the section validator to report.
    RETURN content;
  END;
  IF pg_temp.coding_with_target(parsed) = parsed THEN
    RETURN content;
  END IF;
  RETURN pg_temp.coding_with_target(parsed)::text;
END
$function$;

CREATE FUNCTION pg_temp.run_payload_with_targets(payload jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE WHEN jsonb_typeof(payload -> 'cases') = 'array' THEN
    jsonb_set(payload, '{cases}', (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN jsonb_typeof(c) = 'object' AND c ? 'coding'
          THEN jsonb_set(c, '{coding}', pg_temp.coding_with_target(c -> 'coding'))
          ELSE c
        END
        ORDER BY ordinal
      ), '[]'::jsonb)
      FROM jsonb_array_elements(payload -> 'cases') WITH ORDINALITY AS e(c, ordinal)
    ))
    ELSE payload
  END
$function$;

CREATE FUNCTION pg_temp.eval_case_coding_target_standard(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN section->>'key' = 'coding' AND strpos(section->>'writingStandard', $old$, `kind` (`NEW` or `UPDATE`) and `items`$old$) > 0
      THEN jsonb_set(section, '{writingStandard}', to_jsonb(
        replace(
          replace(
            section->>'writingStandard',
            $old$

When the case comes from a Mockup, add `mockupChecklist`$old$,
            $new$

Add `target` to say what the case is about: `kind` is `NEW` for a new screen or component or `EXISTING` for a change to an existing one, and the optional `path` is where it lives in the Service. A case built from a Mockup must have a `target`; for other cases it is optional.

When the case comes from a Mockup, add `mockupChecklist`$new$
          ),
          $old$`mockupId` (the source Mockup, which must be in this project), `kind` (`NEW` or `UPDATE`) and `items`, each an `id` (unique within the checklist, short and stable) and a `description`. For a `NEW` Mockup, list one item for each control named by a `data-hh-id` in the Mockup, covering every control. For an `UPDATE`, compare$old$,
          $new$`mockupId` (the source Mockup, which must be in this project) and `items`, each an `id` (unique within the checklist, short and stable) and a `description`. When the target is `NEW`, list one item for each control named by a `data-hh-id` in the Mockup, covering every control. When it is `EXISTING`, compare$new$
        )
      ))
      ELSE section
    END
    ORDER BY ordinal
  ), definitions)
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

DO $migration$
DECLARE
  unrecognised_sections integer;
  unrecognised_runs integer;
  changed_sections integer;
  changed_runs integer;
BEGIN
  SELECT count(*) INTO unrecognised_sections
  FROM task_sections s
  JOIN tasks t ON t.id = s.task_id
  WHERE t.type = 'EVAL_CASE'
    AND s.key = 'coding'
    AND pg_temp.kind_unrecognised(pg_temp.parse_json(s.materialized_markdown));

  SELECT count(*) INTO unrecognised_runs
  FROM reports r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.payload::jsonb -> 'cases') = 'array'
      THEN r.payload::jsonb -> 'cases' ELSE '[]'::jsonb END
  ) AS c(entry)
  WHERE r.report_type = 'EVAL_RUN'
    AND pg_temp.kind_unrecognised(c.entry -> 'coding');

  UPDATE task_sections s
  SET materialized_markdown = pg_temp.coding_section_with_target(s.materialized_markdown),
      updated_at = NOW()
  FROM tasks t
  WHERE s.task_id = t.id
    AND t.type = 'EVAL_CASE'
    AND s.key = 'coding'
    AND s.materialized_markdown IS DISTINCT FROM pg_temp.coding_section_with_target(s.materialized_markdown);
  GET DIAGNOSTICS changed_sections = ROW_COUNT;

  UPDATE reports r
  SET payload = pg_temp.run_payload_with_targets(r.payload::jsonb)
  WHERE r.report_type = 'EVAL_RUN'
    AND r.payload::jsonb IS DISTINCT FROM pg_temp.run_payload_with_targets(r.payload::jsonb);
  GET DIAGNOSTICS changed_runs = ROW_COUNT;

  RAISE NOTICE 'eval case checklist kind -> target: % coding sections and % EVAL_RUN reports rewritten; % sections and % recorded cases had a missing or unrecognised kind and got no target',
    changed_sections, changed_runs, unrecognised_sections, unrecognised_runs;
END
$migration$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_coding_target_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_target_standard(section_definitions);

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_coding_target_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_target_standard(section_definitions);
