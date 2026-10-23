-- Refine the canonical MODE authoring standards while preserving every other
-- registry axis and every complete project-owned override.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot refine project MODE authoring guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    btrim($mode_create_guidance$
Author the MODE as a project-specific instruction bundle for an already capable coding agent. Include only instructions that materially change decisions or execution in this project, and make each instruction only as specific as the risk and consequence of deviation require. Keep `MODE.md` as a concise entry document that states the mode's purpose, its governing project-specific constraints, and when to read each supporting Markdown file. Put conditional procedures, detailed examples, checklists, and deeper reference material in supporting Markdown files for on-demand reading. The mode operates inside the session-provided selected work item, feature ancestry and graph context, design documents, Service scope, permissions, proposal boundaries, and launch constraints; preserve those inputs and never restate, weaken, or replace them. Registry fields remain authoritative for description, applicability, discovery, and eligibility, so do not duplicate that metadata in `MODE.md`. A MODE is an instruction bundle, not a packaged skill: do not add scripts, assets, hooks, tool installation, executable extensions, automatic activation, or Codex-, Claude-, or other vendor-specific runtime semantics.
$mode_create_guidance$::text, E'\n') AS create_guidance,
    btrim($mode_edit_guidance$
Revise only the MODE instructions and supporting Markdown files needed for the requested behavioral change, preserving unrelated files and every registry-owned definition axis. Write for an already capable coding agent: retain only project-specific material that materially changes decisions or execution, and scale specificity to the risk and consequence of deviation. Keep `MODE.md` concise and move conditional procedures, detailed examples, checklists, and deeper reference material into supporting Markdown files that the entry document names for on-demand reading. Preserve the session-provided selected work item, feature ancestry and graph context, design documents, Service scope, permissions, proposal boundaries, and launch constraints; MODE content must not restate, weaken, or replace them. Do not duplicate registry-owned description, applicability, discovery, or eligibility metadata in `MODE.md`. Keep the MODE an instruction bundle only: do not introduce scripts, assets, hooks, tool installation, executable extensions, automatic activation, skill packaging, or vendor-specific runtime semantics.
$mode_edit_guidance$::text, E'\n') AS edit_guidance
)
UPDATE work_item_type_template AS mode
SET writing_standards = jsonb_set(
      jsonb_set(
        COALESCE(mode.writing_standards, '{}'::jsonb),
        '{create}',
        to_jsonb(guidance.create_guidance),
        true
      ),
      '{edit}',
      to_jsonb(guidance.edit_guidance),
      true
    ),
    updated_at = CURRENT_TIMESTAMP
FROM guidance
WHERE mode.type_key = 'MODE'
  AND (
    mode.writing_standards->>'create' IS DISTINCT FROM guidance.create_guidance
    OR mode.writing_standards->>'edit' IS DISTINCT FROM guidance.edit_guidance
  );
