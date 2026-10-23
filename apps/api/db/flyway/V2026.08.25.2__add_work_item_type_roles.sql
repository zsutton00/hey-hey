ALTER TABLE work_item_type_template ADD COLUMN role TEXT;
ALTER TABLE work_item_type ADD COLUMN role TEXT;

UPDATE work_item_type_template
SET role = CASE
  WHEN type_key IN ('STANDARD', 'BUG') THEN 'work-item'
  ELSE 'project-info'
END;

UPDATE work_item_type
SET role = CASE
  WHEN type_key IN ('FEATURE', 'GOAL', 'CONTRACT', 'workflow', 'workflow_step', 'TASK_MONITOR')
    THEN 'project-info'
  ELSE 'work-item'
END;

ALTER TABLE work_item_type_template ALTER COLUMN role SET NOT NULL;
ALTER TABLE work_item_type ALTER COLUMN role SET NOT NULL;

ALTER TABLE work_item_type_template
  ADD CONSTRAINT work_item_type_template_role_check
  CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger'));

ALTER TABLE work_item_type
  ADD CONSTRAINT work_item_type_role_check
  CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger'));
