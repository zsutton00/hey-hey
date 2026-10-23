import {
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationLinkType,
  ActivityCorrelationSource,
  EntityType,
  ProjectMetricIdentity,
} from 'src/generated';
import { ReportService } from 'src/services/reports/report.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { ActivityCorrelationService } from '../../activity-correlation.service';
import { AcceptedEvidenceSelectorService } from '../../project-metrics/accepted-evidence-selector.service';
import { AcceptedEvidenceSelection } from '../../project-metrics/project-metrics.types';
import { ActivityCorrelationRecordDraft } from '../activity-correlation.types';
import { ActivityQueryService } from '../activity-query.service';

const ORGANIZATION_ID = 'organization-1' as unknown as OrganizationId;
const USER_ID = 'user-1' as unknown as UserId;
const PROJECT_A = 'project-a' as unknown as ProjectId;
const PROJECT_B = 'project-b' as unknown as ProjectId;
const WINDOW_START = new Date('2026-09-03T12:00:00.000Z');
const WINDOW_END = new Date('2026-09-04T12:00:00.000Z');

function acceptedRecord(
  overrides: Partial<AcceptedEvidenceSelection['records'][number]> = {},
) {
  return {
    metric: ProjectMetricIdentity.TaskCompleted,
    projectId: PROJECT_A,
    entityId: 'task-1',
    eventId: 'event-1',
    eventType: 'task.status_changed',
    aggregateType: 'task',
    occurredAt: new Date('2026-09-04T10:00:00.000Z'),
    correlationId: 'correlation-1',
    causationId: 'causation-1',
    payload: { previousStatus: 'ACTIVE', newStatus: 'COMPLETED' },
    ...overrides,
  };
}

function selection(
  records: AcceptedEvidenceSelection['records'],
): AcceptedEvidenceSelection {
  return {
    effectiveProjectIds: [PROJECT_A, PROJECT_B],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    records,
    diagnostics: {
      sourceEventCount: records.length,
      acceptedRecordCount: records.length,
      malformedEventCount: 0,
      irrelevantEventCount: 0,
      deduplicatedRecordCount: 0,
    },
  };
}

function selector(
  select: jest.Mock,
  effectiveProjectIds: readonly ProjectId[] = [PROJECT_A, PROJECT_B],
  selectWorkItemLifecycle: jest.Mock = jest.fn().mockResolvedValue([]),
): AcceptedEvidenceSelectorService {
  return {
    select,
    selectWorkItemLifecycle,
    resolveAuthorizedProjectIds: jest
      .fn()
      .mockResolvedValue([...effectiveProjectIds]),
  } as unknown as AcceptedEvidenceSelectorService;
}

