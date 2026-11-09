import type { AgenticSession } from '../../session/types';
import {
  SessionRole,
  AgentSessionConfigProjectReportV1TypeEnum,
  AgentSessionConfigProjectReportV1VersionEnum,
  LocalPromptType,
  type AgentSessionConfigProjectReportV1,
  type RunCreatePayloadProjectReport,
} from '@hey-hey/contracts/agent-bridge';
import {
  ProjectReportKind,
  ProjectReportStatus,
  ReportAudience,
  ReportType,
} from '@hey-hey/contracts/api/models';
import { extractOrganizationIdFromToken } from '../../auth';
import { resolveAgentProviderId } from '../providers/provider-config';
import {
  type PrepareResult,
  type PromptTypeHandler,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import { readEvidenceShardTool } from '../submission-tools/read-evidence-shard-tool';
import { ProjectReportEvidenceReader } from './project-report-evidence-reader';
import {
  ProjectReportEvidenceLedger,
  evidenceDirectoryOf,
  projectReportEvidenceLedgers,
} from './project-report-evidence-store';
import {
  buildProjectReportPrompt,
  type PreparedProjectReportPromptPayload,
} from './project-report-prompt';
import { ProjectReportRequestReader } from './project-report-request-reader';
import { ProjectReportSectionRunner } from './project-report-section-runner';
import { serializeProjectReportPreparedEvidence } from './project-report-submission';

type ProjectReportHandlerPayload = RunCreatePayloadProjectReport & {
  _projectReport?: PreparedProjectReportPromptPayload['_projectReport'];
};

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
  public readonly sessionRole = SessionRole.Research;
  public readonly promptType = LocalPromptType.ProjectReport;
  public readonly service = 'optional';
  public readonly launchEntity = 'none';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly readOnlyFilesystem = true;
  public readonly builtinTools = [] as const;
  public readonly runEvidenceDirectory = true;
  public readonly submissionTools = [readEvidenceShardTool];
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
    ctx?: PromptTypeHandlerContext,
  ): Promise<PrepareResult<ProjectReportHandlerPayload>> {
    const runDirectory = ctx?.runEvidenceDirectory;
    if (!runDirectory) {
      throw new Error('project_report requires a Run-owned evidence directory');
    }
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
    const evidence = await evidenceReader.read(
      {
        token,
        organizationId,
        projectId: payload.request.projectId,
        requestId: payload.request.requestId,
        attemptId: payload.request.attemptId,
        agentSessionId: run.agentic_session_id,
        request,
      },
      runDirectory,
    );
    const ledger = new ProjectReportEvidenceLedger(
      evidenceDirectoryOf(runDirectory),
      evidence.manifest,
    );
    projectReportEvidenceLedgers.register(run.agentic_session_id, ledger);

    const parentShardIds = await this.readWithSections(run, request, ledger, deps);

    deps.logger.info('project_report.handler.prepare.completed', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      pagesRead: evidence.coverage.pagesRead,
      matchingActivityCount: evidence.coverage.matchingActivityCount,
      processedActivityCount: evidence.coverage.processedActivityCount,
      shardCount: evidence.manifest.shards.length,
      parentShardCount: parentShardIds.length,
      coverageStatus: evidence.coverage.status,
    });

    return {
      payload: {
        ...payload,
        _projectReport: {
          request,
          evidence,
          parentShardIds,
          findingsPublished: ledger.findingsPublished,
        },
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
   * Has a read-only child read each work group's shards and publishes what they
   * found for the parent. Returns the shards the parent must read itself: all of
   * them when the provider cannot run children, otherwise only those no child
   * managed to read.
   */
  private async readWithSections(
    run: AgenticSession,
    request: Awaited<ReturnType<ProjectReportRequestReader['read']>>,
    ledger: ProjectReportEvidenceLedger,
    deps: PromptTypeHandlerDeps,
  ): Promise<string[]> {
    const providerId = resolveAgentProviderId(run.provider);
    // SubAgent runs only Claude and Codex children.
    if (providerId !== 'claude' && providerId !== 'codex') {
      deps.logger.info('project_report.sections.skipped', {
        runId: run.agentic_session_id,
        provider: run.provider,
        shardCount: ledger.manifest.shards.length,
      });
      return ledger.manifest.shards.map((shard) => shard.id);
    }

    const { findings, parentShardIds } = await new ProjectReportSectionRunner(
      run,
      request,
      ledger,
      deps,
    ).runAll();
    if (findings.length > 0) {
      await ledger.publishFindings(findings);
    }
    return parentShardIds;
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
