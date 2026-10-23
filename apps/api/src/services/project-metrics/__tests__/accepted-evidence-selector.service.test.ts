import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import {
  AcceptedEvidenceSelectorService,
  PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES,
} from '../accepted-evidence-selector.service';

const organizationId = 'organization-1' as OrganizationId;
const projectId = 'project-a' as ProjectId;
const otherProjectId = 'project-b' as ProjectId;
const actor = 'user-1' as UserId;
const otherActor = 'user-2' as UserId;
const windowStart = new Date('2026-09-01T00:00:00.000Z');
const windowEnd = new Date('2026-09-02T00:00:00.000Z');

type EventOverrides = {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  userId?: UserId;
  projectId?: ProjectId;
  causationId?: string | null;
  headers?: Record<string, unknown>;
};

function event(overrides: EventOverrides) {
  return {
    aggregateType: 'task',
    createdAt: new Date(overrides.createdAt ?? '2026-09-01T10:00:00.000Z'),
    headers: overrides.headers ?? {},
    correlationId: `correlation-${overrides.id}`,
    causationId: overrides.causationId ?? null,
    projectId: overrides.projectId ?? projectId,
    userId: overrides.userId ?? actor,
    conversationId: null,
    id: overrides.id,
    eventType: overrides.eventType,
    aggregateId: overrides.aggregateId,
    payload: overrides.payload,
  };
}

function lifecycleEvents(taskId: string, type: string) {
  return [
    event({
      id: `${taskId}-created`,
      eventType: 'task.created',
      aggregateId: taskId,
      payload: { task: { id: taskId, projectId, type } },
    }),
    event({
      id: `${taskId}-updated`,
      eventType: 'task.updated',
      aggregateId: taskId,
      causationId: `${taskId}-edit`,
      payload: { update: { name: 'Renamed' } },
    }),
    event({
      id: `${taskId}-content`,
      eventType: 'task.content_changed',
      aggregateId: taskId,
      causationId: `${taskId}-edit`,
      payload: { content: { sections: [] } },
    }),
    event({
      id: `${taskId}-status`,
      eventType: 'task.status_changed',
      aggregateId: taskId,
      payload: { previousStatus: 'BACKLOG', newStatus: 'ACTIVE' },
    }),
  ];
}

function harness(
  sourceEvents: ReturnType<typeof event>[],
  taskRows: Array<{ id: string; type: string; projectId: ProjectId }>,
) {
  const outboxFindMany = jest.fn().mockResolvedValue(sourceEvents);
  const taskFindMany = jest.fn().mockResolvedValue(taskRows);
  const prisma = {
    db: {
      organizationMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'membership' }),
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: projectId }]) },
      outboxEvent: { findMany: outboxFindMany },
      task: { findMany: taskFindMany },
    },
  } as unknown as PrismaService;
  const registry = {
    getDefinitions: () => [
      { definition: { key: 'STANDARD', role: 'work-item' } },
      { definition: { key: 'BUG', role: 'work-item' } },
      { definition: { key: 'INCIDENT', role: 'work-item' } },
      { definition: { key: 'FEATURE', role: 'project-info' } },
    ],
  } as unknown as WorkItemTypeRegistryService;
  const selector = new AcceptedEvidenceSelectorService(
    prisma,
    new ProjectAccessService(prisma),
    registry,
    () => windowEnd,
  );
  return { selector, outboxFindMany, taskFindMany };
}

