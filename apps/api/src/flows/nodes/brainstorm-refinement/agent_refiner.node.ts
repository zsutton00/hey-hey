import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  AdrContentApplyPayload,
  ExtendedUIFieldType,
  Influence,
  NextStepPayload,
  QuestionsGroupPayload,
  QuestionsGroupUserMessage,
  QuestionsSystemMessageData,
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
  BrainstormRefinementFlowContext,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { BRAINSTORM_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import {
  BrainstormRefinerRequest,
  BrainstormRefinerRequestSchema,
  BrainstormRefinerAgentResponse,
  BrainstormRefinerResponse,
  BrainstormRefinerResponseSchema,
  BrainstormRefinerSuspendedResponseSchema,
  BrainstormRefinerCombinedResponseSchema,
} from './brainstorm-refiner.schemas';

@Injectable()
export class BrainstormRefinementAgentAnalysisNode extends AgentNodeBase<
  BrainstormRefinementFlowContext,
  BrainstormRefinerRequest
> {
  readonly id = BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS;
  readonly title = 'AI Agent Analysis';
  readonly responseSchema = BrainstormRefinerCombinedResponseSchema;

  private readonly logger = new Logger(
    BrainstormRefinementAgentAnalysisNode.name,
  );

  constructor(
    private designDocService: DesignDocService,
    private artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentId = 'brainstorm-refiner';

  readonly userPrompt = '';

  readonly agentInput = async (
    tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<BrainstormRefinerRequest> => {
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
      const clarifyingAnswers =
        this.extractClarifyingAnswers(latestUserMessage);

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

      const input: BrainstormRefinerRequest = {
        title: designDoc.name,
        content: getSectionContent('content'),
        lastUserMessage,
        ...(recentConversationMessages?.length
          ? { recentConversationMessages }
          : {}),
        ...(context.clarifyingRunId
          ? {
              resumeRunId: context.clarifyingRunId,
              resumeData: {
                lastUserMessage,
                ...(clarifyingAnswers?.length ? { clarifyingAnswers } : {}),
              },
            }
          : {}),
      };

      const validation = BrainstormRefinerRequestSchema.safeParse(input);
      if (!validation.success) {
        this.logger.warn('Brainstorm input validation failed', {
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
      this.logger.error('Failed to build brainstorm input', {
        error: error instanceof Error ? error.message : 'Unknown error',
        designDocId: context.designDocId,
      });
      throw new Error('There was an error validating the agent input');
    }
  };

  async buildContext(
    tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
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
    agentResponse: MastraAgentResponse<BrainstormRefinerAgentResponse>,
    tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      this.logger.debug('Brainstorm agent response received:', {
        result: agentResponse.result,
      });

      if (!agentResponse.result) {
        this.logger.error(
          'Brainstorm agent analysis response missing result field',
          {
            executionId: agentResponse.executionId,
            status: agentResponse.status,
            error: agentResponse.error,
          },
        );
        return {
          nextNodeId: BRAINSTORM_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Brainstorm agent analysis response missing result field',
        };
      }

      const responseData = agentResponse.result.data ?? agentResponse.result;
      const suspendedParse =
        BrainstormRefinerSuspendedResponseSchema.safeParse(responseData);

      if (suspendedParse.success) {
        const suspendedData = suspendedParse.data;
        const questions = suspendedData.clarifyingQuestions;
        tracker.mutate((draft) => {
          draft.clarifyingRunId = suspendedData.runId;
          draft.clarifyingQuestions = [...questions];
        });

        const responseFieldId = uuidv4();
        const uiElements = this.buildQuestionGroupElements(
          responseFieldId,
          questions,
        );

        const systemMessageData: QuestionsSystemMessageData = {
          ragEnabled: false,
          type: 'QUESTIONS',
          response: 'I need a bit more information to avoid confusion',
          title: 'Clarifying Questions',
          detectedIntent: 'brainstorm_refinement_clarification',
          intentConfidence: 1,
          reasoning: 'Brainstorm workflow suspended for clarification',
          uiElements,
          uiHints: {
            expectedElements: uiElements.map((el) => ({
              type: el.type,
              count: 1,
              label: el.label,
              required: el.required ?? false,
            })),
            estimatedCount: uiElements.length,
            layoutHint: 'form',
          },
        };

        return {
          nextNodeId: BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS,
          systemMessageData,
        } as ProcessAgentResponseResult;
      }

      if (this.hasSuspendedResponseMarkers(responseData)) {
        this.logger.error(
          'Brainstorm agent returned malformed suspended response payload',
          {
            executionId: agentResponse.executionId,
            responseData,
          },
        );
        return {
          nextNodeId: BRAINSTORM_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Brainstorm agent returned malformed suspended response',
        };
      }

      const parseResult =
        BrainstormRefinerResponseSchema.safeParse(responseData);

      if (!parseResult.success) {
        this.logger.error('Brainstorm agent response validation failed:', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: BRAINSTORM_REFINEMENT_NODES.RECOVERY,
          errorMsg: 'Brainstorm agent response validation failed',
        };
      }

      const agentData = parseResult.data as BrainstormRefinerResponse;

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

      this.logger.log('Brainstorm agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length ?? 0,
        hasInfluences: !!agentData.influences?.length,
      });

      tracker.mutate((draft) => {
        draft.clarifyingRunId = undefined;
        draft.clarifyingQuestions = undefined;
      });

      return {
        nextNodeId: BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: 'Review brainstorm updates',
          response:
            agentData.response ||
            'Here are my suggested edits to the brainstorm:',
          uiElements: [uiElement],
          secondaryActions,
        },
      };
    } catch (error) {
      this.logger.error(
        'Error in brainstorm agent analysis processing:',
        error,
      );
      return {
        nextNodeId: BRAINSTORM_REFINEMENT_NODES.RECOVERY,
        errorMsg: 'Error in brainstorm agent analysis processing',
      };
    }
  }

  private extractClarifyingAnswers(
    userMessage?: FlowUserMessage,
  ): string[] | undefined {
    if (!userMessage?.data) {
      return undefined;
    }

    const structuredMessage = this.getQuestionsGroupUserMessage(userMessage);
    const structuredAnswers = structuredMessage?.clarifyingAnswers
      ?.map((entry) => entry.answer?.trim())
      .filter((answer): answer is string => !!answer);

    if (structuredAnswers?.length) {
      return structuredAnswers;
    }

    const dataValues = Object.values(userMessage.data);
    const answers: string[] = [];

    for (const value of dataValues) {
      if (typeof value === 'string' && value.trim()) {
        answers.push(value.trim());
      }
    }

    return answers.length > 0 ? answers : undefined;
  }

  private buildQuestionGroupElements(
    responseFieldId: string,
    questions?: string[],
  ): UIElement[] {
    const payload: QuestionsGroupPayload = {
      questions: questions?.length
        ? questions
        : ['Add more scope or constraints'],
    };

    return [
      {
        id: responseFieldId,
        type: 'question_group' as ExtendedUIFieldType,
        label: 'Clarifying questions',
        payload,
      },
    ];
  }

  private getQuestionsGroupUserMessage(
    userMessage?: FlowUserMessage,
  ): QuestionsGroupUserMessage | undefined {
    const userMessageData = userMessage?.data;
    const data = (
      userMessageData ? Object.values(userMessageData)[0] : undefined
    ) as QuestionsGroupUserMessage | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray(data.clarifyingAnswers)
    ) {
      return undefined;
    }
    return data;
  }

  private hasSuspendedResponseMarkers(response: unknown): boolean {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      return false;
    }

    const typedResponse = response as {
      status?: unknown;
      runId?: unknown;
      clarifyingQuestions?: unknown;
    };

    return (
      typedResponse.status !== undefined ||
      typedResponse.runId !== undefined ||
      typedResponse.clarifyingQuestions !== undefined
    );
  }
}
