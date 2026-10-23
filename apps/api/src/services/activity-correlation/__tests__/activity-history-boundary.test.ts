import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { join } from 'path';
import { resolveSiblingRepository, resolveWorktreeContext } from 'src/utils/worktree-context';
import { ActivityCorrelationController } from 'src/controllers/activity-correlation.controller';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { ActivitySleepService } from '../activity-sleep.service';
import { ActivityQueryService } from '../activity-query.service';
import { AcceptedEvidenceSelectorService } from '../../project-metrics/accepted-evidence-selector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ActivityHistoryFilterDto, ProjectMetricIdentity } from 'src/generated';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { ActivityCorrelationRecordDraft } from '../activity-correlation.types';

// Resolve the matching worktree's built client; a fixed ../ui-common source import
// points outside the corresponding checkout in a linked-worktree session.
const { ActivityCorrelationApiAxiosParamCreator } = require(join(
  resolveSiblingRepository(resolveWorktreeContext(), 'ui-common'),
  'dist/api.cjs',
));

const organizationId = '550e8400-e29b-41d4-a716-446655440000' as OrganizationId;
const projectId = '550e8400-e29b-41d4-a716-446655440001' as ProjectId;
const actor = '550e8400-e29b-41d4-a716-446655440002' as UserId;
const selectedUser = '550e8400-e29b-41d4-a716-446655440003' as UserId;
const start = '2026-09-01T00:00:00.000Z';
const end = '2026-09-02T00:00:00.000Z';

function source(
  id: string,
  entityId: string,
  userId: UserId,
  createdAt = start,
  headers = {},
) {
  return {
    id,
    eventType: 'task.created',
    aggregateType: 'task',
    aggregateId: entityId,
    projectId,
    userId,
    createdAt: new Date(createdAt),
    headers,
    correlationId: id,
    causationId: null,
    conversationId: null,
    payload: {
      task: {
        id: entityId,
        projectId,
        type: 'STANDARD',
        name: 'Delivered work',
        createdAt,
        updatedAt: createdAt,
      },
    },
  };
}

function harness() {
  const outboxEvents = jest
    .fn()
    .mockResolvedValue([
      source('other-first', 'same-task', actor),
      source('selected-second', 'same-task', selectedUser),
      source('selected-repeat', 'same-task', selectedUser),
      source(
        'next-task',
        'next-task',
        selectedUser,
        '2026-09-01T12:00:00.000Z',
      ),
      source('outside', 'outside', selectedUser, end),
      source('replayed', 'replayed', selectedUser, start, { replayed: true }),
    ]);
  const prisma = {
    db: {
      organizationMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'membership' }),
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: projectId }]) },
      outboxEvent: { findMany: outboxEvents },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as PrismaService;
  const registry = {
    getDefinitions: () => [
      { definition: { key: 'STANDARD', role: 'work-item' }, status: 'ACTIVE' },
    ],
  } as unknown as WorkItemTypeRegistryService;
  const selector = new AcceptedEvidenceSelectorService(
    prisma,
    new ProjectAccessService(prisma),
    registry,
    () => new Date(end),
  );
  const hydrate = jest.fn(
    async (
      _organizationId: OrganizationId,
      drafts: ActivityCorrelationRecordDraft[],
    ) => drafts.map((draft) => ({ ...draft, title: 'Delivered work' })),
  );
  const activity = {
    hydrateCanonicalActivityRecords: hydrate,
  } as unknown as ActivityCorrelationService;
  const query = new ActivityQueryService(selector, prisma, activity);
  return {
    controller: new ActivityCorrelationController(
      activity,
      {} as ActivitySleepService,
      query,
    ),
    outboxEvents,
    prisma,
  };
}

function serialized(filter: ActivityHistoryFilterDto, offset = 0) {
  return {
    historyFilter: JSON.stringify(filter),
    limit: '1',
    offset: String(offset),
  };
}

describe('activity history query boundary', () => {
  const filter: ActivityHistoryFilterDto = {
    metric: ProjectMetricIdentity.TaskCreated,
    projectIds: [projectId],
    windowStart: start,
    windowEnd: end,
    userId: selectedUser,
  };
  it('selects event actors before deduplication and pagination, with exact occurrence bounds', async () => {
    const { controller, outboxEvents, prisma } = harness();
    const result = await controller.queryActivity(
      organizationId,
      actor,
      serialized(filter, 1),
    );
    const first = await controller.queryActivity(
      organizationId,
      actor,
      serialized(filter),
    );
    const empty = await controller.queryActivity(
      organizationId,
      actor,
      serialized(filter, 2),
    );
    expect(first?.[0]?.entityId).toBe('next-task');
    expect(empty).toEqual([]);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.entityId).toBe('same-task');
    expect(outboxEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date(start), lt: new Date(end) },
        }),
      }),
    );
    expect(prisma.db.task.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ assigneeId: true }),
      }),
    );
  });
  it('preserves empty scopes and rejects inaccessible projects and mixed query modes', async () => {
    const { controller, outboxEvents } = harness();
    expect(
      await controller.queryActivity(
        organizationId,
        actor,
        serialized({ ...filter, projectIds: [] }),
      ),
    ).toEqual([]);
    expect(outboxEvents).not.toHaveBeenCalled();
    await expect(
      controller.queryActivity(
        organizationId,
        actor,
        serialized({
          ...filter,
          projectIds: ['550e8400-e29b-41d4-a716-446655440099'],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      controller.queryActivity(organizationId, actor, {
        ...serialized(filter),
        userId: selectedUser,
      }),
    ).rejects.toThrow('cannot be combined');
  });
});
