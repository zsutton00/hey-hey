-- Add PLAN_STAGE_REFINING to AgentSessionType enum for plan-stage refinement sessions.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'PLAN_STAGE_REFINING';
