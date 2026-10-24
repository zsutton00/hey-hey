import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AgentSession, Prisma } from '@prisma/client';
import { AgentSessionService } from '../agent-session.service';
import {
  createMockConversationWorkflowService,
  createMockConversationService,
  createMockDomainEventPublisher,
  createMockPrismaService,
} from '../../utils/testUtils';
import { ConversationWorkflowService } from '../workflows/conversation-workflow.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { UnsupportedWorkflowTypeError } from '../../core/exceptions/workflow.exceptions';
import {
  AgentSessionConfigEntityConversationV1,
  AgentSessionConfigProjectReportV1,
  AgentSessionConfigV2,
  AgentSessionType,
  WorkflowName,
} from '../../generated';

const sessionId1 = '11111111-1111-4111-8111-111111111111';
const sessionId2 = '22222222-2222-4222-8222-222222222222';
const sessionId3 = '33333333-3333-4333-8333-333333333333';
const coordinatorWorkItemId = '44444444-4444-4444-8444-444444444444';
const userId1 = '77777777-7777-4777-8777-777777777777';
const userId2 = '88888888-8888-4888-8888-888888888888';

const buildAgentSession = (
  overrides: Partial<AgentSession> = {},
): AgentSession => ({
  id: sessionId1,
  organizationId: 'org-1',
  projectId: 'proj-1',
  userId: 'user-1',
  machineId: null,
  status: 'NOT_STARTED',
  sessionDate: new Date('2026-07-18T12:00:00.000Z'),
  title: 'Task Monitor coordinator',
  serviceId: null,
  provider: null,
  providerAgentSessionId: null,
  conversationId: null,
  entityType: 'TASK',
  entityId: coordinatorWorkItemId,
  lastSyncedAt: null,
  hasUnsyncedChanges: false,
  contextSizeTokens: null,
  contextSizeRunId: null,
  contextSizeProviderSessionId: null,
  contextSizeObservedAt: null,
  contextSizeMaxTokens: null,
  monitoringEnabled: true,
  autoDecide: false,
  type: 'CODING',
  config: null,
  createdAt: new Date('2026-07-18T12:00:00.000Z'),
  updatedAt: new Date('2026-07-18T12:00:00.000Z'),
  ...overrides,
});

const buildPaginatedRow = (overrides: Record<string, unknown> = {}) => ({
  id: sessionId1,
  organizationId: 'org-1',
  projectId: 'proj-1',
  userId: 'user-1',
  machineId: null,
  status: 'IN_PROGRESS',
  sessionDate: new Date('2026-07-17T10:00:00.000Z'),
  serviceId: null,
  provider: 'codex',
  providerAgentSessionId: 'provider-session-1',
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  entityType: 'TASK',
  entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Implement pagination',
  lastSyncedAt: null,
  hasUnsyncedChanges: false,
  monitoringEnabled: true,
  autoDecide: false,
  type: 'CODING',
  config: null,
  createdAt: new Date('2026-07-17T09:00:00.000Z'),
  updatedAt: new Date('2026-07-17T10:00:00.000Z'),
  joinedServiceId: null,
  joinedServiceName: null,
  selectedServiceIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  selectedServices: [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'API',
    },
  ],
  lastMessageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  lastMessageConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lastMessageType: 'SYSTEM',
  lastMessageStatus: 'completed',
  lastMessageData: {
    type: 'ANALYSIS',
    response: 'Implemented the endpoint',
  },
  lastMessageAt: new Date('2026-07-17T12:00:00.000Z'),
  lastMessageCreatedAt: new Date('2026-07-17T12:00:00.000Z'),
  parentEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  parentEntityType: 'TASK',
  parentEntityName: 'Add paginated listing',
  ...overrides,
});

