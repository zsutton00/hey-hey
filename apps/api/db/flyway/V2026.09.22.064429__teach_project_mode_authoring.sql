-- Teach the registered MODE type how to author its reviewable definition.
-- This migration runs after the MODE definition is registered; it changes only
-- the writing_standards axis on the canonical template and the currently
-- materialized project-effective rows.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot teach project MODE authoring; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    $mode_authoring_marker$## MODE authoring contract$mode_authoring_marker$::text AS marker,
    $mode_create_guidance$
## MODE authoring contract

Create MODE as a project-owned coding-agent behavior bundle, not a skill or an executable extension. Use the `description` section as the catalog description: state when a user should choose the mode and what working discipline it provides. Use the schema-backed `files` section for a `project-mode-files.v1` bundle with one non-empty `MODE.md` entry document and optional supporting text files.

Keep `MODE.md` compact and suitable for startup instructions. Put deeper material in supporting files for on-demand reads, and reference each supporting file by a safe relative POSIX path. Do not add absolute paths, traversal paths, executable hooks, tool grants, or provider configuration.

Declare applicability in `agentGuidance.contexts[].focalTypeKeys` using only stable effective work-item type keys that are active in this project. Do not use display names, proposal IDs, archived keys, or unknown keys.
$mode_create_guidance$::text AS create_guidance,
    $mode_edit_guidance$
## MODE authoring contract

Preserve MODE as a project-owned coding-agent behavior bundle, not a skill or an executable extension. Keep the `description` section as the catalog description of when to choose the mode and the working discipline it provides. Keep the schema-backed `files` section as a `project-mode-files.v1` bundle with one non-empty `MODE.md` entry document and optional supporting text files.

Keep `MODE.md` compact and suitable for startup instructions. Keep deeper material in supporting files for on-demand reads, and keep every supporting-file reference a safe relative POSIX path. Do not introduce absolute paths, traversal paths, executable hooks, tool grants, or provider configuration.

When changing applicability, keep `agentGuidance.contexts[].focalTypeKeys` limited to stable effective work-item type keys that are active in this project. Do not use display names, proposal IDs, archived keys, or unknown keys.
$mode_edit_guidance$::text AS edit_guidance
)
UPDATE "work_item_type_template" AS mode
SET "writing_standards" = jsonb_set(
  jsonb_set(
    COALESCE(mode."writing_standards", '{}'::jsonb),
    '{create}',
    to_jsonb(
      CASE
        WHEN mode."writing_standards"->>'create' LIKE '%' || guidance.marker || '%'
          THEN mode."writing_standards"->>'create'
        ELSE concat_ws(E'\n\n', NULLIF(mode."writing_standards"->>'create', ''), guidance.create_guidance)
      END
    ),
    true
  ),
  '{edit}',
  to_jsonb(
    CASE
      WHEN mode."writing_standards"->>'edit' LIKE '%' || guidance.marker || '%'
        THEN mode."writing_standards"->>'edit'
      ELSE concat_ws(E'\n\n', NULLIF(mode."writing_standards"->>'edit', ''), guidance.edit_guidance)
    END
  ),
  true
),
"updated_at" = CURRENT_TIMESTAMP
FROM guidance
WHERE mode."type_key" = 'MODE'
  AND (
    mode."writing_standards"->>'create' NOT LIKE '%' || guidance.marker || '%'
    OR mode."writing_standards"->>'edit' NOT LIKE '%' || guidance.marker || '%'
  );

WITH guidance AS (
  SELECT
    $mode_authoring_marker$## MODE authoring contract$mode_authoring_marker$::text AS marker,
    $mode_create_guidance$
## MODE authoring contract

Create MODE as a project-owned coding-agent behavior bundle, not a skill or an executable extension. Use the `description` section as the catalog description: state when a user should choose the mode and what working discipline it provides. Use the schema-backed `files` section for a `project-mode-files.v1` bundle with one non-empty `MODE.md` entry document and optional supporting text files.

Keep `MODE.md` compact and suitable for startup instructions. Put deeper material in supporting files for on-demand reads, and reference each supporting file by a safe relative POSIX path. Do not add absolute paths, traversal paths, executable hooks, tool grants, or provider configuration.

Declare applicability in `agentGuidance.contexts[].focalTypeKeys` using only stable effective work-item type keys that are active in this project. Do not use display names, proposal IDs, archived keys, or unknown keys.
$mode_create_guidance$::text AS create_guidance,
    $mode_edit_guidance$
## MODE authoring contract

Preserve MODE as a project-owned coding-agent behavior bundle, not a skill or an executable extension. Keep the `description` section as the catalog description of when to choose the mode and the working discipline it provides. Keep the schema-backed `files` section as a `project-mode-files.v1` bundle with one non-empty `MODE.md` entry document and optional supporting text files.

Keep `MODE.md` compact and suitable for startup instructions. Keep deeper material in supporting files for on-demand reads, and keep every supporting-file reference a safe relative POSIX path. Do not introduce absolute paths, traversal paths, executable hooks, tool grants, or provider configuration.

When changing applicability, keep `agentGuidance.contexts[].focalTypeKeys` limited to stable effective work-item type keys that are active in this project. Do not use display names, proposal IDs, archived keys, or unknown keys.
$mode_edit_guidance$::text AS edit_guidance
)
UPDATE "work_item_type" AS mode
SET "writing_standards" = jsonb_set(
  jsonb_set(
    COALESCE(mode."writing_standards", '{}'::jsonb),
    '{create}',
    to_jsonb(
      CASE
        WHEN mode."writing_standards"->>'create' LIKE '%' || guidance.marker || '%'
          THEN mode."writing_standards"->>'create'
        ELSE concat_ws(E'\n\n', NULLIF(mode."writing_standards"->>'create', ''), guidance.create_guidance)
      END
    ),
    true
  ),
  '{edit}',
  to_jsonb(
    CASE
      WHEN mode."writing_standards"->>'edit' LIKE '%' || guidance.marker || '%'
        THEN mode."writing_standards"->>'edit'
      ELSE concat_ws(E'\n\n', NULLIF(mode."writing_standards"->>'edit', ''), guidance.edit_guidance)
    END
  ),
  true
),
"updated_at" = CURRENT_TIMESTAMP
FROM guidance
WHERE mode."type_key" = 'MODE'
  AND mode."project_id" IS NOT NULL
  AND mode."lifecycle_status" = 'active'
  AND (
    mode."writing_standards"->>'create' NOT LIKE '%' || guidance.marker || '%'
    OR mode."writing_standards"->>'edit' NOT LIKE '%' || guidance.marker || '%'
  );
