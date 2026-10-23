import { BadRequestException } from '@nestjs/common';
import {
  EntityType,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from 'src/generated';
import { createMockPrismaService } from 'src/utils/testUtils';
import { ActivitySleepService } from '../activity-correlation/activity-sleep.service';
import { ActivityCorrelationSeedSelectorService } from '../activity-correlation/activity-correlation-seed-selector.service';

describe('ActivityCorrelationSeedSelectorService', () => {
  const organizationId = 'org-1' as any;
  const projectId = 'project-1' as any;
  const userId = 'user-1' as any;

  let prisma: ReturnType<typeof createMockPrismaService>;
  let activitySleepService: Pick<ActivitySleepService, 'filterAwakeEntities'>;
  let service: ActivityCorrelationSeedSelectorService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    activitySleepService = {
      filterAwakeEntities: jest
        .fn()
        .mockImplementation(
          async (_organizationId, _userId, entities) => entities,
        ),
    };
    service = new ActivityCorrelationSeedSelectorService(
      prisma as any,
      activitySleepService as any,
    );
  });

  it('keeps mixed activity ranking semantics for recent activity seeds', async () => {
    (prisma.db as any).attentionEvent = {
      findMany: jest.fn().mockResolvedValue([
        {
          entityId: 'task-long',
          entityType: EntityType.Task,
          focusStart: new Date('2026-03-01T08:00:00.000Z'),
          focusEnd: new Date('2026-03-01T08:10:00.000Z'),
          durationMs: 600000,
        },
        {
          entityId: 'task-short',
          entityType: EntityType.Task,
          focusStart: new Date('2026-03-01T10:00:00.000Z'),
          focusEnd: new Date('2026-03-01T10:01:00.000Z'),
          durationMs: 60000,
        },
      ]),
    };

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.Activity,
      sort: RecentActivityCorrelationSort.Mixed,
      limit: 5,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.seeds.map((seed) => seed.entityId)).toEqual([
      'task-long',
      'task-short',
    ]);
  });

  it('pages task seeds by updatedAt when task mode uses LAST_UPDATED', async () => {
    (prisma.db as any).attentionEvent = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ entityId: 'task-1' }, { entityId: 'task-2' }]),
    };
    (prisma.db.agentSession.findMany as jest.Mock)
      .mockResolvedValueOnce([{ taskId: 'task-2' }])
      .mockResolvedValueOnce([]);
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      { id: 'task-2', updatedAt: new Date('2026-03-02T10:00:00.000Z') },
      { id: 'task-1', updatedAt: new Date('2026-03-01T10:00:00.000Z') },
    ]);

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 1,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.nextOffset).toBe(1);
    expect(result.seeds).toEqual([
      { entityId: 'task-2', entityType: EntityType.Task },
    ]);
  });

  it('filters slept task seeds before pagination', async () => {
    (prisma.db as any).attentionEvent = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma.db.agentSession.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      { id: 'task-slept', updatedAt: new Date('2026-03-03T10:00:00.000Z') },
      { id: 'task-awake', updatedAt: new Date('2026-03-02T10:00:00.000Z') },
    ]);
    (activitySleepService.filterAwakeEntities as jest.Mock).mockImplementation(
      async (_organizationId, _userId, entities) =>
        entities.filter(
          (entity: { entityId: string }) => entity.entityId !== 'task-slept',
        ),
    );

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 1,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.nextOffset).toBeUndefined();
    expect(result.seeds).toEqual([
      { entityId: 'task-awake', entityType: EntityType.Task },
    ]);
  });

  it('includes assigned tasks the user has not touched in TASK/LAST_UPDATED', async () => {
    (prisma.db as any).attentionEvent = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma.db.agentSession.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      { id: 'task-assigned', updatedAt: new Date('2026-03-03T10:00:00.000Z') },
      { id: 'task-created', updatedAt: new Date('2026-03-02T10:00:00.000Z') },
    ]);

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 5,
      offset: 0,
    });

    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { assigneeId: userId },
            { creatorId: userId },
          ]),
        }),
      }),
    );
    expect(result.seeds.map((seed) => seed.entityId)).toEqual([
      'task-assigned',
      'task-created',
    ]);
  });

  it('does not drop non-task activity seeds from activity mode', async () => {
    (prisma.db as any).attentionEvent = {
      findMany: jest.fn().mockResolvedValue([
        {
          entityId: 'initiative-1',
          entityType: EntityType.Initiative,
          focusStart: new Date('2026-03-01T08:00:00.000Z'),
          focusEnd: new Date('2026-03-01T08:10:00.000Z'),
          durationMs: 600000,
        },
      ]),
    };

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.Activity,
      sort: RecentActivityCorrelationSort.MostRecent,
      limit: 5,
      offset: 0,
    });

    expect(result.seeds).toEqual([
      { entityId: 'initiative-1', entityType: EntityType.Initiative },
    ]);
  });

  it('sorts agent session seeds by latest message when requested', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'session-1',
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        conversationId: 'conversation-1',
        taskId: 'task-1',
      },
      {
        id: 'session-2',
        updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        conversationId: 'conversation-2',
        taskId: 'task-2',
      },
    ]);
    (prisma.db.message.findMany as jest.Mock).mockResolvedValue([
      {
        conversationId: 'conversation-1',
        createdAt: new Date('2026-03-01T10:10:00.000Z'),
      },
      {
        conversationId: 'conversation-2',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
      },
    ]);

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.AgentSession,
      sort: RecentActivityCorrelationSort.LastMessage,
      limit: 5,
      offset: 0,
    });

    expect(result.seeds.map((seed) => seed.entityId)).toEqual([
      'session-2',
      'session-1',
    ]);
  });

  it('rejects unsupported sort combinations', async () => {
    await expect(
      service.selectSeeds(organizationId, {
        userId,
        projectId,
        mode: RecentActivityCorrelationMode.Task,
        sort: RecentActivityCorrelationSort.Mixed,
        limit: 5,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters AGENT_SESSION seeds to non-coding sessions', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'session-non-coding',
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        conversationId: 'conv-1',
        taskId: null,
      },
    ]);

    await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.AgentSession,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 5,
      offset: 0,
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: { not: 'CODING' },
        }),
      }),
    );
  });

  it('filters CODING_SESSION seeds to coding sessions only', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'session-coding',
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        conversationId: 'conv-1',
        taskId: 'task-1',
      },
    ]);

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.CodingSession,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 5,
      offset: 0,
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'CODING',
        }),
      }),
    );
    expect(result.seeds).toEqual([
      { entityId: 'session-coding', entityType: EntityType.AgentSession },
    ]);
  });

  it('supports LAST_MESSAGE sort for CODING_SESSION mode', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'session-a',
        updatedAt: new Date('2026-03-01T08:00:00.000Z'),
        conversationId: 'conv-a',
        taskId: null,
      },
      {
        id: 'session-b',
        updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        conversationId: 'conv-b',
        taskId: null,
      },
    ]);
    (prisma.db.message.findMany as jest.Mock).mockResolvedValue([
      {
        conversationId: 'conv-a',
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
      },
      {
        conversationId: 'conv-b',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
      },
    ]);

    const result = await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.CodingSession,
      sort: RecentActivityCorrelationSort.LastMessage,
      limit: 5,
      offset: 0,
    });

    expect(result.seeds.map((seed) => seed.entityId)).toEqual([
      'session-a',
      'session-b',
    ]);
  });

  it('rejects MIXED sort for CODING_SESSION mode', async () => {
    await expect(
      service.selectSeeds(organizationId, {
        userId,
        projectId,
        mode: RecentActivityCorrelationMode.CodingSession,
        sort: RecentActivityCorrelationSort.Mixed,
        limit: 5,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters agent session seeds to sessions with user messages', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'session-with-user-msg',
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        conversationId: 'conv-1',
        taskId: 'task-1',
      },
    ]);

    await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.AgentSession,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 5,
      offset: 0,
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversation: {
            messages: {
              some: {
                type: 'USER',
              },
            },
          },
        }),
      }),
    );
  });

  it('does not filter coding session seeds by user messages', async () => {
    (prisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'coding-session-no-user-msg',
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        conversationId: 'conv-2',
        taskId: 'task-2',
      },
    ]);

    await service.selectSeeds(organizationId, {
      userId,
      projectId,
      mode: RecentActivityCorrelationMode.CodingSession,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 5,
      offset: 0,
    });

    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          conversation: expect.anything(),
        }),
      }),
    );
  });
});
