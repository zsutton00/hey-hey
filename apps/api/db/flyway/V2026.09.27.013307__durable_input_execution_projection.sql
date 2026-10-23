CREATE TYPE message_input_execution_status AS ENUM ('queued', 'started', 'cancelled', 'failed');
ALTER TABLE messages
  ADD COLUMN execution_status message_input_execution_status,
  ADD COLUMN execution_operation_id uuid,
  ADD COLUMN execution_admission_id uuid,
  ADD COLUMN execution_turn_id uuid,
  ADD COLUMN execution_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN execution_cancellation_requested boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT messages_execution_operation_id_key UNIQUE (execution_operation_id),
  ADD CONSTRAINT messages_execution_operation_fk FOREIGN KEY (execution_operation_id) REFERENCES agent_operations(operation_id),
  ADD CONSTRAINT messages_execution_revision_nonnegative CHECK (execution_revision >= 0);
CREATE INDEX messages_queued_inputs_idx ON messages (conversation_id, created_at, id) WHERE execution_status = 'queued';
CREATE INDEX messages_input_cancellation_idx ON messages (execution_operation_id) WHERE execution_cancellation_requested;
