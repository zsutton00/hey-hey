import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import {
  AgentSessionType,
  MachineExecutionReadinessState,
  type AgentSessionConfigProjectReportV1,
  type ConversationStartRunRequestDto,
  type CreateAgentSessionDto,
  type CreateAgentSessionConversationDto,
  type ProjectReportLaunchPayload,
  type ProjectReportRequestDto,
  type ProjectReportKind,
  type RunCreatePayloadProjectReport,
  type RunCreatePayloadReleaseNotes,
  WorkflowName,
} from 'src/generated';
import { MachinePresenceService } from 'src/core/websockets/machine-presence.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentSessionService } from '../agent-session.service';
import { MachineExecutionReadinessService } from '../machine-pairing/machine-execution-readiness.service';
import { ProjectReportRequestService } from './project-report-request.service';
import type { MachineId, OrganizationId, ProjectId, UserId } from 'src/types';

@Injectable()
export class ProjectReportLaunchService {
  private readonly logger = new Logger(ProjectReportLaunchService.name);

  constructor(
    private readonly sessions: AgentSessionService,
    private readonly readiness: MachineExecutionReadinessService,
    private readonly requests: ProjectReportRequestService,
    private readonly prisma: PrismaService,
    private readonly presence: MachinePresenceService,
  ) {}

  /**
   * Validate the accepted selection against project ownership and the same
   * Redis-backed bindings exposed by GET /machines.
   */
  async resolveReleaseNotesServiceIds(
    projectId: string,
    machineId: MachineId,
    selectedServiceIds: readonly string[] | undefined,
  ): Promise<string[]> {
    if (!selectedServiceIds?.length) {
      throw new ConflictException(
        'This release notes request has no saved repository selection',
      );
    }
    const services = await this.prisma.db.service.findMany({
      where: { projectId, archivedAt: null, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true },
    });
    const byId = new Map(services.map((service) => [service.id, service]));
    if (selectedServiceIds.some((id) => !byId.has(id))) {
      throw new ConflictException(
        'Selected repositories must be active Services in this project',
      );
    }
    const bound = new Set(
      ((await this.presence.getBindings(machineId))?.bindings ?? []).map(
        (binding) => binding.serviceId,
      ),
    );
    const missing = services.filter(
      (service) =>
        selectedServiceIds.includes(service.id) && !bound.has(service.id),
    );
    if (missing.length) {
      throw new ConflictException(
        `The selected machine does not have repositories for: ${missing.map((service) => service.name).join(', ')}`,
      );
    }
    return [...selectedServiceIds].toSorted();
  }

  /**
   * Prepares the current attempt's session and conversation unless they are
   * already bound. Safe to call on every same-key replay: a request persisted
   * before a crash (or before a lost response) resumes preparation, and an
   * already prepared attempt is returned for the client to start.
   */
  async prepare(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    request: ProjectReportRequestDto,
  ): Promise<void> {
    const attempt = request.attempts.at(-1)!;
    if (attempt.status !== 'QUEUED' || attempt.agentSessionId) return;
    const launch = request.submission.launch;
    let prepared: { agentSessionId: string; conversationId: string };
    try {
      const machine = await this.readiness.resolve({
        machineId: launch.machineId as MachineId,
        userId,
        organizationId,
      });
      if (
        machine?.executionReadiness !== MachineExecutionReadinessState.Ready
      ) {
        throw new ServiceUnavailableException(
          'Selected machine is not ready for a report run',
        );
      }
      if (request.kind === 'RELEASE_NOTES') {
        try {
          await this.resolveReleaseNotesServiceIds(
            projectId,
            launch.machineId as MachineId,
            request.submission.serviceIds,
          );
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          await this.requests.fail(request.id, attempt.id, {
            stage: 'LAUNCH',
            code: 'SERVICE_REPOSITORIES_UNAVAILABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Selected repositories are unavailable',
            retryable: false,
          });
          return;
        }
      }
      const config = {
        type: 'PROJECT_REPORT',
        version: 'v1',
        requestId: request.id,
        attemptId: attempt.id,
        model: launch.model,
        effort: launch.effort,
        ...(launch.fastMode !== undefined ? { fastMode: launch.fastMode } : {}),
      } satisfies AgentSessionConfigProjectReportV1;
      const session = await this.sessions.create(
        organizationId,
        projectId,
        userId,
        {
          projectId,
          sessionDate: new Date().toISOString(),
          title: `${request.kind === 'RELEASE_NOTES' ? 'Release notes' : 'Project report'}: ${request.submission.question.slice(0, 120)}`,
          type: AgentSessionType.ProjectReport,
          provider: launch.provider,
          config,
        } satisfies CreateAgentSessionDto,
      );
      await this.sessions.update(organizationId, session.id, {
        machineId: launch.machineId,
      });
      const { conversation } = await this.sessions.createConversationForSession(
        organizationId,
        projectId,
        session.id,
        {
          workflowType: WorkflowName.AgentSession,
          title:
            request.kind === 'RELEASE_NOTES'
              ? 'Release notes'
              : 'Project report',
        } satisfies CreateAgentSessionConversationDto,
      );
      prepared = {
        agentSessionId: session.id,
        conversationId: conversation.id,
      };
    } catch (error) {
      await this.requests.fail(request.id, attempt.id, {
        stage: 'LAUNCH',
        code: 'LAUNCH_PREPARATION_FAILED',
        message:
          error instanceof Error
            ? error.message
            : 'Report launch preparation failed',
        retryable: true,
      });
      return;
    }
    const bound = await this.requests.bindExecution(
      request.id,
      attempt.id,
      prepared.agentSessionId,
      prepared.conversationId,
    );
    if (!bound) {
      // A concurrent same-key submission prepared this attempt first; its
      // binding owns the launch. This preparation's session stays unbound.
      this.logger.warn('Project report launch preparation lost the bind', {
        requestId: request.id,
        attemptId: attempt.id,
        agentSessionId: prepared.agentSessionId,
        conversationId: prepared.conversationId,
      });
    }
  }

