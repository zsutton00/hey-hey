import { Injectable, Logger } from '@nestjs/common';
import {
  ArtifactResponseDto,
  EntityConversationProjectSummary,
  ExtendedUIFieldType,
  Influence,
  ProjectResponseDto,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestedActionPayload,
  SuggestedActionUserMessage,
  UIElement,
} from 'src/generated';
import {
  ProjectConversationRequest,
  ProjectConversationResponseHandledByEnum,
  ProjectConversationSuggestedAction,
  type ProjectConversationResponse,
} from 'src/generated/agents/models';
import {
  AgentResponseShape,
  MastraAgentResponse,
} from 'src/services/agents/mastra-client.service';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { ProjectService } from 'src/services/project.service';
import {
  FlowUserMessage,
  ProcessAgentResponseResult,
  ProjectConversationFlowContext,
} from 'src/types/flow-internal.types';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { PROJECT_CONVERSATION_NODES, SHARED_NODES } from '../../constants';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import {
  apiInfluenceSchema,
  relatedEntitySchema,
  usageSummarySchema,
} from '../../utils/shared-schemas';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';

const ProjectConversationResponseSchema: z.ZodType<ProjectConversationResponse> =
  z.object({
    handledBy: z
      .nativeEnum(ProjectConversationResponseHandledByEnum)
      .optional(),
    intent: z.string().optional(),
    response: z.string().min(1),
    conversationTitle: z.string().min(1).max(50),
    suggestedActions: z
      .array(z.nativeEnum(ProjectConversationSuggestedAction))
      .optional(),
    influences: z.array(apiInfluenceSchema).optional(),
    relatedEntities: z.array(relatedEntitySchema),
    usage: usageSummarySchema.nullable().optional(),
  });

@Injectable()
export class ProjectConversationAgentNode extends AgentNodeBase<
  ProjectConversationFlowContext,
  ProjectConversationRequest & Record<string, unknown>
