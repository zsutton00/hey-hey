import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { Context } from '@rekog/mcp-nest';

import { GetReportSchemaToolsProvider } from '../../src/mcp/tools/get-report-schema-tools.provider';
import { ReportController } from '../../src/controllers/report.controller';
import { ReportService } from '../../src/services/reports/report.service';
import { FlowExecutionService } from '../../src/services/workflows/flow-execution.service';
import { NodeExecutionService } from '../../src/services/workflows/node-execution.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EntityRegistryService } from '../../src/services/entity-registry/entity-registry.service';
import { ProjectReportRequestService } from '../../src/services/project-reports/project-report-request.service';
import { DomainEventPublisher } from '../../src/core/events/domain-event-publisher';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { ProjectAccessService } from '../../src/auth/services/project-access.service';
import { ProjectAccessGuard } from '../../src/auth/guards/project-access.guard';
import { OrganizationGuard } from '../../src/auth/guards/organization.guard';
import { ReportAudience, ReportType } from '../../src/generated';
import { NodeType } from '../../src/types/flow-internal.types';
import * as TestUtils from '../../src/utils/testUtils';

const { testIds } = TestUtils;
const EMPTY_CONTEXT = {} as unknown as Context;
const AGENT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174777';
const CONVERSATION_ID = '123e4567-e89b-42d3-a456-426614174780';

interface StoredReport {
  id: string;
  organizationId: string;
  projectId: string | null;
  reportType: string;
  audience: string;
  payload: unknown;
  version: number;
  schemaVersion: number;
  sourceExecutionId: string | null;
  parentReportId: string | null;
  createdAt: Date;
  expiresAt: Date;
  reportEntities: Array<{
    entityType: string;
    entityId: string;
    relation: string;
    createdAt: Date;
  }>;
}

function parseToolText(result: unknown): {
  schema: unknown;
  description: unknown;
} {
  const r = result as { content: Array<{ type: string; text: string }> };
  expect(Array.isArray(r.content)).toBe(true);
  const first = r.content[0];
  expect(first?.type).toBe('text');
  if (!first) throw new Error('Expected at least one content entry');
  return JSON.parse(first.text);
}

