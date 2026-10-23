-- The owning CLI's recorded admission decision for an executable input, copied
-- once from its correlated acceptance. Null while that acceptance is pending.
CREATE TYPE message_execution_admission_disposition AS ENUM ('IMMEDIATE', 'QUEUED');
ALTER TABLE messages
  ADD COLUMN execution_admission_disposition message_execution_admission_disposition;

-- Every input accepted before the CLI reported a disposition was admitted to
-- wait, matching how the CLI reads its own pre-disposition records.
UPDATE messages m
SET execution_admission_disposition = 'QUEUED'
WHERE m.execution_status IS NOT NULL
  AND (
    m.execution_admission_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM agent_operation_dispatches d
      WHERE d.operation_id = m.execution_operation_id
        AND d.state = 'ACKNOWLEDGED'
    )
  );
