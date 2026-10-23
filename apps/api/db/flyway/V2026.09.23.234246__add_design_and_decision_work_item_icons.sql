ALTER TABLE work_item_type_template
  DROP CONSTRAINT work_item_type_template_icon_key_check,
  ADD CONSTRAINT work_item_type_template_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN (
      'task', 'bug', 'feature', 'goal', 'contract', 'design', 'decision',
      'workflow', 'plan', 'plan-stage'
    ));

ALTER TABLE work_item_type
  DROP CONSTRAINT work_item_type_icon_key_check,
  ADD CONSTRAINT work_item_type_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN (
      'task', 'bug', 'feature', 'goal', 'contract', 'design', 'decision',
      'workflow', 'plan', 'plan-stage'
    ));

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'mockup'
  ) THEN
    RAISE EXCEPTION 'Cannot assign the Design icon: canonical Mockup template is missing';
  END IF;
END
$migration$;

-- Canonical definitions live in the template table. Project-owned rows in
-- work_item_type remain untouched, including project-custom Mockup choices.
UPDATE work_item_type_template
SET icon_key = 'design',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'mockup'
  AND icon_key IS DISTINCT FROM 'design';
