import { ProjectAccessService } from '../../auth/services/project-access.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityType as PrismaEntityType,
  NotificationDeliveryOutcome,
  NotificationStatus as PrismaNotificationStatus,
  Prisma,
} from '@prisma/client';
import {
  ChildUnblockedNotificationDto,
  ChildUnblockedPayload,
  EntityType,
  NotificationAffectedEntityRef,
  NotificationChannel,
  NotificationChannelSubscription,
  NotificationClientHandlingHints,
  NotificationDeliveryMetadata,
  NotificationDto,
  NotificationEventType,
  NotificationPreferencesDto,
  NotificationStatus,
  PullRequestMergedNotificationDto,
  PullRequestMergedPayload,
  ReportCreatedNotificationDto,
  ReportCreatedPayload,
  ReportType,
  SessionReportReadyNotificationDto,
  SessionReportReadyPayload,
  SystemMessageNotificationDto,
  SystemMessagePayload,
  TaskCompletedNotificationDto,
  TaskCompletedPayload,
  UpdateNotificationPreferencesDto,
  WebSocketSystemNotificationEvent,
  WorkStatus,
} from 'src/generated';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import {
  SystemNotificationEvent,
  SystemNotificationEventPayload,
} from 'src/core/events/types/domain-events';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { WebsocketGateway } from 'src/core/websockets/websocket.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConversationId, OrganizationId, ProjectId, UserId } from 'src/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_MAX_DELIVERY_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 200;

const NOTIFICATION_EVENT_TYPES = new Set<string>(
  Object.values(NotificationEventType),
);
const NOTIFICATION_CHANNELS = new Set<string>(
  Object.values(NotificationChannel),
);
const NOTIFICATION_STATUS_SET = new Set<string>(
  Object.values(NotificationStatus),
);

type NotificationRecord = Prisma.NotificationGetPayload<Record<string, never>>;

type ListNotificationsInput = {
  organizationId: OrganizationId;
  actorUserId: UserId;
  userId?: UserId;
  eventTypes?: NotificationEventType[];
  status?: NotificationStatus;
  channel?: NotificationChannel;
  includeDismissed?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
};

