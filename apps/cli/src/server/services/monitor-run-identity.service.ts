/**
 * Generic identity resolver for monitor routes that "own their own session".
 *
 * A monitor declaration that owns its own session (vs. identity-passthrough,
 * like session_monitor) must, on every firing, reconcile two things with the
 * platform before the Run is constructed:
 *   1. The per-project AgentSession exists server-side.
 *   2. A conversation is linked to that AgentSession.
 * Only then can the Run be created with a server-canonical conversationId, so
 * downstream message posts don't 404 against ids the platform never saw.
 *
 * The Run owns its (conversationId, agentSessionId) for its lifetime — this
 * service therefore never mutates an existing Run's identity. When the local
 * store holds a stale Run whose id the platform does not recognize, the
 * service abandons it (it loses the latest-by-`createdAt` race forever after)
 * and creates a fresh Run with canonical ids.
 *
 * The daily-session monitor is the first caller; future "owns its own
 * session" monitors plug in by supplying their own (promptType, workflowType,
 * agentSessionType, payload) tuple.
 */

import type { AgenticSession } from '../../session/index';
import type { RunStore } from '../../run-store/run-store';
import {
  AgentSessionType,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  type AgentSessionDto,
  type AgentSessionConfigV2,
  type CreateAgentSessionConversationDto,
  type CreateAgentSessionConversationResponseDto,
  type CreateAgentSessionDto,
  type CreateAgentSessionDtoProviderEnum,
  type CreateAgentSession201Response,
  type ResolveWorkItemCoordinator200Response,
  type ResolveWorkItemCoordinatorAgentSessionDto,
  type UpdateAgentSessionDto,
  type WorkflowName,
  type SessionMethod,
} from '../../shared/api/generated/api';
import type {
  LocalReasoningEffort,
  LocalRunProvider,
  LocalRunScope,
  LocalWorktreeConfig,
  MonitorRunEnsuredResponse,
} from '../../shared/agent-bridge-contract/contract';
import type {
  LocalPromptType,
  RunContextMetadata,
} from '../../shared/agent-bridge-contract/generated/api';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import type { ServerLogger } from '../logger';
import { requestContext } from '../request-context';
import type { RunCreationCoordinator } from './run-creation-coordinator';
import { toLocalRun } from './run.service';

