import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import type { Context } from '@rekog/mcp-nest';

import { GetReportBodyToolsProvider } from '../../src/mcp/tools/get-report-body-tools.provider';
import { ReportService } from '../../src/services/reports/report.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EntityRegistryService } from '../../src/services/entity-registry/entity-registry.service';
import { DomainEventPublisher } from '../../src/core/events/domain-event-publisher';
import {
  ReportAudience,
  ReportDto,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
} from '../../src/generated';
import * as TestUtils from '../../src/utils/testUtils';

const { testIds } = TestUtils;
const EMPTY_CONTEXT = {} as unknown as Context;
const AGENT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174777';
const OTHER_ORG_ID = '123e4567-e89b-42d3-a456-426614174999';

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

function makeAgentRequest(orgId: string = testIds.organization): Request {
  return {
    user: {
      userId: testIds.user,
      currentOrgId: orgId,
    },
    headers: {
      'x-agent-session-id': AGENT_SESSION_ID,
      authorization: 'Bearer test-token',
    },
  } as unknown as Request;
}

describe('get_report_body MCP tool (integration)', () => {
  let app: INestApplication;
  let getReportBodyTool: GetReportBodyToolsProvider;
  let reportService: ReportService;
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
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; organizationId: string };
        }) => {
          return (
            reportStore.find(
              (r) =>
                r.id === where.id && r.organizationId === where.organizationId,
            ) ?? null
          );
        },
      ),
      findMany: jest.fn(),
    };

    const mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as { report?: unknown }).report = reportTable;
    (mockPrisma.db as { $transaction: unknown }).$transaction = async <T>(
      fn: (tx: unknown) => Promise<T>,
    ): Promise<T> => fn(mockPrisma.db);

    const mockEntityRegistry = {
      getEntitiesByIds: jest.fn().mockResolvedValue([
        {
          entityId: testIds.task,
          entityType: 'TASK',
          entityName: 'Refactor auth middleware',
        },
      ]),
    };

    const mockEventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        GetReportBodyToolsProvider,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EntityRegistryService, useValue: mockEntityRegistry },
        { provide: DomainEventPublisher, useValue: mockEventPublisher },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    getReportBodyTool = module.get(GetReportBodyToolsProvider);
    reportService = module.get(ReportService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns the full payload and metadata for a report belonging to the active org', async () => {
    const created = await reportService.create(testIds.organization, {
      projectId: testIds.project,
      reportType: ReportType.SessionSummary,
      audience: ReportAudience.WorkflowOnly,
      payload: {
        reportType: ReportType.SessionSummary,
        text: 'Wrapped up the auth refactor.',
      } as ReportDto['payload'],
      sourceExecutionId: AGENT_SESSION_ID,
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: testIds.task,
          relation: ReportEntityRelation.Primary,
        },
      ],
    });

    const result = await getReportBodyTool.getReportBody(
      { reportId: created.id },
      EMPTY_CONTEXT,
      makeAgentRequest(),
    );

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const text = (result as { content: Array<{ text: string }> }).content[0]
      ?.text;
    if (!text) throw new Error('Expected at least one content entry');
    const parsed = JSON.parse(text) as ReportDto;

    expect(parsed.id).toBe(created.id);
    expect(parsed.organizationId).toBe(testIds.organization);
    expect(parsed.projectId).toBe(testIds.project);
    expect(parsed.reportType).toBe(ReportType.SessionSummary);
    expect(parsed.audience).toBe(ReportAudience.WorkflowOnly);
    expect(parsed.title).toBe('Session Summary');
    expect(parsed.payload).toEqual({
      reportType: ReportType.SessionSummary,
      text: 'Wrapped up the auth refactor.',
    });
    expect(parsed.sourceExecutionId).toBe(AGENT_SESSION_ID);
    expect(parsed.parentReportId).toBeNull();
    expect(typeof parsed.createdAt).toBe('string');
    expect(typeof parsed.expiresAt).toBe('string');
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]).toMatchObject({
      entityType: ReportRelatedEntityType.Task,
      entityId: testIds.task,
      relation: ReportEntityRelation.Primary,
    });
  });

  it('returns an authorization-shaped mcpError when the report belongs to a different organization', async () => {
    const created = await reportService.create(testIds.organization, {
      projectId: testIds.project,
      reportType: ReportType.SessionSummary,
      audience: ReportAudience.WorkflowOnly,
      payload: {
        reportType: ReportType.SessionSummary,
        text: 'Org-scoped report — must not leak cross-org.',
      } as ReportDto['payload'],
      sourceExecutionId: AGENT_SESSION_ID,
    });

    const result = await getReportBodyTool.getReportBody(
      { reportId: created.id },
      EMPTY_CONTEXT,
      makeAgentRequest(OTHER_ORG_ID),
    );

    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: Array<{ text: string }> }).content[0]
      ?.text;
    if (!text) throw new Error('Expected an error content entry');
    expect(text).toContain(created.id);
    expect(text).toContain('not found or not accessible');
  });
});
