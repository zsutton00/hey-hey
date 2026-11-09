-- Extends the Coding section's writing standard so a case built from a Mockup
-- carries a Mockup checklist (`mockupChecklist`: source Mockup, NEW or UPDATE,
-- and the items to check). The section schema accepts the field; approval and
-- launch check that the Mockup is in the project, has at least one item, and
-- that item ids are unique.
-- Idempotent: a standard that already mentions the checklist is left alone.
CREATE FUNCTION pg_temp.eval_case_coding_checklist_standard(definitions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN section->>'key' = 'coding' AND section->>'writingStandard' NOT LIKE '%mockupChecklist%'
      THEN jsonb_set(section, '{writingStandard}', to_jsonb((section->>'writingStandard') || $coding$

When the case comes from a Mockup, add `mockupChecklist` with `mockupId` (the source Mockup, which must be in this project), `kind` (`NEW` or `UPDATE`) and `items`, each an `id` (unique within the checklist, short and stable) and a `description`. For a `NEW` Mockup, list one item for each control named by a `data-hh-id` in the Mockup, covering every control. For an `UPDATE`, compare the Mockup's previous and current revisions and list only what differs between them. Write each item as an observable outcome a person could confirm in the running interface ("Each stage header shows an effort estimate"), never a pixel, colour or spacing check. Leave `mockupChecklist` out when the case does not come from a Mockup.$coding$::text))
      ELSE section
    END
    ORDER BY ordinal
  ), definitions)
  FROM jsonb_array_elements(definitions) WITH ORDINALITY AS s(section, ordinal)
$function$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.eval_case_coding_checklist_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_checklist_standard(section_definitions);

UPDATE work_item_type
SET section_definitions = pg_temp.eval_case_coding_checklist_standard(section_definitions),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL_CASE'
  AND section_definitions IS DISTINCT FROM pg_temp.eval_case_coding_checklist_standard(section_definitions);
