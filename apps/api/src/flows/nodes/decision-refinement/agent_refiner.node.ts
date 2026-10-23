import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  AdrContentApplyPayload,
  Influence,
  NextStepPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from 'src/generated';
import { ArtifactResponseDto } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  DecisionRefinementFlowContext,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { DECISION_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import {
  DecisionRefinerRequest,
  DecisionRefinerRequestSchema,
  DecisionRefinerResponse,
  DecisionRefinerResponseSchema,
} from './decision-refiner.schemas';

@Injectable()
export class DecisionRefinementAgentAnalysisNode extends AgentNodeBase<
  DecisionRefinementFlowContext,
  DecisionRefinerRequest
> {
  readonly id = DECISION_REFINEMENT_NODES.AGENT_ANALYSIS;
  readonly title = 'AI Agent Analysis';
  readonly responseSchema = DecisionRefinerResponseSchema;

  private readonly logger = new Logger(
    DecisionRefinementAgentAnalysisNode.name,
  );

  constructor(
    private designDocService: DesignDocService,
    private artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentId = 'decision-refiner';

  readonly userPrompt = '';

  readonly agentInput = async (
    tracker: MutableContextHandle<DecisionRefinementFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<DecisionRefinerRequest> => {
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
          'latestUserMessage not found while building agent input',
        );
      }

      const lastUserMessage =
        MessageContentExtractor.extractMessageContent(latestUserMessage);

      const recentConversationMessages =
        await this.loadRecentConversationMessages<ArtifactResponseDto>({
          context,
          latestUserMessageId: latestUserMessage?.id,
          ...buildRecentConversationMessageLoaders(this.artifactService),
          logger: this.logger,
        });

      const getSectionContent = (key: string): string => {
        const section = designDoc.sections?.find((s) => s.key === key);
        return section?.materializedMarkdown?.trim() ?? '';
      };

      if (!designDoc.name) {
        this.logger.error(
          'Design doc title missing while building agent input',
          {
            designDocId: context.designDocId,
            organizationId: context.core.organizationId,
          },
        );
        throw new Error('Design doc title missing while building agent input');
      }

      const input: DecisionRefinerRequest = {
        title: designDoc.name,
        content: getSectionContent('content'),
        lastUserMessage,
        ...(recentConversationMessages?.length
          ? { recentConversationMessages }
          : {}),
      };

      const validation = DecisionRefinerRequestSchema.safeParse(input);
      if (!validation.success) {
        this.logger.warn('Decision input validation failed', {
          designDocId: context.designDocId,
          issues: validation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        throw new Error('There was an error validating the agent input');
      }

      return validation.data;
    } catch (error) {
      this.logger.error('Failed to build decision input', {
        error: error instanceof Error ? error.message : 'Unknown error',
        designDocId: context.designDocId,
      });
      throw new Error('There was an error validating the agent input');
    }
  };

  async buildContext(
    tracker: MutableContextHandle<DecisionRefinementFlowContext>,
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
    agentResponse: MastraAgentResponse<DecisionRefinerResponse>,
    _tracker: MutableContextHandle<DecisionRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      this.logger.debug('Decision agent response received:', {
        result: agentResponse.result,
      });

      if (!agentResponse.result) {
        this.logger.error(
          'Decision agent analysis response missing result field',
          {
            executionId: agentResponse.executionId,
            status: agentResponse.status,
            error: agentResponse.error,
          },
        );
        return {
          nextNodeId: DECISION_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Decision agent analysis response missing result field',
        };
      }

      const parseResult = DecisionRefinerResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('Decision agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: DECISION_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Decision agent response validation failed',
        };
      }

      const agentData = parseResult.data;

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
        secondaryActions.push({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: 'Apply Proposed Edits',
          fieldId: responseFieldId,
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

      this.logger.log('Decision agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length ?? 0,
        hasInfluences: !!agentData.influences?.length,
      });

      return {
        nextNodeId: DECISION_REFINEMENT_NODES.AGENT_ANALYSIS,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: 'Review decision updates',
          response:
            agentData.response ||
            'Here are my suggested edits to the decision:',
          uiElements: [uiElement],
          secondaryActions,
        },
      };
    } catch (error) {
      this.logger.error('Error in decision agent analysis processing:', error);
      return {
        nextNodeId: DECISION_REFINEMENT_NODES.RECOVERY,
        errorMsg: 'Error in decision agent analysis processing',
      };
    }
  }
}
