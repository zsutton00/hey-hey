-- An Eval Case holds its user message(s) in a required, schema-backed `inputs`
-- JSON section (an object with an ordered `inputs` list; the only kind is a
-- `text_message`) instead of the free Markdown `request` section.
--
-- 1. Type definitions: `request` is replaced in place by `inputs` (explicitly
--    `required: true`) and the writing standards are rewritten. Both
--    `work_item_type_template` and `work_item_type` are updated; the latter
--    holds project-owned copies, which override the canonical one as a whole.
-- 2. Case records: each live EVAL_CASE with a `request` section and no
--    `inputs` section gets one text-message input holding the exact request
--    text, in the request's order slot; the `request` section is then removed.
--    Every record runs in its own sub-block: a failure raises a NOTICE with the
--    task id and cause, keeps the original `request`, and does not stop others.
-- Idempotent: a definition without `request` and a case with `inputs` are
-- left alone. Section history and archived revisions are not rewritten.
CREATE FUNCTION pg_temp.eval_case_inputs_definitions(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE section->>'key'
      WHEN 'request' THEN jsonb_build_object(
        'key', 'inputs',
        'kind', 'json',
        'label', 'Inputs',
        'required', true,
        'schemaRef', '#/components/schemas/EvalCaseInputs',
        'writingStandard', $inputs$Write a JSON object with an `inputs` list of one or more inputs; the only kind is `text_message`, for example {"inputs":[{"kind":"text_message","text":"Add a mobile view to the settings page."}]}. Every message is fixed text worded exactly as a real user would type it, in the user's own words; it must stand alone without the Situation or the items list, and it holds inline entity mentions only for items a real user would attach in that message. Do not write a simulated user who reacts to the agent. To test a later message, put earlier messages first: the agent gives its own real reply to each, and only the final input is judged, so everything the judge needs to assess must follow from that last message. Use one input for a single request and more only when the case needs earlier turns to build context. Keep it free of situation, expectations, checks or rubric: the tested agent receives these messages and nothing else.$inputs$
      )
      WHEN 'situation' THEN jsonb_set(section, '{writingStandard}', to_jsonb($situation$Describe the realistic situation the case starts from, in terms of what the user is trying to accomplish and what state the project is in. This is reviewer and judge context only and is never sent to the tested agent; it may explain the test point, including why earlier inputs are there when the case has more than one.$situation$::text))
      WHEN 'items' THEN jsonb_set(section, '{writingStandard}', to_jsonb($items$List real items with inline entity mentions and explain their roles. The first mentioned item is the focal item and starts the session through normal entity-context loading and template rendering, so use its correct entity family (task for work items, whose subtype is loaded from authoritative data). The items list and supporting items are reviewer and judge context, never sent to the tested agent. Put any item a real user would attach in an input's message itself.$items$::text))
      ELSE section
    END
    ORDER BY ordinal
  ), definitions)
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_inputs_definitions(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(section_definitions) AS s(section)
    WHERE section->>'key' = 'request'
  );

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_inputs_definitions(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(section_definitions) AS s(section)
    WHERE section->>'key' = 'request'
  );

-- Prose about the type that still names the former request. Phrases not
-- present (already changed, or edited by a project) are left as they are.
CREATE FUNCTION pg_temp.eval_case_prose(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT replace(replace(replace(value,
    'the single request that starts it', 'the fixed user messages that drive it'),
    'Keep the situation, request, expectations and checks consistent', 'Keep the situation, inputs, expectations and checks consistent'),
    'the scenario, the initiating request,', 'the scenario, the inputs,')
$function$;

UPDATE work_item_type_template
SET description = pg_temp.eval_case_prose(description),
    writing_standards = pg_temp.eval_case_prose(writing_standards::text)::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND (description IS DISTINCT FROM pg_temp.eval_case_prose(description)
    OR writing_standards::text IS DISTINCT FROM pg_temp.eval_case_prose(writing_standards::text));

UPDATE work_item_type
SET description = pg_temp.eval_case_prose(description),
    writing_standards = pg_temp.eval_case_prose(writing_standards::text)::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND (description IS DISTINCT FROM pg_temp.eval_case_prose(description)
    OR writing_standards::text IS DISTINCT FROM pg_temp.eval_case_prose(writing_standards::text));

DO $migration$
DECLARE
  pending RECORD;
BEGIN
  FOR pending IN
    SELECT r.id AS request_id, r.task_id, r."order" AS request_order, r.materialized_markdown AS request_text
    FROM task_sections r
    JOIN tasks t ON t.id = r.task_id
    WHERE t.type = 'EVAL_CASE'
      AND r.key = 'request'
      AND NOT EXISTS (
        SELECT 1 FROM task_sections i WHERE i.task_id = r.task_id AND i.key = 'inputs'
      )
    ORDER BY r.task_id
  LOOP
    BEGIN
      IF pending.request_text IS NULL OR btrim(pending.request_text) = '' THEN
        RAISE EXCEPTION 'request section is empty';
      END IF;

      INSERT INTO task_sections (id, task_id, key, "order", materialized_markdown, created_at, updated_at)
      VALUES (
        'task-section-' || pending.task_id || '-inputs',
        pending.task_id,
        'inputs',
        pending.request_order,
        jsonb_build_object(
          'inputs',
          jsonb_build_array(
            jsonb_build_object('kind', 'text_message', 'text', pending.request_text)
          )
        )::text,
        NOW(),
        NOW()
      );

      DELETE FROM task_sections WHERE id = pending.request_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'eval case inputs migration skipped task %: % (%)',
        pending.task_id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
END
$migration$;
