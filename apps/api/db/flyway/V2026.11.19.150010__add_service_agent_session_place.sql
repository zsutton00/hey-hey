-- Record where each Service works for an Agent Session on the existing
-- per-Service membership row. All columns are NULL until a place is reported,
-- which is how older sessions and older CLIs read as "not recorded".
ALTER TABLE service_agent_sessions
  ADD COLUMN place_kind TEXT,
  ADD COLUMN place_branch TEXT,
  ADD COLUMN place_worktree_path TEXT,
  ADD COLUMN place_recorded_at TIMESTAMP(3);

-- Unrecorded: every place column NULL. MAIN_FOLDER: branch may be NULL
-- (detached), no worktree path. WORKTREE: branch and path both required.
ALTER TABLE service_agent_sessions
  ADD CONSTRAINT service_agent_sessions_place_consistent CHECK (
    (
      place_kind IS NULL
      AND place_branch IS NULL
      AND place_worktree_path IS NULL
      AND place_recorded_at IS NULL
    )
    OR (
      place_kind = 'MAIN_FOLDER'
      AND place_worktree_path IS NULL
      AND place_recorded_at IS NOT NULL
    )
    OR (
      place_kind = 'WORKTREE'
      AND place_branch IS NOT NULL
      AND place_worktree_path IS NOT NULL
      AND place_recorded_at IS NOT NULL
    )
  );
