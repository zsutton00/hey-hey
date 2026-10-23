-- Add AGENT_SEARCH to AgentSessionType enum for the AdvancedSearch agent-search chat.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'AGENT_SEARCH';
