ALTER TABLE task_dependencies
  ADD COLUMN graph_edge_id UUID;

CREATE UNIQUE INDEX task_dependencies_graph_edge_id_key
  ON task_dependencies (graph_edge_id)
  WHERE graph_edge_id IS NOT NULL;
