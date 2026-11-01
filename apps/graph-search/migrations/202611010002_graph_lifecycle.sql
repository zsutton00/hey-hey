-- The graph surface owns an independent deletion identity from search.
CREATE TABLE graph.projection_deletion (
 organization_id text PRIMARY KEY,
 identity jsonb NOT NULL
);

-- Every graph writer, including future event consumers, crosses the same barrier.
-- A shared advisory lock serializes writes against deletion and prevents resurrection.
CREATE FUNCTION graph.fence_closed_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id, 1));
 IF EXISTS (SELECT 1 FROM graph.projection_deletion WHERE organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION 'Organization projection is closed' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER node_closure_fence BEFORE INSERT OR UPDATE ON graph.node
 FOR EACH ROW EXECUTE FUNCTION graph.fence_closed_organization();
CREATE TRIGGER edge_closure_fence BEFORE INSERT OR UPDATE ON graph.edge
 FOR EACH ROW EXECUTE FUNCTION graph.fence_closed_organization();
