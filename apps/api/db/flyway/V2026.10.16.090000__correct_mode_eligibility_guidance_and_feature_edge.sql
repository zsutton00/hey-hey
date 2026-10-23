-- Per-MODE type eligibility lives in settings.eligibleWorkItemTypeKeys; the shared
-- agentGuidance.contexts focal keys are only the fallback for MODEs without it.
-- Outbound MODE-to-Feature DEPENDS_ON is the Feature filter, so the registry must
-- permit it. V2026.09.22.094613 only widened an existing DEPENDS_ON edge, and the
-- original MODE definition had none, so the edge target was never added.
-- The fallback focal keys themselves are untouched, so no MODE gains eligibility.
-- Only the canonical template is updated; project-owned MODE type definitions are
-- deliberately left alone.
DO $migration$
DECLARE
  overview_pattern constant text := 'Feature eligibility intersects with the MODE.s agentGuidance\.contexts\[\]\.focalTypeKeys work-item-type compatibility; neither axis replaces the other\.';
  overview_replacement constant text := 'Work-item-type eligibility is set per MODE, not on this shared type. A MODE''s settings.eligibleWorkItemTypeKeys lists the active project work-item type keys it applies to, custom keys included. To enable one MODE for a type, edit that MODE''s settings section and leave this type''s agentGuidance untouched: the shared agentGuidance.contexts[].focalTypeKeys apply to every MODE and are only the fallback for a MODE whose settings omit the list, so existing MODEs keep their eligibility until their list is set. Feature eligibility intersects with the type list; neither axis replaces the other.';
  context_guidance constant text := 'Fallback applicability for MODEs whose settings omit eligibleWorkItemTypeKeys. A MODE''s own list takes precedence; do not edit this entry to enable a single MODE.';
  settings_standard constant text := 'Provide a project-mode-settings.v1 value. Set projectAssistant.enabled deliberately: true when sessions in this mode benefit from Project Assistant preparing project context and keeping the project graph current before the first turn; false when the mode''s work does not need that. Omitting the section keeps Project Assistant on. Set eligibleWorkItemTypeKeys to the unique, non-empty list of active project work-item type keys this MODE applies to; it affects this MODE only, and omitting it keeps the shared fallback compatibility. Feature scope is separate: use an outbound DEPENDS_ON to a Feature.';
  create_stale_pattern constant text := 'Declare applicability in `agentGuidance\.contexts\[\]\.focalTypeKeys` using only stable effective work-item type keys that are active in this project\. Do not use display names, proposal IDs, archived keys, or unknown keys\.';
  edit_stale_pattern constant text := 'When changing applicability, keep `agentGuidance\.contexts\[\]\.focalTypeKeys` limited to stable effective work-item type keys that are active in this project\. Do not use display names, proposal IDs, archived keys, or unknown keys\.';
  create_standard constant text := 'Set eligibleWorkItemTypeKeys in the settings section for the work-item types this MODE applies to, custom types included, instead of widening shared MODE type guidance. Limit the MODE to a Feature''s work with an outbound DEPENDS_ON to that Feature.';
  edit_standard constant text := 'To change which work-item types one MODE applies to, edit that MODE''s settings.eligibleWorkItemTypeKeys. Do not edit this type''s agentGuidance: it is shared by every MODE and is only the fallback for MODEs without the list. Changes affect sessions launched afterward.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot correct MODE eligibility guidance; canonical MODE template is missing';
  END IF;

  UPDATE work_item_type_template AS mode
  SET edge_targets = (
          SELECT CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(mode.edge_targets) AS edge
              WHERE edge->>'edgeType' = 'DEPENDS_ON'
            ) THEN mode.edge_targets || '[{"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]}]'::jsonb
            ELSE (
              SELECT jsonb_agg(
                CASE
                  WHEN edge->>'edgeType' = 'DEPENDS_ON'
                    AND jsonb_array_length(COALESCE(edge->'targetTypeKeys', '[]'::jsonb)) > 0
                    AND NOT (edge->'targetTypeKeys' ? 'FEATURE')
                  THEN jsonb_set(edge, '{targetTypeKeys}', (edge->'targetTypeKeys') || '["FEATURE"]'::jsonb)
                  ELSE edge
                END
                ORDER BY ordinal)
              FROM jsonb_array_elements(mode.edge_targets) WITH ORDINALITY AS e(edge, ordinal)
            )
          END
        ),
        agent_guidance = jsonb_set(
          jsonb_set(
            mode.agent_guidance, '{overview}',
            to_jsonb(regexp_replace(mode.agent_guidance->>'overview', overview_pattern, overview_replacement)), true),
          '{contexts}',
          COALESCE((
            SELECT jsonb_agg(
              CASE WHEN ctx->>'guidance' LIKE 'Project modes in this initial slice%'
                THEN jsonb_set(ctx, '{guidance}', to_jsonb(context_guidance)) ELSE ctx END
              ORDER BY ordinal)
            FROM jsonb_array_elements(mode.agent_guidance->'contexts') WITH ORDINALITY AS c(ctx, ordinal)
          ), '[]'::jsonb), true),
        section_definitions = (
          SELECT jsonb_agg(
            CASE WHEN section->>'key' = 'settings'
              THEN jsonb_set(section, '{writingStandard}', to_jsonb(settings_standard)) ELSE section END
            ORDER BY ordinal)
          FROM jsonb_array_elements(mode.section_definitions) WITH ORDINALITY AS s(section, ordinal)
        ),
        writing_standards = jsonb_set(
          jsonb_set(mode.writing_standards, '{create}',
            to_jsonb(CASE
              WHEN position(create_standard IN COALESCE(mode.writing_standards->>'create', '')) > 0
                THEN mode.writing_standards->>'create'
              ELSE concat_ws(E'\n\n',
                NULLIF(regexp_replace(COALESCE(mode.writing_standards->>'create', ''), create_stale_pattern, create_standard), ''),
                CASE WHEN COALESCE(mode.writing_standards->>'create', '') ~ create_stale_pattern THEN NULL ELSE create_standard END)
            END), true),
          '{edit}',
          to_jsonb(CASE
            WHEN position(edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) > 0
              THEN mode.writing_standards->>'edit'
            ELSE concat_ws(E'\n\n',
              NULLIF(regexp_replace(COALESCE(mode.writing_standards->>'edit', ''), edit_stale_pattern, edit_standard), ''),
              CASE WHEN COALESCE(mode.writing_standards->>'edit', '') ~ edit_stale_pattern THEN NULL ELSE edit_standard END)
          END), true),
        updated_at = CURRENT_TIMESTAMP
  WHERE mode.type_key = 'MODE';
END
$migration$;
