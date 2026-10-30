import fs from 'node:fs/promises';
import path from 'node:path';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import { hasWorktreeStateEntriesForSession } from '../../agents/run-scope';
import { loadAgentSessionRunnerConfig } from '../../agents/providers/session-runner-config';
import {
  startAgenticSession,
  type StartAgenticSessionArgs,
} from '../../commands/agent-session-starter';
import { toServiceId, type RepoMappingStore } from '../../repo/index';
import type { RunStore } from '../../run-store/run-store';
import type { AgenticSession, CreateAgenticSessionInput } from '../../session/index';
import type {
  LocalCreateRunRequest,
  LocalCreateRunResponse,
  LocalGetRunResponse,
  LocalRun,
  LocalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { isRunContextMetadata } from '../../shared/agent-bridge-contract/run-context';
import type { ServerLogger } from '../logger';
import { requestContext } from '../request-context';
import type { RunRegistry } from '../../run/run-registry';
import { sameRunEntity } from '../../run/run-entity';
import { readLaunchEntity } from '../conversation-dispatch/run-entity-ingress';

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toCanonicalProviderIdentity = (value: string | null | undefined): string | null => {
  const normalized = readNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  return normalized.startsWith('pending_') ? null : normalized;
};

export const toRunPromptResult = (result: {
  providerSessionId: string | null;
  providerConversationId: string | null;
  errorCount: number;
  fallbackProviderSessionId?: string | null;
  fallbackProviderConversationId?: string | null;
}): {
  providerRunId: string | null;
  providerConversationId: string | null;
  errorCount: number;
} => {
  const providerRunId =
    toCanonicalProviderIdentity(result.providerSessionId) ??
    toCanonicalProviderIdentity(result.fallbackProviderSessionId);
  const providerConversationId =
    toCanonicalProviderIdentity(result.providerConversationId) ??
    toCanonicalProviderIdentity(result.fallbackProviderConversationId);
  return {
    providerRunId,
    providerConversationId,
    errorCount: result.errorCount,
  };
};

const mapEventFields = (event: AgenticSession['events'][number]): LocalRun['events'][number] => ({
  seq: event.seq,
  ts: event.ts,
  app_session_id: event.app_session_id,
  run_id: event.run_id,
  actor: event.actor,
  event_type: event.event_type,
  state_version: event.state_version,
  ...(event.payload !== undefined ? { payload: event.payload } : {}),
  ...(event.payload_ref !== undefined ? { payload_ref: event.payload_ref } : {}),
});

const toLocalRunEvents = (events: AgenticSession['events']): LocalRun['events'] =>
  events.map((event) => mapEventFields(event));

export const toLocalRun = (session: AgenticSession): LocalRun => {
  const serviceIds = (session.services ?? []).map((entry) => entry.id);
  const baseRun = {
    agentic_session_id: session.agentic_session_id,
    ...(serviceIds.length > 0 ? { serviceIds } : {}),
    ...(session.launchServiceId ? { launchServiceId: session.launchServiceId } : {}),
    provider: session.provider,
    provider_session_id: session.provider_session_id,
    provider_conversation_id: session.provider_conversation_id,
    status: session.status,
    ...(session.scope ? { scope: session.scope } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    events: toLocalRunEvents(session.events),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    ...(session.promptType
      ? { promptType: session.promptType as NonNullable<LocalRun['promptType']> }
      : {}),
    ...(session.config !== undefined ? { config: session.config } : {}),
  };

  return {
    ...baseRun,
    contextMetadata: session.contextMetadata,
  };
};

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const toCanonicalPath = async (value: string): Promise<string> => {
  const absolutePath = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
  try {
    return await fs.realpath(absolutePath);
  } catch {
    return absolutePath;
  }
};

const stripReferenceLineRange = (reference: string): string => {
  const withoutMarker = reference.trim().replace(/^@/u, '');
  const lineSuffixMatch = withoutMarker.match(/^(.*?):\d+(?:-\d+)?$/u);
  if (lineSuffixMatch?.[1]) {
    return lineSuffixMatch[1];
  }
  return withoutMarker;
};

const normalizeAllowedRoots = async (roots: readonly string[]): Promise<string[]> => {
  const canonicalRoots = await Promise.all(roots.map((root) => toCanonicalPath(root)));
  return [...new Set(canonicalRoots)];
};

const resolveRunReferenceRoots = async (
  run: AgenticSession,
  repoStore: RepoMappingStore,
): Promise<{
  mode: 'default' | 'cross_service_review';
  bindingRepositoryPath: string;
  allowedRoots: string[];
}> => {
  const launchServiceId = run.launchServiceId ?? run.services?.[0]?.id;
  if (!launchServiceId) {
    throw new LocalAgentApiError(
      'REPO_BINDING_MISSING',
      'No services on this run — cannot resolve repository.',
      409,
    );
  }
  const launchEntry = run.services?.find((entry) => entry.id === launchServiceId);
  const cachedPath = launchEntry?.path && launchEntry.path.length > 0 ? launchEntry.path : null;
  const repositoryPath =
    cachedPath ?? (await repoStore.getBinding(toServiceId(launchServiceId)))?.repositoryPath;
  if (!repositoryPath) {
    throw new LocalAgentApiError(
      'REPO_BINDING_MISSING',
      `No repository mapping found for service ${launchServiceId}.`,
      409,
    );
  }

  const bindingRepositoryPath = await toCanonicalPath(repositoryPath);
  if (!run.scope) {
    return {
      mode: 'default',
      bindingRepositoryPath,
      allowedRoots: [bindingRepositoryPath],
    };
  }

  const allowedRoots = await normalizeAllowedRoots(run.scope.allowedRepositoryRoots);
  if (allowedRoots.length === 0) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Run ${run.agentic_session_id} has an invalid scope without allowed repository roots.`,
      400,
    );
  }

  if (!allowedRoots.some((root) => isWithinRoot(bindingRepositoryPath, root))) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Run ${run.agentic_session_id} scope does not include its service repository root.`,
      400,
    );
  }

  return {
    mode: run.scope.mode,
    bindingRepositoryPath,
    allowedRoots,
  };
};

