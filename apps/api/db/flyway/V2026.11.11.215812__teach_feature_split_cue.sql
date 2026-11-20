-- Append the oversized-feature split cue to the canonical FEATURE writing standards.
-- Advice only: project-owned complete overrides are not touched.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "work_item_type_template" WHERE "type_key" = 'FEATURE'
  ) THEN
    RAISE EXCEPTION
      'Cannot add feature split cue; canonical FEATURE template is missing';
  END IF;
END
$migration$;

WITH split_cue AS (
  SELECT $split$## Oversized features

While creating or editing a feature, notice when it is becoming too large to read cheaply when pulled in whole: roughly 16–20 or more requirements, a very long description, or more than one coherent product capability. When it is, tell the user and ask whether to split it. Wait for the answer; never split, block, or truncate the feature on your own, and do not ask when the feature is comfortably small. If the user agrees, propose smaller capability-focused child features under it, keep a short parent body that links to them, and reparent or link the affected tasks.$split$ AS value
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_set(
      jsonb_set(
        COALESCE(template."writing_standards", '{}'::jsonb),
        '{create}',
        to_jsonb(
          COALESCE(template."writing_standards"->>'create', '') ||
          E'\n\n' || split_cue.value
        ),
        true
      ),
      '{edit}',
      to_jsonb(
        COALESCE(template."writing_standards"->>'edit', '') ||
        E'\n\n' || split_cue.value
      ),
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM split_cue
WHERE template."type_key" = 'FEATURE'
  AND position(split_cue.value IN COALESCE(template."writing_standards"->>'create', '')) = 0
  AND position(split_cue.value IN COALESCE(template."writing_standards"->>'edit', '')) = 0;
