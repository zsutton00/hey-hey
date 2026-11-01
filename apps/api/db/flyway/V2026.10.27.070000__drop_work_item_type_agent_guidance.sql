-- Session-role guidance replaces standalone semantic guidance; maintenance and
-- session-role guidance columns are unaffected. A MODE whose settings omit
-- eligibleWorkItemTypeKeys now applies to STANDARD work items only, so the
-- canonical MODE standards stop pointing authors at the shared fallback.
DO $migration$
DECLARE
  settings_stale constant text := 'it affects this MODE only, and omitting it keeps the shared fallback compatibility.';
  settings_current constant text := 'it affects this MODE only, and omitting it limits the MODE to STANDARD work items.';
  create_stale constant text := 'custom types included, instead of widening shared MODE type guidance.';
  create_current constant text := 'custom types included; without the list a MODE applies to STANDARD work items only.';
  edit_stale constant text := 'edit that MODE''s settings.eligibleWorkItemTypeKeys. Do not edit this type''s agentGuidance: it is shared by every MODE and is only the fallback for MODEs without the list.';
  edit_current constant text := 'edit that MODE''s settings.eligibleWorkItemTypeKeys; without the list a MODE applies to STANDARD work items only.';
BEGIN
  UPDATE work_item_type_template AS mode
  SET section_definitions = (
          SELECT jsonb_agg(
            CASE WHEN section->>'key' = 'settings'
              THEN jsonb_set(section, '{writingStandard}',
                to_jsonb(replace(section->>'writingStandard', settings_stale, settings_current)))
              ELSE section END
            ORDER BY ordinal)
          FROM jsonb_array_elements(mode.section_definitions) WITH ORDINALITY AS s(section, ordinal)
        ),
        writing_standards = jsonb_set(
          jsonb_set(mode.writing_standards, '{create}',
            to_jsonb(replace(mode.writing_standards->>'create', create_stale, create_current))),
          '{edit}',
          to_jsonb(replace(mode.writing_standards->>'edit', edit_stale, edit_current)))
  WHERE mode.type_key = 'MODE'
    AND mode.writing_standards ? 'create'
    AND mode.writing_standards ? 'edit';
END
$migration$;

ALTER TABLE work_item_type DROP COLUMN agent_guidance;
ALTER TABLE work_item_type_template DROP COLUMN agent_guidance;