export const validateResolvedPromptReferences = async (input: {
  run: AgenticSession;
  references: LocalRunPromptRequest['references'];
  repoStore: RepoMappingStore;
}): Promise<void> => {
  if (input.references.resolved.length === 0) {
    return;
  }

  const referenceRoots = await resolveRunReferenceRoots(input.run, input.repoStore);
  const rootForRelativeReferences = referenceRoots.allowedRoots[0];
  if (!rootForRelativeReferences) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Run ${input.run.agentic_session_id} could not resolve a root for prompt references.`,
      400,
    );
  }

  for (const rawReference of input.references.resolved) {
    const referencePath = stripReferenceLineRange(rawReference);
    if (!referencePath) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'Prompt references.resolved must contain non-empty file paths.',
        400,
      );
    }
    const absoluteReferencePath = await toCanonicalPath(
      path.isAbsolute(referencePath)
        ? referencePath
        : path.resolve(rootForRelativeReferences, referencePath),
    );
    const isAllowed = referenceRoots.allowedRoots.some((root) =>
      isWithinRoot(absoluteReferencePath, root),
    );
    if (!isAllowed) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Prompt reference "${rawReference}" is outside the allowed repository scope for run ${input.run.agentic_session_id}.`,
        400,
      );
    }
  }
};

