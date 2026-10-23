import type { LocalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import { z } from 'zod';
import {
  parseTaskMonitorDecision,
  type TaskMonitorDecisionParseResult,
} from '../../agents/task-monitor/task-monitor-response';
import {
  LocalReasoningEffort,
  LocalPromptType,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import type {
  TaskMonitorLaunchConfig,
  TaskMonitorPromptPayload,
  RunContextMetadata,
} from '../../shared/agent-bridge-contract/generated';
import type { MonitorRunEnsuredResponse } from '../../shared/agent-bridge-contract/contract';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionType,
  WorkflowName,
} from '../../shared/api/generated/api';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import { calculateDelta } from '../../agents/daily-session/delta-calculator';
import type { TaskMonitorDecisionStore } from '../../agents/task-monitor/task-monitor-decision-store';
import type { TaskMonitorCoordinationLocalState } from '../../agents/task-monitor/task-monitor-coordination';
import type { SessionMonitorEvaluationStore } from '../../agents/session-monitor';
import type { RunStore } from '../../run-store/run-store';
import type { KeyPairStore } from '../../credentials';
import type { ServerLogger } from '../logger';
import type { LocalAgentService } from '../local-agent-service';
import type { PlatformWebSocketManager } from '../platform-ws';
import type { PlatformAuth, PlatformAuthContext } from '../platform-auth-context';
import type { AgentSessionReader } from './agent-session-reader';
import type { DailySessionSettings } from './daily-session-settings';
import { DailySessionMonitor } from './declarations/daily-session';
import {
  SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION,
  SESSION_MONITOR_RUN_CONFIG,
} from './declarations/session-monitor';
import type { Monitor } from './declarations/types';
import type { CanonicalMonitorEvent, CanonicalSettledTurnMonitorEvent } from './normalizer';
import { isSettledTurnEvent } from './normalizer';
import { SessionMonitorTurnEvaluator } from './session-monitor-turn-evaluator';
import {
  TurnSupervisionChain,
  type TurnSupervisionDisposition,
  type TurnSupervisor,
  type TurnSupervisorResolver,
} from './turn-supervision-chain';
import { FileTurnSupervisionReceiptStore } from './turn-supervision-receipt-store';

export interface MonitorRunnerResult {
  runId: string;
  coordinatorAgentSessionId: string;
}

export interface TaskMonitorRunIdentityInput {
  monitorId: string;
  launchConfig?: TaskMonitorLaunchConfig;
}

const buildContextMetadataSeed = (
  auth: PlatformAuth,
): Omit<RunContextMetadata, 'agentSessionId'> => ({
  capturedAt: new Date().toISOString(),
  organizationId: auth.organizationId,
  projectId: auth.projectId,
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
});

const toTaskMonitorRunConfig = (config: TaskMonitorLaunchConfig | undefined) => {
  if (!config) return undefined;
  const provider =
    config.provider === 'claude'
      ? LocalRunProvider.Claude
      : config.provider === 'codex'
        ? LocalRunProvider.Codex
        : LocalRunProvider.Opencode;
  return {
    provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  };
};

export interface TaskMonitorCoordinatorRunnerDependencies {
  authProvider: PlatformAuthContext;
  agentService: LocalAgentService;
  runStore: RunStore;
  decisionStore: TaskMonitorDecisionStore;
  logger: ServerLogger;
}

/** Owns Task Monitor coordinator-run identity and turn dispatch. */
export class TaskMonitorCoordinatorRunner {
  public constructor(private readonly dependencies: TaskMonitorCoordinatorRunnerDependencies) {}

  public async reconcileRejectedAttempt(
    monitorId: string,
    projectId: string,
    attemptId: string,
  ): Promise<Extract<TaskMonitorDecisionParseResult, { ok: false }> | null> {
    const runs = await this.dependencies.runStore.findRunsByPromptType(LocalPromptType.TaskMonitor);
    for (const run of runs) {
      const lifecycle = z
        .object({ monitorId: z.string() })
        .safeParse(run.sessionContext?.['taskMonitorLifecycle']);
      if (
        run.contextMetadata?.projectId !== projectId ||
        !lifecycle.success ||
        lifecycle.data.monitorId !== monitorId
      )
        continue;
      const receipt = z
        .object({ attemptId: z.string(), output: z.string() })
        .safeParse(run.sessionContext?.['taskMonitorCoordinatorReceipt']);
      if (!receipt.success || receipt.data.attemptId !== attemptId) continue;
      const result = parseTaskMonitorDecision(receipt.data.output);
      if (!result.ok) return result;
    }
    return null;
  }

  public async ensureTaskMonitorRun(
    input: TaskMonitorRunIdentityInput,
    expectedAuth: Pick<PlatformAuth, 'organizationId' | 'projectId'>,
  ): Promise<MonitorRunnerResult | undefined> {
    const auth = await this.dependencies.authProvider.resolve(expectedAuth.projectId);
    if (
      !auth ||
      auth.organizationId !== expectedAuth.organizationId ||
      auth.projectId !== expectedAuth.projectId
    ) {
      this.dependencies.logger.warn('task_monitor.identity.auth_unavailable_or_mismatched', {
        monitorId: input.monitorId,
        organizationId: expectedAuth.organizationId,
        projectId: expectedAuth.projectId,
      });
      return undefined;
    }
    return this.ensureWithAuth(auth, input);
  }

  public async runTaskMonitor(
    command: TaskMonitorPromptPayload,
    expectedAuth: Pick<PlatformAuth, 'organizationId' | 'projectId'>,
    coordination?: TaskMonitorCoordinationLocalState,
  ): Promise<MonitorRunnerResult | undefined> {
    const auth = await this.dependencies.authProvider.resolve(expectedAuth.projectId);
    if (
      !auth ||
      auth.organizationId !== expectedAuth.organizationId ||
      auth.projectId !== expectedAuth.projectId
    ) {
      this.dependencies.logger.warn('task_monitor.command.auth_unavailable_or_mismatched', {
        monitorId: command.monitorId,
        organizationId: expectedAuth.organizationId,
        projectId: expectedAuth.projectId,
      });
      return undefined;
    }
    return this.runWithAuth(auth, command, coordination);
  }

  private async runWithAuth(
    auth: PlatformAuth,
    command: TaskMonitorPromptPayload,
    coordination?: TaskMonitorCoordinationLocalState,
  ): Promise<MonitorRunnerResult> {
    const { agentService, logger, runStore } = this.dependencies;
    logger.debug('monitors.runner.task_monitor.identity.started', {
      monitorId: command.monitorId,
      cause: command.cause,
      correlationId: command.correlationId,
    });
    const identity = await this.ensureWithAuth(auth, {
      monitorId: command.monitorId,
      ...(command.launchConfig ? { launchConfig: command.launchConfig } : {}),
    });
    const runId = identity.runId;

    if (
      command.cause === 'START' ||
      command.cause === 'RESUME' ||
      command.cause === 'CONTINUE' ||
      command.cause === 'JUDGMENT_RESOLVED'
    ) {
      this.dependencies.decisionStore.bind(
        runId,
        command.correlationId,
        ...(command.coordinatorAttemptId ? [command.coordinatorAttemptId] : []),
      );
    }

    await runStore.updateRunSessionContext(runId, {
      taskMonitorLifecycle: {
        monitorId: command.monitorId,
        cause: command.cause,
        correlationId: command.correlationId,
        ...(command.userMessage ? { userMessage: command.userMessage } : {}),
      },
      ...(command.launchConfig ? { taskMonitorLaunchConfig: command.launchConfig } : {}),
      ...(coordination ? { taskMonitorCoordination: coordination } : {}),
    });
    const request: LocalRunPromptRequest = {
      promptType: LocalPromptType.TaskMonitor,
      payload: {
        promptType: LocalPromptType.TaskMonitor,
        entity: { entityType: 'TASK', entityId: command.monitorId },
        monitorId: command.monitorId,
        cause: command.cause,
        correlationId: command.correlationId,
        ...(command.coordinatorAttemptId
          ? { coordinatorAttemptId: command.coordinatorAttemptId }
          : {}),
        ...(command.correction ? { correction: command.correction } : {}),
        ...(command.settledTurn ? { settledTurn: command.settledTurn } : {}),
        ...(command.userMessage ? { userMessage: command.userMessage } : {}),
        ...(command.judgment ? { judgment: command.judgment } : {}),
      },
      references: { resolved: [], unresolved: [] },
    };
    const attemptId = command.coordinatorAttemptId;
    if (attemptId) {
      await agentService.sendSystemMessage(runId, request, {
        admittedInput: {
          turnId: attemptId,
          onStarted: async () => {
            this.dependencies.decisionStore.bindTurn(runId, attemptId, attemptId);
          },
          onRejected: async () => {
            this.dependencies.decisionStore.publish(
              runId,
              {
                status: 'INVALID',
                reason: 'Coordinator input was rejected before execution.',
                failure: {
                  code: 'COORDINATOR_INPUT_REJECTED',
                  message: 'Coordinator input was rejected before execution.',
                  issues: [],
                },
              },
              attemptId,
            );
          },
          onSettled: async () => undefined,
        },
      });
    } else {
      await agentService.sendSystemMessage(runId, request);
    }
    logger.info('monitors.runner.task_monitor.fired', {
      monitorId: command.monitorId,
      cause: command.cause,
      correlationId: command.correlationId,
      turnId: command.settledTurn?.turnId,
      reportCount: command.settledTurn?.reports.length,
      runId,
      coordinatorAgentSessionId: identity.coordinatorAgentSessionId,
    });
    return identity;
  }

  private async ensureWithAuth(
    auth: PlatformAuth,
    input: TaskMonitorRunIdentityInput,
  ): Promise<MonitorRunnerResult> {
    const taskMonitorRunConfig = toTaskMonitorRunConfig(input.launchConfig);
    const ensured = await this.dependencies.agentService.ensureRunForMonitor({
      accessToken: auth.accessToken,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      promptType: LocalPromptType.TaskMonitor,
      agentSessionType: AgentSessionType.TaskMonitor,
      workflowType: WorkflowName.TaskMonitor,
      contextMetadataSeed: {
        ...buildContextMetadataSeed(auth),
        taskMonitorId: input.monitorId,
      },
      ...(taskMonitorRunConfig ? { runConfig: taskMonitorRunConfig } : {}),
      keyBy: { mode: 'taskMonitor', monitorId: input.monitorId },
    });
    const runId = ensured.run.agentic_session_id;
    return { runId, coordinatorAgentSessionId: ensured.agentSessionId };
  }
}

interface DailySessionRunnerDependencies {
  agentService: LocalAgentService;
  runStore: RunStore;
  platformWebSocketManager: PlatformWebSocketManager;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
  keyPairStore: KeyPairStore;
}

class DailySessionRunner {
  public constructor(private readonly dependencies: DailySessionRunnerDependencies) {}

  public async ensureIdentity(
    auth: PlatformAuth,
    settings: DailySessionSettings,
  ): Promise<MonitorRunEnsuredResponse> {
    const { agentService, logger, platformWebSocketManager } = this.dependencies;
    const machineId = await this.dependencies.keyPairStore.loadCurrentMachineId();
    if (!machineId) {
      throw new Error('Daily Session identity recovery requires a paired machine.');
    }
    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'identity_resolution_started',
      projectId: auth.projectId,
      provider: settings.provider,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    });
    const ensured = await agentService.ensureRunForMonitor({
      accessToken: auth.accessToken,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      promptType: LocalPromptType.DailySession,
      agentSessionType: AgentSessionType.DailySession,
      workflowType: WorkflowName.DailySession,
      machineId,
      contextMetadataSeed: buildContextMetadataSeed(auth),
      runConfig: {
        provider: settings.provider,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
      },
      keyBy: { mode: 'project' },
    });
    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'identity_resolved',
      projectId: auth.projectId,
      runId: ensured.run.agentic_session_id,
      conversationId: ensured.ownConversationId,
      created: ensured.created,
    });

    if (ensured.created) {
      platformWebSocketManager.emitDailySessionUpdate({
        projectId: auth.projectId,
        sessionId: ensured.run.agentic_session_id,
        updateType: 'session_created',
      });
    }
    return ensured;
  }

  public async run(
    auth: PlatformAuth,
    batch: readonly CanonicalMonitorEvent[],
    settings: DailySessionSettings,
  ): Promise<void> {
    const { agentService, logger, platformWebSocketManager, runStore } = this.dependencies;
    const { run } = await this.ensureIdentity(auth, settings);
    const runId = run.agentic_session_id;

    const delta = await calculateDelta(batch.length, {
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      fetchImpl: this.dependencies.fetchImpl,
      accessToken: auth.accessToken,
      apiBaseUrl: this.dependencies.apiBaseUrl,
      logger: logger.child({ component: 'daily-session.delta-calculator' }),
    });
    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'delta_calculated',
      runId,
      signalCount: delta.signalCount,
    });
    await runStore.updateRunSessionContext(runId, { triggerDelta: delta });

    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, { stage: 'turn_dispatch_started', runId });
    await agentService.sendSystemMessage(runId, {
      promptType: LocalPromptType.DailySession,
      payload: { promptType: LocalPromptType.DailySession, payloadVersion: 1 },
      references: { resolved: [], unresolved: [] },
    });
    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, { stage: 'turn_dispatched', runId });

    platformWebSocketManager.emitDailySessionUpdate({
      projectId: auth.projectId,
      sessionId: runId,
      updateType: 'trigger_fired',
    });
    logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'trigger_fired',
      runId,
      signalCount: delta.signalCount,
    });
  }
}

