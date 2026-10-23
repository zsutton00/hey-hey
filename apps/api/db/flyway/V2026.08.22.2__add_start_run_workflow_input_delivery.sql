CREATE TYPE agent_operation_workflow_input_kind AS ENUM (
  'WORKFLOW_ANSWER',
  'START_RUN_KICKOFF'
);

ALTER TABLE agent_operation_workflow_input_deliveries
  ADD COLUMN kind agent_operation_workflow_input_kind,
  ALTER COLUMN node_id DROP NOT NULL,
  ALTER COLUMN action DROP NOT NULL,
  ALTER COLUMN answer DROP NOT NULL;

UPDATE agent_operation_workflow_input_deliveries
SET kind = 'WORKFLOW_ANSWER'
WHERE kind IS NULL;

ALTER TABLE agent_operation_workflow_input_deliveries
  ALTER COLUMN kind SET NOT NULL,
  ADD CONSTRAINT agent_operation_workflow_input_payload_shape CHECK (
    (
      kind = 'WORKFLOW_ANSWER'
      AND node_id IS NOT NULL
      AND action IS NOT NULL
      AND answer IS NOT NULL
    )
    OR
    (
      kind = 'START_RUN_KICKOFF'
      AND node_id IS NULL
      AND action IS NULL
      AND answer IS NULL
    )
  );
