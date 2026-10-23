import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FlowContext } from '../../../types/flow-internal.types';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { influenceSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { AnalyzeNodeBase } from '../base/';

// Zod schema for validating LLM response
const artifactInsightSchema = z.object({
  category: z.string(),
  title: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  content: z.string(),
  tags: z.array(z.string()).nullable().optional(),
  influences: z.array(influenceSchema).nullable().optional(),
});

export const artifactsGenerationSchema = z.object({
  type: z.literal('ARTIFACTS_GENERATION'),
  response: z.string(),
  title: z.string().nullable().optional(),
  detectedIntent: z.string(),
  intentConfidence: z.number(),
  reasoning: z.string().nullable().optional(),
  insights: z.array(artifactInsightSchema),
  actions: z.array(z.any()).nullable().optional(),
});

/**
 * Shared Generate Artifacts Node - LLM-based insight extraction
 *
 * Analyzes onboarding conversation to extract structured insights about
 * user goals, technical context, integrations, and business context.
 * Artifacts are created by LlmProcessor.processInsightsFromLLMResponse.
 */
@Injectable()
export class SharedGenerateArtifactsNode extends AnalyzeNodeBase<FlowContext> {
  readonly id = SHARED_NODES.GENERATE_ARTIFACTS;
  readonly title = 'Generate Context Artifacts';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a principal product manager analyzing a project onboarding conversation to extract structured insights.

    ${P.CONVERSATION_HISTORY.insert()}

Analyze the entire conversation and extract insights in these categories:
1. User Goals & Objectives - What the user wants to achieve
2. Technical Analysis - Technologies, challenges, requirements mentioned
3. Integration Context - Tools, services, integration requirements
4. Business Context - Value propositions, stakeholders, success metrics

Only create insights for categories where you find meaningful information.

For each insight:
- Use clear, descriptive titles
- Provide confidence scores based on how explicit the information was
- Include your reasoning for extracting this insight
- Write content as clear, structured text (not JSON)

Integration Context:
${P.INTEGRATIONS.insert()}

Extract actionable insights that will help generate relevant project initiatives.

ARTIFACT REFERENCING: When generating insights, you SHOULD include an "influences" array for each insight that references specific Q&A exchanges and other entities from the conversation history that influenced each insight. For each influence, use the entityId and entityType from the evidence item you are referencing — both values come from the same source entity. Each influence must include:
- entityId: The UUID of the entity that influenced your choice
- entityType: The type of that same entity (as provided in the evidence)
- reasoning: How this entity influenced the insight
- reasonType: Type of influence relationship

The conversation_history provided includes entity IDs (artifact IDs, message IDs, etc.) that you can reference. Use these to create traceable connections between user responses and the insights you generate. For Q&A artifacts, use the entity's entityId.

ANALYZE NODE INSTRUCTIONS:
- You MUST use type: "ARTIFACTS_GENERATION" in your response
- Provide thorough but concise analysis of the conversation
- Focus on actionable insights that will help generate project initiatives
- Identify both opportunities and challenges mentioned in the conversation
- Base recommendations on the specific context provided
- Include artifact referencing with "influences" arrays for traceability
- Be honest about potential issues while remaining constructive
- Set detectedIntent based on analysis outcome and next logical step`,

    responseSchema: artifactsGenerationSchema,
    temperature: 0.6,
  };
}

// Note: Artifact creation will now be handled by LlmProcessor.processInsightsFromLLMResponse
// when it receives the ARTIFACTS_GENERATION response from the LLM
