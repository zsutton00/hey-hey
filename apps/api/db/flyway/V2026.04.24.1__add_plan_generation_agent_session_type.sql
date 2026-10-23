-- Add PLAN_GENERATION to AgentSessionType enum for the plan-generation flow.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'PLAN_GENERATION';
