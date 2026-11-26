-- Keep where a Service worked at launch once an approved worktree attach moves
-- its active place. All columns stay NULL until the place changes after launch.
ALTER TABLE service_agent_sessions
  ADD COLUMN launch_place_kind TEXT,
  ADD COLUMN launch_place_branch TEXT,
  ADD COLUMN launch_place_worktree_path TEXT,
  ADD COLUMN place_changed_at TIMESTAMP(3);

-- Permitted states, each written with explicit IS NULL / IS NOT NULL on every
-- column so no combination can evaluate to UNKNOWN and slip past the CHECK:
--   1. Unchanged since launch: all four columns NULL.
--   2. Changed, launch place unknown (the first attach landed before any launch
--      report): only place_changed_at is set.
--   3. Changed from a launch MAIN_FOLDER: kind and change time set, no path.
--   4. Changed from a launch WORKTREE: kind, branch, path and change time set.
ALTER TABLE service_agent_sessions
  ADD CONSTRAINT service_agent_sessions_launch_place_consistent CHECK (
    (
      launch_place_kind IS NULL
      AND launch_place_branch IS NULL
      AND launch_place_worktree_path IS NULL
      AND place_changed_at IS NULL
    )
    OR (
      launch_place_kind IS NULL
      AND launch_place_branch IS NULL
      AND launch_place_worktree_path IS NULL
      AND place_changed_at IS NOT NULL
    )
    OR (
      launch_place_kind IS NOT NULL
      AND launch_place_kind = 'MAIN_FOLDER'
      AND launch_place_worktree_path IS NULL
      AND place_changed_at IS NOT NULL
    )
    OR (
      launch_place_kind IS NOT NULL
      AND launch_place_kind = 'WORKTREE'
      AND launch_place_branch IS NOT NULL
      AND launch_place_worktree_path IS NOT NULL
      AND place_changed_at IS NOT NULL
    )
  );
