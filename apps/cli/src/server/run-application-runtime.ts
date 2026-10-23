import type { ProjectBrowser } from '../browser/project-browser-manager';
import { RunTabs } from '../browser/run-tabs';
import { BrowserTools } from '../browser/browser-tools';
import type { PageAnnotations } from '../browser/page-annotations';
import { BrowserMcpAccess } from '../agents/browser-tools/browser-mcp-access';
import { BrowserToolsHttpController } from '../agents/browser-tools/http-mcp';
import { InputAdmissionOwner } from './input-admission/input-admission-owner';
import { InputAdmissionLifecycle } from './input-admission/admission-lifecycle';
import type { OperationTimelineRegistry } from './input-admission/operation-timeline';
import { resolveBaseDir as resolveInputAdmissionRoot } from '../session/paths';
import type { ApiRuntime } from '../../../../packages/ui-common/src/clients/shared';
import { z } from 'zod';
import type { AgentApplicationRuntime } from '../agents/agent-application-runtime';
import type { OAuthClient } from '../auth';
import type { RepoMappingStore } from '../repo';
import type { RunCollaborators } from '../run/run';
import { MessagePoster } from '../run/message-poster';
import { RunRegistry } from '../run/run-registry';
import { RunnerPicker } from '../run/runners/pick-runner';
import { ChildAgentLauncher } from '../run/child-agent-launcher';
import { SubagentFanoutRuntime } from '../agents/subagent-fanout/subagent-fanout-runtime';
import { resolveMachineStateStorePath } from './machine-state-store-path';
import type { HostedMachine } from './state-machine-application-runtime';
import { DeterministicE2EScenarioRegistry } from '../run/runners/deterministic-e2e-scenario-registry';
import type { RunStore } from '../run-store/run-store';
import type { ToolRuleStore } from '../session/tool-rules';
import type { KeyPairStore } from '../credentials/keypair';
import type { AgentOutputEvents } from './agent-output-events';
import { createProposalStatusReader } from './proposal-status-reader';
import { RunEventPublisher } from './run-event-publisher';
import { TaskReportChainReader } from './services/task-report-chain-reader';
import { WorkflowDispatchVerdictReader } from './services/workflow-dispatch-verdict';
import { LocalAgentEndpoint } from './local-base-url';
import { LocalAgentService } from './local-agent-service';
import type { ServerLogger } from './logger';
import { MemoryMonitor } from './memory-monitor';
import type { MonitorProjectContext } from './monitors/project-context';
import type { AgentSessionReader } from './monitors/agent-session-reader';
import type { PlatformAuthContext } from './platform-auth-context';
import type { PlatformWebSocketManager } from './platform-ws';
import { ReportSyncService } from './report-sync-service';
import type { EntityReportIndex } from './reports/entity-report-index';
import { RunChangedFilesReader } from './run-changed-files';
import type { RunLifecycleEvents } from './run-lifecycle-events';
import type { TaskMonitorManagedTurnRuntime } from './task-monitor-managed-turn-runtime';
import type { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import { RunReadRestoreCoordinator } from './restore-persisted-runs';
import {
  pollSubagentDispatchClaims,
  SubagentInteractionRuntime,
  type SubagentDispatchClaims,
} from './subagent-interaction-runtime';
import {
  pollSessionMessageTargets,
  SessionMessageRuntime,
  type SessionMessageTargets,
} from './session-message-runtime';
import { PollingDispatchSource, type DispatchSource } from './dispatch-source';
import { LocalSessionReadSource } from './local-session-read-source';
import { SessionActivitySource } from './session-activity-source';
import { MachineOptionsStore } from '../options/machine-options-store';
import {
  ConversationTitleReadError,
  LocalSessionMetadataSource,
  type ConversationTitleReader,
} from './local-session-metadata-source';
import { MachineEffectProofSigner } from '../auth/machine-effect-proof';
import { SessionRunnerFacade } from './runtime/providers/select';
import { MessageType } from '../shared/api/index';
import { MachineEffectHttpMethod } from '../shared/api/generated/api';
import type {
  CreateSystemMessage,
  CreateUserMessage,
  PostMessageRequest,
  SubmitExecutableUserMessageRequestDto,
} from '../shared/api/generated/api';
import { ProjectModeBundleMaterializer, ProjectModeBundleRestorer } from '../agents/project-mode';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';
import type { ControllerRegistryReader } from './controller-authorization/types';
import type { CatalogAvailability } from './runtime-capability-catalog';

const isSystemMessage = (
  dto: CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto,
): dto is CreateSystemMessage => dto.type === MessageType.System;

const isExecutableUserMessage = (
  dto: CreateUserMessage,
): dto is SubmitExecutableUserMessageRequestDto => {
  const candidate: Partial<SubmitExecutableUserMessageRequestDto> = dto;
  const authorization = candidate.authorization;
  return (
    typeof authorization === 'object' &&
    authorization !== null &&
    (authorization.kind === 'controller_assertion' || authorization.kind === 'bounded_grant')
  );
};

const toPostMessageRequest = (
  dto: CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto,
): PostMessageRequest => {
  if (isSystemMessage(dto)) {
    const { type: _messageType, ...message } = dto;
    return { type: 'SYSTEM', ...message };
  }
  if (!isExecutableUserMessage(dto)) {
    throw new Error('Executable user messages require admission authorization.');
  }
  const { type: _messageType, ...message } = dto;
  return { type: 'USER', ...message };
};

/** Displayed conversation titles are re-read no more often than this. */
const SESSION_TITLE_REFRESH_INTERVAL_MS = 60_000;

const createConversationTitleReader =
  (apiRuntime: ApiRuntime): ConversationTitleReader =>
  async ({ organizationId, projectId, conversationId }) => {
    try {
      const response = await apiRuntime.clients.conversationsApi.getConversation({
        organizationId,
        projectId,
        conversationId,
      });
      return response.data.data?.title ?? null;
    } catch (error) {
      const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
      throw new ConversationTitleReadError(
        error instanceof Error ? error.message : String(error),
        status === 401 || status === 403,
      );
    }
  };

/**
 * Reads a project's display name for the menu. The organization comes from a
 * local session in that project; with none, the name is unknown.
 */
const createProjectNameReader =
  (apiRuntime: ApiRuntime, sessions: LocalSessionReadSource) =>
  async (projectId: string): Promise<string | null> => {
    const session = sessions.snapshot().sessions.find((listed) => listed.projectId === projectId);
    if (!session) return null;
    const response = await apiRuntime.clients.projects.findOneProject({
      organizationId: session.organizationId,
      projectId,
    });
    return response.data.data?.name ?? null;
  };

const externalAgentCompletionErrorToken = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,100}$/u)
  .optional()
  .catch(undefined);

