import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AgentSessionStatus as PrismaAgentSessionStatus,
  AgentSessionType as PrismaAgentSessionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  WorkflowName,
  type ConversationStartRunRequestDto,
  type CreateReportDto,
  type EvalAttemptReportPayload,
  type EvalRecordedAttempt,
  type EvalRunCaseInput,
  type EvalRunReportPayload,
  type EvalRunSettings,
  type LaunchEvalRunRequest,
  type ReportDto,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  AgentSessionId,
  ConversationId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import { AgentSessionService } from '../agent-session.service';
import { ReportService } from '../reports/report.service';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';
import { toEvalRunCaseInput } from './eval-case-input.mapper';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EVAL_RUN_HANDLER_PROMPT_TYPE = 'run_eval';
export const DEFAULT_MAX_CONCURRENT_ATTEMPTS = 3;

type RecordedRun = {
  runId: string;
  evalId: string;
  status: string;
  conversationId: string | null;
  judgeSetup: EvalRunReportPayload['judgeSetup'];
  settings: EvalRunSettings;
  attempts: EvalRecordedAttempt[];
};

@Injectable()
export class EvalRunService {
  private readonly logger = new Logger(EvalRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
    @Inject(forwardRef(() => AgentSessionService))
    private readonly sessions: AgentSessionService,
  ) {}

