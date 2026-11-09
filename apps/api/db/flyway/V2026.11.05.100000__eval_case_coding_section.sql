-- Adds the schema-backed Coding section to the Eval Case type, after the
-- handler sections. It is accepted only for a `free_form` case; approval and
-- launch both check it. Idempotent: a definition that has it is left alone.
CREATE FUNCTION pg_temp.eval_case_coding(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(definitions) AS s(section)
      WHERE section->>'key' = 'coding'
    ) THEN definitions
    ELSE definitions || jsonb_build_array(jsonb_build_object(
      'key', 'coding',
      'kind', 'json',
      'label', 'Coding',
      'schemaRef', '#/components/schemas/EvalCaseCoding',
      'writingStandard', $coding$Only for a case whose handler is `free_form`; leave the section out for every other handler. Give the Service the attempt works in, the full 40-character SHA of the commit it starts from with that commit's first message line, optional targeted test commands the runner (not the agent) runs after the agent finishes (leave empty to run none; never the full suite), and the known-good and known-bad versions of the change as diffs. It is for the runner and judge only and is never shown to the tested agent.$coding$
    ))
  END
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_coding(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding(section_definitions);

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_coding(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding(section_definitions);
