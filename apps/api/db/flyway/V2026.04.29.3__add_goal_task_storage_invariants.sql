-- Enforce GOAL task storage invariants:
--   * GOAL tasks must have a due_date set
--   * GOAL tasks must be top-level (no parent_task_id)
-- Lives in a separate migration from the GOAL enum addition because Postgres
-- prohibits using a freshly-added enum value in the same transaction that
-- introduced it.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_goal_invariants
  CHECK (
    type <> 'GOAL'
    OR (due_date IS NOT NULL AND parent_task_id IS NULL)
  );
