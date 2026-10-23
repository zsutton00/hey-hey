import { z } from 'zod';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ProjectReportKind,
  ProjectReportLaunchConfigEffortEnum,
  ProjectReportProvider,
  ProjectReportStatus,
  ProjectReportsApiAxiosParamCreator,
  type ProjectReportRequestDto,
} from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';

export type ProjectReportRequestProjection = Pick<
  ProjectReportRequestDto,
  'id' | 'projectId' | 'kind' | 'submission' | 'status' | 'attempts'
>;

const projectReportSubjectSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().uuid(),
});

const projectReportRequestProjectionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: z.nativeEnum(ProjectReportKind),
  status: z.nativeEnum(ProjectReportStatus),
  submission: z.object({
    serviceIds: z.array(z.string().uuid()).min(1).optional(),
    question: z.string().min(1),
    preset: z
      .object({
        key: z.string(),
        prompt: z.string(),
        outline: z.string(),
      })
      .optional(),
    scope: z.object({
      projectId: z.string().uuid(),
      windowStart: z.string().min(1),
      windowEnd: z.string().min(1),
      timeZone: z.string().min(1),
      userId: z.string().uuid().optional(),
      activityTypes: z.array(z.nativeEnum(ActivityCorrelationActivityType)).optional(),
      sources: z.array(z.nativeEnum(ActivityCorrelationSource)).optional(),
    }),
    exclusions: z.array(projectReportSubjectSchema),
    launch: z.object({
      machineId: z.string().min(1),
      provider: z.nativeEnum(ProjectReportProvider),
      model: z.string().min(1),
      effort: z.nativeEnum(ProjectReportLaunchConfigEffortEnum),
      fastMode: z.boolean().optional(),
    }),
    idempotencyKey: z.string().min(1),
  }),
  attempts: z.array(
    z.object({
      id: z.string().uuid(),
      attemptNumber: z.number().int().positive(),
      status: z.nativeEnum(ProjectReportStatus),
      idempotencyKey: z.string().min(1),
      agentSessionId: z.string().uuid().optional(),
      reportId: z.string().min(1).optional(),
      createdAt: z.string().min(1),
      startedAt: z.string().min(1).optional(),
      completedAt: z.string().min(1).optional(),
    }),
  ),
});

const projectReportRequestResponseSchema = z.object({
  success: z.literal(true),
  data: projectReportRequestProjectionSchema,
});

export type ProjectReportRequestReadInput = {
  token: string;
  organizationId: string;
  projectId: string;
  requestId: string;
  agentSessionId: string;
};

class ProjectReportRequestReadError extends Error {
  public constructor(
    public readonly code: 'HTTP_ERROR' | 'INVALID_JSON' | 'INVALID_RESPONSE' | 'IDENTITY_MISMATCH',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProjectReportRequestReadError';
  }
}

export class ProjectReportRequestReader {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: ServerLogger;

  public constructor(options: {
    apiBaseUrl: string;
    fetchImpl: typeof fetch;
    logger: ServerLogger;
  }) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl;
    this.logger = options.logger;
  }

  public async read(input: ProjectReportRequestReadInput): Promise<ProjectReportRequestProjection> {
    this.logger.debug('project_report.request.read.started', {
      requestId: input.requestId,
      projectId: input.projectId,
      agentSessionId: input.agentSessionId,
    });
    const operation = await ProjectReportsApiAxiosParamCreator().getProjectReportRequest(
      input.organizationId,
      input.projectId,
      input.requestId,
    );
    const response = await this.fetchImpl(this.buildUrl(operation.url), {
      method: 'GET',
      headers: this.buildHeaders(input),
    });
    if (!response.ok) {
      this.logger.warn('project_report.request.read.failed', {
        requestId: input.requestId,
        projectId: input.projectId,
        status: response.status,
      });
      throw new ProjectReportRequestReadError(
        'HTTP_ERROR',
        `Project report request read returned HTTP ${response.status}`,
        response.status,
      );
    }

    const responseText = await response.text();
    let responseValue: unknown;
    try {
      responseValue = JSON.parse(responseText);
    } catch {
      throw new ProjectReportRequestReadError(
        'INVALID_JSON',
        'Project report request response was not valid JSON',
      );
    }

    const parsed = projectReportRequestResponseSchema.safeParse(responseValue);
    if (!parsed.success) {
      throw new ProjectReportRequestReadError(
        'INVALID_RESPONSE',
        'Project report request response did not match the generated request contract',
      );
    }
    const request = this.toProjection(parsed.data.data);
    if (request.id !== input.requestId || request.projectId !== input.projectId) {
      throw new ProjectReportRequestReadError(
        'IDENTITY_MISMATCH',
        'Project report request response identity did not match the signed launch identity',
      );
    }

    this.logger.debug('project_report.request.read.completed', {
      requestId: request.id,
      projectId: request.projectId,
      attemptCount: request.attempts.length,
      status: request.status,
    });
    return request;
  }

  private toProjection(
    value: z.infer<typeof projectReportRequestProjectionSchema>,
  ): ProjectReportRequestProjection {
    return {
      id: value.id,
      projectId: value.projectId,
      kind: value.kind,
      status: value.status,
      submission: {
        ...(value.submission.serviceIds !== undefined
          ? { serviceIds: value.submission.serviceIds }
          : {}),
        question: value.submission.question,
        ...(value.submission.preset !== undefined ? { preset: value.submission.preset } : {}),
        scope: {
          projectId: value.submission.scope.projectId,
          windowStart: value.submission.scope.windowStart,
          windowEnd: value.submission.scope.windowEnd,
          timeZone: value.submission.scope.timeZone,
          ...(value.submission.scope.userId !== undefined
            ? { userId: value.submission.scope.userId }
            : {}),
          ...(value.submission.scope.activityTypes !== undefined
            ? { activityTypes: value.submission.scope.activityTypes }
            : {}),
          ...(value.submission.scope.sources !== undefined
            ? { sources: value.submission.scope.sources }
            : {}),
        },
        exclusions: value.submission.exclusions,
        launch: {
          machineId: value.submission.launch.machineId,
          provider: value.submission.launch.provider,
          model: value.submission.launch.model,
          effort: value.submission.launch.effort,
          ...(value.submission.launch.fastMode !== undefined
            ? { fastMode: value.submission.launch.fastMode }
            : {}),
        },
        idempotencyKey: value.submission.idempotencyKey,
      },
      attempts: value.attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        idempotencyKey: attempt.idempotencyKey,
        ...(attempt.agentSessionId !== undefined ? { agentSessionId: attempt.agentSessionId } : {}),
        ...(attempt.reportId !== undefined ? { reportId: attempt.reportId } : {}),
        createdAt: attempt.createdAt,
        ...(attempt.startedAt !== undefined ? { startedAt: attempt.startedAt } : {}),
        ...(attempt.completedAt !== undefined ? { completedAt: attempt.completedAt } : {}),
      })),
    };
  }

  private buildUrl(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/u, '')}${path}`;
  }

  private buildHeaders(input: ProjectReportRequestReadInput): Record<string, string> {
    return {
      Authorization: `Bearer ${input.token}`,
      Accept: 'application/json',
      'X-Organization-ID': input.organizationId,
      'X-Project-ID': input.projectId,
      'X-Agent-Session-ID': input.agentSessionId,
    };
  }
}
