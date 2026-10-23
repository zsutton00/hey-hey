import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  AdrContentApplyPayload,
  AdrStatus,
  ArtifactResponseDto,
  Influence,
  NextStepPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import { AdrActiveSectionEnum } from 'src/generated/agents/models';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { DesignDocId, OrganizationId } from 'src/types';
import { getCurrentSectionFromStatus } from 'src/types/design-doc.types';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  AdrRefinementFlowContext,
  CompensationContext,
  CompensationResult,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import {
  AdrAgentResponse,
  AdrAgentResponseSchema,
  AdrRefinerAgentInput,
  AdrRefinerAgentInputSchema,
} from './adr-agent.schemas';
import { loadAdrLinkedEntities } from './linked-entities.util';
// Removed unused classification imports - node no longer depends on classifier

// reuse shared schemas via imports above

// Configuration for this agent node
const config = {
  useNextLevel: false,
  nodeId: 'agent_analysis',
  title: 'AI Agent Analysis',
} as const;

/**
 * ADR Agent Analysis node - provides conversational refinement for ADR sections
 * Simplified version that doesn't rely on preceding classifier
 */
@Injectable()
export class AdrRefinementAgentAnalysisNode extends AgentNodeBase<
  AdrRefinementFlowContext,
  AdrRefinerAgentInput
