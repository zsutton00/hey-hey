-- Adds sync to the shipped Agent Mode role wording. Only the exact sentences published by
-- V2026.10.24.053221 are replaced, so project-authored text around or instead of them is kept.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot publish sync MODE session role guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

CREATE FUNCTION pg_temp.publish_sync_role(input text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT replace(replace(replace(input,
    'Set sessionRole to implementation, research, planning, or review. Omitted sessionRole',
    'Set sessionRole to implementation, research, planning, review, or sync (the role of Feature Sync reconciliation work). Omitted sessionRole'),
    'using settings.sessionRole: implementation, research, planning, or review. Omission defaults',
    'using settings.sessionRole: implementation, research, planning, review, or sync (reconciling delivered or planned work against project artifacts). Omission defaults'),
    'Use implementation, research, planning, or review; omission defaults',
    'Use implementation, research, planning, review, or sync; omission defaults')
$fn$;

CREATE FUNCTION pg_temp.publish_sync_sections(sections jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_agg(
    CASE WHEN section->>'key' = 'settings' AND section ? 'writingStandard' THEN
      jsonb_set(section, '{writingStandard}', to_jsonb(pg_temp.publish_sync_role(section->>'writingStandard')))
    ELSE section END ORDER BY position)
  FROM jsonb_array_elements(sections) WITH ORDINALITY AS definitions(section, position)
$fn$;

UPDATE work_item_type_template
SET section_definitions = pg_temp.publish_sync_sections(section_definitions),
    writing_standards = jsonb_set(
      jsonb_set(writing_standards, '{create}', to_jsonb(pg_temp.publish_sync_role(writing_standards->>'create')), false),
      '{edit}', to_jsonb(pg_temp.publish_sync_role(writing_standards->>'edit')), false),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'MODE'
  AND writing_standards ? 'create' AND writing_standards ? 'edit';

UPDATE work_item_type
SET section_definitions = pg_temp.publish_sync_sections(section_definitions),
    writing_standards = jsonb_set(
      jsonb_set(writing_standards, '{create}', to_jsonb(pg_temp.publish_sync_role(writing_standards->>'create')), false),
      '{edit}', to_jsonb(pg_temp.publish_sync_role(writing_standards->>'edit')), false),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'MODE'
  AND project_id IS NOT NULL
  AND lifecycle_status = 'active'
  AND writing_standards ? 'create' AND writing_standards ? 'edit';