class SessionMonitorTurnSupervisor implements TurnSupervisor {
  public readonly id = 'SESSION_MONITOR' as const;

  public constructor(private readonly evaluator: SessionMonitorTurnEvaluator) {}

  public async invoke(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<TurnSupervisionDisposition> {
    const result = await this.evaluator.evaluate(event, auth);
    return result.status === 'HANDLED'
      ? { status: 'HANDLED', supervisor: this.id }
      : { ...result, supervisor: this.id };
  }
}

class ConfiguredTurnSupervisorResolver implements TurnSupervisorResolver {
  private taskMonitor: TurnSupervisor | null = null;

  public constructor(private readonly sessionMonitor: TurnSupervisor) {}

  public registerTaskMonitor(taskMonitor: TurnSupervisor): void {
    this.taskMonitor = taskMonitor;
  }

  public resolve(event: CanonicalSettledTurnMonitorEvent): Promise<readonly TurnSupervisor[]> {
    void event;
    return Promise.resolve(
      this.taskMonitor ? [this.sessionMonitor, this.taskMonitor] : [this.sessionMonitor],
    );
  }
}

export interface MonitorRunnerDependencies {
  authProvider: PlatformAuthContext;
  agentService: LocalAgentService;
  runStore: RunStore;
  platformWebSocketManager: PlatformWebSocketManager;
  agentSessionReader: AgentSessionReader;
  taskMonitorDecisionStore: TaskMonitorDecisionStore;
  sessionMonitorEvaluationStore: SessionMonitorEvaluationStore;
  turnSupervisionReceiptStorePath: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger: ServerLogger;
  keyPairStore: KeyPairStore;
}

/** Routes fired monitor events through responsibility-specific runner owners. */
export class MonitorRunner {
  private readonly dailySessionRunner: DailySessionRunner;
  private readonly sessionMonitorTurnEvaluator: SessionMonitorTurnEvaluator;
  private readonly turnSupervisorResolver: ConfiguredTurnSupervisorResolver;
  private readonly turnSupervisionChain: TurnSupervisionChain;