const findRunByCanonicalId = async (
  runStore: RunStore,
  runId: string,
  logger?: ServerLogger,
): Promise<AgenticSession | null> => {
  // Direct lookup by agentic_session_id
  const direct = await runStore.getRun(runId);
  if (direct) {
    if (logger)
      requestContext.log(logger, 'trace', 'local.service.findRunByCanonicalId', {
        runId,
        found: true,
        matchedBy: 'agentic_session_id',
        matchedAgenticSessionId: direct.agentic_session_id,
      });
    return direct;
  }

  // Index lookup by canonical run id (provider_conversation_id ?? provider_session_id)
  const canonicalMatch = runStore.lookupByCanonicalRunId(runId);
  if (canonicalMatch) {
    const found = await runStore.getRun(canonicalMatch);
    const matchedBy =
      found?.provider_conversation_id === runId
        ? 'provider_conversation_id'
        : 'provider_session_id';
    if (logger)
      requestContext.log(logger, found ? 'trace' : 'warn', 'local.service.findRunByCanonicalId', {
        runId,
        found: Boolean(found),
        matchedBy,
        matchedAgenticSessionId: found?.agentic_session_id ?? null,
      });
    return found;
  }

  // Index lookup by provider_session_id (covers cases where canonical is provider_conversation_id)
  const providerMatch = runStore.lookupByProviderSessionId(runId);
  if (providerMatch) {
    const found = await runStore.getRun(providerMatch);
    if (logger)
      requestContext.log(logger, found ? 'trace' : 'warn', 'local.service.findRunByCanonicalId', {
        runId,
        found: Boolean(found),
        matchedBy: 'provider_session_id',
        matchedAgenticSessionId: found?.agentic_session_id ?? null,
      });
    return found;
  }

  if (logger)
    requestContext.log(logger, 'warn', 'local.service.findRunByCanonicalId', {
      runId,
      found: false,
      matchedBy: null,
      matchedAgenticSessionId: null,
    });
  return null;
};

export interface RunServiceDependencies {
  runStore: RunStore;
  repoStore: RepoMappingStore;
  logger: ServerLogger;
  runRegistry: RunRegistry;
  promptTypeRegistry: PromptTypeRegistry;
}

export type RunMaterializationResult =
  | Exclude<LocalCreateRunResponse, { status: 'started' }>
  | (Extract<LocalCreateRunResponse, { status: 'started' }> & { created: boolean });

export class RunService {
  public constructor(private readonly dependencies: RunServiceDependencies) {}

  private log(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    requestContext.log(this.dependencies.logger, level, event, fields);
  }

  public async getRun(runId: string): Promise<LocalGetRunResponse> {
    const { runStore, logger } = this.dependencies;
    this.log('trace', 'local.service.get_run.started', { runId });
    try {
      const metadataOnly = await findRunByCanonicalId(runStore, runId, logger);
      if (!metadataOnly) {
        this.log('trace', 'local.service.get_run.succeeded', { runId, found: false });
        return { run: null };
      }
      // Hydrate events for single-run GET endpoint.
      const run = await runStore.getRunWithEvents(metadataOnly.agentic_session_id);
      this.log('trace', 'local.service.get_run.succeeded', { runId, found: Boolean(run) });
      return { run: run ? toLocalRun(run) : null };
    } catch (error) {
      this.log('error', 'local.service.get_run.failed', { runId, error });
      throw error;
    }
  }

  public async activateRunByAnyId(
    runId: string,
  ): Promise<{ agenticSession: AgenticSession; cliSessionId: string } | null> {
    const { runStore, logger } = this.dependencies;
    // Direct lookup by agentic_session_id
    const direct = await runStore.getRunWithEvents(runId);
    if (direct) {
      // Common path (URL runId == agentic_session_id); debug to stay quiet on
      // every run-touching call. The interesting cases below stay louder.
      this.log('debug', 'local.service.activate_run.resolved', {
        requestedRunId: runId,
        resolvedAgenticSessionId: direct.agentic_session_id,
        matchedBy: 'agentic_session_id',
        status: direct.status,
      });
      return { agenticSession: direct, cliSessionId: direct.agentic_session_id };
    }

    // Fallback: canonical ID lookup (provider_conversation_id, provider_session_id)
    const resolved = await findRunByCanonicalId(runStore, runId, logger);
    if (!resolved) {
      this.log('warn', 'local.service.activate_run.unresolved', { requestedRunId: runId });
      return null;
    }

    // Re-fetch with events using the resolved agentic_session_id
    const withEvents = await runStore.getRunWithEvents(resolved.agentic_session_id);
    if (!withEvents) {
      this.log('warn', 'local.service.activate_run.unresolved_after_canonical', {
        requestedRunId: runId,
        resolvedAgenticSessionId: resolved.agentic_session_id,
      });
      return null;
    }

    // The URL runId did NOT match an agentic_session_id directly — it resolved
    // via a provider/canonical id to a different agentic_session_id. This is
    // exactly the shape that makes the registry lookup miss downstream.
    this.log('info', 'local.service.activate_run.resolved', {
      requestedRunId: runId,
      resolvedAgenticSessionId: withEvents.agentic_session_id,
      matchedBy: 'canonical_id',
      status: withEvents.status,
    });
    return { agenticSession: withEvents, cliSessionId: withEvents.agentic_session_id };
  }

