import { Injectable } from '@nestjs/common';
import { FlowContext } from '../../../types/flow-internal.types';
import { technicalAnalysisSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { AnalyzeNodeBase } from '../base/';

/**
 * Shared Analyze Project Node - LLM-based project analysis
 *
 * Performs comprehensive analysis of project to identify challenges,
 * opportunities, and provide actionable architectural recommendations.
 */
@Injectable()
export class SharedAnalyzeProjectNode extends AnalyzeNodeBase<FlowContext> {
  readonly id = SHARED_NODES.ANALYZE_PROJECT;
  readonly title = 'Project Analysis';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a senior architect analyzing a project for potential challenges and opportunities.

        Perform a comprehensive analysis:
        1. Identify technical challenges and blockers
        2. Spot missing considerations or blind spots
        3. Find connections to existing initiatives
        4. Assess resource and timeline implications
        5. Recommend specific architectural patterns

        Be constructive but honest about challenges.
        Prioritize actionable insights over generic advice.

        Focus on:
        - Technologies that were mentioned and their implications
        - Integration complexity based on their requirements
        - Potential challenges specific to their context
        - Concrete recommendations for their situation

        For conversationSummary, provide a brief description of what analysis was performed (e.g., "Analyzed technical requirements and identified integration challenges for the AI-powered search platform").`,

    responseSchema: technicalAnalysisSchema,
    temperature: 0.6,
  };
}