  public constructor(private readonly dependencies: MonitorRunnerDependencies) {
    this.dailySessionRunner = new DailySessionRunner({
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      platformWebSocketManager: dependencies.platformWebSocketManager,
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl ?? fetch,
      logger: dependencies.logger,
      keyPairStore: dependencies.keyPairStore,
    });
    this.sessionMonitorTurnEvaluator = new SessionMonitorTurnEvaluator({
      agentService: dependencies.agentService,
      agentSessionReader: dependencies.agentSessionReader,
      evaluationStore: dependencies.sessionMonitorEvaluationStore,
      reportTypeSubscription: SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION,
      runConfig: SESSION_MONITOR_RUN_CONFIG,
      logger: dependencies.logger.child({ component: 'session-monitor.turn-evaluator' }),
    });
    const sessionMonitorSupervisor = new SessionMonitorTurnSupervisor(
      this.sessionMonitorTurnEvaluator,
    );
    this.turnSupervisorResolver = new ConfiguredTurnSupervisorResolver(sessionMonitorSupervisor);
    this.turnSupervisionChain = new TurnSupervisionChain({
      resolver: this.turnSupervisorResolver,
      receipts: new FileTurnSupervisionReceiptStore(dependencies.turnSupervisionReceiptStorePath),
      logger: dependencies.logger.child({ component: 'turn-supervision.chain' }),
    });
  }