export interface PlatformAgentSessionClientDependencies {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const errorFromResponse = async (response: Response, action: string): Promise<Error> => {
  const body = await readJson(response);
  const remoteMessage =
    typeof (body as Record<string, unknown> | null)?.['error'] === 'string'
      ? (body as Record<string, unknown>)['error']
      : null;
  const message =
    typeof remoteMessage === 'string' && remoteMessage.trim().length > 0
      ? remoteMessage.trim()
      : `${action} failed with status ${String(response.status)}`;
  return new Error(message);
};

export class PlatformAgentSessionClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  public constructor(dependencies: PlatformAgentSessionClientDependencies) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  /** Read the platform's current AgentSession/conversation ownership. */
  public async lookupAgentSession({
    accessToken,
    organizationId,
    projectId,
    agentSessionId,
  }: {
    accessToken: string;
    organizationId: string;
    projectId: string;
    agentSessionId: string;
  }): Promise<
    { exists: false } | { exists: true; conversationId: string | null; machineId: string | null }
  > {
    const url = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(agentSessionId)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.authHeaders(accessToken),
    });
    if (response.status === 404) return { exists: false };
    if (!response.ok) throw await errorFromResponse(response, 'agent-session lookup');
    const body = (await readJson(response)) as { data?: AgentSessionDto } | null;
    const conversationId = body?.data?.conversationId ?? null;
    const machineId = body?.data?.machineId ?? null;
    return { exists: true, conversationId, machineId };
  }

  /** Create a platform AgentSession and return its canonical id. */
  public async createAgentSession({
    accessToken,
    organizationId,
    projectId,
    type,
    provider,
    config,
  }: {
    accessToken: string;
    organizationId: string;
    projectId: string;
    type: AgentSessionType;
    provider?: CreateAgentSessionDtoProviderEnum;
    config?: AgentSessionConfigV2;
  }): Promise<{ agentSessionId: string }> {
    const url = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions`;
    const payload: CreateAgentSessionDto = {
      projectId,
      sessionDate: new Date().toISOString().slice(0, 10),
      type,
      ...(provider ? { provider } : {}),
      ...(config ? { config } : {}),
    };
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw await errorFromResponse(response, 'agent-session create');
    const body = (await readJson(response)) as CreateAgentSession201Response | null;
    const id = body?.data?.id;
    if (!id) throw new Error('agent-session create returned without an id');
    return { agentSessionId: id };
  }

  public async bindAgentSessionToMachine({
    accessToken,
    organizationId,
    projectId,
    agentSessionId,
    machineId,
  }: {
    accessToken: string;
    organizationId: string;
    projectId: string;
    agentSessionId: string;
    machineId: string;
  }): Promise<void> {
    const url = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(agentSessionId)}`;
    const payload = { machineId } satisfies UpdateAgentSessionDto;
    const response = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: { ...this.authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw await errorFromResponse(response, 'agent-session machine binding');
  }

  public async resolveWorkItemCoordinator({
    accessToken,
    organizationId,
    projectId,
    type,
    workItemType,
    workItemId,
  }: {
    accessToken: string;
    organizationId: string;
    projectId: string;
    type: AgentSessionType;
    workItemType: string;
    workItemId: string;
  }): Promise<{ agentSessionId: string }> {
    const url = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/work-item-coordinator`;
    const payload: ResolveWorkItemCoordinatorAgentSessionDto = {
      type,
      workItemType,
      workItemId,
      sessionDate: new Date().toISOString(),
    };
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw await errorFromResponse(response, 'work-item coordinator resolution');
    }
    const body = (await readJson(response)) as ResolveWorkItemCoordinator200Response | null;
    const id = body?.data?.agentSession.id;
    if (!id) {
      throw new Error('work-item coordinator resolution returned without an Agent Session id');
    }
    return { agentSessionId: id };
  }

  /** Ensure the AgentSession has a canonical linked conversation. */
  public async ensureConversation({
    accessToken,
    organizationId,
    projectId,
    agentSessionId,
    workflowType,
  }: {
    accessToken: string;
    organizationId: string;
    projectId: string;
    agentSessionId: string;
    workflowType: WorkflowName;
  }): Promise<
    | { status: 'created'; conversationId: string }
    | { status: 'already_linked'; conversationId: string }
  > {
    const url = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(agentSessionId)}/conversation`;
    const payload: CreateAgentSessionConversationDto = { workflowType };
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      // 409 body shape is not contractually guaranteed to carry the id, so
      // re-fetch the agent session to read the canonical conversationId.
      const lookupUrl = `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(agentSessionId)}`;
      const lookup = await this.fetchImpl(lookupUrl, {
        method: 'GET',
        headers: this.authHeaders(accessToken),
      });
      if (!lookup.ok) throw await errorFromResponse(lookup, 'agent-session refetch after 409');
      const lookupBody = (await readJson(lookup)) as { data?: AgentSessionDto } | null;
      const existingId = lookupBody?.data?.conversationId;
      if (!existingId) throw new Error('agent-session 409 refetch returned no conversationId');
      return { status: 'already_linked', conversationId: existingId };
    }

    if (!response.ok) throw await errorFromResponse(response, 'conversation create');

    const body = (await readJson(response)) as {
      data?: CreateAgentSessionConversationResponseDto;
    } | null;
    const conversationId = body?.data?.conversation?.id;
    if (!conversationId) throw new Error('conversation create returned without a conversation id');
    return { status: 'created', conversationId };
  }
}