> {
  readonly id = ADR_REFINEMENT_NODES.AGENT_ANALYSIS;
  readonly title = config.title;
  readonly responseSchema = AdrAgentResponseSchema;

  private readonly logger = new Logger(AdrRefinementAgentAnalysisNode.name);

  constructor(
    private designDocService: DesignDocService,
    private initiativeService: InitiativeService,
    private taskService: TaskService,
    private artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentId = 'adr-refiner';

  readonly userPrompt = '';

  readonly agentInput = async (
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<AdrRefinerAgentInput> => {
    const context = tracker.getContext();
    try {
      const designDoc = await this.designDocService.findOneForAdapter(
        context.designDocId,
        context.core.organizationId,
      );

      if (!designDoc) {
        this.logger.error('Design doc not found while building agent input', {
          designDocId: context.designDocId,
          organizationId: context.core.organizationId,
        });
        throw new Error(
          `Design doc not found while building agent input ${context.designDocId}`,
        );
      }

      if (!latestUserMessage) {
        this.logger.error(
          'latestUserMessage not found while building agent input',
          {
            workflowId: context.core.workflowId,
            organizationId: context.core.organizationId,
          },
        );
        throw new Error(
          `latestUserMessage not found while building agent input`,
        );
      }

      // Determine active section from status
      const statusLevel = getCurrentSectionFromStatus(
        designDoc.status || 'ADR_CONTEXT',
      ) as AdrActiveSectionEnum;

      // Extract section content
      const getSectionContent = (key: string): string => {
        const section = designDoc.sections?.find((s) => s.key === key);
        return section?.materializedMarkdown?.trim() ?? '';
      };

      const lastUserMessage = latestUserMessage
        ? MessageContentExtractor.extractMessageContent(latestUserMessage)
        : '';

      const recentConversationMessages =
        await this.loadRecentConversationMessages<ArtifactResponseDto>({
          context,
          latestUserMessageId: latestUserMessage?.id,
          ...buildRecentConversationMessageLoaders(this.artifactService),
          logger: this.logger,
        });

      const { task } = await loadAdrLinkedEntities({
        designDocId: context.designDocId,
        organizationId: context.core.organizationId,
        designDocService: this.designDocService,
        taskService: this.taskService,
      });

      const input: AdrRefinerAgentInput = {
        adr: {
          title: designDoc.name || 'Untitled ADR',
          context: getSectionContent('context'),
          decision: getSectionContent('decision'),
          consequences: getSectionContent('consequences'),
        },
        lastUserMessage,
        activeSection: statusLevel,
        task,
        ...(recentConversationMessages?.length
          ? { recentConversationMessages }
          : {}),
        requiredOps: 0,
      };

      const validation = AdrRefinerAgentInputSchema.safeParse(input);

      if (!validation.success) {
        this.logger.warn('Simplified ADR input validation failed', {
          designDocId: context.designDocId,
          issues: validation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        throw new Error(`There was an error validating the agent input`);
      }

      return validation.data as AdrRefinerAgentInput;
    } catch (error) {
      this.logger.error('Failed to build simplified ADR input', {
        error: error instanceof Error ? error.message : 'Unknown error',
        designDocId: context.designDocId,
      });
      throw new Error(`There was an error validating the agent input`);
    }
  };

  async buildContext(
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      designDocId: context.designDocId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AdrAgentResponse>,
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      const context = tracker.getContext();
      this.logger.debug('ADR agent response received:', {
        result: agentResponse.result,
      });
      // Validate agent response has result
      if (!agentResponse.result) {
        this.logger.error('ADR agent analysis response missing result field:', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.RECOVERY as string,
          errorMsg: 'ADR agent analysis response missing result field',
        };
      }

      // Validate response schema
      const parseResult = AdrAgentResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('ADR agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.RECOVERY as string,
          errorMsg: 'ADR agent response validation failed',
        };
      }

      const agentData = parseResult.data;

      // Build UI element for agent response
      const responseFieldId = uuidv4();
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

      // Convert ops to sections format for AdrContentApplyPayload
      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      const sections =
        agentData.ops
          ?.filter((op) => !!op.target)
          .map((op) => ({
            key: op.target,
            content: op.text,
          })) ?? [];

      if (sections.length) {
        // Add secondary action for applying edits
        secondaryActions.push({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: 'Apply Proposed Edits',
          fieldId: 'agent_response',
          handler: SecondaryActionHandler.AdrContentApply,
          payload: {
            handlerType: 'adr_content_apply',
            sections,
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

      this.logger.log('ADR agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length ?? 0,
        hasInfluences: !!agentData.influences?.length,
      });

      await this.promoteGeneratingStatus(
        context.designDocId,
        context.core.organizationId,
      );

      return {
        nextNodeId: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: 'Review ADR updates',
          response:
            agentData.response || 'Here are my suggested edits to the ADR:',
          uiElements: [uiElement],
          secondaryActions,
        },
      };
    } catch (error) {
      this.logger.error('Error in ADR agent analysis processing:', error);
      return {
        nextNodeId: ADR_REFINEMENT_NODES.RECOVERY as string,
        errorMsg: 'Error in ADR agent analysis processing',
      };
    }
  }

  async compensate(
    _context: AdrRefinementFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Agent timeouts - ADR analysis needs sufficient time
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 5000; // Progressive: 10s, 15s, 20s
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `ADR agent analysis timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    // Agent service issues
    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'ADR agent service issue, retrying with extended delay',
      };
    }

    // Rate limiting - agent-specific delays
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 20000,
        reason: 'ADR agent rate limited, extended delay before retry',
      };
    }

    // Max attempts - fallback to content response manually
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: ADR_REFINEMENT_NODES.RECOVERY,
        reason:
          'ADR agent analysis failed, falling back to manual feedback gathering',
      };
    }

    return { action: 'FAIL' };
  }

  private async promoteGeneratingStatus(
    designDocId: DesignDocId,
    organizationId: OrganizationId,
  ): Promise<void> {
    try {
      const designDoc = await this.designDocService.findOneForAdapter(
        designDocId,
        organizationId,
      );

      if (!designDoc) {
        return;
      }

      const completedStatus = this.getCompletedStatusForGenerating(
        designDoc.status as AdrStatus | undefined,
      );

      if (!completedStatus) {
        return;
      }

      await this.designDocService.update(
        designDocId,
        { status: completedStatus },
        organizationId,
      );
    } catch (error) {
      this.logger.warn('Failed to promote ADR generating status', {
        designDocId,
        organizationId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private getCompletedStatusForGenerating(
    status?: AdrStatus,
  ): AdrStatus | null {
    switch (status) {
      case AdrStatus.AdrGeneratingDecision:
        return AdrStatus.AdrDecision;
      case AdrStatus.AdrGeneratingConsequences:
        return AdrStatus.AdrConsequences;
      default:
        return null;
    }
  }
}
