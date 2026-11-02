import { ForbiddenException } from '@nestjs/common';
import type { CreateProjectReportRequestDto } from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectReportHistoryService } from '../project-report-history.service';
import { ProjectReportRequestService } from '../project-report-request.service';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const submission = {
  question: 'What changed?',
  scope: {
    projectId,
    windowStart: '2026-09-20T00:00:00Z',
    windowEnd: '2026-09-29T00:00:00Z',
    timeZone: 'UTC',
  },
  exclusions: [],
  launch: {
    machineId: '66666666-6666-4666-8666-666666666666',
    provider: 'codex',
    model: 'model',
    effort: 'high',
  },
  idempotencyKey: 'key',
} as CreateProjectReportRequestDto;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 0, minute));
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function attempt(requestId: string, attemptNumber: number, extra = {}) {
  return {
    id: uuid(requestId === uuid(1) ? 100 + attemptNumber : 200 + attemptNumber),
    requestId,
    attemptNumber,
    idempotencyKey: `k${attemptNumber}`,
    status: 'QUEUED',
    agentSessionId: null,
    conversationId: null,
    reportId: null,
    failure: null,
    createdAt: at(0),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    ...extra,
  };
}

function request(
  id: string,
  minute: number,
  status: string,
  attempts: object[],
) {
  return {
    id,
    organizationId,
    projectId,
    userId,
    kind: 'PROJECT_REPORT',
    serviceIds: null,
    question: submission.question,
    preset: null,
    resolvedScope: submission.scope,
    exclusions: submission.exclusions,
    launchConfig: submission.launch,
    idempotencyKey: `req-${id}`,
    status,
    createdAt: at(minute),
    updatedAt: at(minute),
    attempts,
  };
}

