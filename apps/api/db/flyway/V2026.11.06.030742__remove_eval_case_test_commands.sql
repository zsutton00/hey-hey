-- The runner no longer runs a Coding case's test commands: the evaluated agent
-- installs, builds and tests only when the case's request asks it to. Removes
-- `testCommands` from every current Coding section (the section schema no longer
-- accepts it) and rewrites the Coding writing standard in both type definitions.
-- Saved run snapshots, reports and section history are left as they were.
-- Idempotent: a section without `testCommands` and a current standard is untouched.
CREATE FUNCTION pg_temp.coding_without_test_commands(content text) RETURNS text
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
  IF jsonb_typeof(parsed) <> 'object' OR NOT (parsed ? 'testCommands') THEN
    RETURN content;
  END IF;
  RETURN (parsed - 'testCommands')::text;
END
$function$;

CREATE FUNCTION pg_temp.eval_case_coding_standard(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN section->>'key' = 'coding'
      THEN jsonb_set(section, '{writingStandard}', to_jsonb($coding$Only for a case whose handler is `free_form`; leave the section out for every other handler. Give the Service the attempt works in, the full 40-character SHA of the commit it starts from with that commit's first message line, and the known-good and known-bad versions of the change as diffs. The runner does not install, build or test anything: if the agent should install dependencies, build, or run particular tests, say so in the request. It is for the runner and judge only and is never shown to the tested agent.$coding$::text))
      ELSE section
    END
    ORDER BY ordinal
  ), definitions)
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

UPDATE task_sections s
SET materialized_markdown = pg_temp.coding_without_test_commands(s.materialized_markdown),
    updated_at = NOW()
FROM tasks t
WHERE s.task_id = t.id
  AND t.type = 'EVAL_CASE'
  AND s.key = 'coding'
  AND s.materialized_markdown IS DISTINCT FROM pg_temp.coding_without_test_commands(s.materialized_markdown);

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_coding_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_standard(section_definitions);

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_coding_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_standard(section_definitions);