> {
  readonly id = PROJECT_CONVERSATION_NODES.AGENT;
  readonly title = 'Project Conversation';
  readonly agentId = 'project-conversation';
  readonly responseSchema = ProjectConversationResponseSchema;
  readonly userPrompt = '';

  private readonly logger = new Logger(ProjectConversationAgentNode.name);

  private isSuggestedActionUserMessage(
    data: unknown,
  ): data is SuggestedActionUserMessage {
    return (
      !!data &&
      typeof data === 'object' &&
      (data as SuggestedActionUserMessage).type === 'SUGGESTED_ACTIONS' &&
      (data as SuggestedActionUserMessage).nextAction === 'GENERATE_TASK'
    );
  }

  private getSuggestedActionUserMessage(
    userMessage?: FlowUserMessage,
  ): SuggestedActionUserMessage | undefined {
    const userMessageData = userMessage?.data;
    const data = (
      userMessageData ? Object.values(userMessageData)[0] : undefined
    ) as SuggestedActionUserMessage | undefined;
    if (!this.isSuggestedActionUserMessage(data)) {
      return undefined;
    }
    return data;
  }

  constructor(
    private readonly projectService: ProjectService,
    private readonly artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentInput = async (
    tracker: MutableContextHandle<ProjectConversationFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<ProjectConversationRequest & Record<string, unknown>> => {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;

    if (!workflowAboutId || !workflowAboutType) {
      throw new Error('Missing workflow context for project conversation');
    }

    if (workflowAboutType !== 'project') {
      throw new Error(
        `Unsupported workflowAboutType "${workflowAboutType}" for project conversation`,
      );
    }

    const lastUserMessage = latestUserMessage
      ? MessageContentExtractor.extractMessageContent(latestUserMessage)
      : '';

    if (!lastUserMessage) {
      throw new Error('Project conversation requires a user message');
    }

    const recentConversationMessages =
      await this.loadRecentConversationMessages<ArtifactResponseDto>({
        context,
        latestUserMessageId: latestUserMessage?.id,
        ...buildRecentConversationMessageLoaders(this.artifactService),
        logger: this.logger,
      });

    const basePayload = {
      lastUserMessage,
      ...(recentConversationMessages?.length
        ? { recentConversationMessages }
        : {}),
    };

    const project = await this.projectService.findOne(
      workflowAboutId,
      organizationId,
    );
    if (!project) {
      throw new Error(`Project ${workflowAboutId} not found`);
    }

    return {
      ...basePayload,
      project: this.buildProjectSummary(project),
    };
  };

  async buildContext(
    tracker: MutableContextHandle<ProjectConversationFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      workflowAboutId: context.core.workflowAboutId,
      workflowAboutType: context.core.workflowAboutType,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AgentResponseShape>,
    _tracker: MutableContextHandle<ProjectConversationFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      if (!agentResponse.result) {
        this.logger.error('Project conversation agent missing result', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: PROJECT_CONVERSATION_NODES.RECOVERY,
          errorMsg: 'Project conversation agent missing result',
        };
      }

      const parsed = this.responseSchema.safeParse(
        agentResponse.result.data ?? agentResponse.result,
      );

      if (!parsed.success) {
        this.logger.error('Project conversation response validation failed', {
          executionId: agentResponse.executionId,
          error: parsed.error,
        });
        return {
          nextNodeId: PROJECT_CONVERSATION_NODES.RECOVERY,
          errorMsg: 'Project conversation response validation failed',
        };
      }

      const data = parsed.data;
      const responseFieldId = uuidv4();
      const uiElements: UIElement[] = [
        {
          id: responseFieldId,
          type: 'textarea' as ExtendedUIFieldType,
          label: 'Add more context or ask a follow-up',
          placeholder: '',
          multiline: true,
          required: false,
          influences: (data.influences || []) as Influence[],
        },
      ];
      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: data.relatedEntities,
      });

      secondaryActions.push(
        ...(data.suggestedActions || []).map((suggestedAction) => ({
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FormAction,
          presentation: SecondaryActionConfig.PresentationEnum.Inline,
          label: suggestedAction,
          fieldId: responseFieldId,
          handler: SecondaryActionHandler.SuggestedAction,
          payload: {
            handlerType: 'suggested_action',
            suggestedAction,
          } as SuggestedActionPayload,
        })),
      );

      return {
        nextNodeId: PROJECT_CONVERSATION_NODES.AGENT,
        systemMessageData: {
          type: 'QUESTIONS',
          title: this.title,
          response: data.response,
          detectedIntent: data.intent ?? 'project_conversation',
          intentConfidence: 1,
          reasoning: data.handledBy
            ? `handled by ${data.handledBy}`
            : 'project conversation loop',
          uiElements,
          ...(secondaryActions.length ? { secondaryActions } : {}),
        },
      };
    } catch (error) {
      this.logger.error(
        'Error processing project conversation agent response',
        {
          error,
        },
      );
      return {
        nextNodeId: PROJECT_CONVERSATION_NODES.RECOVERY,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async determineRoutingFromUserMessage(
    _context: ProjectConversationFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    const data = this.getSuggestedActionUserMessage(userMessage);

    if (data?.nextAction === 'GENERATE_TASK') {
      return SHARED_NODES.SUGGESTED_ACTIONS_GENERATE_TASK;
    }

    return undefined;
  }

  private requireField(
    value: string | null | undefined,
    label: string,
  ): string {
    if (value === null || value === undefined) {
      throw new Error(`Missing required field: ${label}`);
    }
    return value;
  }

  private buildProjectSummary(
    project: Pick<ProjectResponseDto, 'name' | 'description' | 'status'>,
  ): EntityConversationProjectSummary {
    return {
      title: this.requireField(project.name, 'project.name'),
      ...(project.description ? { description: project.description } : {}),
      ...(project.status ? { status: project.status } : {}),
    };
  }
}
