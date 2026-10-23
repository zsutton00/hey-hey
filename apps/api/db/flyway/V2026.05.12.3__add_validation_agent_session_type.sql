-- Add VALIDATION to AgentSessionType enum for validation-walkthrough sessions.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'VALIDATION';