describe('AcceptedEvidenceSelectorService.selectWorkItemLifecycle', () => {
  it.each([
    ['custom work-item role', 'INCIDENT'],
    ['project-info role', 'FEATURE'],
    ['STANDARD', 'STANDARD'],
  ])(
    'records creation, one logical update and status entry for %s types',
    async (_label, type) => {
      const { selector } = harness(lifecycleEvents('task-1', type), [
        { id: 'task-1', type, projectId },
      ]);
      const records = await selector.selectWorkItemLifecycle(organizationId, {
        projectIds: [projectId],
        windowStart,
        windowEnd,
      });
      expect(records.map(({ kind, eventId }) => ({ kind, eventId }))).toEqual([
        { kind: 'CREATED', eventId: 'task-1-created' },
        { kind: 'UPDATED', eventId: 'task-1-updated' },
        { kind: 'STATUS_ENTERED', eventId: 'task-1-status' },
      ]);
      expect(records[0]).toMatchObject({
        projectId,
        entityId: 'task-1',
        userId: actor,
        occurredAt: new Date('2026-09-01T10:00:00.000Z'),
      });
    },
  );

  it('skips same-status transitions, replays, deleted tasks and project mismatches', async () => {
    const { selector } = harness(
      [
        event({
          id: 'same-status',
          eventType: 'task.status_changed',
          aggregateId: 'task-1',
          payload: { previousStatus: 'ACTIVE', newStatus: 'ACTIVE' },
        }),
        event({
          id: 'replayed',
          eventType: 'task.status_changed',
          aggregateId: 'task-1',
          headers: { replayed: true },
          payload: { previousStatus: 'BACKLOG', newStatus: 'ACTIVE' },
        }),
        event({
          id: 'deleted',
          eventType: 'task.updated',
          aggregateId: 'deleted-task',
          payload: { update: { name: 'Gone' } },
        }),
        event({
          id: 'moved',
          eventType: 'task.updated',
          aggregateId: 'moved-task',
          payload: { update: { name: 'Moved' } },
        }),
        event({
          id: 'other-project',
          eventType: 'task.updated',
          aggregateId: 'task-1',
          projectId: otherProjectId,
          payload: { update: { name: 'Elsewhere' } },
        }),
      ],
      [
        { id: 'task-1', type: 'INCIDENT', projectId },
        { id: 'moved-task', type: 'INCIDENT', projectId: otherProjectId },
      ],
    );
    await expect(
      selector.selectWorkItemLifecycle(organizationId, {
        projectIds: [projectId],
        windowStart,
        windowEnd,
      }),
    ).resolves.toEqual([]);
  });

  it('pushes the actor restriction and window into the source query', async () => {
    const { selector, outboxFindMany } = harness([], []);
    await selector.selectWorkItemLifecycle(organizationId, {
      projectIds: [projectId],
      windowStart,
      windowEnd,
      eventActorUserId: otherActor,
    });
    expect(outboxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: { in: [projectId] },
          userId: otherActor,
          createdAt: { gte: windowStart, lt: windowEnd },
          eventType: {
            in: [
              'task.created',
              'task.updated',
              'task.content_changed',
              'task.status_changed',
            ],
          },
        }),
      }),
    );
  });

  it('does not query when no projects are in scope', async () => {
    const { selector, outboxFindMany } = harness([], []);
    await expect(
      selector.selectWorkItemLifecycle(organizationId, {
        projectIds: [],
        windowStart,
        windowEnd,
      }),
    ).resolves.toEqual([]);
    expect(outboxFindMany).not.toHaveBeenCalled();
  });

  it('leaves metric select() query and records unchanged for the same evidence', async () => {
    const events = [
      ...lifecycleEvents('custom', 'INCIDENT'),
      ...lifecycleEvents('standard', 'STANDARD'),
    ];
    const { selector, outboxFindMany } = harness(events, [
      { id: 'custom', type: 'INCIDENT', projectId },
      { id: 'standard', type: 'STANDARD', projectId },
    ]);
    const selection = await selector.select({
      organizationId,
      userId: actor,
      actorScope: { mode: 'ORGANIZATION' },
    });
    const [query] = outboxFindMany.mock.calls[0];
    expect(query.where).toEqual({
      organizationId,
      projectId: { in: [projectId] },
      eventType: { in: [...PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES] },
      status: 'PUBLISHED',
      createdAt: {
        gte: new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000),
        lt: windowEnd,
      },
    });
    expect(
      selection.records.map(({ metric, entityId }) => ({ metric, entityId })),
    ).toEqual([{ metric: 'TASK_CREATED', entityId: 'standard' }]);
  });
});
