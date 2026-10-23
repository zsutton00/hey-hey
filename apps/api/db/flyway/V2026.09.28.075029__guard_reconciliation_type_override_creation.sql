-- A missing project override still has an owned boundary: serialize the first
-- override with reviewed canonical-template application on the project row.
CREATE TRIGGER work_item_type_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON work_item_type FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('projects', 'project_id', 'section');
