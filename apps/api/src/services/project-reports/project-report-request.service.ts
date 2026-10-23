import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectReportStatus as DbStatus } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type {
  CreateReportCompletedAttempt,
  CreateProjectReportRequestDto,
  ProjectReportAttempt,
  ProjectReportFailure,
  ProjectReportPayload,
  ProjectReportRequestDto,
  RetryProjectReportRequestDto,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import {
  ProjectReportActivityService,
  projectReportSubjectKey,
} from './project-report-activity.service';
import { failProjectReportAttemptInTransaction } from './project-report-attempt-transitions';

type RequestWithAttempts = Prisma.ProjectReportRequestGetPayload<{
  include: { attempts: true };
}>;

function semanticSubmission(value: CreateProjectReportRequestDto) {
  return {
    kind: value.kind ?? 'PROJECT_REPORT',
    serviceIds: value.serviceIds?.toSorted(),
    question: value.question,
    preset: value.preset,
    scope: {
      ...value.scope,
      windowStart: new Date(value.scope.windowStart).toISOString(),
      windowEnd: new Date(value.scope.windowEnd).toISOString(),
      activityTypes: value.scope.activityTypes?.toSorted(),
      sources: value.scope.sources?.toSorted(),
      includeAttentionEvents: value.scope.includeAttentionEvents ?? false,
    },
    exclusions: value.exclusions.map(projectReportSubjectKey).toSorted(),
    launch: value.launch,
    idempotencyKey: value.idempotencyKey,
  };
}

@Injectable()
export class ProjectReportRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly activity: ProjectReportActivityService,
  ) {}

  async create(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    submission: CreateProjectReportRequestDto,
  ): Promise<ProjectReportRequestDto> {
    const existing = await this.prisma.db.projectReportRequest.findUnique({
      where: {
        organizationId_projectId_userId_idempotencyKey: {
          organizationId,
          projectId,
          userId,
          idempotencyKey: submission.idempotencyKey,
        },
      },
      include: { attempts: true },
    });
    if (existing) return this.replay(existing, submission);

    const selection = await this.activity.select({
      organizationId,
      projectId,
      userId,
      scope: submission.scope,
      exclusions: submission.exclusions,
    });
    if (
      selection.subjects.length === 0 ||
      selection.subjects.every((row) => row.excluded)
    ) {
      throw new BadRequestException(
        'A project report needs at least one included subject',
      );
    }

    try {
      const created = await this.prisma.db.$transaction(async (tx) => {
        const inserted = await tx.projectReportRequest.create({
          data: {
            organizationId,
            projectId,
            userId,
            kind: submission.kind ?? 'PROJECT_REPORT',
            serviceIds: submission.serviceIds ?? Prisma.DbNull,
            question: submission.question,
            preset: submission.preset ?? Prisma.JsonNull,
            resolvedScope: {
              ...submission.scope,
              // Persist the effective value so retries and agent reads never
              // depend on the default at read time.
              includeAttentionEvents:
                submission.scope.includeAttentionEvents ?? false,
            } as unknown as Prisma.InputJsonValue,
            exclusions:
              submission.exclusions as unknown as Prisma.InputJsonValue,
            launchConfig: submission.launch as unknown as Prisma.InputJsonValue,
            idempotencyKey: submission.idempotencyKey,
            attempts: {
              create: {
                attemptNumber: 1,
                idempotencyKey: submission.idempotencyKey,
              },
            },
          },
        });
        return tx.projectReportRequest.findUniqueOrThrow({
          where: { id: inserted.id },
          include: { attempts: true },
        });
      });
      return this.toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.db.projectReportRequest.findUnique({
          where: {
            organizationId_projectId_userId_idempotencyKey: {
              organizationId,
              projectId,
              userId,
              idempotencyKey: submission.idempotencyKey,
            },
          },
          include: { attempts: true },
        });
        if (winner) return this.replay(winner, submission);
      }
      throw error;
    }
  }

  async get(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestId: string,
  ): Promise<ProjectReportRequestDto> {
    return this.toDto(
      await this.loadAuthorized(organizationId, projectId, userId, requestId),
    );
  }

  async loadAuthorized(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestId: string,
  ): Promise<RequestWithAttempts> {
    const accessible = await this.projectAccess.accessibleProjectIds(
      userId,
      organizationId,
    );
    if (!accessible.includes(projectId))
      throw new ForbiddenException('Project access has been revoked');
    const row = await this.prisma.db.projectReportRequest.findFirst({
      where: { id: requestId, organizationId, projectId, userId },
      include: { attempts: true },
    });
    if (!row) throw new NotFoundException('Project report request not found');
    return row;
  }

  async loadForAgentRead(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestId: string,
    attemptId: string,
    agentSessionId: string | undefined,
  ): Promise<{
    submission: CreateProjectReportRequestDto;
    attempt: ProjectReportAttempt;
  }> {
    const row = await this.prisma.db.projectReportRequest.findFirst({
      where: { id: requestId, organizationId, projectId, userId },
      include: { attempts: true },
    });
    if (!row) throw new NotFoundException('Project report request not found');
    const dto = this.toDto(row);
    const attempt = dto.attempts.at(-1);
    if (
      !attempt ||
      attempt.id !== attemptId ||
      attempt.agentSessionId !== agentSessionId ||
      attempt.status !== 'RUNNING'
    ) {
      throw new ConflictException(
        'The active report execution does not match this read',
      );
    }
    const accessible = await this.projectAccess.accessibleProjectIds(
      userId,
      organizationId,
    );
    if (!accessible.includes(projectId)) {
      await this.fail(requestId, attemptId, {
        stage: 'EVIDENCE',
        code: 'PROJECT_ACCESS_REVOKED',
        message: 'Project access was revoked during report generation',
        retryable: true,
      });
      throw new ForbiddenException('Project access has been revoked');
    }
    return { submission: dto.submission, attempt };
  }

  async retry(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestId: string,
    input: RetryProjectReportRequestDto,
  ): Promise<ProjectReportRequestDto> {
    await this.loadAuthorized(organizationId, projectId, userId, requestId);
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
      const row = await tx.projectReportRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { attempts: true },
      });
      const sameKey = row.attempts.find(
        (attempt) => attempt.idempotencyKey === input.idempotencyKey,
      );
      if (sameKey) {
        if (
          sameKey.attemptNumber === 1 ||
          row.attempts.find(
            (attempt) => attempt.attemptNumber === sameKey.attemptNumber - 1,
          )?.id !== input.expectedAttemptId
        ) {
          throw new ConflictException(
            'Retry key belongs to a different execution',
          );
        }
        return this.toDto(row);
      }
      const latest = row.attempts.toSorted(
        (a, b) => b.attemptNumber - a.attemptNumber,
      )[0];
      if (
        !latest ||
        latest.id !== input.expectedAttemptId ||
        latest.status !== DbStatus.FAILED
      ) {
        throw new ConflictException(
          'The expected failed attempt is no longer current',
        );
      }
      await tx.projectReportAttempt.create({
        data: {
          requestId,
          attemptNumber: latest.attemptNumber + 1,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.projectReportRequest.update({
        where: { id: requestId },
        data: { status: DbStatus.QUEUED },
      });
      const updated = await tx.projectReportRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { attempts: true },
      });
      return this.toDto(updated);
    });
  }

  /**
   * Binds a prepared session and conversation to the still-unbound current
   * attempt. Returns false when a concurrent preparation already bound it or
   * the attempt moved on, so the caller does not fail an execution it does not
   * own.
   */
  async bindExecution(
    requestId: string,
    attemptId: string,
    agentSessionId: string,
    conversationId: string,
  ): Promise<boolean> {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
      const latest = await tx.projectReportAttempt.findFirst({
        where: { requestId },
        orderBy: { attemptNumber: 'desc' },
        select: { id: true },
      });
      if (latest?.id !== attemptId) return false;
      const result = await tx.projectReportAttempt.updateMany({
        where: {
          id: attemptId,
          requestId,
          status: DbStatus.QUEUED,
          agentSessionId: null,
          conversationId: null,
        },
        data: { agentSessionId, conversationId },
      });
      return result.count === 1;
    });
  }

  /**
   * Runs inside the transaction that commits the START_RUN operation, so the
   * attempt is RUNNING exactly when a dispatchable operation exists.
   */
  async markRunningInTransaction(
    tx: Prisma.TransactionClient,
    requestId: string,
    attemptId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
    const latest = await tx.projectReportAttempt.findFirst({
      where: { requestId },
      orderBy: { attemptNumber: 'desc' },
      select: { id: true },
    });
    if (latest?.id !== attemptId)
      throw new ConflictException('Report attempt is no longer current');
    const result = await tx.projectReportAttempt.updateMany({
      where: {
        id: attemptId,
        requestId,
        status: DbStatus.QUEUED,
        agentSessionId: { not: null },
        conversationId: { not: null },
      },
      data: { status: DbStatus.RUNNING, startedAt: new Date() },
    });
    if (result.count !== 1)
      throw new ConflictException('Report attempt cannot start');
    await tx.projectReportRequest.update({
      where: { id: requestId },
      data: { status: DbStatus.RUNNING },
    });
  }

  async fail(
    requestId: string,
    attemptId: string,
    failure: ProjectReportFailure,
  ): Promise<void> {
    await this.prisma.db.$transaction((tx) =>
      failProjectReportAttemptInTransaction(tx, requestId, attemptId, failure, [
        DbStatus.QUEUED,
        DbStatus.RUNNING,
      ]),
    );
  }

  /**
   * Fails a launch only while the attempt has not started. A start-run that
   * finds the attempt RUNNING is a replay of the launch that started it and
   * must not fail that run.
   */
  async failQueued(
    requestId: string,
    attemptId: string,
    failure: ProjectReportFailure,
  ): Promise<void> {
    await this.prisma.db.$transaction((tx) =>
      failProjectReportAttemptInTransaction(tx, requestId, attemptId, failure, [
        DbStatus.QUEUED,
      ]),
    );
  }

  async completeInTransaction(
    tx: Prisma.TransactionClient,
    reportId: string,
    organizationId: OrganizationId,
    projectId: string,
    sourceExecutionId: string,
    payload: ProjectReportPayload,
  ): Promise<void> {
    const { requestId, attemptId } = payload.provenance;
    await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
    const row = await tx.projectReportRequest.findFirst({
      where: { id: requestId, organizationId, projectId },
      include: { attempts: true },
    });
    if (!row)
      throw new ConflictException(
        'Project report request does not match the report',
      );
    const submission = this.toDto(row).submission;
    const latest = row.attempts.toSorted(
      (a, b) => b.attemptNumber - a.attemptNumber,
    )[0];
    if (
      !latest ||
      latest.id !== attemptId ||
      latest.agentSessionId !== sourceExecutionId ||
      latest.status !== DbStatus.RUNNING ||
      payload.question !== submission.question ||
      !isDeepStrictEqual(payload.preset, submission.preset) ||
      !isDeepStrictEqual(
        semanticSubmission({
          ...submission,
          scope: payload.scope,
          exclusions: payload.exclusions,
        }),
        semanticSubmission(submission),
      )
    ) {
      throw new ConflictException(
        'Project report provenance does not match the active accepted execution',
      );
    }
    const updated = await tx.projectReportAttempt.updateMany({
      where: { id: attemptId, status: DbStatus.RUNNING, reportId: null },
      data: { status: DbStatus.COMPLETED, reportId, completedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new ConflictException('Project report attempt already completed');
    await tx.projectReportRequest.update({
      where: { id: requestId },
      data: { status: DbStatus.COMPLETED },
    });
  }

  async assertReportSubmissionInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: string,
    sourceExecutionId: string,
    conversationId: string,
    callerUserId: UserId,
    payload: ProjectReportPayload,
  ): Promise<void> {
    const { requestId, attemptId } = payload.provenance;
    await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
    const row = await tx.projectReportRequest.findFirst({
      where: { id: requestId, organizationId, projectId, userId: callerUserId },
      include: { attempts: true },
    });
    if (!row)
      throw new ConflictException(
        'PROJECT_REPORT has no accepted request for this user and project',
      );
    const submission = this.toDto(row).submission;
    const latest = row.attempts.toSorted(
      (a, b) => b.attemptNumber - a.attemptNumber,
    )[0];
    if (
      latest?.id === attemptId &&
      latest.agentSessionId === sourceExecutionId &&
      latest.conversationId === conversationId &&
      latest.status === DbStatus.COMPLETED
    ) {
      if (!latest.reportId) {
        throw new ConflictException(
          'Completed project report attempt has no report',
        );
      }
      const data = {
        code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
        requestId,
        attemptId,
        reportId: latest.reportId,
      } satisfies CreateReportCompletedAttempt;
      throw new ConflictException({
        message: 'Project report attempt already completed',
        code: data.code,
        data,
      });
    }
    if (
      !latest ||
      latest.id !== attemptId ||
      latest.agentSessionId !== sourceExecutionId ||
      latest.conversationId !== conversationId ||
      latest.status !== DbStatus.RUNNING ||
      latest.reportId ||
      payload.question !== submission.question ||
      !isDeepStrictEqual(payload.preset, submission.preset) ||
      !isDeepStrictEqual(
        semanticSubmission({
          ...submission,
          scope: payload.scope,
          exclusions: payload.exclusions,
        }),
        semanticSubmission(submission),
      )
    ) {
      throw new ConflictException(
        'PROJECT_REPORT does not match the active accepted execution',
      );
    }
  }

  private replay(
    row: RequestWithAttempts,
    submission: CreateProjectReportRequestDto,
  ): ProjectReportRequestDto {
    const stored = this.toDto(row);
    if (
      !isDeepStrictEqual(
        semanticSubmission(stored.submission),
        semanticSubmission(submission),
      )
    ) {
      throw new ConflictException(
        'Idempotency key was reused with a different report request',
      );
    }
    return stored;
  }

  private toDto(row: RequestWithAttempts): ProjectReportRequestDto {
    const submission = {
      kind: row.kind,
      ...(row.serviceIds == null
        ? {}
        : { serviceIds: row.serviceIds as string[] }),
      question: row.question,
      ...(row.preset === null
        ? {}
        : {
            preset:
              row.preset as unknown as CreateProjectReportRequestDto['preset'],
          }),
      scope:
        row.resolvedScope as unknown as CreateProjectReportRequestDto['scope'],
      exclusions:
        row.exclusions as unknown as CreateProjectReportRequestDto['exclusions'],
      launch:
        row.launchConfig as unknown as CreateProjectReportRequestDto['launch'],
      idempotencyKey: row.idempotencyKey,
    } satisfies CreateProjectReportRequestDto;
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      userId: row.userId,
      kind: row.kind,
      submission,
      status: row.status,
      attempts: row.attempts
        .toSorted((a, b) => a.attemptNumber - b.attemptNumber)
        .map(
          (attempt) =>
            ({
              id: attempt.id,
              attemptNumber: attempt.attemptNumber,
              status: attempt.status,
              idempotencyKey: attempt.idempotencyKey,
              ...(attempt.agentSessionId
                ? { agentSessionId: attempt.agentSessionId }
                : {}),
              ...(attempt.conversationId
                ? { conversationId: attempt.conversationId }
                : {}),
              ...(attempt.reportId ? { reportId: attempt.reportId } : {}),
              createdAt: attempt.createdAt.toISOString(),
              ...(attempt.startedAt
                ? { startedAt: attempt.startedAt.toISOString() }
                : {}),
              ...(attempt.completedAt
                ? { completedAt: attempt.completedAt.toISOString() }
                : {}),
              ...(attempt.failedAt
                ? { failedAt: attempt.failedAt.toISOString() }
                : {}),
              ...(attempt.failure
                ? {
                    failure: attempt.failure as unknown as ProjectReportFailure,
                  }
                : {}),
            }) satisfies ProjectReportAttempt,
        ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies ProjectReportRequestDto;
  }
}
