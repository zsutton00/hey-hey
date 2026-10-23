DROP INDEX agent_operations_grant_id_key;

ALTER TABLE agent_operation_dispatches
  DROP CONSTRAINT agent_operation_dispatches_grant_id_key;

CREATE INDEX agent_operations_grant_id_idx
  ON agent_operations (grant_id)
  WHERE grant_id IS NOT NULL;

CREATE INDEX agent_operation_dispatches_grant_id_idx
  ON agent_operation_dispatches (grant_id);
