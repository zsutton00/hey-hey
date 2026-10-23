import {
  NotificationDeliveryOutcome,
  NotificationStatus as PrismaNotificationStatus,
} from '@prisma/client';
import { NotificationService } from 'src/services/notifications/notification.service';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  EntityType,
  NotificationChannel,
  NotificationClientHandlingHints,
  NotificationEventType,
  NotificationStatus,
} from 'src/generated';
import { SystemNotificationEvent } from 'src/core/events/types/domain-events';
import { OrganizationId, UserId } from 'src/types';

const ORG_ID = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const USER_ID = '22222222-2222-4222-8222-222222222222' as UserId;
const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const TASK_ID = '77777777-7777-4777-8777-777777777777';

const createNotificationRecord = (overrides?: Record<string, unknown>) => ({
  id: '44444444-4444-4444-8444-444444444444',
  organizationId: ORG_ID,
  userId: USER_ID,
  eventType: NotificationEventType.ReportCreated,
  reportId: REPORT_ID,
  entityId: REPORT_ID,
  entityType: EntityType.Report,
  entityTitle: 'Coding Research',
  affectedEntities: [{ id: REPORT_ID, type: EntityType.Report }],
  payload: {
    nextSteps: [],
    verificationTasks: [],
    recommendedUpdates: [],
  },
  createdAt: new Date('2026-03-03T00:00:00.000Z'),
  status: PrismaNotificationStatus.unread,
  readAt: null,
  acknowledgedAt: null,
  dismissedAt: null,
  correlationId: null,
  projectId: null,
  conversationId: null,
  sourceEventId: null,
  lastDeliveryChannel: null,
  lastDeliveryTransport: null,
  lastDeliveryOutcome: null,
  lastDeliveryError: null,
  lastDeliveryAttempt: 0,
  lastDeliveryAt: null,
  deliveryRetryCount: 0,
  deliveryFailureCount: 0,
  deliverySuccessCount: 0,
  deliveryLatencyMs: null,
  deliverySuppressed: false,
  deliverySuppressionReason: null,
  updatedAt: new Date('2026-03-03T00:00:00.000Z'),
  ...overrides,
});

const buildSystemNotificationEvent = (
  overrides?: Partial<SystemNotificationEvent>,
): SystemNotificationEvent => {
  const notificationId = '44444444-4444-4444-8444-444444444444';
  return {
    id: 'event-1',
    type: EVENT_TYPES.SYSTEM.NOTIFICATION,
    aggregateId: notificationId,
    payload: {
      organizationId: ORG_ID,
      userId: USER_ID,
      timestamp: '2026-03-03T00:00:00.000Z',
      reportId: REPORT_ID,
      notification: {
        id: notificationId,
        eventType: NotificationEventType.ReportCreated,
        entityId: REPORT_ID,
        entityType: EntityType.Report,
        entityTitle: 'Coding Research',
        affectedEntities: [{ id: REPORT_ID, type: EntityType.Report }],
        payload: {
          nextSteps: [],
          verificationTasks: [],
          recommendedUpdates: [],
        },
        createdAt: '2026-03-03T00:00:00.000Z',
        status: NotificationStatus.Unread,
      },
      delivery: {
        channel: NotificationChannel.InApp,
        transport: 'websocket',
        attempt: 1,
      },
      clientHints: {
        shouldToast: true,
        shouldBadge: true,
        dismissible: true,
        priority: NotificationClientHandlingHints.PriorityEnum.Normal,
      },
    },
    ...overrides,
  } as SystemNotificationEvent;
};

