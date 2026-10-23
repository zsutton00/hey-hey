-- Correct the Workflow preference section added by V2026.09.08.2. The
-- preference is optional for existing and future Workflow instances, and the
-- independently persisted graphLayout position declaration must remain intact.

UPDATE "work_item_type" AS "workflow_type"
SET "section_definitions" = (
  SELECT jsonb_agg(
    CASE
      WHEN "section"."definition" ->> 'key' = 'graphLayoutPreference'
        THEN jsonb_set(
          "section"."definition",
          '{required}',
          'false'::jsonb,
          true
        )
      ELSE "section"."definition"
    END
    ORDER BY "section"."ordinality"
  )
  FROM jsonb_array_elements("workflow_type"."section_definitions")
    WITH ORDINALITY AS "section"("definition", "ordinality")
)
WHERE "workflow_type"."type_key" = 'workflow'
  AND "workflow_type"."section_definitions"
    @> '[{"key":"graphLayoutPreference"}]'::jsonb;

UPDATE "work_item_type_template" AS "workflow_template"
SET "section_definitions" = (
  SELECT jsonb_agg(
    CASE
      WHEN "section"."definition" ->> 'key' = 'graphLayoutPreference'
        THEN jsonb_set(
          "section"."definition",
          '{required}',
          'false'::jsonb,
          true
        )
      ELSE "section"."definition"
    END
    ORDER BY "section"."ordinality"
  )
  FROM jsonb_array_elements("workflow_template"."section_definitions")
    WITH ORDINALITY AS "section"("definition", "ordinality")
)
WHERE "workflow_template"."type_key" = 'workflow'
  AND "workflow_template"."section_definitions"
    @> '[{"key":"graphLayoutPreference"}]'::jsonb;
