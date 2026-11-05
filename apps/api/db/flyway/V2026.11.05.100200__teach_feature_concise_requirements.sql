-- Append concise-requirement advice to the canonical FEATURE writing standards.
-- Advice only: project-owned complete overrides are not touched.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "work_item_type_template" WHERE "type_key" = 'FEATURE'
  ) THEN
    RAISE EXCEPTION
      'Cannot add concise requirement guidance; canonical FEATURE template is missing';
  END IF;
END
$migration$;

WITH concise_guidance AS (
  SELECT $concise$## Concise requirements

Keep each requirement as concise as possible. Make its first sentence a self-contained summary of the promised behavior, and keep further detail only where it changes what is delivered. Cite the owning task, design doc or Contract instead of restating its content. Split a requirement that bundles several independent rules into separate requirements, or move the detail to the fulfilling task.$concise$ AS value
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_set(
      jsonb_set(
        COALESCE(template."writing_standards", '{}'::jsonb),
        '{create}',
        to_jsonb(
          COALESCE(template."writing_standards"->>'create', '') ||
          E'\n\n' || concise_guidance.value
        ),
        true
      ),
      '{edit}',
      to_jsonb(
        COALESCE(template."writing_standards"->>'edit', '') ||
        E'\n\n' || concise_guidance.value
      ),
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM concise_guidance
WHERE template."type_key" = 'FEATURE'
  AND position(concise_guidance.value IN COALESCE(template."writing_standards"->>'create', '')) = 0
  AND position(concise_guidance.value IN COALESCE(template."writing_standards"->>'edit', '')) = 0;
