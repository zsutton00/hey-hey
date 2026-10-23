-- Add a non-blocking complexity diagnostic to the canonical workflow
-- authoring guidance without changing project-owned overrides.

DO $migration$
DECLARE
  budget_guidance text := $workflow_budget_guidance$

## Soft workflow step budget

After a rough workflow structure is known and before final authoring, count
only its workflow_step children. Do not count displayed Contract nodes, flow
edges, fulfillment links, or other derived graph context.

Use a soft maximum of 8 workflow_step children when the workflow is owned
directly by the project or by a top-level feature. Use a soft maximum of 12
when the workflow is below that root altitude. Eight and twelve steps are
within their respective budgets; the diagnostic begins at nine and thirteen.

When the count exceeds the applicable budget, make one silent simplification
pass: reconsider the workflow's altitude and boundary and whether lower-level
detail belongs in a cited child workflow while retaining the black-box
handoff. This is a diagnostic, not schema validation or proposal admission.
Do not block proposal creation or automatically ask the user merely because
the budget is exceeded. After that single reconsideration, continue with a
larger coherent workflow when its materially distinct participants, provider
boundaries, admissions, handoffs, failures, enforcement points, or applicable
Contracts must remain visible.
$workflow_budget_guidance$;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'workflow'
      AND "writing_standards"->>'create' IS NOT NULL
      AND "writing_standards"->>'edit' IS NOT NULL
      AND position(
        '## Purpose, boundary, and abstraction level'
        IN "writing_standards"->>'create'
      ) > 0
      AND position(
        '## Purpose, boundary, and abstraction level'
        IN "writing_standards"->>'edit'
      ) > 0
  ) THEN
    RAISE EXCEPTION
      'Cannot add soft workflow step budgets; canonical workflow abstraction guidance is missing';
  END IF;

  UPDATE "work_item_type_template"
  SET
    "writing_standards" = jsonb_build_object(
      'create',
      CASE
        WHEN position('## Soft workflow step budget' IN "writing_standards"->>'create') = 0
          THEN "writing_standards"->>'create' || budget_guidance
        ELSE "writing_standards"->>'create'
      END,
      'edit',
      CASE
        WHEN position('## Soft workflow step budget' IN "writing_standards"->>'edit') = 0
          THEN "writing_standards"->>'edit' || budget_guidance
        ELSE "writing_standards"->>'edit'
      END
    ),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "type_key" = 'workflow';

  IF EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'workflow'
      AND (
        position('## Soft workflow step budget' IN "writing_standards"->>'create') = 0
        OR position('## Soft workflow step budget' IN "writing_standards"->>'edit') = 0
      )
  ) THEN
    RAISE EXCEPTION 'Soft workflow step budget guidance materialization was incomplete';
  END IF;
END
$migration$;
