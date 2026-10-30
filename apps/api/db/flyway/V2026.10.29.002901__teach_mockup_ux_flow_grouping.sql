-- Append only to canonical Mockup standards; preserve project overrides.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'mockup'
  ) THEN
    RAISE EXCEPTION
      'Cannot add Mockup UX flow guidance; canonical Mockup template is missing';
  END IF;
END
$migration$;

WITH ux_flow_guidance AS (
  SELECT $mockup_ux_flow_guidance$UX flows: When a design spans more than one screen, or one screen in several substantial states, also author a UX flow Diagram (kind `UX_FLOW`, level `OVERVIEW`) that connects them. Each screen is an element whose canonical reference is its Mockup. Each transition is a flow link from one screen to the screen that results, with an `actionLabel` saying what the user does, such as "Clicks Request access". Propose the new Mockups and the flow as one proposal group, and have each screen reference the reserved id (`reservedEntityId`) of the Mockup proposed in that group. Judge states by size: a small variation, such as how a control looks when selected, may be shown in one Mockup that several screens of the flow share; a substantial state gets its own Mockup. A single screen with no conditions needs no flow. When the user rejects or annotates a screen or the flow, keep the accepted screens, redesign or add screens as asked, and propose a revised flow in a new group for full review.$mockup_ux_flow_guidance$ AS value
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_set(
      jsonb_set(
        COALESCE(template."writing_standards", '{}'::jsonb),
        '{create}',
        to_jsonb(
          COALESCE(template."writing_standards"->>'create', '') ||
          E'\n\n' || ux_flow_guidance.value
        ),
        true
      ),
      '{edit}',
      to_jsonb(
        COALESCE(template."writing_standards"->>'edit', '') ||
        E'\n\n' || ux_flow_guidance.value
      ),
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM ux_flow_guidance
WHERE template."type_key" = 'mockup';