describe('ActivityQueryService', () => {
  function canonicalHydration(title: string | undefined) {
    const sessionFindMany = jest.fn().mockResolvedValue([
      {
        id: 'session-a',
        title: 'Named session',
        status: 'COMPLETED',
        createdAt: WINDOW_START,
        user: null,
      },
      ...(title === undefined
        ? []
        : [
            {
              id: 'session-b',
              title,
              status: 'COMPLETED',
              createdAt: WINDOW_START,
              user: null,
            },
          ]),
    ]);
    const prisma = {
      db: {
        entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
        agentSession: { findMany: sessionFindMany },
        task: { findMany: jest.fn().mockResolvedValue([]) },
        project: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: PROJECT_A, name: 'Project A' }]),
        },
      },
    } as unknown as PrismaService;
    const hydration = new ActivityCorrelationService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, hydration, sessionFindMany };
  }

  it.each(['', ' \t\n ', undefined])(
    'hydrates root and linked sessions with unavailable title %p',
    async (title) => {
      const { hydration, sessionFindMany } = canonicalHydration(title);
      const records = await hydration.hydrateCanonicalActivityRecords(
        ORGANIZATION_ID,
        ['session-b', 'session-a'].map((entityId) => ({
          entityId,
          entityType: EntityType.AgentSession,
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.AgentSession,
          timestamp: WINDOW_END.toISOString(),
          reports: [],
          linkedEntities: ['session-b', 'session-a'].map((id) => ({
            entityId: id,
            entityType: EntityType.AgentSession,
            linkType: ActivityCorrelationLinkType.Related,
          })),
        })),
      );
      expect(records.map(({ title }) => title)).toEqual([
        'Agent Session',
        'Named session',
      ]);
      for (const record of records) {
        expect(record.linkedEntities.map(({ title }) => title)).toEqual([
          'Agent Session',
          'Named session',
        ]);
      }
      for (const [query] of sessionFindMany.mock.calls) {
        expect(query.where).toEqual({
          organizationId: ORGANIZATION_ID,
          id: { in: ['session-b', 'session-a'] },
        });
      }
    },
  );

  it.each([false, true])(
    'keeps missing non-session titles fatal (linked: %p)',
    async (linked) => {
      const { hydration } = canonicalHydration(undefined);
      await expect(
        hydration.hydrateCanonicalActivityRecords(ORGANIZATION_ID, [
          {
            entityId: linked ? 'session-a' : 'missing-task',
            entityType: linked ? EntityType.AgentSession : EntityType.Task,
            projectId: PROJECT_A,
            type: ActivityCorrelationActivityType.Notification,
            source: ActivityCorrelationSource.System,
            timestamp: WINDOW_END.toISOString(),
            reports: [],
            linkedEntities: linked
              ? [
                  {
                    entityId: 'missing-task',
                    entityType: EntityType.Task,
                    linkType: ActivityCorrelationLinkType.Related,
                  },
                ]
              : [],
          },
        ]),
      ).rejects.toThrow(
        'Missing required activity correlation title for TASK:missing-task',
      );
    },
  );

  it('preserves metric evidence, tied ordering and pagination through real hydration', async () => {
    const { prisma, hydration, sessionFindMany } = canonicalHydration('  ');
    const select = jest.fn().mockResolvedValue(
      selection(
        ['session-a', 'session-c', 'session-b', 'session-c'].map((entityId) =>
          acceptedRecord({
            entityId,
            eventId: `event-${entityId}`,
            metric: ProjectMetricIdentity.AgentSessionCreated,
            eventType: 'agent_session.created',
            aggregateType: 'agent_session',
            payload: {},
          }),
        ),
      ),
    );
    const service = new ActivityQueryService(
      selector(select),
      prisma,
      hydration,
    );
    const continuation = {
      metric: ProjectMetricIdentity.AgentSessionCreated,
      projectIds: [String(PROJECT_A), String(PROJECT_B)],
      windowStart: WINDOW_START.toISOString(),
      windowEnd: WINDOW_END.toISOString(),
      actorScope: { mode: 'ORGANIZATION' as const },
    };
    const pages = [];
    for (const offset of [0, 2, 0]) {
      pages.push(
        await service.queryActivity({
          organizationId: ORGANIZATION_ID,
          actorUserId: USER_ID,
          metricContinuation: continuation,
          limit: 2,
          offset,
        }),
      );
    }
    expect(
      pages.map(({ total, nextOffset }) => ({ total, nextOffset })),
    ).toEqual([
      { total: 3, nextOffset: 2 },
      { total: 3, nextOffset: undefined },
      { total: 3, nextOffset: 2 },
    ]);
    expect(
      [...pages[0]!.records, ...pages[1]!.records].map(
        ({ entityId, title, projectId, timestamp, entityType, source }) => ({
          entityId,
          title,
          projectId,
          timestamp,
          entityType,
          source,
        }),
      ),
    ).toEqual(
      ['session-c', 'session-b', 'session-a'].map((entityId) => ({
        entityId,
        title: entityId === 'session-a' ? 'Named session' : 'Agent Session',
        projectId: PROJECT_A,
        timestamp: '2026-09-04T10:00:00.000Z',
        entityType: EntityType.AgentSession,
        source: ActivityCorrelationSource.AgentSession,
      })),
    );
    expect(pages[2]!.records).toEqual(pages[0]!.records);
    expect(select).toHaveBeenCalledTimes(3);
    for (const call of select.mock.calls) {
      expect(call).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          actorScope: { mode: 'ORGANIZATION' },
        },
        {
          projectIds: continuation.projectIds,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          metric: ProjectMetricIdentity.AgentSessionCreated,
        },
      ]);
    }
    for (const [query] of sessionFindMany.mock.calls) {
      expect(query.where).toEqual({
        organizationId: ORGANIZATION_ID,
        id: { in: ['session-c', 'session-b', 'session-a'] },
      });
    }
  });
  it('passes a metric continuation unchanged to the accepted-evidence selector and paginates after deduplication', async () => {
    const select = jest.fn().mockResolvedValue(
      selection([
        acceptedRecord(),
        acceptedRecord(),
        acceptedRecord({
          eventId: 'event-2',
          entityId: 'task-2',
          occurredAt: new Date('2026-09-04T09:00:00.000Z'),
        }),
      ]),
    );
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) =>
        drafts.map((draft) => ({
          ...draft,
          title: draft.entityId,
        })),
    );
    const assembleOrganizationActivityRecords = jest.fn().mockResolvedValue([]);
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords,
    } as unknown as ActivityCorrelationService;
    const prisma = { db: {} } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );
    const continuation = {
      metric: ProjectMetricIdentity.TaskCompleted,
      projectIds: [String(PROJECT_A), String(PROJECT_B)],
      windowStart: WINDOW_START.toISOString(),
      windowEnd: WINDOW_END.toISOString(),
      actorScope: { mode: 'PERSONAL' as const, userId: USER_ID },
    };

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      metricContinuation: continuation,
      limit: 1,
      offset: 1,
    });

    expect(select).toHaveBeenCalledWith(
      {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        actorScope: { mode: 'PERSONAL', userId: USER_ID },
      },
      {
        projectIds: [String(PROJECT_A), String(PROJECT_B)],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        metric: ProjectMetricIdentity.TaskCompleted,
      },
    );
    expect(hydrateCanonicalActivityRecords).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'task-1',
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.System,
        }),
      ]),
    );
    expect(result.total).toBe(2);
    expect(result.records).toHaveLength(1);
    expect(result.nextOffset).toBeUndefined();
    expect(assembleOrganizationActivityRecords).not.toHaveBeenCalled();
  });

  it('does not attribute report activity to the current task assignee', async () => {
    const select = jest.fn().mockResolvedValue(
      selection([
        acceptedRecord({
          entityId: 'task-owned-by-me',
          eventId: 'event-owned-by-me',
          userId: 'other-user' as unknown as UserId,
        }),
        acceptedRecord({
          entityId: 'task-owned-by-other',
          eventId: 'event-owned-by-other',
          userId: 'other-user' as unknown as UserId,
        }),
      ]),
    );
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
        {
          entityId: 'task-owned-by-me',
          entityType: EntityType.Task,
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: '2026-09-04T10:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
        {
          entityId: 'task-owned-by-other',
          entityType: EntityType.Task,
          projectId: PROJECT_B,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: '2026-09-04T09:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
      ] satisfies ActivityCorrelationRecordDraft[]),
    } as unknown as ActivityCorrelationService;
    const prisma = {
      db: {
        task: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'task-owned-by-me',
              assigneeId: USER_ID,
              creatorId: null,
              serviceRelations: [{ serviceId: 'service-1' }],
            },
            {
              id: 'task-owned-by-other',
              assigneeId: 'other-user',
              creatorId: null,
              serviceRelations: [{ serviceId: 'service-2' }],
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      selectedUserId: USER_ID,
      serviceId: 'service-1',
      affectsMe: true,
      activityTypes: [ActivityCorrelationActivityType.Notification],
      sources: [ActivityCorrelationSource.Report],
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          projectId: { in: [PROJECT_A, PROJECT_B] },
        }),
      }),
    );
  });

  it('keeps ordinary Activity queries on the canonical attention stream and honors the project scope', async () => {
    const select = jest.fn().mockResolvedValue(selection([]));
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const attentionDraft: ActivityCorrelationRecordDraft = {
      entityId: 'task-1',
      entityType: EntityType.Task,
      projectId: PROJECT_B,
      type: ActivityCorrelationActivityType.Viewed,
      source: ActivityCorrelationSource.AttentionEvent,
      timestamp: '2026-09-04T11:00:00.000Z',
      linkedEntities: [],
      reports: [],
    };
    const assembleOrganizationActivityRecords = jest
      .fn()
      .mockResolvedValue([attentionDraft]);
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords,
    } as unknown as ActivityCorrelationService;
    const prisma = { db: {} } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      projectId: PROJECT_B,
      activityTypes: [ActivityCorrelationActivityType.Viewed],
      sources: [ActivityCorrelationSource.AttentionEvent],
      limit: 50,
      offset: 0,
    });

    expect(evidenceSelector.resolveAuthorizedProjectIds).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      projectId: PROJECT_B,
      actorScope: { mode: 'ORGANIZATION' },
    });
    expect(select).not.toHaveBeenCalled();
    expect(assembleOrganizationActivityRecords).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      expect.objectContaining({
        projectIds: [PROJECT_A, PROJECT_B],
        attentionUserId: USER_ID,
        includeAttention: true,
      }),
    );
    expect(result.total).toBe(1);
    expect(result.records[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_B,
        entityType: EntityType.Task,
        source: ActivityCorrelationSource.AttentionEvent,
      }),
    );
  });

  it('applies WITHOUT_ATTENTION before published source and activity filters', async () => {
    const select = jest.fn().mockResolvedValue(selection([acceptedRecord()]));
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
        {
          entityId: 'reported-task',
          entityType: EntityType.Task,
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: '2026-09-04T10:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
      ] satisfies ActivityCorrelationRecordDraft[]),
    } as unknown as ActivityCorrelationService;
    const attentionFindMany = jest.fn();
    const prisma = {
      db: { attentionEvent: { findMany: attentionFindMany } },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );

    const included = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      activityMode: ActivityCorrelationMode.WithoutAttention,
      activityTypes: [ActivityCorrelationActivityType.Notification],
      sources: [ActivityCorrelationSource.Report],
      limit: 50,
      offset: 0,
    });
    const excluded = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      activityMode: ActivityCorrelationMode.WithoutAttention,
      activityTypes: [ActivityCorrelationActivityType.Notification],
      sources: [ActivityCorrelationSource.System],
      limit: 50,
      offset: 0,
    });

    expect(included.total).toBe(1);
    expect(excluded.total).toBe(0);
    expect(attentionFindMany).not.toHaveBeenCalled();
  });

  it('routes agent-session evidence through the published AGENT_SESSION source', async () => {
    const select = jest.fn().mockResolvedValue(
      selection([
        acceptedRecord(),
        acceptedRecord({
          metric: ProjectMetricIdentity.AgentSessionCreated,
          entityId: 'session-1',
          eventId: 'session-event-1',
          eventType: 'agent_session.created',
          aggregateType: 'agent_session',
        }),
      ]),
    );
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const service = new ActivityQueryService(
      evidenceSelector,
      { db: {} } as unknown as PrismaService,
      {
        hydrateCanonicalActivityRecords,
        assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
          {
            entityId: 'session-1',
            entityType: EntityType.AgentSession,
            projectId: PROJECT_A,
            type: ActivityCorrelationActivityType.AgentSessionCompleted,
            source: ActivityCorrelationSource.AgentSession,
            timestamp: '2026-09-04T10:00:00.000Z',
            linkedEntities: [],
            reports: [],
          },
        ] satisfies ActivityCorrelationRecordDraft[]),
      } as unknown as ActivityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      entityTypes: [EntityType.AgentSession],
      sources: [ActivityCorrelationSource.AgentSession],
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.records[0]).toEqual(
      expect.objectContaining({
        entityId: 'session-1',
        entityType: EntityType.AgentSession,
        source: ActivityCorrelationSource.AgentSession,
      }),
    );
  });

  it('applies entity, time, and service filters to plan evidence', async () => {
    const select = jest.fn().mockResolvedValue(
      selection([
        acceptedRecord({
          metric: ProjectMetricIdentity.ProjectInfoCreated,
          projectId: PROJECT_B,
          entityId: 'plan-1',
          eventId: 'plan-event-1',
          eventType: 'task.created',
          aggregateType: 'task',
          occurredAt: WINDOW_START,
        }),
        acceptedRecord({
          entityId: 'task-1',
          eventId: 'task-event-1',
        }),
      ]),
    );
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
        {
          entityId: 'plan-1',
          entityType: EntityType.Task,
          projectId: PROJECT_B,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: WINDOW_START.toISOString(),
          linkedEntities: [],
          reports: [],
        },
      ] satisfies ActivityCorrelationRecordDraft[]),
    } as unknown as ActivityCorrelationService;
    const prisma = {
      db: {
        task: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'plan-1',
              assigneeId: USER_ID,
              serviceRelations: [{ serviceId: 'service-1' }],
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      entityTypes: [EntityType.Task, EntityType.AgentSession],
      serviceId: 'service-1',
      activityTypes: [ActivityCorrelationActivityType.Notification],
      since: WINDOW_START,
      until: WINDOW_END,
      limit: 50,
      offset: 0,
    });

    expect(evidenceSelector.resolveAuthorizedProjectIds).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      actorScope: { mode: 'ORGANIZATION' },
    });
    expect(select).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.records[0]!).toEqual(
      expect.objectContaining({
        entityId: 'plan-1',
        entityType: EntityType.Task,
        projectId: PROJECT_B,
      }),
    );
  });

  it('filters agent sessions by their selected services rather than only the launch service', async () => {
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords: jest.fn(
        async (
          _organizationId: OrganizationId,
          drafts: ActivityCorrelationRecordDraft[],
        ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
      ),
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
        {
          entityId: 'session-1',
          entityType: EntityType.AgentSession,
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.AgentSessionCompleted,
          source: ActivityCorrelationSource.AgentSession,
          timestamp: '2026-09-04T10:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
      ] satisfies ActivityCorrelationRecordDraft[]),
    } as unknown as ActivityCorrelationService;
    const prisma = {
      db: {
        agentSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'session-1',
              userId: USER_ID,
              serviceRelations: [
                { serviceId: 'launch-service' },
                { serviceId: 'selected-service' },
              ],
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(
      selector(jest.fn().mockResolvedValue(selection([]))),
      prisma,
      activityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      serviceId: 'selected-service',
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(prisma.db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          serviceRelations: { select: { serviceId: true } },
        }),
      }),
    );
  });

  it('applies since-last-visit after the exact activity boundary', async () => {
    const select = jest.fn().mockResolvedValue(
      selection([
        acceptedRecord({
          occurredAt: new Date('2026-09-04T10:00:00.000Z'),
        }),
      ]),
    );
    const evidenceSelector = selector(select);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const activityCorrelationService = {
      hydrateCanonicalActivityRecords,
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([
        {
          entityId: 'task-1',
          entityType: EntityType.Task,
          projectId: PROJECT_A,
          type: ActivityCorrelationActivityType.Viewed,
          source: ActivityCorrelationSource.AttentionEvent,
          timestamp: '2026-09-04T10:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
        {
          entityId: 'task-2',
          entityType: EntityType.Task,
          projectId: PROJECT_B,
          type: ActivityCorrelationActivityType.Viewed,
          source: ActivityCorrelationSource.AttentionEvent,
          timestamp: '2026-09-04T11:00:00.000Z',
          linkedEntities: [],
          reports: [],
        },
      ] satisfies ActivityCorrelationRecordDraft[]),
    } as unknown as ActivityCorrelationService;
    const attentionEventFindMany = jest.fn().mockResolvedValue([
      {
        entityId: 'task-1',
        entityType: 'TASK',
        focusEnd: new Date('2026-09-04T10:00:00.000Z'),
      },
    ]);
    const prisma = {
      db: { attentionEvent: { findMany: attentionEventFindMany } },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(
      evidenceSelector,
      prisma,
      activityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      sinceLastVisit: true,
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.records[0]!).toEqual(
      expect.objectContaining({
        entityId: 'task-2',
        source: ActivityCorrelationSource.AttentionEvent,
      }),
    );
    expect(attentionEventFindMany).toHaveBeenCalledTimes(1);
  });

  it('returns the canonical report, unblocked, and completed-session streams for their published filters', async () => {
    const canonicalDrafts: ActivityCorrelationRecordDraft[] = [
      {
        entityId: 'task-with-report',
        entityType: EntityType.Task,
        projectId: PROJECT_A,
        type: ActivityCorrelationActivityType.Notification,
        source: ActivityCorrelationSource.Report,
        timestamp: '2026-09-04T10:00:00.000Z',
        linkedEntities: [],
        reports: [],
      },
      {
        entityId: 'unblocked-task',
        entityType: EntityType.Task,
        projectId: PROJECT_A,
        type: ActivityCorrelationActivityType.Unblocked,
        source: ActivityCorrelationSource.TaskRelationship,
        timestamp: '2026-09-04T09:00:00.000Z',
        linkedEntities: [],
        reports: [],
      },
      {
        entityId: 'completed-session',
        entityType: EntityType.AgentSession,
        projectId: PROJECT_B,
        type: ActivityCorrelationActivityType.AgentSessionCompleted,
        source: ActivityCorrelationSource.AgentSession,
        timestamp: '2026-09-04T08:00:00.000Z',
        linkedEntities: [],
        reports: [],
      },
    ];
    const assembleOrganizationActivityRecords = jest
      .fn()
      .mockResolvedValue(canonicalDrafts);
    const hydrateCanonicalActivityRecords = jest.fn(
      async (
        _organizationId: OrganizationId,
        drafts: ActivityCorrelationRecordDraft[],
      ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
    );
    const service = new ActivityQueryService(
      selector(jest.fn().mockResolvedValue(selection([]))),
      { db: {} } as unknown as PrismaService,
      {
        assembleOrganizationActivityRecords,
        hydrateCanonicalActivityRecords,
      } as unknown as ActivityCorrelationService,
    );

    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      activityMode: ActivityCorrelationMode.WithoutAttention,
      activityTypes: [
        ActivityCorrelationActivityType.Notification,
        ActivityCorrelationActivityType.Unblocked,
        ActivityCorrelationActivityType.AgentSessionCompleted,
      ],
      sources: [
        ActivityCorrelationSource.Report,
        ActivityCorrelationSource.TaskRelationship,
        ActivityCorrelationSource.AgentSession,
      ],
      since: WINDOW_START,
      until: WINDOW_END,
      limit: 50,
      offset: 0,
    });

    expect(assembleOrganizationActivityRecords).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      {
        projectIds: [PROJECT_A, PROJECT_B],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        attentionUserId: USER_ID,
        includeAttention: false,
      },
    );
    expect(
      result.records.map(({ entityId, type, source }) => ({
        entityId,
        type,
        source,
      })),
    ).toEqual(
      canonicalDrafts.map(({ entityId, type, source }) => ({
        entityId,
        type,
        source,
      })),
    );
    expect(result.total).toBe(3);
  });

  it('assembles organization-scoped canonical records from reports, task relationships, and completed sessions', async () => {
    const prisma = {
      db: {
        attentionEvent: {
          findMany: jest.fn().mockResolvedValue([
            {
              entityId: 'viewed-task',
              entityType: 'TASK',
              projectId: PROJECT_B,
              focusEnd: new Date('2026-09-04T11:00:00.000Z'),
            },
          ]),
        },
        agentSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'session-1',
              type: 'CODING',
              updatedAt: new Date('2026-09-04T10:00:00.000Z'),
              projectId: PROJECT_A,
              userId: USER_ID,
              entityType: 'TASK',
              entityId: 'dependency-task',
              serviceId: 'service-1',
              serviceRelations: [
                { serviceId: 'service-1' },
                { serviceId: 'service-2' },
              ],
              conversationId: 'conversation-1',
            },
          ]),
        },
        report: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'report-1',
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_B,
              reportType: 'IMPLEMENT',
              audience: 'PROJECT_VISIBLE',
              payload: { summary: 'Implemented the change' },
              version: 1,
              schemaVersion: 1,
              sourceExecutionId: 'session-1',
              createdAt: new Date('2026-09-04T09:00:00.000Z'),
              expiresAt: new Date('2026-09-10T00:00:00.000Z'),
              reportEntities: [
                {
                  entityType: 'TASK',
                  entityId: 'reported-task',
                  relation: 'PRIMARY',
                  createdAt: new Date('2026-09-04T09:00:00.000Z'),
                },
              ],
            },
          ]),
        },
        taskDependency: {
          findMany: jest.fn().mockResolvedValue([
            {
              dependentTaskId: 'unblocked-task',
              dependencyTaskId: 'dependency-task',
              dependencyTask: {
                id: 'dependency-task',
                status: 'ACTIVE',
                updatedAt: new Date('2026-09-04T08:00:00.000Z'),
                projectId: PROJECT_A,
              },
              dependentTask: {
                id: 'unblocked-task',
                status: 'ACTIVE',
                updatedAt: new Date('2026-09-04T08:30:00.000Z'),
                projectId: PROJECT_A,
              },
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const reportService = Object.create(
      ReportService.prototype,
    ) as ReportService;
    jest
      .spyOn(reportService, 'getReportTitle')
      .mockReturnValue('Implementation report');
    const service = new ActivityCorrelationService(
      prisma,
      {} as never,
      reportService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const records = await service.assembleOrganizationActivityRecords(
      ORGANIZATION_ID,
      {
        projectIds: [PROJECT_A, PROJECT_B],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        attentionUserId: USER_ID,
        includeAttention: true,
      },
    );

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'viewed-task',
          type: ActivityCorrelationActivityType.Viewed,
          source: ActivityCorrelationSource.AttentionEvent,
          linkedEntities: [
            expect.objectContaining({
              entityId: 'viewed-task',
              linkType: 'SELF',
            }),
          ],
        }),
        expect.objectContaining({
          entityId: 'session-1',
          type: ActivityCorrelationActivityType.AgentSessionCompleted,
          source: ActivityCorrelationSource.AgentSession,
          linkedEntities: expect.arrayContaining([
            expect.objectContaining({
              entityId: 'service-1',
              entityType: EntityType.Service,
            }),
            expect.objectContaining({
              entityId: 'service-2',
              entityType: EntityType.Service,
            }),
          ]),
        }),
        expect.objectContaining({
          entityId: 'unblocked-task',
          type: ActivityCorrelationActivityType.Unblocked,
          source: ActivityCorrelationSource.TaskRelationship,
        }),
        expect.objectContaining({
          entityId: 'reported-task',
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          reports: [expect.objectContaining({ id: 'report-1' })],
        }),
      ]),
    );
  });

  it('hydrates project-scoped proposal attention through the canonical title path', async () => {
    const entityRegistryFindMany = jest.fn().mockResolvedValue([]);
    const proposalFindMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'proposal-1', title: 'Update the project name' },
      ]);
    const prisma = {
      db: {
        entityRegistry: { findMany: entityRegistryFindMany },
        project: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: PROJECT_A, name: 'Project A' }]),
        },
        proposal: { findMany: proposalFindMany },
      },
    } as unknown as PrismaService;
    const activityCorrelationService = new ActivityCorrelationService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result =
      await activityCorrelationService.hydrateCanonicalActivityRecords(
        ORGANIZATION_ID,
        [
          {
            entityId: 'proposal-1',
            entityType: EntityType.Proposal,
            projectId: PROJECT_A,
            type: ActivityCorrelationActivityType.Viewed,
            timestamp: '2026-09-04T10:00:00.000Z',
            source: ActivityCorrelationSource.AttentionEvent,
            linkedEntities: [],
            reports: [],
          },
        ],
      );

    expect(result[0]).toEqual(
      expect.objectContaining({
        entityId: 'proposal-1',
        title: 'Update the project name',
      }),
    );
    expect(proposalFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORGANIZATION_ID,
        id: { in: ['proposal-1'] },
      },
      select: { id: true, title: true },
    });
  });
  it('hydrates mixed history identities without inventing users or loading messages', async () => {
    const user = {
      id: USER_ID,
      name: 'Alex',
      email: 'alex@example.test',
      isActive: true,
      createdAt: WINDOW_START,
      updatedAt: WINDOW_END,
    };
    const taskFindMany = jest.fn().mockResolvedValue([
      {
        id: 'assigned',
        name: 'Assigned work',
        status: 'ACTIVE',
        createdAt: WINDOW_START,
        assignee: user,
        project: { name: 'Project A' },
      },
      {
        id: 'unassigned',
        name: 'Unassigned work',
        status: 'BACKLOG',
        createdAt: WINDOW_START,
        assignee: null,
        project: { name: 'Project A' },
      },
    ]);
    const sessionFindMany = jest.fn().mockResolvedValue([
      {
        id: 'session',
        title: 'Session work',
        status: 'COMPLETED',
        createdAt: WINDOW_START,
        user,
        project: { name: 'Project A' },
      },
    ]);
    const messageFindMany = jest.fn();
    const prisma = {
      db: {
        entityRegistry: {
          findMany: jest.fn().mockResolvedValue([
            {
              entityId: 'missing',
              entityType: 'TASK',
              entityName: 'Known title',
            },
          ]),
        },
        project: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: PROJECT_A, name: 'Project A' }]),
        },
        task: { findMany: taskFindMany },
        agentSession: { findMany: sessionFindMany },
        message: { findMany: messageFindMany },
      },
    } as unknown as PrismaService;
    const service = new ActivityCorrelationService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const drafts = ['assigned', 'unassigned', 'session', 'missing'].map(
      (entityId) =>
        ({
          entityId,
          entityType:
            entityId === 'session' ? EntityType.AgentSession : EntityType.Task,
          projectId: PROJECT_A,
          timestamp: WINDOW_END.toISOString(),
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.System,
          linkedEntities: [],
          reports: [],
        }) satisfies ActivityCorrelationRecordDraft,
    );
    const records = await service.hydrateCanonicalActivityRecords(
      ORGANIZATION_ID,
      drafts,
    );
    expect(
      records.map((record) => record.responsibleUser?.name ?? null),
    ).toEqual(['Alex', null, 'Alex', null]);
    expect(records[0]).toEqual(
      expect.objectContaining({
        status: 'ACTIVE',
        entityCreatedAt: WINDOW_START.toISOString(),
        timestamp: WINDOW_END.toISOString(),
        projectName: 'Project A',
      }),
    );
    expect(records[3]?.entityCreatedAt).toBeNull();
    expect(messageFindMany).not.toHaveBeenCalled();
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          id: { in: ['assigned', 'unassigned', 'missing'] },
        },
        select: expect.objectContaining({ assignee: expect.any(Object) }),
      }),
    );
  });
});

