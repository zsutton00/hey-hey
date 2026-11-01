-- An Eval Case names the handler under test by registry key, and a Project
-- Assistant case also names the consumer handler whose real policy it runs
-- under, always explicitly. This updates the canonical and project-owned Eval
-- Case definitions, then moves existing cases to the new sections: Project
-- Assistant cases (including the long sentence the runner used to
-- pattern-match) get `project_assistant` as their handler and
-- `entity_conversation` as their consumer; every other case gets an empty
-- consumer section. Idempotent: a case that already has the section is skipped.
CREATE FUNCTION pg_temp.eval_case_sections(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT jsonb_agg(entry ORDER BY pos)
  FROM (
    SELECT
      CASE WHEN section->>'key' = 'handler'
        THEN jsonb_set(section, '{writingStandard}', to_jsonb($handler$Name the handler under test by its registry key, and nothing else. The evaluable handlers are `agent_search`, `entity_conversation` and `project_assistant`. A handler not on this list cannot be run, and approval and launch both reject it. Choose `project_assistant` to evaluate the research report Project Assistant writes; choose `entity_conversation` to evaluate the reply an entity conversation gives, run as real use runs it.$handler$::text))
        ELSE section
      END AS entry,
      ordinal * 2 AS pos
    FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
    UNION ALL
    SELECT
      jsonb_build_object(
        'key', 'consumerHandler',
        'kind', 'markdown',
        'label', 'Consumer handler',
        'writingStandard', $consumer$Only for a Project Assistant case: name, by registry key, the handler whose real Project Assistant policy, tools and prompt the research runs under, and nothing else. It is always explicit and has no default. The consumers are `startup_session`, `design_doc_refiner`, `feature_sync_analyze`, `feature_refiner`, `task_refiner`, `plan_shaping_feature_sync_analyze`, `free_form`, `entity_conversation`, `html_css_mockup_revision` and `validation_walkthrough`; they differ in whether Project Assistant may propose changes, update links or flag discrepancies. Leave this section empty for every other handler.$consumer$::text),
      ordinal * 2 + 1
    FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
    WHERE section->>'key' = 'handler'
  ) AS entries
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_sections(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(section_definitions) AS s(section)
    WHERE section->>'key' = 'consumerHandler'
  );

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_sections(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(section_definitions) AS s(section)
    WHERE section->>'key' = 'consumerHandler'
  );

DO $migration$
BEGIN
  CREATE TEMP TABLE pending_eval_cases ON COMMIT DROP AS
  SELECT
    t.id AS task_id,
    h."order" AS handler_order,
    (btrim(coalesce(h.materialized_markdown, '')) = 'project_assistant'
      OR coalesce(h.materialized_markdown, '') ~ '^\s*Project Assistant research, run with the request above as the user''s prompt and .+ as the focal item\.\s*$') AS is_project_assistant
  FROM tasks t
  JOIN task_sections h ON h.task_id = t.id AND h.key = 'handler'
  WHERE t.type = 'EVAL_CASE'
    AND NOT EXISTS (
      SELECT 1 FROM task_sections c WHERE c.task_id = t.id AND c.key = 'consumerHandler'
    );

  UPDATE task_sections s
  SET "order" = s."order" + 1
  FROM pending_eval_cases p
  WHERE s.task_id = p.task_id AND s."order" > p.handler_order;

  INSERT INTO task_sections (id, task_id, key, "order", materialized_markdown, created_at, updated_at)
  SELECT
    'task-section-' || p.task_id || '-consumerHandler',
    p.task_id,
    'consumerHandler',
    p.handler_order + 1,
    CASE WHEN p.is_project_assistant THEN 'entity_conversation' ELSE '' END,
    NOW(),
    NOW()
  FROM pending_eval_cases p;

  UPDATE task_sections s
  SET materialized_markdown = 'project_assistant', updated_at = NOW()
  FROM pending_eval_cases p
  WHERE s.task_id = p.task_id AND s.key = 'handler' AND p.is_project_assistant;
END
$migration$;