type DeliveryMetricsSnapshot = {
  successCount: number;
  failureCount: number;
  retryCount: number;
  suppressedCount: number;
  averageLatencyMs: number;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly maxDeliveryRetries = this.parsePositiveInt(
    process.env.NOTIFICATION_DELIVERY_MAX_RETRIES,
    DEFAULT_MAX_DELIVERY_RETRIES,
  );
  private readonly baseBackoffMs = this.parsePositiveInt(
    process.env.NOTIFICATION_DELIVERY_BASE_BACKOFF_MS,
    DEFAULT_BASE_BACKOFF_MS,
  );

  private successCount = 0;
  private failureCount = 0;
  private retryCount = 0;
  private suppressedCount = 0;
  private latencyAccumulatorMs = 0;

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async handleSystemNotificationEvent(
    event: SystemNotificationEvent,
  ): Promise<void> {
    const startedAtMs = Date.now();
    const parsed = await this.validateIncomingEvent(event);
    if (!parsed) {
      return;
    }

    const {
      organizationId,
      userId,
      notification,
      delivery,
      clientHints,
      message,
      severity,
      timestamp,
      projectId,
      conversationId,
      correlationId,
      reportId,
    } = parsed;

    const missingEntityError = await this.resolveMissingLinkedEntityError(
      organizationId,
      notification,
    );

    const persisted = await this.persistNotificationFromEvent({
      organizationId,
      userId,
      reportReferenceId: reportId,
      notification,
      correlationId,
      projectId,
      conversationId,
      sourceEventId: event.id,
      lastDeliveryChannel: delivery.channel,
      lastDeliveryTransport: delivery.transport,
      missingEntityError,
    });

    if (!persisted) {
      return;
    }

    if (missingEntityError) {
      await this.recordDeliveryOutcome({
        notificationId: notification.id,
        organizationId,
        userId,
        channel: delivery.channel,
        transport: delivery.transport,
        attempt: delivery.attempt ?? 1,
        outcome: NotificationDeliveryOutcome.FAILED,
        errorMessage: missingEntityError,
        latencyMs: Date.now() - startedAtMs,
        deliveredAt: new Date().toISOString(),
        shouldRetry: false,
      });
      this.incrementMetrics(
        NotificationDeliveryOutcome.FAILED,
        Date.now() - startedAtMs,
      );
      return;
    }

    const suppression = await this.getSuppressionDecision(
      organizationId,
      userId,
      delivery.channel,
    );

    if (suppression.suppressed) {
      await this.recordDeliveryOutcome({
        notificationId: notification.id,
        organizationId,
        userId,
        channel: delivery.channel,
        transport: delivery.transport,
        attempt: delivery.attempt ?? 1,
        outcome: NotificationDeliveryOutcome.SUPPRESSED,
        errorMessage: suppression.reason,
        latencyMs: Date.now() - startedAtMs,
        deliveredAt: new Date().toISOString(),
        shouldRetry: false,
      });
      this.incrementMetrics(
        NotificationDeliveryOutcome.SUPPRESSED,
        Date.now() - startedAtMs,
      );
      return;
    }

    await this.emitWebsocketWithRetry({
      notificationId: notification.id,
      organizationId,
      projectId,
      conversationId,
      userId,
      notification,
      delivery,
      clientHints,
      message,
      severity,
      timestamp,
    });
  }

  async listNotifications(input: ListNotificationsInput): Promise<{
    data: NotificationDto[];
    totalCount: number;
    nextOffset?: number;
  }> {
    const targetUserId = (input.userId ?? input.actorUserId) as UserId;
    this.assertUserScopedAccess(input.actorUserId, targetUserId);

    const limit = this.normalizeLimit(input.limit);
    const offset = this.normalizeOffset(input.offset);

    const accessibleProjectIds = await this.projectAccess.accessibleProjectIds(
      input.actorUserId,
      input.organizationId,
    );
    const where: Prisma.NotificationWhereInput = {
      AND: [
        {
          OR: [
            { projectId: null },
            { projectId: { in: accessibleProjectIds } },
          ],
        },
      ],
      organizationId: input.organizationId,
      userId: targetUserId,
      ...(input.eventTypes && input.eventTypes.length > 0
        ? { eventType: { in: input.eventTypes } }
        : {}),
      ...(input.status
        ? { status: this.toPrismaNotificationStatus(input.status) }
        : {}),
      ...(!input.status && !input.includeDismissed
        ? { status: { not: PrismaNotificationStatus.dismissed } }
        : {}),
      ...(input.channel ? { lastDeliveryChannel: input.channel } : {}),
      ...(input.createdAfter || input.createdBefore
        ? {
            createdAt: {
              ...(input.createdAfter ? { gte: input.createdAfter } : {}),
              ...(input.createdBefore ? { lte: input.createdBefore } : {}),
            },
          }
        : {}),
    };

    const [totalCount, notifications] = await this.prisma.db.$transaction([
      this.prisma.db.notification.count({ where }),
      this.prisma.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    const data = notifications.map((entry) => this.toNotificationDto(entry));

    const nextOffset =
      offset + notifications.length < totalCount
        ? offset + notifications.length
        : undefined;

    return {
      data,
      totalCount,
      nextOffset,
    };
  }

  async getUserNotificationPreferences(
    organizationId: OrganizationId,
    actorUserId: UserId,
    targetUserId: UserId,
  ): Promise<NotificationPreferencesDto> {
    this.assertUserScopedAccess(actorUserId, targetUserId);

    const preference = await this.prisma.db.notificationPreference.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    const data = this.toNotificationPreferencesDto(
      organizationId,
      targetUserId,
      preference?.subscriptions,
      preference?.updatedAt,
    );

    return data;
  }

  async updateUserNotificationPreferences(
    organizationId: OrganizationId,
    actorUserId: UserId,
    targetUserId: UserId,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    this.assertUserScopedAccess(actorUserId, targetUserId);

    const normalizedSubscriptions = this.normalizeSubscriptions(
      dto.subscriptions,
      true,
    );

    const updated = await this.prisma.db.notificationPreference.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
      create: {
        organizationId,
        userId: targetUserId,
        subscriptions:
          normalizedSubscriptions as unknown as Prisma.InputJsonValue,
      },
      update: {
        subscriptions:
          normalizedSubscriptions as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toNotificationPreferencesDto(
      organizationId,
      targetUserId,
      updated.subscriptions,
      updated.updatedAt,
    );
  }

  async markRead(
    organizationId: OrganizationId,
    actorUserId: UserId,
    notificationId: string,
  ): Promise<NotificationDto> {
    return this.updateNotificationState(
      organizationId,
      actorUserId,
      notificationId,
      NotificationStatus.Read,
    );
  }

  async markUnread(
    organizationId: OrganizationId,
    actorUserId: UserId,
    notificationId: string,
  ): Promise<NotificationDto> {
    return this.updateNotificationState(
      organizationId,
      actorUserId,
      notificationId,
      NotificationStatus.Unread,
    );
  }

  async acknowledge(
    organizationId: OrganizationId,
    actorUserId: UserId,
    notificationId: string,
  ): Promise<NotificationDto> {
    return this.updateNotificationState(
      organizationId,
      actorUserId,
      notificationId,
      NotificationStatus.Acknowledged,
    );
  }

  async dismiss(
    organizationId: OrganizationId,
    actorUserId: UserId,
    notificationId: string,
  ): Promise<NotificationDto> {
    return this.updateNotificationState(
      organizationId,
      actorUserId,
      notificationId,
      NotificationStatus.Dismissed,
    );
  }

  getDeliveryMetricsSnapshot(): DeliveryMetricsSnapshot {
    const outcomeCount =
      this.successCount + this.failureCount + this.suppressedCount;
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      retryCount: this.retryCount,
      suppressedCount: this.suppressedCount,
      averageLatencyMs:
        outcomeCount === 0
          ? 0
          : Math.round(this.latencyAccumulatorMs / outcomeCount),
    };
  }

  private async validateIncomingEvent(event: SystemNotificationEvent): Promise<{
    organizationId: OrganizationId;
    userId: UserId;
    projectId?: string;
    conversationId?: string;
    correlationId?: string;
    reportId?: string;
    notification: NotificationDto;
    delivery: NotificationDeliveryMetadata;
    clientHints: NotificationClientHandlingHints;
    message?: string;
    severity?: WebSocketSystemNotificationEvent.SeverityEnum;
    timestamp: string;
  } | null> {
    const payload = event.payload as SystemNotificationEventPayload;
    const organizationId = payload.organizationId;
    const userId = payload.userId;

    if (!organizationId || !userId) {
      this.logger.error(
        'Malformed system.notification event: missing organizationId/userId',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
        },
      );
      return null;
    }

    if (!payload.notification || !payload.delivery || !payload.clientHints) {
      this.logger.error(
        'Malformed system.notification event: notification/delivery/clientHints are required',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
        },
      );
      return null;
    }

    const notification = payload.notification;
    if (
      !notification.id ||
      !notification.eventType ||
      !notification.entityId ||
      !notification.entityType ||
      !notification.entityTitle ||
      !Array.isArray(notification.affectedEntities) ||
      notification.affectedEntities.length === 0 ||
      !notification.createdAt ||
      !notification.status
    ) {
      this.logger.error(
        'Malformed system.notification event: missing required notification fields',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
          notificationId: notification.id,
        },
      );
      return null;
    }

    if (!NOTIFICATION_EVENT_TYPES.has(notification.eventType)) {
      this.logger.error(
        'Malformed system.notification event: unsupported notification eventType',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
          eventType: notification.eventType,
        },
      );
      return null;
    }

    if (!NOTIFICATION_STATUS_SET.has(notification.status)) {
      this.logger.error(
        'Malformed system.notification event: unsupported notification status',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
          status: notification.status,
        },
      );
      return null;
    }

    if (!NOTIFICATION_CHANNELS.has(payload.delivery.channel)) {
      this.logger.error(
        'Malformed system.notification event: unsupported delivery channel',
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
          channel: payload.delivery.channel,
        },
      );
      return null;
    }

    return {
      organizationId,
      userId: userId as UserId,
      projectId: payload.projectId,
      conversationId: payload.conversationId ?? undefined,
      correlationId: payload.correlationId,
      reportId: payload.reportId,
      notification,
      delivery: payload.delivery,
      clientHints: payload.clientHints,
      message: payload.message,
      severity: payload.severity,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };
  }

  private async resolveMissingLinkedEntityError(
    organizationId: OrganizationId,
    notification: NotificationDto,
  ): Promise<string | null> {
    const refs: Array<{ entityId: string; entityType: EntityType }> = [
      {
        entityId: notification.entityId,
        entityType: notification.entityType,
      },
      ...notification.affectedEntities
        .filter((entity) => entity.id && entity.type)
        .map((entity) => ({
          entityId: entity.id,
          entityType: entity.type as EntityType,
        })),
    ];
    const uniqueRefs = new Map<
      string,
      { entityId: string; entityType: EntityType }
    >();
    refs.forEach((ref) => {
      uniqueRefs.set(`${ref.entityType}:${ref.entityId}`, ref);
    });
    const dedupedRefs = Array.from(uniqueRefs.values());

    const reportIds = dedupedRefs
      .filter((ref) => ref.entityType === EntityType.Report)
      .map((ref) => ref.entityId);
    const registryRefs = dedupedRefs.filter(
      (ref) => ref.entityType !== EntityType.Report,
    );

    const [existingReports, existingEntities] = await Promise.all([
      reportIds.length > 0
        ? this.prisma.db.report.findMany({
            where: {
              organizationId,
              id: { in: reportIds },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      registryRefs.length > 0
        ? this.prisma.db.entityRegistry.findMany({
            where: {
              organizationId,
              deletedAt: null,
              OR: registryRefs.map((ref) => ({
                entityId: ref.entityId,
                entityType: ref.entityType as PrismaEntityType,
              })),
            },
            select: {
              entityId: true,
              entityType: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const existingReportIds = new Set(
      existingReports.map((report) => report.id),
    );
    const existingEntityKeys = new Set(
      existingEntities.map((entry) => `${entry.entityType}:${entry.entityId}`),
    );

    const missing = dedupedRefs.filter((ref) => {
      if (ref.entityType === EntityType.Report) {
        return !existingReportIds.has(ref.entityId);
      }
      return !existingEntityKeys.has(`${ref.entityType}:${ref.entityId}`);
    });

    if (missing.length === 0) {
      return null;
    }

    const message = `Notification linked entities could not be resolved: ${missing
      .map((entry) => `${entry.entityType}:${entry.entityId}`)
      .join(', ')}`;

    this.logger.error(message, {
      organizationId,
      notificationId: notification.id,
      missing,
    });

    return message;
  }

  private async persistNotificationFromEvent(input: {
    organizationId: OrganizationId;
    userId: UserId;
    reportReferenceId?: string;
    notification: NotificationDto;
    correlationId?: string;
    projectId?: string;
    conversationId?: string;
    sourceEventId?: string;
    lastDeliveryChannel?: string;
    lastDeliveryTransport?: string;
    missingEntityError: string | null;
  }): Promise<NotificationRecord | null> {
    const incomingStatus = this.toPrismaNotificationStatus(
      input.notification.status,
    );

    this.logger.debug('Persisting notification payload', {
      notificationId: input.notification.id,
      eventType: input.notification.eventType,
      payloadKeys: Object.keys(input.notification.payload),
    });

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.notification.findUnique({
          where: { id: input.notification.id },
        });

        if (
          existing &&
          !this.immutableFieldsMatch(
            existing,
            input.notification,
            input.organizationId,
            input.userId,
          )
        ) {
          this.logger.error(
            'Notification immutable fields mismatch for existing notification ID',
            {
              notificationId: input.notification.id,
              organizationId: input.organizationId,
              userId: input.userId,
            },
          );
          return null;
        }

        const statusFields = this.resolveStatusTimestamps(
          incomingStatus,
          existing,
        );

        if (!existing) {
          return tx.notification.create({
            data: {
              id: input.notification.id,
              organizationId: input.organizationId,
              userId: input.userId,
              eventType: input.notification.eventType,
              reportId: input.reportReferenceId ?? null,
              entityId: input.notification.entityId,
              entityType: input.notification.entityType as PrismaEntityType,
              entityTitle: input.notification.entityTitle,
              affectedEntities: input.notification
                .affectedEntities as unknown as Prisma.InputJsonValue,
              payload: input.notification
                .payload as unknown as Prisma.InputJsonValue,
              createdAt: new Date(input.notification.createdAt),
              status: incomingStatus,
              ...statusFields,
              correlationId: input.correlationId,
              projectId: input.projectId,
              conversationId: input.conversationId,
              sourceEventId: input.sourceEventId,
              lastDeliveryChannel: input.lastDeliveryChannel,
              lastDeliveryTransport: input.lastDeliveryTransport,
              ...(input.missingEntityError
                ? {
                    lastDeliveryOutcome: NotificationDeliveryOutcome.FAILED,
                    lastDeliveryError: input.missingEntityError,
                  }
                : {}),
            },
          });
        }

        return tx.notification.update({
          where: { id: input.notification.id },
          data: {
            status: incomingStatus,
            ...statusFields,
            ...(input.reportReferenceId !== undefined
              ? { reportId: input.reportReferenceId }
              : {}),
            correlationId: input.correlationId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            sourceEventId: input.sourceEventId,
            lastDeliveryChannel: input.lastDeliveryChannel,
            lastDeliveryTransport: input.lastDeliveryTransport,
            ...(input.missingEntityError
              ? {
                  lastDeliveryOutcome: NotificationDeliveryOutcome.FAILED,
                  lastDeliveryError: input.missingEntityError,
                }
              : {}),
          },
        });
      });
    } catch (error) {
      this.logger.error('Failed to persist system.notification payload', {
        error: error instanceof Error ? error.message : String(error),
        notificationId: input.notification.id,
        organizationId: input.organizationId,
      });
      return null;
    }
  }

  private async emitWebsocketWithRetry(input: {
    notificationId: string;
    organizationId: OrganizationId;
    projectId?: string;
    conversationId?: string;
    userId: UserId;
    notification: NotificationDto;
    delivery: NotificationDeliveryMetadata;
    clientHints: NotificationClientHandlingHints;
    message?: string;
    severity?: WebSocketSystemNotificationEvent.SeverityEnum;
    timestamp: string;
  }): Promise<void> {
    let attempt = Math.max(1, input.delivery.attempt ?? 1);
    let retries = 0;

    while (true) {
      try {
        if (input.projectId)
          await this.projectAccess.assertProject(
            input.userId,
            input.organizationId,
            input.projectId,
          );
        else
          await this.projectAccess.assertOrganization(
            input.userId,
            input.organizationId,
          );
      } catch (error) {
        if (error instanceof ForbiddenException) return;
        throw error;
      }
      const attemptStartedAt = Date.now();
      const deliveredAt = new Date().toISOString();
      const wsEvent: WebSocketSystemNotificationEvent = {
        type: WebSocketSystemNotificationEvent.TypeEnum.SystemNotification,
        timestamp: input.timestamp,
        organizationId: input.organizationId,
        userId: input.userId,
        notification: {
          ...input.notification,
          status: input.notification.status,
        },
        delivery: {
          channel: input.delivery.channel,
          transport: input.delivery.transport,
          deliveredAt,
          attempt,
        },
        clientHints: input.clientHints,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.conversationId
          ? { conversationId: input.conversationId }
          : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
      };

      try {
        this.websocketGateway.emitSystemNotification(wsEvent);
        const latencyMs = Date.now() - attemptStartedAt;
        await this.recordDeliveryOutcome({
          notificationId: input.notificationId,
          organizationId: input.organizationId,
          userId: input.userId,
          channel: input.delivery.channel,
          transport: input.delivery.transport,
          attempt,
          outcome: NotificationDeliveryOutcome.SUCCESS,
          latencyMs,
          deliveredAt,
          shouldRetry: false,
        });
        this.incrementMetrics(NotificationDeliveryOutcome.SUCCESS, latencyMs);
        return;
      } catch (error) {
        const latencyMs = Date.now() - attemptStartedAt;
        const shouldRetry = retries < this.maxDeliveryRetries;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const nextRetryMs = shouldRetry
          ? this.baseBackoffMs * 2 ** retries
          : undefined;

        await this.recordDeliveryOutcome({
          notificationId: input.notificationId,
          organizationId: input.organizationId,
          userId: input.userId,
          channel: input.delivery.channel,
          transport: input.delivery.transport,
          attempt,
          outcome: NotificationDeliveryOutcome.FAILED,
          errorMessage,
          latencyMs,
          deliveredAt,
          shouldRetry,
          nextRetryAt: nextRetryMs
            ? new Date(Date.now() + nextRetryMs).toISOString()
            : undefined,
        });

        this.incrementMetrics(NotificationDeliveryOutcome.FAILED, latencyMs);

        if (!shouldRetry) {
          this.logger.error(
            'Notification websocket delivery failed with no retries remaining',
            {
              notificationId: input.notificationId,
              organizationId: input.organizationId,
              userId: input.userId,
              attempts: retries + 1,
              error: errorMessage,
            },
          );
          return;
        }

        this.retryCount += 1;
        retries += 1;
        attempt += 1;

        await this.sleep(nextRetryMs ?? this.baseBackoffMs);
      }
    }
  }

  private async recordDeliveryOutcome(input: {
    notificationId: string;
    organizationId: OrganizationId;
    userId: UserId;
    channel: string;
    transport: string;
    attempt: number;
    outcome: NotificationDeliveryOutcome;
    errorMessage?: string;
    latencyMs: number;
    deliveredAt: string;
    shouldRetry: boolean;
    nextRetryAt?: string;
  }): Promise<void> {
    const duplicate = await this.prisma.db.$transaction(async (tx) => {
      try {
        await tx.notificationDeliveryAttempt.create({
          data: {
            notificationId: input.notificationId,
            organizationId: input.organizationId,
            userId: input.userId,
            channel: input.channel,
            transport: input.transport,
            attempt: input.attempt,
            outcome: input.outcome,
            errorMessage: input.errorMessage,
            latencyMs: input.latencyMs,
            deliveredAt: new Date(input.deliveredAt),
            shouldRetry: input.shouldRetry,
            nextRetryAt: input.nextRetryAt ? new Date(input.nextRetryAt) : null,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return true;
        }
        throw error;
      }

      const updateData: Prisma.NotificationUpdateInput = {
        lastDeliveryChannel: input.channel,
        lastDeliveryTransport: input.transport,
        lastDeliveryOutcome: input.outcome,
        lastDeliveryError: input.errorMessage ?? null,
        lastDeliveryAttempt: input.attempt,
        lastDeliveryAt: new Date(input.deliveredAt),
        deliveryLatencyMs: input.latencyMs,
        deliverySuppressed:
          input.outcome === NotificationDeliveryOutcome.SUPPRESSED,
        deliverySuppressionReason:
          input.outcome === NotificationDeliveryOutcome.SUPPRESSED
            ? (input.errorMessage ?? 'suppressed by preference')
            : null,
        ...(input.outcome === NotificationDeliveryOutcome.SUCCESS
          ? {
              deliverySuccessCount: {
                increment: 1,
              },
            }
          : {}),
        ...(input.outcome === NotificationDeliveryOutcome.FAILED
          ? {
              deliveryFailureCount: {
                increment: 1,
              },
            }
          : {}),
        ...(input.shouldRetry
          ? {
              deliveryRetryCount: {
                increment: 1,
              },
            }
          : {}),
      };

      await tx.notification.update({
        where: { id: input.notificationId },
        data: updateData,
      });

      return false;
    });

    if (duplicate) {
      this.logger.debug(
        'Skipping duplicate notification delivery attempt write',
        {
          notificationId: input.notificationId,
          channel: input.channel,
          transport: input.transport,
          attempt: input.attempt,
        },
      );
    }
  }

  private async getSuppressionDecision(
    organizationId: OrganizationId,
    userId: UserId,
    channel: NotificationChannel,
  ): Promise<{ suppressed: boolean; reason?: string }> {
    const preferences = await this.prisma.db.notificationPreference.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      select: {
        subscriptions: true,
      },
    });

    const subscriptions = this.normalizeSubscriptions(
      preferences?.subscriptions,
      false,
    );
    const configured = subscriptions.find((entry) => entry.channel === channel);
    if (!configured) {
      return { suppressed: false };
    }

    if (!configured.enabled) {
      return {
        suppressed: true,
        reason: `suppressed: ${configured.channel} disabled`,
      };
    }

    if (
      configured.deliveryMode ===
      NotificationChannelSubscription.DeliveryModeEnum.Muted
    ) {
      return {
        suppressed: true,
        reason: `suppressed: ${configured.channel} muted`,
      };
    }

    return { suppressed: false };
  }

  private async updateNotificationState(
    organizationId: OrganizationId,
    actorUserId: UserId,
    notificationId: string,
    nextStatus: NotificationStatus,
  ): Promise<NotificationDto> {
    const existing = await this.prisma.db.notification.findFirst({
      where: {
        id: notificationId,
        organizationId,
        userId: actorUserId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.db.notification.update({
      where: {
        id: notificationId,
      },
      data: {
        status: this.toPrismaNotificationStatus(nextStatus),
        ...this.resolveStatusTimestamps(
          this.toPrismaNotificationStatus(nextStatus),
          existing,
        ),
      },
    });

    await this.publishStatusChangeEvent(updated);

    return this.toNotificationDto(updated);
  }

  private async publishStatusChangeEvent(
    record: NotificationRecord,
  ): Promise<void> {
    const notification = this.toNotificationDto(record);

    const event: Omit<SystemNotificationEvent, 'id'> = {
      type: EVENT_TYPES.SYSTEM.NOTIFICATION,
      aggregateId: notification.id,
      payload: {
        organizationId: record.organizationId as OrganizationId,
        userId: record.userId as UserId,
        timestamp: new Date().toISOString(),
        ...(record.correlationId
          ? { correlationId: record.correlationId }
          : {}),
        ...(record.projectId
          ? { projectId: record.projectId as ProjectId }
          : {}),
        ...(record.conversationId
          ? { conversationId: record.conversationId as ConversationId }
          : {}),
        ...(record.reportId ? { reportId: record.reportId } : {}),
        notification,
        delivery: {
          channel: NotificationChannel.InApp,
          transport: NotificationDeliveryMetadata.TransportEnum.Websocket,
          attempt: 1,
        },
        clientHints: {
          shouldToast: false,
          shouldBadge: notification.status === NotificationStatus.Unread,
          dismissible: true,
          priority: NotificationClientHandlingHints.PriorityEnum.Normal,
        },
      },
    };

    for (
      let attempt = 1;
      attempt <= this.maxDeliveryRetries + 1;
      attempt += 1
    ) {
      try {
        await this.eventPublisher.publish(event);
        return;
      } catch (error) {
        const canRetry = attempt <= this.maxDeliveryRetries;
        this.logger.error('Failed to emit notification status-change event', {
          notificationId: notification.id,
          attempt,
          maxAttempts: this.maxDeliveryRetries + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!canRetry) {
          throw error;
        }

        this.retryCount += 1;
        await this.sleep(this.baseBackoffMs * 2 ** (attempt - 1));
      }
    }
  }

  private toNotificationDto(record: NotificationRecord): NotificationDto {
    const affectedEntities = this.parseAffectedEntities(
      record.affectedEntities,
    );
    const base = {
      id: record.id,
      entityId: record.entityId,
      entityType: this.toApiEntityType(record.entityType),
      entityTitle: record.entityTitle,
      affectedEntities,
      createdAt: record.createdAt.toISOString(),
      status: this.toApiNotificationStatus(record.status),
      ...(record.dismissedAt
        ? { dismissedAt: record.dismissedAt.toISOString() }
        : {}),
    };

    const eventType = this.toNotificationEventType(record.eventType);

    switch (eventType) {
      case NotificationEventType.ReportCreated: {
        const evt = ReportCreatedNotificationDto.EventTypeEnum.ReportCreated;
        return {
          ...base,
          eventType: evt,
          payload: this.parseReportCreatedPayload(record.payload),
        };
      }
      case NotificationEventType.TaskCompleted: {
        const evt = TaskCompletedNotificationDto.EventTypeEnum.TaskCompleted;
        return {
          ...base,
          eventType: evt,
          payload: this.parseTaskCompletedPayload(record.payload),
        };
      }
      case NotificationEventType.ChildUnblocked: {
        const evt = ChildUnblockedNotificationDto.EventTypeEnum.ChildUnblocked;
        return {
          ...base,
          eventType: evt,
          payload: this.parseChildUnblockedPayload(record.payload),
        };
      }
      case NotificationEventType.SystemMessage: {
        const evt = SystemMessageNotificationDto.EventTypeEnum.SystemMessage;
        return {
          ...base,
          eventType: evt,
          payload: this.parseSystemMessagePayload(record.payload),
        };
      }
      case NotificationEventType.SessionReportReady: {
        const evt =
          SessionReportReadyNotificationDto.EventTypeEnum.SessionReportReady;
        return {
          ...base,
          eventType: evt,
          payload: this.parseSessionReportReadyPayload(record.payload),
        };
      }
      case NotificationEventType.PullRequestMerged: {
        const evt =
          PullRequestMergedNotificationDto.EventTypeEnum.PullRequestMerged;
        return {
          ...base,
          eventType: evt,
          payload: this.parsePullRequestMergedPayload(record.payload),
        };
      }
      default:
        throw new Error(
          `Unsupported persisted notification eventType: ${record.eventType}`,
        );
    }
  }

  private toNotificationPreferencesDto(
    organizationId: OrganizationId,
    userId: UserId,
    rawSubscriptions: unknown,
    updatedAt?: Date,
  ): NotificationPreferencesDto {
    return {
      userId,
      organizationId,
      subscriptions: this.normalizeSubscriptions(rawSubscriptions, false),
      updatedAt: (updatedAt ?? new Date()).toISOString(),
    };
  }

  private parseAffectedEntities(raw: unknown): NotificationAffectedEntityRef[] {
    if (!Array.isArray(raw)) {
      throw new Error(
        'Persisted notification affectedEntities must be an array',
      );
    }

    return raw.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(
          'Persisted notification affectedEntities must contain objects',
        );
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.type !== 'string') {
        throw new Error(
          'Persisted notification affected entity is missing id/type',
        );
      }
      return {
        id: record.id,
        type: record.type as NotificationAffectedEntityRef['type'],
        ...(typeof record.role === 'string' ? { role: record.role } : {}),
      };
    });
  }

  private parseRawPayload(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Persisted notification payload must be an object');
    }
    return raw as Record<string, unknown>;
  }

  private parseReportCreatedPayload(raw: unknown): ReportCreatedPayload {
    const record = this.parseRawPayload(raw);
    const nextSteps = Array.isArray(record.nextSteps)
      ? (record.nextSteps as ReportCreatedPayload['nextSteps'])
      : [];
    const verificationTasks = Array.isArray(record.verificationTasks)
      ? (record.verificationTasks as ReportCreatedPayload['verificationTasks'])
      : [];
    const recommendedUpdates = Array.isArray(record.recommendedUpdates)
      ? (record.recommendedUpdates as ReportCreatedPayload['recommendedUpdates'])
      : [];
    return { nextSteps, verificationTasks, recommendedUpdates };
  }

  private parseTaskCompletedPayload(raw: unknown): TaskCompletedPayload {
    const record = this.parseRawPayload(raw);
    if (
      typeof record.taskId === 'string' &&
      typeof record.taskName === 'string'
    ) {
      return {
        taskId: record.taskId,
        taskName: record.taskName,
        previousStatus: record.previousStatus as WorkStatus,
        newStatus: record.newStatus as WorkStatus,
      };
    }
    this.logger.warn('Legacy task.completed payload missing taskId/taskName');
    return {
      taskId: '',
      taskName: '',
      previousStatus: WorkStatus.Active,
      newStatus: WorkStatus.Completed,
    };
  }

  private parseSystemMessagePayload(raw: unknown): SystemMessagePayload {
    const record = this.parseRawPayload(raw);
    if (
      typeof record.messageId === 'string' &&
      typeof record.conversationId === 'string'
    ) {
      return {
        messageId: record.messageId,
        conversationId: record.conversationId,
        title: typeof record.title === 'string' ? record.title : '',
        snippet: typeof record.snippet === 'string' ? record.snippet : '',
      };
    }
    this.logger.warn('Legacy system_message payload missing messageId');
    return {
      messageId: '',
      conversationId: '',
      title: '',
      snippet: '',
    };
  }

  private parseSessionReportReadyPayload(
    raw: unknown,
  ): SessionReportReadyPayload {
    const record = this.parseRawPayload(raw);
    if (
      typeof record.sessionId === 'string' &&
      typeof record.reportId === 'string' &&
      typeof record.reportType === 'string' &&
      typeof record.sessionTitle === 'string' &&
      typeof record.reportTitle === 'string'
    ) {
      return {
        sessionId: record.sessionId,
        reportId: record.reportId,
        reportType: record.reportType as ReportType,
        sessionTitle: record.sessionTitle,
        reportTitle: record.reportTitle,
      };
    }
    throw new Error(
      'Persisted session_report_ready payload is missing required fields',
    );
  }

  private parsePullRequestMergedPayload(
    raw: unknown,
  ): PullRequestMergedPayload {
    const record = this.parseRawPayload(raw);
    if (
      typeof record.repositoryName === 'string' &&
      Number.isInteger(record.pullRequestNumber) &&
      typeof record.pullRequestTitle === 'string' &&
      typeof record.pullRequestUrl === 'string' &&
      typeof record.mergedAt === 'string' &&
      typeof record.actorLogin === 'string' &&
      (record.taskId === undefined || typeof record.taskId === 'string')
    ) {
      return {
        repositoryName: record.repositoryName,
        pullRequestNumber: record.pullRequestNumber as number,
        pullRequestTitle: record.pullRequestTitle,
        pullRequestUrl: record.pullRequestUrl,
        mergedAt: record.mergedAt,
        actorLogin: record.actorLogin,
        ...(record.taskId ? { taskId: record.taskId } : {}),
      };
    }
    throw new Error(
      'Persisted pull_request.merged payload is missing required fields',
    );
  }

  // child_unblocked is retained for backward compatibility
  // and is no longer emitted for new notifications.
  private parseChildUnblockedPayload(raw: unknown): ChildUnblockedPayload {
    const record = this.parseRawPayload(raw);
    if (typeof record.parentEntityId === 'string') {
      return {
        parentEntityId: record.parentEntityId,
        parentEntityType: record.parentEntityType as EntityType,
        unblockedChildIds: Array.isArray(record.unblockedChildIds)
          ? (record.unblockedChildIds as string[])
          : [],
      };
    }
    this.logger.warn('Legacy child_unblocked payload missing fields');
    return {
      parentEntityId: '',
      parentEntityType: EntityType.Task,
      unblockedChildIds: [],
    };
  }

  private normalizeSubscriptions(
    raw: unknown,
    requireAtLeastOne: boolean,
  ): NotificationChannelSubscription[] {
    const fallback = this.defaultSubscriptions();

    if (!raw) {
      return fallback;
    }

    if (!Array.isArray(raw)) {
      throw new BadRequestException('subscriptions must be an array');
    }

    const deduped = new Map<
      NotificationChannel,
      NotificationChannelSubscription
    >();

    raw.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new BadRequestException('subscriptions entries must be objects');
      }

      const item = entry as Record<string, unknown>;
      if (
        typeof item.channel !== 'string' ||
        !NOTIFICATION_CHANNELS.has(item.channel)
      ) {
        throw new BadRequestException(
          `Unsupported notification channel: ${String(item.channel)}`,
        );
      }

      if (typeof item.enabled !== 'boolean') {
        throw new BadRequestException(
          `subscription.enabled must be boolean for channel ${item.channel}`,
        );
      }

      if (
        item.deliveryMode !== undefined &&
        item.deliveryMode !==
          NotificationChannelSubscription.DeliveryModeEnum.Immediate &&
        item.deliveryMode !==
          NotificationChannelSubscription.DeliveryModeEnum.Muted
      ) {
        throw new BadRequestException(
          `Invalid deliveryMode for channel ${item.channel}`,
        );
      }

      deduped.set(item.channel as NotificationChannel, {
        channel: item.channel as NotificationChannel,
        enabled: item.enabled,
        ...(item.deliveryMode
          ? {
              deliveryMode:
                item.deliveryMode as NotificationChannelSubscription.DeliveryModeEnum,
            }
          : {
              deliveryMode:
                NotificationChannelSubscription.DeliveryModeEnum.Immediate,
            }),
      });
    });

    if (requireAtLeastOne && deduped.size === 0) {
      throw new BadRequestException(
        'subscriptions must include at least one channel',
      );
    }

    if (deduped.size === 0) {
      return fallback;
    }

    return Array.from(deduped.values());
  }

  private immutableFieldsMatch(
    existing: NotificationRecord,
    incoming: NotificationDto,
    organizationId: OrganizationId,
    userId: UserId,
  ): boolean {
    return (
      existing.organizationId === organizationId &&
      existing.userId === userId &&
      existing.eventType === incoming.eventType &&
      existing.entityId === incoming.entityId &&
      existing.entityType === incoming.entityType &&
      existing.entityTitle === incoming.entityTitle &&
      existing.createdAt.getTime() === new Date(incoming.createdAt).getTime() &&
      JSON.stringify(existing.affectedEntities) ===
        JSON.stringify(incoming.affectedEntities) &&
      JSON.stringify(existing.payload) === JSON.stringify(incoming.payload)
    );
  }

  private resolveStatusTimestamps(
    status: PrismaNotificationStatus,
    existing: NotificationRecord | null,
  ): {
    readAt?: Date | null;
    acknowledgedAt?: Date | null;
    dismissedAt?: Date | null;
  } {
    const now = new Date();

    if (status === PrismaNotificationStatus.unread) {
      return {
        readAt: null,
        acknowledgedAt: null,
        dismissedAt: null,
      };
    }

    if (status === PrismaNotificationStatus.read) {
      return {
        readAt: existing?.readAt ?? now,
        acknowledgedAt: null,
        dismissedAt: null,
      };
    }

    if (status === PrismaNotificationStatus.acknowledged) {
      return {
        readAt: existing?.readAt ?? now,
        acknowledgedAt: existing?.acknowledgedAt ?? now,
        dismissedAt: null,
      };
    }

    return {
      dismissedAt: existing?.dismissedAt ?? now,
    };
  }

  private toPrismaNotificationStatus(
    status: NotificationStatus,
  ): PrismaNotificationStatus {
    switch (status) {
      case NotificationStatus.Unread:
        return PrismaNotificationStatus.unread;
      case NotificationStatus.Read:
        return PrismaNotificationStatus.read;
      case NotificationStatus.Acknowledged:
        return PrismaNotificationStatus.acknowledged;
      case NotificationStatus.Dismissed:
        return PrismaNotificationStatus.dismissed;
      default:
        throw new BadRequestException(
          `Unsupported notification status: ${status}`,
        );
    }
  }

  private toApiNotificationStatus(
    status: PrismaNotificationStatus,
  ): NotificationStatus {
    switch (status) {
      case PrismaNotificationStatus.unread:
        return NotificationStatus.Unread;
      case PrismaNotificationStatus.read:
        return NotificationStatus.Read;
      case PrismaNotificationStatus.acknowledged:
        return NotificationStatus.Acknowledged;
      case PrismaNotificationStatus.dismissed:
        return NotificationStatus.Dismissed;
      default:
        throw new Error(`Unsupported persisted notification status: ${status}`);
    }
  }

  private toNotificationEventType(eventType: string): NotificationEventType {
    if (!NOTIFICATION_EVENT_TYPES.has(eventType)) {
      throw new Error(
        `Unsupported persisted notification eventType: ${eventType}`,
      );
    }
    return eventType as NotificationEventType;
  }

  private toApiEntityType(entityType: PrismaEntityType): EntityType {
    if (!(Object.values(EntityType) as string[]).includes(entityType)) {
      throw new Error(
        `Unsupported persisted notification entityType: ${entityType}`,
      );
    }
    return entityType as EntityType;
  }

  private assertUserScopedAccess(
    actorUserId: UserId,
    targetUserId: UserId,
  ): void {
    if (actorUserId !== targetUserId) {
      throw new ForbiddenException(
        'Notifications are only accessible for the current user',
      );
    }
  }

  private defaultSubscriptions(): NotificationChannelSubscription[] {
    return [
      {
        channel: NotificationChannel.InApp,
        enabled: true,
        deliveryMode:
          NotificationChannelSubscription.DeliveryModeEnum.Immediate,
      },
      {
        channel: NotificationChannel.SessionMention,
        enabled: true,
        deliveryMode:
          NotificationChannelSubscription.DeliveryModeEnum.Immediate,
      },
    ];
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(
        `limit must be an integer between 1 and ${MAX_LIMIT}`,
      );
    }
    return limit;
  }

  private normalizeOffset(offset?: number): number {
    if (offset === undefined) {
      return 0;
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException(
        'offset must be an integer greater than or equal to 0',
      );
    }
    return offset;
  }

  private incrementMetrics(
    outcome: NotificationDeliveryOutcome,
    latencyMs: number,
  ): void {
    if (outcome === NotificationDeliveryOutcome.SUCCESS) {
      this.successCount += 1;
    } else if (outcome === NotificationDeliveryOutcome.FAILED) {
      this.failureCount += 1;
    } else if (outcome === NotificationDeliveryOutcome.SUPPRESSED) {
      this.suppressedCount += 1;
    }

    this.latencyAccumulatorMs += latencyMs;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
