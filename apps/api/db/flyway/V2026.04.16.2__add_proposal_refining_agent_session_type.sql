-- Add PROPOSAL_REFINING to AgentSessionType enum for the proposal-refiner agent.
ALTER TYPE "AgentSessionType" ADD VALUE IF NOT EXISTS 'PROPOSAL_REFINING';
