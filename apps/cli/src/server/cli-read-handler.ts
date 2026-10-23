import { createHash } from 'node:crypto';
import { canonicalizeJson } from '../shared/canonical-json';
import {
  CliReadErrorCode,
  type CliReadChangedFileDetail,
  type CliReadChangedFileInventoryEntry,
  type CliReadProjectSessionCostsListErrorResponseDto,
  type CliReadProjectSessionCostsListSuccessResponseDto,
  type CliReadProviderUsageGetErrorResponseDto,
  type CliReadProviderUsageGetSuccessResponseDto,
  type CliReadResponseDto,
  type CliReadRunChangedFilesCountErrorResponseDto,
  type CliReadRunChangedFilesCountSuccessResponseDto,
  type CliReadRunChangedFileDetailErrorResponseDto,
  type CliReadRunChangedFileDetailSuccessResponseDto,
  type CliReadRunChangedFilesInventoryErrorResponseDto,
  type CliReadRunChangedFilesInventorySuccessResponseDto,
  type CliReadRunContextUsageGetErrorResponseDto,
  type CliReadRunContextUsageGetSuccessResponseDto,
  type CliReadRunSkillsListErrorResponseDto,
  type CliReadRunSkillsListSuccessResponseDto,
  type CliReadRunToolCallsLatestTurnErrorResponseDto,
  type CliReadRunToolCallsLatestTurnSuccessResponseDto,
  type CliReadRuntimeModelCatalogGetErrorResponseDto,
  type CliReadRuntimeModelCatalogGetSuccessResponseDto,
} from '../shared/agent-bridge-contract/generated/api';
import type { RunRegistry } from '../run/run-registry';
import type { CanonicalFileChangeFact } from '../run/file-change-facts';
import type { RunStore } from '../run-store/run-store';
import type { RunChangedFilesDiagnosticEntry } from '../run-store/changed-files-diagnostics';
import type { AgenticSession } from '../session/types';
import type { LocalAgentService } from './local-agent-service';
import type { ServerLogger } from './logger';
import { RunChangedFilesContextError } from './run-changed-files';
import type { RunChangedFilesReader } from './run-changed-files';
import {
  createChangedFilesWorkspaceDiagnostic,
  getChangedFilesFailureClassification,
  getChangedFilesExitCode,
  safeChangedFilesErrorName,
  stableWorkspaceIdentity,
  type ChangedFilesReadFailureDiagnostic,
  type ChangedFilesReadPhase,
} from './changed-files-read-diagnostics';
import { RunReadPreparationError, RunReadRestoreCoordinator } from './restore-persisted-runs';
import { ProjectSessionCostsRequestError } from './services/project-session-costs.service';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import type { TriggerVerificationRuntime } from './trigger-verification/trigger-verification-runtime';
import type { VerifiedCliReadFrame } from './trigger-verification/verify';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';

import { RunFileContextReader } from './run-file-context-reader';
import { projectLatestTurnToolCalls } from './latest-turn-tool-calls';
import type { SessionActivitySource } from './session-activity-source';

const MAX_CHANGED_FILE_INVENTORY_ENTRIES = 100;
const MAX_CHANGED_FILE_PATCH_STRING_LENGTH = 1_048_576;
const MAX_CHANGED_FILE_PATH_LENGTH = 4_096;
const MAX_CHANGED_FILE_DETAIL_RESULT_BYTES = 3_200_000;
const MAX_SKILL_CATALOG_RESULT_BYTES = 1_048_576;
const MAX_MODEL_CATALOG_RESULT_BYTES = 1_048_576;

class ChangedFilesReadBoundsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ChangedFilesReadBoundsError';
  }
}

class ModelCatalogReadBoundsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogReadBoundsError';
  }
}

class SkillCatalogReadBoundsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SkillCatalogReadBoundsError';
  }
}

export interface CliReadHandlerDependencies {
  triggerVerificationRuntime: TriggerVerificationRuntime;
  runStore: RunStore;
  runRegistry: RunRegistry;
  runChangedFilesReader: RunChangedFilesReader;
  agentService: Pick<
    LocalAgentService,
    | 'listProjectSessionCosts'
    | 'readProviderUsage'
    | 'readRuntimeModelCatalog'
    | 'readRunContextUsage'
    | 'listRunSkills'
    | 'listWorkspaceSkills'
  >;
  sessionActivity: Pick<SessionActivitySource, 'snapshot'>;
  /** Read on every tool-call request so the options-screen setting takes effect immediately. */
  isRemoteToolCallViewingEnabled: () => Promise<boolean>;
  logger: ServerLogger;
  runReadRestoreCoordinator?: RunReadRestoreCoordinator;
  hostActionAdmission?: HostActionAdmission;
}

