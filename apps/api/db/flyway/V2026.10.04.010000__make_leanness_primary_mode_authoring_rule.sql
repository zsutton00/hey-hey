-- Leanness leads MODE authoring guidance. The rule is prepended rather than
-- replacing existing text so project-owned MODE overrides keep their own
-- guidance, and rows that already carry it are left untouched.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot publish MODE leanness guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    'Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item''s feature ancestry and graph context, Project Assistant research, implementation hints, and each Service''s AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. The core of most MODEs is what an agent would otherwise miss: gotchas that cost time, cross-Service traps, the in-between steps that no single feature or file reveals, and symptom-to-cause diagnosis. When the session''s purpose differs from a default coding session, also state its intent: what it is for, what it produces, the format and quality bar of that output, the workflow that gets there, and when the work is done. Anchor the MODE to the features, design docs, and Contracts it covers by mention, without summarizing them, so the graph carries their current state and changes to them lead back to the MODE. Do not map files or symbols the agent can find itself; name a file or symbol only when a gotcha cannot be stated without it, because such references go stale when code changes outside this mode. Exclude restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, and copies of open bug details.'::text AS create_standard,
    'Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item''s feature ancestry and graph context, Project Assistant research, implementation hints, and each Service''s AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. A MODE holds what an agent would otherwise miss (gotchas, cross-Service traps, in-between steps that no single feature or file reveals, symptom-to-cause diagnosis), the session''s intent where it differs from a default coding session (purpose, deliverable, output format and quality bar, workflow, done condition), and mentions of the features, design docs, and Contracts it covers; it does not hold summaries of those entities, restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, copies of open bug details, or maps of files and symbols the agent can find itself. Whenever you touch a MODE, check that the files and symbols it names still exist and still behave as described, remove content that duplicates those sources, and replace summaries with mentions, so an edit leaves the MODE smaller or no larger than the requested change requires.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    jsonb_set(
      jsonb_set(COALESCE(mode.writing_standards, '{}'::jsonb), '{create}',
        to_jsonb(CASE
          WHEN position(guidance.create_standard IN COALESCE(mode.writing_standards->>'create', '')) > 0
            THEN mode.writing_standards->>'create'
          ELSE concat_ws(E'\n\n', guidance.create_standard, NULLIF(mode.writing_standards->>'create', ''))
        END), true),
      '{edit}',
      to_jsonb(CASE
        WHEN position(guidance.edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) > 0
          THEN mode.writing_standards->>'edit'
        ELSE concat_ws(E'\n\n', guidance.edit_standard, NULLIF(mode.writing_standards->>'edit', ''))
      END), true
    ) AS standards
  FROM work_item_type_template AS mode CROSS JOIN guidance
  WHERE mode.type_key = 'MODE'
    AND (
      position(guidance.create_standard IN COALESCE(mode.writing_standards->>'create', '')) = 0
      OR position(guidance.edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) = 0
    )
)
UPDATE work_item_type_template AS mode
SET writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;

-- Active project MODE rows are the effective definitions agents read, so they
-- receive the same prepended rule.
WITH guidance AS (
  SELECT
    'Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item''s feature ancestry and graph context, Project Assistant research, implementation hints, and each Service''s AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. The core of most MODEs is what an agent would otherwise miss: gotchas that cost time, cross-Service traps, the in-between steps that no single feature or file reveals, and symptom-to-cause diagnosis. When the session''s purpose differs from a default coding session, also state its intent: what it is for, what it produces, the format and quality bar of that output, the workflow that gets there, and when the work is done. Anchor the MODE to the features, design docs, and Contracts it covers by mention, without summarizing them, so the graph carries their current state and changes to them lead back to the MODE. Do not map files or symbols the agent can find itself; name a file or symbol only when a gotcha cannot be stated without it, because such references go stale when code changes outside this mode. Exclude restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, and copies of open bug details.'::text AS create_standard,
    'Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item''s feature ancestry and graph context, Project Assistant research, implementation hints, and each Service''s AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. A MODE holds what an agent would otherwise miss (gotchas, cross-Service traps, in-between steps that no single feature or file reveals, symptom-to-cause diagnosis), the session''s intent where it differs from a default coding session (purpose, deliverable, output format and quality bar, workflow, done condition), and mentions of the features, design docs, and Contracts it covers; it does not hold summaries of those entities, restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, copies of open bug details, or maps of files and symbols the agent can find itself. Whenever you touch a MODE, check that the files and symbols it names still exist and still behave as described, remove content that duplicates those sources, and replace summaries with mentions, so an edit leaves the MODE smaller or no larger than the requested change requires.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    jsonb_set(
      jsonb_set(COALESCE(mode.writing_standards, '{}'::jsonb), '{create}',
        to_jsonb(CASE
          WHEN position(guidance.create_standard IN COALESCE(mode.writing_standards->>'create', '')) > 0
            THEN mode.writing_standards->>'create'
          ELSE concat_ws(E'\n\n', guidance.create_standard, NULLIF(mode.writing_standards->>'create', ''))
        END), true),
      '{edit}',
      to_jsonb(CASE
        WHEN position(guidance.edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) > 0
          THEN mode.writing_standards->>'edit'
        ELSE concat_ws(E'\n\n', guidance.edit_standard, NULLIF(mode.writing_standards->>'edit', ''))
      END), true
    ) AS standards
  FROM work_item_type AS mode CROSS JOIN guidance
  WHERE mode.type_key = 'MODE'
    AND mode.project_id IS NOT NULL
    AND mode.lifecycle_status = 'active'
    AND (
      position(guidance.create_standard IN COALESCE(mode.writing_standards->>'create', '')) = 0
      OR position(guidance.edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) = 0
    )
)
UPDATE work_item_type AS mode
SET writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;
