import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  GitHubWebhookAcceptedEvent,
  AgentSessionStatusChangedEvent,
  MessageCreatedEvent,
  ReportCreatedEvent,
  TaskStatusChangedEvent,
} from 'src/core/events/types/domain-events';
import { NotificationGenerationProcessor } from 'src/core/processing/notification-generation-processor.service';
import {
  AgentSessionStatus,
  AgentSessionCurrentState,
  CreateSystemMessage,
  EntityType,
  MessageType,
  NotificationEventType,
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  SystemMessageData,
  WorkStatus,
} from 'src/generated';
import { buildMessageCreatedEventPayload } from 'src/utils/message-event.util';
import {
  createMockDomainEventPublisher,
  createMockPrismaService,
} from 'src/utils/testUtils';
import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';

const ORG_ID = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const PROJECT_ID = '22222222-2222-4222-8222-222222222222' as ProjectId;
const USER_ID = '33333333-3333-4333-8333-333333333333' as UserId;
const USER_ID_2 = '44444444-4444-4444-8444-444444444444' as UserId;
const ACTOR_ID = '55555555-5555-4555-8555-aaaaaaaaaaaa' as UserId;
const TASK_ID = '55555555-5555-4555-8555-555555555555' as TaskId;
const INITIATIVE_ID = '66666666-6666-4666-8666-666666666666' as InitiativeId;
const AGENT_SESSION_ID = '77777777-7777-4777-8777-777777777777';
const CONVERSATION_ID =
  '99999999-9999-4999-8999-999999999999' as ConversationId;
const REPORT_ID = '88888888-8888-4888-8888-888888888888';
const MESSAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as MessageId;
const ARTIFACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const buildTaskStatusChangedEvent = (
  overrides?: Partial<TaskStatusChangedEvent>,
): TaskStatusChangedEvent => ({
  id: 'task-event-id',
  type: EVENT_TYPES.TASK.STATUS_CHANGED,
  aggregateId: TASK_ID,
  payload: {
    payloadType: EVENT_TYPES.TASK.STATUS_CHANGED,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    userId: ACTOR_ID,
    previousStatus: WorkStatus.Backlog,
    newStatus: WorkStatus.Active,
    initiativeId: INITIATIVE_ID,
    timestamp: new Date().toISOString(),
  },
  ...overrides,
});

const buildAgentSessionStatusChangedEvent = (
  overrides?: Partial<AgentSessionStatusChangedEvent>,
): AgentSessionStatusChangedEvent => ({
  id: 'agent-session-event-id',
  type: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
  aggregateId: AGENT_SESSION_ID,
  payload: {
    payloadType: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    previousStatus: AgentSessionStatus.InProgress,
    newStatus: AgentSessionStatus.Completed,
    agentSession: {
      id: AGENT_SESSION_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
      status: AgentSessionStatus.Completed,
      currentState: AgentSessionCurrentState.Idle,
      sessionDate: new Date().toISOString(),
      title: 'Refactor API tests',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationId: CONVERSATION_ID,
      entityType: 'TASK',
      entityId: TASK_ID,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
    },
    timestamp: new Date().toISOString(),
  },
  ...overrides,
});