export class CliReadHandler {
  private readonly fileContextReader: RunFileContextReader;
  private readonly restoreCoordinator: RunReadRestoreCoordinator;

  public constructor(private readonly dependencies: CliReadHandlerDependencies) {
    this.fileContextReader = new RunFileContextReader(
      dependencies.runStore,
      dependencies.runRegistry,
      dependencies.logger,
    );
    this.restoreCoordinator =
      dependencies.runReadRestoreCoordinator ??
      new RunReadRestoreCoordinator({
        runStore: dependencies.runStore,
        runRegistry: dependencies.runRegistry,
        logger: dependencies.logger.child({ component: 'run-read-restore' }),
      });
  }

  public async handle(rawFrame: unknown): Promise<CliReadResponseDto | null> {
    const { logger, triggerVerificationRuntime } = this.dependencies;
    const verification = triggerVerificationRuntime.verifyCliReadFrame(rawFrame);
    if (!verification) {
      logger.warn('cli-read.frame.dropped', { reason: 'verifier_not_ready' });
      return null;
    }
    if (!verification.ok) {
      logger.warn('cli-read.frame.dropped', {
        reason: verification.reason,
        details: verification.details,
      });
      return null;
    }
    const admission = this.dependencies.hostActionAdmission;
    const authorization = verification.verified.envelope.authorization;
    const projectId = verification.verified.frame.projectId;
    if (
      verification.verified.envelope.protocolVersion !== 2 ||
      !admission ||
      !authorization ||
      !projectId
    ) {
      logger.warn('cli-read.frame.dropped', { reason: 'authority_not_ready' });
      return null;
    }
    if (
      verification.verified.body.operation === 'workspace.skills.list' ||
      verification.verified.body.operation === 'runtime.model_catalog.get'
    ) {
      const body = verification.verified.body;
      const { envelope, frame } = verification.verified;
      if (
        body.organizationId !== frame.organizationId ||
        body.projectId !== projectId ||
        body.machineId !== envelope.machineId
      )
        return null;
      const action = {
        requestId: body.authorizationRequestId,
        actionCategory: 'CLI_READ',
        actionType: 'CLI_READ',
        targetKind: 'CLI_READ',
        targetId: body.machineId,
        ...(body.operation === 'workspace.skills.list'
          ? {
              provider: body.provider,
              catalogContext:
                body.catalogContext.policy === 'non_repository'
                  ? { policy: 'non_repository' }
                  : { policy: 'service_workspace', serviceId: body.catalogContext.serviceId },
            }
          : {}),
      };
      const result = await admission.admit({
        machineId: envelope.machineId,
        userId: envelope.userId,
        organizationId: body.organizationId,
        projectId: body.projectId,
        actionCategory: 'CLI_READ',
        actionType: 'CLI_READ',
        actionPayloadHash: createHash('sha256').update(canonicalizeJson(action)).digest('hex'),
        target: { kind: 'CLI_READ', id: body.machineId, revision: null },
        agentSessionId: null,
        envelopeNonce: envelope.nonce,
        authorization,
      });
      if (!result.admitted) {
        logger.warn('cli-read.machine.denied', {
          operation: body.operation,
          reason: result.reason,
          requestId: body.requestId,
        });
        return null;
      }
      if (body.operation === 'workspace.skills.list') {
        return this.dependencies.agentService.listWorkspaceSkills(body, envelope.userId);
      }
      try {
        return await this.readRuntimeModelCatalog(verification.verified);
      } catch (error) {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        logger.error('cli-read.operation.failed', {
          requestId: body.requestId,
          operation: body.operation,
          error: resolvedError.message,
        });
        return this.toErrorResponse(verification.verified, resolvedError);
      }
    }
    const admissionResult = await admission.admit({
      machineId: verification.verified.envelope.machineId,
      userId: verification.verified.envelope.userId,
      organizationId: verification.verified.frame.organizationId,
      projectId,
      actionCategory: 'CLI_READ',
      actionType: 'CLI_READ',
      actionPayloadHash:
        authorization.kind === 'controller_assertion' ? authorization.intent.actionPayloadHash : '',
      target: {
        kind: 'AGENT_SESSION',
        id: verification.verified.body.agentSessionId,
        revision: null,
      },
      agentSessionId: verification.verified.body.agentSessionId,
      envelopeNonce: verification.verified.envelope.nonce,
      authorization,
    });
    if (!admissionResult.admitted) {
      logger.warn('cli-read.frame.dropped', { reason: admissionResult.reason });
      return null;
    }
    const { body } = verification.verified;
    logger.info('cli-read.operation.started', {
      requestId: body.requestId,
      operation: body.operation,
      agentSessionId: 'agentSessionId' in body ? body.agentSessionId : null,
      runId: 'runId' in body ? body.runId : null,
    });
    try {
      const response = await this.dispatchRead(verification.verified);
      logger.info('cli-read.operation.completed', {
        requestId: body.requestId,
        operation: body.operation,
        agentSessionId: 'agentSessionId' in body ? body.agentSessionId : null,
        runId: 'runId' in body ? body.runId : null,
      });
      return response;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      logger.error('cli-read.operation.failed', {
        requestId: body.requestId,
        operation: body.operation,
        agentSessionId: 'agentSessionId' in body ? body.agentSessionId : null,
        runId: 'runId' in body ? body.runId : null,
        error:
          body.operation === 'run.changed_files.count' ||
          body.operation === 'run.changed_files.inventory' ||
          body.operation === 'run.changed_files.detail'
            ? safeChangedFilesErrorName(resolvedError)
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return this.toErrorResponse(verification.verified, resolvedError);
    }
  }

  private async dispatchRead(verified: VerifiedCliReadFrame): Promise<CliReadResponseDto> {
    switch (verified.body.operation) {
      case 'run.changed_files.count':
        return this.readChangedFilesCount(verified);
      case 'run.changed_files.inventory':
        return this.readChangedFilesInventory(verified);
      case 'run.changed_files.detail':
        return this.readChangedFileDetail(verified);
      case 'project.session_costs.list':
        return this.readProjectSessionCosts(verified);
      case 'provider.usage.get':
        return this.readProviderUsage(verified);
      case 'run.context_usage.get':
        return this.readRunContextUsage(verified);
      case 'run.skills.list':
        return this.readRunSkills(verified);
      case 'run.tool_calls.latest_turn':
        return this.readRunToolCallsLatestTurn(verified);
      case 'workspace.skills.list':
      case 'runtime.model_catalog.get':
        throw new Error('Machine-addressed reads require machine-scoped admission');
    }
  }

  private async readChangedFilesCount(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunChangedFilesCountSuccessResponseDto> {
    if (verified.body.operation !== 'run.changed_files.count') {
      throw new Error('Expected a changed-files CLI read.');
    }
    const { body } = verified;
    const entries = await this.readChangedFiles(verified);
    this.dependencies.logger.debug('cli-read.changed_files.count_resolved', {
      requestId: body.requestId,
      runId: body.runId,
      changedFilesCount: entries.length,
    });
    return {
      requestId: body.requestId,
      operation: 'run.changed_files.count',
      status: 'success',
      result: { runId: body.runId, changedFilesCount: entries.length },
    };
  }

  private async readChangedFilesInventory(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunChangedFilesInventorySuccessResponseDto> {
    if (verified.body.operation !== 'run.changed_files.inventory') {
      throw new Error('Expected a changed-files inventory CLI read.');
    }
    const { body } = verified;
    const entries = this.assertBoundedInventory(await this.readChangedFiles(verified));
    this.dependencies.logger.debug('cli-read.changed_files.inventory_resolved', {
      requestId: body.requestId,
      runId: body.runId,
      entryCount: entries.length,
    });
    return {
      requestId: body.requestId,
      operation: 'run.changed_files.inventory',
      status: 'success',
      result: { runId: body.runId, entries },
    };
  }

  private async readChangedFileDetail(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunChangedFileDetailSuccessResponseDto> {
    if (verified.body.operation !== 'run.changed_files.detail') {
      throw new Error('Expected a changed-file detail CLI read.');
    }
    const { body } = verified;
    const inventory = await this.readChangedFiles(verified);
    const selected = inventory.find(
      (entry) =>
        entry.serviceId === body.file.serviceId &&
        entry.repoPath === body.file.repoPath &&
        entry.filePath === body.file.filePath,
    );
    if (!selected) {
      throw new RunChangedFilesContextError(
        `The selected file is not part of this Run's current changed-file inventory.`,
        body.file.serviceId,
        'INVALID_FILE_MEMBERSHIP',
      );
    }
    const run = await this.fileContextReader.read(body.runId);
    const file = this.assertBoundedDetail(
      await this.dependencies.runChangedFilesReader.getLiveRunChangedFileDetail(
        run.session,
        run.getFileChangeProjection(),
        body.file,
      ),
    );
    return {
      requestId: body.requestId,
      operation: 'run.changed_files.detail',
      status: 'success',
      result: { runId: body.runId, file },
    };
  }

  private async readChangedFiles(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadChangedFileInventoryEntry[]> {
    if (
      verified.body.operation !== 'run.changed_files.count' &&
      verified.body.operation !== 'run.changed_files.inventory' &&
      verified.body.operation !== 'run.changed_files.detail'
    ) {
      throw new Error('Expected a changed-files CLI read.');
    }
    const { body, frame } = verified;
    let readPhase: ChangedFilesReadPhase = 'restore';
    let session: AgenticSession | null = null;
    try {
      const run = await this.fileContextReader.read(body.runId, {
        onPhase: (phase) => {
          readPhase = phase;
        },
      });
      session = run.session;
      readPhase = 'normal_read';
      if (
        run.runId !== body.runId ||
        run.organizationId !== frame.organizationId ||
        run.projectId !== frame.projectId ||
        run.conversationId !== frame.conversationId
      ) {
        this.dependencies.logger.warn('cli-read.operation.context_mismatch', {
          requestId: body.requestId,
          runId: body.runId,
          signedOrganizationId: frame.organizationId,
          signedProjectId: frame.projectId,
          signedConversationId: frame.conversationId,
        });
        throw new RunReadPreparationError(
          'INVALID_RUN_CONTEXT',
          'The signed read context does not match the persisted Run.',
        );
      }
      const projection = run.getFileChangeProjection();
      let persistedFacts: CanonicalFileChangeFact[] | null = null;
      let diagnosticReadError: string | null = null;
      let diagnosticReadErrorName: string | null = null;
      try {
        persistedFacts = await this.dependencies.runStore.getFileChangeFacts(body.runId);
      } catch (error) {
        diagnosticReadError = error instanceof Error ? error.message : String(error);
        diagnosticReadErrorName = error instanceof Error ? error.name : 'NonError';
        this.dependencies.logger.warn('cli-read.changed_files.diagnostic_membership_read_failed', {
          requestId: body.requestId,
          agentSessionId: body.agentSessionId,
          runId: body.runId,
          errorName: diagnosticReadErrorName,
        });
      }

      const providerSessionIds = [
        ...new Set(persistedFacts?.map((fact) => fact.providerSessionId) ?? []),
      ];
      const turnIds = [...new Set(persistedFacts?.map((fact) => fact.turnId) ?? [])];
      this.dependencies.logger.info('cli-read.changed_files.membership_resolved', {
        requestId: body.requestId,
        operation: body.operation,
        agentSessionId: body.agentSessionId,
        runId: body.runId,
        provider: run.provider,
        providerSessionId: run.session.provider_session_id,
        persistedFactCount: persistedFacts?.length ?? null,
        projectionCount: projection.length,
        projection: projection.map((entry) => ({
          serviceId: entry.serviceId,
          repoRelativePath: entry.repoRelativePath,
        })),
        factProviderSessionIds: providerSessionIds,
        factTurnIds: turnIds,
        diagnosticReadError: diagnosticReadErrorName,
        services: run.session.services.map((service) => {
          const worktree = run.session.worktreeState?.[service.id] ?? null;
          return {
            serviceId: service.id,
            configuredWorkspaceIdentifier: stableWorkspaceIdentity(service.path),
            repositoryIdentity: worktree?.repoPath
              ? stableWorkspaceIdentity(worktree.repoPath)
              : stableWorkspaceIdentity(service.path),
            worktreeIdentity: worktree?.worktreePath
              ? stableWorkspaceIdentity(worktree.worktreePath)
              : null,
          };
        }),
        launchServiceId: run.session.launchServiceId,
        worktreeState: run.session.worktreeState
          ? Object.fromEntries(
              Object.entries(run.session.worktreeState).map(([serviceId, worktree]) => [
                serviceId,
                {
                  repositoryIdentity: stableWorkspaceIdentity(worktree.repoPath),
                  worktreeIdentity: stableWorkspaceIdentity(worktree.worktreePath),
                  branch: worktree.branch,
                },
              ]),
            )
          : null,
        workspaceIdentifier: stableWorkspaceIdentity(run.session.scope?.workspaceRoot),
        allowedRepositoryRootIdentities: (run.session.scope?.allowedRepositoryRoots ?? []).map(
          (root) => stableWorkspaceIdentity(root),
        ),
      });

      const entries = await this.dependencies.runChangedFilesReader.getLiveRunChangedFilesInventory(
        run.session,
        projection,
      );
      const diagnostic = {
        recordedAt: new Date().toISOString(),
        requestId: body.requestId,
        operation: body.operation,
        requestAgentSessionId: body.agentSessionId,
        runId: body.runId,
        signedContext: {
          organizationId: frame.organizationId,
          projectId: frame.projectId ?? null,
          conversationId: frame.conversationId ?? null,
        },
        runContext: {
          organizationId: run.organizationId,
          projectId: run.projectId,
          conversationId: run.conversationId,
          provider: run.provider,
          providerSessionId: run.session.provider_session_id,
        },
        membership: {
          persistedFactCount: persistedFacts?.length ?? null,
          projectionCount: projection.length,
          paths: projection.map((entry) => ({
            serviceId: entry.serviceId,
            repoRelativePath: entry.repoRelativePath,
          })),
          providerSessionIds,
          turnIds,
          diagnosticReadError,
        },
        workspace: {
          launchServiceId: run.session.launchServiceId ?? null,
          workspaceRoot: run.session.scope?.workspaceRoot ?? null,
          allowedRepositoryRoots: run.session.scope?.allowedRepositoryRoots ?? [],
          services: run.session.services.map((service) => {
            const worktree = run.session.worktreeState?.[service.id] ?? null;
            return {
              serviceId: service.id,
              configuredPath: service.path,
              worktreePath: worktree?.worktreePath ?? null,
              repositoryPath: worktree?.repoPath ?? null,
              branch: worktree?.branch ?? null,
            };
          }),
        },
        result: {
          changedFilesCount: entries.length,
          files: entries.map((entry) => ({
            serviceId: entry.serviceId,
            repoPath: entry.repoPath,
            filePath: entry.filePath,
          })),
        },
      } satisfies RunChangedFilesDiagnosticEntry;
      try {
        await this.dependencies.runStore.appendChangedFilesDiagnostic(
          body.runId,
          diagnostic,
          false,
        );
        this.dependencies.logger.debug('cli-read.changed_files.diagnostic_persisted', {
          requestId: body.requestId,
          runId: body.runId,
        });
      } catch (error) {
        this.dependencies.logger.warn('cli-read.changed_files.diagnostic_persist_failed', {
          requestId: body.requestId,
          runId: body.runId,
          errorName: error instanceof Error ? error.name : 'NonError',
        });
      }
      return entries;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      await this.logChangedFilesReadFailure({
        body,
        readPhase,
        session:
          session ??
          this.dependencies.runRegistry.get(body.runId)?.session ??
          (await this.readChangedFilesDiagnosticSession(body.runId)),
        error: resolvedError,
      });
      throw error;
    }
  }

  private async readChangedFilesDiagnosticSession(runId: string): Promise<AgenticSession | null> {
    try {
      return await this.dependencies.runStore.getRunMetadata(runId);
    } catch {
      return null;
    }
  }

  private async logChangedFilesReadFailure(input: {
    body: Extract<
      VerifiedCliReadFrame['body'],
      {
        operation:
          | 'run.changed_files.count'
          | 'run.changed_files.inventory'
          | 'run.changed_files.detail';
      }
    >;
    readPhase: ChangedFilesReadPhase;
    session: AgenticSession | null;
    error: Error;
  }): Promise<void> {
    const { body, error, readPhase, session } = input;
    const details = error instanceof RunChangedFilesContextError ? error.details : undefined;
    const serviceId = details?.workspace.serviceId ?? session?.launchServiceId ?? null;
    const service = session?.services.find((entry) => entry.id === serviceId) ?? null;
    const worktree = serviceId ? (session?.worktreeState?.[serviceId] ?? null) : null;
    const classification =
      details?.failureClassification ?? getChangedFilesFailureClassification(error);
    const workspaceResolutionStatus =
      details?.workspace.workspaceResolutionStatus ??
      (classification === 'INVALID_REPOSITORY_PATH'
        ? 'invalid'
        : classification === 'WORKSPACE_NOT_FOUND' || classification === 'WORKSPACE_UNAVAILABLE'
          ? 'unavailable'
          : classification === 'NOT_A_REPOSITORY'
            ? 'resolved'
            : 'failed');
    const workspace =
      details?.workspace ??
      createChangedFilesWorkspaceDiagnostic({
        session,
        serviceId,
        repoPath: worktree?.worktreePath ?? service?.path ?? null,
        workspaceResolutionStatus,
      });

    const diagnostic = {
      requestId: body.requestId,
      agentSessionId: body.agentSessionId,
      runId: body.runId,
      operation: body.operation,
      readPhase,
      sessionKind: workspace.sessionKind,
      promptType: session?.promptType ?? null,
      workspaceSource: workspace.workspaceSource,
      workspaceIdentifier: workspace.workspaceIdentifier,
      workspaceResolutionStatus: workspace.workspaceResolutionStatus,
      serviceId: workspace.serviceId,
      repositoryIdentity: workspace.repositoryIdentity,
      worktreeIdentity: workspace.worktreeIdentity,
      gitRootDetected: workspace.gitRootDetected,
      gitRootIdentity: workspace.gitRootIdentity,
      exitCode: details?.exitCode ?? getChangedFilesExitCode(error),
      failureClassification: classification,
      errorName: safeChangedFilesErrorName(error),
    } satisfies ChangedFilesReadFailureDiagnostic;
    this.dependencies.logger.error('cli-read.changed_files.read_failed', diagnostic);
  }

  private assertBoundedInventory(
    entries: readonly CliReadChangedFileInventoryEntry[],
  ): CliReadChangedFileInventoryEntry[] {
    if (entries.length > MAX_CHANGED_FILE_INVENTORY_ENTRIES) {
      throw new ChangedFilesReadBoundsError(
        `The changed-file inventory exceeds the ${String(
          MAX_CHANGED_FILE_INVENTORY_ENTRIES,
        )} file limit.`,
      );
    }
    for (const entry of entries) {
      if (
        entry.repoPath.length > MAX_CHANGED_FILE_PATH_LENGTH ||
        entry.filePath.length > MAX_CHANGED_FILE_PATH_LENGTH
      ) {
        throw new ChangedFilesReadBoundsError(
          `The changed-file inventory entry for ${entry.filePath} exceeds the response limit.`,
        );
      }
    }
    return [...entries];
  }

  private assertBoundedDetail(file: CliReadChangedFileDetail): CliReadChangedFileDetail {
    if (
      file.repoPath.length > MAX_CHANGED_FILE_PATH_LENGTH ||
      file.filePath.length > MAX_CHANGED_FILE_PATH_LENGTH ||
      file.diff.length > MAX_CHANGED_FILE_PATCH_STRING_LENGTH ||
      (file.preContent?.length ?? 0) > MAX_CHANGED_FILE_PATCH_STRING_LENGTH ||
      (file.postContent?.length ?? 0) > MAX_CHANGED_FILE_PATCH_STRING_LENGTH
    ) {
      throw new ChangedFilesReadBoundsError(
        `The changed-file detail for ${file.filePath} exceeds the response limit.`,
      );
    }
    if (
      Buffer.byteLength(JSON.stringify({ file }), 'utf8') > MAX_CHANGED_FILE_DETAIL_RESULT_BYTES
    ) {
      throw new ChangedFilesReadBoundsError(
        'The changed-file detail exceeds the response size limit.',
      );
    }
    return file;
  }

  private async readProjectSessionCosts(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadProjectSessionCostsListSuccessResponseDto> {
    if (verified.body.operation !== 'project.session_costs.list') {
      throw new Error('Expected a project-session Costs CLI read.');
    }
    const { body, frame } = verified;
    if (frame.projectId !== body.projectId) {
      this.dependencies.logger.warn('cli-read.project_session_costs.context_mismatch', {
        requestId: body.requestId,
        requestedProjectId: body.projectId,
        signedProjectId: frame.projectId ?? null,
      });
      throw new ProjectSessionCostsRequestError(
        'INVALID_PROJECT_CONTEXT',
        'The signed project does not match the requested Costs project.',
      );
    }
    const result = await this.dependencies.agentService.listProjectSessionCosts(
      body,
      frame.organizationId,
    );
    return {
      requestId: body.requestId,
      operation: 'project.session_costs.list',
      status: 'success',
      result,
    };
  }

  private async readProviderUsage(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadProviderUsageGetSuccessResponseDto> {
    if (verified.body.operation !== 'provider.usage.get') {
      throw new Error('Expected a provider-usage CLI read.');
    }
    const result = await this.dependencies.agentService.readProviderUsage();
    this.dependencies.logger.debug('cli-read.provider_usage.resolved', {
      requestId: verified.body.requestId,
      providerCount: result.providers.length,
      errorCount: result.providers.filter((provider) => provider.status === 'error').length,
    });
    return {
      requestId: verified.body.requestId,
      operation: 'provider.usage.get',
      status: 'success',
      result,
    };
  }

  private async readRuntimeModelCatalog(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRuntimeModelCatalogGetSuccessResponseDto> {
    if (verified.body.operation !== 'runtime.model_catalog.get') {
      throw new Error('Expected a model-catalog CLI read.');
    }
    const result = await this.dependencies.agentService.readRuntimeModelCatalog();
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_MODEL_CATALOG_RESULT_BYTES) {
      throw new ModelCatalogReadBoundsError('The model catalog exceeds the response size limit.');
    }
    this.dependencies.logger.debug('cli-read.model_catalog.resolved', {
      requestId: verified.body.requestId,
      providerCount: result.providers.length,
      modelCount: result.providers.reduce((total, provider) => total + provider.models.length, 0),
    });
    return {
      requestId: verified.body.requestId,
      operation: 'runtime.model_catalog.get',
      status: 'success',
      result,
    };
  }

  private async readRunContextUsage(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunContextUsageGetSuccessResponseDto> {
    if (verified.body.operation !== 'run.context_usage.get') {
      throw new Error('Expected a Run context-usage CLI read.');
    }
    const { body, frame } = verified;
    const run = await this.restoreCoordinator.restoreForContextUsage(body.runId);
    if (
      run.runId !== body.runId ||
      body.agentSessionId !== body.runId ||
      run.organizationId !== frame.organizationId ||
      run.projectId !== frame.projectId ||
      run.conversationId !== frame.conversationId
    ) {
      throw new RunReadPreparationError(
        'INVALID_RUN_CONTEXT',
        'The signed read context does not match the persisted Run.',
      );
    }
    const result = await this.dependencies.agentService.readRunContextUsage(
      run,
      body.providerSessionId,
    );
    return {
      requestId: body.requestId,
      operation: 'run.context_usage.get',
      status: 'success',
      result,
    };
  }

  private async readRunSkills(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunSkillsListSuccessResponseDto> {
    if (verified.body.operation !== 'run.skills.list') {
      throw new Error('Expected a Run Skill catalog CLI read.');
    }
    const { body, frame } = verified;
    const run = await this.restoreCoordinator.restore(body.runId);
    if (
      run.runId !== body.runId ||
      body.agentSessionId !== body.runId ||
      run.organizationId !== frame.organizationId ||
      run.projectId !== frame.projectId ||
      run.conversationId !== frame.conversationId
    ) {
      throw new RunReadPreparationError(
        'INVALID_RUN_CONTEXT',
        'The signed read context does not match the persisted Run.',
      );
    }
    const catalog = await this.dependencies.agentService.listRunSkills(run);
    const result = { runId: body.runId, ...catalog };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SKILL_CATALOG_RESULT_BYTES) {
      throw new SkillCatalogReadBoundsError('The Skill catalog exceeds the response size limit.');
    }
    this.dependencies.logger.debug('cli-read.skills.catalog_resolved', {
      requestId: body.requestId,
      runId: body.runId,
      provider: result.provider,
      skillCount: result.skills.length,
      discoveryErrorCount: result.errors.length,
    });
    return {
      requestId: body.requestId,
      operation: 'run.skills.list',
      status: 'success',
      result,
    };
  }

  private async readRunToolCallsLatestTurn(
    verified: VerifiedCliReadFrame,
  ): Promise<CliReadRunToolCallsLatestTurnSuccessResponseDto> {
    if (verified.body.operation !== 'run.tool_calls.latest_turn') {
      throw new Error('Expected a latest-Turn tool-call CLI read.');
    }
    const { body, frame } = verified;
    const run = await this.restoreCoordinator.restore(body.runId);
    if (
      run.runId !== body.runId ||
      body.agentSessionId !== body.runId ||
      run.organizationId !== frame.organizationId ||
      run.projectId !== frame.projectId ||
      run.conversationId !== frame.conversationId
    ) {
      throw new RunReadPreparationError(
        'INVALID_RUN_CONTEXT',
        'The signed read context does not match the persisted Run.',
      );
    }
    if (!(await this.dependencies.isRemoteToolCallViewingEnabled())) {
      this.dependencies.logger.debug('cli-read.tool_calls.disabled', {
        requestId: body.requestId,
        runId: body.runId,
      });
      return {
        requestId: body.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result: { state: 'disabled', runId: body.runId },
      };
    }
    const result = projectLatestTurnToolCalls({
      runId: body.runId,
      activeTurnId: run.activeTurn?.turnId ?? null,
      activity:
        this.dependencies.sessionActivity
          .snapshot()
          .runs.find((activity) => activity.runId === body.runId) ?? null,
    });
    this.dependencies.logger.debug('cli-read.tool_calls.resolved', {
      requestId: body.requestId,
      runId: body.runId,
      toolCallCount: result.toolCalls.length,
      omittedEarlierCount: result.omittedEarlierCount,
      evictedCount: result.evictedCount,
    });
    return {
      requestId: body.requestId,
      operation: 'run.tool_calls.latest_turn',
      status: 'success',
      result,
    };
  }

  private toErrorResponse(
    verified: VerifiedCliReadFrame,
    error: Error,
  ):
    | CliReadRunChangedFilesCountErrorResponseDto
    | CliReadRunChangedFilesInventoryErrorResponseDto
    | CliReadRunChangedFileDetailErrorResponseDto
    | CliReadProjectSessionCostsListErrorResponseDto
    | CliReadProviderUsageGetErrorResponseDto
    | CliReadRuntimeModelCatalogGetErrorResponseDto
    | CliReadRunContextUsageGetErrorResponseDto
    | CliReadRunSkillsListErrorResponseDto
    | CliReadRunToolCallsLatestTurnErrorResponseDto {
    const code = this.resolveErrorCode(error);
    const message =
      error instanceof RunReadPreparationError ||
      error instanceof RunChangedFilesContextError ||
      error instanceof ProjectSessionCostsRequestError ||
      error instanceof ChangedFilesReadBoundsError ||
      error instanceof SkillCatalogReadBoundsError ||
      error instanceof ModelCatalogReadBoundsError ||
      error instanceof AgentSessionRunnerError
        ? error.message
        : 'The CLI read failed.';
    if (verified.body.operation === 'project.session_costs.list') {
      return {
        requestId: verified.body.requestId,
        operation: 'project.session_costs.list',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'provider.usage.get') {
      return {
        requestId: verified.body.requestId,
        operation: 'provider.usage.get',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'runtime.model_catalog.get') {
      return {
        requestId: verified.body.requestId,
        operation: 'runtime.model_catalog.get',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'run.changed_files.inventory') {
      return {
        requestId: verified.body.requestId,
        operation: 'run.changed_files.inventory',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'run.changed_files.detail') {
      return {
        requestId: verified.body.requestId,
        operation: 'run.changed_files.detail',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'run.context_usage.get') {
      return {
        requestId: verified.body.requestId,
        operation: 'run.context_usage.get',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'run.skills.list') {
      return {
        requestId: verified.body.requestId,
        operation: 'run.skills.list',
        status: 'error',
        error: { code, message },
      };
    }
    if (verified.body.operation === 'run.tool_calls.latest_turn') {
      return {
        requestId: verified.body.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'error',
        error: { code, message },
      };
    }
    return {
      requestId: verified.body.requestId,
      operation: 'run.changed_files.count',
      status: 'error',
      error: { code, message },
    };
  }

  private resolveErrorCode(error: Error): CliReadErrorCode {
    if (error instanceof RunReadPreparationError) return error.code;
    if (error instanceof ProjectSessionCostsRequestError) return error.code;
    if (error instanceof ChangedFilesReadBoundsError) {
      return CliReadErrorCode.ResultTooLarge;
    }
    if (
      error instanceof SkillCatalogReadBoundsError ||
      error instanceof ModelCatalogReadBoundsError
    ) {
      return CliReadErrorCode.ResultTooLarge;
    }
    if (error instanceof AgentSessionRunnerError && error.code === 'NOT_SUPPORTED') {
      return CliReadErrorCode.ProviderUnavailable;
    }
    if (error instanceof RunChangedFilesContextError) {
      if (error.code === 'REPOSITORY_NOT_FOUND') return CliReadErrorCode.RepositoryNotFound;
      if (error.code === 'INVALID_FILE_MEMBERSHIP') {
        return CliReadErrorCode.InvalidFileMembership;
      }
      if (error.code === 'GIT_READ_FAILED') return CliReadErrorCode.ReadFailed;
      return CliReadErrorCode.InvalidRepositoryPath;
    }
    return CliReadErrorCode.ReadFailed;
  }
}
