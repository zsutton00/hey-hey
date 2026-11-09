CREATE TABLE graph.template_copy_receipt (
 organization_id text NOT NULL,
 project_id text NOT NULL,
 id text NOT NULL,
 command jsonb NOT NULL,
 PRIMARY KEY (organization_id, project_id, id)
);
CREATE TRIGGER template_closure_fence BEFORE INSERT OR UPDATE ON graph.template_copy_receipt
 FOR EACH ROW EXECUTE FUNCTION graph.fence_closed_organization();
