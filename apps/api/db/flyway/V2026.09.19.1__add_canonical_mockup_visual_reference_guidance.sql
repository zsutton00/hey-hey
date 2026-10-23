-- Add visual-reference visibility guidance to the canonical Mockup authoring
-- standards. Project-owned definitions intentionally remain untouched; this
-- migration updates only the system-owned canonical template.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'mockup'
  ) THEN
    RAISE EXCEPTION
      'Cannot add Mockup visual-reference guidance; canonical Mockup template is missing';
  END IF;
END
$migration$;

WITH visual_reference_guidance AS (
  SELECT $mockup_visual_reference_guidance$
Visual-reference visibility: Before creating or editing a Mockup that depends on a user-provided visual, verify that every visual the user expects you to use is actually viewable. If any required visual cannot be viewed, report the viewing limitation first and do not create or edit the Mockup until the visual is accessible or the request no longer depends on it.
$mockup_visual_reference_guidance$ AS value
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_set(
      jsonb_set(
        COALESCE(template."writing_standards", '{}'::jsonb),
        '{create}',
        to_jsonb(
          COALESCE(template."writing_standards"->>'create', '') ||
          E'\n\n' || visual_reference_guidance.value
        ),
        true
      ),
      '{edit}',
      to_jsonb(
        COALESCE(template."writing_standards"->>'edit', '') ||
        E'\n\n' || visual_reference_guidance.value
      ),
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM visual_reference_guidance
WHERE template."type_key" = 'mockup';
