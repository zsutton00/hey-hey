-- Add DAILY_SESSION value to AgentSessionType enum
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'DAILY_SESSION';
