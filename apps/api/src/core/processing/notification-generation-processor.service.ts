import { resolveAncestorPlanWorkItem } from '../../services/plan/resolve-plan-work-item';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ArtifactSourceType, ArtifactType } from '@prisma/client';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { uuidv4 } from 'lib0/random';
import {
  ChildUnblockedNotificationDto,
  ChildUnblockedPayload,
  AgentSessionStatus,
  EntityType,
  NotificationAffectedEntityRef,
  NotificationChannel,
  NotificationClientHandlingHints,
  NotificationDeliveryMetadata,
  NotificationDto,
  NotificationEventType,
  PullRequestMergedNotificationDto,
  PullRequestMergedPayload,
  NotificationStatus,
  ReportCreatedNotificationDto,
  ReportCreatedPayload,
  ReportNextStepItem,
  ReportRecommendedUpdateItem,
  ReportVerificationTaskItem,
  SessionAutoDecidedNotificationDto,
  SessionAutoDecidedPayload,
  SessionMonitorMessageState,
  SessionMonitorOutcome,
  SessionMonitorSystemMessageData,
  SessionReportReadyNotificationDto,
  SessionReportReadyPayload,
  SessionReviewNeededNotificationDto,
  SessionReviewNeededPayload,
  SystemMessageData,
  SystemMessageNotificationDto,
  SystemMessagePayload,
  TaskCompletedNotificationDto,
  TaskCompletedPayload,
  WorkStatus,
} from 'src/generated';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import {
  AgentSessionStatusChangedEvent,
  GitHubWebhookAcceptedEvent,
  MessageCreatedEvent,
  ReportCreatedEvent,
  SystemNotificationEvent,
  TaskStatusChangedEvent,
} from 'src/core/events/types/domain-events';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/core/redis/redis.service';
import { MessageService } from 'src/services/message.service';
import { sessionMonitorSystemMessageDataSchema } from 'src/services/schemas/session-monitor.schemas';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import { isUserVisiblePersistedReportAudience } from 'src/services/reports/report-audience';

type StandardizedNotificationType =
  | 'REPORT_READY'
  | 'TASK_STATUS_CHANGED'
  | 'SYSTEM_MESSAGE'
  | 'SESSION_REPORT_READY'
  | 'SESSION_AUTO_DECIDED'
  | 'SESSION_REVIEW_NEEDED'
  | 'PULL_REQUEST_MERGED';
type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH';

type NotificationCandidate = {
  notificationId: string;
  userId: UserId;
  organizationId: OrganizationId;
  notificationType: StandardizedNotificationType;
  priority: NotificationPriority;
  sourceEntities: Array<{ type: EntityType; id: string }>;
  preview: {
    title: string;
    snippet: string;
  };
  primaryEntity: {
    type: EntityType;
    id: string;
    title: string;
  };
  timestamp: string;
  correlationReference?: string;
  projectId?: ProjectId;
  conversationId?: ConversationId;
  dedupeIdentity?: string;
  notificationEventType: NotificationEventType;
  reportReferenceId?: string;
  payload:
    | ReportCreatedPayload
    | TaskCompletedPayload
    | SystemMessagePayload
    | ChildUnblockedPayload
    | SessionReportReadyPayload
    | SessionAutoDecidedPayload
    | SessionReviewNeededPayload
    | PullRequestMergedPayload;
};

type NotificationPreferenceFlags = Partial<
  Record<StandardizedNotificationType, boolean>
>;
type NotificationPreferenceMap = Record<string, NotificationPreferenceFlags>;
const PREFERENCE_TYPE_VALUES = new Set<StandardizedNotificationType>([
  'REPORT_READY',
  'TASK_STATUS_CHANGED',
  'SYSTEM_MESSAGE',
  'SESSION_REPORT_READY',
  'SESSION_AUTO_DECIDED',
  'SESSION_REVIEW_NEEDED',
  'PULL_REQUEST_MERGED',
]);

@Injectable()
export class NotificationGenerationProcessor {
  private readonly logger = new Logger(NotificationGenerationProcessor.name);
  private readonly dedupeWindowMs = this.parsePositiveInt(
    process.env.NOTIFICATION_DEDUPE_WINDOW_MS,
    5 * 60 * 1000,
  );
  private readonly throttleWindowMs = this.parsePositiveInt(
    process.env.NOTIFICATION_THROTTLE_WINDOW_MS,
    60 * 1000,
  );
  private readonly throttleLimitPerUser = this.parsePositiveInt(
    process.env.NOTIFICATION_THROTTLE_MAX_PER_USER,
    20,
  );
  private readonly requirePreferenceCoverage =
    process.env.NOTIFICATION_REQUIRE_PREFERENCES === 'true';
  private readonly preferenceMap = this.parsePreferenceMap(
    process.env.NOTIFICATION_USER_PREFERENCES_JSON,
  );
  private readonly throttleWindowSeconds = Math.max(
    1,
    Math.ceil(this.throttleWindowMs / 1000),
  );
  private readonly dedupeKeyPrefix = 'notification:generation:dedupe';
  private readonly throttleKeyPrefix = 'notification:generation:throttle';