describe('ProjectReportHistoryService', () => {
  const requests = [
    request(uuid(1), 10, 'FAILED', [
      attempt(uuid(1), 1, {
        status: 'FAILED',
        failedAt: at(11),
        failure: {
          stage: 'LAUNCH',
          code: 'START_RUN_FAILED',
          message: 'The project report run could not start',
          retryable: true,
        },
      }),
      attempt(uuid(1), 2, {
        status: 'FAILED',
        failedAt: at(12),
        failure: {
          stage: 'LAUNCH',
          code: 'START_RUN_FAILED',
          message: 'The project report run could not start',
          retryable: true,
        },
      }),
    ]),
    request(uuid(2), 20, 'RUNNING', [
      attempt(uuid(2), 1, { status: 'RUNNING' }),
    ]),
    request(uuid(3), 30, 'COMPLETED', [
      attempt(uuid(3), 1, { status: 'COMPLETED', reportId: uuid(900) }),
    ]),
    request(uuid(4), 40, 'QUEUED', [attempt(uuid(4), 1)]),
  ];
  const savedReports = [{ id: uuid(901), createdAt: at(25) }];

  const prisma = {
    db: {
      projectReportRequest: { findMany: jest.fn(), count: jest.fn() },
      report: { findMany: jest.fn(), count: jest.fn() },
    },
  };
  const access = { accessibleProjectIds: jest.fn() };
  const requestService = new ProjectReportRequestService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    {} as never,
  );
  const service = new ProjectReportHistoryService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    requestService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.accessibleProjectIds.mockResolvedValue([projectId]);
    prisma.db.report.count.mockResolvedValue(savedReports.length);
    prisma.db.projectReportRequest.count.mockResolvedValue(requests.length);
    prisma.db.report.findMany.mockImplementation((args: { take: number }) =>
      Promise.resolve(savedReports.slice(0, args.take)),
    );
    prisma.db.projectReportRequest.findMany.mockImplementation(
      (args: {
        include?: unknown;
        take?: number;
        where: { id?: { in: string[] } };
      }) =>
        Promise.resolve(
          args.include
            ? requests.filter((row) => args.where.id?.in.includes(row.id))
            : requests
                .toSorted(
                  (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                )
                .slice(0, args.take)
                .map(({ id, createdAt }) => ({ id, createdAt })),
        ),
    );
  });

  it('lists every state newest first with the saved report, each once, and the completed report only via its request', async () => {
    const page = await service.list(organizationId, projectId, userId, 50, 0);

    expect(page.total).toBe(5);
    expect(
      page.entries.map((entry) =>
        entry.type === 'REQUEST' ? entry.requestId : entry.reportId,
      ),
    ).toEqual([uuid(4), uuid(3), uuid(901), uuid(2), uuid(1)]);
    const completed = page.entries[1];
    expect(completed).toMatchObject({
      type: 'REQUEST',
      status: 'COMPLETED',
      latestAttempt: { reportId: uuid(900) },
    });
  });

  it('excludes reports linked to the caller’s attempts from the saved-report query', async () => {
    await service.list(organizationId, projectId, userId, 50, 0);

    expect(prisma.db.report.findMany.mock.calls[0][0].where).toMatchObject({
      projectReportAttempts: { none: { request: { userId } } },
    });
  });

  it('shows only the latest attempt, with its failure and no report identity', async () => {
    const page = await service.list(organizationId, projectId, userId, 50, 0);
    const failed = page.entries.at(-1);

    expect(failed).toMatchObject({
      type: 'REQUEST',
      status: 'FAILED',
      latestAttempt: {
        attemptNumber: 2,
        id: uuid(102),
        failure: { code: 'START_RUN_FAILED', retryable: true },
      },
    });
    expect(failed).not.toHaveProperty('latestAttempt.reportId');
  });

  it('bounds each source read to the requested page window', async () => {
    await service.list(organizationId, projectId, userId, 2, 2);

    expect(prisma.db.report.findMany.mock.calls[0][0]).toMatchObject({
      take: 4,
    });
    expect(
      prisma.db.projectReportRequest.findMany.mock.calls[0][0],
    ).toMatchObject({
      take: 4,
    });
  });

  it('shows members only approved failure text, not stored error details', async () => {
    const leaky = request(uuid(5), 50, 'FAILED', [
      attempt(uuid(5), 1, {
        status: 'FAILED',
        failedAt: at(51),
        failure: {
          stage: 'LAUNCH',
          code: 'LAUNCH_PREPARATION_FAILED',
          message: 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2',
          retryable: true,
        },
      }),
    ]);
    requests.push(leaky);
    prisma.db.projectReportRequest.count.mockResolvedValue(requests.length);

    const page = await service.list(organizationId, projectId, userId, 1, 0);

    expect(page.entries[0]).toMatchObject({
      latestAttempt: {
        failure: {
          code: 'LAUNCH_PREPARATION_FAILED',
          message: 'The project report run could not be prepared',
        },
      },
    });
    requests.pop();
  });

  it('paginates over merged entries', async () => {
    const first = await service.list(organizationId, projectId, userId, 2, 0);
    const second = await service.list(organizationId, projectId, userId, 2, 2);
    const last = await service.list(organizationId, projectId, userId, 2, 4);

    expect(first.entries).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    expect(second.nextOffset).toBe(4);
    expect(last.entries).toHaveLength(1);
    expect(last.nextOffset).toBeUndefined();
    expect(last.total).toBe(5);
  });

  it('scopes requests to the caller while other members’ saved reports stay listed', async () => {
    await service.list(organizationId, projectId, userId, 50, 0);

    expect(
      prisma.db.projectReportRequest.findMany.mock.calls[0][0].where,
    ).toEqual({ organizationId, projectId, userId });
    expect(prisma.db.report.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'userId',
    );
  });

  it('rejects a caller without project access', async () => {
    access.accessibleProjectIds.mockResolvedValue([]);

    await expect(
      service.list(organizationId, projectId, userId, 50, 0),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.db.projectReportRequest.findMany).not.toHaveBeenCalled();
  });
});