  public registerTaskMonitorTurnSupervisor(supervisor: TurnSupervisor): void {
    this.turnSupervisorResolver.registerTaskMonitor(supervisor);
  }

  public ensureDailySessionIdentity(
    auth: PlatformAuth,
    settings: DailySessionSettings,
  ): Promise<MonitorRunEnsuredResponse> {
    return this.dailySessionRunner.ensureIdentity(auth, settings);
  }

  public async run(
    monitor: Monitor,
    batch: readonly CanonicalMonitorEvent[],
  ): Promise<MonitorRunnerResult | undefined> {
    const auth = await this.dependencies.authProvider.resolve();
    if (!auth) {
      this.dependencies.logger.warn('monitors.runner.auth_unavailable', {
        declarationId: monitor.id,
      });
      return undefined;
    }

    switch (monitor.route) {
      case LocalPromptType.DailySession:
        if (!(monitor instanceof DailySessionMonitor)) {
          throw new Error('Daily Session route requires a DailySessionMonitor declaration.');
        }
        await this.dailySessionRunner.run(auth, batch, monitor.settings);
        return undefined;
      case LocalPromptType.SessionMonitor:
        {
          const event = batch.find(isSettledTurnEvent);
          if (!event) {
            this.dependencies.logger.warn('monitors.runner.session_monitor.no_settled_turn', {
              batchSize: batch.length,
            });
            return undefined;
          }
          await this.turnSupervisionChain.dispatch(event, auth);
        }
        return undefined;
      default:
        this.dependencies.logger.warn('monitors.runner.unsupported_route', {
          declarationId: monitor.id,
          route: monitor.route,
        });
        return undefined;
    }
  }
}
