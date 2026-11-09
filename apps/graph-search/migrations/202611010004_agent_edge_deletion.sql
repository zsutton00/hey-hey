-- Retain the reviewed version independently of the edge and its endpoint nodes.
CREATE TABLE graph.agent_edge_deletion (
    organization_id text NOT NULL,
    project_id text NOT NULL,
    id text NOT NULL,
    deleted_basis timestamptz NOT NULL,
    PRIMARY KEY (organization_id, project_id, id)
);
CREATE TRIGGER agent_edge_deletion_closure_fence
    BEFORE INSERT OR UPDATE ON graph.agent_edge_deletion
    FOR EACH ROW EXECUTE FUNCTION graph.fence_closed_organization();
