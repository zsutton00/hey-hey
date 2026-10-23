import { BadRequestException } from '@nestjs/common';
import { ReportAudience, ReportType } from 'src/generated';
import type { OrganizationId, UserId } from 'src/types';
import { ReportService } from '../report.service';
import { validateProjectReportPayload } from '../project-report-payload.validation';
import { projectReportPayload } from './project-report.fixture';
import {
  createMockPrismaService,
  createMockDomainEventPublisher,
} from 'src/utils/testUtils';

type ReportDependencies = ConstructorParameters<typeof ReportService>;
const organizationId = 'organization-id' as OrganizationId;
const callerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId;

describe('PROJECT_REPORT submission boundary', () => {
  it('rejects malformed updates before replacing the persisted report', async () => {
    const prisma = createMockPrismaService();
    prisma.db.report.findFirst.mockResolvedValue({
      id: 'report-id',
      reportType: 'PROJECT_REPORT',
      payload: projectReportPayload,
    });
    const service = new ReportService(
      prisma as unknown as ReportDependencies[0],
      createMockDomainEventPublisher() as unknown as ReportDependencies[1],
      {} as ReportDependencies[2],
    );
    await expect(
      service.update(organizationId, 'report-id', {
        payload: { ...projectReportPayload, title: '' },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
  });
  it('projects the authored title through the shared report envelope', () => {
    const service = new ReportService(
      {} as ReportDependencies[0],
      {} as ReportDependencies[1],
      {} as ReportDependencies[2],
    );
    const dto = service.toDto({
      id: '87b3c597-22f9-40ee-84a4-e028c2174109',
      organizationId: 'organization-id',
      projectId: projectReportPayload.scope.projectId,
      reportType: 'PROJECT_REPORT',
      audience: 'PROJECT_VISIBLE',
      payload: projectReportPayload,
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: null,
      parentReportId: null,
      ragEnabled: true,
      createdAt: new Date('2026-09-28T01:02:00Z'),
      expiresAt: new Date('2026-10-28T01:02:00Z'),
      reportEntities: [],
    });
    expect(dto.title).toBe(projectReportPayload.title);
    expect(dto.payload).toEqual(projectReportPayload);
  });
  it('rejects a project report submitted under another envelope type', () => {
    expect(() =>
      validateProjectReportPayload(ReportType.Snapshot, projectReportPayload),
    ).toThrow(BadRequestException);
  });
  it('accepts both complete and explicitly incomplete coverage', () => {
    expect(() =>
      validateProjectReportPayload(
        ReportType.ProjectReport,
        projectReportPayload,
      ),
    ).not.toThrow();
    expect(() =>
      validateProjectReportPayload(ReportType.ProjectReport, {
        ...projectReportPayload,
        coverage: {
          ...projectReportPayload.coverage,
          status: 'INCOMPLETE',
          limitations: ['Evidence read interrupted.'],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    { ...projectReportPayload, body: { html: '<p>Missing CSS</p>' } },
    { ...projectReportPayload, id: 'duplicate-envelope-identity' },
    {
      ...projectReportPayload,
      coverage: { ...projectReportPayload.coverage, pagesRead: -1 },
    },
    {
      ...projectReportPayload,
      provenance: { ...projectReportPayload.provenance, attemptId: undefined },
    },
    { ...projectReportPayload, reportType: 'SNAPSHOT' },
  ])('rejects malformed report payloads', (payload) => {
    expect(() =>
      validateProjectReportPayload(ReportType.ProjectReport, payload),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid payloads before report persistence', async () => {
    const prisma = createMockPrismaService();
    const service = new ReportService(
      prisma as unknown as ReportDependencies[0],
      createMockDomainEventPublisher() as unknown as ReportDependencies[1],
      {} as ReportDependencies[2],
    );
    await expect(
      service.create(organizationId, {
        reportType: ReportType.ProjectReport,
        audience: ReportAudience.ProjectVisible,
        payload: { ...projectReportPayload, title: '' },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
    expect(service.getReportTitle(ReportType.ProjectReport)).toBe(
      'Project Report',
    );
  });

  it('binds canonical report creation and attempt completion in one transaction', async () => {
    const prisma = createMockPrismaService();
    const publisher = createMockDomainEventPublisher();
    const requestOwner = {
      assertReportSubmissionInTransaction: jest.fn(),
      completeInTransaction: jest.fn(),
    };
    const report = {
      id: '77777777-7777-4777-8777-777777777777',
      organizationId: 'organization-id',
      projectId: projectReportPayload.scope.projectId,
      reportType: 'PROJECT_REPORT',
      audience: 'PROJECT_VISIBLE',
      payload: projectReportPayload,
      version: 1,
      schemaVersion: 1,
      sourceExecutionId: '88888888-8888-4888-8888-888888888888',
      parentReportId: null,
      createdAt: new Date(),
      expiresAt: new Date(),
      reportEntities: [],
    };
    const tx = { report: { create: jest.fn().mockResolvedValue(report) } };
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new ReportService(
      prisma as unknown as ReportDependencies[0],
      publisher as unknown as ReportDependencies[1],
      {} as ReportDependencies[2],
      {
        findActiveByConversation: jest.fn().mockResolvedValue(null),
      } as unknown as ReportDependencies[3],
      { getNode: jest.fn() } as unknown as ReportDependencies[4],
      requestOwner as unknown as ReportDependencies[5],
    );
    await service.create(
      organizationId,
      {
        reportType: ReportType.ProjectReport,
        audience: ReportAudience.ProjectVisible,
        projectId: projectReportPayload.scope.projectId,
        sourceExecutionId: report.sourceExecutionId,
        payload: projectReportPayload,
      },
      '99999999-9999-4999-8999-999999999999',
      callerUserId,
    );
    expect(
      requestOwner.assertReportSubmissionInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      'organization-id',
      projectReportPayload.scope.projectId,
      report.sourceExecutionId,
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectReportPayload,
    );
    expect(requestOwner.completeInTransaction).toHaveBeenCalledWith(
      tx,
      report.id,
      'organization-id',
      projectReportPayload.scope.projectId,
      report.sourceExecutionId,
      projectReportPayload,
    );
    expect(tx.report.create).toHaveBeenCalledTimes(1);
  });

  it('leaves the attempt running when canonical report persistence fails so the agent can resubmit', async () => {
    const prisma = createMockPrismaService();
    const requestOwner = {
      assertReportSubmissionInTransaction: jest.fn(),
      completeInTransaction: jest.fn(),
      fail: jest.fn(),
    };
    const tx = {
      report: {
        create: jest.fn().mockRejectedValue(new Error('database unavailable')),
      },
    };
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new ReportService(
      prisma as unknown as ReportDependencies[0],
      createMockDomainEventPublisher() as unknown as ReportDependencies[1],
      {} as ReportDependencies[2],
      undefined,
      undefined,
      requestOwner as unknown as ReportDependencies[5],
    );
    await expect(
      service.create(
        organizationId,
        {
          reportType: ReportType.ProjectReport,
          audience: ReportAudience.ProjectVisible,
          projectId: projectReportPayload.scope.projectId,
          sourceExecutionId: '88888888-8888-4888-8888-888888888888',
          payload: projectReportPayload,
        },
        '99999999-9999-4999-8999-999999999999',
        callerUserId,
      ),
    ).rejects.toThrow('database unavailable');
    expect(requestOwner.fail).not.toHaveBeenCalled();
    expect(requestOwner.completeInTransaction).not.toHaveBeenCalled();
  });
});
