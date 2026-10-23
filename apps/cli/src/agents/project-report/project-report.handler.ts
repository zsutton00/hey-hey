import type { AgenticSession } from '../../session/types';
import {
  AgentSessionConfigProjectReportV1TypeEnum,
  AgentSessionConfigProjectReportV1VersionEnum,
  LocalPromptType,
  type AgentSessionConfigProjectReportV1,
  type RunCreatePayloadProjectReport,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  ProjectReportCoverageStatusEnum,
  ProjectReportKind,
  ProjectReportStatus,
  ReportAudience,
  ReportType,
} from '../../shared/api/generated/api';
import { extractOrganizationIdFromToken } from '../../auth';
import { resolveAgentProviderId } from '../providers/provider-config';
import {
  type PrepareResult,
  type PromptTypeHandler,
  type PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import {
  ProjectReportEvidenceReader,
  type ProjectReportEvidenceResult,
} from './project-report-evidence-reader';
import {
  planProjectReportGroups,
  type ProjectReportGroup,
  type ProjectReportGroupPlan,
} from './project-report-grouping';
import {
  buildProjectReportPrompt,
  type PreparedProjectReportPromptPayload,
} from './project-report-prompt';
import {
  ProjectReportRequestReader,
  type ProjectReportRequestProjection,
} from './project-report-request-reader';
import {
  PROJECT_REPORT_SECTION_HANDLER_ID,
  parseProjectReportSectionOutput,
  type ProjectReportMention,
  type ProjectReportSection,
  type ProjectReportSectionPayload,
} from './project-report-section.handler';
import { serializeProjectReportPreparedEvidence } from './project-report-submission';

type ProjectReportHandlerPayload = RunCreatePayloadProjectReport & {
  _projectReport?: PreparedProjectReportPromptPayload['_projectReport'];
};

/** Section children running at once; each holds its own provider session. */
const SECTION_CONCURRENCY = 4;
/** Graph reads a section child is told it may make; the host token budget is the hard stop. */
const SECTION_TOOL_CALL_BUDGET = 12;

const isPreparedPayload = (
  payload: ProjectReportHandlerPayload,
): payload is PreparedProjectReportPromptPayload => payload._projectReport !== undefined;

const readProjectReportConfig = (
  config: AgenticSession['config'],
): AgentSessionConfigProjectReportV1 => {
  if (
    config?.type !== AgentSessionConfigProjectReportV1TypeEnum.ProjectReport ||
    config.version !== AgentSessionConfigProjectReportV1VersionEnum.V1
  ) {
    throw new Error('project_report requires a validated PROJECT_REPORT v1 AgentSession config');
  }
  return config;
};

class ProjectReportHandler implements PromptTypeHandler<ProjectReportHandlerPayload> {
  public readonly id = 'project_report';
  public readonly promptType = LocalPromptType.ProjectReport;
  public readonly service = 'optional';
  public readonly launchEntity = 'none';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly readOnlyFilesystem = true;
  public readonly builtinTools = [] as const;
  public readonly mcpToolUseCase = 'project_report' as const;
  public readonly reports = [
    {
      reportType: ReportType.ProjectReport,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
  ] as const;
  public async prepare(
    run: AgenticSession,
    payload: ProjectReportHandlerPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<ProjectReportHandlerPayload>> {
    const config = readProjectReportConfig(run.config);
    this.validateSessionIsolation(run, payload, config, deps);

    deps.logger.info('project_report.handler.prepare.started', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      provider: run.provider,
      model: run.model ?? null,
    });

    const token = await deps.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      deps.logger.error('project_report.handler.prepare.organization_missing', {
        runId: run.agentic_session_id,
        requestId: payload.request.requestId,
        projectId: payload.request.projectId,
      });
      throw new Error('project_report could not resolve an organization from the active token');
    }

    const requestReader = new ProjectReportRequestReader({
      apiBaseUrl: deps.apiBaseUrl,
      fetchImpl: deps.fetchImpl,
      logger: deps.logger,
    });
    const request = await requestReader.read({
      token,
      organizationId,
      projectId: payload.request.projectId,
      requestId: payload.request.requestId,
      agentSessionId: run.agentic_session_id,
    });
    this.validateActiveRequest(run, payload, config, request, deps.logger);

    const evidenceReader = new ProjectReportEvidenceReader({
      apiBaseUrl: deps.apiBaseUrl,
      fetchImpl: deps.fetchImpl,
      logger: deps.logger,
    });
    const readEvidence = await evidenceReader.read({
      token,
      organizationId,
      projectId: payload.request.projectId,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      agentSessionId: run.agentic_session_id,
      request,
    });
    const groupPlan = planProjectReportGroups({ subjects: readEvidence.subjects });
    const { sections, mentions } = await this.writeSections(
      run,
      request,
      readEvidence,
      groupPlan,
      deps,
    );
    const evidence = this.withGroupCoverage(readEvidence, mentions);

    deps.logger.info('project_report.handler.prepare.completed', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      pagesRead: evidence.coverage.pagesRead,
      matchingActivityCount: evidence.coverage.matchingActivityCount,
      processedActivityCount: evidence.coverage.processedActivityCount,
      reportedSubjectCount: evidence.subjects.length,
      sectionCount: sections.length,
      mentionCount: mentions.length,
      coverageStatus: evidence.coverage.status,
    });

    return {
      payload: {
        ...payload,
        _projectReport: { request, evidence, sections, mentions },
      },
      // create_report stamps this host-computed coverage onto the submission.
      sessionContext: serializeProjectReportPreparedEvidence({
        requestId: payload.request.requestId,
        attemptId: payload.request.attemptId,
        evidence,
      }),
    };
  }

  public buildPrompt(payload: ProjectReportHandlerPayload): string {
    if (!isPreparedPayload(payload)) {
      throw new Error('project_report prompt was built before its request evidence was prepared');
    }
    return buildProjectReportPrompt(payload);
  }

  public buildStartingMessage(): string {
    return 'I’m gathering the authorized activity and current-state evidence for your report.';
  }

  /**
   * Runs one read-only section child per funded group, in rank order, each
   * stopped by the host at its token share. Groups outside the budget, and
   * groups whose child failed or ran out of budget, become mentions.
   */
  private async writeSections(
    run: AgenticSession,
    request: ProjectReportRequestProjection,
    evidence: ProjectReportEvidenceResult,
    groupPlan: ProjectReportGroupPlan,
    deps: PromptTypeHandlerDeps,
  ): Promise<{ sections: ProjectReportSection[]; mentions: ProjectReportMention[] }> {
    const mention = (
      group: ProjectReportGroup,
      reason: ProjectReportMention['reason'],
    ): ProjectReportMention => ({
      groupKey: group.key,
      kind: group.kind,
      title: group.title,
      subjectCount: group.subjects.length,
      changeCount: group.changeCount,
      reason,
    });
    const providerId = resolveAgentProviderId(run.provider);
    // SubAgent runs only Claude and Codex children.
    if (providerId !== 'claude' && providerId !== 'codex') {
      deps.logger.info('project_report.sections.skipped', {
        runId: run.agentic_session_id,
        provider: run.provider,
        groupCount: groupPlan.sections.length + groupPlan.mentions.length,
      });
      return {
        sections: [],
        mentions: [...groupPlan.sections.map(({ group }) => group), ...groupPlan.mentions].map(
          (group) => mention(group, 'PROVIDER_UNSUPPORTED'),
        ),
      };
    }

    deps.logger.info('project_report.sections.started', {
      runId: run.agentic_session_id,
      sectionCount: groupPlan.sections.length,
      mentionCount: groupPlan.mentions.length,
      totalTokenBudget: groupPlan.totalTokenBudget,
      parentTokenBudget: groupPlan.parentTokenBudget,
    });
    const referencesByKey = new Map(
      evidence.evidenceReferences.map((reference) => [reference.key, reference]),
    );
    const controller = new AbortController();
    const writeSection = async ({
      group,
      tokenBudget,
    }: ProjectReportGroupPlan['sections'][number]): Promise<
      ProjectReportSection | ProjectReportMention
    > => {
      const evidenceKeys = group.subjects.flatMap((subject) => [
        subject.latestActivityEvidenceKey,
        ...(subject.currentStateEvidenceKey ? [subject.currentStateEvidenceKey] : []),
      ]);
      const sectionPayload: ProjectReportSectionPayload = {
        request: {
          question: request.submission.question,
          scope: request.submission.scope,
          exclusions: request.submission.exclusions,
        },
        group: { key: group.key, kind: group.kind, title: group.title },
        subjects: group.subjects,
        evidenceReferences: evidenceKeys.flatMap((key) => {
          const reference = referencesByKey.get(key);
          return reference ? [reference] : [];
        }),
        toolCallBudget: SECTION_TOOL_CALL_BUDGET,
      };
      try {
        const result = await deps.childAgentLauncher.launchRegistered(
          PROJECT_REPORT_SECTION_HANDLER_ID,
          {
            parentSession: run,
            payload: sectionPayload,
            signal: controller.signal,
            serviceIds: [],
            ...(run.model ? { model: run.model } : {}),
            ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
            tokenBudget,
          },
        );
        const parsed = result.budgetExhausted
          ? null
          : parseProjectReportSectionOutput(result.outputText, new Set(evidenceKeys));
        deps.logger.info('project_report.section.completed', {
          runId: run.agentic_session_id,
          groupKind: group.kind,
          subjectCount: group.subjects.length,
          tokenBudget,
          budgetExhausted: result.budgetExhausted === true,
          sectionReturned: parsed !== null,
        });
        return parsed
          ? {
              groupKey: group.key,
              kind: group.kind,
              title: group.title,
              subjectCount: group.subjects.length,
              ...parsed,
            }
          : mention(group, result.budgetExhausted ? 'BUDGET_EXHAUSTED' : 'FAILED');
      } catch (error) {
        deps.logger.warn('project_report.section.failed', {
          runId: run.agentic_session_id,
          groupKind: group.kind,
          subjectCount: group.subjects.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return mention(group, 'FAILED');
      }
    };
    const queue = groupPlan.sections.map((funded, index) => ({ funded, index }));
    const completed: Array<{ index: number; result: ProjectReportSection | ProjectReportMention }> =
      [];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        completed.push({ index: item.index, result: await writeSection(item.funded) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, queue.length) }, worker));
    const results = completed.sort((a, b) => a.index - b.index).map(({ result }) => result);

    const isSection = (
      result: ProjectReportSection | ProjectReportMention,
    ): result is ProjectReportSection => 'html' in result;
    return {
      // A child that found nothing bearing on the question returns an empty section.
      sections: results
        .filter(isSection)
        .filter((section) => section.html.replace(/<[^>]*>/gu, '').trim().length > 0),
      mentions: [
        ...results.filter((result): result is ProjectReportMention => !isSection(result)),
        ...groupPlan.mentions.map((group) => mention(group, 'OUTSIDE_BUDGET')),
      ],
    };
  }

  /** Every group without its own section is a named coverage gap. */
  private withGroupCoverage(
    evidence: ProjectReportEvidenceResult,
    mentions: readonly ProjectReportMention[],
  ): ProjectReportEvidenceResult {
    if (mentions.length === 0) return evidence;
    const describe = (reason: ProjectReportMention['reason'], prefix: string): string[] => {
      const groups = mentions.filter((mention) => mention.reason === reason);
      if (groups.length === 0) return [];
      const subjectCount = groups.reduce((sum, group) => sum + group.subjectCount, 0);
      return [
        `${prefix} ${String(groups.length)} work group${groups.length === 1 ? '' : 's'} (${String(subjectCount)} subject${subjectCount === 1 ? '' : 's'}) ${groups.length === 1 ? 'is' : 'are'} only mentioned, without a section of their own: ${groups.map((group) => group.title).join('; ')}.`,
      ];
    };
    const limitations = [
      ...evidence.coverage.limitations,
      ...describe('OUTSIDE_BUDGET', 'The report token budget could not cover every work group;'),
      ...describe('BUDGET_EXHAUSTED', 'Section summaries ran out of their token share;'),
      ...describe('FAILED', 'Section summaries could not be written;'),
      ...describe('PROVIDER_UNSUPPORTED', 'Section summaries are not available for this provider;'),
    ];
    return {
      ...evidence,
      coverage: {
        ...evidence.coverage,
        status: ProjectReportCoverageStatusEnum.Incomplete,
        limitations,
      },
    };
  }

  private validateSessionIsolation(
    run: AgenticSession,
    payload: ProjectReportHandlerPayload,
    config: AgentSessionConfigProjectReportV1,
    deps: PromptTypeHandlerDeps,
  ): void {
    const invalid =
      payload.promptType !== LocalPromptType.ProjectReport ||
      payload.request.projectId !== run.contextMetadata.projectId ||
      config.requestId !== payload.request.requestId ||
      config.attemptId !== payload.request.attemptId ||
      config.model !== run.model ||
      run.services.length !== 0 ||
      run.launchServiceId !== undefined ||
      run.worktree !== undefined ||
      run.worktreeState !== undefined;
    if (!invalid) return;

    deps.logger.error('project_report.handler.prepare.isolation_or_identity_invalid', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      sessionProjectId: run.contextMetadata.projectId,
      serviceCount: run.services.length,
      hasLaunchServiceId: run.launchServiceId !== undefined,
      hasWorktree: run.worktree !== undefined,
      hasWorktreeState: run.worktreeState !== undefined,
    });
    throw new Error(
      'project_report launch identity or service-free session boundary did not match its signed payload',
    );
  }

  private validateActiveRequest(
    run: AgenticSession,
    payload: ProjectReportHandlerPayload,
    config: AgentSessionConfigProjectReportV1,
    request: Awaited<ReturnType<ProjectReportRequestReader['read']>>,
    logger: PromptTypeHandlerDeps['logger'],
  ): void {
    const latestAttempt = request.attempts.at(-1);
    const launch = request.submission.launch;
    const failures = {
      kindMismatch: request.kind !== ProjectReportKind.ProjectReport,
      requestNotRunning: request.status !== ProjectReportStatus.Running,
      attemptNotLatest: latestAttempt?.id !== payload.request.attemptId,
      attemptNotRunning: latestAttempt?.status !== ProjectReportStatus.Running,
      attemptSessionMismatch: latestAttempt?.agentSessionId !== run.agentic_session_id,
      scopeProjectMismatch: request.submission.scope.projectId !== payload.request.projectId,
      providerMismatch: launch.provider !== run.provider,
      modelMismatch: launch.model !== config.model || config.model !== run.model,
      configuredEffortMismatch: config.effort !== undefined && config.effort !== launch.effort,
      sessionEffortMismatch:
        run.reasoningEffort !== undefined && run.reasoningEffort !== launch.effort,
      configuredFastModeMismatch:
        config.fastMode !== undefined && config.fastMode !== launch.fastMode,
      sessionFastModeMismatch: run.fastMode !== undefined && run.fastMode !== launch.fastMode,
    };
    const invalid = Object.values(failures).some(Boolean);
    if (!invalid) return;

    // Request content and evidence stay out of logs. The checks and identities
    // make failures diagnosable without copying report subjects into logs.
    logger.error('project_report.handler.prepare.active_request_invalid', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      latestAttemptId: latestAttempt?.id ?? null,
      failures,
    });
    throw new Error(
      'project_report durable request, active attempt, provider, or launch configuration did not match the signed AgentSession',
    );
  }
}

export const projectReportHandler = new ProjectReportHandler();
