import type { AgenticSession } from '../../session/types';
import {
  AgentSessionConfigProjectReportV1TypeEnum,
  AgentSessionConfigProjectReportV1VersionEnum,
  LocalPromptType,
  type AgentSessionConfigProjectReportV1,
  type RunCreatePayloadReleaseNotes,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  ProjectReportCoverageStatusEnum,
  ProjectReportKind,
  ProjectReportStatus,
  ReportAudience,
  ReportType,
} from '../../shared/api/generated/api';
import { extractOrganizationIdFromToken } from '../../auth';
import type {
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import {
  ProjectReportEvidenceReader,
  type ProjectReportEvidenceResult,
} from '../project-report/project-report-evidence-reader';
import {
  ProjectReportRequestReader,
  type ProjectReportRequestProjection,
} from '../project-report/project-report-request-reader';
import { serializeProjectReportPreparedEvidence } from '../project-report/project-report-submission';
import { readReleaseNotesRepository, type ReleaseNotesRepository } from './release-notes-git';
import {
  buildReleaseNotesPrompt,
  type PreparedReleaseNotesPromptPayload,
} from './release-notes-prompt';

type ReleaseNotesHandlerPayload = RunCreatePayloadReleaseNotes & {
  _releaseNotes?: PreparedReleaseNotesPromptPayload['_releaseNotes'];
};

const isPreparedPayload = (
  payload: ReleaseNotesHandlerPayload,
): payload is PreparedReleaseNotesPromptPayload => payload._releaseNotes !== undefined;

const readReportConfig = (config: AgenticSession['config']): AgentSessionConfigProjectReportV1 => {
  if (
    config?.type !== AgentSessionConfigProjectReportV1TypeEnum.ProjectReport ||
    config.version !== AgentSessionConfigProjectReportV1VersionEnum.V1
  ) {
    throw new Error('release_notes requires a validated PROJECT_REPORT v1 AgentSession config');
  }
  return config;
};

/**
 * The one report kind with repository access. The host refreshes and reads
 * each default branch's history and exports its tip into a Run-owned snapshot
 * directory, which the agent's read-only file tools read instead of the
 * Service checkouts; the agent never runs git. Graph evidence is read the
 * same way as project_report and only correlates and cites shipped changes.
 */
export class ReleaseNotesHandler implements PromptTypeHandler<ReleaseNotesHandlerPayload> {
  public readonly id = 'release_notes';
  public readonly promptType = LocalPromptType.ReleaseNotes;
  public readonly service = 'required';
  public readonly launchEntity = 'none';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly readOnlyFilesystem = true;
  public readonly repositorySnapshots = true;
  public readonly repositoryResearch = { delegation: 'disabled' as const };
  public readonly mcpToolUseCase = 'release_notes' as const;
  public readonly reports = [
    {
      reportType: ReportType.ProjectReport,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
  ] as const;

  public async prepare(
    run: AgenticSession,
    payload: ReleaseNotesHandlerPayload,
    deps: PromptTypeHandlerDeps,
    ctx?: PromptTypeHandlerContext,
  ): Promise<PrepareResult<ReleaseNotesHandlerPayload>> {
    const config = readReportConfig(run.config);
    this.validateSessionScope(run, payload, config, deps);
    const snapshotRoot = ctx?.repositorySnapshotDirectory;
    if (!snapshotRoot) {
      throw new Error('release_notes requires a Run-owned repository snapshot directory');
    }

    deps.logger.info('release_notes.handler.prepare.started', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      serviceCount: run.services.length,
    });

    const token = await deps.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      throw new Error('release_notes could not resolve an organization from the active token');
    }

    const request = await new ProjectReportRequestReader({
      apiBaseUrl: deps.apiBaseUrl,
      fetchImpl: deps.fetchImpl,
      logger: deps.logger,
    }).read({
      token,
      organizationId,
      projectId: payload.request.projectId,
      requestId: payload.request.requestId,
      agentSessionId: run.agentic_session_id,
    });
    this.validateActiveRequest(run, payload, config, request, deps.logger);

    const repositories = await Promise.all(
      run.services.map((service) =>
        readReleaseNotesRepository({
          serviceId: service.id,
          repositoryPath: service.path,
          windowStart: request.submission.scope.windowStart,
          windowEnd: request.submission.scope.windowEnd,
          snapshotRoot,
          logger: deps.logger,
        }),
      ),
    );
    const graphEvidence = await new ProjectReportEvidenceReader({
      apiBaseUrl: deps.apiBaseUrl,
      fetchImpl: deps.fetchImpl,
      logger: deps.logger,
    }).read({
      token,
      organizationId,
      projectId: payload.request.projectId,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      agentSessionId: run.agentic_session_id,
      request,
    });
    const evidence = this.withRepositoryCoverage(graphEvidence, repositories);

    deps.logger.info('release_notes.handler.prepare.completed', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      repositories: repositories.map((repository) =>
        repository.status === 'READ'
          ? {
              serviceId: repository.serviceId,
              defaultBranch: repository.defaultBranch,
              commitCount: repository.commits.length,
              commitsTruncated: repository.commitsTruncated,
              refresh: repository.refresh.status,
            }
          : { serviceId: repository.serviceId, status: repository.status },
      ),
      coverageStatus: evidence.coverage.status,
    });

    return {
      payload: { ...payload, _releaseNotes: { request, evidence, repositories } },
      // create_report stamps this host-computed coverage onto the submission.
      sessionContext: serializeProjectReportPreparedEvidence({
        requestId: payload.request.requestId,
        attemptId: payload.request.attemptId,
        evidence,
      }),
    };
  }

  public buildPrompt(payload: ReleaseNotesHandlerPayload): string {
    if (!isPreparedPayload(payload)) {
      throw new Error('release_notes prompt was built before its repositories were read');
    }
    return buildReleaseNotesPrompt(payload);
  }

  public buildStartingMessage(): string {
    return 'I’m reading what was merged into each repository’s default branch for your release notes.';
  }

  /** An unread or truncated repository means the notes may be missing shipped changes. */
  private withRepositoryCoverage(
    evidence: ProjectReportEvidenceResult,
    repositories: readonly ReleaseNotesRepository[],
  ): ProjectReportEvidenceResult {
    const limitations = repositories
      .flatMap((repository) =>
        repository.status === 'UNREADABLE'
          ? [`Repository ${repository.repositoryName} could not be read: ${repository.reason}`]
          : repository.commitsTruncated
            ? [
                `Only the latest ${String(repository.commits.length)} commits on ${repository.defaultBranch} in ${repository.repositoryName} were read.`,
              ]
            : [],
      )
      .concat(
        repositories.flatMap((repository) =>
          repository.status === 'READ' && repository.refresh.status === 'FAILED'
            ? [repository.refresh.reason]
            : [],
        ),
      );
    if (limitations.length === 0) return evidence;
    return {
      ...evidence,
      coverage: {
        ...evidence.coverage,
        status: ProjectReportCoverageStatusEnum.Incomplete,
        limitations: [...evidence.coverage.limitations, ...limitations],
      },
    };
  }

  private validateSessionScope(
    run: AgenticSession,
    payload: ReleaseNotesHandlerPayload,
    config: AgentSessionConfigProjectReportV1,
    deps: PromptTypeHandlerDeps,
  ): void {
    const invalid =
      payload.promptType !== LocalPromptType.ReleaseNotes ||
      payload.request.projectId !== run.contextMetadata.projectId ||
      config.requestId !== payload.request.requestId ||
      config.attemptId !== payload.request.attemptId ||
      config.model !== run.model ||
      run.services.length === 0 ||
      !run.services.some((service) => service.id === run.launchServiceId) ||
      run.worktree !== undefined ||
      run.worktreeState !== undefined;
    if (!invalid) return;

    deps.logger.error('release_notes.handler.prepare.scope_or_identity_invalid', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      projectId: payload.request.projectId,
      sessionProjectId: run.contextMetadata.projectId,
      serviceCount: run.services.length,
      hasLaunchServiceId: run.launchServiceId !== undefined,
      hasWorktree: run.worktree !== undefined,
    });
    throw new Error(
      'release_notes launch identity or Service repository scope did not match its signed payload',
    );
  }

  private validateActiveRequest(
    run: AgenticSession,
    payload: ReleaseNotesHandlerPayload,
    config: AgentSessionConfigProjectReportV1,
    request: ProjectReportRequestProjection,
    logger: PromptTypeHandlerDeps['logger'],
  ): void {
    const latestAttempt = request.attempts.at(-1);
    const launch = request.submission.launch;
    const failures = {
      repositorySelectionMismatch:
        !request.submission.serviceIds?.length ||
        request.submission.serviceIds.length !== run.services.length ||
        run.services.some((service) => !request.submission.serviceIds?.includes(service.id)),
      kindMismatch: request.kind !== ProjectReportKind.ReleaseNotes,
      requestNotRunning: request.status !== ProjectReportStatus.Running,
      attemptNotLatest: latestAttempt?.id !== payload.request.attemptId,
      attemptNotRunning: latestAttempt?.status !== ProjectReportStatus.Running,
      attemptSessionMismatch: latestAttempt?.agentSessionId !== run.agentic_session_id,
      scopeProjectMismatch: request.submission.scope.projectId !== payload.request.projectId,
      providerMismatch: launch.provider !== run.provider,
      modelMismatch: launch.model !== config.model || config.model !== run.model,
    };
    if (!Object.values(failures).some(Boolean)) return;

    logger.error('release_notes.handler.prepare.active_request_invalid', {
      runId: run.agentic_session_id,
      requestId: payload.request.requestId,
      attemptId: payload.request.attemptId,
      latestAttemptId: latestAttempt?.id ?? null,
      failures,
    });
    throw new Error(
      'release_notes durable request, active attempt, provider, or launch configuration did not match the signed AgentSession',
    );
  }
}

export const releaseNotesHandler = new ReleaseNotesHandler();
