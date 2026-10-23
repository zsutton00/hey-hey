import { Injectable, Logger } from '@nestjs/common';
import {
  ArtifactResponseDto,
  ExtendedUIFieldType,
  Influence,
  RecentActivityCorrelationRecordDto,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestedActionPayload,
  UIElement,
} from 'src/generated';
import {
  ActivityDelta as AgentsActivityDelta,
  ActivityRecord,
  ActivityRecordLinkType as AgentsLinkType,
  DailySessionRequest,
  DailySessionSuggestedAction,
  EntityType as AgentsEntityType,
} from 'src/generated/agents/models';
import {
  AgentResponseShape,
  MastraAgentResponse,
} from 'src/services/agents/mastra-client.service';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import {
  ActivityDelta as FlowActivityDelta,
  DailySessionFlowContext,
  DailySessionSessionContext,
  FlowUserMessage,
  ProcessAgentResponseResult,
} from 'src/types/flow-internal.types';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { DAILY_SESSION_NODES } from '../../constants';
import { buildRecentConversationMessageLoaders } from '../../utils/recent-conversation.util';
import { computeActivityDelta } from '../../utils/activity-delta.util';
import {
  apiInfluenceSchema,
  relatedEntitySchema,
  usageSummarySchema,
} from '../../utils/shared-schemas';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';

const ACTIVITY_FETCH_LIMIT = 10;

/**
 * Bridge API-generated RecentActivityCorrelationRecordDto to
 * agents-generated ActivityRecord. The two types share identical
 * field names but differ nominally (EntityType enum vs union,
 * string dates vs Date objects). We pass through the rich fields
 * (linkedEntities, reports, plan, lastMessage) so the agent has
 * full context for its activity snapshot.
 */
function toActivityRecords(
  records: RecentActivityCorrelationRecordDto[],
): ActivityRecord[] {
  return records.map((r) => ({
    entityId: r.entityId,
    entityType: r.entityType as unknown as AgentsEntityType,
    title: r.title,
    ...(r.status != null ? { status: r.status } : {}),
    timestamp: new Date(r.timestamp),
    ...(r.updatedAt != null ? { updatedAt: new Date(r.updatedAt) } : {}),
    linkedEntities: (r.linkedEntities ?? []).map((le) => ({
      entityId: le.entityId,
      entityType: le.entityType as unknown as AgentsEntityType,
      linkType: le.linkType as unknown as AgentsLinkType,
      title: le.title,
      ...(le.updatedAt != null ? { updatedAt: new Date(le.updatedAt) } : {}),
      ...(le.status != null ? { status: le.status } : {}),
      ...(le.conversationId !== undefined
        ? { conversationId: le.conversationId }
        : {}),
      ...(le.lastMessage !== undefined ? { lastMessage: le.lastMessage } : {}),
    })),
    reports: r.reports ?? [],
    ...(r.conversationId !== undefined
      ? { conversationId: r.conversationId }
      : {}),
    ...(r.lastMessage !== undefined ? { lastMessage: r.lastMessage } : {}),
  }));
}

/**
 * Bridge flow-internal ActivityDelta (string dates, API EntityType)
 * to agents-generated ActivityDelta (Date objects, agents EntityType).
 */
function toAgentsActivityDelta(delta: FlowActivityDelta): AgentsActivityDelta {
  return {
    statusChanges: delta.statusChanges.map((sc) => ({
      entityId: sc.entityId,
      entityType: sc.entityType as unknown as AgentsEntityType,
      ...(sc.title != null ? { title: sc.title } : {}),
      previousStatus: sc.previousStatus,
      currentStatus: sc.currentStatus,
      changedAt: new Date(sc.changedAt),
    })),
    itemCompletions: delta.itemCompletions.map((ic) => ({
      entityId: ic.entityId,
      entityType: ic.entityType as unknown as AgentsEntityType,
      ...(ic.title != null ? { title: ic.title } : {}),
      completedAt: new Date(ic.completedAt),
    })),
    newSignals: delta.newSignals.map((ns) => ({
      entityId: ns.entityId,
      entityType: ns.entityType as unknown as AgentsEntityType,
      ...(ns.title != null ? { title: ns.title } : {}),
      signalType: ns.signalType,
      ...(ns.summary != null ? { summary: ns.summary } : {}),
      receivedAt: new Date(ns.receivedAt),
    })),
    computedAt: new Date(delta.computedAt),
  };
}

const DailySessionResponseSchema = z.object({
  response: z.string().min(1),
  conversationTitle: z.string().min(1).max(50),
  suggestedActions: z
    .array(z.nativeEnum(DailySessionSuggestedAction))
    .optional(),
  influences: z.array(apiInfluenceSchema).optional(),
  relatedEntities: z.array(relatedEntitySchema),
  usage: usageSummarySchema.nullable().optional(),
});

@Injectable()
export class DailySessionAgentNode extends AgentNodeBase<
  DailySessionFlowContext,
  DailySessionRequest