const externalAgentCompletionErrorDataSchema = z
  .object({
    code: externalAgentCompletionErrorToken,
    errorCode: externalAgentCompletionErrorToken,
    reason: externalAgentCompletionErrorToken,
    requestId: z.string().uuid().optional().catch(undefined),
    correlationId: z.string().uuid().optional().catch(undefined),
    responseBodyPresent: z.boolean().optional().catch(undefined),
  })
  .partial()
  .passthrough();

type ExternalAgentCompletionErrorData = z.infer<typeof externalAgentCompletionErrorDataSchema>;

const readExternalAgentCompletionErrorData = async (
  response: Response,
): Promise<ExternalAgentCompletionErrorData> => {
  const responseText = await response.text().catch(() => '');
  let parsed: ExternalAgentCompletionErrorData = {};

  if (responseText.trim().length > 0) {
    try {
      const result = externalAgentCompletionErrorDataSchema.safeParse(JSON.parse(responseText));
      if (result.success) parsed = result.data;
    } catch {
      // The response body is diagnostic context only. Preserve the status and
      // headers even when the platform returns non-JSON or malformed JSON.
    }
  }

  return {
    ...parsed,
    responseBodyPresent: responseText.trim().length > 0,
    requestId: parsed.requestId ?? response.headers.get('x-request-id') ?? undefined,
    correlationId: parsed.correlationId ?? response.headers.get('x-correlation-id') ?? undefined,
  };
};

class ExternalAgentCompletionHttpError extends Error {
  public readonly response: {
    status: number;
    data: ExternalAgentCompletionErrorData;
  };

