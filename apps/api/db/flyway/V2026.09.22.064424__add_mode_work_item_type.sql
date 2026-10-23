-- Register the canonical project-defined coding MODE. The registry snapshot
-- projects canonical templates into every project unless that project owns an
-- explicit override, so no per-project rows are synthesized here.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE'
  ) OR EXISTS (
    SELECT 1 FROM work_item_type WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot reserve MODE: a canonical template or project definition already uses that key';
  END IF;
END
$migration$;

INSERT INTO work_item_type_template (
  id, type_key, name, role, icon_key, description, section_definitions,
  allowed_parent_types, edge_targets, allowed_statuses, required_scalars,
  forbidden_scalars, parentage, tracking, agent_settable_statuses,
  anchorable_report_types, writing_standards, capabilities,
  graph_configuration, agent_guidance, accepted_config_kinds,
  created_at, updated_at
) VALUES (
  '7f51f88d-acde-4dad-ae4f-3bd0501437cf',
  'MODE',
  'Mode',
  'project-info',
  NULL,
  'A project-owned coding-agent mode: catalog guidance plus a validated text-file bundle used to capture one immutable session launch configuration.',
  '[{"key":"description","label":"Catalog description","kind":"markdown","writingStandard":"Explain when a user should choose this mode and what working discipline it provides."},{"key":"files","label":"Files","kind":"json","schemaRef":"#/components/schemas/ProjectModeFiles","writingStandard":"Provide a project-mode-files.v1 bundle with a concise MODE.md entry document and optional supporting text files under safe relative POSIX paths."}]'::jsonb,
  '[]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":["MODE"]},{"edgeType":"SUPERSEDES","targetTypeKeys":["MODE"]},{"edgeType":"EVOLVES","targetTypeKeys":["MODE"]}]'::jsonb,
  '["ACTIVE","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate","tag"]'::jsonb,
  '{"allowedParentEntityTypes":[]}'::jsonb,
  '{"allowedSourceEntityTypes":[],"allowedSourceTaskTypes":[]}'::jsonb,
  '["ACTIVE","ARCHIVED"]'::jsonb,
  '[]'::jsonb,
  '{"create":"Create MODE at the project root. Keep MODE.md compact, put optional detail in supporting files, and treat file text as instructions rather than executable hooks or authority grants.","edit":"Preserve safe relative file paths and a non-empty MODE.md. Editing a MODE never changes snapshots already captured by Agent Sessions."}'::jsonb,
  '{"requiresParent":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"showsInExplorerSidebar":true}'::jsonb,
  NULL,
  '{"overview":"A MODE is a project-owned coding-agent behavior bundle. Use it for a selectable working discipline with one entry document and optional on-demand supporting text.","examples":[{"title":"Review discipline","guidance":"Use MODE.md for concise startup instructions and references/checklist.md for the detailed review checklist."}],"contexts":[{"focalTypeKeys":["STANDARD"],"guidance":"Project modes in this initial slice apply to STANDARD work items."}]}'::jsonb,
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