  async assertStartRun(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    conversationId: string;
    requestDto: ConversationStartRunRequestDto;
  }): Promise<{ requestId: string; attemptId: string } | undefined> {
    const attempt = await this.prisma.db.projectReportAttempt.findUnique({
      where: { agentSessionId: input.requestDto.agentSessionId },
      include: { request: true },
    });
    if (!attempt) {
      const session = await this.prisma.db.agentSession.findUnique({
        where: { id: input.requestDto.agentSessionId },
        select: { type: true },
      });
      if (
        session?.type === AgentSessionType.ProjectReport ||
        input.requestDto.handlerPromptType === 'project_report' ||
        input.requestDto.handlerPromptType === 'release_notes' ||
        input.requestDto.payload?.promptType === 'project_report' ||
        input.requestDto.payload?.promptType === 'release_notes'
      ) {
        throw new ConflictException(
          'Project report launch has no accepted request',
        );
      }
      return undefined;
    }
    const row = attempt.request;
    if (
      row.organizationId !== input.organizationId ||
      row.projectId !== input.projectId ||
      row.userId !== input.userId
    ) {
      throw new ConflictException(
        'Start-run does not match the accepted project report launch',
      );
    }
    const scope =
      row.resolvedScope as unknown as ProjectReportRequestDto['submission']['scope'];
    const launch =
      row.launchConfig as unknown as ProjectReportRequestDto['submission']['launch'];
    const kind: ProjectReportKind = row.kind;
    const promptType =
      kind === 'RELEASE_NOTES' ? 'release_notes' : 'project_report';
    const expectedPayload = {
      promptType,
      request: {
        requestId: row.id,
        attemptId: attempt.id,
        projectId: row.projectId,
      } satisfies ProjectReportLaunchPayload,
    } satisfies RunCreatePayloadProjectReport | RunCreatePayloadReleaseNotes;
    // Start-run must use the persisted selection, including on retries.
    let expectedServiceIds: string[] | undefined;
    if (kind === 'RELEASE_NOTES') {
      const serviceIds = await this.resolveReleaseNotesServiceIds(
        row.projectId,
        launch.machineId as MachineId,
        row.serviceIds === null ? undefined : (row.serviceIds as string[]),
      );
      expectedServiceIds = serviceIds;
    }
    const requestedServiceIds = input.requestDto.serviceIds?.toSorted();
    const serviceScopeMatches =
      expectedServiceIds === undefined
        ? input.requestDto.serviceIds === undefined &&
          input.requestDto.launchServiceId === undefined
        : isDeepStrictEqual(requestedServiceIds, expectedServiceIds) &&
          input.requestDto.launchServiceId !== undefined &&
          expectedServiceIds.includes(input.requestDto.launchServiceId);
    const expectedConfig = {
      type: 'PROJECT_REPORT',
      version: 'v1',
      requestId: row.id,
      attemptId: attempt.id,
      model: launch.model,
      effort: launch.effort,
      ...(launch.fastMode !== undefined ? { fastMode: launch.fastMode } : {}),
    } satisfies AgentSessionConfigProjectReportV1;
    const recordedOperation =
      attempt.status !== 'QUEUED'
        ? await this.prisma.db.agentOperation.findUnique({
            where: { operationId: input.requestDto.operationId },
            select: {
              agentSessionId: true,
              conversationId: true,
              fingerprint: true,
            },
          })
        : null;
    const replay =
      recordedOperation?.agentSessionId === attempt.agentSessionId &&
      recordedOperation?.conversationId === attempt.conversationId &&
      recordedOperation?.fingerprint === input.requestDto.operationFingerprint;
    if (
      scope.projectId !== input.projectId ||
      attempt.conversationId !== input.conversationId ||
      (attempt.status !== 'QUEUED' && !replay) ||
      input.requestDto.machineId !== launch.machineId ||
      input.requestDto.provider !== launch.provider ||
      input.requestDto.model !== launch.model ||
      input.requestDto.reasoningEffort !== launch.effort ||
      input.requestDto.fastMode !== launch.fastMode ||
      input.requestDto.handlerPromptType !== promptType ||
      input.requestDto.triggersAgent === false ||
      !serviceScopeMatches ||
      input.requestDto.worktree !== undefined ||
      !isDeepStrictEqual(input.requestDto.payload, expectedPayload) ||
      !isDeepStrictEqual(input.requestDto.config, expectedConfig) ||
      input.requestDto.contextMetadata.agentSessionId !==
        attempt.agentSessionId ||
      input.requestDto.contextMetadata.projectId !== input.projectId ||
      input.requestDto.contextMetadata.organizationId !== input.organizationId
    ) {
      throw new ConflictException(
        'Start-run does not match the accepted project report launch',
      );
    }
    return { requestId: row.id, attemptId: attempt.id };
  }

  async startAcceptedInTransaction(
    tx: Prisma.TransactionClient,
    requestId: string,
    attemptId: string,
  ): Promise<void> {
    await this.requests.markRunningInTransaction(tx, requestId, attemptId);
  }

  /** Fails only an attempt this start-run would have launched (still QUEUED). */
  async failLaunch(
    requestId: string,
    attemptId: string,
    code: string,
  ): Promise<void> {
    await this.requests.failQueued(requestId, attemptId, {
      stage: 'LAUNCH',
      code,
      message: 'The project report run could not start',
      retryable: true,
    });
  }
}
