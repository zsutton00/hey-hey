import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AttentionEvent,
  AttentionEventEntity,
  OrganizationRole,
} from 'src/generated';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import { AgentSessionService } from 'src/services/agent-session.service';
import { ConversationService } from 'src/services/conversation.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { ProjectService } from 'src/services/project.service';
import { TaskService } from 'src/services/tasks/task.service';
import {
  AttentionEventService,
  TrackAttentionEventsResponse,
} from '../attention-event.service';

describe('AttentionEventService', () => {
  let service: AttentionEventService;
  let prismaService: PrismaService;
  const projectService = { findOneForAdapter: jest.fn() };
  const taskService = { findOne: jest.fn() };
  const initiativeService = { findOneForAdapter: jest.fn() };
  const designDocService = { findOne: jest.fn() };
  const conversationService = { getConversation: jest.fn() };
  const agentSessionService = { findOne: jest.fn() };

  const mockAuthenticatedUser: AuthenticatedUser = {
    userId: 'user-123' as any,
    email: 'user@example.com',
    name: 'Test User',
    currentOrgId: 'org-123' as any,
    orgMemberships: [
      {
        orgId: 'org-123',
        role: OrganizationRole.Member,
      },
    ],
    isDevAdmin: false,
    devAdminMode: false,
  };

  const createMockAttentionEvent = (
    overrides?: Partial<AttentionEvent>,
  ): AttentionEvent => ({
    eventType: 'attention',
    entity: {
      type: AttentionEventEntity.TypeEnum.Initiative,
      id: 'initiative-1',
    },
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertOrganization: jest.fn(),
            assertProject: jest.fn(),
            accessibleProjectIds: jest.fn().mockResolvedValue(['project-1']),
          },
        },
        AttentionEventService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              $transaction: jest.fn(async (callback) => callback(mockTx)),
              attentionEvent: mockTx.attentionEvent,
              project: mockTx.project,
              initiative: mockTx.initiative,
              task: mockTx.task,
              agentSession: mockTx.agentSession,
              designDoc: mockTx.designDoc,
              service: mockTx.service,
              conversation: mockTx.conversation,
              plan: mockTx.plan,
              entityRegistry: mockTx.entityRegistry,
            },
          },
        },
        {
          provide: ProjectService,
          useValue: projectService,
        },
        {
          provide: TaskService,
          useValue: taskService,
        },
        {
          provide: InitiativeService,
          useValue: initiativeService,
        },
        {
          provide: DesignDocService,
          useValue: designDocService,
        },
        {
          provide: ConversationService,
          useValue: conversationService,
        },
        {
          provide: AgentSessionService,
          useValue: agentSessionService,
        },
      ],
    }).compile();

    service = module.get<AttentionEventService>(AttentionEventService);
    prismaService = module.get<PrismaService>(PrismaService);

    mockTx.initiative.findFirst.mockResolvedValue({
      originatingProjectId: 'project-1',
    });
    mockTx.task.findFirst.mockResolvedValue({
      projectId: 'project-1',
      projectRelations: [],
    });
    mockTx.project.findFirst.mockResolvedValue({
      id: 'project-1',
    });
    mockTx.agentSession.findFirst.mockResolvedValue({
      task: {
        initiative: { originatingProjectId: 'project-1' },
        projectRelations: [],
      },
      initiative: null,
      designDoc: null,
      service: null,
      conversation: null,
    });
  });

  const mockTx = {
    attentionEvent: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    initiative: {
      findFirst: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
    },
    agentSession: {
      findFirst: jest.fn(),
    },
    designDoc: {
      findFirst: jest.fn(),
    },
    service: {
      findFirst: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
    },
    plan: {
      findFirst: jest.fn(),
    },
    entityRegistry: {
      findMany: jest.fn(),
    },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordAttentionEvents', () => {
    it('should create a new attention event when no recent session exists', async () => {
      const event = createMockAttentionEvent();
      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.attentionEvent.create.mockResolvedValue({
        id: 'event-1',
      });

      const result = await service.recordAttentionEvents(
        mockAuthenticatedUser,
        [event],
      );

      expect(result).toEqual({
        eventCount: 1,
        timestamp: expect.any(String),
      });
      expect(mockTx.attentionEvent.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
          entityType: 'INITIATIVE',
          entityId: 'initiative-1',
          projectId: 'project-1',
          tab: undefined,
          focusStart: expect.any(Date),
          focusEnd: expect.any(Date),
          durationMs: 0,
        },
      });
    });

    it('should merge event into recent focus session within 5-minute window', async () => {
      const now = Date.now();
      const event = createMockAttentionEvent({ timestamp: now });

      const recentSession = {
        id: 'session-1',
        focusStart: new Date(now - 2 * 60 * 1000), // 2 minutes ago
        focusEnd: new Date(now - 1 * 60 * 1000), // 1 minute ago
        durationMs: 60000,
      };

      mockTx.attentionEvent.findFirst.mockResolvedValue(recentSession);
      mockTx.attentionEvent.update.mockResolvedValue({});

      const result = await service.recordAttentionEvents(
        mockAuthenticatedUser,
        [event],
      );

      expect(result.eventCount).toBe(1);
      expect(mockTx.attentionEvent.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          projectId: 'project-1',
          focusEnd: expect.any(Date),
          durationMs: expect.any(Number),
        },
      });
      expect(mockTx.attentionEvent.create).not.toHaveBeenCalled();
    });

    it('should create new event if recent session is outside 5-minute window', async () => {
      const now = Date.now();
      const event = createMockAttentionEvent({ timestamp: now });

      // When querying for sessions within the 5-min window, no session is found
      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.attentionEvent.create.mockResolvedValue({});

      const result = await service.recordAttentionEvents(
        mockAuthenticatedUser,
        [event],
      );

      expect(result.eventCount).toBe(1);
      expect(mockTx.attentionEvent.create).toHaveBeenCalled();
      expect(mockTx.attentionEvent.update).not.toHaveBeenCalled();
    });

    it('should handle multiple events correctly', async () => {
      const now = Date.now();
      const events = [
        createMockAttentionEvent({
          timestamp: now,
          entity: { type: 'initiative', id: 'initiative-1' },
        }),
        createMockAttentionEvent({
          timestamp: now + 1000,
          entity: { type: 'project', id: 'project-1' },
        }),
        createMockAttentionEvent({
          timestamp: now + 2000,
          entity: { type: 'task', id: 'task-1' },
        }),
      ];

      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.attentionEvent.create.mockResolvedValue({});

      const result = await service.recordAttentionEvents(
        mockAuthenticatedUser,
        events,
      );

      expect(result.eventCount).toBe(3);
      expect(mockTx.attentionEvent.create).toHaveBeenCalledTimes(3);
    });

    it('should respect tab parameter when checking for recent sessions', async () => {
      const event = createMockAttentionEvent({
        entity: { type: 'initiative', id: 'initiative-1' },
        tab: 'editor',
      });

      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.attentionEvent.create.mockResolvedValue({});

      await service.recordAttentionEvents(mockAuthenticatedUser, [event]);

      expect(mockTx.attentionEvent.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
          entityType: 'INITIATIVE',
          entityId: 'initiative-1',
          projectId: 'project-1',
          tab: 'editor',
          focusEnd: {
            gte: expect.any(Date),
          },
        },
        orderBy: {
          focusEnd: 'desc',
        },
      });
    });

    it('persists resolved projectId for task attention events', async () => {
      const event = createMockAttentionEvent({
        entity: { type: 'task', id: 'task-1' },
      });
      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.task.findFirst.mockResolvedValue({
        projectId: 'project-task-1',
        projectRelations: [],
      });

      await service.recordAttentionEvents(mockAuthenticatedUser, [event]);

      expect(mockTx.attentionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'TASK',
            entityId: 'task-1',
            projectId: 'project-task-1',
          }),
        }),
      );
    });

    it('fails fast when task project ownership is unresolved', async () => {
      const event = createMockAttentionEvent({
        entity: { type: 'task', id: 'task-unknown' },
      });
      mockTx.task.findFirst.mockResolvedValue(null);

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });

    it('fails fast when agent session project ownership is unresolved', async () => {
      const event = createMockAttentionEvent({
        entity: {
          type: AttentionEventEntity.TypeEnum.AgentSession,
          id: 'agent-session-unknown',
        },
      });
      mockTx.agentSession.findFirst.mockResolvedValue(null);

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Validation', () => {
    it('should reject empty events array', async () => {
      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, []),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events array with more than 100 items', async () => {
      const events = Array(101)
        .fill(null)
        .map((_, i) =>
          createMockAttentionEvent({
            entity: { type: 'initiative', id: `initiative-${i}` },
          }),
        );

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, events),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events with invalid eventType', async () => {
      const event = createMockAttentionEvent({
        eventType: 'invalid' as 'attention',
      });

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events with missing entity', async () => {
      const event = createMockAttentionEvent();
      (event as any).entity = null;

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events with missing entity.type', async () => {
      const event = createMockAttentionEvent();
      (event as any).entity.type = null;

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events with invalid timestamp', async () => {
      const event = createMockAttentionEvent({ timestamp: -1 });

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject events with non-string tab', async () => {
      const event = createMockAttentionEvent({
        tab: 123 as any,
      });

      await expect(
        service.recordAttentionEvents(mockAuthenticatedUser, [event]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Response format', () => {
    it('should return eventCount and ISO timestamp', async () => {
      const event = createMockAttentionEvent();
      mockTx.attentionEvent.findFirst.mockResolvedValue(null);
      mockTx.attentionEvent.create.mockResolvedValue({});

      const result = await service.recordAttentionEvents(
        mockAuthenticatedUser,
        [event],
      );

      expect(result).toHaveProperty('eventCount');
      expect(result).toHaveProperty('timestamp');
      expect(result.eventCount).toBe(1);
      expect(typeof result.timestamp).toBe('string');
      // Verify it's a valid ISO string
      expect(new Date(result.timestamp)).not.toEqual(new Date('Invalid'));
    });
  });

  describe('getAttentionEvents', () => {
    it('should retrieve attention events with default 7-day window', async () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const mockEvents: Array<{
        id: string;
        entityId: string;
        entityType: string;
        focusStart: Date;
        focusEnd: Date;
        durationMs: number;
        tab: string | null;
        organizationId: string;
        userId: string;
      }> = [
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          focusStart: now,
          focusEnd: new Date(now.getTime() + 60000),
          durationMs: 60000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(1);

      const entityRegistry: Array<{
        id: string;
        entityId: string;
        entityType: string;
        entityName: string;
        nameSearchText: string | null;
        createdAt: Date;
        deletedAt: Date | null;
      }> = [
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Test Initiative',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ];

      mockTx.entityRegistry.findMany.mockResolvedValue(entityRegistry);

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
      });

      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('pagination');
      expect(result.events.length).toBe(1);
      const [event] = result.events;
      if (!event) {
        throw new Error('Expected recent activity');
      }
      expect(event.entityType).toBe('INITIATIVE');
      expect(event.entityName).toBe('Test Initiative');
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.total).toBe(1);
    });

    it('should handle custom since parameter with ISO string', async () => {
      const sinceDate = new Date('2025-12-01');

      mockTx.attentionEvent.findMany.mockResolvedValue([]);
      mockTx.attentionEvent.count.mockResolvedValue(0);
      mockTx.entityRegistry.findMany.mockResolvedValue([]);

      await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
        since: '2025-12-01',
      });

      expect(mockTx.attentionEvent.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
          focusEnd: { gte: sinceDate },
          AND: [
            { OR: [{ projectId: null }, { projectId: { in: ['project-1'] } }] },
          ],
        },
        orderBy: { focusEnd: 'desc' },
        take: 40,
        skip: 0,
      });
    });

    it('should handle custom since parameter with unix timestamp', async () => {
      const unixMs = 1733193600000; // 2024-12-03
      const expectedDate = new Date(unixMs);

      mockTx.attentionEvent.findMany.mockResolvedValue([]);
      mockTx.attentionEvent.count.mockResolvedValue(0);
      mockTx.entityRegistry.findMany.mockResolvedValue([]);

      await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
        since: unixMs,
      });

      expect(mockTx.attentionEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: mockAuthenticatedUser.currentOrgId,
            userId: mockAuthenticatedUser.userId,
            focusEnd: { gte: expectedDate },
            AND: [
              {
                OR: [{ projectId: null }, { projectId: { in: ['project-1'] } }],
              },
            ],
          },
        }),
      );
    });

    it('should return events sorted by recency by default', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-2',
          entityId: 'entity-2',
          entityType: 'project',
          focusStart: new Date(now.getTime() - 1800000),
          focusEnd: now, // Most recent
          durationMs: 1000000,
          tab: 'editor',
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: new Date(now.getTime() - 3600000),
          focusEnd: new Date(now.getTime() - 600000), // Older
          durationMs: 3000000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(2);
      mockTx.entityRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Initiative A',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
        {
          id: 'reg-2',
          entityId: 'entity-2',
          entityType: 'PROJECT',
          entityName: 'Project B',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
      });

      const [mostRecent, older] = result.events;
      if (!mostRecent || !older) {
        throw new Error('Expected recent activity items');
      }
      expect(mostRecent.id).toBe('event-2'); // Most recent
      expect(older.id).toBe('event-1'); // Older
    });

    it('should sort events by duration when mostActive is selected', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-2',
          entityId: 'entity-2',
          entityType: 'project',
          focusStart: new Date(now.getTime() - 1800000),
          focusEnd: now,
          durationMs: 1000000,
          tab: 'editor',
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: new Date(now.getTime() - 3600000),
          focusEnd: new Date(now.getTime() - 600000),
          durationMs: 3000000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(2);
      mockTx.entityRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Initiative A',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
        {
          id: 'reg-2',
          entityId: 'entity-2',
          entityType: 'PROJECT',
          entityName: 'Project B',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
        sort: 'mostActive',
      });

      const [longestFocus, shorterFocus] = result.events;
      if (!longestFocus || !shorterFocus) {
        throw new Error('Expected recent focus items');
      }
      expect(longestFocus.id).toBe('event-1'); // Longest (3000000ms)
      expect(shorterFocus.id).toBe('event-2'); // Shorter (1000000ms)
    });

    it('should apply limit after mixed sorting and de-duplication', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: new Date(now.getTime() - 5000),
          focusEnd: now,
          durationMs: 5000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
        {
          id: 'event-1-old',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: new Date(now.getTime() - 10000),
          focusEnd: new Date(now.getTime() - 4000),
          durationMs: 1000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
        {
          id: 'event-2',
          entityId: 'entity-2',
          entityType: 'project',
          focusStart: new Date(now.getTime() - 90000),
          focusEnd: new Date(now.getTime() - 60000),
          durationMs: 3000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
        {
          id: 'event-3',
          entityId: 'entity-3',
          entityType: 'task',
          focusStart: new Date(now.getTime() - 150000),
          focusEnd: new Date(now.getTime() - 120000),
          durationMs: 1000,
          tab: null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(4);
      mockTx.entityRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Initiative A',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
        {
          id: 'reg-2',
          entityId: 'entity-2',
          entityType: 'PROJECT',
          entityName: 'Project B',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 2,
        offset: 0,
        sort: 'mixed',
      });

      expect(result.events).toHaveLength(2);
      expect(result.events.map((event) => event.entityId).sort()).toEqual([
        'entity-1',
        'entity-2',
      ]);

      const [entityRegistryCall] = mockTx.entityRegistry.findMany.mock.calls;
      if (!entityRegistryCall) {
        throw new Error('Expected entity registry lookup');
      }
      expect(entityRegistryCall[0].where.OR).toHaveLength(2);
    });

    it('should reject invalid since parameter', async () => {
      await expect(
        service.getAttentionEvents(mockAuthenticatedUser, {
          limit: 20,
          offset: 0,
          since: 'invalid-date',
        }),
      ).rejects.toThrow('Invalid "since" parameter');
    });

    it('should handle pagination with offset', async () => {
      mockTx.attentionEvent.findMany.mockResolvedValue([]);
      mockTx.attentionEvent.count.mockResolvedValue(100);
      mockTx.entityRegistry.findMany.mockResolvedValue([]);

      await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 40,
      });

      expect(mockTx.attentionEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 40,
          skip: 40,
        }),
      );

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 40,
      });

      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.offset).toBe(40);
      expect(result.pagination.total).toBe(100);
    });

    it('should use Unknown as entity name if not found in registry', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-1',
          entityId: 'missing-entity',
          entityType: 'initiative',
          focusStart: now,
          focusEnd: now,
          durationMs: 0,
          tab: null as string | null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(1);
      mockTx.entityRegistry.findMany.mockResolvedValue([]); // No matching registry entry

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
      });

      const [event] = result.events;
      if (!event) {
        throw new Error('Expected recent activity');
      }
      expect(event.entityName).toBe('Unknown');
    });

    it('should convert ISO timestamps to string format in response', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: now,
          focusEnd: new Date(now.getTime() + 60000),
          durationMs: 60000,
          tab: null as string | null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(1);
      mockTx.entityRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Test',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ]);

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
      });

      const [event] = result.events;
      if (!event) {
        throw new Error('Expected recent activity');
      }
      expect(typeof event.focusStart).toBe('string');
      expect(typeof event.focusEnd).toBe('string');
      expect(() => new Date(event.focusStart)).not.toThrow();
    });

    it('should include entity payloads when includeEntity is true', async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: 'event-1',
          entityId: 'entity-1',
          entityType: 'initiative',
          focusStart: now,
          focusEnd: now,
          durationMs: 0,
          tab: null as string | null,
          organizationId: mockAuthenticatedUser.currentOrgId,
          userId: mockAuthenticatedUser.userId,
        },
      ];

      mockTx.attentionEvent.findMany.mockResolvedValue(mockEvents);
      mockTx.attentionEvent.count.mockResolvedValue(1);
      mockTx.entityRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Test Initiative',
          nameSearchText: null,
          createdAt: now,
          deletedAt: null,
        },
      ]);

      initiativeService.findOneForAdapter.mockResolvedValue({
        id: 'entity-1',
        name: 'Test Initiative',
      });

      const result = await service.getAttentionEvents(mockAuthenticatedUser, {
        limit: 20,
        offset: 0,
        includeEntity: true,
      });

      const [event] = result.events;
      if (!event) {
        throw new Error('Expected attention event');
      }

      expect(initiativeService.findOneForAdapter).toHaveBeenCalledWith(
        'entity-1',
        mockAuthenticatedUser.currentOrgId,
      );
      expect(event.entity).toEqual({
        id: 'entity-1',
        name: 'Test Initiative',
      });
    });
  });
});
