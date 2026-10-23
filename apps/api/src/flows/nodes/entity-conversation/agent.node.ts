import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Injectable, Logger } from '@nestjs/common';
import {
  ArtifactResponseDto,
  ExtendedUIFieldType,
  Influence,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestedActionPayload,
  SuggestedActionUserMessage,
  UIElement,
} from 'src/generated';
import {
  EntityConversationDesignDocRequest,
  EntityConversationRequest,
  EntityConversationAgentSessionRequestEntityTypeEnum,
  EntityConversationDesignDocRequestEntityTypeEnum,
  EntityConversationInitiativeRequestEntityTypeEnum,
  EntityConversationProjectRequest,
  EntityConversationProjectRequestEntityTypeEnum,
  EntityConversationTaskRequestEntityTypeEnum,
  EntityConversationSuggestedAction,
  type EntityConversationResponse,
  EntityConversationTaskSummaryTaskTypeEnum,
} from 'src/generated/agents/models';
import type { DesignDocResponseDto, ProjectResponseDto } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import {
  AgentResponseShape,
  MastraAgentResponse,
} from 'src/services/agents/mastra-client.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { ProjectService } from 'src/services/project.service';
import { TaskService } from 'src/services/tasks/task.service';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import {
  EntityConversationFlowContext,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from 'src/types/flow-internal.types';
import { PlanId } from 'src/types';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ENTITY_CONVERSATION_NODES, SHARED_NODES } from '../../constants';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import {
  apiInfluenceSchema,
  relatedEntitySchema,
  usageSummarySchema,
} from '../../utils/shared-schemas';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { isEntityConversationTaskAboutType } from '../../utils/entity-conversation-about-type.util';
import { AgentNodeBase } from '../base';

const EntityConversationResponseSchema: z.ZodType<EntityConversationResponse> =
  z.object({
    response: z.string().min(1),
    suggestedActions: z
      .array(z.nativeEnum(EntityConversationSuggestedAction))
      .optional(),
    influences: z.array(apiInfluenceSchema).optional(),
    relatedEntities: z.array(relatedEntitySchema),
    usage: usageSummarySchema.nullable().optional(),
  });

@Injectable()
export class EntityConversationAgentNode extends AgentNodeBase<
  EntityConversationFlowContext,
  EntityConversationRequest & Record<string, unknown>