  /**
   * Records what is being run and prepares the coordinator session and
   * conversation, plus one target session and conversation per attempt. No
   * agent is started: the app starts the coordinator, which runs each
   * attempt's target under that attempt's session.
   */
  async launch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    evalId: string,
    request: LaunchEvalRunRequest,
  ): Promise<ReportDto> {
    this.logger.log('Launching eval run', {
      organizationId,
      projectId,
      evalId,
      caseCount: request.evalCaseIds.length,
      configurationCount: request.configurations.length,
    });
    this.assertRequestShape(request);
    this.assertDistinct(
      request.evalCaseIds,
      'evalCaseIds must not repeat a case',
    );
    this.assertDistinct(
      request.configurations.map((configuration) => configuration.id),
      'configurations must have distinct ids',
    );

    const evalItem = await this.prisma.db.task.findFirst({
      where: {
        id: evalId as TaskId,
        organizationId,
        projectId,
        type: WORK_ITEM_TYPE_KEYS.Eval,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!evalItem) {
      throw new NotFoundException('Eval not found');
    }

    const cases = await this.prisma.db.task.findMany({
      where: {
        id: { in: request.evalCaseIds as TaskId[] },
        organizationId,
        projectId,
        parentTaskId: evalId,
        type: WORK_ITEM_TYPE_KEYS.EvalCase,
        status: 'ACTIVE',
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        sections: { select: { key: true, materializedMarkdown: true } },
      },
    });
    const approved = new Set<string>(cases.map((candidate) => candidate.id));
    const rejected = request.evalCaseIds.filter((id) => !approved.has(id));
    if (rejected.length > 0) {
      this.logger.warn('Rejected eval run launch: cases are not approved', {
        evalId,
        rejected,
      });
      throw new BadRequestException(
        `Not approved cases of this Eval: ${rejected.join(', ')}`,
      );
    }
    const casesById = new Map<string, (typeof cases)[number]>(
      cases.map((candidate) => [candidate.id, candidate]),
    );
    const caseInputs = request.evalCaseIds.map((id) =>
      toEvalRunCaseInput(casesById.get(id)!),
    );

    const settings = this.resolveSettings(request.settings);

    const { agentSessionId, conversationId } = await this.prepareSession(
      organizationId,
      projectId,
      userId,
      { title: `Eval run: ${evalItem.name}`, conversationTitle: 'Eval run' },
    );
    const preparedSessionIds: AgentSessionId[] = [agentSessionId];

    const runId = randomUUID();
    const runPayload = {
      reportType: ReportType.EvalRun,
      summary: `Eval run of ${caseInputs.length} case(s) across ${request.configurations.length} setup(s) on ${evalItem.name}`,
      evalId,
      status: 'QUEUED',
      judgeSetup: request.judgeSetup,
      cases: caseInputs,
      configurations: request.configurations,
      settings,
      coordinatorAgentSessionId: agentSessionId,
      coordinatorConversationId: conversationId,
    } satisfies EvalRunReportPayload;

    const run = await this.recordRun(
      organizationId,
      preparedSessionIds,
      async () => {
        const attemptPayloads: EvalAttemptReportPayload[] = [];
        for (const caseInput of caseInputs) {
          for (const configuration of request.configurations) {
            const summary = `${caseInput.title} on ${configuration.target.model}`;
            const target = await this.prepareSession(
              organizationId,
              projectId,
              userId,
              {
                title: `Eval attempt: ${summary}`,
                conversationTitle: 'Eval attempt',
              },
              caseInput.target.focalItemId,
            );
            preparedSessionIds.push(target.agentSessionId);
            attemptPayloads.push({
              reportType: ReportType.EvalAttempt,
              summary,
              caseInputId: caseInput.id,
              configuration,
              status: 'QUEUED',
              measurements: [],
              targetSessionId: target.agentSessionId,
              targetConversationId: target.conversationId,
            } satisfies EvalAttemptReportPayload);
          }
        }
        return this.prisma.db.$transaction(async (client) => {
          const tx = client as unknown as Prisma.TransactionClient;
          const created = await this.reports.createWithIdInTransaction(
            tx,
            organizationId,
            runId,
            this.recordDto(projectId, evalId, runPayload),
          );
          for (const attemptPayload of attemptPayloads) {
            await this.reports.createWithIdInTransaction(
              tx,
              organizationId,
              randomUUID(),
              {
                ...this.recordDto(projectId, evalId, attemptPayload),
                parentReportId: runId,
              },
            );
          }
          return created;
        });
      },
    );

    this.logger.log('Launched eval run', {
      evalId,
      runId,
      attemptCount: caseInputs.length * request.configurations.length,
      agentSessionId,
      conversationId,
    });
    return run;
  }

  /**
   * Gate for the app's start of an eval coordinator session. Returns false when
   * the start is not an eval start at all; throws when it is one and does not
   * match exactly what launch recorded. A same-operation replay of an accepted
   * start is let through after the run has left QUEUED.
   */
  async assertStartRun(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    conversationId: string;
    requestDto: ConversationStartRunRequestDto;
  }): Promise<boolean> {
    const { requestDto } = input;
    const run = await this.findRunByCoordinatorSession(
      input.organizationId,
      requestDto.agentSessionId,
    );
    const claimsEval =
      requestDto.handlerPromptType === EVAL_RUN_HANDLER_PROMPT_TYPE ||
      requestDto.payload?.promptType === EVAL_RUN_HANDLER_PROMPT_TYPE;
    if (!run) {
      if (claimsEval) {
        throw new ConflictException('Eval start has no recorded run');
      }
      return false;
    }
    if (!claimsEval) {
      throw new ConflictException(
        'An eval run session can only be started with the run_eval handler',
      );
    }
    const payload = requestDto.payload;
    if (payload?.promptType !== EVAL_RUN_HANDLER_PROMPT_TYPE) {
      throw new ConflictException(
        'Start-run does not match the recorded eval run',
      );
    }

    const session = await this.prisma.db.agentSession.findUnique({
      where: { id: requestDto.agentSessionId },
      select: { userId: true },
    });
    if (session?.userId !== input.userId) {
      this.logger.warn('Rejected eval start-run: caller did not launch it', {
        runId: run.id,
        userId: input.userId,
      });
      throw new ForbiddenException(
        'Only the person who launched an eval run can start it',
      );
    }

    const recorded = await this.loadRecordedRun(input.organizationId, run);
    const replay =
      recorded.status !== 'QUEUED' && (await this.isAcceptedReplay(requestDto));
    const mismatches = [
      ['project', run.projectId === input.projectId],
      ['conversation', recorded.conversationId === input.conversationId],
      ['status', recorded.status === 'QUEUED' || replay],
      [
        'focal entity',
        payload.entity?.entityType === 'TASK' &&
          payload.entity.entityId === recorded.evalId,
      ],
      ['evalRunId', payload.evalRunId === recorded.runId],
      [
        'judgeSetup',
        isDeepStrictEqual(payload.judgeSetup, recorded.judgeSetup),
      ],
      ['settings', isDeepStrictEqual(payload.settings, recorded.settings)],
      [
        'attempts',
        isDeepStrictEqual(
          this.sortedAttempts(payload.attempts),
          this.sortedAttempts(recorded.attempts),
        ),
      ],
    ]
      .filter(([, matches]) => !matches)
      .map(([field]) => field);
    if (mismatches.length > 0) {
      this.logger.warn('Rejected eval start-run: differs from recorded run', {
        runId: recorded.runId,
        mismatches,
      });
      throw new ConflictException(
        `Start-run does not match the recorded eval run: ${mismatches.join(', ')}`,
      );
    }
    this.logger.log('Accepted eval start-run', {
      runId: recorded.runId,
      replay,
    });
    return true;
  }

  private async isAcceptedReplay(
    requestDto: ConversationStartRunRequestDto,
  ): Promise<boolean> {
    const recordedOperation = await this.prisma.db.agentOperation.findUnique({
      where: { operationId: requestDto.operationId },
      select: { agentSessionId: true, fingerprint: true },
    });
    return (
      recordedOperation?.agentSessionId === requestDto.agentSessionId &&
      recordedOperation?.fingerprint === requestDto.operationFingerprint
    );
  }

  /**
   * Prepares the attempts' target sessions and writes the run and its
   * attempts. Every session must exist before the run record can name it, so
   * a failure removes all sessions prepared so far rather than leaving
   * unbound sessions behind.
   */
  private async recordRun(
    organizationId: OrganizationId,
    preparedSessionIds: readonly AgentSessionId[],
    write: () => Promise<ReportDto>,
  ): Promise<ReportDto> {
    try {
      return await write();
    } catch (error) {
      this.logger.warn('Eval run write failed; removing prepared sessions', {
        agentSessionIds: preparedSessionIds,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const agentSessionId of preparedSessionIds) {
        await this.sessions.remove(organizationId, agentSessionId);
      }
      throw error;
    }
  }

  private resolveSettings(
    requested: LaunchEvalRunRequest['settings'],
  ): EvalRunSettings {
    const settings: EvalRunSettings = {
      maxConcurrentAttempts:
        requested?.maxConcurrentAttempts ?? DEFAULT_MAX_CONCURRENT_ATTEMPTS,
      ...(requested?.attemptTimeLimitSeconds !== undefined
        ? { attemptTimeLimitSeconds: requested.attemptTimeLimitSeconds }
        : {}),
      ...(requested?.attemptTokenLimit !== undefined
        ? { attemptTokenLimit: requested.attemptTokenLimit }
        : {}),
    };
    const isPositiveInteger = (value: number | undefined): boolean =>
      value === undefined || (Number.isInteger(value) && value >= 1);
    if (
      !isPositiveInteger(settings.maxConcurrentAttempts) ||
      !isPositiveInteger(settings.attemptTimeLimitSeconds) ||
      !isPositiveInteger(settings.attemptTokenLimit)
    ) {
      throw new BadRequestException(
        'Run settings must be whole numbers of at least 1',
      );
    }
    return settings;
  }

  private recordDto(
    projectId: ProjectId,
    evalId: string,
    payload: EvalRunReportPayload | EvalAttemptReportPayload,
  ): CreateReportDto {
    return {
      projectId,
      audience: ReportAudience.ProjectVisible,
      neverExpires: true,
      reportType: payload.reportType,
      payload,
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: evalId,
          relation: ReportEntityRelation.Primary,
        },
      ],
    } as CreateReportDto;
  }

  private async prepareSession(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    names: { title: string; conversationTitle: string },
    focalItemId?: EvalRunCaseInput['target']['focalItemId'],
  ): Promise<{
    agentSessionId: AgentSessionId;
    conversationId: ConversationId;
  }> {
    const session = await this.prisma.db.$transaction((tx) =>
      this.sessions.createInTransaction(
        tx,
        {
          organization: { connect: { id: organizationId } },
          project: { connect: { id: projectId } },
          user: { connect: { id: userId } },
          status: PrismaAgentSessionStatus.NOT_STARTED,
          sessionDate: new Date(),
          title: names.title.slice(0, 200),
          type: PrismaAgentSessionType.PROJECT_CONVERSATION,
        },
        organizationId,
      ),
    );
    const { conversation } = await this.sessions.createConversationForSession(
      organizationId,
      projectId,
      session.id,
      {
        workflowType: WorkflowName.AgentSession,
        title: names.conversationTitle,
        // Entity Conversation validates this durable subject against the
        // attempt's focal Run entity, which the CLI also represents as TASK.
        ...(focalItemId
          ? { workflowAboutType: 'task', workflowAboutId: focalItemId }
          : {}),
      },
    );
    return {
      agentSessionId: session.id as AgentSessionId,
      conversationId: conversation.id as ConversationId,
    };
  }

  private async findRunByCoordinatorSession(
    organizationId: OrganizationId,
    agentSessionId: string,
  ) {
    return this.prisma.db.report.findFirst({
      where: {
        organizationId,
        reportType: 'EVAL_RUN',
        payload: {
          path: ['coordinatorAgentSessionId'],
          equals: agentSessionId,
        },
      },
      select: { id: true, projectId: true, payload: true },
    });
  }

  private async loadRecordedRun(
    organizationId: OrganizationId,
    run: { id: string; payload: unknown },
  ): Promise<RecordedRun> {
    const payload = run.payload as unknown as EvalRunReportPayload;
    const children = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        parentReportId: run.id,
        reportType: 'EVAL_ATTEMPT',
      },
      select: { id: true, payload: true },
    });
    const caseInputs = new Map<string, EvalRunCaseInput>(
      payload.cases.map((caseInput) => [caseInput.id, caseInput]),
    );
    return {
      runId: run.id,
      evalId: payload.evalId,
      status: payload.status,
      conversationId: payload.coordinatorConversationId,
      judgeSetup: payload.judgeSetup,
      settings: payload.settings,
      attempts: children.map((child) => {
        const attempt = child.payload as unknown as EvalAttemptReportPayload;
        return {
          attemptId: child.id,
          caseInput: caseInputs.get(attempt.caseInputId)!,
          configuration: attempt.configuration,
          targetSessionId: attempt.targetSessionId!,
          targetConversationId: attempt.targetConversationId!,
        };
      }),
    };
  }

  private sortedAttempts(
    attempts: readonly EvalRecordedAttempt[],
  ): EvalRecordedAttempt[] {
    return [...attempts].sort((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    );
  }

  private assertRequestShape(request: LaunchEvalRunRequest): void {
    const isUuid = (value: unknown): boolean =>
      typeof value === 'string' && UUID_PATTERN.test(value);
    if (
      !Array.isArray(request.evalCaseIds) ||
      request.evalCaseIds.length === 0 ||
      !request.evalCaseIds.every(isUuid)
    ) {
      throw new BadRequestException(
        'evalCaseIds must be a non-empty list of case ids',
      );
    }
    if (
      !Array.isArray(request.configurations) ||
      request.configurations.length === 0 ||
      !request.configurations.every(
        (configuration) =>
          isUuid(configuration?.id) &&
          configuration.target?.provider &&
          configuration.target?.model,
      )
    ) {
      throw new BadRequestException(
        'configurations must be a non-empty list of setups with an id, provider and model',
      );
    }
    if (!request.judgeSetup?.provider || !request.judgeSetup?.model) {
      throw new BadRequestException('judgeSetup requires a provider and model');
    }
  }

  private assertDistinct(values: readonly string[], message: string): void {
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(message);
    }
  }
}
