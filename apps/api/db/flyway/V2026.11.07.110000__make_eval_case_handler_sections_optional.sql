-- The Eval Case `coding` and `consumerHandler` sections apply only to some
-- handlers (`coding` to `free_form`, `consumerHandler` to `project_assistant`).
-- Creating a work item requires every section not marked `required: false`, so
-- a case for any other handler could not be created. Mark both optional; the
-- per-handler rules stay enforced at approval and launch.
-- Idempotent: a section already marked optional is left alone. `work_item_type`
-- covers project-owned copies of the type as well as canonical ones.

CREATE FUNCTION pg_temp.eval_case_optional_handler_sections(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN section->>'key' IN ('coding', 'consumerHandler')
      THEN jsonb_set(section, '{required}', 'false'::jsonb, true)
      ELSE section
    END
    ORDER BY ordinal
  ), definitions)
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_optional_handler_sections(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_optional_handler_sections(section_definitions);

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_optional_handler_sections(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_optional_handler_sections(section_definitions);
