-- Change authoring standards only; reviewed case content is left untouched.
CREATE FUNCTION pg_temp.eval_case_request_context(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT jsonb_agg(
    CASE section->>'key'
      WHEN 'situation' THEN jsonb_set(section, '{writingStandard}', to_jsonb($situation$Describe the realistic situation the case starts from, in terms of what the user is trying to accomplish and what state the project is in. This is reviewer and judge context only and is never sent to the tested agent; it may explain the test point.$situation$::text))
      WHEN 'request' THEN jsonb_set(section, '{writingStandard}', to_jsonb($request$Give the single initiating request exactly as a real user would type it, in the user's own words. It must stand alone without the Situation or items list: this is the only user message sent to the tested agent. Include inline entity mentions only for items a real user would attach in that message.$request$::text))
      WHEN 'items' THEN jsonb_set(section, '{writingStandard}', to_jsonb($items$List real items with inline entity mentions and explain their roles. The first mentioned item is the focal item and starts the session through normal entity-context loading and template rendering, so use its correct entity family (task for work items, whose subtype is loaded from authoritative data). The items list and supporting items are reviewer and judge context, never sent to the tested agent. Put any item a real user would attach in the initiating request itself.$items$::text))
      ELSE section
    END ORDER BY ordinal
  )
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_request_context(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE';

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_request_context(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE';
