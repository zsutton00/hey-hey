-- Extend the canonical workflow authoring guidance delivered through
-- get_tool_guidance without changing project-owned overrides.

DO $migration$
DECLARE
  abstraction_guidance text := $workflow_guidance$

## Purpose, boundary, and abstraction level

Before authoring steps, state whether this workflow models system design, a
user journey, or an implementation lifecycle, and state the process boundary
and intended outcome. Keep every step at one coherent abstraction level. Move
mixed-altitude detail into a cited child workflow or supporting entity, while
retaining the black-box handoff in this workflow.

Use the workflow's authoring context as a strong altitude default, not a rigid
tree-depth formula:
- At a top-level product feature, emphasize actors, consuming and providing
  systems, durable promises, major handoffs, outcomes, and failures.
- At a cross-feature or subsystem feature, emphasize service responsibilities,
  admissions, handoffs, and enforcement boundaries.
- At a leaf technical feature, emphasize component operations and meaningful
  state transitions.
- At an implementation task, include calls, retries, persistence, sequencing,
  and recovery mechanics when they are material.

Cross-feature workflows belong at the nearest meaningful shared product
boundary. A workflow may omit lower-level mechanics at its chosen altitude,
but it must not omit a materially different participant, provider boundary,
admission, handoff, independent enforcement point, failure outcome, or
applicable Contract when that omission could make the design appear valid when
it is not. A service reference does not replace a participant step: show a
distinct consumer when its inputs or constraints materially differ.

Set a workflow_step serviceId when a known codebase materially initiates,
provides, validates, enforces, or persists that step. Do not invent or require
decorative service ownership for user actions, business states, external
actors, or steps with no meaningful code owner. At higher altitude, expose
applicable Contract boundaries, but create workflow_step DEPENDS_ON Contract
only for steps that author or enforce the durable promise, including rejection
steps. Keep consumer participation and FULFILLED_BY implementation evidence
separate from that Contract dependency.
$workflow_guidance$;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'workflow'
      AND "writing_standards"->>'create' IS NOT NULL
      AND "writing_standards"->>'edit' IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot teach coherent workflow abstraction; canonical workflow template or writing standards are missing';
  END IF;

  UPDATE "work_item_type_template"
  SET
    "writing_standards" = jsonb_build_object(
      'create',
      CASE
        WHEN position('## Purpose, boundary, and abstraction level' IN "writing_standards"->>'create') = 0
          THEN "writing_standards"->>'create' || abstraction_guidance
        ELSE "writing_standards"->>'create'
      END,
      'edit',
      CASE
        WHEN position('## Purpose, boundary, and abstraction level' IN "writing_standards"->>'edit') = 0
          THEN "writing_standards"->>'edit' || abstraction_guidance
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
        position('## Purpose, boundary, and abstraction level' IN "writing_standards"->>'create') = 0
        OR position('## Purpose, boundary, and abstraction level' IN "writing_standards"->>'edit') = 0
      )
  ) THEN
    RAISE EXCEPTION 'Coherent workflow abstraction guidance materialization was incomplete';
  END IF;
END
$migration$;