> {
  readonly id = DAILY_SESSION_NODES.AGENT;
  readonly title = 'Daily Session';
  readonly agentId = 'daily-session';
  readonly responseSchema = DailySessionResponseSchema;
  readonly userPrompt = '';

  private readonly logger = new Logger(DailySessionAgentNode.name);

  constructor(
    private readonly artifactService: ArtifactService,
    private readonly activityCorrelationService: ActivityCorrelationService,
  ) {
    super();
  }

  readonly agentInput = async (
    tracker: MutableContextHandle<DailySessionFlowContext>,
    latestUserMessage?: FlowUserMessage,
  ): Promise<DailySessionRequest> => {
    const context = tracker.getContext();
    const sessionContext = context.sessionContext;

    const userMessageContent = latestUserMessage
      ? MessageContentExtractor.extractMessageContent(latestUserMessage)
      : '';

    // When no user message is present (auto-triggered from welcome node),
    // supply a synthetic prompt so the agent knows to proactively surface
    // recent activity and actionable next steps.
    const lastUserMessage =
      userMessageContent || this.buildAutoTriggerPrompt(sessionContext);

    const recentConversationMessages =
      await this.loadRecentConversationMessages<ArtifactResponseDto>({
        context,
        latestUserMessageId: latestUserMessage?.id,
        ...buildRecentConversationMessageLoaders(this.artifactService),
        logger: this.logger,
      });

    // Fetch current activity and compute delta against previous session snapshot
    await this.computeAndSetActivityDelta(tracker);
    const updatedContext = tracker.getContext();
    const updatedSessionContext = updatedContext.sessionContext;

    const activitySnapshot = toActivityRecords(
      updatedSessionContext?.lastUserActivities ?? [],
    );

    const emptyDelta: AgentsActivityDelta = {
      statusChanges: [],
      itemCompletions: [],
      newSignals: [],
      computedAt: new Date(),
    };

    const request: DailySessionRequest = {
      payloadVersion: 1,
      lastUserMessage,
      activitySnapshot,
      computedDelta: updatedContext.activityDelta
        ? toAgentsActivityDelta(updatedContext.activityDelta)
        : emptyDelta,
      ...(recentConversationMessages?.length
        ? { recentConversationMessages }
        : {}),
      ...(activitySnapshot.length
        ? { lastUserActivities: activitySnapshot }
        : {}),
      ...(updatedSessionContext?.lastSystemMessage
        ? { lastSystemMessage: updatedSessionContext.lastSystemMessage }
        : {}),
      conversationId: context.core.conversationId,
      sessionStartedAt: new Date(),
    };

    return request;
  };

  async buildContext(
    tracker: MutableContextHandle<DailySessionFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AgentResponseShape>,
    tracker: MutableContextHandle<DailySessionFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      if (!agentResponse.result) {
        this.logger.error('Daily session agent missing result', {
          executionId: agentResponse.executionId,
          status: agentResponse.status,
          error: agentResponse.error,
        });
        return {
          nextNodeId: DAILY_SESSION_NODES.RECOVERY,
          errorMsg: 'Daily session agent missing result',
        };
      }

      const parsed = this.responseSchema.safeParse(
        agentResponse.result.data ?? agentResponse.result,
      );

      if (!parsed.success) {
        this.logger.error('Daily session response validation failed', {
          executionId: agentResponse.executionId,
          error: parsed.error,
        });
        return {
          nextNodeId: DAILY_SESSION_NODES.RECOVERY,
          errorMsg: 'Daily session response validation failed',
        };
      }

      const data = parsed.data;
      const context = tracker.getContext();

      // Persist session context after successful agent response
      tracker.mutate((draft) => {
        draft.sessionContext = {
          ...draft.sessionContext,
          lastSystemMessage: data.response,
          ...(context.activityDelta
            ? { lastActivityDelta: context.activityDelta }
            : {}),
        };
      });

      const responseFieldId = uuidv4();
      const uiElements: UIElement[] = [
        {
          id: responseFieldId,
          type: 'textarea' as ExtendedUIFieldType,
          label: 'Continue the conversation',
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
        nextNodeId: DAILY_SESSION_NODES.AGENT,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: this.title,
          response: data.response,
          detectedIntent: 'daily_session',
          intentConfidence: 1,
          reasoning: 'daily session conversation loop',
          uiElements,
          ...(secondaryActions.length ? { secondaryActions } : {}),
        },
      };
    } catch (error) {
      this.logger.error('Error processing daily session agent response', {
        error,
      });
      return {
        nextNodeId: DAILY_SESSION_NODES.RECOVERY,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildAutoTriggerPrompt(
    sessionContext?: DailySessionSessionContext,
  ): string {
    const isResume = !!(
      sessionContext?.lastSystemMessage || sessionContext?.lastActivityDelta
    );

    if (isResume) {
      return (
        'The user is resuming their daily session. ' +
        'Review their activity changes since the last session and ' +
        'provide updated insights on what they can work on next.'
      );
    }

    return (
      'This is the start of a new daily session. ' +
      "Look at the user's recent activity and give them insights " +
      'on the next things they can work on.'
    );
  }

  private async computeAndSetActivityDelta(
    tracker: MutableContextHandle<DailySessionFlowContext>,
  ): Promise<void> {
    const context = tracker.getContext();
    const { organizationId, projectId } = context.core;
    const userId = context.core.user.id;

    try {
      const result =
        await this.activityCorrelationService.listCorrelatedActivity(
          organizationId,
          {
            userId,
            projectId,
            limit: ACTIVITY_FETCH_LIMIT,
            offset: 0,
          },
          null,
        );

      const currentActivities = result.records;
      const previousActivities = context.sessionContext?.lastUserActivities;

      const delta = computeActivityDelta(currentActivities, previousActivities);

      tracker.mutate((draft) => {
        draft.activityDelta = delta;
        draft.sessionContext = {
          ...draft.sessionContext,
          lastUserActivities: currentActivities,
        };
      });

      this.logger.debug('Activity delta computed', {
        organizationId,
        projectId,
        statusChanges: delta.statusChanges.length,
        itemCompletions: delta.itemCompletions.length,
        newSignals: delta.newSignals.length,
        currentActivityCount: currentActivities.length,
        previousActivityCount: previousActivities?.length ?? 0,
      });
    } catch (error) {
      this.logger.warn('Failed to compute activity delta', {
        organizationId,
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