  public constructor(status: number, data: ExternalAgentCompletionErrorData) {
    const rejectionCode = data.code ?? data.errorCode;
    const details = [
      rejectionCode !== undefined ? `code=${rejectionCode}` : null,
      data.reason !== undefined ? `reason=${data.reason}` : null,
      data.requestId !== undefined ? `requestId=${data.requestId}` : null,
      data.correlationId !== undefined ? `correlationId=${data.correlationId}` : null,
      `responseBodyPresent=${String(data.responseBodyPresent === true)}`,
    ].filter((detail): detail is string => detail !== null);
    super(
      `EXTERNAL_AGENT completion effect failed with status ${String(status)}.` +
        (details.length > 0 ? ` Diagnostics: ${details.join(', ')}.` : ''),
    );
    this.name = 'ExternalAgentCompletionHttpError';
    this.response = { status, data };
  }
}

export interface RunApplicationRuntimeDependencies {
  projectBrowsers?: ProjectBrowser;
  runStore: RunStore;
  repoStore: RepoMappingStore;
  oauthClient: OAuthClient;
  apiRuntime: ApiRuntime;
  agentRuntime: AgentApplicationRuntime;
  agentOutputEvents: AgentOutputEvents;
  runLifecycleEvents: RunLifecycleEvents;
  logger: ServerLogger;
  dataDir: string;
  apiBaseUrl: string;
  authContext: PlatformAuthContext;
  reportIndex: EntityReportIndex;
  agentSessionReader: AgentSessionReader;
  toolRuleStore: ToolRuleStore;
  monitorProjectContext: MonitorProjectContext;
  platformWebSocketManager: PlatformWebSocketManager;
  keyPairStore: KeyPairStore;
  fetchImpl?: typeof fetch;
  trackToolUsage?: boolean;
  operationTimeline?: OperationTimelineRegistry;
  inactivityTimeoutMs?: number;
  taskMonitorManagedTurnRuntime: TaskMonitorManagedTurnRuntime;
  taskMonitorLaunchFailureRuntime: TaskMonitorLaunchFailureRuntime;
  hostActionAdmission: HostActionAdmission;
  controllerRegistry: ControllerRegistryReader;
  capabilityCatalog: CatalogAvailability;
}

/**
 * Composition owner for the complete active-Run subsystem. It constructs
 * cohesive leaves in dependency order and exposes only the owners used by the
 * outer server lifecycle.
 */
export class RunApplicationRuntime {
  public readonly browserMcpAccess: BrowserMcpAccess | undefined;
  public readonly browserToolsController: BrowserToolsHttpController | undefined;
  private readonly browserAnnotations: PageAnnotations | undefined;
  /** The Run-owned tabs, also opened by the loopback Open browser route. */
  public readonly runTabs: RunTabs | undefined;
  private readonly inputAdmissionLifecycle: InputAdmissionLifecycle;
  private readonly memoryMonitor: MemoryMonitor;
  public readonly localAgentEndpoint = new LocalAgentEndpoint();
  public readonly messagePoster: MessagePoster;
  public readonly runChangedFilesReader: RunChangedFilesReader;
  public readonly runRegistry: RunRegistry;
  public readonly runReadRestoreCoordinator: RunReadRestoreCoordinator;
  public readonly agentService: LocalAgentService;
  public readonly subagentInteractionRuntime: SubagentInteractionRuntime;
  public readonly sessionMessageRuntime: SessionMessageRuntime;
  private readonly subagentDispatchSource: DispatchSource<SubagentDispatchClaims>;
  private readonly sessionMessageSource: DispatchSource<SessionMessageTargets>;
  private readonly dispatchSubscriptions: Array<{ dispose(): void }> = [];
  /** Read-only snapshots of the Runs registered in this process. */
  public readonly localSessionReadSource: LocalSessionReadSource;
  /** Bounded narration, tool and command activity for the registered Runs. */
  public readonly sessionActivitySource: SessionActivitySource;
  /** Titles and focal context joined onto `localSessionReadSource`. */
  public readonly localSessionMetadataSource: LocalSessionMetadataSource;
  public readonly readProjectName: (projectId: string) => Promise<string | null>;
  /** Reads the options-screen setting on every call; the remote tool-call read honours it immediately. */
  public readonly isRemoteToolCallViewingEnabled: () => Promise<boolean>;
  private readonly unsubscribeReconnect: () => void;
  private readonly unsubscribeAuthChanged: () => void;
  /** Hosted by the State Machine application runtime alongside Task Monitor. */
  public readonly subagentFanoutMachine: HostedMachine;

