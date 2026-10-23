import { Injectable, Logger } from '@nestjs/common';
import {
  AdrContentApplyPayload,
  ExtendedUIFieldType,
  NextStepPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import { MastraAgentResponse } from 'src/services/agents/mastra-client.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import {
  AdrRefinementFlowContext,
  CompensationContext,
  CompensationResult,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { z } from 'zod';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';
import { AgentNodeBase } from '../base';
import { uuidv4 } from 'lib0/random';
import {
  InitiativeSummarySchema,
  TaskSummarySchema,
  relatedEntitySchema,
} from '../../utils/shared-schemas';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { loadAdrLinkedEntities } from './linked-entities.util';

// Response schema for starting agent
const StartingAgentResponseSchema = z.object({
  response: z
    .string()
    .describe(
      'Bullet-ish commentary (~2-5 succinct lines) calling out key facts, blockers, or next steps',
    ),
  question: z
    .string()
    .optional()
    .nullable()
    .describe(
      'Only when specific missing data blocks progress; ask one concrete question',
    ),
  context: z
    .string()
    .optional()
    .nullable()
    .describe(
      '1-3 short paragraphs summarizing background, forces, constraints when information is sufficient',
    ),
  nextStep: z
    .string()
    .nullable()
    .describe('A short description of the next best step')
    .optional(),
  relatedEntities: z.array(relatedEntitySchema).optional(),
});

type StartingAgentResponse = z.infer<typeof StartingAgentResponseSchema>;

const AdrStartingContextRequestSchema = z.object({
  designDocTitle: z.string(),
  designDocSummary: z.string().optional(),
  initiative: InitiativeSummarySchema.optional(),
  task: TaskSummarySchema.optional(),
});

type AdrStartingContextRequest = z.infer<
  typeof AdrStartingContextRequestSchema
>;

/**
 * ADR Starting Agent Node - Gathers initial context for new ADRs
 *
 * This agent analyzes available information (summary, linked documents, etc.)
 * and provides a conversational response with optional context suggestions.
 * Unlike agent_analysis, this doesn't guarantee an edit - it focuses on
 * providing guidance and optional suggestions to help users get started.
 */
@Injectable()
export class AdrRefinementStartingAgentNode extends AgentNodeBase<
  AdrRefinementFlowContext,
  AdrStartingContextRequest
> {
  readonly id = ADR_REFINEMENT_NODES.STARTING_AGENT;
  readonly title = 'AI Context Gathering';
  readonly responseSchema = StartingAgentResponseSchema;

  private readonly logger = new Logger(AdrRefinementStartingAgentNode.name);

  constructor(
    private designDocService: DesignDocService,
    private initiativeService: InitiativeService,
    private taskService: TaskService,
  ) {
    super();
  }

  // Use specialized agent for starting context
  readonly agentId = 'adr-starting-context';

  readonly userPrompt = '';

  readonly agentInput = async (
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
    _latestUserMessage?: FlowUserMessage,
  ): Promise<AdrStartingContextRequest> => {
    const context = tracker.getContext();
    try {
      const designDoc = await this.designDocService.findOneForAdapter(
        context.designDocId,
        context.core.organizationId,
      );

      if (!designDoc) {
        this.logger.error('Design doc not found for starting agent input', {
          designDocId: context.designDocId,
          organizationId: context.core.organizationId,
        });
        throw new Error(
          `Design doc not found while building agent input ${context.designDocId}`,
        );
      }

      const { task } = await loadAdrLinkedEntities({
        designDocId: context.designDocId,
        organizationId: context.core.organizationId,
        designDocService: this.designDocService,
        taskService: this.taskService,
      });

      const payload = {
        designDocTitle: designDoc.name || 'Untitled ADR',
        designDocSummary: designDoc.summary ?? undefined,
        task,
      };

      const validation = AdrStartingContextRequestSchema.safeParse(payload);
      if (!validation.success) {
        this.logger.warn('Starting agent input validation failed', {
          designDocId: context.designDocId,
          issues: validation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        throw new Error(`There was an error validating the agent input`);
      }

      return validation.data;
    } catch (error) {
      this.logger.error('Failed to build starting agent input', {
        designDocId: context.designDocId,
        organizationId: context.core.organizationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`There was an error validating the agent input`);
    }
  };

  async buildContext(
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    // Get design doc summary and links
    const designDoc = await this.designDocService.findOneForAdapter(
      context.designDocId,
      context.core.organizationId,
    );
    const links = await this.designDocService.getLinks(
      context.designDocId,
      context.core.organizationId,
    );

    return {
      designDocId: context.designDocId,
      summary: designDoc?.summary || '',
      links,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<StartingAgentResponse>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      if (!agentResponse.result) {
        this.logger.error('Starting agent response missing result field:', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Starting agent response missing result field',
          systemMessageData: {
            response:
              "I had trouble analyzing the available context. Let's gather the information manually instead.",
          },
        };
      }

      // Validate and parse the structured data
      const parseResult = StartingAgentResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('Starting agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Starting agent response validation failed',
          systemMessageData: {
            response:
              "I encountered an issue processing the analysis. Let's start with what you know about this ADR.",
          },
        };
      }

      const agentData = parseResult.data;

      // Build UI element with secondary action
      const uiElement: UIElement = {
        id: 'adr_context_starter',
        type: 'adr_context_starter' as ExtendedUIFieldType,
        label: agentData.question || 'What would you like to add or clarify?',
        placeholder: 'Share additional context about this ADR...',
        required: false,
        influences: [],
      };

      // Add secondary action if we have suggested context

      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: uiElement.id,
        relatedEntities: agentData.relatedEntities,
      });
      if (agentData.context && agentData.context.trim()) {
        secondaryActions.push({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: 'Apply Suggested Context',
          fieldId: 'adr_context_starter',
          handler: SecondaryActionHandler.AdrContentApply,
          payload: {
            handlerType: 'adr_content_apply',
            sections: [
              {
                key: 'context',
                content: agentData.context,
              },
            ],
          } as AdrContentApplyPayload,
        });
      }

      if (agentData.nextStep) {
        secondaryActions.push({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: 'Next Step',
          fieldId: 'next_step',
          handler: SecondaryActionHandler.NextStep,
          payload: {
            handlerType: 'next_step',
            nextStep: agentData.nextStep,
          } as NextStepPayload,
        });
      }

      this.logger.log('Starting agent completed successfully:', {
        executionId: agentResponse.executionId,
        hasSuggestedContext: !!agentData.context,
        hasQuestion: !!agentData.question,
      });

      return {
        // setup classify for handling the user's response
        nextNodeId: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          response: agentData.response, // Agent's commentary
          title: this.title,
          secondaryActions,
          uiElements: [uiElement],
        },
      };
    } catch (error) {
      this.logger.error('Error processing starting agent response:', error);
      return {
        nextNodeId: ADR_REFINEMENT_NODES.RECOVERY,
        errorMsg: 'Error processing starting agent response',
        systemMessageData: {
          response:
            "Something went wrong while analyzing the context. Let's proceed with manual input instead.",
        },
      };
    }
  }

  async compensate(
    _context: AdrRefinementFlowContext,
    _error: Error,
    _compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    /*
reenable when done testing
    const { errorClassification, attemptCount } = compensationContext;

    // Agent timeouts - starting agent analysis needs time
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 2) {
      const delay = 10000 + attemptCount * 5000; // Progressive: 10s, 15s
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Starting agent timeout, retry ${attemptCount + 1}/2 with ${delay}ms delay`,
      };
    }

    // Agent service issues
    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 8000,
        reason: 'Starting agent service issue, retrying',
      };
    }

    // Rate limiting
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'Starting agent rate limited, extended delay before retry',
      };
    }

    // Max attempts - fallback to content response for manual input
    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: ADR_REFINEMENT_NODES.CONTENT_RESPONSE as string,
        reason:
          'Starting agent failed, proceeding to manual feedback gathering',
      };
    }
      */
    return { action: 'FAIL' };
  }
}