  private readonly dedupeByUserAndType = new Map<string, number>();
  private readonly throttleByUser = new Map<string, number[]>();
  private readonly entityTypeSet = new Set<string>(Object.values(EntityType));
  private readonly redisClient: Redis | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    private readonly messageService: MessageService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redisClient = this.redisService?.getClient() ?? null;
  }

  async handleReportCreatedEvent(event: ReportCreatedEvent): Promise<void> {
    if (
      !event.payload.shouldProcess ||
      event.payload.report.ragEnabled === false
    ) {
      return;
    }
    try {
      if (
        !isUserVisiblePersistedReportAudience(event.payload.report.audience)
      ) {
        this.logger.debug(
          'Skipping report.created notification generation for internal audience',
          {
            reportId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const reportTitle = event.payload.report.title?.trim();
      if (!reportTitle) {
        this.logger.error(
          'Unable to resolve required report title for report.created notification',
          {
            reportId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const recipients = await this.resolveReportRecipients(event);
      if (recipients.length === 0) {
        this.logger.error(
          'Unable to resolve report notification recipients from linked entities',
          {
            reportId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const sourceEntities = this.resolveReportSourceEntities(event);
      if (sourceEntities.length === 0) {
        this.logger.error(
          'Report notification has no resolvable source entities',
          {
            reportId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const timestamp =
        event.payload.timestamp ??
        event.payload.report.createdAt ??
        new Date().toISOString();
      const notificationPayload = this.extractReportCreatedPayload(
        event.payload.report.payload,
      );

      const candidates = recipients.map((userId) =>
        this.createCandidate({
          userId,
          organizationId: event.payload.organizationId,
          notificationType: 'REPORT_READY',
          priority: 'HIGH',
          sourceEntities,
          preview: {
            title: 'Report ready',
            snippet: `Report ${event.payload.report.reportType} is available.`,
          },
          primaryEntity: {
            type: EntityType.Report,
            id: event.payload.report.id,
            title: reportTitle,
          },
          timestamp,
          correlationReference:
            event.payload.correlationId ??
            event.payload.report.sourceExecutionId ??
            undefined,
          projectId:
            event.payload.projectId ??
            (event.payload.report.projectId as ProjectId | null) ??
            undefined,
          conversationId: event.payload.conversationId ?? undefined,
          notificationEventType: NotificationEventType.ReportCreated,
          reportReferenceId: event.payload.report.id,
          payload: notificationPayload,
        }),
      );

      await this.emitCandidates(candidates);

      const sessionCandidates = await this.buildSessionReportReadyCandidates(
        event,
        reportTitle,
        timestamp,
      );
      if (sessionCandidates.length > 0) {
        await this.emitCandidates(sessionCandidates);
      }
    } catch (error) {
      this.logger.error(
        'Failed to process report.created notification generation',
        {
          error: error instanceof Error ? error.message : String(error),
          reportId: event.aggregateId,
        },
      );
    }
  }

  async handleGitHubWebhookAcceptedEvent(
    event: GitHubWebhookAcceptedEvent,
  ): Promise<void> {
    const { payload } = event;
    const pullRequest = payload.pullRequest;

    if (
      payload.eventName !== 'pull_request' ||
      payload.action !== 'closed' ||
      !pullRequest?.merged ||
      !pullRequest.mergedAt ||
      !pullRequest.mergedByLogin
    ) {
      this.logger.debug(
        'Skipping GitHub webhook notification; delivery is not a merged pull request',
        {
          eventId: event.id,
          inboxId: payload.inboxId,
          eventName: payload.eventName,
          action: payload.action,
          merged: pullRequest?.merged ?? null,
        },
      );
      return;
    }

    try {
      const integration = await this.prisma.db.integration.findFirst({
        where: {
          id: payload.integrationId,
          organizationId: payload.organizationId,
          projectId: payload.projectId,
        },
        select: { createdBy: true },
      });
      const project = await this.prisma.db.project.findFirst({
        where: {
          id: payload.projectId,
          organizationId: payload.organizationId,
        },
        select: { id: true, name: true, createdBy: true },
      });
      const integrationRecipient = this.collectDistinctUserIds(
        integration?.createdBy,
      )[0];

      const recipient =
        integrationRecipient ??
        this.collectDistinctUserIds(project?.createdBy)[0];

      if (!recipient || !project) {
        this.logger.error(
          'Skipping GitHub pull-request merge notification; project or recipient could not be resolved',
          {
            eventId: event.id,
            inboxId: payload.inboxId,
            integrationId: payload.integrationId,
            projectId: payload.projectId,
          },
        );
        return;
      }

      const repositoryName = payload.repository.fullName.trim();
      const artifact = await this.prisma.db.artifact.findFirst({
        where: {
          organizationId: payload.organizationId,
          projectId: payload.projectId,
          type: ArtifactType.DECISION,
          sourceType: ArtifactSourceType.GITHUB_PULL_REQUEST,
          sourceId: `${repositoryName}:${pullRequest.number}`,
        },
        select: {
          id: true,
          title: true,
          taskRelations: {
            where: {
              task: {
                organizationId: payload.organizationId,
                projectId: payload.projectId,
              },
            },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              task: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });

      const linkedTask = artifact?.taskRelations[0]?.task;
      const sourceEntities = this.compactSourceEntities([
        { type: EntityType.Project, id: payload.projectId },
        { type: EntityType.Artifact, id: artifact?.id },
        { type: EntityType.Task, id: linkedTask?.id },
      ]);
      const notificationPayload: PullRequestMergedPayload = {
        repositoryName,
        pullRequestNumber: pullRequest.number,
        pullRequestTitle: pullRequest.title,
        pullRequestUrl: pullRequest.htmlUrl,
        mergedAt: pullRequest.mergedAt,
        actorLogin: pullRequest.mergedByLogin,
        ...(linkedTask?.id ? { taskId: linkedTask.id } : {}),
      };
      const dedupeIdentity = `${payload.inboxId}:${recipient}`;

      const candidate = this.createCandidate({
        notificationId: this.deterministicNotificationId(dedupeIdentity),
        dedupeIdentity,
        userId: recipient,
        organizationId: payload.organizationId,
        notificationType: 'PULL_REQUEST_MERGED',
        priority: 'HIGH',
        sourceEntities,
        preview: {
          title: 'Pull request merged',
          snippet: `${repositoryName} #${pullRequest.number}: ${pullRequest.title}`,
        },
        primaryEntity: {
          type: artifact ? EntityType.Artifact : EntityType.Project,
          id: artifact?.id ?? project.id,
          title: artifact?.title?.trim() || project.name,
        },
        timestamp: pullRequest.mergedAt,
        correlationReference: payload.inboxId,
        projectId: payload.projectId,
        notificationEventType: NotificationEventType.PullRequestMerged,
        payload: notificationPayload,
      });

      this.logger.debug('Emitting GitHub pull-request merge notification', {
        eventId: event.id,
        inboxId: payload.inboxId,
        recipient,
        notificationId: candidate.notificationId,
        projectId: payload.projectId,
        artifactId: artifact?.id ?? null,
        taskId: linkedTask?.id ?? null,
      });
      await this.emitCandidates([candidate]);
    } catch (error) {
      this.logger.error(
        'Failed to process GitHub pull-request merge notification',
        {
          error: error instanceof Error ? error.message : String(error),
          eventId: event.id,
          inboxId: payload.inboxId,
          projectId: payload.projectId,
        },
      );
    }
  }

  async handleTaskStatusChangedEvent(
    event: TaskStatusChangedEvent,
  ): Promise<void> {
    if (event.payload.newStatus !== WorkStatus.Completed) {
      return;
    }

    try {
      const task = await this.prisma.db.task.findFirst({
        where: {
          id: event.aggregateId,
          organizationId: event.payload.organizationId,
        },
        select: {
          assigneeId: true,
          creatorId: true,
          name: true,
        },
      });

      const taskName = task?.name?.trim();
      if (!taskName) {
        this.logger.error(
          'Unable to resolve required task title for task.completed notification',
          {
            taskId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const actorUserId = event.payload.userId;
      const recipients = this.collectDistinctUserIds(
        task?.assigneeId,
        task?.creatorId,
      ).filter((id) => id !== actorUserId);
      if (recipients.length === 0) {
        this.logger.error(
          'Unable to resolve task notification recipients for task.status_changed',
          {
            taskId: event.aggregateId,
            organizationId: event.payload.organizationId,
          },
        );
        return;
      }

      const projectId = event.payload.projectId;
      const timestamp = event.payload.timestamp ?? new Date().toISOString();
      const sourceEntities = this.compactSourceEntities([
        { type: EntityType.Task, id: event.aggregateId },
        { type: EntityType.Initiative, id: event.payload.initiativeId },
      ]);
      const reportReferenceId = await this.resolveLinkedReportReferenceId(
        event.payload.organizationId,
        sourceEntities,
      );

      const candidates = recipients.map((userId) =>
        this.createCandidate({
          userId,
          organizationId: event.payload.organizationId,
          notificationType: 'TASK_STATUS_CHANGED',
          priority: 'HIGH',
          sourceEntities,
          preview: {
            title: 'Task completed',
            snippet: taskName,
          },
          primaryEntity: {
            type: EntityType.Task,
            id: event.aggregateId,
            title: taskName,
          },
          timestamp,
          correlationReference: event.payload.correlationId,
          projectId,
          conversationId: event.payload.conversationId ?? undefined,
          notificationEventType: NotificationEventType.TaskCompleted,
          reportReferenceId: reportReferenceId ?? undefined,
          payload: {
            taskId: event.aggregateId,
            taskName,
            previousStatus: event.payload.previousStatus,
            newStatus: event.payload.newStatus,
          } satisfies TaskCompletedPayload,
        }),
      );

      await this.emitCandidates(candidates);
    } catch (error) {
      this.logger.error(
        'Failed to process task.status_changed notification generation',
        {
          error: error instanceof Error ? error.message : String(error),
          taskId: event.aggregateId,
        },
      );
    }
  }

  async handleAgentSessionStatusChangedEvent(
    event: AgentSessionStatusChangedEvent,
  ): Promise<void> {
    if (event.payload.newStatus === AgentSessionStatus.Completed) {
      this.logger.debug(
        'Skipping agent_session.status_changed notification generation; task.completed is emitted only from task.status_changed',
        {
          agentSessionId: event.aggregateId,
          organizationId: event.payload.organizationId,
        },
      );
    }
    return;
  }

  async handleSystemMessageCreatedEvent(
    event: MessageCreatedEvent,
  ): Promise<void> {
    if (!event.payload.triggerNotification) {
      this.logger.debug(
        'Skipping system message notification without triggerNotification',
        {
          messageId: event.aggregateId,
          conversationId: event.payload.conversationId,
          organizationId: event.payload.organizationId,
        },
      );
      return;
    }

    const organizationId = event.payload.organizationId;
    const conversationId = event.payload.conversationId;
    const projectId = event.payload.projectId;
    const messageId = event.aggregateId;

    this.logger.debug('Processing system message with triggerNotification', {
      messageId,
      organizationId,
      conversationId,
    });

    if (!conversationId) {
      this.logger.error(
        'Missing conversationId for system message notification',
        { messageId, organizationId },
      );
      return;
    }

    try {
      const recipients =
        await this.resolveConversationParticipants(conversationId);
      if (recipients.length === 0) {
        this.logger.error(
          'No conversation participants found for system message notification',
          { messageId, conversationId, organizationId },
        );
        return;
      }

      // The publisher strips message.data from the wire payload; refetch the
      // hydrated record to read body fields (title, response) for the preview.
      const hydratedMessage = await this.messageService.getMessage(
        messageId,
        organizationId,
        false,
      );
      const messageData =
        hydratedMessage?.data && typeof hydratedMessage.data === 'object'
          ? (hydratedMessage.data as SystemMessageData)
          : undefined;
      if (!messageData) {
        this.logger.warn(
          'System message body unavailable while building notification preview',
          { messageId, organizationId, conversationId },
        );
        return;
      }

      const timestamp = event.payload.timestamp ?? new Date().toISOString();
      const title = messageData.title ?? 'New message';
      const rawSnippet = messageData.response ?? '';
      const snippet =
        rawSnippet.length > 200 ? rawSnippet.slice(0, 200) + '...' : rawSnippet;

      const navigationContext = await this.resolveConversationNavigationContext(
        conversationId,
        organizationId,
      );

      this.logger.debug(
        'Resolved navigation context for system message notification',
        {
          messageId,
          conversationId,
          organizationId,
          navigationContext,
        },
      );

      const candidates = recipients.map((userId) =>
        this.createCandidate({
          userId,
          organizationId,
          notificationType: 'SYSTEM_MESSAGE',
          priority: 'MEDIUM',
          sourceEntities: this.compactSourceEntities([
            { type: EntityType.Message, id: messageId },
            { type: EntityType.Conversation, id: conversationId },
          ]),
          preview: {
            title,
            snippet,
          },
          primaryEntity: {
            type: EntityType.Conversation,
            id: conversationId,
            title,
          },
          timestamp,
          correlationReference: event.payload.correlationId,
          projectId,
          conversationId,
          notificationEventType: NotificationEventType.SystemMessage,
          payload: {
            messageId,
            conversationId,
            title,
            snippet,
            ...navigationContext,
          } satisfies SystemMessagePayload,
        }),
      );

      await this.emitCandidates(candidates);
    } catch (error) {
      this.logger.error(
        'Failed to process system message notification generation',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: event.aggregateId,
        },
      );
    }
  }

  /**
   * SESSION_MONITOR pipeline: a SYSTEM message authored by the CLI
   * session-monitor agent identity carries a terminal `outcome` for the
   * report it consumed. Unlike `handleSystemMessageCreatedEvent` this hook
   * does NOT gate on `triggerNotification` — the outcome itself selects the
   * notification. Executable continuation is owned exclusively by the typed
   * Session Monitor decision admission endpoint; this message is evidence.
   * Malformed monitor messages are rejected at zod-validation time before
   * any notification or enactment fires.
   */
  async handleSessionMonitorMessageEvent(
    event: MessageCreatedEvent,
  ): Promise<void> {
    if (event.payload.messageDataType !== 'SESSION_MONITOR') {
      return;
    }

    const messageId = event.aggregateId as MessageId;
    const organizationId = event.payload.organizationId;
    const conversationId = event.payload.conversationId;
    const projectId = event.payload.projectId;

    if (!conversationId) {
      this.logger.error(
        'Missing conversationId on SESSION_MONITOR system message event',
        { messageId, organizationId },
      );
      return;
    }

    const hydrated = await this.messageService.getMessage(
      messageId,
      organizationId,
      false,
    );

    if (!hydrated || hydrated.type !== 'SYSTEM') {
      this.logger.error(
        'SESSION_MONITOR message not found or not a SYSTEM message at handler dispatch',
        {
          messageId,
          organizationId,
          found: !!hydrated,
          type: hydrated?.type,
        },
      );
      return;
    }

    const parsed = sessionMonitorSystemMessageDataSchema.safeParse(
      hydrated.data,
    );
    if (!parsed.success) {
      this.logger.error('Rejecting malformed SESSION_MONITOR system message', {
        messageId,
        conversationId,
        organizationId,
        issues: parsed.error.issues,
      });
      await this.recordSessionMonitorHookFailure({
        messageId,
        organizationId,
        conversationId,
        projectId,
        outcome: undefined,
        reason: 'schema_validation_failed',
        detail: parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          )
          .join('; '),
      });
      return;
    }

    const validated = parsed.data as SessionMonitorSystemMessageData;

    this.logger.debug('Processing SESSION_MONITOR system message', {
      messageId,
      organizationId,
      conversationId,
      state: validated.state ?? SessionMonitorMessageState.Decision,
      outcome: validated.outcome ?? null,
      reportId: validated.reportId ?? null,
    });

    if (validated.state === SessionMonitorMessageState.Evaluating) {
      this.logger.debug('SESSION_MONITOR evaluating message acknowledged', {
        messageId,
        organizationId,
        conversationId,
        reportId: validated.reportId ?? null,
      });
      return;
    }

    try {
      await this.emitSessionMonitorNotification(
        event,
        validated,
        messageId,
        conversationId,
        organizationId,
        projectId,
      );
    } catch (error) {
      this.logger.error('SESSION_MONITOR notification emission failed', {
        messageId,
        conversationId,
        organizationId,
        outcome: validated.outcome,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.recordSessionMonitorHookFailure({
        messageId,
        organizationId,
        conversationId,
        projectId,
        outcome: validated.outcome,
        reason: 'notification_emission_failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async emitSessionMonitorNotification(
    event: MessageCreatedEvent,
    validated: SessionMonitorSystemMessageData,
    messageId: MessageId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    projectId: ProjectId | undefined,
  ): Promise<void> {
    const session = await this.resolveAgentSessionForConversation(
      conversationId,
      organizationId,
    );

    if (!session) {
      this.logger.error(
        'No agent session found for SESSION_MONITOR conversation; skipping notification',
        { messageId, conversationId, organizationId },
      );
      return;
    }

    if (!this.isUserId(session.userId)) {
      this.logger.error(
        'Agent session attached to SESSION_MONITOR conversation has no valid userId',
        { messageId, conversationId, agentSessionId: session.id },
      );
      return;
    }

    const sessionTitle = session.title?.trim() || 'Coding session';
    const reportId = validated.reportId;
    const isContinued = validated.outcome === SessionMonitorOutcome.Continued;

    const sourceEntities = this.compactSourceEntities(
      [
        { type: EntityType.AgentSession, id: session.id },
        { type: EntityType.Message, id: messageId },
        { type: EntityType.Conversation, id: conversationId },
        reportId ? { type: EntityType.Report, id: reportId } : null,
      ].filter(
        (entity): entity is { type: EntityType; id: string } => !!entity,
      ),
    );

    const timestamp = event.payload.timestamp ?? new Date().toISOString();
    const preview = isContinued
      ? {
          title: 'Session continued automatically',
          snippet: this.truncateSnippet(validated.content, 200),
        }
      : {
          title: 'Session review needed',
          snippet: this.truncateSnippet(validated.content, 200),
        };

    const payload = reportId
      ? isContinued
        ? ({
            sessionId: session.id,
            reportId,
          } satisfies SessionAutoDecidedPayload)
        : ({
            sessionId: session.id,
            reportId,
          } satisfies SessionReviewNeededPayload)
      : null;

    if (!payload) {
      this.logger.error(
        'SESSION_MONITOR notification payload requires reportId; skipping emission',
        {
          messageId,
          conversationId,
          organizationId,
          outcome: validated.outcome,
        },
      );
      return;
    }

    const candidate = this.createCandidate({
      userId: session.userId as UserId,
      organizationId,
      notificationType: isContinued
        ? 'SESSION_AUTO_DECIDED'
        : 'SESSION_REVIEW_NEEDED',
      priority: isContinued ? 'MEDIUM' : 'HIGH',
      sourceEntities,
      preview,
      primaryEntity: {
        type: EntityType.AgentSession,
        id: session.id,
        title: sessionTitle,
      },
      timestamp,
      correlationReference: event.payload.correlationId,
      projectId,
      conversationId,
      notificationEventType: isContinued
        ? NotificationEventType.SessionAutoDecided
        : NotificationEventType.SessionReviewNeeded,
      reportReferenceId: reportId,
      payload,
    });

    await this.emitCandidates([candidate]);
  }

  private async resolveAgentSessionForConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<{
    id: string;
    userId: string;
    title: string | null;
  } | null> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: { conversationId, organizationId },
      select: { id: true, userId: true, title: true },
      orderBy: { createdAt: 'desc' },
    });
    return session ?? null;
  }

  private truncateSnippet(value: string, max: number): string {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  private async recordSessionMonitorHookFailure(params: {
    messageId: MessageId;
    organizationId: OrganizationId;
    conversationId: ConversationId | null | undefined;
    projectId: ProjectId | undefined;
    outcome: SessionMonitorOutcome | undefined;
    reason: string;
    detail: string;
  }): Promise<void> {
    if (!params.conversationId || !params.projectId) {
      this.logger.error(
        'SESSION_MONITOR hook failure observability message skipped — missing conversationId/projectId',
        {
          messageId: params.messageId,
          reason: params.reason,
          detail: params.detail,
        },
      );
      return;
    }

    try {
      const data: SystemMessageData = {
        type: SystemMessageData.TypeEnum.Error,
        response: `session-monitor hook failed (${params.reason}): ${params.detail}`,
        title: 'Session monitor hook error',
        triggerNotification: false,
      };

      await this.messageService.addMessage(
        {
          type: 'SYSTEM',
          projectId: params.projectId,
          conversationId: params.conversationId,
          parentMessageId: params.messageId,
          data,
        },
        params.organizationId,
        'session-monitor-hook-failure',
      );
    } catch (writeError) {
      this.logger.error(
        'Failed to write SESSION_MONITOR hook failure observability message',
        {
          messageId: params.messageId,
          conversationId: params.conversationId,
          reason: params.reason,
          writeError:
            writeError instanceof Error
              ? writeError.message
              : String(writeError),
        },
      );
    }
  }

  private async resolveConversationParticipants(
    conversationId: ConversationId,
  ): Promise<UserId[]> {
    const conversation = await this.prisma.db.conversation.findUnique({
      where: { id: conversationId },
      select: { createdBy: true },
    });
    const authors = await this.prisma.db.message.groupBy({
      by: ['userId'],
      where: {
        conversationId,
        type: 'USER',
      },
    });

    return this.collectDistinctUserIds(
      conversation?.createdBy,
      ...authors.map((author) => author.userId),
    );
  }

  private async resolveConversationNavigationContext(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<
    Pick<
      SystemMessagePayload,
      'aboutType' | 'aboutId' | 'planId' | 'initiativeId'
    >
  > {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: {
        workflowAboutType: true,
        workflowAboutId: true,
      },
    });

    this.logger.debug('Conversation workflow lookup result', {
      conversationId,
      organizationId,
      workflowAboutType: conversation?.workflowAboutType ?? null,
      workflowAboutId: conversation?.workflowAboutId ?? null,
    });

    if (!conversation?.workflowAboutType || !conversation.workflowAboutId) {
      this.logger.debug(
        'No workflowAboutType/workflowAboutId on conversation; returning empty navigation context',
        { conversationId, organizationId },
      );
      return {};
    }

    // workflowAboutType uses lowercase WorkflowAboutType values
    // ('task', 'initiative', 'design-doc', etc.) from src/types.ts,
    // not the uppercase Prisma EntityType enum.
    const result: Pick<
      SystemMessagePayload,
      'aboutType' | 'aboutId' | 'planId' | 'initiativeId'
    > = {
      aboutType: conversation.workflowAboutType,
      aboutId: conversation.workflowAboutId,
    };

    if (conversation.workflowAboutType === 'task') {
      const task = await this.prisma.db.task.findFirst({
        where: { id: conversation.workflowAboutId, organizationId },
        select: { initiativeId: true },
      });
      if (task?.initiativeId) result.initiativeId = task.initiativeId;
      const planId = await resolveAncestorPlanWorkItem(
        this.prisma.db,
        organizationId,
        conversation.workflowAboutId,
      );
      if (planId) result.planId = planId;
    }

    if (conversation.workflowAboutType === 'agent-session') {
      const agentSession = await this.prisma.db.agentSession.findFirst({
        where: {
          id: conversation.workflowAboutId,
          organizationId,
        },
        select: { entityType: true, entityId: true },
      });

      const sessionTaskId =
        agentSession?.entityType === 'TASK' ? agentSession.entityId : null;
      const sessionInitiativeId =
        agentSession?.entityType === 'INITIATIVE'
          ? agentSession.entityId
          : null;

      this.logger.debug('Agent-session navigation context lookup', {
        conversationId,
        agentSessionId: conversation.workflowAboutId,
        agentSessionFound: !!agentSession,
        entityType: agentSession?.entityType ?? null,
        entityId: agentSession?.entityId ?? null,
      });

      if (sessionTaskId) {
        result.aboutType = 'task';
        result.aboutId = sessionTaskId;

        const task = await this.prisma.db.task.findFirst({
          where: { id: sessionTaskId, organizationId },
          select: { initiativeId: true },
        });
        if (task?.initiativeId) {
          result.initiativeId = task.initiativeId;
        }

        const planId = await resolveAncestorPlanWorkItem(
          this.prisma.db,
          organizationId,
          sessionTaskId,
        );
        if (planId) result.planId = planId;
      } else if (sessionInitiativeId) {
        result.aboutType = 'initiative';
        result.aboutId = sessionInitiativeId;
        result.initiativeId = sessionInitiativeId;

        this.logger.debug(
          'Agent-session resolved to initiative (no task link)',
          {
            conversationId,
            agentSessionId: conversation.workflowAboutId,
            initiativeId: sessionInitiativeId,
          },
        );
      } else {
        this.logger.warn(
          'Agent-session has no TASK or INITIATIVE about-target; navigation context will lack plan context',
          {
            conversationId,
            agentSessionId: conversation.workflowAboutId,
            entityType: agentSession?.entityType ?? null,
          },
        );
      }
    }

    this.logger.debug('Final resolved navigation context', {
      conversationId,
      organizationId,
      workflowAboutType: conversation.workflowAboutType,
      result,
    });

    return result;
  }

  private async emitCandidates(
    candidates: NotificationCandidate[],
  ): Promise<void> {
    for (const candidate of candidates) {
      try {
        await this.emitCandidate(candidate);
      } catch (error) {
        this.logger.error('Failed to emit notification candidate', {
          error: error instanceof Error ? error.message : String(error),
          userId: candidate.userId,
          notificationType: candidate.notificationType,
          notificationId: candidate.notificationId,
        });
      }
    }
  }

  private async emitCandidate(candidate: NotificationCandidate): Promise<void> {
    const nowMs = Date.now();
    if (!this.redisClient) {
      this.expireTrackingEntries(nowMs);
    }

    if (!this.isPreferenceEnabled(candidate)) {
      this.logger.debug('Notification suppressed by user preferences', {
        userId: candidate.userId,
        notificationType: candidate.notificationType,
      });
      return;
    }

    if (await this.reserveDedupe(candidate, nowMs)) {
      this.logger.debug('Notification deduplicated', {
        userId: candidate.userId,
        notificationType: candidate.notificationType,
      });
      return;
    }

    if (await this.isThrottled(candidate.userId, nowMs)) {
      this.logger.warn('Notification throttled for user', {
        userId: candidate.userId,
        throttleWindowMs: this.throttleWindowMs,
        throttleLimit: this.throttleLimitPerUser,
      });
      await this.releaseDedupeReservation(candidate);
      return;
    }

    try {
      const event = this.toSystemNotificationEvent(candidate);
      await this.eventPublisher.publish(event);
      await this.recordEmission(candidate, nowMs);
      this.logger.debug('Notification emitted successfully', {
        notificationId: candidate.notificationId,
        userId: candidate.userId,
        notificationType: candidate.notificationType,
      });
    } catch (error) {
      await this.releaseDedupeReservation(candidate);
      throw error;
    }
  }

  private toSystemNotificationEvent(
    candidate: NotificationCandidate,
  ): Omit<SystemNotificationEvent, 'id'> {
    const payload: SystemNotificationEvent['payload'] = {
      organizationId: candidate.organizationId,
      ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
      ...(candidate.conversationId
        ? { conversationId: candidate.conversationId }
        : {}),
      userId: candidate.userId,
      timestamp: candidate.timestamp,
      ...(candidate.correlationReference
        ? { correlationId: candidate.correlationReference }
        : {}),
      ...(candidate.reportReferenceId
        ? { reportId: candidate.reportReferenceId }
        : {}),
      notification: this.toNotificationDto(candidate),
      delivery: this.toDeliveryMetadata(candidate.timestamp),
      clientHints: this.toClientHints(candidate.priority),
      message: `${candidate.preview.title}: ${candidate.preview.snippet}`,
      severity: this.toSeverity(candidate.priority),
    };

    return {
      type: EVENT_TYPES.SYSTEM.NOTIFICATION,
      aggregateId: candidate.notificationId,
      payload,
    };
  }

  private toNotificationDto(candidate: NotificationCandidate): NotificationDto {
    const base = {
      id: candidate.notificationId,
      entityId: candidate.primaryEntity.id,
      entityType: candidate.primaryEntity.type,
      entityTitle: candidate.primaryEntity.title,
      affectedEntities: this.toAffectedEntityRefs(
        candidate.primaryEntity,
        candidate.sourceEntities,
      ),
      createdAt: candidate.timestamp,
      status: NotificationStatus.Unread,
    };

    switch (candidate.notificationEventType) {
      case NotificationEventType.ReportCreated: {
        const evt = ReportCreatedNotificationDto.EventTypeEnum.ReportCreated;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as ReportCreatedPayload,
        };
      }
      case NotificationEventType.TaskCompleted: {
        const evt = TaskCompletedNotificationDto.EventTypeEnum.TaskCompleted;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as TaskCompletedPayload,
        };
      }
      case NotificationEventType.ChildUnblocked: {
        const evt = ChildUnblockedNotificationDto.EventTypeEnum.ChildUnblocked;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as ChildUnblockedPayload,
        };
      }
      case NotificationEventType.SystemMessage: {
        const evt = SystemMessageNotificationDto.EventTypeEnum.SystemMessage;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as SystemMessagePayload,
        };
      }
      case NotificationEventType.SessionReportReady: {
        const evt =
          SessionReportReadyNotificationDto.EventTypeEnum.SessionReportReady;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as SessionReportReadyPayload,
        };
      }
      case NotificationEventType.SessionAutoDecided: {
        const evt =
          SessionAutoDecidedNotificationDto.EventTypeEnum.SessionAutoDecided;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as SessionAutoDecidedPayload,
        };
      }
      case NotificationEventType.SessionReviewNeeded: {
        const evt =
          SessionReviewNeededNotificationDto.EventTypeEnum.SessionReviewNeeded;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as SessionReviewNeededPayload,
        };
      }
      case NotificationEventType.PullRequestMerged: {
        const evt =
          PullRequestMergedNotificationDto.EventTypeEnum.PullRequestMerged;
        return {
          ...base,
          eventType: evt,
          payload: candidate.payload as PullRequestMergedPayload,
        };
      }
      default:
        throw new Error(
          `Unsupported notification event type for DTO mapping: ${candidate.notificationEventType}`,
        );
    }
  }

  private toDeliveryMetadata(
    deliveredAt: string,
  ): NotificationDeliveryMetadata {
    return {
      channel: NotificationChannel.InApp,
      transport: NotificationDeliveryMetadata.TransportEnum.Websocket,
      deliveredAt,
      attempt: 1,
    };
  }

  private toClientHints(
    priority: NotificationPriority,
  ): NotificationClientHandlingHints {
    return {
      shouldToast: true,
      shouldBadge: true,
      dismissible: true,
      priority:
        priority === 'HIGH'
          ? NotificationClientHandlingHints.PriorityEnum.High
          : NotificationClientHandlingHints.PriorityEnum.Normal,
    };
  }

  private toSeverity(
    priority: NotificationPriority,
  ): SystemNotificationEvent['payload']['severity'] {
    if (priority === 'HIGH') {
      return 'warning';
    }
    return 'info';
  }

  private toAffectedEntityRefs(
    primaryEntity: { type: EntityType; id: string },
    sourceEntities: Array<{ type: EntityType; id: string }>,
  ): NotificationAffectedEntityRef[] {
    const normalized = this.compactSourceEntities([
      primaryEntity,
      ...sourceEntities,
    ]);

    return normalized.map((entity) => ({
      id: entity.id,
      type: entity.type,
    }));
  }

  private async resolveReportRecipients(
    event: ReportCreatedEvent,
  ): Promise<UserId[]> {
    const recipients = new Set<UserId>(
      this.collectDistinctUserIds(event.payload.userId),
    );

    for (const entity of event.payload.report.entities) {
      const resolved = await this.resolveUsersForReportEntity(
        event.payload.organizationId,
        entity.entityType,
        entity.entityId,
      );
      resolved.forEach((userId) => recipients.add(userId));
    }

    return Array.from(recipients);
  }

  private async resolveUsersForReportEntity(
    organizationId: OrganizationId,
    entityType: string,
    entityId: string,
  ): Promise<UserId[]> {
    switch (entityType) {
      case EntityType.Task: {
        const task = await this.prisma.db.task.findFirst({
          where: { id: entityId, organizationId },
          select: { assigneeId: true, creatorId: true },
        });
        return this.collectDistinctUserIds(task?.assigneeId, task?.creatorId);
      }
      case EntityType.Initiative: {
        const initiative = await this.prisma.db.initiative.findFirst({
          where: { id: entityId, organizationId },
          select: { assigneeId: true },
        });
        return this.collectDistinctUserIds(initiative?.assigneeId);
      }
      case EntityType.Project: {
        const project = await this.prisma.db.project.findFirst({
          where: { id: entityId, organizationId },
          select: { createdBy: true },
        });
        return this.collectDistinctUserIds(project?.createdBy);
      }
      case EntityType.AgentSession: {
        const agentSession = await this.prisma.db.agentSession.findFirst({
          where: { id: entityId, organizationId },
          select: { userId: true },
        });
        return this.collectDistinctUserIds(agentSession?.userId);
      }
      case EntityType.Message: {
        const message = await this.prisma.db.message.findFirst({
          where: {
            id: entityId,
            conversation: { organizationId },
          },
          select: { userId: true },
        });
        return this.collectDistinctUserIds(message?.userId);
      }
      case EntityType.Conversation: {
        const conversation = await this.prisma.db.conversation.findFirst({
          where: { id: entityId, organizationId },
          select: { lastModifiedBy: true },
        });
        return this.collectDistinctUserIds(conversation?.lastModifiedBy);
      }
      case EntityType.DesignDoc: {
        const designDoc = await this.prisma.db.designDoc.findFirst({
          where: { id: entityId, organizationId },
          select: {
            project: {
              select: { createdBy: true },
            },
          },
        });
        return this.collectDistinctUserIds(designDoc?.project?.createdBy);
      }
      default:
        return [];
    }
  }

  private async buildSessionReportReadyCandidates(
    event: ReportCreatedEvent,
    reportTitle: string,
    timestamp: string,
  ): Promise<NotificationCandidate[]> {
    if (!isUserVisiblePersistedReportAudience(event.payload.report.audience)) {
      this.logger.debug(
        'Skipping session_report_ready candidates; report audience is not user-visible',
        {
          reportId: event.aggregateId,
          organizationId: event.payload.organizationId,
          audience: event.payload.report.audience,
        },
      );
      return [];
    }

    const agentSessionEntityIds = event.payload.report.entities
      .filter((entity) => entity.entityType === EntityType.AgentSession)
      .map((entity) => entity.entityId);

    if (agentSessionEntityIds.length === 0) {
      return [];
    }

    const candidates: NotificationCandidate[] = [];

    for (const agentSessionId of agentSessionEntityIds) {
      const agentSession = await this.prisma.db.agentSession.findFirst({
        where: {
          id: agentSessionId,
          organizationId: event.payload.organizationId,
        },
        select: {
          id: true,
          userId: true,
          title: true,
          monitoringEnabled: true,
          autoDecide: true,
        },
      });

      if (!agentSession) {
        this.logger.debug(
          'Skipping session_report_ready candidate; agent session not found',
          {
            agentSessionId,
            organizationId: event.payload.organizationId,
          },
        );
        continue;
      }

      if (agentSession.autoDecide) {
        this.logger.debug(
          'Skipping session_report_ready candidate; auto-decide enabled for session',
          {
            agentSessionId,
            organizationId: event.payload.organizationId,
          },
        );
        continue;
      }

      if (!agentSession.monitoringEnabled) {
        this.logger.debug(
          'Skipping session_report_ready candidate; monitoring disabled for session',
          {
            agentSessionId,
            organizationId: event.payload.organizationId,
          },
        );
        continue;
      }

      if (!this.isUserId(agentSession.userId)) {
        this.logger.error(
          'Unable to resolve session_report_ready recipient; agent session has no valid userId',
          {
            agentSessionId,
            organizationId: event.payload.organizationId,
          },
        );
        continue;
      }

      const sessionTitle = agentSession.title?.trim();
      if (!sessionTitle) {
        this.logger.error(
          'Unable to resolve session_report_ready session title for monitored session',
          {
            agentSessionId,
            organizationId: event.payload.organizationId,
          },
        );
        continue;
      }

      const sourceEntities = this.compactSourceEntities([
        { type: EntityType.AgentSession, id: agentSessionId },
        { type: EntityType.Report, id: event.payload.report.id },
      ]);

      const sessionPayload: SessionReportReadyPayload = {
        sessionId: agentSessionId,
        reportId: event.payload.report.id,
        reportType: event.payload.report.reportType,
        sessionTitle,
        reportTitle,
      };

      candidates.push(
        this.createCandidate({
          userId: agentSession.userId as UserId,
          organizationId: event.payload.organizationId,
          notificationType: 'SESSION_REPORT_READY',
          priority: 'HIGH',
          sourceEntities,
          preview: {
            title: 'Session report ready',
            snippet: `${sessionTitle}: ${reportTitle}`,
          },
          primaryEntity: {
            type: EntityType.AgentSession,
            id: agentSessionId,
            title: sessionTitle,
          },
          timestamp,
          correlationReference:
            event.payload.correlationId ??
            event.payload.report.sourceExecutionId ??
            undefined,
          projectId:
            event.payload.projectId ??
            (event.payload.report.projectId as ProjectId | null) ??
            undefined,
          conversationId: event.payload.conversationId ?? undefined,
          notificationEventType: NotificationEventType.SessionReportReady,
          reportReferenceId: event.payload.report.id,
          payload: sessionPayload,
        }),
      );
    }

    return candidates;
  }

  private resolveReportSourceEntities(
    event: ReportCreatedEvent,
  ): Array<{ type: EntityType; id: string }> {
    return this.compactSourceEntities(
      event.payload.report.entities
        .filter((entity) => this.isEntityType(entity.entityType))
        .map((entity) => ({
          type: entity.entityType as EntityType,
          id: entity.entityId,
        })),
    );
  }

  private extractReportCreatedPayload(
    reportPayload: Record<string, unknown>,
  ): ReportCreatedPayload {
    return {
      nextSteps: this.asObjectArray<ReportNextStepItem>(
        reportPayload.nextSteps,
      ),
      verificationTasks: this.asObjectArray<ReportVerificationTaskItem>(
        reportPayload.verificationTasks,
      ),
      recommendedUpdates: this.asObjectArray<ReportRecommendedUpdateItem>(
        reportPayload.recommendedUpdates,
      ),
    };
  }

  private asObjectArray<T extends object>(value: unknown): T[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (entry): entry is T => typeof entry === 'object' && entry !== null,
    );
  }

  private collectDistinctUserIds(
    ...userCandidates: Array<string | undefined | null>
  ): UserId[] {
    const unique = new Set<UserId>();
    userCandidates.forEach((candidate) => {
      if (!this.isUserId(candidate)) {
        return;
      }
      unique.add(candidate);
    });
    return Array.from(unique);
  }

  private isUserId(candidate: string | undefined | null): candidate is UserId {
    if (!candidate) {
      return false;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      candidate,
    );
  }

  private compactSourceEntities(
    sourceEntities: Array<{ type: EntityType; id?: string | null }>,
  ): Array<{ type: EntityType; id: string }> {
    const seen = new Set<string>();
    const compacted: Array<{ type: EntityType; id: string }> = [];

    sourceEntities.forEach((entity) => {
      if (!entity.id) {
        return;
      }
      const key = `${entity.type}:${entity.id}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      compacted.push({
        type: entity.type,
        id: entity.id,
      });
    });

    return compacted;
  }

  private isEntityType(value: string): value is EntityType {
    return this.entityTypeSet.has(value);
  }

  private createCandidate(
    base: Omit<NotificationCandidate, 'notificationId'> & {
      notificationId?: string;
    },
  ): NotificationCandidate {
    const { notificationId, ...candidate } = base;
    return {
      notificationId: notificationId ?? uuidv4(),
      ...candidate,
    };
  }

  private deterministicNotificationId(seed: string): string {
    const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private isPreferenceEnabled(candidate: NotificationCandidate): boolean {
    if (!this.preferenceMap) {
      return true;
    }

    const userPreferences = this.preferenceMap[candidate.userId];
    if (!userPreferences) {
      if (this.requirePreferenceCoverage) {
        throw new Error(
          `Notification preferences missing for user ${candidate.userId}`,
        );
      }
      return true;
    }

    const enabled = userPreferences[candidate.notificationType];
    if (enabled === undefined) {
      if (this.requirePreferenceCoverage) {
        throw new Error(
          `Notification preference missing for type ${candidate.notificationType} and user ${candidate.userId}`,
        );
      }
      return true;
    }

    return enabled;
  }

  private async reserveDedupe(
    candidate: NotificationCandidate,
    nowMs: number,
  ): Promise<boolean> {
    const storageKey = this.dedupeStorageKey(candidate);
    if (this.redisClient) {
      const reserved = await this.redisClient.set(
        storageKey,
        String(nowMs),
        'PX',
        this.dedupeWindowMs,
        'NX',
      );
      return reserved !== 'OK';
    }

    const inMemoryKey = this.dedupeKey(candidate);
    const lastPublishedAt = this.dedupeByUserAndType.get(inMemoryKey);
    if (lastPublishedAt === undefined) {
      this.dedupeByUserAndType.set(inMemoryKey, nowMs);
      return false;
    }
    if (nowMs - lastPublishedAt < this.dedupeWindowMs) {
      return true;
    }
    this.dedupeByUserAndType.set(inMemoryKey, nowMs);
    return false;
  }

  private async isThrottled(userId: UserId, nowMs: number): Promise<boolean> {
    if (this.redisClient) {
      const key = this.throttleStorageKey(userId, nowMs);
      const raw = await this.redisClient.get(key);
      const current = raw ? Number.parseInt(raw, 10) : 0;
      return current >= this.throttleLimitPerUser;
    }

    const existing = this.throttleByUser.get(userId) ?? [];
    const windowed = existing.filter(
      (ts) => nowMs - ts < this.throttleWindowMs,
    );
    this.throttleByUser.set(userId, windowed);
    return windowed.length >= this.throttleLimitPerUser;
  }

  private async recordEmission(
    candidate: NotificationCandidate,
    nowMs: number,
  ): Promise<void> {
    if (this.redisClient) {
      const key = this.throttleStorageKey(candidate.userId, nowMs);
      const updated = await this.redisClient.incr(key);
      if (updated === 1) {
        await this.redisClient.expire(key, this.throttleWindowSeconds);
      }
      return;
    }

    const existing = this.throttleByUser.get(candidate.userId) ?? [];
    existing.push(nowMs);
    this.throttleByUser.set(candidate.userId, existing);
  }

  private async releaseDedupeReservation(
    candidate: NotificationCandidate,
  ): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.del(this.dedupeStorageKey(candidate));
      return;
    }
    this.dedupeByUserAndType.delete(this.dedupeKey(candidate));
  }

  private expireTrackingEntries(nowMs: number): void {
    this.dedupeByUserAndType.forEach((lastPublishedAt, key) => {
      if (nowMs - lastPublishedAt >= this.dedupeWindowMs) {
        this.dedupeByUserAndType.delete(key);
      }
    });

    this.throttleByUser.forEach((timestamps, userId) => {
      const active = timestamps.filter(
        (ts) => nowMs - ts < this.throttleWindowMs,
      );
      if (active.length === 0) {
        this.throttleByUser.delete(userId);
        return;
      }
      this.throttleByUser.set(userId, active);
    });
  }

  private dedupeKey(candidate: NotificationCandidate): string {
    return [
      candidate.userId,
      candidate.notificationType,
      candidate.dedupeIdentity,
    ]
      .filter(Boolean)
      .join(':');
  }

  private dedupeStorageKey(candidate: NotificationCandidate): string {
    return `${this.dedupeKeyPrefix}:${this.dedupeKey(candidate)}`;
  }

  private throttleStorageKey(userId: UserId, nowMs: number): string {
    const bucket = Math.floor(nowMs / this.throttleWindowMs);
    return `${this.throttleKeyPrefix}:${userId}:${bucket}`;
  }

  private async resolveLinkedReportReferenceId(
    organizationId: OrganizationId,
    sourceEntities: Array<{ type: EntityType; id: string }>,
  ): Promise<string | null> {
    const sourceEntityIds = sourceEntities.map((entity) => entity.id);
    if (sourceEntityIds.length === 0) {
      return null;
    }

    const linked = await this.prisma.db.report.findFirst({
      where: {
        organizationId,
        reportEntities: {
          some: {
            entityId: {
              in: sourceEntityIds,
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
      },
    });

    return linked?.id ?? null;
  }

  private parsePreferenceMap(
    raw: string | undefined,
  ): NotificationPreferenceMap | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Preference JSON must be an object keyed by userId');
      }

      const normalized: NotificationPreferenceMap = {};
      Object.entries(parsed as Record<string, unknown>).forEach(
        ([userId, rawValue]) => {
          if (typeof rawValue !== 'object' || rawValue === null) {
            return;
          }

          const typed: NotificationPreferenceFlags = {};
          Object.entries(rawValue as Record<string, unknown>).forEach(
            ([preferenceType, enabled]) => {
              if (!this.isStandardizedNotificationType(preferenceType)) {
                return;
              }
              if (typeof enabled !== 'boolean') {
                return;
              }
              typed[preferenceType] = enabled;
            },
          );

          normalized[userId] = typed;
        },
      );

      return normalized;
    } catch (error) {
      this.logger.error(
        'Failed to parse NOTIFICATION_USER_PREFERENCES_JSON; preference filtering disabled',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }

    return parsed;
  }

  private isStandardizedNotificationType(
    value: string,
  ): value is StandardizedNotificationType {
    return PREFERENCE_TYPE_VALUES.has(value as StandardizedNotificationType);
  }
}