describe('report creation REST integration', () => {
  let app: INestApplication;
  let getReportSchemaTool: GetReportSchemaToolsProvider;
  let reportStore: StoredReport[];

  beforeAll(async () => {
    reportStore = [];
    let nextId = 1;
    const generatedId = (): string =>
      `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

    const reportTable = {
      create: jest.fn(
        async ({
          data,
          include,
        }: {
          data: {
            organizationId: string;
            projectId?: string | null;
            reportType: string;
            audience: string;
            payload: unknown;
            schemaVersion?: number;
            sourceExecutionId?: string | null;
            parentReportId?: string | null;
            expiresAt?: Date;
            reportEntities?: {
              create?: Array<{
                entityType: string;
                entityId: string;
                relation: string;
              }>;
            };
          };
          include?: { reportEntities?: unknown };
        }) => {
          const now = new Date();
          const entityCreates = data.reportEntities?.create ?? [];
          const stored: StoredReport = {
            id: generatedId(),
            organizationId: data.organizationId,
            projectId: data.projectId ?? null,
            reportType: data.reportType,
            audience: data.audience,
            payload: data.payload,
            version: 1,
            schemaVersion: data.schemaVersion ?? 1,
            sourceExecutionId: data.sourceExecutionId ?? null,
            parentReportId: data.parentReportId ?? null,
            createdAt: now,
            expiresAt: data.expiresAt ?? new Date(now.getTime() + 86400000),
            reportEntities: entityCreates.map((e) => ({
              ...e,
              createdAt: now,
            })),
          };
          reportStore.push(stored);
          return include?.reportEntities
            ? stored
            : { ...stored, reportEntities: [] };
        },
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            organizationId: string;
            expiresAt?: { gt: Date };
            projectId?: string;
            reportType?: string;
            audience?: string;
            sourceExecutionId?: string;
            parentReportId?: string;
          };
        }) => {
          return reportStore.filter((r) => {
            if (r.organizationId !== where.organizationId) return false;
            if (where.expiresAt?.gt && !(r.expiresAt > where.expiresAt.gt)) {
              return false;
            }
            if (where.projectId && r.projectId !== where.projectId) {
              return false;
            }
            if (where.reportType && r.reportType !== where.reportType) {
              return false;
            }
            if (where.audience && r.audience !== where.audience) return false;
            if (
              where.sourceExecutionId &&
              r.sourceExecutionId !== where.sourceExecutionId
            ) {
              return false;
            }
            if (
              where.parentReportId &&
              r.parentReportId !== where.parentReportId
            ) {
              return false;
            }
            return true;
          });
        },
      ),
      findFirst: jest.fn(),
    };

    const mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as { report?: unknown }).report = reportTable;
    (mockPrisma.db as { $transaction: unknown }).$transaction = async <T>(
      fn: (tx: unknown) => Promise<T>,
    ): Promise<T> => fn(mockPrisma.db);

    const mockEntityRegistry = {
      getEntitiesByIds: jest.fn().mockResolvedValue([]),
    };

    const mockEventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };
    const mockFlowExecutionService = {
      findActiveByConversation: jest.fn().mockResolvedValue({
        id: 'flow-exec-1',
        flowId: 'coding-session',
        currentNode: 'coding-agent',
        flowState: null,
        status: 'PAUSED',
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      }),
    };
    const mockNodeExecutionService = {
      getNode: jest.fn().mockReturnValue({
        node: {
          type: NodeType.EXTERNAL_AGENT,
          actions: { done: {}, needs_input: {} },
        },
        routing: {},
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        ReportService,
        GetReportSchemaToolsProvider,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EntityRegistryService, useValue: mockEntityRegistry },
        { provide: DomainEventPublisher, useValue: mockEventPublisher },
        { provide: ProjectReportRequestService, useValue: {} },
        {
          provide: ProjectAccessService,
          useValue: {
            assertProjectAccess: jest.fn(),
            accessibleProjectIds: jest
              .fn()
              .mockResolvedValue([testIds.project]),
          },
        },
        { provide: FlowExecutionService, useValue: mockFlowExecutionService },
        { provide: NodeExecutionService, useValue: mockNodeExecutionService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    getReportSchemaTool = module.get(GetReportSchemaToolsProvider);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('keeps get_report_schema readable while reports are created through REST', async () => {
    const schemaResult = await getReportSchemaTool.getReportSchema(
      { reportType: ReportType.SessionSummary },
      EMPTY_CONTEXT,
    );
    const { schema, description } = parseToolText(schemaResult);
    expect(JSON.stringify(schema)).toContain('"reportType"');
    expect(JSON.stringify(schema)).toContain('"summary"');
    expect(JSON.stringify(schema)).toContain('"text"');
    expect(typeof description).toBe('string');

    const payload = {
      reportType: ReportType.SessionSummary,
      summary: 'Wrapped up the auth refactor.',
      text: 'Wrapped up the auth refactor.',
    };

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${testIds.organization}/reports`)
      .set('Authorization', 'Bearer test-token')
      .send({
        projectId: testIds.project,
        reportType: ReportType.SessionSummary,
        audience: ReportAudience.WorkflowOnly,
        sourceExecutionId: AGENT_SESSION_ID,
        payload,
      })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      id: expect.stringMatching(
        /^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$/i,
      ),
      reportType: ReportType.SessionSummary,
      audience: ReportAudience.WorkflowOnly,
      sourceExecutionId: AGENT_SESSION_ID,
      payload,
      reportGuidance: {
        actions: [],
      },
    });

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${testIds.organization}/reports`)
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    const found = (listResponse.body as Array<Record<string, unknown>>).find(
      (r) => r.id === createResponse.body.id,
    );
    expect(found).toMatchObject({
      id: createResponse.body.id,
      reportType: ReportType.SessionSummary,
      audience: ReportAudience.WorkflowOnly,
      sourceExecutionId: AGENT_SESSION_ID,
      payload,
    });
  });

  it('returns reportGuidance for CODING_RESEARCH submissions through run-scoped REST headers', async () => {
    const payload = {
      reportType: ReportType.CodingResearch,
      format: 'SELF_RESEARCH',
      summary:
        'Research completed with the graph context needed for the implementation.',
      analysis: 'The REST response needs server-built report guidance.',
      frame: {},
      provenance: { discoveryCalls: [], edgesTraversed: [] },
      updates: [],
      uncertainties: [],
    };

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${testIds.organization}/reports`)
      .set('Authorization', 'Bearer test-token')
      .set('X-Project-ID', testIds.project)
      .set('X-Agent-Session-ID', AGENT_SESSION_ID)
      .set('X-Conversation-ID', CONVERSATION_ID)
      .send({
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload,
      })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      reportType: ReportType.CodingResearch,
      sourceExecutionId: AGENT_SESSION_ID,
      reportGuidance: {
        actions: ['done', 'needs_input'],
      },
    });
  });

  it('rejects a schema-invalid report with correction details, then persists the corrected resubmission', async () => {
    const reportsUrl = `/api/v1/organizations/${testIds.organization}/reports`;
    const submit = (payload: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(reportsUrl)
        .set('Authorization', 'Bearer test-token')
        .send({
          projectId: testIds.project,
          reportType: ReportType.FeatureSync,
          audience: ReportAudience.ProjectVisible,
          payload,
        });
    const corrected = {
      reportType: ReportType.FeatureSync,
      summary: 'Two findings need reconciliation.',
      discrepancies: [
        {
          sourceType: 'feature',
          source: {
            entityType: 'feature',
            entityId: testIds.project,
            title: 'Reports',
          },
          description: 'The feature no longer matches the code.',
        },
      ],
      reconciliationOptions: [
        { description: 'Update the feature.', discrepancyIndices: [0] },
      ],
    };
    const { discrepancies: _missing, ...invalid } = corrected;
    const storedBefore = reportStore.length;

    const rejected = await submit(invalid).expect(400);

    expect(rejected.body).toMatchObject({
      success: false,
      code: 'REPORT_PAYLOAD_INVALID',
      message: expect.stringContaining('/discrepancies'),
      data: {
        reportType: ReportType.FeatureSync,
        schemaVersion: 1,
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '/discrepancies',
            keyword: 'required',
            missingProperty: 'discrepancies',
          }),
        ]),
      },
    });
    expect(reportStore).toHaveLength(storedBefore);

    const accepted = await submit(corrected).expect(201);

    expect(reportStore).toHaveLength(storedBefore + 1);
    const listed = await request(app.getHttpServer())
      .get(reportsUrl)
      .set('Authorization', 'Bearer test-token')
      .expect(200);
    expect(
      (listed.body as Array<Record<string, unknown>>).find(
        (report) => report.id === accepted.body.id,
      ),
    ).toMatchObject({ payload: corrected });
  });
});
