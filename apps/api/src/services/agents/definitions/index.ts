/**
 * Agent Definitions Index
 *
 * Exports all agent definitions for registration with agent platforms like Mastra.ai
 */

import {
  initiativeAnalyzerAgent,
  type AgentDefinition,
} from './initiative-analyzer.agent';
import { planGenerationAgent } from './plan-generation.agent';

export { type AgentDefinition };

// Re-export for convenience
export const ALL_AGENTS = [
  initiativeAnalyzerAgent,
  planGenerationAgent,
] as const;

export type AgentId = (typeof ALL_AGENTS)[number]['id'];
