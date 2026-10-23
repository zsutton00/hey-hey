-- Rename FlowExecutionStatus enum to snake_case for naming consistency,
-- then add PAUSED value for workflow pause/resume support.
-- When a conversation workflow times out waiting for user input, it is marked PAUSED
-- rather than COMPLETED/FAILED, enabling seamless resumption when the user returns.

ALTER TYPE "FlowExecutionStatus" RENAME TO "flow_execution_status";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'flow_execution_status'
      AND e.enumlabel = 'PAUSED'
  ) THEN
    ALTER TYPE "flow_execution_status" ADD VALUE 'PAUSED';
  END IF;
END $$;
