-- Canonical Goals may be undated; complete project overrides remain project-owned.
ALTER TABLE tasks DROP CONSTRAINT tasks_goal_invariants;
ALTER TABLE tasks ADD CONSTRAINT tasks_goal_invariants
  CHECK (type <> 'GOAL' OR parent_task_id IS NULL);

UPDATE work_item_type_template
SET required_scalars = required_scalars - 'dueDate',
    writing_standards = writing_standards || jsonb_build_object(
      'create', '## Goals

A Goal states an outcome. Goals are always top-level and cannot have child tasks; reference work through TRACKS instead. The only section key is description. Keep implementation in tracked features and tasks.

## Target date

The canonical Goal target date is optional. Omit dueDate to create an undated Goal; never invent a deadline. Project-effective required scalar rules still apply.

## Voice

Use a short declarative outcome statement: what ships, for whom, and why.',
      'edit', '## Editing Goals

Goals stay top-level, with type locked to GOAL and sections limited to description. Updates may revise name, status, priority, assigneeId, description and dueDate. Omit dueDate to preserve the existing value; supply a date to set or change it; explicit null clears it unless project-effective rules require a date. Undated Goals have no date-based closing prompt. Keep implementation detail on tracked work.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'GOAL';