> {
  readonly id = ENTITY_CONVERSATION_NODES.AGENT;
  readonly title = 'Entity Conversation';
  readonly agentId = 'entity-conversation';
  readonly responseSchema = EntityConversationResponseSchema;
  readonly userPrompt = '';

  private readonly logger = new Logger(EntityConversationAgentNode.name);

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
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
    private readonly designDocService: DesignDocService,
    private readonly projectService: ProjectService,
    private readonly agentSessionService: AgentSessionService,
    private readonly artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentInput = async (
    tracker: MutableContextHandle<EntityConversationFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<EntityConversationRequest & Record<string, unknown>> => {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;

    if (!workflowAboutId || !workflowAboutType) {
      throw new Error('Missing workflow context for entity conversation');
    }

    const lastUserMessage = latestUserMessage
      ? MessageContentExtractor.extractMessageContent(latestUserMessage)
      : '';

    if (!lastUserMessage) {
      throw new Error('Entity conversation requires a user message');
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

    if (isEntityConversationTaskAboutType(workflowAboutType)) {
      const task = await this.taskService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      if (!task) {
        throw new Error(`Task ${workflowAboutId} not found`);
      }
      const taskContent = materializedSectionsToContentMap(task.sections);
      return {
        ...basePayload,
        entityType: EntityConversationTaskRequestEntityTypeEnum.task,
        entity: {
          taskType: task.type as EntityConversationTaskSummaryTaskTypeEnum,
          title: this.requireField(task.name, 'task.name'),
          description: this.requireField(
            taskContent.description,
            'task.description',
          ),
          ...(task.type === WORK_ITEM_TYPE_KEYS.Standard
            ? {
                acceptanceCriteria: this.requireField(
                  taskContent.acceptanceCriteria,
                  'task.acceptanceCriteria',
                ),
              }
            : {}),
        },
      };
    }

    switch (workflowAboutType) {
      case 'initiative': {
        const initiative = await this.initiativeService.findOneForAdapter(
          workflowAboutId,
          organizationId,
        );
        if (!initiative) {
          throw new Error(`Initiative ${workflowAboutId} not found`);
        }
        const initiativeContent = materializedSectionsToContentMap(
          initiative.sections,
        );
        return {
          ...basePayload,
          entityType:
            EntityConversationInitiativeRequestEntityTypeEnum.initiative,
          entity: {
            title: this.requireField(initiative.name, 'initiative.name'),
            description: this.requireField(
              initiativeContent.description,
              'initiative.description',
            ),
            details: this.requireField(
              initiativeContent.details,
              'initiative.details',
            ),
            acceptanceCriteria: this.requireField(
              initiativeContent.acceptanceCriteria,
              'initiative.acceptanceCriteria',
            ),
          },
        };
      }
      case 'design-doc': {
        const designDoc = await this.designDocService.findOneForAdapter(
          workflowAboutId,
          organizationId,
        );
        if (!designDoc) {
          throw new Error(`Design doc ${workflowAboutId} not found`);
        }
        return {
          ...basePayload,
          entityType:
            EntityConversationDesignDocRequestEntityTypeEnum.design_doc,
          entity: this.buildDesignDocSummary(designDoc),
        };
      }
      case 'agent-session': {
        const session = await this.agentSessionService.findOne(
          organizationId,
          workflowAboutId,
        );
        return {
          ...basePayload,
          entityType:
            EntityConversationAgentSessionRequestEntityTypeEnum.agent_session,
          entity: {
            title: this.requireField(session.title, 'agentSession.title'),
          },
        };
      }
      case 'project': {
        const project = await this.projectService.findOne(
          workflowAboutId,
          organizationId,
        );
        if (!project) {
          throw new Error(`Project ${workflowAboutId} not found`);
        }
        return {
          ...basePayload,
          entityType: EntityConversationProjectRequestEntityTypeEnum.project,
          entity: this.buildProjectSummary(project),
        };
      }
      default:
        throw new Error(`Unsupported workflowAboutType "${workflowAboutType}"`);
    }
  };

  async buildContext(
    tracker: MutableContextHandle<EntityConversationFlowContext>,
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
    _tracker: MutableContextHandle<EntityConversationFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      if (!agentResponse.result) {
        this.logger.error('Entity conversation agent missing result', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: ENTITY_CONVERSATION_NODES.RECOVERY,
          errorMsg: 'Entity conversation agent missing result',
        };
      }

      const parsed = this.responseSchema.safeParse(
        agentResponse.result.data ?? agentResponse.result,
      );

      if (!parsed.success) {
        this.logger.error('Entity conversation response validation failed', {
          executionId: agentResponse.executionId,
          error: parsed.error,
        });
        return {
          nextNodeId: ENTITY_CONVERSATION_NODES.RECOVERY,
          errorMsg: 'Entity conversation response validation failed',
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
        nextNodeId: ENTITY_CONVERSATION_NODES.AGENT,
        systemMessageData: {
          type: 'QUESTIONS',
          title: this.title,
          response: data.response,
          detectedIntent: 'entity_conversation',
          intentConfidence: 1,
          reasoning: 'entity conversation loop',
          uiElements,
          ...(secondaryActions.length ? { secondaryActions } : {}),
        },
      };
    } catch (error) {
      this.logger.error('Error processing entity conversation agent response', {
        error,
      });
      return {
        nextNodeId: ENTITY_CONVERSATION_NODES.RECOVERY,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async determineRoutingFromUserMessage(
    _context: EntityConversationFlowContext,
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

  private buildDesignDocSummary(
    designDoc: DesignDocResponseDto,
  ): EntityConversationDesignDocRequest['entity'] {
    return {
      title: this.requireField(designDoc.name, 'designDoc.name'),
      ...(designDoc.summary ? { summary: designDoc.summary } : {}),
      ...(designDoc.sections?.length
        ? {
            sections: designDoc.sections.map((section) => ({
              key: section.key,
              title: section.key,
              content: section.materializedMarkdown,
            })),
          }
        : {}),
    };
  }

  private buildProjectSummary(
    project: Pick<ProjectResponseDto, 'name' | 'description' | 'status'>,
  ): EntityConversationProjectRequest['entity'] {
    return {
      title: this.requireField(project.name, 'project.name'),
      ...(project.description ? { description: project.description } : {}),
      ...(project.status ? { status: project.status } : {}),
    };
  }
}