const buildReportCreatedEvent = (
  overrides?: Partial<ReportCreatedEvent>,
): ReportCreatedEvent => ({
  id: 'report-event-id',
  type: EVENT_TYPES.REPORT.CREATED,
  aggregateId: REPORT_ID,
  payload: {
    payloadType: EVENT_TYPES.REPORT.CREATED,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    shouldProcess: true,
    report: {
      id: REPORT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.ProjectVisible,
      title: 'Coding Research',
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'Research stub.',
        analysis: '',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: TASK_ID,
          relation: ReportEntityRelation.Primary,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    timestamp: new Date().toISOString(),
  },
  ...overrides,
});

const buildGitHubMergeEvent = (
  overrides?: Partial<GitHubWebhookAcceptedEvent>,
): GitHubWebhookAcceptedEvent => ({
  id: 'github-event-id',
  type: EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
  aggregateId: 'inbox-1',
  payload: {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    integrationId: 'integration-1',
    inboxId: 'inbox-1',
    deliveryId: 'delivery-1',
    eventName: 'pull_request',
    action: 'closed',
    repository: {
      id: 42,
      fullName: 'hey-hey/api',
      htmlUrl: 'https://github.com/hey-hey/api',
    },
    pullRequest: {
      id: 100,
      number: 12,
      title: 'Preserve accepted merge facts',
      state: 'closed',
      merged: true,
      mergedAt: '2026-08-18T18:00:00.000Z',
      mergedByLogin: 'octocat',
      htmlUrl: 'https://github.com/hey-hey/api/pull/12',
      headSha: 'abc123',
      baseSha: 'def456',
    },
    acceptedAt: '2026-08-18T18:01:00.000Z',
  },
  ...overrides,
});

describe('NotificationGenerationProcessor', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const createService = (redisClient?: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
  }) => {
    const prisma = createMockPrismaService();
    const eventPublisher = createMockDomainEventPublisher();
    const redisService = redisClient
      ? {
          getClient: () => redisClient,
        }
      : undefined;
    const messageService = {
      addMessage: jest.fn().mockResolvedValue({ id: 'stub' }),
      getMessage: jest.fn().mockResolvedValue(null),
    };
    const flowExecutionService = {
      findActiveByConversation: jest.fn().mockResolvedValue(null),
    };
    const pendingTriggerService = {
      resolvePendingTriggerForNode: jest
        .fn()
        .mockResolvedValue({ triggerMessageId: null }),
    };
    const nodeExecutionService = {
      getNode: jest.fn(),
    };
    const service = new NotificationGenerationProcessor(
      prisma as any,
      eventPublisher as any,
      messageService as any,
      redisService as any,
    );
    return {
      prisma,
      eventPublisher,
      service,
      messageService,
      flowExecutionService,
      pendingTriggerService,
      nodeExecutionService,
    };
  };

  const mockLinkedReport = (
    prisma: ReturnType<typeof createMockPrismaService>,
  ) => {
    prisma.db.report.findFirst.mockResolvedValue({
      id: REPORT_ID,
    });
  };

  it.each([true, false])(
    'excludes retained reports from notifications (shouldProcess=%s)',
    async (shouldProcess) => {
      const { prisma, eventPublisher, service } = createService();
      const event = buildReportCreatedEvent();
      await service.handleReportCreatedEvent({
        ...event,
        payload: {
          ...event.payload,
          shouldProcess,
          report: { ...event.payload.report, ragEnabled: false },
        },
      });
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(prisma.db.task.findFirst).not.toHaveBeenCalled();
    },
  );

  it('emits report notifications for resolved recipients', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: USER_ID_2,
    });

    await service.handleReportCreatedEvent(buildReportCreatedEvent());

    expect(eventPublisher.publish).toHaveBeenCalledTimes(2);
    const firstPublished = eventPublisher.publish.mock.calls[0]?.[0] as any;
    expect(firstPublished?.type).toBe(EVENT_TYPES.SYSTEM.NOTIFICATION);
    expect(firstPublished?.payload.notification.eventType).toBe(
      NotificationEventType.ReportCreated,
    );
    expect(firstPublished?.payload.notification.entityType).toBe(
      EntityType.Report,
    );
    expect(firstPublished?.payload.notification.entityId).toBe(REPORT_ID);
    expect(firstPublished?.payload.notification.entityTitle).toBe(
      'Coding Research',
    );
    expect(firstPublished?.payload.reportId).toBe(REPORT_ID);
  });

  describe('pull_request.merged emission', () => {
    it('maps accepted merge facts, project context, and linked task with replay-stable identity', async () => {
      const { prisma, eventPublisher, service } = createService();
      (prisma.db as any).integration = {
        findFirst: jest.fn().mockResolvedValue({ createdBy: USER_ID }),
      };
      prisma.db.project.findFirst.mockResolvedValue({
        id: PROJECT_ID,
        name: 'Hey Hey Project',
        createdBy: USER_ID_2,
      });
      prisma.db.artifact.findFirst.mockResolvedValue({
        id: ARTIFACT_ID,
        title: 'PR #12: Preserve accepted merge facts',
        taskRelations: [{ task: { id: TASK_ID, name: 'Consume merge event' } }],
      } as any);
      const event = buildGitHubMergeEvent();

      await service.handleGitHubWebhookAcceptedEvent(event);
      await service.handleGitHubWebhookAcceptedEvent(event);

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      expect(published.payload.projectId).toBe(PROJECT_ID);
      expect(published.payload.notification).toMatchObject({
        eventType: NotificationEventType.PullRequestMerged,
        entityId: ARTIFACT_ID,
        entityType: EntityType.Artifact,
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
      expect(published.aggregateId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('emits a project notification when the pull-request artifact is not available yet', async () => {
      const { prisma, eventPublisher, service } = createService();
      (prisma.db as any).integration = {
        findFirst: jest.fn().mockResolvedValue({ createdBy: USER_ID }),
      };
      prisma.db.project.findFirst.mockResolvedValue({
        id: PROJECT_ID,
        name: 'Hey Hey Project',
        createdBy: USER_ID_2,
      });
      prisma.db.artifact.findFirst.mockResolvedValue(null);

      await service.handleGitHubWebhookAcceptedEvent(buildGitHubMergeEvent());

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      expect(published.payload.notification).toMatchObject({
        eventType: NotificationEventType.PullRequestMerged,
        entityId: PROJECT_ID,
        entityType: EntityType.Project,
        affectedEntities: [{ id: PROJECT_ID, type: EntityType.Project }],
        payload: {
          repositoryName: 'hey-hey/api',
          pullRequestNumber: 12,
          pullRequestTitle: 'Preserve accepted merge facts',
          pullRequestUrl: 'https://github.com/hey-hey/api/pull/12',
          mergedAt: '2026-08-18T18:00:00.000Z',
          actorLogin: 'octocat',
        },
      });
      expect(published.payload.notification.payload.taskId).toBeUndefined();
    });

    it('falls back to the project creator and filters non-merge deliveries', async () => {
      const { prisma, eventPublisher, service } = createService();
      const integrationFindFirst = jest.fn().mockResolvedValue({
        createdBy: null,
      });
      (prisma.db as any).integration = { findFirst: integrationFindFirst };
      prisma.db.project.findFirst.mockResolvedValue({
        id: PROJECT_ID,
        name: 'Hey Hey Project',
        createdBy: USER_ID_2,
      });
      prisma.db.artifact.findFirst.mockResolvedValue({
        id: ARTIFACT_ID,
        title: 'PR #12: Preserve accepted merge facts',
        taskRelations: [],
      } as any);

      await service.handleGitHubWebhookAcceptedEvent(
        buildGitHubMergeEvent({
          payload: {
            ...buildGitHubMergeEvent().payload,
            action: 'opened',
          },
        }),
      );
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(integrationFindFirst).not.toHaveBeenCalled();

      await service.handleGitHubWebhookAcceptedEvent(buildGitHubMergeEvent());
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(
        (eventPublisher.publish.mock.calls[0]?.[0] as any)?.payload.userId,
      ).toBe(USER_ID_2);
    });
  });

  it('skips report notifications for internal audience reports', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: USER_ID_2,
    });

    await service.handleReportCreatedEvent(
      buildReportCreatedEvent({
        payload: {
          ...buildReportCreatedEvent().payload,
          report: {
            ...buildReportCreatedEvent().payload.report,
            audience: ReportAudience.WorkflowOnly,
          },
        },
      }),
    );

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  describe('session_report_ready emission', () => {
    const SESSION_TITLE = 'Refactor API tests';
    const buildReportWithSession = (
      overrides?: Partial<{ audience: ReportAudience }>,
    ): ReportCreatedEvent =>
      buildReportCreatedEvent({
        payload: {
          ...buildReportCreatedEvent().payload,
          report: {
            ...buildReportCreatedEvent().payload.report,
            ...(overrides?.audience ? { audience: overrides.audience } : {}),
            entities: [
              {
                entityType: ReportRelatedEntityType.AgentSession,
                entityId: AGENT_SESSION_ID,
                relation: ReportEntityRelation.Primary,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        },
      });

    it('emits exactly one session_report_ready candidate when monitoring is enabled', async () => {
      const { prisma, eventPublisher, service } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        monitoringEnabled: true,
        autoDecide: false,
      });

      await service.handleReportCreatedEvent(buildReportWithSession());

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionReportReady,
        );

      expect(sessionPublishes).toHaveLength(1);
      const published = sessionPublishes[0];
      expect(published.payload.userId).toBe(USER_ID);
      expect(published.payload.notification.entityType).toBe(
        EntityType.AgentSession,
      );
      expect(published.payload.notification.entityId).toBe(AGENT_SESSION_ID);
      expect(published.payload.notification.entityTitle).toBe(SESSION_TITLE);
      expect(published.payload.notification.payload).toEqual({
        sessionId: AGENT_SESSION_ID,
        reportId: REPORT_ID,
        sessionTitle: SESSION_TITLE,
        reportType: 'CODING_RESEARCH',
        reportTitle: 'Coding Research',
      });

      const candidateBuildCall = prisma.db.agentSession.findFirst.mock.calls
        .map((call: unknown[]) => call[0] as { select?: Record<string, true> })
        .find((arg) => arg?.select?.monitoringEnabled === true);
      expect(candidateBuildCall?.select).toEqual(
        expect.objectContaining({
          monitoringEnabled: true,
          autoDecide: true,
        }),
      );
    });

    it('does not emit session_report_ready when monitoring is disabled', async () => {
      const { prisma, eventPublisher, service } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        monitoringEnabled: false,
        autoDecide: false,
      });

      await service.handleReportCreatedEvent(buildReportWithSession());

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionReportReady,
        );

      expect(sessionPublishes).toHaveLength(0);
    });

    it('does not inspect monitored sessions for workflow-only reports', async () => {
      const { prisma, eventPublisher, service } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        monitoringEnabled: true,
        autoDecide: false,
      });

      await service.handleReportCreatedEvent(
        buildReportWithSession({ audience: ReportAudience.WorkflowOnly }),
      );

      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('does not emit session_report_ready when autoDecide is enabled', async () => {
      const { prisma, eventPublisher, service } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        monitoringEnabled: true,
        autoDecide: true,
      });

      await service.handleReportCreatedEvent(buildReportWithSession());

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionReportReady,
        );

      expect(sessionPublishes).toHaveLength(0);
    });

    it('emits session_report_ready when autoDecide is disabled (regression)', async () => {
      const { prisma, eventPublisher, service } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        monitoringEnabled: true,
        autoDecide: false,
      });

      await service.handleReportCreatedEvent(buildReportWithSession());

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionReportReady,
        );

      expect(sessionPublishes).toHaveLength(1);
    });
  });

  it('skips report notifications when report title is missing', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: USER_ID_2,
    });

    await service.handleReportCreatedEvent(
      buildReportCreatedEvent({
        payload: {
          ...buildReportCreatedEvent().payload,
          report: {
            ...buildReportCreatedEvent().payload.report,
            title: '   ',
          },
        },
      }),
    );

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('deduplicates task notifications by user and type in-window', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Write tests',
    });
    mockLinkedReport(prisma);

    const event = buildTaskStatusChangedEvent({
      payload: {
        ...buildTaskStatusChangedEvent().payload,
        newStatus: WorkStatus.Completed,
      },
    });
    await service.handleTaskStatusChangedEvent(event);
    await service.handleTaskStatusChangedEvent(event);

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('applies throttle limit per user for completed task notifications', async () => {
    process.env.NOTIFICATION_THROTTLE_MAX_PER_USER = '1';
    process.env.NOTIFICATION_THROTTLE_WINDOW_MS = '60000';
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Ship feature',
    });
    mockLinkedReport(prisma);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );
    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        id: 'task-event-id-2',
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          timestamp: new Date(Date.now() + 1000).toISOString(),
          newStatus: WorkStatus.Completed,
          previousStatus: WorkStatus.Active,
        },
      }),
    );

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('respects configured preference flags', async () => {
    process.env.NOTIFICATION_USER_PREFERENCES_JSON = JSON.stringify({
      [USER_ID]: { TASK_STATUS_CHANGED: false },
    });
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Blocked task',
    });
    mockLinkedReport(prisma);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('does not emit notifications for agent-session status changes', async () => {
    const { eventPublisher, service } = createService();
    const nonCompletedEvent = buildAgentSessionStatusChangedEvent({
      payload: {
        ...buildAgentSessionStatusChangedEvent().payload,
        newStatus: AgentSessionStatus.InProgress,
      },
    });

    await service.handleAgentSessionStatusChangedEvent(nonCompletedEvent);
    await service.handleAgentSessionStatusChangedEvent(
      buildAgentSessionStatusChangedEvent(),
    );

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('emits task.completed notification shape for completed task status', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Write tests',
    });
    mockLinkedReport(prisma);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
    expect(published?.payload.notification.eventType).toBe(
      NotificationEventType.TaskCompleted,
    );
    expect(published?.payload.notification.entityId).toBe(TASK_ID);
    expect(published?.payload.notification.entityType).toBe(EntityType.Task);
    expect(published?.payload.notification.entityTitle).toBe('Write tests');
    expect(published?.payload.reportId).toBe(REPORT_ID);
    expect(published?.payload.notification.affectedEntities[0]).toEqual({
      id: TASK_ID,
      type: EntityType.Task,
    });
  });

  it('skips completed task notifications when task title is missing', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: '   ',
    });

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('emits completed task notification without linked report reference', async () => {
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'No report linkage',
    });
    prisma.db.report.findFirst.mockResolvedValue(null);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
    expect(published?.payload.reportId).toBeUndefined();
  });

  it('continues processing other recipients when strict preference coverage fails for one user', async () => {
    process.env.NOTIFICATION_REQUIRE_PREFERENCES = 'true';
    process.env.NOTIFICATION_USER_PREFERENCES_JSON = JSON.stringify({
      [USER_ID]: { TASK_STATUS_CHANGED: true },
    });
    const { prisma, eventPublisher, service } = createService();
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: USER_ID_2,
      name: 'Scoped preferences task',
    });
    mockLinkedReport(prisma);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
    expect(published?.payload.userId).toBe(USER_ID);
  });

  it('uses redis-backed dedupe when redis client is available', async () => {
    const redisClient = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      get: jest.fn().mockResolvedValue('0'),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const { prisma, eventPublisher, service } = createService(redisClient);
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Redis dedupe',
    });
    mockLinkedReport(prisma);
    const completedTaskEvent = buildTaskStatusChangedEvent({
      payload: {
        ...buildTaskStatusChangedEvent().payload,
        newStatus: WorkStatus.Completed,
      },
    });

    await service.handleTaskStatusChangedEvent(completedTaskEvent);
    await service.handleTaskStatusChangedEvent(completedTaskEvent);

    expect(redisClient.set).toHaveBeenCalledTimes(2);
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('uses redis-backed throttle across event types for the same user', async () => {
    process.env.NOTIFICATION_THROTTLE_MAX_PER_USER = '1';
    process.env.NOTIFICATION_THROTTLE_WINDOW_MS = '60000';
    const redisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValueOnce('0').mockResolvedValueOnce('1'),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const { prisma, eventPublisher, service } = createService(redisClient);
    prisma.db.task.findFirst.mockResolvedValue({
      assigneeId: USER_ID,
      creatorId: null,
      name: 'Redis throttle',
    });
    mockLinkedReport(prisma);

    await service.handleTaskStatusChangedEvent(
      buildTaskStatusChangedEvent({
        payload: {
          ...buildTaskStatusChangedEvent().payload,
          newStatus: WorkStatus.Completed,
        },
      }),
    );
    await service.handleAgentSessionStatusChangedEvent(
      buildAgentSessionStatusChangedEvent(),
    );

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(redisClient.get).toHaveBeenCalledTimes(1);
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  describe('handleSystemMessageCreatedEvent', () => {
    type SystemMessageOverrides = {
      triggerNotification?: boolean;
      title?: string;
      response?: string;
      conversationId?: ConversationId;
    };

    const buildSystemMessageData = (
      overrides?: SystemMessageOverrides,
    ): SystemMessageData => {
      const data: Record<string, unknown> = {
        type: 'ANALYSIS',
        title: overrides?.title ?? 'Task completed',
        response: overrides?.response ?? 'Your task has been completed.',
      };
      // Use the `in` check so callers can opt out of the flag entirely
      // (sets the elevated wire field to undefined, exercising the
      // "flag absent" production path).
      if (overrides && 'triggerNotification' in overrides) {
        data.triggerNotification = overrides.triggerNotification;
      } else {
        data.triggerNotification = true;
      }
      return data as unknown as SystemMessageData;
    };

    // Drive the real publisher so the strip+elevate path runs end-to-end.
    // Returns the wire event AND seeds the messageService.getMessage mock
    // with the hydrated body the consumer refetches for the preview.
    const arrangeSystemMessage = (
      messageService: { getMessage: jest.Mock },
      overrides?: SystemMessageOverrides,
    ): MessageCreatedEvent => {
      const conversationId = overrides?.conversationId ?? CONVERSATION_ID;
      const data = buildSystemMessageData(overrides);
      const createMessage: CreateSystemMessage = {
        projectId: PROJECT_ID,
        type: MessageType.System,
        conversationId,
        data,
      } as unknown as CreateSystemMessage;

      const payload = buildMessageCreatedEventPayload({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        conversationId,
        message: createMessage,
      });

      messageService.getMessage.mockResolvedValue({
        id: MESSAGE_ID,
        type: MessageType.System,
        data,
      });

      return {
        id: 'system-msg-event-id',
        type: EVENT_TYPES.MESSAGE.CREATED as MessageCreatedEvent.TypeEnum,
        aggregateId: MESSAGE_ID,
        payload: {
          ...payload,
          timestamp: new Date().toISOString(),
        },
      };
    };

    it('emits notification when triggerNotification is true', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([
        { userId: USER_ID },
        { userId: USER_ID_2 },
      ]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(2);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      expect(published?.type).toBe(EVENT_TYPES.SYSTEM.NOTIFICATION);
      expect(published?.payload.notification.eventType).toBe(
        NotificationEventType.SystemMessage,
      );
      expect(published?.payload.notification.entityType).toBe(
        EntityType.Conversation,
      );
      expect(published?.payload.notification.entityId).toBe(CONVERSATION_ID);
    });

    it('notifies the creator before any USER message exists', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.conversation.findUnique.mockResolvedValue({
        createdBy: USER_ID,
      });
      prisma.db.message.groupBy.mockResolvedValue([]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(prisma.db.message.groupBy).toHaveBeenCalledWith({
        by: ['userId'],
        where: { conversationId: CONVERSATION_ID, type: 'USER' },
      });
    });

    it('unions creator and USER authors without duplicate recipients', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.conversation.findUnique.mockResolvedValue({
        createdBy: USER_ID,
      });
      prisma.db.message.groupBy.mockResolvedValue([
        { userId: USER_ID },
        { userId: USER_ID_2 },
      ]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(2);
    });

    it('skips notification when triggerNotification is false', async () => {
      const { eventPublisher, service, messageService } = createService();

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService, { triggerNotification: false }),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('skips notification when triggerNotification is undefined', async () => {
      const { eventPublisher, service, messageService } = createService();

      const event = arrangeSystemMessage(messageService, {
        triggerNotification: undefined,
      });

      await service.handleSystemMessageCreatedEvent(event);

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('regression: fires when the publisher elevates triggerNotification (no `data` on the wire)', async () => {
      // This test guarantees we route off the elevated payload root rather
      // than reaching into a `data` blob the producer has already stripped.
      // It builds the event through the real publisher; the consumer must
      // refetch the body for the preview.
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);

      const event = arrangeSystemMessage(messageService, {
        title: 'Wire-elevated trigger',
        response: 'Body refetched from the database.',
      });

      // Sanity-check the wire shape the consumer must reason about.
      expect(event.payload.triggerNotification).toBe(true);
      expect(
        (event.payload.message as unknown as { data?: unknown }).data,
      ).toBeUndefined();

      await service.handleSystemMessageCreatedEvent(event);

      expect(messageService.getMessage).toHaveBeenCalledWith(
        MESSAGE_ID,
        ORG_ID,
        false,
      );
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      expect(published?.payload.message).toBe(
        'Wire-elevated trigger: Body refetched from the database.',
      );
    });

    it('skips notification when no conversation participants found', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('includes title and response in notification preview', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService, {
          title: 'Design review ready',
          response: 'Please review the proposed architecture.',
        }),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      expect(published?.payload.message).toBe(
        'Design review ready: Please review the proposed architecture.',
      );
    });

    it('includes message and conversation in affected entities', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const affectedEntities = published?.payload.notification.affectedEntities;
      expect(affectedEntities).toEqual(
        expect.arrayContaining([
          { id: MESSAGE_ID, type: EntityType.Message },
          { id: CONVERSATION_ID, type: EntityType.Conversation },
        ]),
      );
    });

    it('does not throw when participant resolution fails', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockRejectedValue(
        new Error('database connection lost'),
      );

      await expect(
        service.handleSystemMessageCreatedEvent(
          arrangeSystemMessage(messageService),
        ),
      ).resolves.toBeUndefined();

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('truncates long response snippets to 200 characters', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      const longResponse = 'x'.repeat(300);

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService, { response: longResponse }),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const snippet = published?.payload.message.split(': ')[1];
      expect(snippet).toBe('x'.repeat(200) + '...');
    });

    it('includes aboutType and aboutId from conversation context', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'design-doc',
        workflowAboutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      });

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('design-doc');
      expect(payload.aboutId).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      expect(payload.planId).toBeUndefined();
      expect(payload.initiativeId).toBeUndefined();
    });

    it('resolves planId and initiativeId for task-about conversations', async () => {
      const PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'task',
        workflowAboutId: TASK_ID,
      });
      prisma.db.task.findFirst.mockImplementation(async ({ where }) =>
        where.id === PLAN_ID
          ? {
              id: PLAN_ID,
              type: 'PLAN',
              parentTaskId: null,
              projectId: PROJECT_ID,
            }
          : {
              id: TASK_ID,
              type: 'STANDARD',
              parentTaskId: PLAN_ID,
              projectId: PROJECT_ID,
              initiativeId: INITIATIVE_ID,
            },
      );

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('task');
      expect(payload.aboutId).toBe(TASK_ID);
      expect(payload.planId).toBe(PLAN_ID);
      expect(payload.initiativeId).toBe(INITIATIVE_ID);
    });

    it('does not infer plan membership from an initiative conversation', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'initiative',
        workflowAboutId: INITIATIVE_ID,
      });

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('initiative');
      expect(payload.aboutId).toBe(INITIATIVE_ID);
      expect(payload.planId).toBeUndefined();
      expect(prisma.db.task.findFirst).not.toHaveBeenCalled();
    });

    it('omits navigation context when conversation has no workflowAboutType', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: null,
        workflowAboutId: null,
      });

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBeUndefined();
      expect(payload.aboutId).toBeUndefined();
      expect(payload.planId).toBeUndefined();
    });

    it('includes aboutType without planId when task has no PLAN ancestor', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'task',
        workflowAboutId: TASK_ID,
      });
      prisma.db.task.findFirst.mockResolvedValue({
        id: TASK_ID,
        type: 'STANDARD',
        parentTaskId: null,
        projectId: PROJECT_ID,
        initiativeId: INITIATIVE_ID,
      });

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('task');
      expect(payload.aboutId).toBe(TASK_ID);
      expect(payload.planId).toBeUndefined();
      expect(payload.initiativeId).toBe(INITIATIVE_ID);
    });

    it('resolves task context from agent-session aboutType', async () => {
      const PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'agent-session',
        workflowAboutId: AGENT_SESSION_ID,
      });
      prisma.db.agentSession.findFirst.mockResolvedValue({
        entityType: 'TASK',
        entityId: TASK_ID,
      });
      prisma.db.task.findFirst.mockImplementation(async ({ where }) =>
        where.id === PLAN_ID
          ? {
              id: PLAN_ID,
              type: 'PLAN',
              parentTaskId: null,
              projectId: PROJECT_ID,
            }
          : {
              id: TASK_ID,
              type: 'STANDARD',
              parentTaskId: PLAN_ID,
              projectId: PROJECT_ID,
              initiativeId: INITIATIVE_ID,
            },
      );

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('task');
      expect(payload.aboutId).toBe(TASK_ID);
      expect(payload.planId).toBe(PLAN_ID);
      expect(payload.initiativeId).toBe(INITIATIVE_ID);
    });

    it('falls back to initiative context when agent-session has no task', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      prisma.db.message.groupBy.mockResolvedValue([{ userId: USER_ID }]);
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowAboutType: 'agent-session',
        workflowAboutId: AGENT_SESSION_ID,
      });
      prisma.db.agentSession.findFirst.mockResolvedValue({
        entityType: 'INITIATIVE',
        entityId: INITIATIVE_ID,
      });

      await service.handleSystemMessageCreatedEvent(
        arrangeSystemMessage(messageService),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const published = eventPublisher.publish.mock.calls[0]?.[0] as any;
      const payload = published?.payload.notification.payload;
      expect(payload.aboutType).toBe('initiative');
      expect(payload.aboutId).toBe(INITIATIVE_ID);
      expect(payload.initiativeId).toBe(INITIATIVE_ID);
      expect(payload.planId).toBeUndefined();
    });
  });

  describe('handleSessionMonitorMessageEvent', () => {
    const SESSION_TITLE = 'Refactor API tests';
    const NODE_ID = 'session_monitor';
    const FLOW_ID = 'agent-session';
    const TRIGGER_MESSAGE_ID =
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as MessageId;

    const buildSessionMonitorEvent = (
      data: Record<string, unknown>,
    ): MessageCreatedEvent => ({
      id: 'session-monitor-event-id',
      type: EVENT_TYPES.MESSAGE.CREATED as MessageCreatedEvent.TypeEnum,
      aggregateId: MESSAGE_ID,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.CREATED,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        messageDataType:
          typeof data?.type === 'string' ? (data.type as string) : undefined,
        message: {
          projectId: PROJECT_ID,
          type: MessageType.System,
          conversationId: CONVERSATION_ID,
          shouldProcess: false,
        } as any,
        timestamp: new Date().toISOString(),
      },
    });

    const mockSessionMonitorHydrate = (
      messageService: { getMessage: jest.Mock },
      data: Record<string, unknown>,
    ) => {
      messageService.getMessage.mockResolvedValue({
        id: MESSAGE_ID,
        projectId: PROJECT_ID,
        type: 'SYSTEM',
        conversationId: CONVERSATION_ID,
        data,
      });
    };

    const baseMonitorData = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      type: 'SESSION_MONITOR',
      response: 'session monitor response',
      agentIdentity: 'session-monitor',
      content: 'Continuing with the next stage.',
      reportId: REPORT_ID,
      flowId: FLOW_ID,
      nodeId: NODE_ID,
      ...overrides,
    });

    const mockAgentSessionLookup = (
      prisma: ReturnType<typeof createMockPrismaService>,
    ) => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
      });
    };

    it('EVALUATING: accepts progress message without notification, continuation, or failure side effects', async () => {
      const {
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();

      const data = baseMonitorData({ state: 'EVALUATING' });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        flowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
      expect(
        pendingTriggerService.resolvePendingTriggerForNode,
      ).not.toHaveBeenCalled();
    });

    it('rejects EVALUATING with a terminal outcome (schema enforcement)', async () => {
      const { eventPublisher, service, messageService } = createService();

      const data = baseMonitorData({
        state: 'EVALUATING',
        outcome: 'DEFERRED',
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).toHaveBeenCalledTimes(1);
      const [createDto, orgId, source] =
        messageService.addMessage.mock.calls[0]!;
      expect(orgId).toBe(ORG_ID);
      expect(source).toBe('session-monitor-hook-failure');
      expect(createDto.type).toBe('SYSTEM');
      expect(createDto.data.type).toBe('ERROR');
      expect(createDto.data.response).toContain(
        'state=EVALUATING forbids outcome',
      );
    });

    it('CONTINUED action-bearing evidence emits session_auto_decided without enacting completion', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();
      mockAgentSessionLookup(prisma);
      flowExecutionService.findActiveByConversation.mockResolvedValue({
        id: 'exec-id',
        flowId: FLOW_ID,
        status: 'IN_PROGRESS',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      });
      pendingTriggerService.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: TRIGGER_MESSAGE_ID,
      });

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'RESOLVED',
          response: 'looks good',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionAutoDecided,
        );
      expect(sessionPublishes).toHaveLength(1);
      expect(sessionPublishes[0]?.payload.notification.payload).toEqual({
        sessionId: AGENT_SESSION_ID,
        reportId: REPORT_ID,
      });

      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        flowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
      expect(
        pendingTriggerService.resolvePendingTriggerForNode,
      ).not.toHaveBeenCalled();
    });

    it('CONTINUED action-bearing evidence never treats its action as authority', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
        nodeExecutionService,
      } = createService();
      mockAgentSessionLookup(prisma);
      flowExecutionService.findActiveByConversation.mockResolvedValue({
        id: 'exec-id',
        flowId: FLOW_ID,
        status: 'IN_PROGRESS',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      });
      pendingTriggerService.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: TRIGGER_MESSAGE_ID,
      });
      nodeExecutionService.getNode.mockReturnValue({
        node: { type: 'external_agent', actions: { RESOLVED: {} } },
      });

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'NOT_REAL',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(nodeExecutionService.getNode).not.toHaveBeenCalled();
    });

    it('CONTINUED evidence does not re-evaluate terminal policy', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();
      flowExecutionService.findActiveByConversation.mockResolvedValue({
        id: 'exec-id',
        flowId: FLOW_ID,
        status: 'IN_PROGRESS',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      });
      pendingTriggerService.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: TRIGGER_MESSAGE_ID,
      });
      prisma.db.report.findFirst.mockResolvedValue({
        id: REPORT_ID,
        reportType: ReportType.Implement,
        reportEntities: [
          { entityType: EntityType.AgentSession, entityId: AGENT_SESSION_ID },
        ],
      });
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          sessionMonitorTerminalPolicy: {
            implementationDone: {
              completion: { action: 'DONE' },
            },
            reviewDone: {
              completion: { action: 'DONE' },
            },
          },
        },
      });

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'RESOLVED',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(prisma.db.report.findFirst).not.toHaveBeenCalled();
    });

    it('CONTINUED REVIEW evidence remains notification-only', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();
      flowExecutionService.findActiveByConversation.mockResolvedValue({
        id: 'exec-id',
        flowId: FLOW_ID,
        status: 'IN_PROGRESS',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      });
      pendingTriggerService.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: TRIGGER_MESSAGE_ID,
      });
      prisma.db.report.findFirst.mockResolvedValue({
        id: REPORT_ID,
        reportType: ReportType.Review,
        reportEntities: [
          { entityType: EntityType.AgentSession, entityId: AGENT_SESSION_ID },
        ],
      });
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          sessionMonitorTerminalPolicy: {
            implementationDone: { requestReview: true },
            reviewDone: {
              completion: { action: 'DONE' },
            },
          },
        },
      });

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'RESOLVED',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(prisma.db.report.findFirst).not.toHaveBeenCalled();
    });

    it('CONTINUED IMPLEMENT evidence remains notification-only when review is required', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();
      flowExecutionService.findActiveByConversation.mockResolvedValue({
        id: 'exec-id',
        flowId: FLOW_ID,
        status: 'IN_PROGRESS',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      });
      pendingTriggerService.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: TRIGGER_MESSAGE_ID,
      });
      prisma.db.report.findFirst.mockResolvedValue({
        id: REPORT_ID,
        reportType: ReportType.Implement,
        reportEntities: [
          { entityType: EntityType.AgentSession, entityId: AGENT_SESSION_ID },
        ],
      });
      prisma.db.agentSession.findFirst.mockResolvedValue({
        id: AGENT_SESSION_ID,
        userId: USER_ID,
        title: SESSION_TITLE,
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          sessionMonitorTerminalPolicy: {
            implementationDone: { requestReview: true },
            reviewDone: {
              completion: { action: 'DONE' },
            },
          },
        },
      });

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'RESOLVED',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(prisma.db.report.findFirst).not.toHaveBeenCalled();
    });

    it('CONTINUED response-only evidence emits session_auto_decided without synthesizing USER input', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
      } = createService();
      mockAgentSessionLookup(prisma);
      prisma.db.conversation.findFirst.mockResolvedValue({
        lastModifiedBy: USER_ID,
      });
      flowExecutionService.findActiveByConversation.mockResolvedValue(null);

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          response: 'Please continue with stage 2.',
          optionIndex: 2,
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionAutoDecided,
        );
      expect(sessionPublishes).toHaveLength(1);

      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        flowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
    });

    it('CONTINUED response-only evidence does not execute when workflow metadata is absent', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
      } = createService();
      mockAgentSessionLookup(prisma);
      prisma.db.conversation.findFirst.mockResolvedValue({
        lastModifiedBy: USER_ID,
      });
      flowExecutionService.findActiveByConversation.mockResolvedValue(null);

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          response: 'Pick up the feature sync response.',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        flowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
    });

    it('CONTINUED response-only evidence skips notification when no recipient can be resolved', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
      } = createService();
      prisma.db.agentSession.findFirst.mockResolvedValue(null);
      prisma.db.conversation.findFirst.mockResolvedValue({
        lastModifiedBy: null,
      });
      flowExecutionService.findActiveByConversation.mockResolvedValue(null);

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          response: 'Continue without an author.',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
    });

    it('DEFERRED: emits session_review_needed only — no completion or USER message', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
        pendingTriggerService,
      } = createService();
      mockAgentSessionLookup(prisma);

      const data = baseMonitorData({ outcome: 'DEFERRED' });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      const sessionPublishes = eventPublisher.publish.mock.calls
        .map((call: unknown[]) => call[0] as any)
        .filter(
          (evt) =>
            evt?.payload?.notification?.eventType ===
            NotificationEventType.SessionReviewNeeded,
        );
      expect(sessionPublishes).toHaveLength(1);
      expect(sessionPublishes[0]?.payload.notification.payload).toEqual({
        sessionId: AGENT_SESSION_ID,
        reportId: REPORT_ID,
      });

      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        flowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
      expect(
        pendingTriggerService.resolvePendingTriggerForNode,
      ).not.toHaveBeenCalled();
    });

    it('CONTINUED evidence emits notification without consulting enactment state', async () => {
      const {
        prisma,
        eventPublisher,
        service,
        messageService,
        flowExecutionService,
      } = createService();
      mockAgentSessionLookup(prisma);
      flowExecutionService.findActiveByConversation.mockResolvedValue(null);

      const data = baseMonitorData({
        outcome: 'CONTINUED',
        continuationCompletion: {
          action: 'RESOLVED',
          response: 'looks good',
        },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(messageService.addMessage).not.toHaveBeenCalled();
    });

    it('rejects CONTINUED with no continuationCompletion (schema enforcement)', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      mockAgentSessionLookup(prisma);

      const data = baseMonitorData({ outcome: 'CONTINUED' });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      // Notification + enactment both skipped; observability message written
      // to the conversation via MessageService.
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).toHaveBeenCalledTimes(1);
      const [createDto] = messageService.addMessage.mock.calls[0]!;
      expect(createDto.type).toBe('SYSTEM');
      expect(createDto.data.type).toBe('ERROR');
    });

    it('rejects DEFERRED with a continuationCompletion present (schema enforcement)', async () => {
      const { prisma, eventPublisher, service, messageService } =
        createService();
      mockAgentSessionLookup(prisma);

      const data = baseMonitorData({
        outcome: 'DEFERRED',
        continuationCompletion: { response: 'shouldnt be here' },
      });
      mockSessionMonitorHydrate(messageService, data);

      await service.handleSessionMonitorMessageEvent(
        buildSessionMonitorEvent(data),
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).toHaveBeenCalledTimes(1);
      const [createDto] = messageService.addMessage.mock.calls[0]!;
      expect(createDto.data.type).toBe('ERROR');
    });

    it('does nothing when the message is not SESSION_MONITOR (messageDataType gate)', async () => {
      const { eventPublisher, service, messageService } = createService();

      await service.handleSessionMonitorMessageEvent({
        id: 'wrong-type-evt',
        type: EVENT_TYPES.MESSAGE.CREATED as MessageCreatedEvent.TypeEnum,
        aggregateId: MESSAGE_ID,
        payload: {
          payloadType: EVENT_TYPES.MESSAGE.CREATED,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          messageDataType: 'ANALYSIS',
          message: {
            projectId: PROJECT_ID,
            type: MessageType.System,
            conversationId: CONVERSATION_ID,
            shouldProcess: false,
          } as any,
          timestamp: new Date().toISOString(),
        },
      });

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(messageService.getMessage).not.toHaveBeenCalled();
    });
  });
});