  public async stopRun(runId: string): Promise<void> {
    this.log('debug', 'local.service.stop_run.started', { runId });

    const located = await this.activateRunByAnyId(runId);
    if (!located) {
      // Control envelope arrivals expect a clean no-op when the addressed
      // Run no longer lives on this CLI (already stopped, never started
      // here, or another machine owns it). Surface as a structured log
      // rather than throwing.
      this.log('debug', 'local.service.stop_run.unknown_run', { runId });
      return;
    }

    const activeRun = this.dependencies.runRegistry.get(located.agenticSession.agentic_session_id);
    if (!activeRun || !activeRun.isProcessing) {
      this.log('debug', 'local.service.stop_run.not_processing', { runId });
      return;
    }

    await activeRun.stop();

    this.log('debug', 'local.service.stop_run.succeeded', { runId });
  }

  public async compactRun(runId: string): Promise<void> {
    this.log('debug', 'local.service.compact_run.started', { runId });

    const located = await this.activateRunByAnyId(runId);
    if (!located) {
      this.log('debug', 'local.service.compact_run.unknown_run', { runId });
      return;
    }

    const activeRun = this.dependencies.runRegistry.get(located.agenticSession.agentic_session_id);
    if (!activeRun) {
      this.log('debug', 'local.service.compact_run.no_active_run', { runId });
      return;
    }

    await activeRun.compaction.compact();

    this.log('debug', 'local.service.compact_run.succeeded', { runId });
  }

