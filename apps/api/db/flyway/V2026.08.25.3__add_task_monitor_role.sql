ALTER TABLE work_item_type_template
  DROP CONSTRAINT work_item_type_template_role_check;

ALTER TABLE work_item_type
  DROP CONSTRAINT work_item_type_role_check;

UPDATE work_item_type_template
SET role = 'monitor'
WHERE type_key = 'TASK_MONITOR';

UPDATE work_item_type
SET role = 'monitor'
WHERE type_key = 'TASK_MONITOR';

ALTER TABLE work_item_type_template
  ADD CONSTRAINT work_item_type_template_role_check
  CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger', 'monitor'));

ALTER TABLE work_item_type
  ADD CONSTRAINT work_item_type_role_check
  CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger', 'monitor'));