describe('NotificationService', () => {
  const createService = () => {
    const notificationFindUnique = jest.fn();
    const notificationCreate = jest.fn();
    const notificationUpdate = jest.fn();
    const notificationFindFirst = jest.fn();
    const notificationDeliveryAttemptCreate = jest.fn();

    const tx = {
      notification: {
        findUnique: notificationFindUnique,
        create: notificationCreate,
        update: notificationUpdate,
      },
      notificationDeliveryAttempt: {
        create: notificationDeliveryAttemptCreate,
      },
    };

    const prisma = {
      db: {
        report: {
          findMany: jest.fn().mockResolvedValue([{ id: REPORT_ID }]),
        },
        entityRegistry: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ entityId: REPORT_ID, entityType: 'TASK' }]),
        },
        notification: {
          findUnique: notificationFindUnique,
          findFirst: notificationFindFirst,
          create: notificationCreate,
          update: notificationUpdate,
          count: jest.fn(),
          findMany: jest.fn(),
        },
        notificationPreference: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
        },
        notificationDeliveryAttempt: {
          create: notificationDeliveryAttemptCreate,
        },
        $transaction: jest.fn(async (arg: unknown) => {
          if (typeof arg === 'function') {
            return (arg as (client: typeof tx) => Promise<unknown>)(tx);
          }
          return Promise.all(arg as Promise<unknown>[]);
        }),
      },
    };

    const websocketGateway = {
      emitSystemNotification: jest.fn(),
    };

    const eventPublisher = {
      publish: jest.fn().mockResolvedValue('outbox-event-id'),
    };

    const service = new NotificationService(
      {
        assertProject: jest.fn(),
        assertOrganization: jest.fn(),
        accessibleProjectIds: jest.fn().mockResolvedValue(['project-1']),
      } as never,
      prisma as any,
      websocketGateway as any,
      eventPublisher as any,
    );

    return {
      service,
      prisma,
      websocketGateway,
      eventPublisher,
      notificationFindUnique,
      notificationCreate,
      notificationUpdate,
      notificationFindFirst,
      notificationDeliveryAttemptCreate,
    };
  };

  it('persists notification once and updates on duplicate notification IDs', async () => {
    const {
      service,
      notificationFindUnique,
      notificationCreate,
      notificationUpdate,
    } = createService();

    notificationFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createNotificationRecord());
    notificationCreate.mockResolvedValue(createNotificationRecord());
    notificationUpdate.mockResolvedValue(createNotificationRecord());

    const firstEvent = buildSystemNotificationEvent();
    const duplicateEvent = buildSystemNotificationEvent({
      id: 'event-2',
      payload: {
        ...buildSystemNotificationEvent().payload,
        delivery: {
          channel: NotificationChannel.InApp,
          transport: 'websocket',
          attempt: 2,
        },
      },
    });

    await service.handleSystemNotificationEvent(firstEvent);
    await service.handleSystemNotificationEvent(duplicateEvent);

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationUpdate).toHaveBeenCalled();
  });

  it('persists an unread pull_request.merged notification and delivers it over websocket', async () => {
    const {
      service,
      prisma,
      websocketGateway,
      notificationFindUnique,
      notificationCreate,
      notificationUpdate,
    } = createService();
    const notificationId = '88888888-8888-4888-8888-888888888888';
    const notification = {
      id: notificationId,
      eventType: NotificationEventType.PullRequestMerged,
      entityId: ARTIFACT_ID,
      entityType: EntityType.Artifact,
      entityTitle: 'PR #12: Preserve accepted merge facts',
      affectedEntities: [
        { id: ARTIFACT_ID, type: EntityType.Artifact },
        { id: PROJECT_ID, type: EntityType.Project },
        { id: TASK_ID, type: EntityType.Task },
      ],
      payload: {
        repositoryName: 'hey-hey/api',
        pullRequestNumber: 12,
        pullRequestTitle: 'Preserve accepted merge facts',
        pullRequestUrl: 'https://github.com/hey-hey/api/pull/12',
        mergedAt: '2026-08-18T18:00:00.000Z',
        actorLogin: 'octocat',
        taskId: TASK_ID,
      },
      createdAt: '2026-08-18T18:00:00.000Z',
      status: NotificationStatus.Unread,
    };
    const persisted = createNotificationRecord({
      id: notificationId,
      eventType: NotificationEventType.PullRequestMerged,
      projectId: PROJECT_ID,
      entityId: ARTIFACT_ID,
      entityType: EntityType.Artifact,
      entityTitle: notification.entityTitle,
      affectedEntities: notification.affectedEntities,
      payload: notification.payload,
    });

    notificationFindUnique.mockResolvedValue(null);
    notificationCreate.mockResolvedValue(persisted);
    notificationUpdate.mockResolvedValue(persisted);
    (prisma.db.entityRegistry.findMany as jest.Mock).mockResolvedValue([
      { entityId: ARTIFACT_ID, entityType: EntityType.Artifact },
      { entityId: PROJECT_ID, entityType: EntityType.Project },
      { entityId: TASK_ID, entityType: EntityType.Task },
    ]);

    await service.handleSystemNotificationEvent({
      id: 'merge-system-event',
      type: EVENT_TYPES.SYSTEM.NOTIFICATION,
      aggregateId: notificationId,
      payload: {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        timestamp: '2026-08-18T18:00:00.000Z',
        notification,
        delivery: {
          channel: NotificationChannel.InApp,
          transport: 'websocket',
          attempt: 1,
        },
        clientHints: {
          shouldToast: true,
          shouldBadge: true,
          dismissible: true,
          priority: NotificationClientHandlingHints.PriorityEnum.High,
        },
      },
    } as SystemNotificationEvent);

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          eventType: NotificationEventType.PullRequestMerged,
          status: NotificationStatus.Unread,
          payload: notification.payload,
        }),
      }),
    );
    expect(notificationUpdate).toHaveBeenCalled();
  });

  it('rejects malformed notifications missing required primary entity fields', async () => {
    const { service, notificationCreate } = createService();

    const malformed = buildSystemNotificationEvent({
      payload: {
        ...buildSystemNotificationEvent().payload,
        notification: {
          ...buildSystemNotificationEvent().payload.notification,
          entityTitle: '',
        },
      },
    });

    await service.handleSystemNotificationEvent(malformed);

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('suppresses websocket delivery when channel preference is disabled', async () => {
    const {
      service,
      prisma,
      websocketGateway,
      notificationFindUnique,
      notificationCreate,
      notificationUpdate,
      notificationDeliveryAttemptCreate,
    } = createService();

    notificationFindUnique.mockResolvedValue(null);
    notificationCreate.mockResolvedValue(createNotificationRecord());
    notificationUpdate.mockResolvedValue(createNotificationRecord());
    (
      prisma.db.notificationPreference.findUnique as jest.Mock
    ).mockResolvedValue({
      subscriptions: [
        {
          channel: NotificationChannel.InApp,
          enabled: false,
          deliveryMode: 'immediate',
        },
      ],
    });

    await service.handleSystemNotificationEvent(buildSystemNotificationEvent());

    expect(websocketGateway.emitSystemNotification).not.toHaveBeenCalled();
    expect(notificationDeliveryAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: NotificationDeliveryOutcome.SUPPRESSED,
        }),
      }),
    );
  });

  it('marks notifications as read and emits a status-change system event', async () => {
    const {
      service,
      notificationFindFirst,
      notificationUpdate,
      eventPublisher,
    } = createService();

    notificationFindFirst.mockResolvedValue(createNotificationRecord());
    notificationUpdate.mockResolvedValue(
      createNotificationRecord({
        status: PrismaNotificationStatus.read,
        readAt: new Date('2026-03-03T01:00:00.000Z'),
      }),
    );

    const result = await service.markRead(
      ORG_ID,
      USER_ID,
      '44444444-4444-4444-8444-444444444444',
    );

    expect(result.status).toBe(NotificationStatus.Read);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.SYSTEM.NOTIFICATION,
        payload: expect.objectContaining({
          notification: expect.objectContaining({
            status: NotificationStatus.Read,
          }),
        }),
      }),
    );
  });

  it('returns unwrapped list payload with pagination metadata', async () => {
    const { service, prisma } = createService();

    (prisma.db.notification.count as jest.Mock).mockResolvedValue(3);
    (prisma.db.notification.findMany as jest.Mock).mockResolvedValue([
      createNotificationRecord(),
      createNotificationRecord({
        id: '55555555-5555-4555-8555-555555555555',
      }),
    ]);

    const result = await service.listNotifications({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      limit: 2,
      offset: 0,
    });

    expect(result.totalCount).toBe(3);
    expect(result.nextOffset).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.id).toBe('44444444-4444-4444-8444-444444444444');
    expect('response' in result).toBe(false);
  });

  it('round-trips a persisted session_report_ready record into a SessionReportReadyNotificationDto', async () => {
    const { service, prisma } = createService();

    const AGENT_SESSION_ID = '66666666-6666-4666-8666-666666666666';
    const persistedRecord = createNotificationRecord({
      eventType: NotificationEventType.SessionReportReady,
      entityId: AGENT_SESSION_ID,
      entityType: EntityType.AgentSession,
      entityTitle: 'Refactor API tests',
      affectedEntities: [
        { id: AGENT_SESSION_ID, type: EntityType.AgentSession },
        { id: REPORT_ID, type: EntityType.Report },
      ],
      payload: {
        sessionId: AGENT_SESSION_ID,
        reportId: REPORT_ID,
        sessionTitle: 'Refactor API tests',
        reportTitle: 'Coding Research',
        reportType: 'CODING_RESEARCH',
      },
    });

    (prisma.db.notification.count as jest.Mock).mockResolvedValue(1);
    (prisma.db.notification.findMany as jest.Mock).mockResolvedValue([
      persistedRecord,
    ]);

    const result = await service.listNotifications({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      limit: 10,
      offset: 0,
    });

    expect(result.data).toHaveLength(1);
    const dto = result.data[0] as any;
    expect(dto.eventType).toBe(NotificationEventType.SessionReportReady);
    expect(dto.entityType).toBe(EntityType.AgentSession);
    expect(dto.entityId).toBe(AGENT_SESSION_ID);
    expect(dto.payload).toEqual({
      sessionId: AGENT_SESSION_ID,
      reportId: REPORT_ID,
      reportType: 'CODING_RESEARCH',
      sessionTitle: 'Refactor API tests',
      reportTitle: 'Coding Research',
    });
  });

  it('round-trips a persisted pull_request.merged record with optional task context', async () => {
    const { service, prisma } = createService();
    const persistedRecord = createNotificationRecord({
      eventType: NotificationEventType.PullRequestMerged,
      projectId: PROJECT_ID,
      entityId: ARTIFACT_ID,
      entityType: EntityType.Artifact,
      entityTitle: 'PR #12: Preserve accepted merge facts',
      affectedEntities: [
        { id: ARTIFACT_ID, type: EntityType.Artifact },
        { id: PROJECT_ID, type: EntityType.Project },
        { id: TASK_ID, type: EntityType.Task },
      ],
      payload: {
        repositoryName: 'hey-hey/api',
        pullRequestNumber: 12,
        pullRequestTitle: 'Preserve accepted merge facts',
        pullRequestUrl: 'https://github.com/hey-hey/api/pull/12',
        mergedAt: '2026-08-18T18:00:00.000Z',
        actorLogin: 'octocat',
        taskId: TASK_ID,
      },
    });

    (prisma.db.notification.count as jest.Mock).mockResolvedValue(1);
    (prisma.db.notification.findMany as jest.Mock).mockResolvedValue([
      persistedRecord,
    ]);

    const result = await service.listNotifications({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      limit: 10,
      offset: 0,
    });

    expect(result.data[0]).toMatchObject({
      eventType: NotificationEventType.PullRequestMerged,
      entityId: ARTIFACT_ID,
      entityType: EntityType.Artifact,
      payload: {
        repositoryName: 'hey-hey/api',
        pullRequestNumber: 12,
        pullRequestTitle: 'Preserve accepted merge facts',
        pullRequestUrl: 'https://github.com/hey-hey/api/pull/12',
        mergedAt: '2026-08-18T18:00:00.000Z',
        actorLogin: 'octocat',
        taskId: TASK_ID,
      },
    });
  });

  it('returns unwrapped preferences payload when reading preferences', async () => {
    const { service, prisma } = createService();

    (
      prisma.db.notificationPreference.findUnique as jest.Mock
    ).mockResolvedValue({
      subscriptions: [
        {
          channel: NotificationChannel.InApp,
          enabled: false,
          deliveryMode: 'muted',
        },
      ],
      updatedAt: new Date('2026-03-03T02:00:00.000Z'),
    });

    const result = await service.getUserNotificationPreferences(
      ORG_ID,
      USER_ID,
      USER_ID,
    );

    expect(result.organizationId).toBe(ORG_ID);
    expect(result.userId).toBe(USER_ID);
    expect(result.subscriptions).toEqual([
      {
        channel: NotificationChannel.InApp,
        enabled: false,
        deliveryMode: 'muted',
      },
    ]);
    expect('success' in result).toBe(false);
  });

  it('returns unwrapped preferences payload when updating preferences', async () => {
    const { service, prisma } = createService();

    (prisma.db.notificationPreference.upsert as jest.Mock).mockResolvedValue({
      organizationId: ORG_ID,
      userId: USER_ID,
      subscriptions: [
        {
          channel: NotificationChannel.InApp,
          enabled: true,
          deliveryMode: 'immediate',
        },
      ],
      updatedAt: new Date('2026-03-03T03:00:00.000Z'),
    });

    const result = await service.updateUserNotificationPreferences(
      ORG_ID,
      USER_ID,
      USER_ID,
      {
        subscriptions: [
          {
            channel: NotificationChannel.InApp,
            enabled: true,
            deliveryMode: 'immediate',
          },
        ],
      },
    );

    expect(result.organizationId).toBe(ORG_ID);
    expect(result.userId).toBe(USER_ID);
    expect(result.subscriptions).toEqual([
      {
        channel: NotificationChannel.InApp,
        enabled: true,
        deliveryMode: 'immediate',
      },
    ]);
    expect('success' in result).toBe(false);
  });
});