export interface MonitorRunIdentityServiceDependencies {
  runStore: RunStore;
  runCreationCoordinator: RunCreationCoordinator;
  logger: ServerLogger;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

const scopeForLog = (keyBy: EnsureRunForMonitorKey, projectId: string): Record<string, string> =>
  keyBy.mode === 'project'
    ? { projectId }
    : keyBy.mode === 'targetSession'
      ? { projectId, targetSessionId: keyBy.targetSessionId }
      : { projectId, monitorId: keyBy.monitorId };

const runConfigMatches = (
  existing: AgenticSession,
  runConfig: EnsureRunForMonitorInput['runConfig'],
): boolean =>
  !runConfig ||
  (existing.provider === runConfig.provider &&
    existing.model === runConfig.model &&
    (!runConfig.method ||
      (existing.config?.type === AgentSessionConfigV2TypeEnum.CodingSession &&
        existing.config.version === AgentSessionConfigV2VersionEnum.V2 &&
        existing.config.method === runConfig.method &&
        existing.config.model === runConfig.model)) &&
    existing.reasoningEffort === runConfig.reasoningEffort &&
    JSON.stringify(existing.services.map((service) => service.id)) ===
      JSON.stringify(runConfig.serviceIds ?? []) &&
    existing.launchServiceId === runConfig.launchServiceId &&
    JSON.stringify(existing.scope ?? null) === JSON.stringify(runConfig.scope ?? null) &&
    JSON.stringify(existing.worktree ?? null) === JSON.stringify(runConfig.worktree ?? null));

/**
 * Resolver keying discriminator.
 *
 * - `project`: one Run per (promptType, projectId) — the daily-session shape.
 *   In-flight lock and find-latest filter both reduce to the project the
 *   firing is in.
 * - `targetSession`: one Run per (promptType, targetSessionId) — the
 *   session-monitor shape. Each target session being watched gets its own
 *   monitor AgentSession, reused across firings against that target. The
 *   `targetSessionId` is stamped onto the Run's contextMetadata so subsequent
 *   firings can find it.
 *
 * `targetConversationId` is only meaningful under `targetSession` keying and
 * is event-derived per firing — it does NOT affect the reuse decision (which
 * is owned by the monitor's own AgentSession), it is just threaded through
 * so the runner can register the target conversation as self-owned.
 */
export type EnsureRunForMonitorKey =
  | { mode: 'project' }
  | { mode: 'targetSession'; targetSessionId: string; targetConversationId: string }
  | { mode: 'taskMonitor'; monitorId: string };

export interface EnsureRunForMonitorInput {
  accessToken: string;
  organizationId: string;
  projectId: string;
  /** The local prompt type the Run dispatches against; also the find-latest key. */
  promptType: LocalPromptType;
  /** AgentSessionType to register with the platform when minting a fresh session. */
  agentSessionType: AgentSessionType;
  /** WorkflowName used when ensuring the conversation. */
  workflowType: WorkflowName;
  /** Current paired machine required for system-owned Daily Session identities. */
  machineId?: string;
  /** ContextMetadata skeleton — agentSessionId is filled in from the platform. */
  contextMetadataSeed: Omit<RunContextMetadata, 'agentSessionId'>;
  /**
   * Optional run creation settings inherited from the triggering run. When
   * absent, createRun applies its normal provider/model defaults.
   */
  runConfig?: {
    provider: LocalRunProvider;
    model?: string;
    method?: SessionMethod;
    reasoningEffort?: LocalReasoningEffort;
    serviceIds?: string[];
    launchServiceId?: string;
    scope?: LocalRunScope;
    worktree?: LocalWorktreeConfig;
  };
  /** Discriminator selecting per-project vs per-target-session keying. */
  keyBy: EnsureRunForMonitorKey;
}

export class MonitorRunIdentityService {
  private readonly inflight = new Map<string, Promise<MonitorRunEnsuredResponse>>();
  private readonly platformClient: PlatformAgentSessionClient;

  public constructor(private readonly dependencies: MonitorRunIdentityServiceDependencies) {
    this.platformClient = new PlatformAgentSessionClient({
      apiBaseUrl: dependencies.apiBaseUrl,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    });
  }

