import type { DiagnosticFeed } from './diagnostic-feed';
import type { ApiRuntime } from '../../../../packages/ui-common/src/clients/shared';
import type { AgentApplicationRuntime } from '../agents/agent-application-runtime';
import { ReportEmissionPublisher } from '../agents/submission-tools/report-emission-publisher';
import type { KeyPairStore } from '../credentials';
import type { RunRegistry } from '../run/run-registry';
import type { MessagePoster } from '../run/message-poster';
import type { RunStore } from '../run-store';
import type { SessionActivitySource } from './session-activity-source';
import type { AgentSource } from './monitors/normalizer';
import type { LocalAgentService } from './local-agent-service';
import type { ServerLogger } from './logger';
import { MachineRevocationSurface } from './machine-revocation-surface';
import type { MonitorApplicationRuntime } from './monitor-application-runtime';
import type { MonitorProjectContext } from './monitors/project-context';
import type { PlatformAuthContext } from './platform-auth-context';
import { PlatformEventDispatcher } from './platform-event-dispatcher';
import type { PlatformWebSocketManager } from './platform-ws';
import { EntityReportIndex } from './reports/entity-report-index';
import { ReportInfluenceRuntime } from './reports/report-influence-runtime';
import { RunCompletionEffects, type RunLifecycleEvents } from './run-lifecycle-events';
import { RunPhaseReplayer } from './run-phase-replayer';
import { ConversationRoomSubscriptions } from './conversation-room-subscriptions';
import { TriggerVerificationRuntime } from './trigger-verification/trigger-verification-runtime';
import { CliReadHandler } from './cli-read-handler';
import { CliSettingsHandler } from './cli-settings-handler';
import type { RunChangedFilesReader } from './run-changed-files';
import type { TaskMonitorManagedTurnRuntime } from './task-monitor-managed-turn-runtime';
import { TaskMonitorManagedTurnPublisher } from './monitors/task-monitor-managed-turn-publisher';
import { RunReadRestoreCoordinator } from './restore-persisted-runs';
import type { ControllerRegistryStore } from '../credentials';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';
import type { MachineControllerAuthority } from '../auth/machine-controller-authority';
import { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import type { OperationTimelineRegistry } from './input-admission/operation-timeline';

export interface PlatformApplicationRuntimeDependencies {
  apiBaseUrl: string;
  apiRuntime: ApiRuntime;
  initialAccessToken: string;
  keyPairStore: KeyPairStore;
  runStore: RunStore;
  runRegistry: RunRegistry;
  runChangedFilesReader: RunChangedFilesReader;
  runReadRestoreCoordinator?: RunReadRestoreCoordinator;
  agentService: LocalAgentService;
  sessionActivity: Pick<SessionActivitySource, 'snapshot'>;
  isRemoteToolCallViewingEnabled: () => Promise<boolean>;
  poster: MessagePoster;
  agentRuntime: AgentApplicationRuntime;
  agentSource: AgentSource;
  monitorRuntime: MonitorApplicationRuntime;
  runLifecycleEvents: RunLifecycleEvents;
  reportIndex: EntityReportIndex;
  platformAuthContext: PlatformAuthContext;
  projectContext: MonitorProjectContext;
  platformWebSocketManager: PlatformWebSocketManager;
  logger: ServerLogger;
  taskMonitorStateMachineInputAdapter: TaskMonitorStateMachineInputAdapter;
  fetchImpl?: typeof fetch;
  taskMonitorManagedTurnRuntime: TaskMonitorManagedTurnRuntime;
  controllerRegistryStore?: ControllerRegistryStore;
  hostActionAdmission?: HostActionAdmission;
  machineControllerAuthority?: Pick<MachineControllerAuthority, 'applyVerifiedAuthorityReduction'>;
  operationTimeline?: OperationTimelineRegistry;
  diagnosticFeed?: DiagnosticFeed;
}

/** Owns all subscriptions and lifecycle effects crossing the platform boundary. */
export class PlatformApplicationRuntime {
  private readonly reportInfluenceRuntime: ReportInfluenceRuntime;
  private readonly triggerVerificationRuntime: TriggerVerificationRuntime;
  private readonly cliReadHandler: CliReadHandler;
  private readonly cliSettingsHandler: CliSettingsHandler;
  private readonly reportEmissionPublisher: ReportEmissionPublisher;
  private readonly taskMonitorManagedTurnPublisher: TaskMonitorManagedTurnPublisher;
  private readonly runRestoreCoordinator: RunReadRestoreCoordinator;
  private readonly runCompletionEffects: RunCompletionEffects;
  private readonly platformEventDispatcher: PlatformEventDispatcher;
  private readonly conversationRoomSubscriptions: ConversationRoomSubscriptions;
  private readonly machineRevocationSurface: MachineRevocationSurface;
  private readonly runPhaseReplayer: RunPhaseReplayer;
  private unsubscribeRunFinished: (() => void) | null = null;
  private unsubscribeReconnect: (() => void) | null = null;
  private unsubscribeMachineRevoked: (() => void) | null = null;
  private started = false;

  public constructor(private readonly dependencies: PlatformApplicationRuntimeDependencies) {
    const logger = dependencies.logger.child({ component: 'platform-application' });
    this.reportInfluenceRuntime = new ReportInfluenceRuntime({
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl ?? fetch,
      authContext: dependencies.platformAuthContext,
      runStore: dependencies.runStore,
      agentService: dependencies.agentService,
      index: dependencies.reportIndex,
      logger: logger.child({ component: 'report-influence' }),
    });
    this.runRestoreCoordinator =
      dependencies.runReadRestoreCoordinator ??
      new RunReadRestoreCoordinator({
        runStore: dependencies.runStore,
        runRegistry: dependencies.runRegistry,
        logger: logger.child({ component: 'run-restore' }),
      });
    this.triggerVerificationRuntime = new TriggerVerificationRuntime({
      ...(dependencies.diagnosticFeed ? { diagnosticFeed: dependencies.diagnosticFeed } : {}),
      keyPairStore: dependencies.keyPairStore,
      initialAccessToken: dependencies.initialAccessToken,
      machinesApi: dependencies.apiRuntime.clients.machines,
      runStore: dependencies.runStore,
      agentService: dependencies.agentService,
      promptTypeRegistry: dependencies.agentRuntime.promptTypeRegistry,
      runRegistry: dependencies.runRegistry,
      runRestoreCoordinator: this.runRestoreCoordinator,
      poster: dependencies.poster,
      projectContext: dependencies.projectContext,
      taskMonitorStateMachineInputAdapter: dependencies.taskMonitorStateMachineInputAdapter,
      ...(dependencies.operationTimeline
        ? { operationTimeline: dependencies.operationTimeline }
        : {}),
      ...(dependencies.controllerRegistryStore
        ? { controllerRegistryStore: dependencies.controllerRegistryStore }
        : {}),
      ...(dependencies.hostActionAdmission
        ? { hostActionAdmission: dependencies.hostActionAdmission }
        : {}),
      ...(dependencies.machineControllerAuthority
        ? { machineControllerAuthority: dependencies.machineControllerAuthority }
        : {}),
      logger: logger.child({ component: 'trigger-verification' }),
    });
    this.cliReadHandler = new CliReadHandler({
      triggerVerificationRuntime: this.triggerVerificationRuntime,
      runStore: dependencies.runStore,
      runRegistry: dependencies.runRegistry,
      runChangedFilesReader: dependencies.runChangedFilesReader,
      agentService: dependencies.agentService,
      sessionActivity: dependencies.sessionActivity,
      isRemoteToolCallViewingEnabled: dependencies.isRemoteToolCallViewingEnabled,
      logger: logger.child({ component: 'cli-read' }),
      runReadRestoreCoordinator: this.runRestoreCoordinator,
      ...(dependencies.hostActionAdmission
        ? { hostActionAdmission: dependencies.hostActionAdmission }
        : {}),
    });
    this.cliSettingsHandler = new CliSettingsHandler({
      triggerVerificationRuntime: this.triggerVerificationRuntime,
      settingsStore: dependencies.monitorRuntime.dailySessionSettingsStore,
      monitorPipeline: dependencies.monitorRuntime.monitorPipeline,
      authContext: dependencies.platformAuthContext,
      logger: logger.child({ component: 'cli-settings' }),
    });
    this.reportEmissionPublisher = new ReportEmissionPublisher(
      dependencies.agentSource,
      dependencies.monitorRuntime.monitorPipeline,
      logger.child({ component: 'report-emission' }),
    );
    this.taskMonitorManagedTurnPublisher = new TaskMonitorManagedTurnPublisher(
      dependencies.taskMonitorManagedTurnRuntime,
      dependencies.agentSource,
      dependencies.monitorRuntime.monitorPipeline,
      logger.child({ component: 'task-monitor-managed-turn' }),
    );
    this.runCompletionEffects = new RunCompletionEffects(this.reportInfluenceRuntime);
    this.platformEventDispatcher = new PlatformEventDispatcher({
      platformWebSocketManager: dependencies.platformWebSocketManager,
      triggerVerificationRuntime: this.triggerVerificationRuntime,
      agentSource: dependencies.agentSource,
      monitorPipeline: dependencies.monitorRuntime.monitorPipeline,
      reportInfluenceRuntime: this.reportInfluenceRuntime,
      logger: logger.child({ component: 'event-dispatcher' }),
    });
    this.conversationRoomSubscriptions = new ConversationRoomSubscriptions({
      runRegistry: dependencies.runRegistry,
      runLifecycleEvents: dependencies.runLifecycleEvents,
      runStore: dependencies.runStore,
      platformWebSocketManager: dependencies.platformWebSocketManager,
      projectContext: dependencies.projectContext,
      logger: logger.child({ component: 'conversation-rooms' }),
    });
    this.machineRevocationSurface = new MachineRevocationSurface(
      dependencies.poster,
      dependencies.projectContext,
      logger.child({ component: 'machine-revocation' }),
    );
    this.runPhaseReplayer = new RunPhaseReplayer(dependencies.runRegistry);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.dependencies.logger.debug('platform-application.starting');
    await this.triggerVerificationRuntime.initialize();

    const { agentRuntime, platformWebSocketManager, projectContext, runLifecycleEvents } =
      this.dependencies;
    platformWebSocketManager.setCliReadHandler(this.cliReadHandler);
    platformWebSocketManager.setCliSettingsHandler(
      this.cliSettingsHandler.handle.bind(this.cliSettingsHandler),
    );
    agentRuntime.reportEmissionEvents.subscribe(this.reportEmissionPublisher.handle);
    this.taskMonitorManagedTurnPublisher.start();
    this.unsubscribeRunFinished = runLifecycleEvents.onRunFinished(
      this.runCompletionEffects.handleRunFinished,
    );
    this.unsubscribeReconnect = platformWebSocketManager.onReconnect(
      this.runPhaseReplayer.handleReconnect,
    );
    this.unsubscribeMachineRevoked = platformWebSocketManager.onMachineRevoked(
      this.machineRevocationSurface.handle,
    );
    this.conversationRoomSubscriptions.start();
    this.platformEventDispatcher.start();
    this.started = true;

    await projectContext.restore();
    await this.dependencies.monitorRuntime.ensureDailySessionIdentity();
    platformWebSocketManager.connect();
    void this.reportInfluenceRuntime.rehydrate().catch((error: unknown) => {
      this.dependencies.logger.error('report-update.rehydrate.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.dependencies.logger.debug('platform-application.started');
  }

  public dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.platformEventDispatcher.dispose();
    this.triggerVerificationRuntime.dispose();
    this.conversationRoomSubscriptions.dispose();
    this.dependencies.agentRuntime.reportEmissionEvents.unsubscribe(
      this.reportEmissionPublisher.handle,
    );
    this.taskMonitorManagedTurnPublisher.dispose();
    this.unsubscribeRunFinished?.();
    this.unsubscribeReconnect?.();
    this.unsubscribeMachineRevoked?.();
    this.unsubscribeRunFinished = null;
    this.unsubscribeReconnect = null;
    this.unsubscribeMachineRevoked = null;
    this.dependencies.logger.debug('platform-application.stopped');
  }
}
