DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'mockup') THEN
    RAISE EXCEPTION 'Cannot add UX flow role advice; canonical Mockup template is missing';
  END IF;
END
$migration$;

WITH advice AS (
  SELECT $advice$
{
  "implementation": "When a reviewed UX flow Diagram connects this Mockup to other screens, treat the flow as the intended journey: implement its transitions and triggering actions, and raise any departure before making it.",
  "planning": "When a reviewed UX flow connects the Mockup to other screens, carry its transitions and triggering actions into scope and verification.",
  "review": "When a reviewed UX flow connects the Mockup to other screens, check that the delivered journey follows its transitions."
}$advice$::jsonb AS value
)
UPDATE work_item_type_template
SET session_role_guidance = jsonb_set(jsonb_set(jsonb_set(COALESCE(session_role_guidance, '{}'::jsonb), '{implementation}', to_jsonb(COALESCE(session_role_guidance->>'implementation', '') || ' ' || (advice.value->>'implementation'))), '{planning}', to_jsonb(COALESCE(session_role_guidance->>'planning', '') || ' ' || (advice.value->>'planning'))), '{review}', to_jsonb(COALESCE(session_role_guidance->>'review', '') || ' ' || (advice.value->>'review'))),
    updated_at = CURRENT_TIMESTAMP
FROM advice
WHERE type_key = 'mockup';
