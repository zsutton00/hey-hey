ALTER TABLE work_item_type
  ADD COLUMN maintenance_guidance text;

ALTER TABLE work_item_type_template
  ADD COLUMN maintenance_guidance text;