describe('ActivityQueryService work-item lifecycle evidence', () => {
  const OTHER_USER = 'user-2' as unknown as UserId;

  function lifecycleEvent(
    id: string,
    taskId: string,
    createdAt: string,
    userId: UserId,
  ) {
    return {
      id,
      eventType: 'task.created',
      aggregateType: 'task',
      aggregateId: taskId,
      projectId: PROJECT_A,
      userId,
      createdAt: new Date(createdAt),
      headers: {},
      correlationId: id,
      causationId: null,
      conversationId: null,
      payload: { task: { id: taskId, projectId: PROJECT_A, type: 'INCIDENT' } },
    };
  }

  function lifecycleHarness() {
    const events = [
      lifecycleEvent('e1', 'incident-1', '2026-09-04T08:00:00.000Z', USER_ID),
      lifecycleEvent(
        'e2',
        'incident-2',
        '2026-09-04T09:00:00.000Z',
        OTHER_USER,
      ),
      lifecycleEvent('e3', 'incident-3', '2026-09-04T10:00:00.000Z', USER_ID),
      lifecycleEvent('e4', 'incident-4', '2026-09-02T10:00:00.000Z', USER_ID),
    ];
    const outboxFindMany = jest.fn(
      async ({
        where,
      }: {
        where: {
          userId?: string;
          createdAt: { gte: Date; lt: Date };
        };
      }) =>
        events.filter(
          (event) =>
            (where.userId === undefined || event.userId === where.userId) &&
            event.createdAt >= where.createdAt.gte &&
            event.createdAt < where.createdAt.lt,
        ),
    );
    const prisma = {
      db: {
        outboxEvent: { findMany: outboxFindMany },
        task: {
          findMany: jest.fn().mockResolvedValue(
            events.map((event) => ({
              id: event.aggregateId,
              type: 'INCIDENT',
              projectId: PROJECT_A,
            })),
          ),
        },
      },
    } as unknown as PrismaService;
    const realSelector = new AcceptedEvidenceSelectorService(
      prisma,
      {
        accessibleProjectIds: jest.fn().mockResolvedValue([PROJECT_A]),
      } as never,
      {
        getDefinitions: () => [
          { definition: { key: 'INCIDENT', role: 'work-item' } },
        ],
      } as never,
      () => WINDOW_END,
    );
    const select = jest.spyOn(realSelector, 'select');
    const selectWorkItemLifecycle = jest.spyOn(
      realSelector,
      'selectWorkItemLifecycle',
    );
    const activity = {
      hydrateCanonicalActivityRecords: jest.fn(
        async (
          _organizationId: OrganizationId,
          drafts: ActivityCorrelationRecordDraft[],
        ) => drafts.map((draft) => ({ ...draft, title: draft.entityId })),
      ),
      assembleOrganizationActivityRecords: jest.fn().mockResolvedValue([]),
    } as unknown as ActivityCorrelationService;
    return {
      service: new ActivityQueryService(realSelector, prisma, activity),
      select,
      selectWorkItemLifecycle,
    };
  }

  it('returns ordered, paginated lifecycle records for custom-type work items without attention', async () => {
    const { service } = lifecycleHarness();
    const request = {
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      projectId: PROJECT_A,
      activityMode: ActivityCorrelationMode.WithoutAttention,
      limit: 2,
    };
    const first = await service.queryActivity({ ...request, offset: 0 });
    const second = await service.queryActivity({ ...request, offset: 2 });

    expect(first.total).toBe(4);
    expect(first.nextOffset).toBe(2);
    expect(
      [...first.records, ...second.records].map(({ entityId }) => entityId),
    ).toEqual(['incident-3', 'incident-2', 'incident-1', 'incident-4']);
    expect(first.records[0]).toEqual(
      expect.objectContaining({
        entityType: EntityType.Task,
        type: ActivityCorrelationActivityType.Notification,
        source: ActivityCorrelationSource.System,
        eventActorUserId: USER_ID,
      }),
    );
  });

  it('applies the selected user and time bounds before total and offset', async () => {
    const { service, selectWorkItemLifecycle } = lifecycleHarness();
    const result = await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      selectedUserId: USER_ID,
      since: WINDOW_START,
      until: WINDOW_END,
      activityMode: ActivityCorrelationMode.WithoutAttention,
      limit: 1,
      offset: 1,
    });

    expect(result.total).toBe(2);
    expect(result.records.map(({ entityId }) => entityId)).toEqual([
      'incident-1',
    ]);
    expect(selectWorkItemLifecycle).toHaveBeenCalledWith(ORGANIZATION_ID, {
      projectIds: [PROJECT_A],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      eventActorUserId: USER_ID,
    });
  });

  it('never reads lifecycle evidence for metric continuations or history', async () => {
    const { service, select, selectWorkItemLifecycle } = lifecycleHarness();
    const boundary = {
      metric: ProjectMetricIdentity.TaskCreated,
      projectIds: [String(PROJECT_A)],
      windowStart: WINDOW_START.toISOString(),
      windowEnd: WINDOW_END.toISOString(),
    };
    await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      metricContinuation: {
        ...boundary,
        actorScope: { mode: 'ORGANIZATION' },
      },
      limit: 10,
      offset: 0,
    });
    await service.queryActivity({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      historyFilter: { ...boundary, userId: USER_ID },
      limit: 10,
      offset: 0,
    });

    expect(select).toHaveBeenCalledTimes(2);
    expect(selectWorkItemLifecycle).not.toHaveBeenCalled();
  });
});
