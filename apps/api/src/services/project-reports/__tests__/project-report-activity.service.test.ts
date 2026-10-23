import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  EntityType,
  type ActivityCorrelationRecordDto,
  type ProjectReportScope,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ActivityQueryService } from 'src/services/activity-correlation/activity-query.service';
import type { ActivityCorrelationRecordDraft } from 'src/services/activity-correlation/activity-correlation.types';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { AcceptedEvidenceSelectorService } from 'src/services/project-metrics/accepted-evidence-selector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectReportActivityService } from '../project-report-activity.service';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const entityId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const scope = {
  projectId,
  windowStart: '2026-09-20T00:00:00Z',
  windowEnd: '2026-09-29T00:00:00Z',
  timeZone: 'UTC',
} satisfies ProjectReportScope;

function record(
  index: number,
  timestamp = '2026-09-25T00:00:00Z',
): ActivityCorrelationRecordDto {
  return {
    entityId: entityId(index),
    entityType: EntityType.Task,
    projectId,
    title: `Subject ${index}`,
    type: ActivityCorrelationActivityType.Notification,
    timestamp,
    source: ActivityCorrelationSource.System,
    linkedEntities: [],
    reports: [],
  };
}

describe('ProjectReportActivityService', () => {
  const query = { selectActivity: jest.fn() };
  const service = new ProjectReportActivityService(
    query as unknown as ActivityQueryService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('counts distinct subjects before preview search and pagination, retaining exclusions beyond the first page', async () => {
    query.selectActivity.mockResolvedValue([
      record(1),
      record(1),
      record(2),
      record(3),
    ]);
    const exclusions = [{ entityType: EntityType.Task, entityId: entityId(3) }];
    const preview = await service.preview(organizationId, projectId, userId, {
      scope,
      exclusions,
      search: 'Subject 1',
      limit: 1,
      offset: 0,
    });
    expect(preview).toMatchObject({
      matchingSubjectCount: 3,
      includedSubjectCount: 2,
      excludedSubjectCount: 1,
      displayedSubjectCount: 1,
    });
    expect(preview.subjects).toMatchObject([
      { matchingActivityCount: 2, excluded: false },
    ]);
    const page = await service.page(
      organizationId,
      projectId,
      userId,
      'request-id',
      'attempt-id',
      {
        question: 'What changed?',
        scope,
        exclusions,
        launch: {
          machineId: entityId(20),
          provider: 'codex',
          model: 'model',
          effort: 'high',
        },
        idempotencyKey: 'one',
      },
      2,
      2,
    );
    expect(page.total).toBe(3);
    expect(page.records.map(({ entityId }) => entityId)).toEqual([entityId(2)]);
    expect(query.selectActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        since: new Date(scope.windowStart),
        until: new Date(scope.windowEnd),
      }),
    );
  });

  it('rejects invalid bounds and page sizes at the boundary', async () => {
    await expect(
      service.preview(organizationId, projectId, userId, {
        scope: { ...scope, windowEnd: scope.windowStart },
        exclusions: [],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.page(
        organizationId,
        projectId,
        userId,
        'r',
        'a',
        {
          question: 'Question',
          scope,
          exclusions: [],
          launch: {
            machineId: entityId(20),
            provider: 'codex',
            model: 'model',
            effort: 'high',
          },
          idempotencyKey: 'one',
        },
        201,
        0,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechecks canonical project authorization for each evidence read', async () => {
    query.selectActivity.mockRejectedValue(new ForbiddenException('revoked'));
    await expect(
      service.preview(organizationId, projectId, userId, {
        scope,
        exclusions: [],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('previews custom-type work-item lifecycle as distinct subjects without viewing activity', async () => {
    const lifecycle = [1, 1, 2].map((index, position) => ({
      kind: position === 0 ? 'CREATED' : 'UPDATED',
      projectId,
      entityId: entityId(index),
      eventId: `event-${position}`,
      eventType: position === 0 ? 'task.created' : 'task.updated',
      occurredAt: new Date(`2026-09-2${position + 1}T00:00:00Z`),
      userId,
      conversationId: null,
    }));
    const selectWorkItemLifecycle = jest.fn().mockResolvedValue(lifecycle);
    const assembleOrganizationActivityRecords = jest.fn().mockResolvedValue([]);
    const activityQuery = new ActivityQueryService(
      {
        select: jest.fn(),
        selectWorkItemLifecycle,
        resolveAuthorizedProjectIds: jest.fn().mockResolvedValue([projectId]),
      } as unknown as AcceptedEvidenceSelectorService,
      { db: {} } as unknown as PrismaService,
      {
        assembleOrganizationActivityRecords,
        hydrateCanonicalActivityRecords: jest.fn(
          async (_organizationId, drafts: ActivityCorrelationRecordDraft[]) =>
            drafts.map((draft) => ({
              ...draft,
              title: `Subject ${draft.entityId}`,
            })),
        ),
      } as unknown as ActivityCorrelationService,
    );
    const preview = await new ProjectReportActivityService(
      activityQuery,
    ).preview(organizationId, projectId, userId, { scope, exclusions: [] });

    expect(preview.matchingSubjectCount).toBe(2);
    expect(
      preview.subjects.map(({ subject, matchingActivityCount }) => ({
        ...subject,
        matchingActivityCount,
      })),
    ).toEqual([
      {
        entityType: EntityType.Task,
        entityId: entityId(2),
        matchingActivityCount: 1,
      },
      {
        entityType: EntityType.Task,
        entityId: entityId(1),
        matchingActivityCount: 2,
      },
    ]);
    expect(assembleOrganizationActivityRecords).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ includeAttention: false }),
    );
    expect(selectWorkItemLifecycle).toHaveBeenCalledWith(organizationId, {
      projectIds: [projectId],
      windowStart: new Date(scope.windowStart),
      windowEnd: new Date(scope.windowEnd),
    });
  });

  it.each([
    ['omitted', undefined, ActivityCorrelationMode.WithoutAttention],
    ['false', false, ActivityCorrelationMode.WithoutAttention],
    ['true', true, ActivityCorrelationMode.All],
  ])(
    'selects report evidence with includeAttentionEvents %s',
    async (_label, includeAttentionEvents, activityMode) => {
      query.selectActivity.mockResolvedValue([record(1)]);
      await service.select({
        organizationId,
        projectId,
        userId,
        scope: {
          ...scope,
          ...(includeAttentionEvents === undefined
            ? {}
            : { includeAttentionEvents }),
        },
        exclusions: [],
      });
      expect(query.selectActivity).toHaveBeenCalledWith(
        expect.objectContaining({ activityMode }),
      );
    },
  );
});