describe('AgentSessionService', () => {
  const now = new Date('2024-01-01T12:00:00Z');
  let prisma: ReturnType<typeof createMockPrismaService>;
  let eventPublisher: ReturnType<typeof createMockDomainEventPublisher>;
  let conversationWorkflowService: ReturnType<
    typeof createMockConversationWorkflowService
  >;
  let reportService: { loadReportsForMessageIds: jest.Mock };
  let conversationService: ReturnType<typeof createMockConversationService>;
  let workItemTypeRegistry: { getDefinition: jest.Mock };
  let service: AgentSessionService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    eventPublisher = createMockDomainEventPublisher();
    conversationWorkflowService = createMockConversationWorkflowService();
    reportService = {
      loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
    };
    conversationService = createMockConversationService();
    workItemTypeRegistry = {
      getDefinition: jest.fn(),
    };
    service = new AgentSessionService(
      prisma as any,
      eventPublisher as any,
      conversationWorkflowService as any,
      { registerEntity: jest.fn().mockResolvedValue(undefined) } as any,
      reportService as any,
      undefined,
      undefined,
      conversationService as any,
      workItemTypeRegistry as any,
    );
  });

  describe('resolveWorkItemCoordinator', () => {
    const dto = {
      sessionDate: '2026-07-18T12:00:00.000Z',
      type: 'CODING' as const,
      workItemType: 'TASK_MONITOR',
      workItemId: coordinatorWorkItemId,
      title: 'Task Monitor coordinator',
    };

    it('reuses the Agent Session stored in the durable work-item association', async () => {
      const existing = buildAgentSession({
        conversationId: '55555555-5555-4555-8555-555555555555',
      });
      prisma.db.task.findFirst.mockResolvedValue({ type: 'TASK_MONITOR' });
      prisma.db.$queryRaw.mockResolvedValue([{ agentSessionId: existing.id }]);
      prisma.db.agentSession.findFirst.mockResolvedValue(existing);

      const result = await service.resolveWorkItemCoordinator(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        dto,
      );

      expect(result.created).toBe(false);
      expect(result.agentSession.id).toBe(existing.id);
      expect(result.agentSession.conversationId).toBe(existing.conversationId);
      const lockQuery = prisma.db.$queryRaw.mock.calls[0][0] as {
        strings: string[];
      };
      expect(lockQuery.strings.join('')).toContain(
        'pg_advisory_xact_lock(\n              hashtextextended(, 0)\n            )::text AS "lockAcquired"',
      );
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
      expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
    });

    it('creates and associates the first canonical coordinator atomically', async () => {
      const created = buildAgentSession();
      prisma.db.task.findFirst.mockResolvedValue({ type: 'TASK_MONITOR' });
      prisma.db.$queryRaw.mockResolvedValue([]);
      prisma.db.agentSession.create.mockResolvedValue(created);

      const result = await service.resolveWorkItemCoordinator(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        dto,
      );

      expect(result.created).toBe(true);
      expect(result.agentSession.id).toBe(created.id);
      expect(prisma.db.agentSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          type: 'CODING',
          entityType: 'TASK',
          entityId: coordinatorWorkItemId,
        }),
      });
      expect(prisma.db.$executeRaw).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'agent_session.created',
          aggregateId: created.id,
        }),
      );
    });

    it('rejects a missing owning work item before querying or creating identity', async () => {
      prisma.db.task.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveWorkItemCoordinator(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          dto,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('rejects a mismatched work-item type before resolving identity', async () => {
      prisma.db.task.findFirst.mockResolvedValue({ type: 'STANDARD' });

      await expect(
        service.resolveWorkItemCoordinator(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          dto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('creates only once when concurrent resolutions are transactionally serialized', async () => {
      const created = buildAgentSession();
      let associationAgentSessionId: string | undefined;
      let transactionTail = Promise.resolve();

      prisma.db.task.findFirst.mockResolvedValue({ type: 'TASK_MONITOR' });
      prisma.db.$queryRaw.mockImplementation(async () =>
        associationAgentSessionId
          ? [{ agentSessionId: associationAgentSessionId }]
          : [],
      );
      prisma.db.agentSession.create.mockImplementation(async () => {
        associationAgentSessionId = created.id;
        return created;
      });
      prisma.db.agentSession.findFirst.mockResolvedValue(created);
      prisma.db.$transaction.mockImplementation(
        (callback: (tx: typeof prisma.db) => Promise<unknown>) => {
          const result = transactionTail.then(() => callback(prisma.db));
          transactionTail = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      );

      const results = await Promise.all([
        service.resolveWorkItemCoordinator(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          dto,
        ),
        service.resolveWorkItemCoordinator(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          dto,
        ),
      ]);

      expect(prisma.db.agentSession.create).toHaveBeenCalledTimes(1);
      expect(results.map((result) => result.agentSession.id)).toEqual([
        created.id,
        created.id,
      ]);
      expect(results.map((result) => result.created)).toEqual([true, false]);
    });
  });

  it('adds only missing Agent Session Service links and returns the persisted union', async () => {
    const launchServiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const addedServiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const machineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const initial = {
      ...buildAgentSession({
        id: sessionId1,
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId,
        serviceId: launchServiceId,
      }),
      serviceRelations: [{ serviceId: launchServiceId }],
    };
    const persisted = {
      ...initial,
      serviceRelations: [
        { serviceId: launchServiceId },
        { serviceId: addedServiceId },
      ],
    };
    prisma.db.agentSession.findFirst.mockResolvedValue(initial);
    prisma.db.agentSession.findUnique.mockResolvedValue(persisted);
    prisma.db.service.findMany.mockResolvedValue([
      { id: addedServiceId, projectId: 'proj-1' },
    ]);

    const result = await service.grantServices({
      organizationId: 'org-1' as any,
      projectId: 'proj-1' as any,
      agentSessionId: sessionId1,
      userId: 'user-1' as any,
      grant: {
        machineId,
        launchServiceId,
        serviceIds: [addedServiceId],
      },
      liveBoundServiceIds: [addedServiceId],
    });

    expect(prisma.db.serviceAgentSession.createMany).toHaveBeenCalledWith({
      data: [{ agentSessionId: sessionId1, serviceId: addedServiceId }],
      skipDuplicates: true,
    });
    expect(result.serviceIds).toEqual([launchServiceId, addedServiceId]);
    expect(result.launchServiceId).toBe(launchServiceId);
  });

  it('rejects an unbound Service before mutating durable Agent Session scope', async () => {
    await expect(
      service.grantServices({
        organizationId: 'org-1' as any,
        projectId: 'proj-1' as any,
        agentSessionId: sessionId1,
        userId: 'user-1' as any,
        grant: {
          machineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          launchServiceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          serviceIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
        },
        liveBoundServiceIds: [],
      }),
    ).rejects.toThrow(
      'Every granted Service must have a live binding on the authenticated machine',
    );

    expect(prisma.db.$transaction).not.toHaveBeenCalled();
    expect(prisma.db.serviceAgentSession.createMany).not.toHaveBeenCalled();
  });

  describe('grantServices launch anchor', () => {
    const firstServiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondServiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const machineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const grant = (
      overrides: Partial<{
        launchServiceId: string;
        machineId: string;
        serviceIds: string[];
      }> = {},
    ) =>
      service.grantServices({
        organizationId: 'org-1' as any,
        projectId: 'proj-1' as any,
        agentSessionId: sessionId1,
        userId: 'user-1' as any,
        grant: {
          machineId,
          launchServiceId: firstServiceId,
          serviceIds: [firstServiceId, secondServiceId],
          ...overrides,
        },
        liveBoundServiceIds: [firstServiceId, secondServiceId],
      });
    const anchorless = () => ({
      ...buildAgentSession({
        id: sessionId1,
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId,
        serviceId: null,
      }),
      serviceRelations: [],
    });

    beforeEach(() => {
      prisma.db.service.findMany.mockResolvedValue([
        { id: firstServiceId, projectId: 'proj-1' },
        { id: secondServiceId, projectId: 'proj-1' },
      ]);
    });

    it('promotes the granted launch Service on a session with no launch Service', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(anchorless());
      prisma.db.agentSession.findUnique.mockResolvedValue({
        ...anchorless(),
        serviceId: firstServiceId,
        serviceRelations: [
          { serviceId: firstServiceId },
          { serviceId: secondServiceId },
        ],
      });

      const result = await grant();

      expect(prisma.db.agentSession.update).toHaveBeenCalledWith({
        where: { id: sessionId1 },
        data: { serviceId: firstServiceId },
      });
      expect(result.launchServiceId).toBe(firstServiceId);
      expect(result.serviceIds).toEqual([firstServiceId, secondServiceId]);
    });

    it('preserves an existing launch Service', async () => {
      const anchored = {
        ...anchorless(),
        serviceId: firstServiceId,
        serviceRelations: [{ serviceId: firstServiceId }],
      };
      prisma.db.agentSession.findFirst.mockResolvedValue(anchored);
      prisma.db.agentSession.findUnique.mockResolvedValue({
        ...anchored,
        serviceRelations: [
          { serviceId: firstServiceId },
          { serviceId: secondServiceId },
        ],
      });

      const result = await grant({ serviceIds: [secondServiceId] });

      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
      expect(result.launchServiceId).toBe(firstServiceId);
    });

    it('rejects a launch Service that is not granted on an anchorless session', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(anchorless());

      await expect(
        grant({
          launchServiceId: firstServiceId,
          serviceIds: [secondServiceId],
        }),
      ).rejects.toThrow(
        'launchServiceId must be one of the granted Services when the Agent Session has no launch Service',
      );
      expect(prisma.db.serviceAgentSession.createMany).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('rejects a grant from a different machine', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(anchorless());

      await expect(
        grant({ machineId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      ).rejects.toThrow(
        'The authenticated machine does not match the Agent Session binding',
      );
      expect(prisma.db.serviceAgentSession.createMany).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });
  });

  it('creates a agent session with null conversationId and does not invoke conversation factory', async () => {
    const created: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Session',
        type: 'CODING',
      },
    );

    expect(prisma.db.agentSession.create).toHaveBeenCalled();
    expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.created',
        aggregateId: 'cs-1',
        payload: expect.objectContaining({
          payloadType: 'agent_session.created',
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: null,
          userId: 'user-1',
          agentSession: expect.objectContaining({
            id: 'cs-1',
          }),
        }),
      }),
    );
    expect(result.id).toBe('cs-1');
    expect(result.conversationId).toBeNull();
    expect(result.status).toBe('NOT_STARTED');
    expect(result.sessionDate).toBe(now.toISOString());
  });

  it('round-trips the dedicated graph-only project report config', async () => {
    const config = {
      type: 'PROJECT_REPORT',
      version: 'v1',
      requestId: sessionId2,
      attemptId: sessionId3,
      model: 'configured-model',
      fastMode: false,
    } satisfies AgentSessionConfigProjectReportV1;
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.create.mockImplementation(
      ({ data }: { data: { config: Prisma.JsonValue } }) =>
        Promise.resolve(
          buildAgentSession({
            type: 'PROJECT_REPORT',
            config: data.config,
            entityType: null,
            entityId: null,
          }),
        ),
    );
    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Project report',
        type: AgentSessionType.ProjectReport,
        config,
      },
    );
    expect(result.config).toEqual(config);
    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ config, type: 'PROJECT_REPORT' }),
      }),
    );
  });

  it('atomically binds a new Agent Session when the workflow and execution identities differ', async () => {
    const config = {
      type: AgentSessionConfigV2.TypeEnum.CodingSession,
      version: AgentSessionConfigV2.VersionEnum.V2,
      model: 'gpt-5.6-codex',
      effort: 'high',
      fastMode: false,
    } satisfies AgentSessionConfigV2;
    const created = {
      ...buildAgentSession({
        id: sessionId1,
        conversationId: 'conversation-1',
        serviceId: 'service-1',
        provider: 'codex',
        config,
        entityType: null,
        entityId: null,
      }),
      serviceRelations: [{ serviceId: 'service-1' }],
    };
    prisma.db.$queryRaw.mockResolvedValue([{ lockAcquired: '1' }]);
    prisma.db.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      workflowName: WorkflowName.RepositoryImport,
      flowExecutions: [
        {
          flowId: WorkflowName.RepositoryImport,
          currentNode: 'onboarding-repository-grounding-analysis',
          flowState: { context: { repositoryGrounding: {} } },
        },
      ],
    });
    prisma.db.agentSession.findFirst.mockResolvedValue(null);
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-1' });
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', projectId: 'proj-1' },
    ]);
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Repository analysis',
        type: AgentSessionType.Coding,
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'codex',
        config,
        existingWorkflowBinding: {
          conversationId: 'conversation-1' as any,
          workflowId: 'workflow-1' as any,
        },
      },
    );

    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.db.conversation.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'conversation-1',
        workflowId: 'workflow-1',
        workflowName: {
          in: [
            WorkflowName.RepositoryImport,
            WorkflowName.WorkTrackerImport,
            WorkflowName.Onboarding,
          ],
        },
        flowExecutions: {
          some: {
            conversationId: 'conversation-1',
            organizationId: 'org-1',
            projectId: 'proj-1',
            userId: 'user-1',
            flowId: {
              in: [
                WorkflowName.RepositoryImport,
                WorkflowName.WorkTrackerImport,
                WorkflowName.Onboarding,
              ],
            },
          },
        },
      }),
      select: expect.objectContaining({
        id: true,
        workflowName: true,
        flowExecutions: expect.objectContaining({
          where: {
            conversationId: 'conversation-1',
            organizationId: 'org-1',
            projectId: 'proj-1',
            userId: 'user-1',
            flowId: {
              in: [
                WorkflowName.RepositoryImport,
                WorkflowName.WorkTrackerImport,
                WorkflowName.Onboarding,
              ],
            },
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
        }),
      }),
    });
    expect(prisma.db.agentSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversation: { connect: { id: 'conversation-1' } },
        service: { connect: { id: 'service-1' } },
        provider: 'codex',
        config,
      }),
    });
    expect(result.id).toBe(sessionId1);
    expect(result.conversationId).toBe('conversation-1');
  });

  it('reuses the exact Agent Session already bound to a repository import workflow', async () => {
    const config = {
      type: AgentSessionConfigV2.TypeEnum.CodingSession,
      version: AgentSessionConfigV2.VersionEnum.V2,
      model: 'gpt-5.6-codex',
      effort: 'high',
    } satisfies AgentSessionConfigV2;
    const existing = {
      ...buildAgentSession({
        id: sessionId1,
        conversationId: 'conversation-1',
        serviceId: 'service-1',
        provider: 'codex',
        config,
      }),
      serviceRelations: [{ serviceId: 'service-1' }],
    };
    prisma.db.$queryRaw.mockResolvedValue([{ lockAcquired: '1' }]);
    prisma.db.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      workflowName: WorkflowName.RepositoryImport,
      flowExecutions: [
        {
          flowId: WorkflowName.RepositoryImport,
          currentNode: 'onboarding-repository-grounding-analysis',
          flowState: { context: { repositoryGrounding: {} } },
        },
      ],
    });
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Repository analysis',
        type: AgentSessionType.Coding,
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'codex',
        config,
        existingWorkflowBinding: {
          conversationId: 'conversation-1' as any,
          workflowId: 'workflow-1' as any,
        },
      },
    );

    expect(result.id).toBe(sessionId1);
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
  });

  it('rejects an existing workflow binding not owned by the caller', async () => {
    prisma.db.$queryRaw.mockResolvedValue([{ lockAcquired: '1' }]);
    prisma.db.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        type: AgentSessionType.Coding,
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'codex',
        config: {
          type: AgentSessionConfigV2.TypeEnum.CodingSession,
          version: AgentSessionConfigV2.VersionEnum.V2,
          model: 'gpt-5.6-codex',
          effort: 'high',
        },
        existingWorkflowBinding: {
          conversationId: 'conversation-1' as any,
          workflowId: 'workflow-1' as any,
        },
      }),
    ).rejects.toThrow(
      'The repository import workflow is not owned by the caller in this project',
    );
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('creates a DAILY_SESSION type session with null conversationId', async () => {
    const created: AgentSession = {
      id: 'cs-2',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Daily Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'DAILY_SESSION',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Daily Session',
        type: 'DAILY_SESSION',
      },
    );

    expect(prisma.db.agentSession.create).toHaveBeenCalled();
    expect(result.conversationId).toBeNull();
    expect(result.type).toBe('DAILY_SESSION');
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.created',
        payload: expect.objectContaining({
          type: 'DAILY_SESSION',
          conversationId: null,
          projectId: 'proj-1',
        }),
      }),
    );
  });

  describe('project MODE capture', () => {
    const modeId = '10000000-0000-4000-8000-000000000101';
    const focalTaskId = '10000000-0000-4000-8000-000000000102';
    const filesDefinition = [
      { key: 'description', label: 'Catalog description', kind: 'markdown' },
      {
        key: 'files',
        label: 'Files',
        kind: 'json',
        schemaRef: '#/components/schemas/ProjectModeFiles',
      },
    ];
    const createDto = () => ({
      projectId: 'proj-1' as any,
      sessionDate: now.toISOString(),
      title: 'Project mode session',
      type: AgentSessionType.Coding,
      entityType: 'TASK' as const,
      entityId: focalTaskId,
      config: {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1' as const,
          modeId,
        },
      },
    });

    beforeEach(() => {
      workItemTypeRegistry.getDefinition.mockReturnValue({
        status: 'ACTIVE',
        definition: {
          sections: filesDefinition,
          agentGuidance: {
            overview: 'Project mode applicability',
            contexts: [
              {
                focalTypeKeys: ['STANDARD'],
                guidance: 'Use this mode for standard work items.',
              },
            ],
          },
        },
      });
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.workItemType.findFirst.mockResolvedValue(null);
      prisma.db.workItemTypeTemplate.findUnique.mockResolvedValue({
        sectionDefinitions: filesDefinition,
      });
      prisma.db.task.findFirst.mockImplementation(
        ({ where, select }: { where: { id: string }; select: object }) => {
          if (where.id === modeId) {
            return Promise.resolve({
              projectId: 'proj-1',
              type: 'MODE',
              status: 'ACTIVE',
              archivedAt: null,
              sections: [
                {
                  key: 'description',
                  materializedMarkdown: 'Use a proof-first review discipline.',
                },
                {
                  key: 'files',
                  materializedMarkdown:
                    '{"files":{"references/checklist.md":"Check evidence","MODE.md":"Ground every claim"},"schemaVersion":"project-mode-files.v1"}',
                },
              ],
            });
          }
          return Promise.resolve(
            'projectId' in select
              ? { projectId: 'proj-1' }
              : { type: 'STANDARD' },
          );
        },
      );
      prisma.db.agentSession.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            buildAgentSession({
              id: '10000000-0000-4000-8000-000000000103',
              projectId: 'proj-1',
              organizationId: 'org-1',
              userId: 'user-1',
              entityId: focalTaskId,
              type: 'CODING',
              config: data.config as Prisma.JsonValue,
            }),
          ),
      );
    });

    it('captures canonical description and files once with a server-owned hash', async () => {
      const result = await service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        createDto(),
      );

      expect(result.config).toMatchObject({
        projectModeSelection: { modeId },
        projectModeSnapshot: {
          modeId,
          catalogDescription: 'Use a proof-first review discipline.',
          applicableWorkItemTypeKeys: ['STANDARD'],
          files: {
            schemaVersion: 'project-mode-files.v1',
            files: {
              'MODE.md': 'Ground every claim',
              'references/checklist.md': 'Check evidence',
            },
          },
          snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(prisma.db.agentSession.create).toHaveBeenCalledTimes(1);
    });

    it.each(['BUG', 'PROJECT_DEFINED_WORK_ITEM'])(
      'accepts a focal %s type declared by the project-owned MODE guidance',
      async (focalType) => {
        workItemTypeRegistry.getDefinition.mockReturnValue({
          status: 'ACTIVE',
          definition: {
            sections: filesDefinition,
            agentGuidance: {
              overview: 'Project mode applicability',
              contexts: [
                {
                  focalTypeKeys: ['STANDARD', 'BUG'],
                  guidance: 'Use this mode for work items.',
                },
                {
                  focalTypeKeys: ['PROJECT_DEFINED_WORK_ITEM'],
                  guidance: 'Use this mode for the project-defined type.',
                },
              ],
            },
          },
        });
        prisma.db.task.findFirst.mockImplementation(
          ({ where, select }: { where: { id: string }; select?: object }) => {
            if (where.id === modeId) {
              return Promise.resolve({
                projectId: 'proj-1',
                type: 'MODE',
                status: 'ACTIVE',
                archivedAt: null,
                sections: [
                  {
                    key: 'description',
                    materializedMarkdown:
                      'Use a proof-first review discipline.',
                  },
                  {
                    key: 'files',
                    materializedMarkdown:
                      '{"files":{"MODE.md":"Ground every claim"},"schemaVersion":"project-mode-files.v1"}',
                  },
                ],
              });
            }
            if (select && 'projectId' in select) {
              return Promise.resolve({ projectId: 'proj-1' });
            }
            return Promise.resolve({ type: focalType });
          },
        );

        const result = await service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        );

        expect(result.config).toMatchObject({
          projectModeSnapshot: {
            applicableWorkItemTypeKeys: [
              'BUG',
              'PROJECT_DEFINED_WORK_ITEM',
              'STANDARD',
            ],
          },
        });
      },
    );

    it('captures a project-mode selection on update and returns the authoritative snapshot', async () => {
      const selectionConfig: AgentSessionConfigV2 = {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId,
        },
      };
      const existing = buildAgentSession({
        id: '10000000-0000-4000-8000-000000000104',
        projectId: 'proj-1',
        organizationId: 'org-1',
        entityType: 'TASK',
        entityId: focalTaskId,
      });
      prisma.db.agentSession.findFirst.mockResolvedValue(existing);
      prisma.db.agentSession.update.mockImplementation(
        ({ data }: { data: { config?: Prisma.JsonValue } }) =>
          Promise.resolve({
            ...existing,
            config: data.config ?? null,
          }),
      );

      const result = await service.update('org-1' as any, existing.id, {
        config: selectionConfig,
      });

      const updateCall = prisma.db.agentSession.update.mock.calls[0]?.[0] as
        | { data: { config?: Prisma.JsonValue } }
        | undefined;
      expect(updateCall?.data.config).toMatchObject({
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId,
        },
        projectModeSnapshot: {
          schemaVersion: 'project-mode-snapshot.v3',
          modeId,
          catalogDescription: 'Use a proof-first review discipline.',
          applicableWorkItemTypeKeys: ['STANDARD'],
          files: {
            schemaVersion: 'project-mode-files.v1',
            files: {
              'MODE.md': 'Ground every claim',
              'references/checklist.md': 'Check evidence',
            },
          },
          projectAssistant: { enabled: true },
          snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(result.config).toEqual(updateCall?.data.config);
    });

    describe('Project Assistant setting', () => {
      const settingsDefinition = [
        ...filesDefinition,
        {
          key: 'settings',
          label: 'Session settings',
          kind: 'json',
          schemaRef: '#/components/schemas/ProjectModeSettings',
        },
      ];
      const withSettings = (
        settingsContent: string,
        focalType = 'STANDARD',
      ) => {
        workItemTypeRegistry.getDefinition.mockReturnValue({
          status: 'ACTIVE',
          definition: {
            sections: settingsDefinition,
            agentGuidance: {
              overview: 'Project mode applicability',
              contexts: [
                { focalTypeKeys: ['STANDARD'], guidance: 'Standard work.' },
              ],
            },
          },
        });
        prisma.db.task.findFirst.mockImplementation(
          ({ where, select }: { where: { id: string }; select: object }) => {
            if (where.id === modeId) {
              return Promise.resolve({
                projectId: 'proj-1',
                type: 'MODE',
                status: 'ACTIVE',
                archivedAt: null,
                sections: [
                  {
                    key: 'description',
                    materializedMarkdown:
                      'Use a proof-first review discipline.',
                  },
                  {
                    key: 'files',
                    materializedMarkdown:
                      '{"schemaVersion":"project-mode-files.v1","files":{"MODE.md":"Ground every claim"}}',
                  },
                  { key: 'settings', materializedMarkdown: settingsContent },
                ],
              });
            }
            return Promise.resolve(
              'projectId' in select
                ? { projectId: 'proj-1' }
                : { type: focalType },
            );
          },
        );
      };

      it('defaults a MODE without settings to Project Assistant on in a v3 snapshot', async () => {
        const result = await service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        );

        expect(result.config).toMatchObject({
          projectModeSnapshot: {
            schemaVersion: 'project-mode-snapshot.v3',
            sessionRole: 'implementation',
            projectAssistant: { enabled: true },
          },
        });
      });

      it.each(['implementation', 'research', 'planning', 'review'] as const)(
        'captures %s and preserves it on readback while detecting role tampering',
        async (sessionRole) => {
          withSettings(
            JSON.stringify({
              schemaVersion: 'project-mode-settings.v1',
              projectAssistant: { enabled: true },
              sessionRole,
            }),
          );
          const result = await service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          );
          const captured = (result.config as AgentSessionConfigV2)
            .projectModeSnapshot!;
          expect(captured).toMatchObject({
            schemaVersion: 'project-mode-snapshot.v3',
            sessionRole,
          });
          withSettings(
            JSON.stringify({
              schemaVersion: 'project-mode-settings.v1',
              projectAssistant: { enabled: false },
              sessionRole: sessionRole === 'review' ? 'research' : 'review',
            }),
          );
          prisma.db.agentSession.findFirst.mockResolvedValue({
            ...buildAgentSession({ id: result.id }),
            config: result.config,
          });
          const readback = await service.findOne('org-1' as any, result.id);
          expect(
            (readback.config as AgentSessionConfigV2).projectModeSnapshot,
          ).toEqual(captured);
          const tampered = {
            ...captured,
            sessionRole: sessionRole === 'review' ? 'research' : 'review',
          };
          prisma.db.agentSession.findFirst.mockResolvedValue({
            ...buildAgentSession({ id: result.id }),
            config: { ...result.config, projectModeSnapshot: tampered },
          });
          const invalid = await service.findOne('org-1' as any, result.id);
          expect(
            (invalid.config as AgentSessionConfigV2)?.projectModeSnapshot,
          ).toBeUndefined();
        },
      );

      it.each([true, false])(
        'captures the authored setting enabled=%s and binds it into the hash',
        async (enabled) => {
          withSettings(
            JSON.stringify({
              schemaVersion: 'project-mode-settings.v1',
              projectAssistant: { enabled },
            }),
          );

          const result = await service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          );
          const snapshot = (result.config as AgentSessionConfigV2)
            .projectModeSnapshot!;

          expect(snapshot).toMatchObject({
            schemaVersion: 'project-mode-snapshot.v3',
            projectAssistant: { enabled },
          });
          const otherHash = createHash('sha256')
            .update(
              JSON.stringify({
                schemaVersion: snapshot.schemaVersion,
                modeId: snapshot.modeId,
                catalogDescription: snapshot.catalogDescription,
                applicableWorkItemTypeKeys: snapshot.applicableWorkItemTypeKeys,
                files: snapshot.files,
                projectAssistant: { enabled: !enabled },
              }),
            )
            .digest('hex');
          expect(snapshot.snapshotHash).not.toBe(otherHash);
        },
      );

      it.each(['STANDARD', 'BUG'])(
        'accepts a %s focal item for a mode whose own list is STANDARD and BUG',
        async (focalType) => {
          withSettings(
            JSON.stringify({
              schemaVersion: 'project-mode-settings.v1',
              projectAssistant: { enabled: true },
              eligibleWorkItemTypeKeys: ['STANDARD', 'BUG'],
            }),
            focalType,
          );

          const result = await service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          );

          expect(result.config).toMatchObject({
            projectModeSnapshot: {
              applicableWorkItemTypeKeys: ['BUG', 'STANDARD'],
            },
          });
        },
      );

      it('captures a custom focal type named only by the mode list, matching the shared resolver', async () => {
        withSettings(
          JSON.stringify({
            schemaVersion: 'project-mode-settings.v1',
            projectAssistant: { enabled: true },
            eligibleWorkItemTypeKeys: ['JOB_APPLICATION_RECORD'],
          }),
          'JOB_APPLICATION_RECORD',
        );

        const result = await service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        );

        expect(result.config).toMatchObject({
          projectModeSnapshot: {
            applicableWorkItemTypeKeys: ['JOB_APPLICATION_RECORD'],
          },
        });
      });

      it('rejects a type excluded by the mode list before creating the session', async () => {
        withSettings(
          JSON.stringify({
            schemaVersion: 'project-mode-settings.v1',
            projectAssistant: { enabled: true },
            eligibleWorkItemTypeKeys: ['STANDARD'],
          }),
          'BUG',
        );

        await expect(
          service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          ),
        ).rejects.toThrow('not eligible for this work-item type');
        expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
      });

      it('keeps legacy type-level eligibility for a mode without its own list', async () => {
        withSettings(
          JSON.stringify({
            schemaVersion: 'project-mode-settings.v1',
            projectAssistant: { enabled: true },
          }),
          'BUG',
        );

        await expect(
          service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          ),
        ).rejects.toThrow('not eligible for this work-item type');
        expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
      });

      it('rejects a MODE whose stored settings violate the schema', async () => {
        withSettings(
          JSON.stringify({
            schemaVersion: 'project-mode-settings.v1',
            projectAssistant: { enabled: true, allowEdgeUpdates: true },
          }),
        );

        await expect(
          service.create(
            'org-1' as any,
            'proj-1' as any,
            'user-1' as any,
            createDto(),
          ),
        ).rejects.toThrow("Invalid JSON section 'settings'");
        expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
      });
    });

    it('rejects caller-forged snapshots before opening a transaction', async () => {
      const dto = createDto();
      (dto.config as AgentSessionConfigV2).projectModeSnapshot = {
        schemaVersion: 'project-mode-snapshot.v1',
        modeId,
        catalogDescription: 'forged',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1',
          files: { 'MODE.md': 'forged' },
        },
        snapshotHash: '0'.repeat(64),
      };

      await expect(
        service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, dto),
      ).rejects.toThrow('projectModeSnapshot is platform-owned');
      expect(prisma.db.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', null, 'must identify an existing MODE'],
      [
        'archived',
        {
          projectId: 'proj-1',
          type: 'MODE',
          status: 'ARCHIVED',
          archivedAt: now,
          sections: [],
        },
        'must identify an active MODE',
      ],
      [
        'wrong type',
        {
          projectId: 'proj-1',
          type: 'STANDARD',
          status: 'ACTIVE',
          archivedAt: null,
          sections: [],
        },
        'must identify a MODE work item',
      ],
      [
        'cross-project',
        {
          projectId: 'proj-2',
          type: 'MODE',
          status: 'ACTIVE',
          archivedAt: null,
          sections: [],
        },
        'must belong to the Agent Session project',
      ],
    ])('rejects a %s project MODE selection', async (_case, mode, message) => {
      prisma.db.task.findFirst.mockImplementation(
        ({ where, select }: { where: { id: string }; select: object }) => {
          if (where.id === modeId) return Promise.resolve(mode);
          return Promise.resolve(
            'projectId' in select
              ? { projectId: 'proj-1' }
              : { type: 'STANDARD' },
          );
        },
      );
      await expect(
        service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        ),
      ).rejects.toThrow(message);
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('rejects malformed stored files before creating the session', async () => {
      prisma.db.task.findFirst.mockImplementation(
        ({ where, select }: { where: { id: string }; select: object }) => {
          if (where.id === modeId) {
            return Promise.resolve({
              projectId: 'proj-1',
              type: 'MODE',
              status: 'ACTIVE',
              archivedAt: null,
              sections: [
                { key: 'description', materializedMarkdown: 'Broken mode' },
                {
                  key: 'files',
                  materializedMarkdown:
                    '{"schemaVersion":"project-mode-files.v1","files":{"../escape.md":"no"}}',
                },
              ],
            });
          }
          return Promise.resolve(
            'projectId' in select
              ? { projectId: 'proj-1' }
              : { type: 'STANDARD' },
          );
        },
      );
      await expect(
        service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        ),
      ).rejects.toThrow("Invalid JSON section 'files'");
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('rejects a MODE that is ineligible for the focal work-item type', async () => {
      prisma.db.task.findFirst.mockImplementation(
        ({ where, select }: { where: { id: string }; select: object }) => {
          if (where.id === modeId) {
            return Promise.resolve({
              projectId: 'proj-1',
              type: 'MODE',
              status: 'ACTIVE',
              archivedAt: null,
              sections: [],
            });
          }
          return Promise.resolve(
            'projectId' in select ? { projectId: 'proj-1' } : { type: 'BUG' },
          );
        },
      );
      await expect(
        service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        ),
      ).rejects.toThrow('not eligible for this work-item type');
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('rejects a MODE for a focal type that is no longer active', async () => {
      const activeModeDefinition = {
        status: 'ACTIVE',
        definition: {
          sections: filesDefinition,
          agentGuidance: {
            overview: 'Project mode applicability',
            contexts: [
              {
                focalTypeKeys: ['BUG'],
                guidance: 'Use this mode for bug work items.',
              },
            ],
          },
        },
      };
      workItemTypeRegistry.getDefinition.mockImplementation(
        (_projectId: string, typeKey: string) =>
          typeKey === 'MODE'
            ? activeModeDefinition
            : { ...activeModeDefinition, status: 'ARCHIVED' },
      );
      prisma.db.task.findFirst.mockImplementation(
        ({ where, select }: { where: { id: string }; select: object }) => {
          if (where.id === modeId) {
            return Promise.resolve({
              projectId: 'proj-1',
              type: 'MODE',
              status: 'ACTIVE',
              archivedAt: null,
              sections: [
                {
                  key: 'description',
                  materializedMarkdown: 'Use a proof-first review discipline.',
                },
                {
                  key: 'files',
                  materializedMarkdown:
                    '{"files":{"MODE.md":"Ground every claim"},"schemaVersion":"project-mode-files.v1"}',
                },
              ],
            });
          }
          return Promise.resolve(
            'projectId' in select ? { projectId: 'proj-1' } : { type: 'BUG' },
          );
        },
      );

      await expect(
        service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          createDto(),
        ),
      ).rejects.toThrow('not eligible for this work-item type');
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });
  });

  it('persists the PLAN work-item identity and resolves it for the created event payload', async () => {
    const created: AgentSession = {
      id: 'cs-3',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Plan Generation',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: 'TASK',
      entityId: 'plan-1',
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'PLAN_GENERATION',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'plan-1',
      type: 'PLAN',
      parentTaskId: null,
      projectId: 'proj-1',
    });
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Plan Generation',
        type: 'PLAN_GENERATION',
        entityType: 'TASK',
        entityId: 'plan-1',
      },
    );

    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'TASK',
          entityId: 'plan-1',
        }),
      }),
    );
    expect(result.entityType).toBe('TASK');
    expect(result.entityId).toBe('plan-1');
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.created',
        payload: expect.objectContaining({
          planId: 'plan-1',
        }),
      }),
    );
  });

  it('rejects create when PLAN entity belongs to a different organization', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.task.findFirst.mockResolvedValue(null);

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Plan Generation',
        type: 'PLAN_GENERATION',
        entityType: 'TASK',
        entityId: 'plan-other-org',
      }),
    ).rejects.toThrow('entityId must belong to the organization');
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('rejects create when PLAN entity originates from a different project', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.task.findFirst.mockResolvedValue({
      projectId: 'proj-other',
    });

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Plan Generation',
        type: 'PLAN_GENERATION',
        entityType: 'TASK',
        entityId: 'plan-1',
      }),
    ).rejects.toThrow('entityId (TASK) must belong to the projectId');
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('creates a session about the current project', async () => {
    const created = buildAgentSession({
      id: 'cs-about-project-1',
      entityType: 'PROJECT',
      entityId: 'proj-1',
      type: 'ENTITY_CONVERSATION',
    });
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Project',
        type: 'ENTITY_CONVERSATION',
        entityType: 'PROJECT',
        entityId: 'proj-1',
      },
    );

    expect(prisma.db.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'proj-1', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'PROJECT',
          entityId: 'proj-1',
        }),
      }),
    );
    expect(result.entityType).toBe('PROJECT');
    expect(result.entityId).toBe('proj-1');
  });

  it('rejects a Project about-target from another project before persistence', async () => {
    prisma.db.project.findFirst
      .mockResolvedValueOnce({ id: 'proj-1' })
      .mockResolvedValueOnce({ id: 'proj-other' });

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Project',
        type: 'ENTITY_CONVERSATION',
        entityType: 'PROJECT',
        entityId: 'proj-other',
      }),
    ).rejects.toThrow('entityId (PROJECT) must belong to the projectId');
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('creates a session about a same-project Service with selected and launch Service context', async () => {
    const created = buildAgentSession({
      id: 'cs-about-service-1',
      entityType: 'SERVICE',
      entityId: 'service-1',
      serviceId: 'service-1',
      type: 'ENTITY_CONVERSATION',
    });
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-1' });
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', projectId: 'proj-1' },
    ]);
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Service',
        type: 'ENTITY_CONVERSATION',
        entityType: 'SERVICE',
        entityId: 'service-1',
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
      },
    );

    expect(prisma.db.service.findFirst).toHaveBeenCalledWith({
      where: { id: 'service-1', organizationId: 'org-1' },
      select: { projectId: true },
    });
    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'SERVICE',
          entityId: 'service-1',
          service: { connect: { id: 'service-1' } },
        }),
      }),
    );
    expect(prisma.db.serviceAgentSession.createMany).toHaveBeenCalledWith({
      data: [{ serviceId: 'service-1', agentSessionId: 'cs-about-service-1' }],
    });
    expect(result.entityType).toBe('SERVICE');
    expect(result.entityId).toBe('service-1');
    expect(result.serviceIds).toEqual(['service-1']);
    expect(result.launchServiceId).toBe('service-1');
  });

  it('rejects a Service about-target from another project before persistence', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-other' });

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Service',
        type: 'ENTITY_CONVERSATION',
        entityType: 'SERVICE',
        entityId: 'service-1',
      }),
    ).rejects.toThrow('entityId (SERVICE) must belong to the projectId');
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('creates a session about an existing Agent Session in the same project', async () => {
    const created = buildAgentSession({
      id: 'cs-about-session-1',
      entityType: 'AGENT_SESSION',
      entityId: sessionId1,
    });
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.findFirst.mockResolvedValue({
      projectId: 'proj-1',
    });
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Agent Session',
        type: 'ENTITY_CONVERSATION',
        entityType: 'AGENT_SESSION',
        entityId: sessionId1,
      },
    );

    expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith({
      where: { id: sessionId1, organizationId: 'org-1' },
      select: { projectId: true },
    });
    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'AGENT_SESSION',
          entityId: sessionId1,
        }),
      }),
    );
    expect(result.entityType).toBe('AGENT_SESSION');
    expect(result.entityId).toBe(sessionId1);
  });

  it('rejects an Agent Session about-target from another project', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.agentSession.findFirst.mockResolvedValue({
      projectId: 'proj-other',
    });

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Discuss Agent Session',
        type: 'ENTITY_CONVERSATION',
        entityType: 'AGENT_SESSION',
        entityId: sessionId1,
      }),
    ).rejects.toThrow('entityId (AGENT_SESSION) must belong to the projectId');
    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('creates, fetches, and lists a VALIDATION agent session end-to-end', async () => {
    const validationSession: AgentSession = {
      id: 'cs-validation-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Validation Walkthrough',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: 'TASK',
      entityId: 'task-1',
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'VALIDATION',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'task-1',
      projectId: 'proj-1',
    });
    prisma.db.agentSession.create.mockResolvedValue(validationSession);

    const created = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Validation Walkthrough',
        type: 'VALIDATION',
        entityType: 'TASK',
        entityId: 'task-1',
      },
    );

    expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'VALIDATION',
        }),
      }),
    );
    expect(created.type).toBe('VALIDATION');
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.created',
        payload: expect.objectContaining({
          agentSession: expect.objectContaining({ type: 'VALIDATION' }),
        }),
      }),
    );

    prisma.db.agentSession.findFirst.mockResolvedValue(validationSession);
    const fetched = await service.findOne('org-1' as any, 'cs-validation-1');
    expect(fetched.type).toBe('VALIDATION');

    prisma.db.agentSession.findMany.mockResolvedValue([validationSession]);
    const listed = await service.findAll('org-1' as any, 'proj-1' as any, {
      entityType: 'TASK',
      entityId: 'task-1',
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.type).toBe('VALIDATION');
  });

  it('lists agent sessions filtered by PLAN entity', async () => {
    const session: AgentSession = {
      id: 'cs-3',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: 'TASK',
      entityId: 'plan-1',
      sessionDate: now,
      title: 'Plan Generation',
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'PLAN_GENERATION',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findMany.mockResolvedValue([session]);

    const result = await service.findAll('org-1' as any, 'proj-1' as any, {
      entityType: 'TASK',
      entityId: 'plan-1',
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: 'TASK',
          entityId: 'plan-1',
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.entityType).toBe('TASK');
    expect(result[0]!.entityId).toBe('plan-1');
  });

  it('lists agent sessions with filters', async () => {
    const session: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      sessionDate: now,
      title: 'Session',
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findMany.mockResolvedValue([session]);

    const result = await service.findAll('org-1' as any, 'proj-1' as any, {
      ids: ['cs-1', 'cs-2'],
      userId: 'user-1',
      serviceId: 'service-1',
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['cs-1', 'cs-2'] },
          userId: 'user-1',
          serviceRelations: {
            some: { serviceId: 'service-1' },
          },
        }),
        include: expect.objectContaining({
          serviceRelations: expect.any(Object),
        }),
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('returns a bounded last-message-ordered page with compact card context', async () => {
    const carrierReport = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      title: 'Implement',
    };
    reportService.loadReportsForMessageIds.mockResolvedValue(
      new Map([['dddddddd-dddd-4ddd-8ddd-dddddddddddd', [carrierReport]]]),
    );
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow({
        lastMessageAt: new Date('2026-07-17T15:00:00.000Z'),
        lastMessageCreatedAt: new Date('2026-07-17T12:00:00.000Z'),
      }),
      buildPaginatedRow({
        id: sessionId2,
        lastMessageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
      buildPaginatedRow({
        id: sessionId3,
        conversationId: null,
        lastMessageId: null,
        lastMessageConversationId: null,
        lastMessageType: null,
        lastMessageStatus: null,
        lastMessageData: null,
        lastMessageAt: null,
        lastMessageCreatedAt: null,
      }),
    ]);

    const result = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        type: 'CODING',
        statuses: ['IN_PROGRESS', 'COMPLETED'],
        sort: 'LAST_MESSAGE',
        limit: 2,
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        agentSession: expect.objectContaining({
          id: sessionId1,
          type: 'CODING',
          status: 'IN_PROGRESS',
          serviceIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        }),
        lastMessage: expect.objectContaining({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          createdAt: '2026-07-17T12:00:00.000Z',
        }),
        parentEntity: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          type: 'TASK',
          name: 'Add paginated listing',
        },
        services: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'API',
          },
        ],
        reports: [carrierReport],
      }),
    );
    expect(reportService.loadReportsForMessageIds).toHaveBeenCalledWith(
      'org-1',
      [
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      ],
    );

    const queryTemplate = prisma.db.$queryRaw.mock.calls[0]?.[0] as
      | string[]
      | undefined;
    const querySql = Array.isArray(queryTemplate)
      ? queryTemplate.join(' ')
      : '';
    expect(querySql).toContain(
      'ORDER BY latest_message.content_updated_at DESC NULLS LAST, cs.id::text ASC',
    );
    expect(querySql).toContain(
      'ORDER BY message.content_updated_at DESC, message.id DESC',
    );
    // An undated queued input is never a session's latest message.
    expect(querySql).toContain('AND message.content_updated_at IS NOT NULL');
  });

  it('restricts a paginated page to the selected service within the project', async () => {
    prisma.db.$queryRaw.mockResolvedValue([]);
    const sqlSpy = jest.spyOn(Prisma, 'sql');

    try {
      await service.findPaginated('org-1' as any, 'proj-1' as any, {
        type: 'CODING',
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 20,
        serviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });

      expect(
        sqlSpy.mock.calls.some(([strings]) =>
          strings
            .join(' ')
            .includes('service_filter.project_id::text = cs.project_id::text'),
        ),
      ).toBe(true);
    } finally {
      sqlSpy.mockRestore();
    }
  });

  it('applies All and Mine user scopes across cursor pages and preserves identity', async () => {
    const allRows = [
      buildPaginatedRow({ id: sessionId1, userId: userId1 }),
      buildPaginatedRow({ id: sessionId2, userId: userId2 }),
      buildPaginatedRow({ id: sessionId3, userId: userId1 }),
    ];
    const mineRows = [
      buildPaginatedRow({ id: sessionId1, userId: userId1 }),
      buildPaginatedRow({ id: sessionId2, userId: userId1 }),
      buildPaginatedRow({ id: sessionId3, userId: userId1 }),
    ];
    prisma.db.$queryRaw
      .mockResolvedValueOnce(allRows)
      .mockResolvedValueOnce([allRows[2]])
      .mockResolvedValueOnce(mineRows)
      .mockResolvedValueOnce([mineRows[2]]);
    const sqlSpy = jest.spyOn(Prisma, 'sql');

    try {
      const allFirstPage = await service.findPaginated(
        'org-1' as any,
        'proj-1' as any,
        {
          statuses: [],
          sort: 'LAST_MESSAGE',
          limit: 2,
        },
      );
      const allSecondPage = await service.findPaginated(
        'org-1' as any,
        'proj-1' as any,
        {
          statuses: [],
          sort: 'LAST_MESSAGE',
          limit: 2,
          cursor: allFirstPage.nextCursor!,
        },
      );

      expect(
        allFirstPage.items.map((item) => item.agentSession.userId),
      ).toEqual([userId1, userId2]);
      expect(allSecondPage.items[0]?.agentSession.userId).toBe(userId1);

      const mineFirstPage = await service.findPaginated(
        'org-1' as any,
        'proj-1' as any,
        {
          statuses: [],
          sort: 'LAST_MESSAGE',
          limit: 2,
          userId: userId1,
        },
      );
      const mineSecondPage = await service.findPaginated(
        'org-1' as any,
        'proj-1' as any,
        {
          statuses: [],
          sort: 'LAST_MESSAGE',
          limit: 2,
          userId: userId1,
          cursor: mineFirstPage.nextCursor!,
        },
      );

      expect(
        [...mineFirstPage.items, ...mineSecondPage.items].map(
          (item) => item.agentSession.userId,
        ),
      ).toEqual([userId1, userId1, userId1]);
      expect(
        sqlSpy.mock.calls.some(([strings]) =>
          strings.join(' ').includes('cs.user_id::text ='),
        ),
      ).toBe(true);
    } finally {
      sqlSpy.mockRestore();
    }
  });

  it('restricts a paginated page to sessions attached to the selected task', async () => {
    prisma.db.$queryRaw.mockResolvedValue([buildPaginatedRow()]);
    const sqlSpy = jest.spyOn(Prisma, 'sql');

    try {
      const result = await service.findPaginated(
        'org-1' as any,
        'proj-1' as any,
        {
          type: 'CODING',
          statuses: [],
          sort: 'LAST_MESSAGE',
          limit: 20,
          taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.agentSession.id).toBe(sessionId1);
      expect(result.nextCursor).toBeNull();
      expect(
        sqlSpy.mock.calls.some(([strings]) =>
          strings.join(' ').includes('cs.entity_type::text ='),
        ),
      ).toBe(true);
      expect(
        sqlSpy.mock.calls.some(([strings]) =>
          strings.join(' ').includes('cs.entity_id::text ='),
        ),
      ).toBe(true);
    } finally {
      sqlSpy.mockRestore();
    }
  });

  it('returns an empty page when the selected task has no sessions', async () => {
    prisma.db.$queryRaw.mockResolvedValue([]);

    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        type: 'CODING',
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 20,
        taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('accepts its cursor with the same filters and rejects filter reuse', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow(),
      buildPaginatedRow({ id: sessionId2 }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        type: 'CODING',
        statuses: ['IN_PROGRESS'],
        sort: 'LAST_MESSAGE',
        limit: 1,
      },
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    prisma.db.$queryRaw.mockResolvedValue([]);
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        type: 'CODING',
        statuses: ['IN_PROGRESS'],
        sort: 'LAST_MESSAGE',
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    const queryCountBeforeMismatch = prisma.db.$queryRaw.mock.calls.length;
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        type: 'CODING',
        statuses: ['COMPLETED'],
        sort: 'LAST_MESSAGE',
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toThrow('cursor does not match the requested filters');
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(queryCountBeforeMismatch);
  });

  it('invalidates cursors encoded for the previous message sort', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow(),
      buildPaginatedRow({ id: sessionId2 }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      { statuses: [], sort: 'LAST_MESSAGE', limit: 1 },
    );
    const cursor = JSON.parse(
      Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(cursor.version).toBe(2);

    const previousSortCursor = Buffer.from(
      JSON.stringify({ ...cursor, version: 1 }),
      'utf8',
    ).toString('base64url');
    const queryCountBeforeLegacyCursor = prisma.db.$queryRaw.mock.calls.length;

    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        cursor: previousSortCursor,
      }),
    ).rejects.toThrow('cursor is invalid');
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(
      queryCountBeforeLegacyCursor,
    );
  });

  it('rejects a cursor when the selected service changes', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow(),
      buildPaginatedRow({ id: sessionId2 }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        serviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const queryCountBeforeMismatch = prisma.db.$queryRaw.mock.calls.length;
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        serviceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toThrow('cursor does not match the requested filters');
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(queryCountBeforeMismatch);
  });

  it('rejects a cursor when the selected task changes', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow(),
      buildPaginatedRow({ id: sessionId2 }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const queryCountBeforeMismatch = prisma.db.$queryRaw.mock.calls.length;
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        taskId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toThrow('cursor does not match the requested filters');
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(queryCountBeforeMismatch);
  });

  it('rejects a cursor when the selected user changes', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow({ userId: userId1 }),
      buildPaginatedRow({ id: sessionId2, userId: userId1 }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        userId: userId1,
      },
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const queryCountBeforeMismatch = prisma.db.$queryRaw.mock.calls.length;
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        userId: userId2,
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toThrow('cursor does not match the requested filters');
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(queryCountBeforeMismatch);
  });

  it('rejects malformed paginated cursors before querying', async () => {
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 20,
        cursor: 'not+base64url',
      }),
    ).rejects.toThrow('cursor is invalid');

    expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('preserves a null-message cursor position for sessions sorted last', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      buildPaginatedRow({
        conversationId: null,
        lastMessageId: null,
        lastMessageConversationId: null,
        lastMessageType: null,
        lastMessageStatus: null,
        lastMessageData: null,
        lastMessageAt: null,
        lastMessageCreatedAt: null,
      }),
      buildPaginatedRow({
        id: sessionId2,
        conversationId: null,
        lastMessageId: null,
        lastMessageConversationId: null,
        lastMessageType: null,
        lastMessageStatus: null,
        lastMessageData: null,
        lastMessageAt: null,
        lastMessageCreatedAt: null,
      }),
    ]);
    const firstPage = await service.findPaginated(
      'org-1' as any,
      'proj-1' as any,
      {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
      },
    );

    prisma.db.$queryRaw.mockResolvedValue([]);
    await expect(
      service.findPaginated('org-1' as any, 'proj-1' as any, {
        statuses: [],
        sort: 'LAST_MESSAGE',
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('lists agent sessions with joined service summary when includeService is true', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'cs-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: 'machine-1',
        status: 'NOT_STARTED',
        sessionDate: now,
        serviceId: 'service-1',
        provider: 'claude',
        providerAgentSessionId: 'run-1',
        conversationId: 'conv-1',
        entityType: null,
        entityId: null,
        title: 'Session',
        createdAt: now,
        updatedAt: now,
        joinedServiceId: 'service-1',
        joinedServiceName: 'API Service',
        selectedServiceIds: ['service-1'],
      },
    ]);
    (prisma.db as any).$queryRaw = queryRaw;

    const result = await service.findAll(
      'org-1' as any,
      'proj-1' as any,
      {
        userId: 'user-1',
        serviceId: 'service-1',
      },
      true,
    );

    expect(queryRaw).toHaveBeenCalled();
    const executedQuery = queryRaw.mock.calls[0]?.[0] as
      | { strings?: string[] }
      | undefined;
    const querySql = executedQuery?.strings?.join(' ') ?? '';
    expect(querySql).toContain('svc.id::text = cs.service_id::text');
    expect(querySql).toContain(
      'svc.organization_id::text = cs.organization_id::text',
    );
    expect(querySql).toContain('cs.organization_id::text =');
    expect(querySql).toContain('cs.user_id::text =');
    expect(querySql).toContain('cs.machine_id AS "machineId"');
    expect(querySql).toContain('FROM "service_agent_sessions" filter_sas');
    expect(querySql).toContain('filter_sas.service_id::text =');
    expect(prisma.db.agentSession.findMany).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toEqual({
      id: 'service-1',
      name: 'API Service',
    });
    expect(result[0]!.machineId).toBe('machine-1');
  });

  it('rejects empty ids filter', async () => {
    await expect(
      service.findAll('org-1' as any, 'proj-1' as any, { ids: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.db.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('throws on missing session for findOne', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue(null);
    await expect(
      service.findOne('org-1' as any, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes the canonical findOne query to the authorized project when provided', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('org-1' as any, 'session-in-another-project', {
        projectId: 'proj-1' as any,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-in-another-project',
          organizationId: 'org-1',
          projectId: 'proj-1',
        },
      }),
    );
  });

  it('finds one agent session with joined service summary when includeService is true', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'cs-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        serviceId: 'service-1',
        provider: 'claude',
        providerAgentSessionId: 'run-1',
        conversationId: 'conv-1',
        entityType: null,
        entityId: null,
        title: 'Session',
        createdAt: now,
        updatedAt: now,
        joinedServiceId: 'service-1',
        joinedServiceName: 'API Service',
        selectedServiceIds: ['service-1'],
      },
    ]);
    (prisma.db as any).$queryRaw = queryRaw;

    const result = await service.findOne('org-1' as any, 'cs-1', {
      includeService: true,
    });

    expect(queryRaw).toHaveBeenCalled();
    expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
    expect(result.service).toEqual({
      id: 'service-1',
      name: 'API Service',
    });
  });

  it('omits service summary when includeService is true and session has no serviceId', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'cs-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        serviceId: null,
        provider: null,
        providerAgentSessionId: null,
        conversationId: 'conv-1',
        entityType: null,
        entityId: null,
        title: 'Session',
        createdAt: now,
        updatedAt: now,
        joinedServiceId: null,
        joinedServiceName: null,
        selectedServiceIds: ['service-1'],
      },
    ]);
    (prisma.db as any).$queryRaw = queryRaw;

    const result = await service.findAll(
      'org-1' as any,
      'proj-1' as any,
      {},
      true,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBeUndefined();
  });

  it('throws when includeService join does not return expected service row', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'cs-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        serviceId: 'service-1',
        provider: null,
        providerAgentSessionId: null,
        conversationId: 'conv-1',
        entityType: null,
        entityId: null,
        title: 'Session',
        createdAt: now,
        updatedAt: now,
        joinedServiceId: null,
        joinedServiceName: null,
        selectedServiceIds: [],
      },
    ]);
    (prisma.db as any).$queryRaw = queryRaw;

    await expect(
      service.findAll('org-1' as any, 'proj-1' as any, {}, true),
    ).rejects.toThrow(
      'Agent session has a serviceId but no valid joined service record',
    );
  });

  it('throws not found for findOne when includeService is true and no rows match', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    (prisma.db as any).$queryRaw = queryRaw;

    await expect(
      service.findOne('org-1' as any, 'missing-session-id', {
        includeService: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('includes linked user details when includeUser is true', async () => {
    const session: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findFirst.mockResolvedValue(session);
    prisma.db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      isActive: true,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.findOne('org-1' as any, 'cs-1', {
      includeUser: true,
    });

    expect(prisma.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      isActive: true,
      lastLoginAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      currentOrganizationId: null,
    });
  });

  it('includes both linked service and linked user details when requested', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'cs-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        serviceId: 'service-1',
        provider: 'claude',
        providerAgentSessionId: 'run-1',
        conversationId: 'conv-1',
        entityType: null,
        entityId: null,
        title: 'Session',
        createdAt: now,
        updatedAt: now,
        joinedServiceId: 'service-1',
        joinedServiceName: 'API Service',
        selectedServiceIds: ['service-1'],
      },
    ]);
    (prisma.db as any).$queryRaw = queryRaw;
    prisma.db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.findOne('org-1' as any, 'cs-1', {
      includeService: true,
      includeUser: true,
    });

    expect(result.service).toEqual({
      id: 'service-1',
      name: 'API Service',
    });
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      isActive: true,
      lastLoginAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      currentOrganizationId: null,
    });
  });

  it('fails fast when includeUser is true and the linked user is missing', async () => {
    const session: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findFirst.mockResolvedValue(session);
    prisma.db.user.findUnique.mockResolvedValue(null);

    await expect(
      service.findOne('org-1' as any, 'cs-1', {
        includeUser: true,
      }),
    ).rejects.toThrow('Agent session has a userId but no valid user record');
  });

  it('updates a agent session', async () => {
    const existing: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'old',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);
    const updated: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'updated',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.update.mockResolvedValue(updated);

    const result = await service.update('org-1' as any, 'cs-1', {
      title: 'updated',
    });

    expect(prisma.db.agentSession.update).toHaveBeenCalled();
    expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    expect(result.title).toBe('updated');
  });

  it('removes a agent session', async () => {
    const existing: AgentSession = {
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);
    prisma.db.agentOperation.findMany.mockResolvedValue([]);

    await service.remove('org-1' as any, 'cs-1');

    expect(prisma.db.agentOperation.deleteMany).toHaveBeenCalledWith({
      where: { agentSessionId: 'cs-1' },
    });
    expect(prisma.db.executionGrant.deleteMany).toHaveBeenCalledWith({
      where: { agentSessionId: 'cs-1' },
    });
    expect(prisma.db.executionAuthorization.deleteMany).toHaveBeenCalledWith({
      where: { agentSessionId: 'cs-1' },
    });
    expect(prisma.db.agentSession.delete).toHaveBeenCalledWith({
      where: { id: 'cs-1' },
    });
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.deleted',
        aggregateId: 'cs-1',
        payload: expect.objectContaining({
          payloadType: 'agent_session.deleted',
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          agentSession: expect.objectContaining({
            id: 'cs-1',
          }),
        }),
      }),
    );
  });

  it('deletes operations, grants, authorizations, the session, and its event', async () => {
    const existing = buildAgentSession();
    const order: string[] = [];
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);
    prisma.db.agentOperation.findMany.mockResolvedValue([
      { operationId: 'operation-1' },
    ] as any);
    prisma.db.message.updateMany.mockImplementation(async () => {
      order.push('message operation reference');
      return { count: 1 } as any;
    });
    prisma.db.agentOperation.deleteMany.mockImplementation(async () => {
      order.push('operation');
      return { count: 1 };
    });
    prisma.db.executionGrant.deleteMany.mockImplementation(async () => {
      order.push('grant');
      return { count: 1 };
    });
    prisma.db.executionAuthorization.deleteMany.mockImplementation(async () => {
      order.push('authorization');
      return { count: 1 };
    });
    prisma.db.agentSession.delete.mockImplementation(async () => {
      order.push('session');
      return existing;
    });
    eventPublisher.publishInTransaction.mockImplementation(async () => {
      order.push('event');
      return null;
    });

    await service.remove('org-1' as any, existing.id);

    expect(order).toEqual([
      'message operation reference',
      'operation',
      'grant',
      'authorization',
      'session',
      'event',
    ]);
    expect(prisma.db.agentOperation.findMany).toHaveBeenCalledWith({
      where: { agentSessionId: existing.id },
      select: { operationId: true },
    });
    expect(prisma.db.message.updateMany).toHaveBeenCalledWith({
      where: { executionOperationId: { in: ['operation-1'] } },
      data: { executionOperationId: null },
    });
  });

  it('rolls back the deletion path and does not publish when dependent cleanup fails', async () => {
    const existing = buildAgentSession();
    const failure = new Error('execution grant cleanup failed');
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);
    prisma.db.agentOperation.findMany.mockResolvedValue([]);
    prisma.db.executionGrant.deleteMany.mockRejectedValue(failure);

    await expect(service.remove('org-1' as any, existing.id)).rejects.toBe(
      failure,
    );

    expect(prisma.db.agentOperation.deleteMany).toHaveBeenCalledWith({
      where: { agentSessionId: existing.id },
    });
    expect(prisma.db.executionAuthorization.deleteMany).not.toHaveBeenCalled();
    expect(prisma.db.agentSession.delete).not.toHaveBeenCalled();
    expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
  });

  it('persists a validated machine binding on update', async () => {
    const existing = buildAgentSession({ machineId: null });
    const updated = buildAgentSession({ machineId: 'machine-1' });
    const machineFindFirst = jest.fn().mockResolvedValue({ id: 'machine-1' });
    (prisma.db as any).machine = { findFirst: machineFindFirst };
    prisma.db.agentSession.findFirst.mockResolvedValue(existing);
    prisma.db.agentSession.update.mockResolvedValue(updated);

    const result = await service.update('org-1' as any, existing.id, {
      machineId: 'machine-1',
    });

    expect(machineFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'machine-1',
        userId: existing.userId,
        revokedAt: null,
        OR: [{ organizationId: 'org-1' }, { organizationId: null }],
      },
      select: { id: true },
    });
    expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          machine: { connect: { id: 'machine-1' } },
        }),
      }),
    );
    expect(result.machineId).toBe('machine-1');
  });

  it('creates a agent session with service/provider/agent session fields', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-1' });
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', projectId: 'proj-1' },
    ]);
    prisma.db.task.findFirst.mockImplementation(async ({ where }) => {
      if (where.id === 'task-1') {
        return {
          id: 'task-1',
          type: 'STANDARD',
          parentTaskId: 'stage-1',
          projectId: 'proj-1',
        };
      }
      if (where.id === 'stage-1') {
        return {
          id: 'stage-1',
          type: 'PLAN_STAGE',
          parentTaskId: 'plan-1',
          projectId: 'proj-1',
        };
      }
      if (where.id === 'plan-1') {
        return {
          id: 'plan-1',
          type: 'PLAN',
          parentTaskId: null,
          projectId: 'proj-1',
        };
      }
      return null;
    });
    const created: AgentSession = {
      id: 'cs-2',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: null,
      entityType: 'TASK',
      entityId: 'task-1',
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Session',
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        provider: 'claude',
        agentSessionId: 'run-1',
        entityType: 'TASK',
        entityId: 'task-1',
        type: 'CODING',
      },
    );

    expect(result.launchServiceId).toBe('service-1');
    expect(result.serviceIds).toEqual(['service-1']);
    expect(prisma.db.serviceAgentSession.createMany).toHaveBeenCalledWith({
      data: [{ serviceId: 'service-1', agentSessionId: 'cs-2' }],
    });
    expect(result.provider).toBe('claude');
    expect(result.agentSessionId).toBe('run-1');
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.created',
        aggregateId: 'cs-2',
        payload: expect.objectContaining({
          payloadType: 'agent_session.created',
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: null,
          taskId: 'task-1',
          serviceId: 'service-1',
          planId: 'plan-1',
        }),
      }),
    );
  });

  it('creates selected-service links for every supplied service', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-1' });
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', projectId: 'proj-1' },
      { id: 'service-2', projectId: 'proj-1' },
    ]);
    const created: AgentSession = {
      id: 'cs-multi',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: null,
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.db.agentSession.create.mockResolvedValue(created);

    const result = await service.create(
      'org-1' as any,
      'proj-1' as any,
      'user-1' as any,
      {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        title: 'Session',
        serviceIds: ['service-1', 'service-2'],
        launchServiceId: 'service-1',
        provider: 'claude',
        agentSessionId: 'run-1',
        type: 'CODING',
      },
    );

    expect(prisma.db.serviceAgentSession.createMany).toHaveBeenCalledWith({
      data: [
        { serviceId: 'service-1', agentSessionId: 'cs-multi' },
        { serviceId: 'service-2', agentSessionId: 'cs-multi' },
      ],
    });
    expect(result.launchServiceId).toBe('service-1');
    expect(result.serviceIds).toEqual(['service-1', 'service-2']);
  });

  it('replaces selected-service links when serviceIds is supplied on update', async () => {
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', projectId: 'proj-1' },
      { id: 'service-2', projectId: 'proj-1' },
    ]);
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
      serviceRelations: [{ serviceId: 'service-1' }],
    } as any);
    prisma.db.agentSession.update.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    const result = await service.update('org-1' as any, 'cs-1', {
      serviceIds: ['service-1', 'service-2'],
      launchServiceId: 'service-1',
    });

    expect(prisma.db.serviceAgentSession.deleteMany).toHaveBeenCalledWith({
      where: { agentSessionId: 'cs-1' },
    });
    expect(prisma.db.serviceAgentSession.createMany).toHaveBeenCalledWith({
      data: [
        { serviceId: 'service-1', agentSessionId: 'cs-1' },
        { serviceId: 'service-2', agentSessionId: 'cs-1' },
      ],
    });
    expect(result.serviceIds).toEqual(['service-1', 'service-2']);
  });

  it('preserves selected-service links when serviceIds is omitted on update', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
      serviceRelations: [
        { serviceId: 'service-1' },
        { serviceId: 'service-2' },
      ],
    } as any);
    prisma.db.agentSession.update.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Renamed',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    const result = await service.update('org-1' as any, 'cs-1', {
      title: 'Renamed',
    });

    expect(prisma.db.serviceAgentSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.db.serviceAgentSession.createMany).not.toHaveBeenCalled();
    expect(result.serviceIds).toEqual(['service-1', 'service-2']);
  });

  it('rejects clearing selected-service links from a launch-service session', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
      serviceRelations: [{ serviceId: 'service-1' }],
    } as any);

    await expect(
      service.update('org-1' as any, 'cs-1', { serviceIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    expect(prisma.db.serviceAgentSession.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects updating a launch-service session when selected-service links are missing', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
      serviceRelations: [],
    } as any);

    await expect(
      service.update('org-1' as any, 'cs-1', { title: 'Renamed' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
  });

  it('rejects changing serviceId after it is set', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    await expect(
      service.update('org-1' as any, 'cs-1', { launchServiceId: 'service-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects changing provider after it is set', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    await expect(
      service.update('org-1' as any, 'cs-1', { provider: 'codex' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects create when conversationId is provided in request payload', async () => {
    await expect(
      service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          title: 'Session',
          conversationId: 'conv-1',
        } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('rejects create when service project does not match projectId', async () => {
    prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.db.service.findFirst.mockResolvedValue({ projectId: 'proj-2' });

    await expect(
      service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        serviceIds: ['service-1'],
        launchServiceId: 'service-1',
        type: 'CODING',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
  });

  it('allows updating agentSessionId for relink recovery', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-old',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);
    prisma.db.agentSession.update.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-new',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    const result = await service.update('org-1' as any, 'cs-1', {
      agentSessionId: 'run-new',
    });

    expect(result.agentSessionId).toBe('run-new');
  });

  it('rejects update when conversationId is provided in request payload', async () => {
    await expect(
      service.update('org-1' as any, 'cs-1', {
        conversationId: 'conv-2',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
  });

  it('updates status when provided', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'IN_PROGRESS',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-old',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);
    prisma.db.agentSession.update.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'COMPLETED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-old',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    const result = await service.update('org-1' as any, 'cs-1', {
      status: 'COMPLETED',
    });

    expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_session.status_changed',
        aggregateId: 'cs-1',
        payload: expect.objectContaining({
          payloadType: 'agent_session.status_changed',
          organizationId: 'org-1',
          projectId: 'proj-1',
          previousStatus: 'IN_PROGRESS',
          newStatus: 'COMPLETED',
        }),
      }),
    );
    expect(result.status).toBe('COMPLETED');
  });

  it('uses the transaction-persisted previous status in status change events', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-old',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentSession);

    const txClient = {
      agentSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cs-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          machineId: null,
          status: 'IN_PROGRESS',
          sessionDate: now,
          title: 'Session',
          serviceId: 'service-1',
          provider: 'claude',
          providerAgentSessionId: 'run-old',
          conversationId: 'conv-1',
          entityType: null,
          entityId: null,
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          contextSizeTokens: null,
          contextSizeRunId: null,
          contextSizeProviderSessionId: null,
          contextSizeObservedAt: null,
          contextSizeMaxTokens: null,
          monitoringEnabled: false,
          autoDecide: false,
          type: 'CODING',
          config: null,
          createdAt: now,
          updatedAt: now,
        } satisfies AgentSession),
        update: jest.fn().mockResolvedValue({
          id: 'cs-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          machineId: null,
          status: 'COMPLETED',
          sessionDate: now,
          title: 'Session',
          serviceId: 'service-1',
          provider: 'claude',
          providerAgentSessionId: 'run-old',
          conversationId: 'conv-1',
          entityType: null,
          entityId: null,
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          contextSizeTokens: null,
          contextSizeRunId: null,
          contextSizeProviderSessionId: null,
          contextSizeObservedAt: null,
          contextSizeMaxTokens: null,
          monitoringEnabled: false,
          autoDecide: false,
          type: 'CODING',
          config: null,
          createdAt: now,
          updatedAt: now,
        } satisfies AgentSession),
      },
      service: {
        findFirst: jest.fn(),
      },
    };

    prisma.db.$transaction.mockImplementationOnce(
      async (cb: (client: typeof txClient) => Promise<unknown>) => cb(txClient),
    );

    await service.update('org-1' as any, 'cs-1', {
      status: 'COMPLETED',
    });

    expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
    expect(txClient.agentSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cs-1', organizationId: 'org-1' },
        include: expect.objectContaining({
          serviceRelations: expect.any(Object),
        }),
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({
        type: 'agent_session.status_changed',
        aggregateId: 'cs-1',
        payload: expect.objectContaining({
          projectId: 'proj-1',
          previousStatus: 'IN_PROGRESS',
          newStatus: 'COMPLETED',
        }),
      }),
    );
  });

  describe('advanceToInProgress', () => {
    const baseSession = (status: AgentSession['status']): AgentSession => ({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status,
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    });

    it('advances a NOT_STARTED session to IN_PROGRESS and emits the status-changed event', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('IN_PROGRESS'),
      );

      await service.advanceToInProgress('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'cs-1',
            organizationId: 'org-1',
            status: 'NOT_STARTED',
          }),
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'agent_session.status_changed',
          aggregateId: 'cs-1',
          payload: expect.objectContaining({
            payloadType: 'agent_session.status_changed',
            organizationId: 'org-1',
            projectId: 'proj-1',
            previousStatus: 'NOT_STARTED',
            newStatus: 'IN_PROGRESS',
          }),
        }),
      );
    });

    it('is an idempotent no-op when the session is already past NOT_STARTED', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('IN_PROGRESS'),
      );

      await service.advanceToInProgress('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('does not advance a COMPLETED session and emits no event', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('COMPLETED'),
      );

      await service.advanceToInProgress('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the session does not exist', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });
      prisma.db.agentSession.findFirst.mockResolvedValue(null);

      await expect(
        service.advanceToInProgress('org-1' as any, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('claimStartRunLaunch', () => {
    const baseSession = (status: AgentSession['status']): AgentSession => ({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status,
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    });

    it('returns true after claiming a NOT_STARTED session', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('IN_PROGRESS'),
      );

      const claimed = await service.claimStartRunLaunch('org-1' as any, 'cs-1');

      expect(claimed).toBe(true);
      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'cs-1',
            organizationId: 'org-1',
            status: 'NOT_STARTED',
          }),
          data: { status: 'IN_PROGRESS' },
        }),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'agent_session.status_changed',
          aggregateId: 'cs-1',
          payload: expect.objectContaining({
            previousStatus: 'NOT_STARTED',
            newStatus: 'IN_PROGRESS',
          }),
        }),
      );
    });

    it('returns false without writing when the session was already launched', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('IN_PROGRESS'),
      );

      const claimed = await service.claimStartRunLaunch('org-1' as any, 'cs-1');

      expect(claimed).toBe(false);
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('resolveStartRunConfiguration', () => {
    const config: AgentSessionConfigV2 = {
      type: AgentSessionConfigV2.TypeEnum.CodingSession,
      version: AgentSessionConfigV2.VersionEnum.V2,
      model: 'gpt-5.6-luna',
      worktree: 'plans/task-monitor-worktree',
      taskMonitorId: sessionId2,
    };
    const params = {
      organizationId: 'org-1' as any,
      agentSessionId: 'cs-1',
      taskMonitorId: '22222222-2222-4222-8222-222222222222',
      config,
    };

    it('leaves ordinary coding-session defaults unchanged', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: false,
        config: null,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: undefined,
          config: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith({
        where: { id: 'cs-1', organizationId: 'org-1' },
        select: { autoDecide: true, config: true },
      });
    });

    it.each(['first launch', 'reopened launch'])(
      'accepts an identical persisted config with autoDecide for a %s',
      async () => {
        prisma.db.agentSession.findFirst.mockResolvedValue({
          autoDecide: true,
          config,
        });

        await expect(
          service.resolveStartRunConfiguration(params),
        ).resolves.toBe(config);

        expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith({
          where: { id: 'cs-1', organizationId: 'org-1' },
          select: { autoDecide: true, config: true },
        });
      },
    );

    it('accepts a Task Monitor config without terminal policy before launch effects', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: true,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          config: {
            type: AgentSessionConfigV2.TypeEnum.CodingSession,
            version: AgentSessionConfigV2.VersionEnum.V2,
            model: 'gpt-5.6-luna',
            worktree: 'plans/task-monitor-worktree',
            taskMonitorId: sessionId2,
          },
        }),
      ).resolves.toEqual(config);

      expect(prisma.db.agentSession.findFirst).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing local Task Monitor identity for a persistently owned session', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: true,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: undefined,
        }),
      ).rejects.toThrow(
        'Task Monitor start-run ownership does not match the persisted AgentSession',
      );
    });

    it('rejects a local Task Monitor identity that differs from config ownership', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: true,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: sessionId3,
        }),
      ).rejects.toThrow(
        'Task Monitor start-run ownership does not match the persisted AgentSession',
      );
    });

    it('rejects when persisted autoDecide is disabled', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: false,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration(params),
      ).rejects.toThrow(
        'Task Monitor start-run configuration does not match the persisted AgentSession',
      );
    });

    it('rejects a requested config that differs from persisted session config', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: true,
        config: {
          ...config,
          effort: 'high',
        },
      });

      await expect(
        service.resolveStartRunConfiguration(params),
      ).rejects.toThrow(
        'Task Monitor start-run configuration does not match the persisted AgentSession',
      );
    });

    it('rejects a requested worktree branch that differs from the persisted launch config', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: true,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          config: {
            ...config,
            worktree: 'plans/different-worktree',
          },
        }),
      ).rejects.toThrow(
        'Task Monitor start-run configuration does not match the persisted AgentSession',
      );
    });

    it('accepts the persisted project MODE capture and returns the server-owned config', async () => {
      const modeId = '10000000-0000-4000-8000-000000000101';
      const snapshotContent = {
        schemaVersion: 'project-mode-snapshot.v1' as const,
        modeId,
        catalogDescription: 'Proof-first review mode.',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1' as const,
          files: { 'MODE.md': 'Ground every claim.' },
        },
      };
      const config: AgentSessionConfigV2 = {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId,
        },
        projectModeSnapshot: {
          ...snapshotContent,
          snapshotHash: createHash('sha256')
            .update(JSON.stringify(snapshotContent))
            .digest('hex'),
        },
      };
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: false,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: undefined,
          config,
        }),
      ).resolves.toEqual(config);
    });

    it('accepts a persisted v2 capture with Project Assistant off', async () => {
      const modeId = '10000000-0000-4000-8000-000000000101';
      const snapshotContent = {
        schemaVersion: 'project-mode-snapshot.v2' as const,
        modeId,
        catalogDescription: 'Proof-first review mode.',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1' as const,
          files: { 'MODE.md': 'Ground every claim.' },
        },
        projectAssistant: { enabled: false },
      };
      const config: AgentSessionConfigV2 = {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId,
        },
        projectModeSnapshot: {
          ...snapshotContent,
          snapshotHash: createHash('sha256')
            .update(JSON.stringify(snapshotContent))
            .digest('hex'),
        },
      };
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: false,
        config,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: undefined,
          config,
        }),
      ).resolves.toEqual(config);
    });

    it('rejects a project MODE capture that differs from the persisted session', async () => {
      const modeId = '10000000-0000-4000-8000-000000000101';
      const snapshotContent = {
        schemaVersion: 'project-mode-snapshot.v1' as const,
        modeId,
        catalogDescription: 'Proof-first review mode.',
        applicableWorkItemTypeKeys: ['STANDARD'],
        files: {
          schemaVersion: 'project-mode-files.v1' as const,
          files: { 'MODE.md': 'Ground every claim.' },
        },
      };
      const snapshot = {
        ...snapshotContent,
        snapshotHash: createHash('sha256')
          .update(JSON.stringify(snapshotContent))
          .digest('hex'),
      };
      const persistedConfig: AgentSessionConfigV2 = {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId,
        },
        projectModeSnapshot: snapshot,
      };
      prisma.db.agentSession.findFirst.mockResolvedValue({
        autoDecide: false,
        config: persistedConfig,
      });

      await expect(
        service.resolveStartRunConfiguration({
          ...params,
          taskMonitorId: undefined,
          config: {
            ...persistedConfig,
            projectModeSnapshot: {
              ...snapshot,
              catalogDescription: 'Forged replacement.',
            },
          },
        }),
      ).rejects.toThrow(
        'Project MODE start-run configuration does not match the persisted Agent Session',
      );
    });
  });

  describe('releaseStartRunLaunchClaim', () => {
    const baseSession = (status: AgentSession['status']): AgentSession => ({
      id: 'cs-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status,
      sessionDate: now,
      title: 'Session',
      serviceId: 'service-1',
      provider: 'claude',
      providerAgentSessionId: 'run-1',
      conversationId: 'conv-1',
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    });

    it('moves an IN_PROGRESS pre-launch claim back to NOT_STARTED', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('NOT_STARTED'),
      );

      await service.releaseStartRunLaunchClaim('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'cs-1',
            organizationId: 'org-1',
            status: 'IN_PROGRESS',
          }),
          data: { status: 'NOT_STARTED' },
        }),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'agent_session.status_changed',
          aggregateId: 'cs-1',
          payload: expect.objectContaining({
            previousStatus: 'IN_PROGRESS',
            newStatus: 'NOT_STARTED',
          }),
        }),
      );
    });

    it('does not write an event when there is no IN_PROGRESS claim to release', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseSession('COMPLETED'),
      );

      await service.releaseStartRunLaunchClaim('org-1' as any, 'cs-1');

      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('markSynced', () => {
    it('sets lastSyncedAt to now and hasUnsyncedChanges to false', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });

      await service.markSynced('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'cs-1', organizationId: 'org-1' },
        data: {
          lastSyncedAt: expect.any(Date),
          hasUnsyncedChanges: false,
        },
      });
    });

    it('scopes update to organizationId for tenant isolation', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });

      await service.markSynced('org-other' as any, 'cs-1');

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1', organizationId: 'org-other' },
        }),
      );
    });
  });

  describe('markUnsyncedChanges', () => {
    it('sets hasUnsyncedChanges to true without touching lastSyncedAt', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });

      await service.markUnsyncedChanges('org-1' as any, 'cs-1');

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'cs-1', organizationId: 'org-1' },
        data: { hasUnsyncedChanges: true },
      });
    });

    it('does not throw when session does not exist', async () => {
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markUnsyncedChanges('org-1' as any, 'nonexistent'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findIdByConversationId', () => {
    it('returns session id when a session exists for the conversation', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({ id: 'cs-1' });

      const result = await service.findIdByConversationId(
        'org-1' as any,
        'conv-1',
      );

      expect(result).toBe('cs-1');
      expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', organizationId: 'org-1' },
        select: { id: true },
      });
    });

    it('returns null when no session exists for the conversation', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(null);

      const result = await service.findIdByConversationId(
        'org-1' as any,
        'conv-nonexistent',
      );

      expect(result).toBeNull();
    });
  });

  describe('createConversationForSession', () => {
    const baseSession: AgentSession = {
      id: 'session-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: false,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };

    const mockConversation = {
      id: 'conv-new-1' as any,
      projectId: 'proj-1' as any,
      organizationId: 'org-1' as any,
      status: 'ACTIVE',
      workflowName: 'feature-sync',
    } as any;

    it('creates a conversation through the workflow service and links it to the session', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.findFirst.mockResolvedValue(baseSession);
      conversationWorkflowService.createConversation.mockResolvedValue({
        conversation: mockConversation,
        workflowStarted: true,
        workflowId: 'wf-1',
      } as any);
      const updatedSession = { ...baseSession, conversationId: 'conv-new-1' };
      prisma.db.agentSession.findFirstOrThrow.mockResolvedValue(updatedSession);

      const result = await service.createConversationForSession(
        'org-1' as any,
        'proj-1' as any,
        'session-1',
        { workflowType: 'feature-sync' as any },
      );

      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'feature-sync',
          workflowAboutType: 'agent-session',
          workflowAboutId: 'session-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
        }),
        'org-1',
        expect.objectContaining({ onCreatedInTx: expect.any(Function) }),
      );
      expect(result.agentSession.conversationId).toBe('conv-new-1');
      expect(result.conversation).toBe(mockConversation);
    });

    it('creates and links a TASK_MONITOR coordinator through the real non-Temporal boundary', async () => {
      const temporalClient = {
        workflow: { start: jest.fn() },
      } as any;
      const workflowRegistry = new WorkflowTypeRegistryService(temporalClient);
      const conversationService = createMockConversationService();
      const realConversationWorkflowService = new ConversationWorkflowService(
        conversationService as any,
        workflowRegistry,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const realAgentSessionService = new AgentSessionService(
        prisma as any,
        eventPublisher as any,
        realConversationWorkflowService,
        { registerEntity: jest.fn().mockResolvedValue(undefined) } as any,
        reportService as any,
      );
      const coordinatorSession: AgentSession = {
        ...baseSession,
        id: 'task-monitor-session',
        title: 'Task Monitor Coordinator',
        type: 'TASK_MONITOR',
      };
      const taskMonitorConversation = {
        ...mockConversation,
        id: 'task-monitor-conversation',
        workflowName: WorkflowName.TaskMonitor,
        workflowAboutType: 'agent-session',
        workflowAboutId: coordinatorSession.id,
        workflowId: 'task-monitor-workflow',
      } as any;

      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.create.mockResolvedValue(coordinatorSession);
      prisma.db.agentSession.findFirst
        .mockResolvedValueOnce({ ...coordinatorSession, conversationId: null })
        .mockResolvedValueOnce({
          ...coordinatorSession,
          conversationId: taskMonitorConversation.id,
        });
      prisma.db.agentSession.findFirstOrThrow.mockResolvedValue({
        ...coordinatorSession,
        conversationId: taskMonitorConversation.id,
      });
      prisma.db.agentSession.updateMany.mockResolvedValue({ count: 1 });
      conversationService.createConversation.mockImplementation(
        async (_dto: any, _organizationId: any, options: any) => {
          await options?.onCreatedInTx?.(
            prisma.db as any,
            taskMonitorConversation.id,
          );
          return taskMonitorConversation;
        },
      );

      const created = await realAgentSessionService.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          type: AgentSessionType.TaskMonitor,
        },
      );

      expect(created.type).toBe(AgentSessionType.TaskMonitor);
      expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AgentSessionType.TaskMonitor,
          }),
        }),
      );

      const linked = await realAgentSessionService.createConversationForSession(
        'org-1' as any,
        'proj-1' as any,
        coordinatorSession.id,
        { workflowType: WorkflowName.TaskMonitor },
      );

      expect(linked.conversation.workflowName).toBe(WorkflowName.TaskMonitor);
      expect(linked.agentSession.conversationId).toBe(
        taskMonitorConversation.id,
      );
      expect(temporalClient.workflow.start).not.toHaveBeenCalled();
    });

    it('rejects an unsupported workflow at the real conversation registry boundary', async () => {
      const temporalClient = {
        workflow: { start: jest.fn() },
      } as any;
      const workflowRegistry = new WorkflowTypeRegistryService(temporalClient);
      const conversationService = createMockConversationService();
      const realConversationWorkflowService = new ConversationWorkflowService(
        conversationService as any,
        workflowRegistry,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const realAgentSessionService = new AgentSessionService(
        prisma as any,
        eventPublisher as any,
        realConversationWorkflowService,
        { registerEntity: jest.fn().mockResolvedValue(undefined) } as any,
        reportService as any,
      );

      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.findFirst.mockResolvedValue(baseSession);

      await expect(
        realAgentSessionService.createConversationForSession(
          'org-1' as any,
          'proj-1' as any,
          baseSession.id,
          { workflowType: 'not-a-real-workflow' as any },
        ),
      ).rejects.toBeInstanceOf(UnsupportedWorkflowTypeError);
      expect(conversationService.createConversation).not.toHaveBeenCalled();
    });

    it('returns the exact conversation already bound to the session', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      const boundSession = {
        ...baseSession,
        conversationId: 'existing-conv',
      };
      prisma.db.agentSession.findFirst.mockResolvedValue(boundSession);
      prisma.db.agentSession.findFirstOrThrow.mockResolvedValue(boundSession);
      conversationService.getConversationFromAdapter.mockResolvedValue({
        ...mockConversation,
        id: 'existing-conv',
      });

      const result = await service.createConversationForSession(
        'org-1' as any,
        'proj-1' as any,
        'session-1',
        { workflowType: 'feature-sync' as any },
      );

      expect(result.agentSession.conversationId).toBe('existing-conv');
      expect(result.conversation.id).toBe('existing-conv');
      expect(
        conversationWorkflowService.createConversation,
      ).not.toHaveBeenCalled();
    });

    it('throws 400 when session not found in the project', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.findFirst.mockResolvedValue(null);

      await expect(
        service.createConversationForSession(
          'org-1' as any,
          'proj-1' as any,
          'missing-session',
          { workflowType: 'agent-session' as any },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 400 when project does not belong to org', async () => {
      prisma.db.project.findFirst.mockResolvedValue(null);

      await expect(
        service.createConversationForSession(
          'org-1' as any,
          'wrong-project' as any,
          'session-1',
          { workflowType: 'agent-session' as any },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('resolveStartRunConversationBinding', () => {
    it('recognizes the exact Agent Session binding for repository import materialization', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        conversationId: 'conversation-1',
      });

      await expect(
        service.resolveStartRunConversationBinding({
          organizationId: 'org-1' as any,
          projectId: 'proj-1' as any,
          agentSessionId: 'session-1',
          conversationId: 'conversation-1' as any,
          conversationWorkflowName: WorkflowName.RepositoryImport,
          requestedWorkflowName: WorkflowName.RepositoryImport,
        }),
      ).resolves.toEqual({ kind: 'REPOSITORY_IMPORT_MATERIALIZATION' });
    });

    it('rejects repository import materialization for a different bound Conversation', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        conversationId: 'different-conversation',
      });

      await expect(
        service.resolveStartRunConversationBinding({
          organizationId: 'org-1' as any,
          projectId: 'proj-1' as any,
          agentSessionId: 'session-1',
          conversationId: 'conversation-1' as any,
          conversationWorkflowName: WorkflowName.RepositoryImport,
          requestedWorkflowName: WorkflowName.RepositoryImport,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'REPOSITORY_IMPORT_START_RUN_BINDING_MISMATCH',
        }),
      });
    });

    it('accepts a qualifying persisted onboarding import through compatibility', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        conversationId: 'conversation-1',
      });
      prisma.db.conversation.findFirst.mockResolvedValue({
        workflowName: WorkflowName.Onboarding,
        flowExecutions: [
          {
            flowId: WorkflowName.Onboarding,
            currentNode: 'onboarding-repository-grounding-analysis',
            flowState: { context: { repositoryGrounding: {} } },
          },
        ],
      });

      await expect(
        service.resolveStartRunConversationBinding({
          organizationId: 'org-1' as any,
          projectId: 'proj-1' as any,
          agentSessionId: 'session-1',
          conversationId: 'conversation-1' as any,
          conversationWorkflowName: WorkflowName.Onboarding,
          requestedWorkflowName: WorkflowName.RepositoryImport,
        }),
      ).resolves.toEqual({ kind: 'REPOSITORY_IMPORT_MATERIALIZATION' });
    });

    it('leaves every other workflow launch on the standard kickoff path', async () => {
      await expect(
        service.resolveStartRunConversationBinding({
          organizationId: 'org-1' as any,
          projectId: 'proj-1' as any,
          agentSessionId: 'session-1',
          conversationId: 'conversation-1' as any,
          conversationWorkflowName: WorkflowName.PlanFromDesignDoc,
          requestedWorkflowName: WorkflowName.PlanFromDesignDoc,
        }),
      ).resolves.toEqual({ kind: 'STANDARD_LAUNCH' });
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('default title fallback and applyDerivedTitleByConversation', () => {
    it('persists the "Agent Session" default when no title is supplied on create', async () => {
      const created: AgentSession = {
        id: 'cs-default',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        title: 'Agent Session',
        serviceId: null,
        provider: null,
        providerAgentSessionId: null,
        conversationId: null,
        entityType: null,
        entityId: null,
        lastSyncedAt: null,
        hasUnsyncedChanges: false,
        contextSizeTokens: null,
        contextSizeRunId: null,
        contextSizeProviderSessionId: null,
        contextSizeObservedAt: null,
        contextSizeMaxTokens: null,
        monitoringEnabled: true,
        autoDecide: false,
        type: 'TASK_REFINING',
        config: null,
        createdAt: now,
        updatedAt: now,
      };
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.create.mockResolvedValue(created);

      await service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
        projectId: 'proj-1' as any,
        sessionDate: now.toISOString(),
        type: 'TASK_REFINING',
      });

      expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Agent Session' }),
        }),
      );
    });

    it('overrides the default title for the conversation when applyDerivedTitleByConversation is called', async () => {
      prisma.db.agentSession.findMany.mockResolvedValue([{ id: 'cs-1' }]);

      await service.applyDerivedTitleByConversation(
        'org-1' as any,
        'conv-1' as any,
        'Plumb feature flags',
      );

      expect(prisma.db.agentSession.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          organizationId: 'org-1',
          title: 'Agent Session',
        },
        data: { title: 'Plumb feature flags' },
      });
    });

    it('syncs the registry name after applying a derived title', async () => {
      prisma.db.agentSession.findMany.mockResolvedValue([
        { id: 'cs-a' },
        { id: 'cs-b' },
      ]);
      const registerEntity = jest.fn().mockResolvedValue(undefined);
      const localService = new AgentSessionService(
        prisma as any,
        eventPublisher as any,
        conversationWorkflowService as any,
        { registerEntity } as any,
        reportService as any,
      );

      await localService.applyDerivedTitleByConversation(
        'org-1' as any,
        'conv-1' as any,
        'Plumb feature flags',
      );

      expect(registerEntity).toHaveBeenCalledTimes(2);
      expect(registerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          entityId: 'cs-a',
          entityType: 'AGENT_SESSION',
          name: 'Plumb feature flags',
        }),
      );
      expect(registerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          entityId: 'cs-b',
          entityType: 'AGENT_SESSION',
          name: 'Plumb feature flags',
        }),
      );
    });

    it('does not touch updateMany or registry when no sessions match the default title', async () => {
      prisma.db.agentSession.findMany.mockResolvedValue([]);
      const registerEntity = jest.fn().mockResolvedValue(undefined);
      const localService = new AgentSessionService(
        prisma as any,
        eventPublisher as any,
        conversationWorkflowService as any,
        { registerEntity } as any,
        reportService as any,
      );

      await localService.applyDerivedTitleByConversation(
        'org-1' as any,
        'conv-1' as any,
        'Plumb feature flags',
      );

      expect(prisma.db.agentSession.updateMany).not.toHaveBeenCalled();
      expect(registerEntity).not.toHaveBeenCalled();
    });

    it('skips the title update when the derived title equals the default', async () => {
      await service.applyDerivedTitleByConversation(
        'org-1' as any,
        'conv-1' as any,
        'Agent Session',
      );

      expect(prisma.db.agentSession.updateMany).not.toHaveBeenCalled();
    });

    it('skips the title update when the derived title is blank', async () => {
      await service.applyDerivedTitleByConversation(
        'org-1' as any,
        'conv-1' as any,
        '   ',
      );

      expect(prisma.db.agentSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('monitoringEnabled persistence and projection', () => {
    const baseRow = (overrides: Partial<AgentSession>): AgentSession =>
      ({
        id: 'cs-mon',
        organizationId: 'org-1',
        projectId: 'proj-1',
        userId: 'user-1',
        machineId: null,
        status: 'NOT_STARTED',
        sessionDate: now,
        title: 'Session',
        serviceId: null,
        provider: null,
        providerAgentSessionId: null,
        conversationId: null,
        entityType: null,
        entityId: null,
        lastSyncedAt: null,
        hasUnsyncedChanges: false,
        contextSizeTokens: null,
        contextSizeRunId: null,
        contextSizeProviderSessionId: null,
        contextSizeObservedAt: null,
        contextSizeMaxTokens: null,
        monitoringEnabled: false,
        autoDecide: false,
        type: 'CODING',
        config: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      }) satisfies AgentSession;

    it('persists monitoringEnabled=true via update and returns it on the DTO', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(baseRow({}));
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ monitoringEnabled: true }),
      );

      const result = await service.update('org-1' as any, 'cs-mon', {
        monitoringEnabled: true,
      });

      expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-mon' },
          data: expect.objectContaining({ monitoringEnabled: true }),
        }),
      );
      expect(result.monitoringEnabled).toBe(true);
    });

    it('reads back monitoringEnabled via findOne without service join', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseRow({ monitoringEnabled: true }),
      );

      const result = await service.findOne('org-1' as any, 'cs-mon');

      expect(result.monitoringEnabled).toBe(true);
    });

    it('reads back monitoringEnabled via findOne with service summary join', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        {
          id: 'cs-mon',
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          machineId: null,
          status: 'NOT_STARTED',
          sessionDate: now,
          serviceId: 'service-1',
          provider: 'claude',
          providerAgentSessionId: 'run-1',
          conversationId: null,
          entityType: null,
          entityId: null,
          title: 'Session',
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          contextSizeTokens: null,
          contextSizeRunId: null,
          contextSizeProviderSessionId: null,
          contextSizeObservedAt: null,
          contextSizeMaxTokens: null,
          monitoringEnabled: true,
          autoDecide: false,
          type: 'CODING',
          config: null,
          createdAt: now,
          updatedAt: now,
          joinedServiceId: 'service-1',
          joinedServiceName: 'API Service',
          selectedServiceIds: ['service-1'],
        },
      ]);
      (prisma.db as any).$queryRaw = queryRaw;

      const result = await service.findOne('org-1' as any, 'cs-mon', {
        includeService: true,
      });

      const executedQuery = queryRaw.mock.calls[0]?.[0] as
        | { strings?: string[] }
        | undefined;
      const querySql = executedQuery?.strings?.join(' ') ?? '';
      expect(querySql).toContain(
        'cs.monitoring_enabled AS "monitoringEnabled"',
      );
      expect(result.monitoringEnabled).toBe(true);
    });

    it('reads back monitoringEnabled via findAll without service join', async () => {
      prisma.db.agentSession.findMany.mockResolvedValue([
        baseRow({ monitoringEnabled: true }),
        baseRow({ id: 'cs-other', monitoringEnabled: false }),
      ]);

      const result = await service.findAll('org-1' as any, 'proj-1' as any);

      expect(result.map((r) => r.monitoringEnabled)).toEqual([true, false]);
    });

    it('reads back monitoringEnabled via findAll with service summary join', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        {
          id: 'cs-mon',
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          machineId: null,
          status: 'NOT_STARTED',
          sessionDate: now,
          serviceId: 'service-1',
          provider: 'claude',
          providerAgentSessionId: 'run-1',
          conversationId: null,
          entityType: null,
          entityId: null,
          title: 'Session',
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          monitoringEnabled: true,
          autoDecide: false,
          type: 'CODING',
          config: null,
          createdAt: now,
          updatedAt: now,
          joinedServiceId: 'service-1',
          joinedServiceName: 'API Service',
          selectedServiceIds: ['service-1'],
        },
      ]);
      (prisma.db as any).$queryRaw = queryRaw;

      const result = await service.findAll(
        'org-1' as any,
        'proj-1' as any,
        {},
        true,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.monitoringEnabled).toBe(true);
    });

    it('scopes the update to the specific session so a sibling session is unaffected', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(baseRow({}));
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ monitoringEnabled: true }),
      );

      await service.update('org-1' as any, 'cs-mon', {
        monitoringEnabled: true,
      });

      expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-mon' },
        }),
      );
      expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-mon', organizationId: 'org-1' },
          include: expect.objectContaining({
            serviceRelations: expect.any(Object),
          }),
        }),
      );
      expect(prisma.db.agentSession.updateMany).not.toHaveBeenCalled();
    });

    it('reads back autoDecide via findOne without service join', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseRow({ autoDecide: true }),
      );

      const result = await service.findOne('org-1' as any, 'cs-mon');

      expect(result.autoDecide).toBe(true);
    });

    it('reads back autoDecide via findAll without service join', async () => {
      prisma.db.agentSession.findMany.mockResolvedValue([
        baseRow({ autoDecide: true }),
        baseRow({ id: 'cs-other', autoDecide: false }),
      ]);

      const result = await service.findAll('org-1' as any, 'proj-1' as any);

      expect(result.map((r) => r.autoDecide)).toEqual([true, false]);
    });

    it('reads back autoDecide via findOne with service summary join', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        {
          id: 'cs-mon',
          organizationId: 'org-1',
          projectId: 'proj-1',
          userId: 'user-1',
          machineId: null,
          status: 'NOT_STARTED',
          sessionDate: now,
          serviceId: 'service-1',
          provider: 'claude',
          providerAgentSessionId: 'run-1',
          conversationId: null,
          entityType: null,
          entityId: null,
          title: 'Session',
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          monitoringEnabled: false,
          autoDecide: true,
          type: 'CODING',
          config: null,
          createdAt: now,
          updatedAt: now,
          joinedServiceId: 'service-1',
          joinedServiceName: 'API Service',
          selectedServiceIds: ['service-1'],
        },
      ]);
      (prisma.db as any).$queryRaw = queryRaw;

      const result = await service.findOne('org-1' as any, 'cs-mon', {
        includeService: true,
      });

      const executedQuery = queryRaw.mock.calls[0]?.[0] as
        | { strings?: string[] }
        | undefined;
      const querySql = executedQuery?.strings?.join(' ') ?? '';
      expect(querySql).toContain('cs.auto_decide AS "autoDecide"');
      expect(result.autoDecide).toBe(true);
    });

    it('defaults autoDecide to false on create when the field is omitted', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.create.mockResolvedValue(baseRow({}));

      const result = await service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          title: 'Session',
          type: 'CODING',
        },
      );

      const createArgs = prisma.db.agentSession.create.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(createArgs?.data).not.toHaveProperty('autoDecide');
      expect(result.autoDecide).toBe(false);
    });

    it('persists autoDecide=true on create when explicitly provided', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.create.mockResolvedValue(
        baseRow({ autoDecide: true }),
      );

      const result = await service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          title: 'Session',
          type: 'CODING',
          autoDecide: true,
        },
      );

      expect(prisma.db.agentSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ autoDecide: true }),
        }),
      );
      expect(result.autoDecide).toBe(true);
    });

    it('persists autoDecide=true via update and returns it on the DTO', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(baseRow({}));
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ autoDecide: true }),
      );

      const result = await service.update('org-1' as any, 'cs-mon', {
        autoDecide: true,
      });

      expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-mon' },
          data: expect.objectContaining({ autoDecide: true }),
        }),
      );
      expect(result.autoDecide).toBe(true);
    });

    it('persists autoDecide=false via update and returns it on the DTO', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseRow({ autoDecide: true }),
      );
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ autoDecide: false }),
      );

      const result = await service.update('org-1' as any, 'cs-mon', {
        autoDecide: false,
      });

      expect(prisma.db.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-mon' },
          data: expect.objectContaining({ autoDecide: false }),
        }),
      );
      expect(result.autoDecide).toBe(false);
    });

    it('omits autoDecide from the update payload when the field is not provided', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseRow({ autoDecide: true }),
      );
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ autoDecide: true, title: 'Renamed' }),
      );

      await service.update('org-1' as any, 'cs-mon', { title: 'Renamed' });

      const updateArgs = prisma.db.agentSession.update.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(updateArgs?.data).not.toHaveProperty('autoDecide');
    });

    it('rejects non-boolean autoDecide on update', async () => {
      await expect(
        service.update('org-1' as any, 'cs-mon', {
          autoDecide: 'yes' as unknown as boolean,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('omits monitoringEnabled from the update payload when the field is not provided', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(
        baseRow({ monitoringEnabled: true }),
      );
      prisma.db.agentSession.update.mockResolvedValue(
        baseRow({ monitoringEnabled: true, title: 'Renamed' }),
      );

      await service.update('org-1' as any, 'cs-mon', { title: 'Renamed' });

      const updateCall = prisma.db.agentSession.update.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(updateCall?.data).not.toHaveProperty('monitoringEnabled');
    });

    it('rejects a non-boolean monitoringEnabled payload with BadRequestException', async () => {
      await expect(
        service.update('org-1' as any, 'cs-mon', {
          monitoringEnabled: 'true' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });
  });

  describe('AgentSession config persistence', () => {
    const projectAssistantStates = [
      ['omitted', undefined],
      ['enabled', { enabled: true }],
      ['disabled', { enabled: false }],
    ] as const;

    const baseRow: AgentSession = {
      id: 'cs-config',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userId: 'user-1',
      machineId: null,
      status: 'NOT_STARTED',
      sessionDate: now,
      title: 'Session',
      serviceId: null,
      provider: null,
      providerAgentSessionId: null,
      conversationId: null,
      entityType: null,
      entityId: null,
      lastSyncedAt: null,
      hasUnsyncedChanges: false,
      contextSizeTokens: null,
      contextSizeRunId: null,
      contextSizeProviderSessionId: null,
      contextSizeObservedAt: null,
      contextSizeMaxTokens: null,
      monitoringEnabled: true,
      autoDecide: false,
      type: 'CODING',
      config: null,
      createdAt: now,
      updatedAt: now,
    };

    it('persists config on create and round-trips through the DTO', async () => {
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.agentSession.create.mockResolvedValue({
        ...baseRow,
        config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
      } satisfies AgentSession);

      const dto = await service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          type: 'CODING',
          config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
        },
      );

      const createCall = prisma.db.agentSession.create.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(createCall?.data?.config).toEqual({
        type: 'CODING_SESSION_V1',
        version: 'v1',
        method: 'plan',
      });
      expect(dto.config).toEqual({
        type: 'CODING_SESSION_V1',
        version: 'v1',
        method: 'plan',
      });
    });

    it.each(projectAssistantStates)(
      'creates and reloads Entity Conversation config with Project Assistant %s',
      async (_state, projectAssistant) => {
        const config: AgentSessionConfigEntityConversationV1 = {
          type: AgentSessionConfigEntityConversationV1.TypeEnum
            .EntityConversation,
          version: AgentSessionConfigEntityConversationV1.VersionEnum.V1,
          model: 'gpt-5.6-luna',
          effort: AgentSessionConfigEntityConversationV1.EffortEnum.High,
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };
        const storedConfig: Prisma.JsonValue = JSON.parse(
          JSON.stringify(config),
        );
        const persistedRow = buildAgentSession({
          type: 'ENTITY_CONVERSATION',
          config: storedConfig,
        });
        prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
        prisma.db.task.findFirst.mockResolvedValue({
          id: persistedRow.entityId,
          type: 'STANDARD',
          parentTaskId: null,
          projectId: 'proj-1',
        });
        prisma.db.agentSession.create.mockResolvedValue(persistedRow);

        const created = await service.create(
          'org-1' as any,
          'proj-1' as any,
          'user-1' as any,
          {
            projectId: 'proj-1' as any,
            sessionDate: now.toISOString(),
            type: 'ENTITY_CONVERSATION',
            config,
          },
        );

        const createCall = prisma.db.agentSession.create.mock.calls[0]?.[0] as
          | { data: { config?: Record<string, unknown> } }
          | undefined;
        expect(createCall?.data.config).toEqual(config);
        expect(created.config).toEqual(config);

        prisma.db.agentSession.findFirst.mockResolvedValue(persistedRow);
        const reloaded = await service.findOne('org-1' as any, persistedRow.id);
        expect(reloaded.config).toEqual(config);
      },
    );

    it.each(projectAssistantStates)(
      'updates Entity Conversation config with Project Assistant %s',
      async (_state, projectAssistant) => {
        const config: AgentSessionConfigEntityConversationV1 = {
          type: AgentSessionConfigEntityConversationV1.TypeEnum
            .EntityConversation,
          version: AgentSessionConfigEntityConversationV1.VersionEnum.V1,
          model: 'gpt-5.6-luna',
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };
        const storedConfig: Prisma.JsonValue = JSON.parse(
          JSON.stringify(config),
        );
        const txClient = {
          agentSession: {
            findFirst: jest.fn().mockResolvedValue(baseRow),
            update: jest.fn().mockResolvedValue({
              ...baseRow,
              type: 'ENTITY_CONVERSATION',
              config: storedConfig,
            } satisfies AgentSession),
          },
          service: { findFirst: jest.fn() },
        };
        prisma.db.$transaction.mockImplementationOnce(
          async (cb: (client: typeof txClient) => Promise<unknown>) =>
            cb(txClient),
        );

        const updated = await service.update('org-1' as any, 'cs-config', {
          config,
        });

        const updateCall = txClient.agentSession.update.mock.calls[0]?.[0] as
          | { data: { config?: Record<string, unknown> } }
          | undefined;
        expect(updateCall?.data.config).toEqual(config);
        expect(updated.config).toEqual(config);
      },
    );

    it('validates and round-trips Task Monitor ownership on create', async () => {
      const config: AgentSessionConfigV2 = {
        type: AgentSessionConfigV2.TypeEnum.CodingSession,
        version: AgentSessionConfigV2.VersionEnum.V2,
        model: 'gpt-5.6-luna',
        taskMonitorId: sessionId2,
      };
      prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      prisma.db.task.findFirst.mockResolvedValue({ type: 'TASK_MONITOR' });
      prisma.db.agentSession.create.mockResolvedValue(
        buildAgentSession({
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5.6-luna',
            taskMonitorId: sessionId2,
          },
        }),
      );

      const dto = await service.create(
        'org-1' as any,
        'proj-1' as any,
        'user-1' as any,
        {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          type: 'CODING',
          config,
        },
      );

      expect(prisma.db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: sessionId2,
          organizationId: 'org-1',
          projectId: 'proj-1',
          archivedAt: null,
        },
        select: { type: true },
      });
      expect(prisma.db.agentSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5.6-luna',
            taskMonitorId: sessionId2,
          },
        }),
      });
      expect(dto.config).toEqual(config);
    });

    it.each([
      ['missing or out-of-scope', null],
      ['wrong type', { type: 'STANDARD' }],
    ])(
      'rejects %s Task Monitor ownership before creating the Agent Session',
      async (_case, monitor) => {
        const config: AgentSessionConfigV2 = {
          type: AgentSessionConfigV2.TypeEnum.CodingSession,
          version: AgentSessionConfigV2.VersionEnum.V2,
          model: 'gpt-5.6-luna',
          taskMonitorId: sessionId2,
        };
        prisma.db.project.findFirst.mockResolvedValue({ id: 'proj-1' });
        prisma.db.task.findFirst.mockResolvedValue(monitor);

        await expect(
          service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
            projectId: 'proj-1' as any,
            sessionDate: now.toISOString(),
            type: 'CODING',
            config,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
        expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
      },
    );

    it('rejects a malformed Task Monitor identity before transaction side effects', async () => {
      await expect(
        service.create('org-1' as any, 'proj-1' as any, 'user-1' as any, {
          projectId: 'proj-1' as any,
          sessionDate: now.toISOString(),
          type: 'CODING',
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5.6-luna',
            taskMonitorId: 'not-a-uuid',
          },
        }),
      ).rejects.toThrow('config.taskMonitorId must be a UUID when present');

      expect(prisma.db.$transaction).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.create).not.toHaveBeenCalled();
    });

    it('reads a missing config column as null on the DTO', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue(baseRow);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toBeNull();
    });

    it('returns AgentSessionConfigV1 with the version literal intact when reading back', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        ...baseRow,
        config: { version: 'v1', method: 'open' },
      } satisfies AgentSession);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toEqual({
        type: 'CODING_SESSION_V1',
        version: 'v1',
        method: 'open',
      });
    });

    it('merges a config patch by replacing the persisted blob', async () => {
      const txClient = {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(baseRow),
          update: jest.fn().mockResolvedValue({
            ...baseRow,
            config: {
              type: 'CODING_SESSION_V1',
              version: 'v1',
              method: 'plan',
            },
          } satisfies AgentSession),
        },
        service: { findFirst: jest.fn() },
      };
      prisma.db.$transaction.mockImplementationOnce(
        async (cb: (client: typeof txClient) => Promise<unknown>) =>
          cb(txClient),
      );

      const dto = await service.update('org-1' as any, 'cs-config', {
        config: { type: 'CODING_SESSION_V1', version: 'v1', method: 'plan' },
      });

      const updateArgs = txClient.agentSession.update.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(updateArgs?.data?.config).toEqual({
        type: 'CODING_SESSION_V1',
        version: 'v1',
        method: 'plan',
      });
      expect(dto.config).toEqual({
        type: 'CODING_SESSION_V1',
        version: 'v1',
        method: 'plan',
      });
    });

    it.each([
      [
        'add',
        null,
        {
          type: 'CODING_SESSION' as const,
          version: 'v2' as const,
          model: 'gpt-5.6-luna',
          taskMonitorId: sessionId2,
        },
      ],
      [
        'remove',
        {
          type: 'CODING_SESSION',
          version: 'v2',
          model: 'gpt-5.6-luna',
          taskMonitorId: sessionId2,
        },
        {
          type: 'CODING_SESSION' as const,
          version: 'v2' as const,
          model: 'gpt-5.6-luna',
        },
      ],
      [
        'change',
        {
          type: 'CODING_SESSION',
          version: 'v2',
          model: 'gpt-5.6-luna',
          taskMonitorId: sessionId2,
        },
        {
          type: 'CODING_SESSION' as const,
          version: 'v2' as const,
          model: 'gpt-5.6-luna',
          taskMonitorId: sessionId3,
        },
      ],
    ])(
      'rejects an attempt to %s Task Monitor ownership after creation',
      async (_case, existingConfig, requestedConfig) => {
        const txClient = {
          agentSession: {
            findFirst: jest.fn().mockResolvedValue({
              ...baseRow,
              config: existingConfig,
            }),
            update: jest.fn(),
          },
          service: { findFirst: jest.fn() },
        };
        prisma.db.$transaction.mockImplementationOnce(
          async (cb: (client: typeof txClient) => Promise<unknown>) =>
            cb(txClient),
        );

        await expect(
          service.update('org-1' as any, 'cs-config', {
            config: requestedConfig,
          }),
        ).rejects.toThrow(
          'config.taskMonitorId is immutable after Agent Session creation',
        );

        expect(txClient.agentSession.update).not.toHaveBeenCalled();
      },
    );

    it('rejects a patch with an unknown version literal', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION' as any,
            version: 'v0' as any,
            method: 'plan',
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('rejects a patch with an unknown method', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION_V1',
            version: 'v1',
            method: 'not-a-method' as any,
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('persists a V2 config with model, effort, and worktree via update', async () => {
      const txClient = {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(baseRow),
          update: jest.fn().mockResolvedValue({
            ...baseRow,
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              method: 'plan',
              model: 'claude-opus-4-8',
              effort: 'medium',
              worktree: 'feature/my-feature',
            },
          } satisfies AgentSession),
        },
        service: { findFirst: jest.fn() },
      };
      prisma.db.$transaction.mockImplementationOnce(
        async (cb: (client: typeof txClient) => Promise<unknown>) =>
          cb(txClient),
      );

      const dto = await service.update('org-1' as any, 'cs-config', {
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          method: 'plan',
          model: 'claude-opus-4-8',
          effort: 'medium',
          worktree: 'feature/my-feature',
        },
      });

      const updateArgs = txClient.agentSession.update.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(updateArgs?.data?.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'plan',
        model: 'claude-opus-4-8',
        effort: 'medium',
        worktree: 'feature/my-feature',
      });
      expect(dto.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'plan',
        model: 'claude-opus-4-8',
        effort: 'medium',
        worktree: 'feature/my-feature',
      });
    });

    it.each([
      ['enabled', true],
      ['disabled', false],
      ['omitted', undefined],
    ] as const)(
      'persists and reloads Fast mode when %s',
      async (_state, fastMode) => {
        const config = {
          type: 'CODING_SESSION' as const,
          version: 'v2' as const,
          method: 'quick' as const,
          model: 'gpt-5.6-luna',
          ...(fastMode === undefined ? {} : { fastMode }),
        };
        const txClient = {
          agentSession: {
            findFirst: jest.fn().mockResolvedValue(baseRow),
            update: jest.fn().mockResolvedValue({
              ...baseRow,
              config,
            } satisfies AgentSession),
          },
          service: { findFirst: jest.fn() },
        };
        prisma.db.$transaction.mockImplementationOnce(
          async (cb: (client: typeof txClient) => Promise<unknown>) =>
            cb(txClient),
        );

        const dto = await service.update('org-1' as any, 'cs-config', {
          config,
        });

        const updateArgs = txClient.agentSession.update.mock.calls[0]?.[0] as
          | { data: { config?: Record<string, unknown> } }
          | undefined;
        expect(updateArgs?.data?.config).toEqual(config);
        expect(dto.config).toEqual(config);
      },
    );

    it('persists a V2 config with a session-monitor terminal policy', async () => {
      const terminalPolicy = {
        implementationDone: {
          requestReview: true as const,
        },
        reviewDone: {
          completion: { action: 'DONE', response: 'Review settled.' },
        },
      };
      const txClient = {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(baseRow),
          update: jest.fn().mockResolvedValue({
            ...baseRow,
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              model: 'gpt-5-codex',
              sessionMonitorTerminalPolicy: terminalPolicy,
            },
          } satisfies AgentSession),
        },
        service: { findFirst: jest.fn() },
      };
      prisma.db.$transaction.mockImplementationOnce(
        async (cb: (client: typeof txClient) => Promise<unknown>) =>
          cb(txClient),
      );

      const dto = await service.update('org-1' as any, 'cs-config', {
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          model: 'gpt-5-codex',
          sessionMonitorTerminalPolicy: terminalPolicy,
        },
      });

      const updateArgs = txClient.agentSession.update.mock.calls[0]?.[0] as
        | { data: { config?: Record<string, unknown> } }
        | undefined;
      expect(updateArgs?.data?.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'gpt-5-codex',
        sessionMonitorTerminalPolicy: terminalPolicy,
      });
      expect(dto.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'gpt-5-codex',
        sessionMonitorTerminalPolicy: terminalPolicy,
      });
    });

    it('rejects a config missing the type discriminator', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            version: 'v2',
            model: 'gpt-5-codex',
            sessionMonitorTerminalPolicy: {
              implementationDone: {
                completion: { action: 'DONE' },
              },
              reviewDone: {
                completion: { action: 'DONE' },
              },
            },
          } as any,
        }),
      ).rejects.toThrow(
        'config.type must be one of: CODING_SESSION_V1, CODING_SESSION',
      );
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('rejects removed reportType routing on a semantic terminal-policy arm', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5-codex',
            sessionMonitorTerminalPolicy: {
              implementationDone: {
                reportType: 'IMPLEMENT',
                completion: { action: 'DONE' },
              },
              reviewDone: {
                completion: { action: 'DONE' },
              },
            },
          } as any,
        }),
      ).rejects.toThrow(
        'config.sessionMonitorTerminalPolicy.implementationDone contains unsupported field(s): reportType',
      );
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('rejects unsupported terminal policy keys', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5-codex',
            sessionMonitorTerminalPolicy: {
              implementationDone: {
                completion: { action: 'DONE' },
              },
              reviewDone: {
                completion: { action: 'DONE' },
              },
              extra: true,
            },
          } as any,
        }),
      ).rejects.toThrow(
        'config.sessionMonitorTerminalPolicy contains unsupported field(s): extra',
      );
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('persists a V2 config with effort and worktree omitted when undefined', async () => {
      const txClient = {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(baseRow),
          update: jest.fn().mockResolvedValue({
            ...baseRow,
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              method: 'open',
              model: 'gpt-5-codex',
            },
          } satisfies AgentSession),
        },
        service: { findFirst: jest.fn() },
      };
      prisma.db.$transaction.mockImplementationOnce(
        async (cb: (client: typeof txClient) => Promise<unknown>) =>
          cb(txClient),
      );

      await service.update('org-1' as any, 'cs-config', {
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          method: 'open',
          model: 'gpt-5-codex',
        },
      });

      const updateArgs = txClient.agentSession.update.mock.calls[0]?.[0] as
        | { data: { config?: Record<string, unknown> } }
        | undefined;
      expect(updateArgs?.data?.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'open',
        model: 'gpt-5-codex',
      });
      expect(updateArgs?.data?.config).not.toHaveProperty('effort');
      expect(updateArgs?.data?.config).not.toHaveProperty('worktree');
    });

    it('rejects a V2 patch missing the required model field', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            method: 'plan',
          } as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('normalizes a stored V2 config without type on the DTO', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        ...baseRow,
        config: {
          version: 'v2',
          method: 'plan',
          model: 'claude-opus-4-7',
          effort: 'high',
        },
      } satisfies AgentSession);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'plan',
        model: 'claude-opus-4-7',
        effort: 'high',
      });
    });

    it('returns null for a stored V2 row missing model so the wire never lies', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        ...baseRow,
        config: { version: 'v2', method: 'plan' },
      } satisfies AgentSession);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toBeNull();
    });

    it('rejects a V2 patch with empty string worktree', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-4',
            worktree: '' as any,
          },
        }),
      ).rejects.toThrow(
        'config.worktree must be a non-empty string branch name when present',
      );
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('rejects a V2 patch with non-string worktree', async () => {
      await expect(
        service.update('org-1' as any, 'cs-config', {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-4',
            worktree: true as any,
          },
        }),
      ).rejects.toThrow(
        'config.worktree must be a non-empty string branch name when present',
      );
      expect(prisma.db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.agentSession.update).not.toHaveBeenCalled();
    });

    it('parses stored string worktree correctly on read', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        ...baseRow,
        config: {
          version: 'v2',
          method: 'plan',
          model: 'claude-opus-4-7',
          worktree: 'feature/branch-name',
        },
      } satisfies AgentSession);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'plan',
        model: 'claude-opus-4-7',
        worktree: 'feature/branch-name',
      });
    });

    it('omits worktree from parsed config when stored value is empty string', async () => {
      prisma.db.agentSession.findFirst.mockResolvedValue({
        ...baseRow,
        config: {
          version: 'v2',
          method: 'plan',
          model: 'claude-opus-4-7',
          worktree: '',
        },
      } satisfies AgentSession);
      const dto = await service.findOne('org-1' as any, 'cs-config');
      expect(dto.config).toEqual({
        type: 'CODING_SESSION',
        version: 'v2',
        method: 'plan',
        model: 'claude-opus-4-7',
      });
      expect(dto.config).not.toHaveProperty('worktree');
    });
  });
});
