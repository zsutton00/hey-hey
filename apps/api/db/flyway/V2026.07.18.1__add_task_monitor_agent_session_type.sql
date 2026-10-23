-- Add TASK_MONITOR to AgentSessionType for shared-runtime coordinator sessions.
ALTER TYPE "AgentSessionType"
  ADD VALUE IF NOT EXISTS 'TASK_MONITOR' AFTER 'SESSION_MONITOR';