  public async materializeRun(input: LocalCreateRunRequest): Promise<RunMaterializationResult> {
    const { runStore, repoStore } = this.dependencies;
    const entity = readLaunchEntity(input.payload, this.dependencies.promptTypeRegistry);
    const hasTaskMonitorIdentity = Boolean(input.contextMetadata.taskMonitorId);
    const provider = input.context.provider ?? 'claude';
    const fastModeSelection =
      input.fastMode === undefined ? 'omitted' : input.fastMode ? 'enabled' : 'disabled';
    this.log('debug', 'local.service.create_run.started', {
      serviceIds: input.context.serviceIds ?? [],
      launchServiceId: input.context.launchServiceId ?? null,
      entityType: entity?.entityType ?? null,
      entityId: entity?.entityId ?? null,
      provider,
      fastModeSelection,
      scopeMode: input.scope?.mode ?? null,
      scopeAllowedRootCount: input.scope?.allowedRepositoryRoots.length ?? 0,
      scopeWorkspaceRoot: input.scope?.workspaceRoot ?? null,
      hasTaskMonitorIdentity,
    });

    try {
      if (input.inert && provider === 'opencode') {
        this.log('warn', 'local.service.create_run.inert.invalid_provider', { provider });
        throw new LocalAgentApiError('INVALID_REQUEST', 'Inert runs require Claude or Codex.', 400);
      }
      this.log('debug', 'local.service.create_run.inert', { inert: input.inert === true });
      if (input.fastMode !== undefined && provider === 'opencode') {
        this.log('warn', 'local.service.create_run.fast_mode.invalid_provider', {
          provider,
          fastModeProvided: true,
        });
        throw new LocalAgentApiError(
          'INVALID_REQUEST',
          'fastMode is supported only for Codex and Claude runs.',
          400,
        );
      }

      if (!isRunContextMetadata(input.contextMetadata)) {
        this.log('warn', 'local.service.create_run.invalid_context_metadata', {
          hasTaskMonitorIdentity,
        });
        throw new LocalAgentApiError(
          'INVALID_REQUEST',
          'contextMetadata is malformed or incomplete.',
          400,
        );
      }

      const runnerConfig = await loadAgentSessionRunnerConfig();
      const resolvedModel = input.model ?? runnerConfig.model;
      const resolvedEffort = input.reasoningEffort ?? runnerConfig.reasoningEffort;
      // Validate before this lookup: duplicate signed requests and direct
      // local calls must not reuse a persisted Run to bypass monitor checks.
      const requestedAgentSessionId = readNonEmptyString(input.contextMetadata.agentSessionId);
      if (requestedAgentSessionId) {
        // One Agent Session owns exactly one Run, whose id is the Agent Session id.
        const existing = await runStore.getRun(requestedAgentSessionId);
        if (existing) {
          if ((existing.inert === true) !== (input.inert === true)) {
            throw new LocalAgentApiError('INVALID_REQUEST', 'Run inertness cannot change.', 409);
          }
          if (!sameRunEntity(existing.entity, entity)) {
            this.log('warn', 'local.service.create_run.entity_conflict', {
              agentSessionId: requestedAgentSessionId,
              persistedEntity: existing.entity,
              incomingEntity: entity,
            });
            throw new LocalAgentApiError(
              'INVALID_REQUEST',
              'A Run with this agent session id already exists with a different entity.',
              409,
            );
          }
          this.log('debug', 'local.service.create_run.reused_existing', {
            agentSessionId: requestedAgentSessionId,
            runId: existing.agentic_session_id,
            taskMonitorIdentityValidated: hasTaskMonitorIdentity,
            fastModeSelection:
              existing.fastMode === undefined
                ? 'omitted'
                : existing.fastMode
                  ? 'enabled'
                  : 'disabled',
          });
          await runStore.reindexRun(existing);
          return { status: 'started', run: toLocalRun(existing), created: false };
        }
      }

      this.log('info', 'local.service.create_run.starting_session', {
        serviceIds: input.context.serviceIds ?? [],
        launchServiceId: input.context.launchServiceId ?? null,
        provider,
        requestModel: input.model ?? null,
        requestReasoningEffort: input.reasoningEffort ?? null,
        resolvedModel: resolvedModel ?? null,
        resolvedEffort: resolvedEffort ?? null,
        fastModeSelection,
        hasTaskMonitorIdentity,
        hasPayload: Boolean(input.payload),
        promptType: input.payload?.promptType ?? null,
        hasScope: Boolean(input.scope),
        hasWorktree: Boolean(input.worktree),
      });
      const startArgs: StartAgenticSessionArgs = {
        context: input.context,
        entity,
        contextMetadata: input.contextMetadata,
        runStore,
        repoStore,
        conversationId: input.conversationId,
      };
      if (input.scope) startArgs.scope = input.scope;
      if (input.worktree) startArgs.worktree = input.worktree;
      if (input.config !== undefined) startArgs.config = input.config;
      const inputPromptType = input.payload?.promptType;
      if (inputPromptType) startArgs.promptType = inputPromptType;
      if (resolvedModel) startArgs.model = resolvedModel;
      if (resolvedEffort) startArgs.reasoningEffort = resolvedEffort;
      if (input.fastMode !== undefined) startArgs.fastMode = input.fastMode;
      if (input.inert !== undefined) startArgs.inert = input.inert;
      const result = await startAgenticSession(startArgs);

      if (result.status === 'repo-required') {
        this.log('warn', 'local.service.create_run.repo_required', {
          serviceIds: result.serviceIds,
          launchServiceId: result.launchServiceId,
        });
        return result;
      }

      const session = result.session;
      const run = toLocalRun(session);
      this.log('debug', 'local.service.create_run.succeeded', {
        runId: run.agentic_session_id,
        provider_conversation_id: run.provider_conversation_id,
        provider_session_id: run.provider_session_id,
        serviceIds: run.serviceIds,
        launchServiceId: run.launchServiceId,
        status: run.status,
        eventCount: run.events.length,
      });

      // Re-read the canonical persisted run so the response reflects fields
      // (provider_session_id, events) that the first turn mutated, and so the
      // post-startAgenticSession session is confirmed findable in the store.
      // Falls back to the pre-turn snapshot when the re-read returns null.
      const refreshed =
        (await findRunByCanonicalId(runStore, run.agentic_session_id, this.dependencies.logger)) ??
        null;
      const finalRun = refreshed ? toLocalRun(refreshed) : run;

      return {
        status: 'started',
        run: finalRun,
        created: true,
      };
    } catch (error) {
      this.log('error', 'local.service.create_run.failed', {
        serviceIds: input.context.serviceIds ?? [],
        launchServiceId: input.context.launchServiceId ?? null,
        error,
      });
      throw error;
    }
  }
}
