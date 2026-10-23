import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CreateReportDto,
  PlanReportPayload,
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
} from 'src/generated';
import {
  createMockDomainEventPublisher,
  createMockPrismaService,
} from 'src/utils/testUtils';
import { NodeType } from 'src/types/flow-internal.types';
import { OrganizationId, ProjectId } from 'src/types';
import { ReportService } from '../report.service';
import { projectReportPayload } from './project-report.fixture';

const createMockEntityRegistryService = () => ({
  getEntitiesByIds: jest.fn().mockResolvedValue([]),
});

const validPlanPrimaryImplementation = {
  title: 'Primary implementation',
  content: 'Concrete implementation body.',
  rationale: 'Defines the delivered behavior.',
};

const validPlanStep = {
  stepId: 'step-1',
  title: 'Implement the change',
  description: 'Apply the approved implementation.',
  phase: 1,
  references: [],
};

describe('ReportService', () => {
  it('round-trips ordered walkthroughs through create, retrieval and update', async () => {
    const organizationId =
      '11111111-1111-4111-8111-111111111111' as OrganizationId;
    const payload = {
      reportType: 'CHANGE_WALKTHROUGH' as const,
      summary: 'Behavior first',
      targetRunId: '22222222-2222-4222-8222-222222222222',
      groups: [
        {
          title: 'Consequential policy',
          changes: [
            {
              title: 'Deny',
              context: 'Policy',
              walkthrough: [],
              behavioralConsequence: 'Denied by default',
            },
          ],
        },
        { title: 'Supporting changes', changes: [] },
      ],
    };
    const stored = {
      id: '33333333-3333-4333-8333-333333333333',
      organizationId,
      reportType: ReportType.ChangeWalkthrough,
      audience: ReportAudience.ProjectVisible,
      payload,
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      createdAt: new Date(),
      expiresAt: new Date('2026-11-15T00:00:00Z'),
      reportEntities: [],
      projectId: null,
    };
    prisma.db.report.create.mockResolvedValue(stored);
    await service.create(organizationId, {
      reportType: ReportType.ChangeWalkthrough,
      audience: ReportAudience.ProjectVisible,
      payload,
    });
    expect(prisma.db.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload }),
      }),
    );
    prisma.db.report.findFirst.mockResolvedValue(stored);
    expect((await service.findOne(organizationId, stored.id)).payload).toEqual(
      payload,
    );
    const updatedPayload = { ...payload, summary: 'Updated explanation' };
    prisma.db.report.update.mockResolvedValue({
      ...stored,
      payload: updatedPayload,
    });
    expect(
      (
        await service.update(organizationId, stored.id, {
          payload: updatedPayload,
        })
      ).payload,
    ).toEqual(updatedPayload);
    await expect(
      service.update(organizationId, stored.id, {
        payload: {
          reportType: 'CHANGE_WALKTHROUGH',
          summary: 'Missing target',
        } as any,
      }),
    ).rejects.toThrow('Invalid CHANGE_WALKTHROUGH payload');
    await expect(
      service.create(organizationId, {
        reportType: ReportType.ChangeWalkthrough,
        audience: ReportAudience.ProjectVisible,
        payload: { reportType: 'REVIEW', summary: 'Wrong variant' } as any,
      }),
    ).rejects.toThrow('Invalid CHANGE_WALKTHROUGH payload');
  });

  let prisma: ReturnType<typeof createMockPrismaService>;
  let eventPublisher: ReturnType<typeof createMockDomainEventPublisher>;
  let entityRegistryService: ReturnType<typeof createMockEntityRegistryService>;
  let flowExecutionService: { findActiveByConversation: jest.Mock };
  let nodeExecutionService: { getNode: jest.Mock };
  let service: ReportService;

  it('omits empty optional evidence connections when publishing a stored PLAN', async () => {
    const organizationId =
      '11111111-1111-4111-8111-111111111111' as OrganizationId;
    const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
    const payload: PlanReportPayload = {
      reportType: 'PLAN',
      summary: 'Repair event compatibility.',
      sessionTitle: 'Event compatibility',
      requiredServiceIds: ['33333333-3333-4333-8333-333333333333'],
      primaryImplementations: [validPlanPrimaryImplementation],
      executionPlan: [validPlanStep],
      discrepancies: [],
      clarificationQuestions: [],
    };
    const storedPayload: PlanReportPayload = {
      ...payload,
      primaryImplementations: [
        { ...validPlanPrimaryImplementation, connections: [] },
      ],
    };
    prisma.db.service.findMany.mockResolvedValue(
      Array.from(payload.requiredServiceIds, (id) => ({ id })),
    );
    prisma.db.report.create.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      organizationId,
      projectId,
      reportType: ReportType.Plan,
      audience: ReportAudience.ProjectVisible,
      payload: storedPayload,
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      createdAt: new Date('2026-10-12T00:00:00Z'),
      expiresAt: new Date('2026-11-12T00:00:00Z'),
      reportEntities: [],
    });
    const dto: CreateReportDto = {
      projectId,
      reportType: ReportType.Plan,
      audience: ReportAudience.ProjectVisible,
      payload,
    };
    await service.create(organizationId, dto);
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          report: expect.objectContaining({
            payload: {
              ...payload,
              primaryImplementations: [validPlanPrimaryImplementation],
            },
          }),
        }),
      }),
    );
    expect(storedPayload.primaryImplementations[0]?.connections).toEqual([]);
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    eventPublisher = createMockDomainEventPublisher();
    entityRegistryService = createMockEntityRegistryService();
    flowExecutionService = {
      findActiveByConversation: jest.fn().mockResolvedValue(null),
    };
    nodeExecutionService = { getNode: jest.fn().mockReturnValue(undefined) };
    service = new ReportService(
      prisma as any,
      eventPublisher as any,
      entityRegistryService as any,
      flowExecutionService as any,
      nodeExecutionService as any,
    );
  });

  const buildImplementReport = (overrides: Partial<any> = {}) => ({
    id: 'report-implement-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    reportType: ReportType.Implement,
    audience: ReportAudience.WorkflowOnly,
    title: 'Implement',
    payload: {
      reportType: 'IMPLEMENT',
      summary: 'Implemented the change.',
      filesChanged: [
        ' src/services/reports/report.service.ts ',
        './src/services/reports/report.service.ts',
        `${process.cwd()}/src/controllers/report.controller.ts`,
      ],
    },
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: 'agent-session-1',
    parentReportId: null,
    createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
    expiresAt: new Date('2026-08-09T00:00:00.000Z').toISOString(),
    entities: [
      {
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
        relation: ReportEntityRelation.Primary,
        createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
      },
      {
        entityType: ReportRelatedEntityType.Service,
        entityId: 'service-1',
        relation: ReportEntityRelation.Context,
        createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
      },
      {
        entityType: ReportRelatedEntityType.AgentSession,
        entityId: 'agent-session-1',
        relation: ReportEntityRelation.Context,
        createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
      },
    ],
    ...overrides,
  });

  const buildFileTouchRow = (overrides: Partial<any> = {}) => ({
    id: 'touch-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    serviceId: 'service-1',
    featureId: 'feature-1',
    attachedEntityType: 'TASK',
    attachedEntityId: 'task-1',
    reportId: 'report-1',
    agentSessionId: 'agent-session-1',
    normalizedPath: 'src/index.ts',
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    ...overrides,
  });

  it.each([
    [ReportType.CodingResearch, 'Coding Research'],
    [ReportType.Snapshot, 'Snapshot'],
    [ReportType.Review, 'Review'],
  ])('maps report type %s to title %s', (type, expectedTitle) => {
    expect(service.getReportTitle(type)).toBe(expectedTitle);
  });

  it.each(['entities', 'linkedEntities'])(
    'rejects removed PLAN entity identities in %s before Prisma persistence',
    async (field) => {
      const dto = JSON.parse(
        JSON.stringify({
          projectId: 'project-1',
          reportType: ReportType.Snapshot,
          audience: ReportAudience.ProjectVisible,
          payload: { reportType: 'SNAPSHOT', summary: 'Plan work-item report' },
          [field]: [
            { entityType: 'PLAN', entityId: 'plan-1', relation: 'PRIMARY' },
          ],
        }),
      );
      await expect(service.create('org-1' as any, dto)).rejects.toThrow(
        'Unsupported report entityType: PLAN',
      );
      expect(prisma.db.report.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a PLAN payload with an unknown execution step field before persistence', async () => {
    const dto = {
      projectId: 'project-1',
      reportType: ReportType.Plan,
      audience: ReportAudience.ProjectVisible,
      payload: {
        reportType: 'PLAN',
        summary: 'Revise the implementation plan.',
        sessionTitle: 'Plan revision',
        requiredServiceIds: ['service-launch'],
        primaryImplementations: [validPlanPrimaryImplementation],
        executionPlan: [
          validPlanStep,
          { ...validPlanStep, stepId: 'step-2', step: null },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    } as unknown as CreateReportDto;

    await expect(service.create('org-1' as any, dto)).rejects.toThrow(
      '/executionPlan/1 must NOT have additional properties (step)',
    );
    expect(prisma.db.service.findMany).not.toHaveBeenCalled();
    expect(prisma.db.report.create).not.toHaveBeenCalled();
  });

  it.each([
    'standalone-repository-file',
    '6d80be06-f141-4bbf-9d33-53fdd26ea0c7',
  ])(
    'rejects unavailable PLAN required Service %s before persistence',
    async (requiredServiceId) => {
      prisma.db.service.findMany.mockResolvedValue([]);
      const dto = {
        projectId: 'project-1',
        reportType: ReportType.Plan,
        audience: ReportAudience.ProjectVisible,
        payload: {
          reportType: 'PLAN',
          summary: 'Revise the implementation plan.',
          sessionTitle: 'Plan revision',
          requiredServiceIds: [requiredServiceId],
          primaryImplementations: [validPlanPrimaryImplementation],
          executionPlan: [validPlanStep],
          discrepancies: [],
          clarificationQuestions: [],
        },
      } as unknown as CreateReportDto;

      await expect(service.create('org-1' as any, dto)).rejects.toThrow(
        `Unavailable Service IDs: ${requiredServiceId}`,
      );
      expect(prisma.db.service.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [requiredServiceId] },
          organizationId: 'org-1',
          projectId: 'project-1',
          status: { not: 'ARCHIVED' },
          archivedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.db.report.create).not.toHaveBeenCalled();
    },
  );

  it('accepts additional project Services in a PLAN declaration without granting authority', async () => {
    const requiredServiceIds = ['service-launch', 'service-additional'];
    prisma.db.service.findMany.mockResolvedValue(
      requiredServiceIds.map((id) => ({ id })),
    );
    const createdAt = new Date('2026-09-22T19:46:00-07:00');
    prisma.db.report.create.mockResolvedValue({
      id: 'report-plan-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: ReportType.Plan,
      audience: ReportAudience.ProjectVisible,
      payload: {
        reportType: 'PLAN',
        summary: 'Revise the implementation plan.',
        sessionTitle: 'Plan revision',
        requiredServiceIds,
        primaryImplementations: [],
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      createdAt,
      expiresAt: new Date('2026-10-22T19:46:00-07:00'),
      reportEntities: [],
    });
    const dto = {
      projectId: 'project-1',
      reportType: ReportType.Plan,
      audience: ReportAudience.ProjectVisible,
      payload: {
        reportType: 'PLAN',
        summary: 'Revise the implementation plan.',
        sessionTitle: 'Plan revision',
        requiredServiceIds,
        primaryImplementations: [validPlanPrimaryImplementation],
        executionPlan: [validPlanStep],
        discrepancies: [],
        clarificationQuestions: [],
      },
    } as unknown as CreateReportDto;

    await expect(service.create('org-1' as any, dto)).resolves.toEqual(
      expect.objectContaining({ id: 'report-plan-1' }),
    );
    expect(prisma.db.report.create).toHaveBeenCalledTimes(1);
  });

  it('creates a report with entities and returns mapped dto', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.create as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: {
        summary: 'ok',
        __reportEnvelope: { agent: 'provider-session-1' },
      },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      ragEnabled: true,
      createdAt,
      expiresAt,
      reportEntities: [
        {
          id: 'entity-1',
          reportId: 'report-1',
          entityType: 'TASK',
          entityId: 'task-1',
          relation: 'PRIMARY',
          createdAt,
        },
      ],
    });

    const result = await service.create('org-1' as any, {
      projectId: 'project-1',
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.WorkflowOnly,
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'ok',
        analysis: 'analysis',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
      agent: ' provider-session-1 ',
      sourceExecutionId: 'exec-1',
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: 'task-1',
          relation: ReportEntityRelation.Primary,
        },
      ],
    });

    expect(prisma.db.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'project-1',
          reportType: 'CODING_RESEARCH',
          audience: 'WORKFLOW_ONLY',
          payload: expect.objectContaining({
            __reportEnvelope: { agent: 'provider-session-1' },
          }),
          sourceExecutionId: 'exec-1',
        }),
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'report.created',
        aggregateId: 'report-1',
        payload: expect.objectContaining({
          payloadType: 'report.created',
          organizationId: 'org-1',
          projectId: 'project-1',
          report: expect.objectContaining({
            id: 'report-1',
            agent: 'provider-session-1',
            payload: { summary: 'ok' },
          }),
        }),
      }),
    );
    expect(result).toEqual({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.WorkflowOnly,
      title: 'Coding Research',
      payload: { summary: 'ok' },
      version: 1,
      schemaVersion: 1,
      agent: 'provider-session-1',
      sourceExecutionId: 'exec-1',
      parentReportId: null,
      ragEnabled: true,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: 'task-1',
          relation: ReportEntityRelation.Primary,
          createdAt: createdAt.toISOString(),
        },
      ],
      reportGuidance: { actions: [] },
    });
  });

  it('indexes one file-touch row per normalized IMPLEMENT report path idempotently', async () => {
    prisma.db.task.findFirst
      .mockResolvedValueOnce({
        id: 'task-1',
        type: 'STANDARD',
        parentTaskId: 'task-parent-1',
      })
      .mockResolvedValueOnce({
        id: 'task-parent-1',
        type: 'STANDARD',
        parentTaskId: 'feature-1',
      })
      .mockResolvedValueOnce({
        id: 'feature-1',
        type: 'FEATURE',
        parentTaskId: null,
      });
    prisma.db.fileTouchIndex.updateMany.mockResolvedValue({ count: 0 });
    prisma.db.fileTouchIndex.createMany.mockResolvedValue({ count: 2 });

    const result = await service.handleReportCreatedFileTouchIndex({
      payload: { report: buildImplementReport() },
    } as any);

    expect(result).toEqual({
      reportId: 'report-implement-1',
      status: 'indexed',
      indexedCount: 2,
    });
    expect(prisma.db.fileTouchIndex.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'project-1',
          serviceId: 'service-1',
          featureId: 'feature-1',
          attachedEntityType: 'TASK',
          attachedEntityId: 'task-1',
          reportId: 'report-implement-1',
          agentSessionId: 'agent-session-1',
          normalizedPath: 'src/services/reports/report.service.ts',
        }),
        expect.objectContaining({
          normalizedPath: 'src/controllers/report.controller.ts',
        }),
      ],
      skipDuplicates: true,
    });
    expect(prisma.db.fileTouchIndex.updateMany).toHaveBeenCalledWith({
      where: {
        reportId: 'report-implement-1',
        normalizedPath: {
          in: [
            'src/services/reports/report.service.ts',
            'src/controllers/report.controller.ts',
          ],
        },
        featureId: null,
      },
      data: { featureId: 'feature-1' },
    });
    expect(prisma.db.task.findFirst).toHaveBeenCalledTimes(3);
  });

  it('ignores non-IMPLEMENT reports for file-touch indexing', async () => {
    const result = await service.handleReportCreatedFileTouchIndex({
      payload: {
        report: buildImplementReport({
          reportType: ReportType.Plan,
          payload: { reportType: 'PLAN', summary: 'Plan report.' },
        }),
      },
    } as any);

    expect(result).toEqual({
      reportId: 'report-implement-1',
      status: 'skipped',
      indexedCount: 0,
      reason: 'not an IMPLEMENT report',
    });
    expect(prisma.db.fileTouchIndex.createMany).not.toHaveBeenCalled();
  });

  it('visibly skips IMPLEMENT reports missing service context', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({ serviceId: null });

    const result = await service.handleReportCreatedFileTouchIndex({
      payload: {
        report: buildImplementReport({
          entities: [
            {
              entityType: ReportRelatedEntityType.Task,
              entityId: 'task-1',
              relation: ReportEntityRelation.Primary,
              createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
            },
            {
              entityType: ReportRelatedEntityType.AgentSession,
              entityId: 'agent-session-1',
              relation: ReportEntityRelation.Context,
              createdAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
            },
          ],
        }),
      },
    } as any);

    expect(result).toEqual({
      reportId: 'report-implement-1',
      status: 'skipped',
      indexedCount: 0,
      reason: 'missing service context',
    });
    expect(prisma.db.fileTouchIndex.createMany).not.toHaveBeenCalled();
  });

  it('indexes task-owned reports with no feature ancestor using null feature attribution', async () => {
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'task-1',
      type: 'STANDARD',
      parentTaskId: null,
    });
    prisma.db.fileTouchIndex.createMany.mockResolvedValue({ count: 2 });

    const result = await service.handleReportCreatedFileTouchIndex({
      payload: { report: buildImplementReport() },
    } as any);

    expect(result).toEqual({
      reportId: 'report-implement-1',
      status: 'indexed',
      indexedCount: 2,
    });
    expect(prisma.db.fileTouchIndex.updateMany).not.toHaveBeenCalled();
    expect(prisma.db.fileTouchIndex.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          featureId: null,
          attachedEntityType: 'TASK',
          attachedEntityId: 'task-1',
        }),
        expect.objectContaining({ featureId: null }),
      ],
      skipDuplicates: true,
    });
  });

  it('populates missing feature attribution without duplicating existing facts', async () => {
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'feature-1',
      type: 'FEATURE',
      parentTaskId: null,
    });
    prisma.db.fileTouchIndex.updateMany.mockResolvedValue({ count: 2 });
    prisma.db.fileTouchIndex.createMany.mockResolvedValue({ count: 0 });

    const result = await service.handleReportCreatedFileTouchIndex({
      payload: { report: buildImplementReport() },
    } as any);

    expect(result).toEqual({
      reportId: 'report-implement-1',
      status: 'indexed',
      indexedCount: 2,
    });
    expect(prisma.db.fileTouchIndex.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('backfills standalone-task IMPLEMENT reports through the same indexing path', async () => {
    const createdAt = new Date('2026-07-09T00:00:00.000Z');
    prisma.db.report.findMany.mockResolvedValue([
      {
        ...buildImplementReport({
          createdAt,
          expiresAt: new Date('2026-08-09T00:00:00.000Z'),
        }),
        createdAt,
        expiresAt: new Date('2026-08-09T00:00:00.000Z'),
        reportEntities: buildImplementReport().entities.map((entity) => ({
          ...entity,
          createdAt,
        })),
      },
    ]);
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'task-1',
      type: 'STANDARD',
      parentTaskId: null,
    });
    prisma.db.fileTouchIndex.createMany.mockResolvedValue({ count: 2 });

    const result = await service.backfillFileTouchIndex({
      organizationId: 'org-1',
      projectId: 'project-1',
      limit: 10,
    });

    expect(prisma.db.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportType: 'IMPLEMENT' }),
        take: 10,
      }),
    );
    expect(result.processed).toBe(1);
    expect(result.indexed).toBe(1);
    expect(prisma.db.fileTouchIndex.updateMany).not.toHaveBeenCalled();
    expect(prisma.db.fileTouchIndex.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            featureId: null,
            attachedEntityType: 'TASK',
            attachedEntityId: 'task-1',
          }),
        ]),
      }),
    );
  });

  it('answers file-to-work lookups from the persisted index', async () => {
    const createdAt = new Date('2026-07-09T00:00:00.000Z');
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      {
        id: 'touch-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-1',
        reportId: 'report-1',
        agentSessionId: 'agent-session-1',
        normalizedPath: 'src/index.ts',
        createdAt,
      },
    ]);

    const result = await service.listFileTouchesByFile({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      serviceId: 'service-1',
      path: './src/index.ts',
    });

    expect(prisma.db.fileTouchIndex.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        normalizedPath: 'src/index.ts',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result.entries).toEqual([
      expect.objectContaining({
        id: 'touch-1',
        attachedEntityType: ReportRelatedEntityType.Task,
        normalizedPath: 'src/index.ts',
      }),
    ]);
  });

  it('answers work-to-file lookups from the persisted index', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      {
        serviceId: 'service-1',
        normalizedPath: 'src/index.ts',
      },
    ]);
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', name: 'API Service' },
    ]);

    const result = await service.listFileTouchesByWork({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      entityType: ReportRelatedEntityType.Task,
      entityId: 'task-1',
      serviceId: 'service-1',
    });

    expect(prisma.db.fileTouchIndex.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        projectId: 'project-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-1',
        serviceId: 'service-1',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.db.service.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: { in: ['service-1'] },
      },
      select: { id: true, name: true },
    });
    expect(result).toEqual({
      candidates: [
        {
          serviceId: 'service-1',
          serviceName: 'API Service',
          normalizedPath: 'src/index.ts',
        },
      ],
    });
  });

  it('rejects a non-task direct lookup entity type', async () => {
    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.DesignDoc,
        entityId: 'doc-1',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.db.fileTouchIndex.findMany).not.toHaveBeenCalled();
  });

  it('surfaces an unresolved service identity instead of using the service ID as a label', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      {
        serviceId: 'service-missing',
        normalizedPath: 'src/index.ts',
      },
    ]);
    prisma.db.service.findMany.mockResolvedValue([]);

    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
      }),
    ).rejects.toThrow('Unable to resolve service identity');
  });

  it('preserves the indexed normalized path in task candidates', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      {
        serviceId: 'service-1',
        normalizedPath: 'src/services/reports/report.service.ts',
      },
    ]);
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', name: 'API Service' },
    ]);

    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
      }),
    ).resolves.toEqual({
      candidates: [
        {
          serviceId: 'service-1',
          serviceName: 'API Service',
          normalizedPath: 'src/services/reports/report.service.ts',
        },
      ],
    });
  });

  it('answers feature lookups from direct persisted feature attribution', async () => {
    const createdAt = new Date('2026-07-09T00:00:00.000Z');
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      {
        id: 'touch-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-1',
        reportId: 'report-1',
        agentSessionId: 'agent-session-1',
        normalizedPath: 'src/index.ts',
        createdAt,
      },
      {
        id: 'touch-2',
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-2',
        reportId: 'report-2',
        agentSessionId: 'agent-session-2',
        normalizedPath: 'src/index.ts',
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      },
      {
        id: 'touch-3',
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-2',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-3',
        reportId: 'report-3',
        agentSessionId: 'agent-session-3',
        normalizedPath: 'src/index.ts',
        createdAt: new Date('2026-07-07T00:00:00.000Z'),
      },
      {
        id: 'touch-4',
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
        attachedEntityId: 'task-4',
        reportId: 'report-4',
        agentSessionId: 'agent-session-4',
        normalizedPath: 'src/normalized.ts',
        createdAt: new Date('2026-07-06T00:00:00.000Z'),
      },
    ]);
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', name: 'API Service' },
      { id: 'service-2', name: 'Worker Service' },
    ]);

    const result = await service.listFileTouchesByWork({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      featureId: 'feature-1',
    });

    expect(prisma.db.fileTouchIndex.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        projectId: 'project-1',
        featureId: 'feature-1',
        attachedEntityType: 'TASK',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.db.service.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: { in: ['service-1', 'service-2'] },
      },
      select: { id: true, name: true },
    });
    expect(result).toEqual({
      candidates: [
        {
          serviceId: 'service-1',
          serviceName: 'API Service',
          normalizedPath: 'src/index.ts',
        },
        {
          serviceId: 'service-2',
          serviceName: 'Worker Service',
          normalizedPath: 'src/index.ts',
        },
        {
          serviceId: 'service-1',
          serviceName: 'API Service',
          normalizedPath: 'src/normalized.ts',
        },
      ],
    });
  });

  it('rejects ambiguous or incomplete file-touch lookup modes', async () => {
    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.listFileTouchesByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
        featureId: 'feature-1',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.db.fileTouchIndex.findMany).not.toHaveBeenCalled();
  });

  it.each(['STANDARD', 'BUG'])(
    'returns flat, deduplicated production history for a focal %s',
    async (taskType) => {
      prisma.db.task.findFirst.mockResolvedValue({
        id: 'task-1',
        type: taskType,
      });
      prisma.db.fileTouchIndex.findMany.mockResolvedValue([
        buildFileTouchRow(),
        buildFileTouchRow({
          id: 'touch-2',
          reportId: 'report-2',
          agentSessionId: 'agent-session-2',
          createdAt: new Date('2026-07-08T00:00:00.000Z'),
        }),
      ]);
      prisma.db.service.findMany.mockResolvedValue([
        { id: 'service-1', name: 'API Service' },
      ]);

      const result = await service.listFileHistoryByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
      });

      expect(prisma.db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          archivedAt: null,
          type: { in: ['STANDARD', 'BUG'] },
        },
        select: { id: true, type: true },
      });
      expect(result).toEqual({
        kind: 'task',
        files: [
          {
            serviceId: 'service-1',
            serviceName: 'API Service',
            normalizedPath: 'src/index.ts',
          },
        ],
      });
    },
  );

  it('expands production Feature history recursively and deduplicates only within each direct-owner section', async () => {
    prisma.db.$queryRaw.mockResolvedValue([
      { id: 'feature-1' },
      { id: 'feature-2' },
      { id: 'feature-3' },
    ]);
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      buildFileTouchRow(),
      buildFileTouchRow({
        id: 'touch-2',
        reportId: 'report-2',
        featureId: 'feature-1',
      }),
      buildFileTouchRow({
        id: 'touch-3',
        reportId: 'report-3',
        featureId: 'feature-2',
        attachedEntityId: 'task-2',
      }),
      buildFileTouchRow({
        id: 'touch-4',
        reportId: 'report-4',
        featureId: 'feature-3',
        attachedEntityId: 'task-3',
        normalizedPath: 'src/child.ts',
      }),
    ]);
    prisma.db.task.findMany.mockResolvedValue([
      { id: 'feature-root', name: 'Features', parentTaskId: null },
      {
        id: 'feature-1',
        name: 'Work Item Page',
        parentTaskId: 'feature-root',
      },
      {
        id: 'feature-2',
        name: 'Child feature',
        parentTaskId: 'feature-1',
      },
      {
        id: 'feature-3',
        name: 'Grandchild feature',
        parentTaskId: 'feature-2',
      },
    ]);
    prisma.db.service.findMany.mockResolvedValue([
      { id: 'service-1', name: 'API Service' },
    ]);

    const result = await service.listFileHistoryByWork({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      featureId: 'feature-1',
    });

    expect(prisma.db.fileTouchIndex.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        projectId: 'project-1',
        attachedEntityType: 'TASK',
        featureId: { in: ['feature-1', 'feature-2', 'feature-3'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      kind: 'feature',
      sections: [
        {
          featureId: 'feature-1',
          featureName: 'Work Item Page',
          featurePath: 'Features / Work Item Page',
          files: [
            {
              serviceId: 'service-1',
              serviceName: 'API Service',
              normalizedPath: 'src/index.ts',
            },
          ],
        },
        {
          featureId: 'feature-2',
          featureName: 'Child feature',
          featurePath: 'Features / Work Item Page / Child feature',
          files: [
            {
              serviceId: 'service-1',
              serviceName: 'API Service',
              normalizedPath: 'src/index.ts',
            },
          ],
        },
        {
          featureId: 'feature-3',
          featureName: 'Grandchild feature',
          featurePath:
            'Features / Work Item Page / Child feature / Grandchild feature',
          files: [
            {
              serviceId: 'service-1',
              serviceName: 'API Service',
              normalizedPath: 'src/child.ts',
            },
          ],
        },
      ],
    });
  });

  it('rejects ambiguous production work-history modes before loading evidence', async () => {
    await expect(
      service.listFileHistoryByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listFileHistoryByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
        featureId: 'feature-1',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.db.fileTouchIndex.findMany).not.toHaveBeenCalled();
  });

  it('fails production work history when a required service identity cannot be resolved', async () => {
    prisma.db.task.findFirst.mockResolvedValue({
      id: 'task-1',
      type: 'STANDARD',
    });
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      buildFileTouchRow({ serviceId: 'service-missing' }),
    ]);
    prisma.db.service.findMany.mockResolvedValue([]);

    await expect(
      service.listFileHistoryByWork({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        entityType: ReportRelatedEntityType.Task,
        entityId: 'task-1',
      }),
    ).rejects.toThrow('Unable to resolve service identity');
  });

  it('groups normalized reverse history once per task with nullable standalone attribution and ordered evidence', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      buildFileTouchRow({
        id: 'touch-3',
        attachedEntityId: 'task-2',
        featureId: null,
        reportId: 'report-3',
        agentSessionId: 'agent-session-3',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      }),
      buildFileTouchRow({
        id: 'touch-2',
        reportId: 'report-2',
        agentSessionId: 'agent-session-2',
        createdAt: new Date('2026-07-09T00:00:00.000Z'),
      }),
      buildFileTouchRow({
        id: 'touch-1',
        reportId: 'report-1',
        agentSessionId: 'agent-session-1',
        featureId: 'feature-old',
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ]);
    prisma.db.task.findMany
      .mockResolvedValueOnce([
        { id: 'task-1', name: 'Standard task', type: 'STANDARD' },
        { id: 'task-2', name: 'Standalone bug', type: 'BUG' },
      ])
      .mockResolvedValueOnce([{ id: 'feature-1', name: 'Work Item Page' }]);
    prisma.db.agentSession.findMany.mockResolvedValue([
      { id: 'agent-session-1', title: 'Initial implementation' },
      { id: 'agent-session-2', title: 'Follow-up implementation' },
      { id: 'agent-session-3', title: 'Standalone bug fix' },
    ]);

    const result = await service.listFileHistoryByFile({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      serviceId: 'service-1',
      path: './src\\index.ts',
    });

    expect(prisma.db.fileTouchIndex.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        projectId: 'project-1',
        serviceId: 'service-1',
        normalizedPath: 'src/index.ts',
        attachedEntityType: 'TASK',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.db.task.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ['feature-1'] },
        organizationId: 'org-1',
        projectId: 'project-1',
        type: 'FEATURE',
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    expect(result).toEqual({
      tasks: [
        {
          taskId: 'task-2',
          taskName: 'Standalone bug',
          taskType: 'BUG',
          directFeatureId: null,
          directFeatureName: null,
          touchCount: 1,
          firstTouchedAt: '2026-07-10T00:00:00.000Z',
          lastTouchedAt: '2026-07-10T00:00:00.000Z',
          evidence: [
            {
              reportId: 'report-3',
              agentSessionId: 'agent-session-3',
              agentSessionTitle: 'Standalone bug fix',
              createdAt: '2026-07-10T00:00:00.000Z',
            },
          ],
        },
        {
          taskId: 'task-1',
          taskName: 'Standard task',
          taskType: 'STANDARD',
          directFeatureId: 'feature-1',
          directFeatureName: 'Work Item Page',
          touchCount: 2,
          firstTouchedAt: '2026-07-08T00:00:00.000Z',
          lastTouchedAt: '2026-07-09T00:00:00.000Z',
          evidence: [
            {
              reportId: 'report-1',
              agentSessionId: 'agent-session-1',
              agentSessionTitle: 'Initial implementation',
              createdAt: '2026-07-08T00:00:00.000Z',
            },
            {
              reportId: 'report-2',
              agentSessionId: 'agent-session-2',
              agentSessionTitle: 'Follow-up implementation',
              createdAt: '2026-07-09T00:00:00.000Z',
            },
          ],
        },
      ],
    });
  });

  it('fails reverse history when indexed evidence cannot resolve an active task', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([buildFileTouchRow()]);
    prisma.db.task.findMany.mockResolvedValue([]);

    await expect(
      service.listFileHistoryByFile({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
        path: 'src/index.ts',
      }),
    ).rejects.toThrow('Unable to resolve active task identity');
  });

  it('fails reverse history when evidence cannot resolve its agent session title', async () => {
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([buildFileTouchRow()]);
    prisma.db.task.findMany
      .mockResolvedValueOnce([
        { id: 'task-1', name: 'Standard task', type: 'STANDARD' },
      ])
      .mockResolvedValueOnce([{ id: 'feature-1', name: 'Work Item Page' }]);
    prisma.db.agentSession.findMany.mockResolvedValue([]);

    await expect(
      service.listFileHistoryByFile({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
        path: 'src/index.ts',
      }),
    ).rejects.toThrow('Unable to resolve agent session identity');
  });

  it.each([
    [
      FileTouchServiceHistorySortBy.NormalizedPath,
      FileTouchServiceHistorySortOrder.Asc,
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    ],
    [
      FileTouchServiceHistorySortBy.LastTouchedAt,
      FileTouchServiceHistorySortOrder.Desc,
      ['src/c.ts', 'src/a.ts', 'src/b.ts'],
    ],
    [
      FileTouchServiceHistorySortBy.TouchCount,
      FileTouchServiceHistorySortOrder.Desc,
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    ],
  ])(
    'deduplicates, filters, and sorts service history by %s %s before cursoring',
    async (sortBy, sortOrder, expectedPaths) => {
      prisma.db.service.findFirst.mockResolvedValue({
        id: 'service-1',
        name: 'API Service',
      });
      prisma.db.fileTouchIndex.findMany.mockResolvedValue([
        buildFileTouchRow({
          id: 'touch-c',
          normalizedPath: 'src/c.ts',
          attachedEntityId: 'task-2',
          agentSessionId: 'session-2',
          reportId: 'report-c',
          createdAt: new Date('2026-08-03T00:00:00.000Z'),
        }),
        buildFileTouchRow({
          id: 'touch-a-new',
          normalizedPath: 'src/a.ts',
          agentSessionId: 'session-1',
          reportId: 'report-a-new',
          createdAt: new Date('2026-08-02T00:00:00.000Z'),
        }),
        buildFileTouchRow({
          id: 'touch-a-old',
          normalizedPath: 'src/a.ts',
          agentSessionId: 'session-3',
          reportId: 'report-a-old',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
        buildFileTouchRow({
          id: 'touch-b',
          normalizedPath: 'src/b.ts',
          agentSessionId: 'session-1',
          reportId: 'report-b',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
        buildFileTouchRow({
          id: 'touch-archived',
          normalizedPath: 'src/archived.ts',
          attachedEntityId: 'task-archived',
        }),
      ]);
      prisma.db.task.findMany.mockResolvedValue([
        { id: 'task-1', name: 'First task', type: 'STANDARD' },
        { id: 'task-2', name: 'Second task', type: 'BUG' },
      ]);
      prisma.db.agentSession.findMany.mockResolvedValue([
        { id: 'session-1', title: 'Implementation session' },
        { id: 'session-2', title: 'Bug fix session' },
      ]);

      const result = await service.listFileHistoryByService({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
        pathFilter: 'SRC/',
        sortBy,
        sortOrder,
        limit: 10,
      });

      expect(result.files.map((file) => file.normalizedPath)).toEqual(
        expectedPaths,
      );
      expect(
        result.files.find((file) => file.normalizedPath === 'src/a.ts'),
      ).toEqual(
        expect.objectContaining({
          touchCount: 2,
          firstTouchedAt: '2026-08-01T00:00:00.000Z',
          lastTouchedAt: '2026-08-02T00:00:00.000Z',
          latestTaskName: 'First task',
          latestAgentSessionTitle: 'Implementation session',
          latestReportId: 'report-a-new',
        }),
      );
      expect(result.nextCursor).toBeNull();
    },
  );

  it('returns a stable opaque next cursor and rejects malformed or mismatched cursors', async () => {
    prisma.db.service.findFirst.mockResolvedValue({
      id: 'service-1',
      name: 'API Service',
    });
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([
      buildFileTouchRow({ normalizedPath: 'src/a.ts' }),
      buildFileTouchRow({
        id: 'touch-2',
        normalizedPath: 'src/b.ts',
        reportId: 'report-2',
      }),
    ]);
    prisma.db.task.findMany.mockResolvedValue([
      { id: 'task-1', name: 'First task', type: 'STANDARD' },
    ]);
    prisma.db.agentSession.findMany.mockResolvedValue([
      { id: 'agent-session-1', title: 'Implementation session' },
    ]);

    const first = await service.listFileHistoryByService({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      serviceId: 'service-1',
      sortBy: FileTouchServiceHistorySortBy.NormalizedPath,
      sortOrder: FileTouchServiceHistorySortOrder.Asc,
      limit: 1,
    });
    expect(first.files.map((file) => file.normalizedPath)).toEqual([
      'src/a.ts',
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.listFileHistoryByService({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      serviceId: 'service-1',
      sortBy: FileTouchServiceHistorySortBy.NormalizedPath,
      sortOrder: FileTouchServiceHistorySortOrder.Asc,
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    });
    expect(second.files.map((file) => file.normalizedPath)).toEqual([
      'src/b.ts',
    ]);
    expect(second.nextCursor).toBeNull();

    await expect(
      service.listFileHistoryByService({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
        cursor: 'not-a-cursor',
      }),
    ).rejects.toThrow('cursor is invalid');
    await expect(
      service.listFileHistoryByService({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
        sortBy: FileTouchServiceHistorySortBy.TouchCount,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toThrow('cursor does not match');
  });

  it('returns an empty service-history page without loading task or session identities', async () => {
    prisma.db.service.findFirst.mockResolvedValue({
      id: 'service-1',
      name: 'API Service',
    });
    prisma.db.fileTouchIndex.findMany.mockResolvedValue([]);

    await expect(
      service.listFileHistoryByService({
        organizationId: 'org-1' as any,
        projectId: 'project-1',
        serviceId: 'service-1',
      }),
    ).resolves.toEqual({ files: [], nextCursor: null });
    expect(prisma.db.task.findMany).not.toHaveBeenCalled();
    expect(prisma.db.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('returns reportGuidance from the active EXTERNAL_AGENT node for create responses', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.create as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'ok' },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [],
    });
    flowExecutionService.findActiveByConversation.mockResolvedValue({
      id: 'flow-exec-1',
      flowId: 'plan-shaping',
      currentNode: 'shape-plan',
    });
    nodeExecutionService.getNode.mockReturnValue({
      node: {
        type: NodeType.EXTERNAL_AGENT,
        actions: { continue: {}, revise: {} },
      },
      routing: {},
    });

    const result = await service.create(
      'org-1' as any,
      {
        projectId: 'project-1',
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: 'analysis',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
        sourceExecutionId: 'exec-1',
      },
      'conversation-1',
    );

    expect(result.reportGuidance).toEqual({
      actions: ['continue', 'revise'],
    });
    expect(flowExecutionService.findActiveByConversation).toHaveBeenCalledWith(
      'conversation-1',
      'org-1',
    );
    expect(nodeExecutionService.getNode).toHaveBeenCalledWith(
      'plan-shaping',
      'shape-plan',
    );
  });

  it('does not derive reportGuidance.actions from report payload options', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.create as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'DECISION_NEEDED',
      audience: 'WORKFLOW_ONLY',
      payload: {
        reportType: 'DECISION_NEEDED',
        summary: 'Need a decision.',
        question: 'Which path?',
        options: [{ description: 'Fast path' }],
      },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [],
    });
    flowExecutionService.findActiveByConversation.mockResolvedValue({
      id: 'flow-exec-1',
      flowId: 'plan-shaping',
      currentNode: 'generate-summary',
    });
    nodeExecutionService.getNode.mockReturnValue({
      node: { type: NodeType.GENERATE, actions: {} },
      routing: {},
    });

    const result = await service.create(
      'org-1' as any,
      {
        projectId: 'project-1',
        reportType: ReportType.DecisionNeeded,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'DECISION_NEEDED',
          summary: 'Need a decision.',
          question: 'Which path?',
          options: [{ description: 'Fast path' }],
        },
        sourceExecutionId: 'exec-1',
      },
      'conversation-1',
    );

    expect(result.reportGuidance).toEqual({
      actions: [],
    });
  });

  it('returns the canonical report without creating a message', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.create as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'ok' },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [],
    });

    const result = await service.create(
      'org-1' as any,
      {
        projectId: 'project-1',
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: 'analysis',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
        sourceExecutionId: 'exec-1',
      },
      'conversation-1',
    );

    expect(prisma.db.message.create).not.toHaveBeenCalled();
    expect(result.id).toBe('report-1');
    expect(result).not.toHaveProperty('messageId');
  });

  it.each([ReportType.CodingResearch, ReportType.Snapshot])(
    'persists reportType %s and skips report.created publish when project is missing',
    async (type) => {
      const createdAt = new Date('2026-02-16T22:30:00.000Z');
      const expiresAt = new Date('2026-03-18T22:30:00.000Z');
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: null,
        reportType: type,
        audience: 'WORKFLOW_ONLY',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        createdAt,
        expiresAt,
        reportEntities: [],
      });

      const result = await service.create(
        'org-1' as any,
        {
          reportType: type,
          audience: ReportAudience.WorkflowOnly,
          payload:
            type === ReportType.CodingResearch
              ? {
                  reportType: 'CODING_RESEARCH',
                  summary: 'ok',
                  analysis: 'analysis',
                  frame: {},
                  provenance: { discoveryCalls: [], edgesTraversed: [] },
                  updates: [],
                }
              : { reportType: 'SNAPSHOT', summary: 'ok' },
        } as CreateReportDto,
      );

      expect(prisma.db.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            reportType: type,
            audience: 'WORKFLOW_ONLY',
          }),
        }),
      );
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(result.reportType).toBe(type);
    },
  );

  it('round-trips a synthetic PHASE_GROUNDING payload through create + findOne unchanged', async () => {
    const createdAt = new Date('2026-05-26T22:30:00.000Z');
    const expiresAt = new Date('2026-06-25T22:30:00.000Z');
    const payload = {
      reportType: 'PHASE_GROUNDING' as const,
      summary:
        'Phase-grounding pre-flight committed to three touch points before execution began.',
      touchPoints: [
        {
          file: 'src/services/reports/report.service.ts',
          expectedOutcome:
            'Register PHASE_GROUNDING in reportTitleByType so getReportTitle resolves it.',
        },
        {
          file: 'src/services/reports/__tests__/report.service.test.ts',
          expectedOutcome:
            'Add round-trip coverage that a PHASE_GROUNDING payload survives create + findOne unchanged.',
          divergenceFromInitialPlan:
            'Plan called for a standalone test file; collapsed it into the existing suite instead.',
        },
      ],
      planAdjustment:
        'Pulled the migration ahead of the service edit to keep the parity test green during the change.',
    };

    const persistedRow = {
      id: 'report-pg-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'PHASE_GROUNDING',
      audience: 'WORKFLOW_ONLY',
      payload,
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: 'exec-pg-1',
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [],
    };

    (prisma.db.report.create as jest.Mock).mockResolvedValue(persistedRow);
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(persistedRow);

    const created = await service.create('org-1' as any, {
      projectId: 'project-1',
      reportType: ReportType.PhaseGrounding,
      audience: ReportAudience.ProjectVisible,
      payload,
      sourceExecutionId: 'exec-pg-1',
    });

    expect(prisma.db.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportType: 'PHASE_GROUNDING',
          audience: 'WORKFLOW_ONLY',
        }),
      }),
    );

    const fetched = await service.findOne('org-1' as any, created.id);

    expect(created.payload).toEqual(payload);
    expect(fetched.payload).toEqual(payload);
    expect(fetched.payload).toEqual(created.payload);
    expect(fetched.reportType).toBe(ReportType.PhaseGrounding);
    expect(fetched.title).toBe('Phase Grounding');
  });

  it('rejects invalid report type', async () => {
    await expect(
      service.create(
        'org-1' as any,
        {
          reportType: 'INVALID_REPORT_TYPE',
          audience: ReportAudience.WorkflowOnly,
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'ok',
            analysis: 'analysis',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
        } as unknown as CreateReportDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.db.report.create).not.toHaveBeenCalled();
  });

  it('rejects inconsistent entity filters in list', async () => {
    await expect(
      service.findAll('org-1' as any, {
        entityType: ReportRelatedEntityType.Task,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('findAll sort + limit', () => {
    it('defaults to createdAt desc and the default list limit', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any);

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
    });

    it('honors explicit sortOrder=ASC with an explicit limit', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any, {
        sortBy: ReportSortBy.CreatedAt,
        sortOrder: ReportSortOrder.Asc,
        limit: 3,
      });

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
          take: 3,
        }),
      );
    });

    it('rejects an unsupported sortBy value', async () => {
      await expect(
        service.findAll('org-1' as any, {
          sortBy: 'updatedAt' as ReportSortBy,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });

    it('rejects an unsupported sortOrder value', async () => {
      await expect(
        service.findAll('org-1' as any, {
          sortOrder: 'sideways' as ReportSortOrder,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll reportTypes + offset', () => {
    it('translates reportTypes to a Prisma `in:` clause', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any, {
        reportTypes: [ReportType.Implement, ReportType.Plan],
      });

      const findManyArg = (prisma.db.report.findMany as jest.Mock).mock
        .calls[0]![0];
      expect(findManyArg.where.reportType).toEqual({
        in: [ReportType.Implement, ReportType.Plan],
      });
    });

    it('falls back to a single reportType clause when reportTypes is omitted', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any, {
        reportType: ReportType.Implement,
      });

      const findManyArg = (prisma.db.report.findMany as jest.Mock).mock
        .calls[0]![0];
      expect(findManyArg.where.reportType).toBe(ReportType.Implement);
    });

    it('forwards offset to findMany.skip', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any, { offset: 25 });

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25 }),
      );
    });

    it('defaults offset to 0 when not supplied', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any);

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('rejects a negative offset', async () => {
      await expect(
        service.findAll('org-1' as any, { offset: -1 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });

    it('rejects a non-integer offset', async () => {
      await expect(
        service.findAll('org-1' as any, { offset: 1.5 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid value inside reportTypes', async () => {
      await expect(
        service.findAll('org-1' as any, {
          reportTypes: ['NOT_A_REPORT_TYPE' as ReportType],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });

    it('populates linkedEntities on the read dto for reports with CONTEXT entities', async () => {
      const createdAt = new Date('2026-02-16T22:30:00.000Z');
      const expiresAt = new Date('2026-03-18T22:30:00.000Z');
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'report-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          reportType: 'IMPLEMENT',
          audience: 'PROJECT_VISIBLE',
          payload: { summary: 'ok' },
          version: 1,
          schemaVersion: 1,
          sourceExecutionId: null,
          parentReportId: null,
          createdAt,
          expiresAt,
          reportEntities: [
            {
              id: 'ent-1',
              entityType: 'TASK',
              entityId: 'task-1',
              relation: 'PRIMARY',
              createdAt,
            },
            {
              id: 'ent-2',
              entityType: 'TASK',
              entityId: 'task-2',
              relation: 'CONTEXT',
              createdAt,
            },
          ],
        },
        {
          id: 'report-2',
          organizationId: 'org-1',
          projectId: 'project-1',
          reportType: 'IMPLEMENT',
          audience: 'PROJECT_VISIBLE',
          payload: { summary: 'ok' },
          version: 1,
          schemaVersion: 1,
          sourceExecutionId: null,
          parentReportId: null,
          createdAt,
          expiresAt,
          reportEntities: [
            {
              id: 'ent-3',
              entityType: 'TASK',
              entityId: 'task-only-primary',
              relation: 'PRIMARY',
              createdAt,
            },
          ],
        },
      ]);

      const results = await service.findAll('org-1' as any, {
        projectId: 'project-1',
        reportTypes: [ReportType.Implement],
      });

      expect(results[0]!.linkedEntities).toEqual([
        { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
      ]);
      expect(results[1]!.linkedEntities).toBeUndefined();
    });
  });

  it('builds coding research entities with optional plan context', async () => {
    const createSpy = jest.spyOn(service, 'create').mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.WorkflowOnly,
      title: 'Coding Research',
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'Research stub.',
        analysis: 'analysis',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
      version: 1,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      entities: [],
      reportGuidance: { actions: [] },
    });

    await service.createCodingResearchReport({
      organizationId: 'org-1' as any,
      projectId: 'project-1',
      sourceExecutionId: 'exec-1',
      audience: ReportAudience.WorkflowOnly,
      payload: { summary: 'research complete' },
      taskId: 'task-1',
      planId: 'plan-1',
    });

    expect(createSpy).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        sourceExecutionId: 'exec-1',
        entities: [
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'task-1',
            relation: ReportEntityRelation.Primary,
          },
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'plan-1',
            relation: ReportEntityRelation.Context,
          },
        ],
      }),
    );
  });

  it('deletes expired reports in batches', async () => {
    (prisma.db.report.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'report-1' }, { id: 'report-2' }])
      .mockResolvedValueOnce([]);
    (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
      count: 2,
    });

    const deletedCount = await service.deleteExpiredReports(100);

    expect(prisma.db.report.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['report-1', 'report-2'] } },
    });
    expect(deletedCount).toBe(2);
  });

  it('updates a report and increments version automatically', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
      id: 'report-1',
      reportType: 'CODING_RESEARCH',
    });
    (prisma.db.report.update as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'updated' },
      version: 2,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      createdAt,
      expiresAt,
      reportEntities: [],
    });

    const result = await service.update('org-1' as any, 'report-1', {
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'updated',
        analysis: 'analysis',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
    });

    expect(prisma.db.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'report-1' },
        data: expect.objectContaining({
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'updated',
            analysis: 'analysis',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
          version: { increment: 1 },
        }),
      }),
    );
    expect(result.version).toBe(2);
  });

  it('keeps PHASE_GROUNDING reports workflow-only across updates', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
      id: 'report-phase-grounding-1',
      reportType: 'PHASE_GROUNDING',
      payload: {
        reportType: 'PHASE_GROUNDING',
        summary: 'old grounding',
      },
    });
    (prisma.db.report.update as jest.Mock).mockResolvedValue({
      id: 'report-phase-grounding-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'PHASE_GROUNDING',
      audience: 'WORKFLOW_ONLY',
      payload: {
        reportType: 'PHASE_GROUNDING',
        summary: 'updated grounding',
        touchPoints: [],
      },
      version: 2,
      schemaVersion: 1,
      sourceExecutionId: 'exec-pg-1',
      createdAt,
      expiresAt,
      reportEntities: [],
    });

    await service.update('org-1' as any, 'report-phase-grounding-1', {
      audience: ReportAudience.ProjectVisible,
      payload: {
        reportType: 'PHASE_GROUNDING',
        summary: 'updated grounding',
        touchPoints: [],
      },
    });

    expect(prisma.db.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ audience: 'WORKFLOW_ONLY' }),
      }),
    );
  });

  it('preserves stored report agent metadata across payload-only updates', async () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
      reportType: 'CODING_RESEARCH',
      id: 'report-1',
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'old',
        __reportEnvelope: { agent: 'provider-session-1' },
      },
    });
    (prisma.db.report.update as jest.Mock).mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'updated',
        __reportEnvelope: { agent: 'provider-session-1' },
      },
      version: 2,
      schemaVersion: 1,
      sourceExecutionId: 'exec-1',
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [],
    });

    const result = await service.update('org-1' as any, 'report-1', {
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'updated',
        analysis: 'analysis',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
    });

    expect(prisma.db.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            summary: 'updated',
            __reportEnvelope: { agent: 'provider-session-1' },
          }),
        }),
      }),
    );
    expect(result.agent).toBe('provider-session-1');
    expect(result.payload).toEqual({
      reportType: 'CODING_RESEARCH',
      summary: 'updated',
    });
  });

  it('throws not found on remove when report does not exist', async () => {
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.remove('org-1' as any, 'report-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('goalAnchor invariant', () => {
    const GOAL_ID = 'goal-id-1';
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');

    const goalProgressDto = (
      projectId: string | undefined,
      anchorEntityType: string = 'GOAL',
    ) => ({
      ...(projectId ? { projectId } : {}),
      reportType: ReportType.GoalProgress,
      audience: ReportAudience.WorkflowOnly,
      payload: {
        reportType: 'GOAL_PROGRESS',
        summary: 'Goal progressing.',
        text: 'Trending up.',
        goalAnchor: { entityType: anchorEntityType, entityId: GOAL_ID },
      } as any,
    });

    const stubReportCreate = () => {
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'GOAL_PROGRESS',
        audience: 'WORKFLOW_ONLY',
        payload: {},
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [],
      });
    };

    it('accepts a goalAnchor when the goal is in the same project', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: 'GOAL',
        projectId: 'project-1',
      });
      stubReportCreate();

      await expect(
        service.create('org-1' as any, goalProgressDto('project-1')),
      ).resolves.toMatchObject({ id: 'report-1' });

      expect(prisma.db.task.findFirst).toHaveBeenCalledWith({
        where: { id: GOAL_ID, organizationId: 'org-1', archivedAt: null },
        select: { id: true, type: true, projectId: true },
      });
      expect(prisma.db.report.create).toHaveBeenCalled();
    });

    it('rejects a goalAnchor when the goal belongs to a different project', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: 'GOAL',
        projectId: 'project-2',
      });

      await expect(
        service.create('org-1' as any, goalProgressDto('project-1')),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.create).not.toHaveBeenCalled();
    });

    it('rejects a goalAnchor whose task is not GOAL-typed', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: 'STANDARD',
        projectId: 'project-1',
      });

      await expect(
        service.create('org-1' as any, goalProgressDto('project-1')),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.create).not.toHaveBeenCalled();
    });

    it('accepts a GOAL_PROGRESS report when no goalAnchor is supplied', async () => {
      stubReportCreate();

      await expect(
        service.create('org-1' as any, {
          projectId: 'project-1',
          reportType: ReportType.GoalProgress,
          audience: ReportAudience.WorkflowOnly,
          payload: {
            reportType: 'GOAL_PROGRESS',
            summary: 'Goal progressing.',
            text: 'Trending up.',
          } as any,
        }),
      ).resolves.toMatchObject({ id: 'report-1' });

      expect(prisma.db.task.findFirst).not.toHaveBeenCalled();
      expect(prisma.db.report.create).toHaveBeenCalled();
    });
  });

  describe('parentReportId', () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');

    it('creates a report with a valid parentReportId', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
        id: 'parent-1',
      });
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'child-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'CODING_RESEARCH',
        audience: 'WORKFLOW_ONLY',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: 'parent-1',
        createdAt,
        expiresAt,
        reportEntities: [],
      });

      const result = await service.create('org-1' as any, {
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: 'analysis',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
        parentReportId: 'parent-1',
      });

      expect(prisma.db.report.findFirst).toHaveBeenCalledWith({
        where: { id: 'parent-1', organizationId: 'org-1' },
        select: { id: true },
      });
      expect(prisma.db.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parentReportId: 'parent-1',
          }),
        }),
      );
      expect(result.parentReportId).toBe('parent-1');
    });

    it('throws 404 when creating with nonexistent parentReportId', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create('org-1' as any, {
          reportType: ReportType.CodingResearch,
          audience: ReportAudience.WorkflowOnly,
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'ok',
            analysis: 'analysis',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
          parentReportId: 'nonexistent',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.db.report.create).not.toHaveBeenCalled();
    });

    it('filters reports by parentReportId', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll('org-1' as any, {
        parentReportId: 'parent-1',
      });

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentReportId: 'parent-1',
          }),
        }),
      );
    });

    it('validates parentReportId on update', async () => {
      (prisma.db.report.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: 'report-1',
          reportType: 'CODING_RESEARCH',
        })
        .mockResolvedValueOnce({ id: 'parent-1' });
      (prisma.db.report.update as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: null,
        reportType: 'CODING_RESEARCH',
        audience: 'WORKFLOW_ONLY',
        payload: { summary: 'ok' },
        version: 2,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: 'parent-1',
        createdAt,
        expiresAt,
        reportEntities: [],
      });

      const result = await service.update('org-1' as any, 'report-1', {
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: 'analysis',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
        parentReportId: 'parent-1',
      });

      expect(result.parentReportId).toBe('parent-1');
    });

    it('throws 404 when updating with nonexistent parentReportId', async () => {
      (prisma.db.report.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: 'report-1',
          reportType: 'CODING_RESEARCH',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.update('org-1' as any, 'report-1', {
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'ok',
            analysis: 'analysis',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
          parentReportId: 'nonexistent',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.db.report.update).not.toHaveBeenCalled();
    });

    it('rejects self-referential parentReportId on update', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
        id: 'report-1',
      });

      await expect(
        service.update('org-1' as any, 'report-1', {
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'ok',
            analysis: 'analysis',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
          parentReportId: 'report-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.update).not.toHaveBeenCalled();
    });
  });

  describe('entity name resolution', () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');

    const mockReport = {
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'ok' },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      createdAt,
      expiresAt,
      reportEntities: [
        {
          id: 'ent-1',
          entityType: 'TASK',
          entityId: 'task-1',
          relation: 'PRIMARY',
          createdAt,
        },
        {
          id: 'ent-2',
          entityType: 'DESIGN_DOC',
          entityId: 'dd-1',
          relation: 'CONTEXT',
          createdAt,
        },
      ],
    };

    it('populates displayName on entities from the registry', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(mockReport);
      entityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: 'task-1',
          entityType: 'TASK',
          entityName: 'Implement auth',
        },
        {
          entityId: 'dd-1',
          entityType: 'DESIGN_DOC',
          entityName: 'Auth Design',
        },
      ]);

      const result = await service.findOne('org-1' as any, 'report-1');

      expect(entityRegistryService.getEntitiesByIds).toHaveBeenCalledWith({
        organizationId: 'org-1',
        entities: [
          { entityId: 'task-1', entityType: 'TASK' },
          { entityId: 'dd-1', entityType: 'DESIGN_DOC' },
        ],
      });
      expect(result.entities[0]!.displayName).toBe('Implement auth');
      expect(result.entities[1]!.displayName).toBe('Auth Design');
    });

    it('returns undefined displayName when registry has no name', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(mockReport);
      entityRegistryService.getEntitiesByIds.mockResolvedValue([
        { entityId: 'task-1', entityType: 'TASK', entityName: undefined },
      ]);

      const result = await service.findOne('org-1' as any, 'report-1');

      expect(result.entities[0]!.displayName).toBeUndefined();
      expect(result.entities[1]!.displayName).toBeUndefined();
    });

    it('gracefully handles registry failure without blocking report retrieval', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue(mockReport);
      entityRegistryService.getEntitiesByIds.mockRejectedValue(
        new Error('connection refused'),
      );

      const result = await service.findOne('org-1' as any, 'report-1');

      expect(result.id).toBe('report-1');
      expect(result.entities[0]!.displayName).toBeUndefined();
      expect(result.entities[1]!.displayName).toBeUndefined();
    });

    it('resolves names across multiple reports in findAll', async () => {
      const report2 = {
        ...mockReport,
        id: 'report-2',
        reportEntities: [
          {
            id: 'ent-3',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      };
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([
        mockReport,
        report2,
      ]);
      entityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: 'task-1',
          entityType: 'TASK',
          entityName: 'Implement auth',
        },
        {
          entityId: 'dd-1',
          entityType: 'DESIGN_DOC',
          entityName: 'Auth Design',
        },
      ]);

      const results = await service.findAll('org-1' as any);

      expect(entityRegistryService.getEntitiesByIds).toHaveBeenCalledTimes(1);
      expect(results[0]!.entities[0]!.displayName).toBe('Implement auth');
      expect(results[0]!.entities[1]!.displayName).toBe('Auth Design');
      expect(results[1]!.entities[0]!.displayName).toBe('Implement auth');
    });
  });

  describe('loadReportsForMessageIds', () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');

    const baseReport = {
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType: 'CODING_RESEARCH',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'ok' },
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      createdAt,
      expiresAt,
    };

    it('returns an empty map when no message ids are supplied (no DB hit)', async () => {
      const result = await service.loadReportsForMessageIds('org-1' as any, []);

      expect(result.size).toBe(0);
      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });

    it('groups reports by any linked message relation, scoped to the org', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([
        {
          ...baseReport,
          id: 'report-A',
          reportEntities: [
            {
              id: 'ent-A1',
              entityType: 'MESSAGE',
              entityId: 'msg-1',
              relation: 'CONTEXT',
              createdAt,
            },
          ],
        },
        {
          ...baseReport,
          id: 'report-B',
          reportEntities: [
            {
              id: 'ent-B1',
              entityType: 'MESSAGE',
              entityId: 'msg-2',
              relation: 'CONTEXT',
              createdAt,
            },
            {
              id: 'ent-B2',
              entityType: 'TASK',
              entityId: 'task-99',
              relation: 'PRIMARY',
              createdAt,
            },
          ],
        },
        {
          ...baseReport,
          id: 'report-C',
          reportEntities: [
            {
              id: 'ent-C1',
              entityType: 'MESSAGE',
              entityId: 'msg-3',
              relation: 'PRIMARY',
              createdAt,
            },
          ],
        },
      ]);

      const result = await service.loadReportsForMessageIds('org-1' as any, [
        'msg-1',
        'msg-2',
        'msg-3',
      ]);

      expect(prisma.db.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            reportEntities: {
              some: {
                entityType: 'MESSAGE',
                entityId: { in: ['msg-1', 'msg-2', 'msg-3'] },
              },
            },
          }),
        }),
      );
      expect(result.get('msg-1')?.map((r) => r.id)).toEqual(['report-A']);
      expect(result.get('msg-2')?.map((r) => r.id)).toEqual(['report-B']);
      expect(result.get('msg-3')?.map((r) => r.id)).toEqual(['report-C']);
    });

    it('places a single report in every requested message bucket it links to', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([
        {
          ...baseReport,
          id: 'report-X',
          reportEntities: [
            {
              id: 'ent-X1',
              entityType: 'MESSAGE',
              entityId: 'msg-1',
              relation: 'CONTEXT',
              createdAt,
            },
            {
              id: 'ent-X2',
              entityType: 'MESSAGE',
              entityId: 'msg-2',
              relation: 'CONTEXT',
              createdAt,
            },
            {
              id: 'ent-X3',
              entityType: 'MESSAGE',
              entityId: 'msg-not-requested',
              relation: 'CONTEXT',
              createdAt,
            },
          ],
        },
      ]);

      const result = await service.loadReportsForMessageIds('org-1' as any, [
        'msg-1',
        'msg-2',
      ]);

      expect(result.get('msg-1')?.map((r) => r.id)).toEqual(['report-X']);
      expect(result.get('msg-2')?.map((r) => r.id)).toEqual(['report-X']);
      expect(result.has('msg-not-requested')).toBe(false);
    });

    it('dedupes input messageIds when querying', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.loadReportsForMessageIds('org-1' as any, [
        'msg-1',
        'msg-1',
        'msg-2',
      ]);

      const findManyArg = (prisma.db.report.findMany as jest.Mock).mock
        .calls[0]![0];
      expect(findManyArg.where.reportEntities.some.entityId.in).toEqual([
        'msg-1',
        'msg-2',
      ]);
    });

    it('restricts the query to user-facing audiences (allow-list)', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.loadReportsForMessageIds('org-1' as any, ['msg-1']);

      const findManyArg = (prisma.db.report.findMany as jest.Mock).mock
        .calls[0]![0];
      expect(findManyArg.where.audience).toEqual({
        in: ['PROJECT_VISIBLE', 'ORGANIZATION_VISIBLE'],
      });
    });

    it('returns only user-facing reports in the per-message buckets when audiences are mixed', async () => {
      (prisma.db.report.findMany as jest.Mock).mockImplementation(
        ({ where }) => {
          const seeded = [
            {
              ...baseReport,
              id: 'report-internal',
              audience: 'WORKFLOW_ONLY',
              reportEntities: [
                {
                  id: 'ent-internal',
                  entityType: 'MESSAGE',
                  entityId: 'msg-1',
                  relation: 'CONTEXT',
                  createdAt,
                },
              ],
            },
            {
              ...baseReport,
              id: 'report-project',
              audience: 'PROJECT_VISIBLE',
              reportEntities: [
                {
                  id: 'ent-project',
                  entityType: 'MESSAGE',
                  entityId: 'msg-1',
                  relation: 'CONTEXT',
                  createdAt,
                },
              ],
            },
            {
              ...baseReport,
              id: 'report-org',
              audience: 'ORGANIZATION_VISIBLE',
              reportEntities: [
                {
                  id: 'ent-org',
                  entityType: 'MESSAGE',
                  entityId: 'msg-1',
                  relation: 'CONTEXT',
                  createdAt,
                },
              ],
            },
          ];
          return Promise.resolve(
            seeded.filter((r) => where.audience.in.includes(r.audience)),
          );
        },
      );

      const result = await service.loadReportsForMessageIds('org-1' as any, [
        'msg-1',
      ]);

      expect(result.get('msg-1')?.map((r) => r.id)).toEqual([
        'report-project',
        'report-org',
      ]);
    });

    it('produces no bucket for a message whose only linked report is WORKFLOW_ONLY', async () => {
      (prisma.db.report.findMany as jest.Mock).mockImplementation(
        ({ where }) => {
          const seeded = [
            {
              ...baseReport,
              id: 'report-internal',
              audience: 'WORKFLOW_ONLY',
              reportEntities: [
                {
                  id: 'ent-internal',
                  entityType: 'MESSAGE',
                  entityId: 'msg-1',
                  relation: 'CONTEXT',
                  createdAt,
                },
              ],
            },
          ];
          return Promise.resolve(
            seeded.filter((r) => where.audience.in.includes(r.audience)),
          );
        },
      );

      const result = await service.loadReportsForMessageIds('org-1' as any, [
        'msg-1',
      ]);

      expect(result.has('msg-1')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe('listSummariesByEntity', () => {
    const createdAt = new Date('2026-04-26T12:00:00.000Z');

    it('filters reports by entityId only and maps to ReportSummaryDto', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'report-1',
          reportType: 'IMPLEMENT',
          sourceExecutionId: 'exec-1',
          createdAt,
        },
        {
          id: 'report-2',
          reportType: 'PLAN',
          sourceExecutionId: null,
          createdAt,
        },
      ]);

      const result = await service.listSummariesByEntity(
        'org-1' as any,
        'entity-1',
      );

      expect(prisma.db.report.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          reportEntities: { some: { entityId: 'entity-1' } },
        },
        select: {
          id: true,
          reportType: true,
          sourceExecutionId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'report-1',
          reportType: ReportType.Implement,
          sourceExecution: 'exec-1',
          createdAt: createdAt.toISOString(),
        },
        {
          id: 'report-2',
          reportType: ReportType.Plan,
          sourceExecution: null,
          createdAt: createdAt.toISOString(),
        },
      ]);
    });

    it('applies the reportType filter when supplied', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      await service.listSummariesByEntity(
        'org-1' as any,
        'entity-1',
        ReportType.Implement,
      );

      const findManyArg = (prisma.db.report.findMany as jest.Mock).mock
        .calls[0]![0];
      expect(findManyArg.where.reportType).toBe('IMPLEMENT');
      expect(findManyArg.where.reportEntities.some).toEqual({
        entityId: 'entity-1',
      });
    });

    it('returns an empty array when no reports match', async () => {
      (prisma.db.report.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listSummariesByEntity(
        'org-1' as any,
        'entity-1',
      );

      expect(result).toEqual([]);
    });

    it('rejects an invalid reportType', async () => {
      await expect(
        service.listSummariesByEntity(
          'org-1' as any,
          'entity-1',
          'NOT_A_REPORT_TYPE',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.db.report.findMany).not.toHaveBeenCalled();
    });
  });

  describe('PROJECT_REPORT submission', () => {
    const projectId = projectReportPayload.scope.projectId;
    const buildService = () => {
      const projectReportRequests = {
        assertReportSubmissionInTransaction: jest.fn(),
        completeInTransaction: jest.fn(),
        fail: jest.fn(),
      };
      return {
        projectReportRequests,
        service: new ReportService(
          prisma as any,
          eventPublisher as any,
          entityRegistryService as any,
          flowExecutionService as any,
          nodeExecutionService as any,
          projectReportRequests as any,
        ),
      };
    };
    const submit = (reportService: ReportService) =>
      reportService.create(
        'org-1' as any,
        {
          projectId,
          reportType: ReportType.ProjectReport,
          audience: ReportAudience.ProjectVisible,
          sourceExecutionId: 'agent-session-1',
          payload: projectReportPayload as any,
        },
        'conversation-1',
        'user-1' as any,
      );

    it('leaves the attempt running after a rejected submission so the agent can resubmit', async () => {
      const { service: reportService, projectReportRequests } = buildService();
      const createdAt = new Date('2026-09-28T02:00:00.000Z');
      (prisma.db.report.create as jest.Mock)
        .mockRejectedValueOnce(
          new BadRequestException('linkedEntities references a missing task'),
        )
        .mockResolvedValueOnce({
          id: 'report-1',
          organizationId: 'org-1',
          projectId,
          reportType: 'PROJECT_REPORT',
          audience: 'PROJECT_VISIBLE',
          payload: projectReportPayload,
          version: 1,
          schemaVersion: 1,
          sourceExecutionId: 'agent-session-1',
          parentReportId: null,
          createdAt,
          expiresAt: new Date('2026-10-28T02:00:00.000Z'),
          reportEntities: [],
        });

      await expect(submit(reportService)).rejects.toThrow(BadRequestException);
      expect(
        projectReportRequests.completeInTransaction,
      ).not.toHaveBeenCalled();
      expect(projectReportRequests.fail).not.toHaveBeenCalled();

      await submit(reportService);
      expect(projectReportRequests.completeInTransaction).toHaveBeenCalledWith(
        prisma.db,
        'report-1',
        'org-1',
        projectId,
        'agent-session-1',
        projectReportPayload,
      );
      expect(projectReportRequests.fail).not.toHaveBeenCalled();
    });
  });

  describe('linkedEntities', () => {
    const createdAt = new Date('2026-02-16T22:30:00.000Z');
    const expiresAt = new Date('2026-03-18T22:30:00.000Z');

    it('materializes one PRIMARY row plus one CONTEXT row per typed linked entity', async () => {
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'PRIMARY',
            createdAt,
          },
          {
            id: 'ent-2',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      });

      const result = await service.create('org-1' as any, {
        projectId: 'project-1',
        reportType: ReportType.FeatureTreeAnalysis,
        audience: ReportAudience.ProjectVisible,
        payload: {
          reportType: 'FEATURE_TREE_ANALYSIS',
          summary: 'ok',
          text: 'body',
        } as any,
        entities: [
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'task-1',
            relation: ReportEntityRelation.Primary,
          },
        ],
        linkedEntities: [
          { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
        ],
      });

      expect(entityRegistryService.getEntitiesByIds).not.toHaveBeenCalled();
      const createArg = (prisma.db.report.create as jest.Mock).mock
        .calls[0]![0];
      expect(createArg.data.reportEntities.create).toEqual([
        {
          entityType: 'TASK',
          entityId: 'task-1',
          relation: 'PRIMARY',
        },
        {
          entityType: 'TASK',
          entityId: 'task-2',
          relation: 'CONTEXT',
        },
      ]);
      expect(result.linkedEntities).toEqual([
        { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
      ]);
    });

    it('dedupes a linked entity against a caller-supplied CONTEXT entity with the same (entityType, entityId, relation)', async () => {
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      });

      await service.create('org-1' as any, {
        projectId: 'project-1',
        reportType: ReportType.FeatureTreeAnalysis,
        audience: ReportAudience.ProjectVisible,
        payload: {
          reportType: 'FEATURE_TREE_ANALYSIS',
          summary: 'ok',
          text: 'body',
        } as any,
        entities: [
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'task-2',
            relation: ReportEntityRelation.Context,
          },
        ],
        linkedEntities: [
          { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
        ],
      });

      const createArg = (prisma.db.report.create as jest.Mock).mock
        .calls[0]![0];
      expect(createArg.data.reportEntities.create).toEqual([
        { entityType: 'TASK', entityId: 'task-2', relation: 'CONTEXT' },
      ]);
    });

    it('does not call the registry when linkedEntities is omitted; preserves PRIMARY-only behavior', async () => {
      (prisma.db.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'CODING_RESEARCH',
        audience: 'WORKFLOW_ONLY',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'PRIMARY',
            createdAt,
          },
        ],
      });

      const result = await service.create('org-1' as any, {
        projectId: 'project-1',
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: 'analysis',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
        entities: [
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'task-1',
            relation: ReportEntityRelation.Primary,
          },
        ],
      });

      expect(entityRegistryService.getEntitiesByIds).not.toHaveBeenCalled();
      expect(result.linkedEntities).toBeUndefined();
    });

    it('populates linkedEntities on the read dto from existing CONTEXT rows and omits the field when there are none', async () => {
      const reportWithContext = {
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'ok' },
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'PRIMARY',
            createdAt,
          },
          {
            id: 'ent-2',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
          {
            id: 'ent-3',
            entityType: 'DESIGN_DOC',
            entityId: 'doc-3',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      };
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValueOnce(
        reportWithContext,
      );

      const withContext = await service.findOne('org-1' as any, 'report-1');
      expect(withContext.linkedEntities).toEqual([
        { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
        { entityType: ReportRelatedEntityType.DesignDoc, entityId: 'doc-3' },
      ]);

      (prisma.db.report.findFirst as jest.Mock).mockResolvedValueOnce({
        ...reportWithContext,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'PRIMARY',
            createdAt,
          },
        ],
      });

      const primaryOnly = await service.findOne('org-1' as any, 'report-1');
      expect(primaryOnly.linkedEntities).toBeUndefined();
    });

    it('on update with linkedEntities and replace-entities, folds typed CONTEXT rows into entityCreates', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
        id: 'report-1',
      });
      (prisma.db.report.update as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'updated' },
        version: 2,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-1',
            relation: 'PRIMARY',
            createdAt,
          },
          {
            id: 'ent-2',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      });

      const result = await service.update('org-1' as any, 'report-1', {
        payload: {
          reportType: 'FEATURE_TREE_ANALYSIS',
          summary: 'updated',
          text: 'body',
        } as any,
        entities: [
          {
            entityType: ReportRelatedEntityType.Task,
            entityId: 'task-1',
            relation: ReportEntityRelation.Primary,
          },
        ],
        linkedEntities: [
          { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
        ],
      });

      expect(entityRegistryService.getEntitiesByIds).not.toHaveBeenCalled();
      const updateArg = (prisma.db.report.update as jest.Mock).mock
        .calls[0]![0];
      expect(updateArg.data.reportEntities.deleteMany).toEqual({});
      expect(updateArg.data.reportEntities.create).toEqual([
        { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
        { entityType: 'TASK', entityId: 'task-2', relation: 'CONTEXT' },
      ]);
      expect(result.linkedEntities).toEqual([
        { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
      ]);
    });

    it('on update with linkedEntities and no replace-entities, appends new CONTEXT rows without deleting existing ones', async () => {
      (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
        id: 'report-1',
      });
      (prisma.db.report.update as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'updated' },
        version: 2,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        // Pre-existing row already on the report (task-2 is a duplicate).
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      });
      (prisma.db.reportEntity.createMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.db.report.findUnique as jest.Mock).mockResolvedValue({
        id: 'report-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        reportType: 'FEATURE_TREE_ANALYSIS',
        audience: 'PROJECT_VISIBLE',
        payload: { summary: 'updated' },
        version: 2,
        schemaVersion: 1,
        sourceExecutionId: null,
        parentReportId: null,
        createdAt,
        expiresAt,
        reportEntities: [
          {
            id: 'ent-1',
            entityType: 'TASK',
            entityId: 'task-2',
            relation: 'CONTEXT',
            createdAt,
          },
          {
            id: 'ent-2',
            entityType: 'DESIGN_DOC',
            entityId: 'doc-3',
            relation: 'CONTEXT',
            createdAt,
          },
        ],
      });

      const result = await service.update('org-1' as any, 'report-1', {
        payload: {
          reportType: 'FEATURE_TREE_ANALYSIS',
          summary: 'updated',
          text: 'body',
        } as any,
        linkedEntities: [
          { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
          { entityType: ReportRelatedEntityType.DesignDoc, entityId: 'doc-3' },
        ],
      });

      const updateArg = (prisma.db.report.update as jest.Mock).mock
        .calls[0]![0];
      // Replace-entities path was NOT taken.
      expect(updateArg.data.reportEntities).toBeUndefined();
      // Only the missing row was appended.
      expect(prisma.db.reportEntity.createMany).toHaveBeenCalledWith({
        data: [
          {
            reportId: 'report-1',
            entityType: 'DESIGN_DOC',
            entityId: 'doc-3',
            relation: 'CONTEXT',
          },
        ],
      });
      expect(result.linkedEntities).toEqual([
        { entityType: ReportRelatedEntityType.Task, entityId: 'task-2' },
        { entityType: ReportRelatedEntityType.DesignDoc, entityId: 'doc-3' },
      ]);
    });
  });

  describe('deleteReportsAttachedToEntity', () => {
    const { EntityType } = require('@prisma/client');

    it('deletes only reports with AGENT_SESSION link to the deleted session', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const deletedCount = await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'agent-session-1',
        entityType: EntityType.AGENT_SESSION,
        projectId: 'project-1',
      });

      expect(prisma.db.report.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          reportEntities: {
            some: {
              entityType: 'AGENT_SESSION',
              entityId: 'agent-session-1',
            },
          },
        },
      });
      expect(deletedCount).toBe(2);
    });

    it('deletes only reports with TASK link to the archived task', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      const deletedCount = await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'task-1',
        entityType: EntityType.TASK,
        projectId: 'project-1',
      });

      expect(prisma.db.report.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          reportEntities: {
            some: {
              entityType: 'TASK',
              entityId: 'task-1',
            },
          },
        },
      });
      expect(deletedCount).toBe(3);
    });

    it('does not delete reports linked to other entities of the same type', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const deletedCount = await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'agent-session-1',
        entityType: EntityType.AGENT_SESSION,
        projectId: 'project-1',
      });

      const deleteCallArg = (prisma.db.report.deleteMany as jest.Mock).mock
        .calls[0]![0];
      expect(deleteCallArg.where.reportEntities.some.entityId).toBe(
        'agent-session-1',
      );
      expect(deleteCallArg.where.reportEntities.some.entityType).toBe(
        'AGENT_SESSION',
      );
      expect(deletedCount).toBe(1);
    });

    it('handles no-matching-reports case gracefully (idempotent)', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const deletedCount = await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'nonexistent-session',
        entityType: EntityType.AGENT_SESSION,
        projectId: 'project-1',
      });

      expect(deletedCount).toBe(0);
    });

    it('is idempotent on repeated calls with same entityId', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'session-1',
        entityType: EntityType.AGENT_SESSION,
        projectId: 'project-1',
      });

      await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'session-1',
        entityType: EntityType.AGENT_SESSION,
        projectId: 'project-1',
      });

      expect(prisma.db.report.deleteMany).toHaveBeenCalledTimes(2);
      const deleteCallArg = (prisma.db.report.deleteMany as jest.Mock).mock
        .calls[1]![0];
      expect(deleteCallArg.where.reportEntities.some.entityId).toBe(
        'session-1',
      );
    });

    it('works without projectId when provided', async () => {
      (prisma.db.report.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.deleteReportsAttachedToEntity({
        organizationId: 'org-1' as any,
        entityId: 'agent-session-1',
        entityType: EntityType.AGENT_SESSION,
        projectId: undefined,
      });

      expect(prisma.db.report.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          reportEntities: {
            some: {
              entityType: 'AGENT_SESSION',
              entityId: 'agent-session-1',
            },
          },
        },
      });
    });
  });
});
