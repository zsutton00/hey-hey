import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  Influence,
  InitiativeContentApplyPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  CompensationContext,
  CompensationResult,
  FlowUserMessage,
  InitiativeRefinementFlowContext,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import { getCommonAgentInput } from './agent-utils';
import {
  InitiativeRefinerRequest,
  InitiativeRefinerResponse,
  InitiativeRefinerResponseSchema,
} from './types';

// Configuration for this agent node
const config = {
  useNextLevel: false,
  nodeId: 'agent_editor',
  title: 'AI Agent Editor',
} as const;
/**
 * Initiative Agent Editor node - provides conversational refinement for initiative fields
 * Simplified version that uses operations-based response pattern like ADR
 */
@Injectable()
export class InitiativeRefinementAgentEditorNode extends AgentNodeBase<
  InitiativeRefinementFlowContext,
  (InitiativeRefinerRequest & Record<string, unknown>) | undefined
> {
  readonly id = INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR;
  readonly title = config.title;
  readonly responseSchema = InitiativeRefinerResponseSchema;

  private readonly logger = new Logger(
    InitiativeRefinementAgentEditorNode.name,
  );

  constructor(
    private initiativeService: InitiativeService,
    private artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentId = 'initiative-refiner';

  readonly agentInput = async (
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<
    (InitiativeRefinerRequest & Record<string, unknown>) | undefined
  > => {
    const context = tracker.getContext();
    const initiative = await this.initiativeService.findOneForAdapter(
      context.initiativeId,
      context.core.organizationId,
    );

    if (!initiative) {
      this.logger.warn('Initiative not found while building agent input', {
        initiativeId: context.initiativeId,
        organizationId: context.core.organizationId,
      });
      return undefined;
    }

    const lastUserMessage = latestUserMessage
      ? MessageContentExtractor.extractMessageContent(latestUserMessage)
      : '';

    const input = await getCommonAgentInput(
      context,
      { content: lastUserMessage, id: latestUserMessage?.id },
      initiative,
      this.artifactService,
      this.logger,
    );

    return input as
      | (InitiativeRefinerRequest & Record<string, unknown>)
      | undefined;
  };

  readonly userPrompt = '';

  async buildContext(
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      initiativeId: context.initiativeId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<InitiativeRefinerResponse>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      this.logger.debug('Initiative agent response received:', {
        result: agentResponse.result,
      });

      // Validate agent response has result
      if (!agentResponse.result) {
        this.logger.error('Initiative agent response missing result field:', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
          errorMsg: 'Initiative agent response missing result field',
        };
      }

      // Validate response schema
      const parseResult = InitiativeRefinerResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('Initiative agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
          errorMsg: 'Initiative agent response validation failed',
        };
      }

      const agentData = parseResult.data;
      const responseFieldId = uuidv4();
      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      // Convert ops to fields format for InitiativeContentApplyPayload
      if (agentData.ops?.length) {
        const fields = agentData.ops.map((op) => ({
          key: op.target,
          content: op.text,
        }));

        // Add secondary action for applying edits
        secondaryActions.push({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: 'Apply Proposed Edits',
          fieldId: 'agent_response',
          handler: SecondaryActionHandler.InitiativeContentApply,
          payload: {
            handlerType: 'initiative_content_apply',
            fields,
          } as InitiativeContentApplyPayload,
        });
      }

      // Build UI element for agent response
      const uiElement: UIElement = {
        id: responseFieldId,
        type: 'agent_response',
        label: agentData.ops?.length
          ? 'Review the proposed edits'
          : "What's next",
        placeholder: `Share your feedback${agentData.ops?.length ? ' or approve the changes...' : ''}`,
        required: false,
        influences: (agentData.influences || []) as Influence[],
      };

      this.logger.log('Initiative agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length,
        hasInfluences: !!agentData.influences?.length,
        sectionCompleteConfidence: agentData.sectionCompleteConfidence,
      });

      return {
        nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: this.title,
          response:
            agentData.response ||
            'Here are my suggested edits to the initiative:',
          uiElements: [uiElement],
          secondaryActions,
        },
      };
    } catch (error) {
      this.logger.error('Error in initiative agent processing:', error);
      return {
        nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async compensate(
    _context: InitiativeRefinementFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Agent timeouts - longer delay, more retries for complex reasoning
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 5000; // Progressive: 10s, 15s, 20s
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Agent analysis timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    // Agent service issues - try with extended delay
    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'Agent service issue, retrying with extended delay',
      };
    }

    // Rate limiting - agent-specific delays
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 20000, // Longer delay for agent rate limits
        reason: 'Agent rate limited, extended delay before retry',
      };
    }

    // Max attempts - fallback to classification to handle manually
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        reason:
          'Initiative agent editor failed, falling back to manual refinement',
      };
    }

    return { action: 'FAIL' };
  }
}