  private log(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    requestContext.log(this.dependencies.logger, level, event, fields);
  }

  /**
   * Concurrent firings of the same monitor target must not race to mint two
   * AgentSessions on the platform. The lock is keyed by `(promptType, scope)`
   * — scope is `projectId` for `project` keying, `targetSessionId` for
   * `targetSession` keying — so unrelated monitors and unrelated targets
   * stay independent.
   */
  private async findLatestRunForProjectByPromptType(
    promptType: LocalPromptType,
    projectId: string,
  ): Promise<AgenticSession | null> {
    const existing = await this.dependencies.runStore.findRunsByPromptType(promptType);
    const forProject = existing.filter((run) => run.contextMetadata?.projectId === projectId);
    const sorted = [...forProject].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted[0] ?? null;
  }

  private async findLatestRunForTargetSession(
    promptType: LocalPromptType,
    targetSessionId: string,
  ): Promise<AgenticSession | null> {
    const existing = await this.dependencies.runStore.findRunsByPromptType(promptType);
    const forTarget = existing.filter(
      (run) => run.contextMetadata?.targetSessionId === targetSessionId,
    );
    const sorted = [...forTarget].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted[0] ?? null;
  }

  private async findLatestRunForTaskMonitor(
    promptType: LocalPromptType,
    monitorId: string,
  ): Promise<AgenticSession | null> {
    const existing = await this.dependencies.runStore.findRunsByPromptType(promptType);
    const forMonitor = existing.filter((run) => run.contextMetadata?.taskMonitorId === monitorId);
    const sorted = [...forMonitor].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted[0] ?? null;
  }

  private findLatest(
    promptType: LocalPromptType,
    projectId: string,
    keyBy: EnsureRunForMonitorKey,
  ): Promise<AgenticSession | null> {
    return keyBy.mode === 'project'
      ? this.findLatestRunForProjectByPromptType(promptType, projectId)
      : keyBy.mode === 'targetSession'
        ? this.findLatestRunForTargetSession(promptType, keyBy.targetSessionId)
        : this.findLatestRunForTaskMonitor(promptType, keyBy.monitorId);
  }

