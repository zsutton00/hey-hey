-- All section writers share the owning entity lock used by proposal application.
-- This includes CRDT appenders and direct writers, not only proposal code paths.
ALTER TABLE proposal_reconciliation_revisions ALTER COLUMN intent DROP NOT NULL;
CREATE FUNCTION lock_reconciliation_section_owner() RETURNS trigger AS $$
DECLARE
  owner_id text;
  section_id text;
  old_owner_id text;
  new_owner_id text;
BEGIN
  IF TG_ARGV[2] = 'section' THEN
    IF TG_OP <> 'INSERT' THEN old_owner_id := to_jsonb(OLD)->>TG_ARGV[1]; END IF;
    IF TG_OP <> 'DELETE' THEN new_owner_id := to_jsonb(NEW)->>TG_ARGV[1]; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      section_id := to_jsonb(OLD)->>'section_id';
      EXECUTE format('SELECT %I FROM %I WHERE id = $1', TG_ARGV[1], TG_ARGV[3])
        INTO old_owner_id USING section_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      section_id := to_jsonb(NEW)->>'section_id';
      EXECUTE format('SELECT %I FROM %I WHERE id = $1', TG_ARGV[1], TG_ARGV[3])
        INTO new_owner_id USING section_id;
    END IF;
  END IF;
  FOR owner_id IN SELECT DISTINCT value FROM unnest(ARRAY[old_owner_id, new_owner_id]) value
    WHERE value IS NOT NULL ORDER BY value
  LOOP
    EXECUTE format('SELECT id FROM %I WHERE id = $1 FOR UPDATE', TG_ARGV[0]) USING owner_id;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_section_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON task_sections FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('tasks', 'task_id', 'section');
CREATE TRIGGER task_section_update_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON task_section_updates FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('tasks', 'task_id', 'update', 'task_sections');
CREATE TRIGGER design_doc_section_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON design_doc_sections FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('design_docs', 'design_doc_id', 'section');
CREATE TRIGGER design_doc_section_update_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON design_doc_section_updates FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('design_docs', 'design_doc_id', 'update', 'design_doc_sections');
CREATE TRIGGER service_task_reconciliation_lock BEFORE INSERT OR UPDATE OR DELETE
ON service_tasks FOR EACH ROW EXECUTE FUNCTION lock_reconciliation_section_owner('tasks', 'task_id', 'section');
