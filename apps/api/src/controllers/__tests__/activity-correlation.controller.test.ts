import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ActivitySleepDuration,
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  CreateActivitySleepDto,
  EntityType,
  ProjectMetricIdentity,
  QueryActivity200Response,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from 'src/generated';
import { ActivityCorrelationController } from '../activity-correlation.controller';
import { ActivitySleepService } from 'src/services/activity-correlation/activity-sleep.service';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { ActivityQueryService } from 'src/services/activity-correlation/activity-query.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { Response } from 'express';

describe('ActivityCorrelationController', () => {
  let controller: ActivityCorrelationController;

  const mockService = {
    listCorrelatedActivity: jest.fn(),
    getCorrelatedActivity: jest.fn(),
  };
  const mockSleepService = {
    sleepActivity: jest.fn(),
  };
  const mockQueryService = {
    queryActivity: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityCorrelationController],
      providers: [
        { provide: ProjectAccessService, useValue: { assertOrganization: jest.fn(), assertProject: jest.fn() } },
        { provide: ProjectResourceAccessService, useValue: { assertResource: jest.fn() } },
        {
          provide: ActivityCorrelationService,
          useValue: mockService,
        },
        {
          provide: ActivitySleepService,
          useValue: mockSleepService,
        },
        {
          provide: ActivityQueryService,
          useValue: mockQueryService,
        },
      ],
    }).compile();

    controller = module.get<ActivityCorrelationController>(
      ActivityCorrelationController,
    );
    jest.clearAllMocks();
  });

  it('parses recent feed query parameters and forwards them to the service', async () => {
    mockService.listCorrelatedActivity.mockResolvedValue({
      records: [
        {
          entityId: '11111111-1111-4111-8111-111111111111',
          entityType: EntityType.Task,
          projectId: 'project-1' as ProjectId,
          title: 'Task 1111',
          timestamp: '2026-03-01T10:00:00.000Z',
          linkedEntities: [
            {
              entityId: '11111111-1111-4111-8111-111111111111',
              entityType: EntityType.Task,
              linkType: 'SELF',
              title: 'Task 1111',
            },
          ],
          reports: [],
        },
      ],
      total: 8,
      nextOffset: 35,
    });

    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
    } as any;

    const result = await controller.listCorrelatedActivity(
      'org-1' as any,
      'user-1' as any,
      'project-1',
      '25',
      '10',
      RecentActivityCorrelationMode.Task,
      RecentActivityCorrelationSort.LastMessage,
      'token-1',
      response,
    );

    expect(mockService.listCorrelatedActivity).toHaveBeenCalledWith(
      'org-1',
      {
        userId: 'user-1',
        projectId: 'project-1',
        mode: RecentActivityCorrelationMode.Task,
        sort: RecentActivityCorrelationSort.LastMessage,
        limit: 25,
        offset: 10,
      },
      'token-1',
    );
    expect(headers.get('X-Total-Count')).toBe('8');
    expect(headers.get('X-Next-Offset')).toBe('35');
    expect(result).toHaveLength(1);
  });

  it('parses activity sleep payloads and forwards them to the sleep service', async () => {
    const payload = {
      entityId: '11111111-1111-4111-8111-111111111111',
      entityType: EntityType.Task,
      duration: ActivitySleepDuration.OneHour,
    } satisfies CreateActivitySleepDto;

    mockSleepService.sleepActivity.mockResolvedValue({
      ...payload,
      expiresAt: '2026-03-01T11:00:00.000Z',
    });

    const result = await controller.sleepActivity(
      'org-1' as any,
      'user-1' as any,
      payload,
    );

    expect(mockSleepService.sleepActivity).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      payload,
    );
    expect(result).toEqual({
      ...payload,
      expiresAt: '2026-03-01T11:00:00.000Z',
    });
  });

  it('rejects unsupported activity sleep durations', async () => {
    await expect(
      controller.sleepActivity('org-1' as any, 'user-1' as any, {
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
        duration: 'FOREVER' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires projectId for the recent feed', async () => {
    await expect(
      controller.listCorrelatedActivity(
        'org-1' as any,
        'user-1' as any,
        undefined,
        '25',
        '0',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported recent mode values', async () => {
    await expect(
      controller.listCorrelatedActivity(
        'org-1' as any,
        'user-1' as any,
        'project-1',
        '25',
        '0',
        'INVALID_MODE',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported recent sort values', async () => {
    await expect(
      controller.listCorrelatedActivity(
        'org-1' as any,
        'user-1' as any,
        'project-1',
        '25',
        '0',
        undefined,
        'INVALID_SORT',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parses generated-client query serialization and keeps the selected user distinct from the actor', async () => {
    mockQueryService.queryActivity.mockResolvedValue({
      records: [],
      total: 3,
      nextOffset: 13,
    });
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    } as unknown as Response;

    const serializedQuery = new URLSearchParams(
      'projectId=project-1&userId=person-1&entityType=TASK%2CDESIGN_DOC&activityMode=WITHOUT_ATTENTION&activityType=NOTIFICATION%2CVIEWED&source=SYSTEM%2CREPORT&serviceId=service-1&since=2026-09-03T12%3A00%3A00.000Z&until=2026-09-04T12%3A00%3A00.000Z&affectsMe=true&sinceLastVisit=false&metric=TASK_CREATED&projectIds=project-1&windowStart=2026-09-03T12%3A00%3A00.000Z&windowEnd=2026-09-04T12%3A00%3A00.000Z&actorScope=ORGANIZATION&limit=10&offset=3',
    );
    const rawQuery = [...serializedQuery.entries()].reduce<
      Record<string, string | string[]>
    >((query, [key, value]) => {
      const existing = query[key];
      query[key] =
        existing === undefined
          ? value
          : Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
      return query;
    }, {});

    const result = await controller.queryActivity(
      'org-1' as OrganizationId,
      'actor-1' as UserId,
      rawQuery,
      response,
    );

    expect(mockQueryService.queryActivity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actorUserId: 'actor-1',
      projectId: 'project-1',
      selectedUserId: 'person-1',
      entityTypes: [EntityType.Task, EntityType.DesignDoc],
      activityMode: ActivityCorrelationMode.WithoutAttention,
      activityTypes: [
        ActivityCorrelationActivityType.Notification,
        ActivityCorrelationActivityType.Viewed,
      ],
      sources: [
        ActivityCorrelationSource.System,
        ActivityCorrelationSource.Report,
      ],
      serviceId: 'service-1',
      since: new Date('2026-09-03T12:00:00.000Z'),
      until: new Date('2026-09-04T12:00:00.000Z'),
      affectsMe: true,
      sinceLastVisit: false,
      metricContinuation: {
        metric: 'TASK_CREATED',
        projectIds: ['project-1'],
        windowStart: '2026-09-03T12:00:00.000Z',
        windowEnd: '2026-09-04T12:00:00.000Z',
        actorScope: { mode: 'ORGANIZATION' },
      },
      limit: 10,
      offset: 3,
    });
    expect(headers.get('X-Total-Count')).toBe('3');
    expect(headers.get('X-Next-Offset')).toBe('13');
    expect(result).toEqual([]);
  });

  it.each([
    { serializedProjectIds: [''], expectedProjectIds: [] },
    {
      serializedProjectIds: ['project-1'],
      expectedProjectIds: ['project-1'],
    },
    {
      serializedProjectIds: ['project-1', 'project-2'],
      expectedProjectIds: ['project-1', 'project-2'],
    },
  ])(
    'parses generated-client project scope values without broadening: $serializedProjectIds',
    async ({ serializedProjectIds, expectedProjectIds }) => {
      mockQueryService.queryActivity.mockResolvedValue({
        records: [],
        total: 0,
      });

      await controller.queryActivity(
        'org-1' as OrganizationId,
        'actor-1' as UserId,
        {
          metric: ProjectMetricIdentity.TaskCreated,
          projectIds: serializedProjectIds,
          windowStart: '2026-09-03T12:00:00.000Z',
          windowEnd: '2026-09-04T12:00:00.000Z',
          actorScope: 'ORGANIZATION',
        },
      );

      expect(mockQueryService.queryActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          metricContinuation: {
            metric: ProjectMetricIdentity.TaskCreated,
            projectIds: expectedProjectIds,
            windowStart: '2026-09-03T12:00:00.000Z',
            windowEnd: '2026-09-04T12:00:00.000Z',
            actorScope: { mode: 'ORGANIZATION' },
          },
        }),
      );
    },
  );

  it('rejects a partial metric continuation', async () => {
    await expect(
      controller.queryActivity('org-1' as OrganizationId, 'user-1' as UserId, {
        metric: 'TASK_CREATED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unpublished aliases and invalid list values', async () => {
    await expect(
      controller.queryActivity('org-1' as OrganizationId, 'actor-1' as UserId, {
        personId: 'person-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.queryActivity('org-1' as OrganizationId, 'actor-1' as UserId, {
        entityType: 'TASK,NOT_AN_ENTITY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.queryActivity('org-1' as OrganizationId, 'actor-1' as UserId, {
        limit: '10items',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parses entity lookup parameters and forwards them to the seeded service', async () => {
    mockService.getCorrelatedActivity.mockResolvedValue({
      records: [
        {
          entityId: '11111111-1111-4111-8111-111111111111',
          entityType: EntityType.Task,
          projectId: 'project-1' as ProjectId,
          title: 'Task 1111',
          type: ActivityCorrelationActivityType.Viewed,
          source: ActivityCorrelationSource.AttentionEvent,
          timestamp: '2026-03-01T10:00:00.000Z',
          linkedEntities: [
            {
              entityId: '11111111-1111-4111-8111-111111111111',
              entityType: EntityType.Task,
              linkType: 'SELF',
              title: 'Task 1111',
            },
          ],
          reports: [],
        },
      ] satisfies NonNullable<QueryActivity200Response['data']>,
      total: 1,
      nextOffset: undefined,
    });

    const result = await controller.getCorrelatedActivityByEntity(
      'org-1' as any,
      'user-1' as any,
      EntityType.Task,
      '11111111-1111-4111-8111-111111111111',
      '25',
      '10',
      `${ActivityCorrelationActivityType.Viewed},${ActivityCorrelationActivityType.Notification}`,
      ActivityCorrelationSource.AttentionEvent,
      ActivityCorrelationMode.WithoutAttention,
      'token-1',
    );

    expect(mockService.getCorrelatedActivity).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        entityId: '11111111-1111-4111-8111-111111111111',
        entityType: EntityType.Task,
        userId: 'user-1',
        activityTypes: [
          ActivityCorrelationActivityType.Viewed,
          ActivityCorrelationActivityType.Notification,
        ],
        activityMode: ActivityCorrelationMode.WithoutAttention,
        sources: [ActivityCorrelationSource.AttentionEvent],
        limit: 25,
        offset: 10,
      }),
      { userToken: 'token-1' },
    );
    expect(result).toHaveLength(1);
  });
});