  private async ensureRunForMonitorImpl(
    input: EnsureRunForMonitorInput,
  ): Promise<MonitorRunEnsuredResponse> {
    const {
      accessToken,
      organizationId,
      projectId,
      promptType,
      agentSessionType,
      workflowType,
      machineId,
      contextMetadataSeed,
      runConfig,
      keyBy,
    } = input;

    const targetConversationId =
      keyBy.mode === 'targetSession' ? keyBy.targetConversationId : undefined;

    if (runConfig?.method && !runConfig.model?.trim()) {
      this.log('error', 'local.service.monitor_run.launch_config_model_missing', {
        promptType,
        method: runConfig.method,
        ...scopeForLog(keyBy, projectId),
      });
      throw new Error('Monitor Agent Session launch configuration requires a model.');
    }

    // Reuse vs. rebuild decision rests on a single GET. The lookup returns
    // the platform's canonical conversationId for the existing agent-session;
    // a Run is reusable only when the platform recognizes its id AND that
    // canonical conversationId matches the Run's stored one. Any other shape
    // is malformed older data — Runs minted by older code paths with random-
    // UUID conversationIds the platform never saw, or with agent-session ids
    // the platform was never told about, or with an agent-session that exists
    // but has no conversation linked. All would 404 indefinitely on the next
    // message post if we returned them, and we can't backfill identity on a
    // Run (RunStore has no identity mutators by design). So: detect, log,
    // fall through to create-fresh — no POST/refetch needed.
    // The reuse predicate is always against the Run's *own* conversation;
    // `targetConversationId` is event-derived per firing and lives outside it.
    const existing = await this.findLatest(promptType, projectId, keyBy);
    if (existing && !runConfigMatches(existing, runConfig)) {
      this.log('info', 'local.service.monitor_run.run_config_changed_rebuilding', {
        promptType,
        runId: existing.agentic_session_id,
        existingProvider: existing.provider,
        requestedProvider: runConfig?.provider ?? null,
        existingModel: existing.model ?? null,
        requestedModel: runConfig?.model ?? null,
        existingReasoningEffort: existing.reasoningEffort ?? null,
        requestedReasoningEffort: runConfig?.reasoningEffort ?? null,
        ...scopeForLog(keyBy, projectId),
      });
    } else if (existing) {
      const lookup = await this.platformClient.lookupAgentSession({
        accessToken,
        organizationId,
        projectId,
        agentSessionId: existing.agentic_session_id,
      });
      const hasUsablePairing =
        agentSessionType !== AgentSessionType.DailySession ||
        (lookup.exists && machineId !== undefined && lookup.machineId === machineId);
      if (lookup.exists && lookup.conversationId === existing.conversationId && hasUsablePairing) {
        this.log('info', 'local.service.monitor_run.reused', {
          promptType,
          runId: existing.agentic_session_id,
          agentSessionId: existing.agentic_session_id,
          conversationId: lookup.conversationId,
          ...scopeForLog(keyBy, projectId),
        });
        return {
          created: false,
          run: toLocalRun(existing),
          agentSessionId: existing.agentic_session_id,
          ownConversationId: existing.conversationId,
          targetConversationId,
        };
      }
      if (lookup.exists && lookup.conversationId !== existing.conversationId) {
        this.log('warn', 'local.service.monitor_run.conversation_id_drift_rebuilding', {
          promptType,
          runId: existing.agentic_session_id,
          runConversationId: existing.conversationId,
          platformConversationId: lookup.conversationId,
          ...scopeForLog(keyBy, projectId),
        });
      } else if (lookup.exists) {
        this.log('warn', 'local.service.monitor_run.legacy_pairing_rebuilding', {
          promptType,
          runId: existing.agentic_session_id,
          agentSessionId: existing.agentic_session_id,
          conversationId: lookup.conversationId,
          ...scopeForLog(keyBy, projectId),
        });
      } else {
        this.log('warn', 'local.service.monitor_run.stale_agent_session_rebuilding', {
          promptType,
          runId: existing.agentic_session_id,
          ...scopeForLog(keyBy, projectId),
        });
      }
      // Either staleness condition: fall through to create-fresh. The
      // malformed Run remains in the store but loses the latest-by-`createdAt`
      // race from this firing forward.
    }

    const minted =
      keyBy.mode === 'taskMonitor'
        ? await this.platformClient.resolveWorkItemCoordinator({
            accessToken,
            organizationId,
            projectId,
            type: agentSessionType,
            workItemType: 'TASK_MONITOR',
            workItemId: keyBy.monitorId,
          })
        : await this.platformClient.createAgentSession({
            accessToken,
            organizationId,
            projectId,
            type: agentSessionType,
            ...(runConfig
              ? {
                  provider: runConfig.provider,
                  ...(runConfig.model
                    ? {
                        config: {
                          type: AgentSessionConfigV2TypeEnum.CodingSession,
                          version: AgentSessionConfigV2VersionEnum.V2,
                          ...(runConfig.method ? { method: runConfig.method } : {}),
                          model: runConfig.model,
                          ...(runConfig.reasoningEffort
                            ? { effort: runConfig.reasoningEffort }
                            : {}),
                        },
                      }
                    : {}),
                }
              : {}),
          });
    if (agentSessionType === AgentSessionType.DailySession) {
      if (!machineId) {
        throw new Error('Daily Session identity resolution requires the current paired machine.');
      }
      await this.platformClient.bindAgentSessionToMachine({
        accessToken,
        organizationId,
        projectId,
        agentSessionId: minted.agentSessionId,
        machineId,
      });
      this.log('info', 'local.service.monitor_run.machine_bound', {
        promptType,
        agentSessionId: minted.agentSessionId,
        machineId,
        ...scopeForLog(keyBy, projectId),
      });
    }
    const ensure = await this.platformClient.ensureConversation({
      accessToken,
      organizationId,
      projectId,
      agentSessionId: minted.agentSessionId,
      workflowType,
    });
    const ensureEvent =
      ensure.status === 'created'
        ? 'local.service.monitor_run.ensure_conversation.created'
        : 'local.service.monitor_run.ensure_conversation.already_linked';
    this.log('info', ensureEvent, {
      promptType,
      agentSessionId: minted.agentSessionId,
      conversationId: ensure.conversationId,
      ...scopeForLog(keyBy, projectId),
    });

    const contextMetadata: RunContextMetadata = {
      ...contextMetadataSeed,
      agentSessionId: minted.agentSessionId,
      ...(keyBy.mode === 'targetSession'
        ? { targetSessionId: keyBy.targetSessionId }
        : keyBy.mode === 'taskMonitor'
          ? { taskMonitorId: keyBy.monitorId }
          : {}),
    };
    const result = await this.dependencies.runCreationCoordinator.createRun({
      attachments: [],
      stagedBrowserTab: null,
      context: {
        projectId,
        ...(runConfig ? { provider: runConfig.provider } : {}),
        ...(runConfig?.serviceIds && runConfig.serviceIds.length > 0
          ? { serviceIds: runConfig.serviceIds }
          : {}),
        ...(runConfig?.launchServiceId ? { launchServiceId: runConfig.launchServiceId } : {}),
      },
      contextMetadata,
      conversationId: ensure.conversationId,
      ...(runConfig?.scope ? { scope: runConfig.scope } : {}),
      ...(runConfig?.worktree ? { worktree: runConfig.worktree } : {}),
      ...(runConfig?.model ? { model: runConfig.model } : {}),
      ...(runConfig?.reasoningEffort ? { reasoningEffort: runConfig.reasoningEffort } : {}),
    });
    if (result.status === 'repo-required') {
      throw new LocalAgentApiError('REPO_REQUIRED', 'Repository binding required', 409);
    }
    // Stamp the promptType on the run so findRunsByPromptType can locate it on
    // subsequent firings. Not passed via createRun's payload because createRun
    // fires firstTurnDispatcher when payload is present — monitor turns are
    // driven exclusively by the runner's sendMessage call.
    await this.dependencies.runStore.updateRunPromptType(result.run.agentic_session_id, promptType);

    this.log('info', 'local.service.monitor_run.created', {
      promptType,
      runId: result.run.agentic_session_id,
      agentSessionId: minted.agentSessionId,
      conversationId: ensure.conversationId,
      ...scopeForLog(keyBy, projectId),
    });
    return {
      created: true,
      run: result.run,
      agentSessionId: minted.agentSessionId,
      ownConversationId: ensure.conversationId,
      targetConversationId,
    };
  }

  public async ensureRunForMonitor(
    input: EnsureRunForMonitorInput,
  ): Promise<MonitorRunEnsuredResponse> {
    const scope =
      input.keyBy.mode === 'project'
        ? input.projectId
        : input.keyBy.mode === 'targetSession'
          ? input.keyBy.targetSessionId
          : input.keyBy.monitorId;
    const key = `${input.promptType}:${scope}`;
    const inflightFiring = this.inflight.get(key);
    if (inflightFiring) return inflightFiring;

    const firing = (async () => {
      try {
        return await this.ensureRunForMonitorImpl(input);
      } catch (error) {
        this.log('error', 'local.service.monitor_run.ensure_conversation.failed', {
          promptType: input.promptType,
          projectId: input.projectId,
          ...(input.keyBy.mode === 'targetSession'
            ? { targetSessionId: input.keyBy.targetSessionId }
            : input.keyBy.mode === 'taskMonitor'
              ? { monitorId: input.keyBy.monitorId }
              : {}),
          error,
        });
        throw error;
      }
    })();
    this.inflight.set(key, firing);
    try {
      return await firing;
    } finally {
      this.inflight.delete(key);
    }
  }
}
