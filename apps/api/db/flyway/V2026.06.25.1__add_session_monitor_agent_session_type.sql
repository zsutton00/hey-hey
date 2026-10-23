-- Add SESSION_MONITOR to AgentSessionType enum for session-monitor agent sessions.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'SESSION_MONITOR';
