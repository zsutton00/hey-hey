import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateProjectReportRequestDto } from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectReportRequestService } from '../project-report-request.service';
import { ProjectReportActivityService } from '../project-report-activity.service';
import { projectReportPayload } from 'src/services/reports/__tests__/project-report.fixture';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const attemptId = '44444444-4444-4444-8444-444444444444';
const submission = {
  question: 'What changed?',
  scope: {
    projectId,
    windowStart: '2026-09-20T00:00:00Z',
    windowEnd: '2026-09-29T00:00:00Z',
    timeZone: 'UTC',
    activityTypes: ['NOTIFICATION', 'UNBLOCKED'],
  },
  exclusions: [
    { entityType: 'TASK', entityId: '55555555-5555-4555-8555-555555555555' },
  ],
  launch: {
    machineId: '66666666-6666-4666-8666-666666666666',
    provider: 'codex',
    model: 'model',
    effort: 'high',
  },
  idempotencyKey: 'first',
} as CreateProjectReportRequestDto;
const now = new Date('2026-09-29T00:00:00Z');
const row = {
  id: '77777777-7777-4777-8777-777777777777',
  organizationId,
  projectId,
  userId,
  question: submission.question,
  preset: null,
  resolvedScope: submission.scope,
  exclusions: submission.exclusions,
  launchConfig: submission.launch,
  idempotencyKey: submission.idempotencyKey,
  status: 'FAILED',
  createdAt: now,
  updatedAt: now,
  attempts: [
    {
      id: attemptId,
      requestId: '77777777-7777-4777-8777-777777777777',
      attemptNumber: 1,
      idempotencyKey: 'first',
      status: 'FAILED',
      agentSessionId: null,
      conversationId: null,
      reportId: null,
      failure: {
        stage: 'LAUNCH',
        code: 'FAILED',
        message: 'Failed',
        retryable: true,
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
      failedAt: now,
    },
  ],
};

describe('ProjectReportRequestService', () => {
  const prisma = {
    db: {
      projectReportRequest: { findUnique: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    },
  };
  const access = {
    accessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
  };
  const activity = { select: jest.fn() };
  const service = new ProjectReportRequestService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    activity as unknown as ProjectReportActivityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.db.projectReportRequest.findUnique.mockResolvedValue(row);
    prisma.db.projectReportRequest.findFirst.mockResolvedValue(row);
    access.accessibleProjectIds.mockResolvedValue([projectId]);
  });

  it('replays the same semantic submission without another selection or execution', async () => {
    const replay = {
      ...submission,
      scope: {
        ...submission.scope,
        windowStart: '2026-09-20T00:00:00.000Z',
        activityTypes: [...submission.scope.activityTypes!].reverse(),
      },
    };
    const result = await service.create(
      organizationId,
      projectId,
      userId,
      replay,
    );
    expect(result.attempts).toHaveLength(1);
    expect(activity.select).not.toHaveBeenCalled();
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects changed input with a reused submission key', async () => {
    await expect(
      service.create(organizationId, projectId, userId, {
        ...submission,
        question: 'Different question',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('compares saved repository selection semantically and rejects a changed subset', async () => {
    const serviceIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    prisma.db.projectReportRequest.findUnique.mockResolvedValue({
      ...row,
      kind: 'RELEASE_NOTES',
      serviceIds,
    });
    const accepted = {
      ...submission,
      kind: 'RELEASE_NOTES',
      serviceIds: [...serviceIds].reverse(),
    } satisfies CreateProjectReportRequestDto;
    const result = await service.create(
      organizationId,
      projectId,
      userId,
      accepted,
    );
    expect(result.submission.serviceIds).toEqual(serviceIds);
    await expect(
      service.create(organizationId, projectId, userId, {
        ...accepted,
        serviceIds: [serviceIds[0]!],
      }),
    ).rejects.toThrow('different report request');
  });

  it('persists the chosen repositories before returning an accepted request', async () => {
    const serviceIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    prisma.db.projectReportRequest.findUnique.mockResolvedValue(null);
    activity.select.mockResolvedValue({ subjects: [{ excluded: false }] });
    const tx = {
      projectReportRequest: {
        create: jest.fn().mockResolvedValue({ id: row.id }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...row, kind: 'RELEASE_NOTES', serviceIds }),
      },
    };
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const result = await service.create(organizationId, projectId, userId, {
      ...submission,
      kind: 'RELEASE_NOTES',
      serviceIds,
    });
    expect(tx.projectReportRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceIds }),
      }),
    );
    expect(result.submission.serviceIds).toEqual(serviceIds);
  });

  it('leaves historical unknown repository scope absent', async () => {
    prisma.db.projectReportRequest.findUnique.mockResolvedValue({
      ...row,
      kind: 'RELEASE_NOTES',
      serviceIds: null,
    });
    const result = await service.create(organizationId, projectId, userId, {
      ...submission,
      kind: 'RELEASE_NOTES',
    });
    expect(result.submission).not.toHaveProperty('serviceIds');
  });

  it('rejects an all-excluded population before inserting a request', async () => {
    prisma.db.projectReportRequest.findUnique.mockResolvedValue(null);
    activity.select.mockResolvedValue({ subjects: [{ excluded: true }] });
    await expect(
      service.create(organizationId, projectId, userId, submission),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'START_RUN_FAILED'])(
    'creates a distinct retry from the expected failed attempt with %s',
    async (code) => {
      const failedRow = {
        ...row,
        kind: 'RELEASE_NOTES',
        serviceIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        attempts: row.attempts.map((attempt) => ({
          ...attempt,
          failure: { ...attempt.failure, stage: 'LAUNCH', code },
        })),
      };
      const nextAttempt = {
        ...row.attempts[0],
        id: '88888888-8888-4888-8888-888888888888',
        attemptNumber: 2,
        idempotencyKey: 'retry-one',
        status: 'QUEUED',
        failure: null,
        failedAt: null,
      };
      const tx = {
        $queryRaw: jest.fn(),
        projectReportRequest: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce(failedRow)
            .mockResolvedValueOnce({
              ...failedRow,
              status: 'QUEUED',
              attempts: [...row.attempts, nextAttempt],
            }),
          update: jest.fn(),
        },
        projectReportAttempt: { create: jest.fn() },
      };
      prisma.db.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      const result = await service.retry(
        organizationId,
        projectId,
        userId,
        row.id,
        {
          idempotencyKey: 'retry-one',
          expectedAttemptId: attemptId,
        },
      );
      expect(result.status).toBe('QUEUED');
      expect(result.submission.serviceIds).toEqual(failedRow.serviceIds);
      expect(result.attempts.map((attempt) => attempt.id)).toEqual([
        attemptId,
        nextAttempt.id,
      ]);
      expect(tx.projectReportAttempt.create).toHaveBeenCalledWith({
        data: {
          requestId: row.id,
          attemptNumber: 2,
          idempotencyKey: 'retry-one',
        },
      });
    },
  );

  it('accepts only the bound running source and unchanged submitted report fields', async () => {
    const agentSessionId = '99999999-9999-4999-8999-999999999999';
    const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const running = {
      ...row,
      status: 'RUNNING',
      attempts: [
        {
          ...row.attempts[0],
          status: 'RUNNING',
          failedAt: null,
          failure: null,
          agentSessionId,
          conversationId,
        },
      ],
    };
    const payload = {
      ...projectReportPayload,
      question: submission.question,
      scope: submission.scope,
      exclusions: submission.exclusions,
      provenance: {
        ...projectReportPayload.provenance,
        requestId: row.id,
        attemptId,
      },
    };
    const tx = {
      $queryRaw: jest.fn(),
      projectReportRequest: { findFirst: jest.fn().mockResolvedValue(running) },
    };
    await service.assertReportSubmissionInTransaction(
      tx as unknown as Prisma.TransactionClient,
      organizationId,
      projectId,
      agentSessionId,
      conversationId,
      userId,
      payload,
    );
    await expect(
      service.assertReportSubmissionInTransaction(
        tx as unknown as Prisma.TransactionClient,
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
        userId,
        { ...payload, question: 'Rewritten question' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('fails the active attempt when project access is revoked before an agent read', async () => {
    const agentSessionId = '99999999-9999-4999-8999-999999999999';
    prisma.db.projectReportRequest.findFirst.mockResolvedValue({
      ...row,
      status: 'RUNNING',
      attempts: [
        {
          ...row.attempts[0],
          status: 'RUNNING',
          agentSessionId,
          failure: null,
          failedAt: null,
        },
      ],
    });
    access.accessibleProjectIds.mockResolvedValue([]);
    const tx = {
      $queryRaw: jest.fn(),
      projectReportAttempt: {
        findFirst: jest.fn().mockResolvedValue({ id: attemptId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      projectReportRequest: { update: jest.fn() },
    };
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    await expect(
      service.loadForAgentRead(
        organizationId,
        projectId,
        userId,
        row.id,
        attemptId,
        agentSessionId,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.projectReportAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failure: expect.objectContaining({
            stage: 'EVIDENCE',
            code: 'PROJECT_ACCESS_REVOKED',
          }),
        }),
      }),
    );
  });

  const agentSessionId = '99999999-9999-4999-8999-999999999999';
  const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const lockedAttemptTx = (count: number) => ({
    $queryRaw: jest.fn(),
    projectReportAttempt: {
      findFirst: jest.fn().mockResolvedValue({ id: attemptId }),
      updateMany: jest.fn().mockResolvedValue({ count }),
    },
    projectReportRequest: { update: jest.fn() },
  });

  it('leaves a running attempt untouched when a launch failure is reported by a replayed start-run', async () => {
    const tx = lockedAttemptTx(0);
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await service.failQueued(row.id, attemptId, {
      stage: 'LAUNCH',
      code: 'AUTHORIZATION_FAILED',
      message: 'The project report run could not start',
      retryable: true,
    });

    expect(tx.projectReportAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: attemptId,
          status: { in: ['QUEUED'] },
        }),
      }),
    );
    expect(tx.projectReportRequest.update).not.toHaveBeenCalled();
  });

  it('reports a lost bind instead of failing the attempt another preparation bound', async () => {
    const tx = lockedAttemptTx(0);
    prisma.db.$transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      service.bindExecution(row.id, attemptId, agentSessionId, conversationId),
    ).resolves.toBe(false);
    expect(tx.projectReportAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: attemptId,
        requestId: row.id,
        status: 'QUEUED',
        agentSessionId: null,
        conversationId: null,
      },
      data: { agentSessionId, conversationId },
    });
  });

  it('marks the attempt running inside the caller transaction that commits the start-run', async () => {
    const tx = lockedAttemptTx(1);

    await service.markRunningInTransaction(
      tx as unknown as Prisma.TransactionClient,
      row.id,
      attemptId,
    );

    expect(prisma.db.$transaction).not.toHaveBeenCalled();
    expect(tx.projectReportAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'QUEUED' }),
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    );
    expect(tx.projectReportRequest.update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { status: 'RUNNING' },
    });
    await expect(
      service.markRunningInTransaction(
        lockedAttemptTx(0) as unknown as Prisma.TransactionClient,
        row.id,
        attemptId,
      ),
    ).rejects.toThrow('Report attempt cannot start');
  });

  it('rejects a second report for an attempt that already completed', async () => {
    const completed = {
      ...row,
      status: 'COMPLETED',
      attempts: [
        {
          ...row.attempts[0],
          status: 'COMPLETED',
          failedAt: null,
          failure: null,
          agentSessionId,
          conversationId,
          reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          completedAt: now,
        },
      ],
    };
    const tx = {
      $queryRaw: jest.fn(),
      projectReportRequest: {
        findFirst: jest.fn().mockResolvedValue(completed),
      },
    };
    await expect(
      service.assertReportSubmissionInTransaction(
        tx as unknown as Prisma.TransactionClient,
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
        userId,
        {
          ...projectReportPayload,
          question: submission.question,
          scope: submission.scope,
          exclusions: submission.exclusions,
          provenance: {
            ...projectReportPayload.provenance,
            requestId: row.id,
            attemptId,
          },
        },
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Project report attempt already completed',
        code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
        data: {
          code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
          requestId: row.id,
          attemptId,
          reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      },
    });
  });
});
