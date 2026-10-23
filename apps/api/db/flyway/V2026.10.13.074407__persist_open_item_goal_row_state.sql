ALTER TABLE open_items
  ADD COLUMN goal_tracked_work_filter text NOT NULL DEFAULT 'ACTIVE_AND_BACKLOG',
  ADD COLUMN goal_collapsed boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT open_items_goal_tracked_work_filter_check
    CHECK (goal_tracked_work_filter IN ('ACTIVE_AND_BACKLOG', 'ACTIVE', 'ALL', 'NONE'));
