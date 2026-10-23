ALTER TABLE work_item_type_template
  DROP CONSTRAINT work_item_type_template_icon_key_check,
  ADD CONSTRAINT work_item_type_template_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN ('task', 'bug', 'feature', 'goal', 'contract', 'design', 'decision', 'workflow', 'plan', 'plan-stage', 'star', 'flag', 'folder', 'book', 'lightbulb', 'science', 'code', 'database', 'link', 'people', 'chat', 'calendar', 'timer', 'chart', 'shield'));

ALTER TABLE work_item_type
  DROP CONSTRAINT work_item_type_icon_key_check,
  ADD CONSTRAINT work_item_type_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN ('task', 'bug', 'feature', 'goal', 'contract', 'design', 'decision', 'workflow', 'plan', 'plan-stage', 'star', 'flag', 'folder', 'book', 'lightbulb', 'science', 'code', 'database', 'link', 'people', 'chat', 'calendar', 'timer', 'chart', 'shield')),
  ADD COLUMN color_key TEXT,
  ADD CONSTRAINT work_item_type_color_key_check
    CHECK (color_key IS NULL OR color_key IN ('primary', 'secondary', 'success', 'warning', 'error', 'info'));