  private readonly sessionRunnerFacade: SessionRunnerFacade;
  private readonly runnerPicker: RunnerPicker;
  private readonly childAgentLauncher: ChildAgentLauncher;
  private readonly projectModeBundleMaterializer: ProjectModeBundleMaterializer;
  private readonly projectModeBundleRestorer: ProjectModeBundleRestorer;

  public constructor(dependencies: RunApplicationRuntimeDependencies) {
    if (dependencies.projectBrowsers) {
      const tabs = new RunTabs(dependencies.projectBrowsers, dependencies.logger);
      this.runTabs = tabs;
      this.browserAnnotations = tabs.annotations;
      this.browserMcpAccess = new BrowserMcpAccess(
        dependencies.projectBrowsers,
        dependencies.runLifecycleEvents,
        tabs,
        dependencies.logger,
      );
      this.browserToolsController = new BrowserToolsHttpController(
        this.browserMcpAccess,
        new BrowserTools(tabs, dependencies.logger),
        dependencies.logger,
      );
    }
    const runLogger = dependencies.logger.child({ component: 'run' });
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const machineEffectProofSigner = new MachineEffectProofSigner(dependencies.keyPairStore);
    this.projectModeBundleMaterializer = new ProjectModeBundleMaterializer();
    this.projectModeBundleRestorer = new ProjectModeBundleRestorer(
      this.projectModeBundleMaterializer,
      dependencies.logger.child({ component: 'project-mode-bundle-restorer' }),
    );
    const eventPublisher = new RunEventPublisher({
      platformWebSocketManager: dependencies.platformWebSocketManager,
      agentOutputEvents: dependencies.agentOutputEvents,
      runLifecycleEvents: dependencies.runLifecycleEvents,
      logger: dependencies.logger.child({ component: 'run-events' }),
    });
    this.messagePoster = new MessagePoster({
      apiClient: {
        postMessage: (request) =>
          dependencies.apiRuntime.transport.request({
            method: 'POST',
            url:
              `/organizations/${encodeURIComponent(request.organizationId)}` +
              `/projects/${encodeURIComponent(request.projectId)}/messages`,
            data: toPostMessageRequest(request.createMessageDto),
          }),
        updateMessage: (request) => dependencies.apiRuntime.clients.default.updateMessage(request),
        submitExternalAgentCompletion: async (request) => {
          const route =
            `/organizations/${encodeURIComponent(request.organizationId)}` +
            `/projects/${encodeURIComponent(request.projectId)}` +
            `/agent-sessions/${encodeURIComponent(request.agentSessionId)}` +
            '/external-agent-completions';
          const baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
          const signed = await machineEffectProofSigner.sign({
            operationId: 'submitExternalAgentCompletion',
            method: MachineEffectHttpMethod.Post,
            path: new URL(`${baseUrl}${route}`).pathname,
            payload: request.request,
            organizationId: request.organizationId,
            effectId: request.effectId,
          });
          const response = await fetchImpl(`${baseUrl}${route}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${signed.machineCredential}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...request.request, proof: signed.proof }),
          });
          if (!response.ok) {
            throw new ExternalAgentCompletionHttpError(
              response.status,
              await readExternalAgentCompletionErrorData(response),
            );
          }
          return z
            .object({
              data: z.object({ completionMessageId: z.string().uuid() }),
            })
            .parse(await response.json()).data.completionMessageId;
        },
      },
      logger: dependencies.logger.child({ component: 'message-poster' }),
      dataDir: dependencies.dataDir,
    });
    this.runChangedFilesReader = new RunChangedFilesReader(
      dependencies.repoStore,
      dependencies.logger.child({ component: 'changed-files' }),
    );
    this.sessionRunnerFacade = new SessionRunnerFacade({
      runStore: dependencies.runStore,
      repoStore: dependencies.repoStore,
      oauthClient: dependencies.oauthClient,
      localAgentEndpoint: this.localAgentEndpoint,
      submissionToolRegistry: dependencies.agentRuntime.submissionToolRegistry,
      logger: dependencies.logger.child({ component: 'runner' }),
      agentSessionReader: dependencies.agentSessionReader,
      toolRuleStore: dependencies.toolRuleStore,
      capabilityCatalog: dependencies.capabilityCatalog,
    });
    const deterministicE2EScenarioRegistry = DeterministicE2EScenarioRegistry.fromEnvironment();
    this.childAgentLauncher = new ChildAgentLauncher({
      promptTypeRegistry: dependencies.agentRuntime.promptTypeRegistry,
      repoStore: dependencies.repoStore,
      oauthClient: dependencies.oauthClient,
      submissionToolRegistry: dependencies.agentRuntime.submissionToolRegistry,
      localAgentEndpoint: this.localAgentEndpoint,
      logger: runLogger,
    });
    const subagentFanout = new SubagentFanoutRuntime({
      storePath: resolveMachineStateStorePath(
        dependencies.dataDir,
        dependencies.apiBaseUrl,
        'subagent-fanout.json',
      ),
      childAgentLauncher: this.childAgentLauncher,
      logger: dependencies.logger.child({ component: 'subagent-fanout' }),
    });
    this.subagentFanoutMachine = {
      name: 'subagent-fanout',
      // A restore failure disables only run_subagents; the CLI keeps running.
      optional: true,
      restore: () => subagentFanout.restore(),
      startLiveProcessing: () => {
        subagentFanout.startLiveProcessing();
      },
      stopClaiming: () => {
        subagentFanout.stopClaiming();
      },
    };
    dependencies.agentRuntime.runSubagentsTool?.bindFanout(subagentFanout);
    this.runnerPicker = new RunnerPicker({
      childAgentLauncher: this.childAgentLauncher,
      logger: runLogger,
      sessionRunnerFacade: this.sessionRunnerFacade,
      runChangedFilesReader: this.runChangedFilesReader,
      ...(deterministicE2EScenarioRegistry ? { deterministicE2EScenarioRegistry } : {}),
    });
    const workflowDispatchVerdictReader = new WorkflowDispatchVerdictReader(
      dependencies.apiRuntime.clients.workflows,
    );
    const taskReportChainReader = new TaskReportChainReader({
      authContext: dependencies.authContext,
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl,
      logger: dependencies.logger.child({ component: 'report-chain.seed' }),
    });
    const reportSyncService = new ReportSyncService({
      oauthClient: dependencies.oauthClient,
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl,
      runStore: dependencies.runStore,
      logger: dependencies.logger.child({ component: 'report-sync' }),
    });
    const handlerDeps = {
      runStore: dependencies.runStore,
      fetchImpl,
      auth: dependencies.agentRuntime.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      logger: runLogger,
      taskMonitorDecisionStore: dependencies.agentRuntime.taskMonitorDecisionStore,
      sessionMonitorEvaluationStore: dependencies.agentRuntime.sessionMonitorEvaluationStore,
      startupPromptInput: dependencies.agentRuntime.startupPromptInput,
      childAgentLauncher: this.childAgentLauncher,
    };
    const onCompleteDeps = {
      fetchImpl,
      auth: dependencies.agentRuntime.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      machineEffectProofSigner,
      logger: runLogger,
      taskMonitorDecisionStore: dependencies.agentRuntime.taskMonitorDecisionStore,
      sessionMonitorEvaluationStore: dependencies.agentRuntime.sessionMonitorEvaluationStore,
      poster: this.messagePoster,
      runStore: dependencies.runStore,
      reportIndex: dependencies.reportIndex,
      platformWebSocketManager: dependencies.platformWebSocketManager,
    };
    const runCollaborators: RunCollaborators = {
      runStore: dependencies.runStore,
      repoStore: dependencies.repoStore,
      poster: this.messagePoster,
      broadcaster: eventPublisher,
      keyPairStore: dependencies.keyPairStore,
      handlerDeps,
      promptTypeRegistry: dependencies.agentRuntime.promptTypeRegistry,
      submissionToolRegistry: dependencies.agentRuntime.submissionToolRegistry,
      runnerPicker: this.runnerPicker,
      logger: runLogger,
      ...(dependencies.operationTimeline
        ? { operationTimeline: dependencies.operationTimeline }
        : {}),
      // Late-bound: the admission lifecycle is built after the registry it drives.
      runFollowUpAdmission: {
        admit: (input) => this.inputAdmissionLifecycle.admit(input),
        durableInputReady: (runId) => this.inputAdmissionLifecycle.durableInputReady(runId),
      },
      taskReportChainReader,
      workflowDispatchVerdictReader,
      reportSyncService,
      onCompleteDeps,
      baseSubmissionTools: [...dependencies.agentRuntime.baseSubmissionTools],
      ...(this.browserMcpAccess ? { browserMcpAccess: this.browserMcpAccess } : {}),
      ...(this.browserAnnotations ? { browserAnnotations: this.browserAnnotations } : {}),
      ...(this.runTabs ? { browserTabNotices: this.runTabs.notices } : {}),
      proposalStatusReader: createProposalStatusReader(dependencies.apiRuntime.clients),
      taskMonitorManagedTurnRuntime: dependencies.taskMonitorManagedTurnRuntime,
      taskMonitorLaunchFailureRuntime: dependencies.taskMonitorLaunchFailureRuntime,
      projectModeBundleMaterializer: this.projectModeBundleMaterializer,
      ...(dependencies.trackToolUsage !== undefined
        ? { trackToolUsage: dependencies.trackToolUsage }
        : {}),
    };
    this.runRegistry = new RunRegistry({
      runCollaborators,
      submissionToolRegistry: dependencies.agentRuntime.submissionToolRegistry,
      sessionRunnerFacade: this.sessionRunnerFacade,
      monitorProjectContext: dependencies.monitorProjectContext,
      runLifecycleEvents: dependencies.runLifecycleEvents,
      ...(dependencies.inactivityTimeoutMs !== undefined
        ? { inactivityTimeoutMs: dependencies.inactivityTimeoutMs }
        : {}),
    });
    this.browserMcpAccess?.bindRegistry(this.runRegistry);
    this.localSessionReadSource = new LocalSessionReadSource({
      runRegistry: this.runRegistry,
      runLifecycleEvents: dependencies.runLifecycleEvents,
      logger: dependencies.logger.child({ component: 'local-session-read' }),
    });
    this.sessionActivitySource = new SessionActivitySource({
      runOutput: eventPublisher,
      readSource: this.localSessionReadSource,
      logger: dependencies.logger.child({ component: 'session-activity' }),
    });
    const machineOptions = new MachineOptionsStore();
    this.isRemoteToolCallViewingEnabled = () => machineOptions.isRemoteToolCallViewingEnabled();
    this.readProjectName = createProjectNameReader(
      dependencies.apiRuntime,
      this.localSessionReadSource,
    );
    this.localSessionMetadataSource = new LocalSessionMetadataSource({
      readSource: this.localSessionReadSource,
      readConversationTitle: createConversationTitleReader(dependencies.apiRuntime),
      logger: dependencies.logger.child({ component: 'local-session-metadata' }),
      refreshIntervalMs: SESSION_TITLE_REFRESH_INTERVAL_MS,
    });
    this.unsubscribeReconnect = dependencies.platformWebSocketManager.onReconnect(() =>
      this.localSessionMetadataSource.connectivityRestored(),
    );
    // A cleared token (logout or rejected refresh) withdraws account-derived
    // session metadata; a newly issued token restores it.
    this.unsubscribeAuthChanged = dependencies.oauthClient.onAuthChanged((token) => {
      if (token === null) this.authorizationLost();
      else this.authorizationRestored();
    });
    this.runReadRestoreCoordinator = new RunReadRestoreCoordinator({
      runStore: dependencies.runStore,
      runRegistry: this.runRegistry,
      logger: dependencies.logger.child({ component: 'run-read-restore' }),
      projectModeBundleRestorer: this.projectModeBundleRestorer,
    });
    this.agentService = new LocalAgentService({
      runStore: dependencies.runStore,
      repoStore: dependencies.repoStore,
      runRegistry: this.runRegistry,
      promptTypeRegistry: dependencies.agentRuntime.promptTypeRegistry,
      ...(dependencies.operationTimeline
        ? { operationTimeline: dependencies.operationTimeline }
        : {}),
      logger: dependencies.logger.child({ component: 'service' }),
      workflowsApi: dependencies.apiRuntime.clients.workflows,
      messagesApi: dependencies.apiRuntime.clients.default,
      apiBaseUrl: dependencies.apiBaseUrl,
      sessionRunnerFacade: this.sessionRunnerFacade,
      projectModeBundleMaterializer: this.projectModeBundleMaterializer,
      capabilityCatalog: dependencies.capabilityCatalog,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(this.runTabs ? { stagedBrowserTabs: this.runTabs } : {}),
    });
    const inputAdmissionOwner = new InputAdmissionOwner(
      {
        directory: resolveInputAdmissionRoot() + '/runs/input-admission',
        legacyStoreFile: resolveInputAdmissionRoot() + '/runs/input-admission.json',
      },
      dependencies.logger,
    );
    this.inputAdmissionLifecycle = new InputAdmissionLifecycle(
      inputAdmissionOwner,
      this.agentService,
      this.runRegistry,
      dependencies.keyPairStore,
      dependencies.apiBaseUrl,
      dependencies.logger,
      () => this.subagentInteractionRuntime.readyForInputPickup,
      dependencies.runStore,
      dependencies.operationTimeline,
    );
    this.agentService.bindInputAdmission(this.inputAdmissionLifecycle);
    const subagentLogger = dependencies.logger.child({ component: 'subagent-interactions' });
    this.subagentInteractionRuntime = new SubagentInteractionRuntime({
      runStore: dependencies.runStore,
      runRegistry: this.runRegistry,
      childAgentLauncher: this.childAgentLauncher,
      logger: subagentLogger,
      hostActionAdmission: dependencies.hostActionAdmission,
      controllerRegistry: dependencies.controllerRegistry,
    });
    this.subagentDispatchSource = new PollingDispatchSource({
      intervalMs: 5_000,
      poll: () =>
        pollSubagentDispatchClaims(
          dependencies,
          this.subagentInteractionRuntime.foregroundWaitScopes,
        ),
      logger: subagentLogger,
      failureEvent: 'subagent.interaction.poll_failed',
    });
    this.sessionMessageRuntime = new SessionMessageRuntime({
      runStore: dependencies.runStore,
      agentService: this.agentService,
    });
    this.sessionMessageSource = new PollingDispatchSource({
      intervalMs: 5_000,
      poll: () => pollSessionMessageTargets(dependencies),
      logger: dependencies.logger.child({ component: 'session-messages' }),
      failureEvent: 'session_message.admission_deferred',
    });
    this.memoryMonitor = new MemoryMonitor({
      logger: dependencies.logger.child({ component: 'memory' }),
      gauges: () => ({
        registeredRunCount: this.runRegistry.size,
        inputAdmissionCachedSessionCount: inputAdmissionOwner.cachedSessionCount,
        sessionActivityRunCount: this.sessionActivitySource.bufferedRunCount,
        sessionActivityBytes: this.sessionActivitySource.retainedBytes,
      }),
    });
  }

  public startAfterReadiness(): void {
    // Startup advance may run before holds are restored; pickup it refused then is
    // offered again once they are.
    this.subagentInteractionRuntime.onReadyForInputPickup(
      () => void this.inputAdmissionLifecycle.advanceOpenSessions(),
    );
    if (this.dispatchSubscriptions.length === 0) {
      this.dispatchSubscriptions.push(
        this.subagentDispatchSource.subscribe((work) =>
          this.subagentInteractionRuntime.receive(work),
        ),
        this.sessionMessageSource.subscribe((work) => this.sessionMessageRuntime.receive(work)),
      );
    }
    void this.inputAdmissionLifecycle.start();
    this.memoryMonitor.start();
  }

  /** Account authorization ended: local sessions stay listed, account-derived metadata is withdrawn. */
  public authorizationLost(): void {
    this.localSessionMetadataSource.authorizationLost();
  }

  /** Account authorization returned: account-derived session metadata reloads. */
  public authorizationRestored(): void {
    this.localSessionMetadataSource.authorizationRestored();
  }

  /** Applies a conversation title the process already learned. */
  public noteConversationTitle(conversationId: string, title: string | null): void {
    this.localSessionMetadataSource.noteConversationTitle(conversationId, title);
  }

  public async dispose(): Promise<void> {
    this.memoryMonitor.dispose();
    this.unsubscribeReconnect();
    this.unsubscribeAuthChanged();
    this.localSessionMetadataSource.dispose();
    for (const subscription of this.dispatchSubscriptions.splice(0)) subscription.dispose();
    this.subagentInteractionRuntime.dispose();
    await this.inputAdmissionLifecycle.dispose();
    this.runRegistry.dispose();
    await this.browserMcpAccess?.dispose();
    this.sessionActivitySource.dispose();
    this.localSessionReadSource.dispose();
    await this.messagePoster.cleanup();
    await this.projectModeBundleMaterializer.dispose();
  }
}
