import path from 'node:path';
import type { ApiRuntime } from '../../../../packages/ui-common/src/clients/shared';
import type { SessionMonitorEvaluationStore } from '../agents/session-monitor';
import {
  TaskMonitorMachineOwner,
  type TaskMonitorEffectHandlers,
} from '../agents/task-monitor/state-machine/task-monitor-machine-owner';
import type { TaskMonitorDecisionStore } from '../agents/task-monitor/task-monitor-decision-store';
import type { KeyPairStore } from '../credentials';
import type { MessagePoster } from '../run/message-poster';
import type { RunStore } from '../run-store';
import type { RunRegistry } from '../run/run-registry';
import { resolveBaseDir } from '../session/paths';
import { MonitorPipeline } from './monitors';
import type { AgentSessionReader } from './monitors/agent-session-reader';
import {
  DailySessionSettingsStore,
  dailySessionSettingsInputFromTriggerConfig,
  resolveDailySessionSettings,
  type DailySessionSettings,
} from './monitors/daily-session-settings';
import { DailySessionMonitor } from './monitors/declarations/daily-session';
import { SessionMonitor } from './monitors/declarations/session-monitor';
import type { AgentSource } from './monitors/normalizer';
import { resolvePersistedMonitorProject } from './monitors/project-context';
import {
  DEFAULT_TRIGGER_CONFIG,
  loadTriggerConfig,
  type TriggerConfig,
} from './monitors/trigger-config';
import type { PlatformAuthContext } from './platform-auth-context';
import type { PlatformWebSocketManager } from './platform-ws';
import type { ServerLogger } from './logger';
import type { LocalAgentService } from './local-agent-service';
import type { TaskMonitorManagedTurnRuntime } from './task-monitor-managed-turn-runtime';
import type { AgentOutputEvents } from './agent-output-events';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import type { TaskMonitorStateStore } from '../agents/task-monitor/state-machine/machine';
import { TaskMonitorSettlementMachineAdapter } from './task-monitor-settlement-machine-adapter';
import { TaskMonitorProviderEventAdmission } from './task-monitor-provider-event-admission';
import { TaskMonitorLaunchFailureAdapter } from './task-monitor-launch-failure-adapter';
import type { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../shared/logging/daily-session';

export interface MonitorApplicationRuntimeDependencies {
  apiBaseUrl: string;
  apiRuntime: ApiRuntime;
  authContext: PlatformAuthContext;
  agentService: LocalAgentService;
  runStore: RunStore;
  runRegistry: RunRegistry;
  keyPairStore: KeyPairStore;
  platformWebSocketManager: PlatformWebSocketManager;
  agentSessionReader: AgentSessionReader;
  agentSource: AgentSource;
  messagePoster: MessagePoster;
  taskMonitorDecisionStore: TaskMonitorDecisionStore;
  sessionMonitorEvaluationStore: SessionMonitorEvaluationStore;
  logger: ServerLogger;
  fetchImpl?: typeof fetch;
  triggerConfig?: TriggerConfig;
  taskMonitorManagedTurnRuntime: TaskMonitorManagedTurnRuntime;
  taskMonitorLaunchFailureRuntime: TaskMonitorLaunchFailureRuntime;
  dailySessionSettingsStore?: DailySessionSettingsStore;
  enableDailySession?: boolean;
}

/** Owns monitor declarations, shared Task Monitor start state, gates, and status state. */
export class MonitorApplicationRuntime {
  public readonly taskMonitorMachineOwner: TaskMonitorMachineOwner;

  private readonly agentSessionReader: AgentSessionReader;
  private readonly enableDailySession: boolean;
  private taskMonitorProviderEventAdmission: TaskMonitorProviderEventAdmission | null = null;
  private taskMonitorSettlementMachineAdapter: TaskMonitorSettlementMachineAdapter | null = null;
  private taskMonitorLaunchFailureAdapter: TaskMonitorLaunchFailureAdapter | null = null;
  private readonly _dailySessionSettingsStore: DailySessionSettingsStore;
  private initialization: Promise<void> | null = null;
  private _monitorPipeline: MonitorPipeline | null = null;

  public constructor(private readonly dependencies: MonitorApplicationRuntimeDependencies) {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    this.enableDailySession = dependencies.enableDailySession ?? false;
    this._dailySessionSettingsStore =
      dependencies.dailySessionSettingsStore ??
      new DailySessionSettingsStore({
        logger: dependencies.logger.child({ component: 'daily-session.settings' }),
      });
    this.taskMonitorMachineOwner = new TaskMonitorMachineOwner({
      apiBaseUrl: dependencies.apiBaseUrl,
      apiRuntime: dependencies.apiRuntime,
      fetchImpl,
      authContext: dependencies.authContext,
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      runRegistry: dependencies.runRegistry,
      keyPairStore: dependencies.keyPairStore,
      agentSessionReader: dependencies.agentSessionReader,
      messagePoster: dependencies.messagePoster,
      decisionStore: dependencies.taskMonitorDecisionStore,
      logger: dependencies.logger.child({ component: 'task-monitor.machine' }),
      taskMonitorLaunchFailureRuntime: dependencies.taskMonitorLaunchFailureRuntime,
    });
    this.agentSessionReader = dependencies.agentSessionReader;
    if (dependencies.triggerConfig) {
      if (this.enableDailySession) {
        const fallback = resolveDailySessionSettings(
          dailySessionSettingsInputFromTriggerConfig(dependencies.triggerConfig),
        );
        if (fallback.status !== 'ready') {
          throw new Error(
            `Daily Session fallback settings are invalid: ${fallback.issues.join('; ')}`,
          );
        }
        this.composePipeline(fetchImpl, dependencies.triggerConfig, fallback.settings);
      } else {
        this.composePipeline(fetchImpl, dependencies.triggerConfig);
      }
      this.initialization = Promise.resolve();
    } else {
      this.initialization = this.buildPipeline(fetchImpl);
    }
  }

  public get dailySessionSettingsStore(): DailySessionSettingsStore {
    return this._dailySessionSettingsStore;
  }

  public get taskMonitorMachineEffectHandler() {
    return this.taskMonitorMachineOwner.effectHandler;
  }

  public get taskMonitorEffectHandlers(): TaskMonitorEffectHandlers {
    return this.taskMonitorMachineOwner.effectHandlers;
  }

  public get monitorPipeline(): MonitorPipeline {
    if (!this._monitorPipeline) {
      throw new Error('MonitorApplicationRuntime has not been initialized.');
    }
    return this._monitorPipeline;
  }

  public async initialize(): Promise<void> {
    await this.initialization;
  }

  public async ensureDailySessionIdentity(): Promise<void> {
    try {
      await this.monitorPipeline.ensureDailySessionIdentity();
    } catch (error) {
      this.dependencies.logger.error(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'startup_identity_recovery_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public connectTaskMonitorProviderEvents(
    events: AgentOutputEvents,
    inputAdapter: TaskMonitorStateMachineInputAdapter,
    stateStore: TaskMonitorStateStore,
  ): void {
    if (this.taskMonitorProviderEventAdmission) return;
    this.taskMonitorProviderEventAdmission = new TaskMonitorProviderEventAdmission(
      this.dependencies.runRegistry,
      inputAdapter,
      this.dependencies.logger.child({ component: 'task-monitor.provider-events' }),
    );
    this.taskMonitorProviderEventAdmission.start(events);
    this.taskMonitorSettlementMachineAdapter = new TaskMonitorSettlementMachineAdapter(
      this.dependencies.agentSessionReader,
      this.dependencies.runStore,
      stateStore,
      inputAdapter,
      this.dependencies.logger.child({ component: 'task-monitor.settlement' }),
    );
    this.monitorPipeline.registerTaskMonitorTurnSupervisor(
      this.taskMonitorSettlementMachineAdapter,
    );
    this.taskMonitorLaunchFailureAdapter = new TaskMonitorLaunchFailureAdapter(
      this.dependencies.taskMonitorLaunchFailureRuntime,
      stateStore,
      inputAdapter,
      this.dependencies.logger.child({ component: 'task-monitor.launch-failure' }),
    );
    this.taskMonitorLaunchFailureAdapter.start();
  }

  public dispose(): void {
    this.taskMonitorMachineOwner.statePublication?.dispose();
    this.taskMonitorLaunchFailureAdapter?.dispose();
    this.taskMonitorLaunchFailureAdapter = null;
    this.taskMonitorProviderEventAdmission?.dispose();
    this.taskMonitorProviderEventAdmission = null;
    this.taskMonitorSettlementMachineAdapter = null;
    this._monitorPipeline?.dispose();
    this._monitorPipeline = null;
  }

  private async buildPipeline(fetchImpl: typeof fetch): Promise<void> {
    if (!this.enableDailySession) {
      this.composePipeline(fetchImpl, DEFAULT_TRIGGER_CONFIG);
      return;
    }
    const triggerConfig = await loadTriggerConfig();
    const auth = await this.dependencies.authContext.resolve();
    const persistedProject = auth
      ? null
      : resolvePersistedMonitorProject(
          await this.dependencies.runStore.findRunsByPromptType('daily_session'),
        );
    const projectId =
      auth?.projectId ?? (persistedProject?.status === 'found' ? persistedProject.projectId : null);
    let dailySessionSettings: DailySessionSettings;
    if (projectId) {
      const resolution = await this._dailySessionSettingsStore.load(
        projectId,
        dailySessionSettingsInputFromTriggerConfig(triggerConfig),
      );
      if (resolution.status === 'invalid') {
        throw new Error(`Daily Session settings are invalid: ${resolution.issues.join('; ')}`);
      }
      dailySessionSettings = resolution.settings;
      if (!auth) {
        this.dependencies.logger.info('daily_session.settings.project_context_recovered', {
          projectId,
          source: 'persisted_daily_session_run',
        });
      }
    } else {
      const fallback = resolveDailySessionSettings(
        dailySessionSettingsInputFromTriggerConfig(triggerConfig),
      );
      if (fallback.status === 'invalid') {
        throw new Error(
          `Daily Session fallback settings are invalid: ${fallback.issues.join('; ')}`,
        );
      }
      dailySessionSettings = fallback.settings;
      this.dependencies.logger.warn('daily_session.settings.project_context_unavailable', {
        source: 'trigger_config_fallback',
        reason: persistedProject?.status ?? 'auth_context_unavailable',
      });
    }
    this.composePipeline(fetchImpl, triggerConfig, dailySessionSettings);
  }

  private composePipeline(
    fetchImpl: typeof fetch,
    triggerConfig: TriggerConfig,
    dailySessionSettings?: DailySessionSettings,
  ): void {
    const sessionMonitor = new SessionMonitor();
    const monitors = dailySessionSettings
      ? [new DailySessionMonitor(dailySessionSettings), sessionMonitor]
      : [sessionMonitor];
    this._monitorPipeline = new MonitorPipeline({
      monitors,
      triggerConfig,
      authProvider: this.dependencies.authContext,
      agentService: this.dependencies.agentService,
      runStore: this.dependencies.runStore,
      platformWebSocketManager: this.dependencies.platformWebSocketManager,
      agentSessionReader: this.agentSessionReader,
      taskMonitorDecisionStore: this.dependencies.taskMonitorDecisionStore,
      sessionMonitorEvaluationStore: this.dependencies.sessionMonitorEvaluationStore,
      turnSupervisionReceiptStorePath: path.join(
        resolveBaseDir(),
        'runs',
        'turn-supervision-receipts.jsonl',
      ),
      apiBaseUrl: this.dependencies.apiBaseUrl,
      fetchImpl,
      logger: this.dependencies.logger.child({ component: 'monitors.pipeline' }),
      keyPairStore: this.dependencies.keyPairStore,
    });
  }
}
