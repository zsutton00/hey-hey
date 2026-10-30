import { MachineOptionsStore } from '../options/machine-options-store';
import { AgentApplicationRuntime } from '../agents/agent-application-runtime';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineLogic,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineRuntime,
  type TaskMonitorMachineState,
  type TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type {
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorInput,
} from '../agents/task-monitor/state-machine/events';
import { resolvePairingWebOrigin } from '../commands/pairing-web-url';
import { createMachineActions } from '../commands/machine-actions';
import type { DiagnosticFeed } from './diagnostic-feed';
import { resolveBaseDir } from '../session';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../state-machine';
import { AgentOutputEvents } from './agent-output-events';
import { LocalAgentApplicationLifecycle } from './local-agent-application-lifecycle';
import { LocalAgentInfrastructure } from './local-agent-infrastructure';
import { LocalAgentRouter } from './local-agent-router';
import { LocalAgentServerRuntime } from './local-agent-server-runtime';
import { createMockupReader } from './mockup-page-reader';
import { MonitorApplicationRuntime } from './monitor-application-runtime';
import { resolveMachineStateStorePath } from './machine-state-store-path';
import { MonitorEventSourceRuntime } from './monitor-event-source-runtime';
import { PlatformApplicationRuntime } from './platform-application-runtime';
import { EntityReportIndex } from './reports/entity-report-index';
import { RunApplicationRuntime } from './run-application-runtime';
import { RunLifecycleEvents } from './run-lifecycle-events';
import { TaskMonitorManagedTurnRuntime } from './task-monitor-managed-turn-runtime';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import { hostMachine, StateMachineApplicationRuntime } from './state-machine-application-runtime';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import { RunRetentionMaintenance } from '../run-store/run-retention-maintenance';
import { RunRetentionSettingsStore } from '../run-store/run-retention-settings';
import { RuntimeCapabilityCatalogLifecycle } from './runtime-capability-catalog';
import { OperationTimelineRegistry } from './input-admission/operation-timeline';

export interface StartLocalAgentServerOptions {
  preferredPort?: number;
  host?: string;
  enableDailySession?: boolean;
  terminal?: LocalTerminalOutput;
}

/** Where process diagnostics go when a presentation owns the terminal. */
export interface LocalTerminalOutput {
  diagnosticFeed: DiagnosticFeed;
  writeLogLine: (line: string) => void;
}

const DEFAULT_PREFERRED_PORT = 3847;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_RUN_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const readPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Composition root for the local-agent server's top-level runtime owners. */
export class LocalAgentServerBootstrap {
  public constructor(private readonly options: StartLocalAgentServerOptions = {}) {}

  public async start(): Promise<LocalAgentServerRuntime> {
    const terminal = this.options.terminal;
    const infrastructure = new LocalAgentInfrastructure(
      terminal
        ? { diagnosticFeed: terminal.diagnosticFeed, writeLogLine: terminal.writeLogLine }
        : {},
    );
    const capabilityCatalogLifecycle = new RuntimeCapabilityCatalogLifecycle(
      infrastructure.logger.child({ component: 'runtime-capability-catalog' }),
    );
    // Providers load in the background: a slow or broken one must not hold up or stop the CLI.
    capabilityCatalogLifecycle.start();
    try {
      await infrastructure.initialize();
    } catch (error) {
      await infrastructure.dispose();
      throw error;
    }

    const taskMonitorManagedTurnRuntime = new TaskMonitorManagedTurnRuntime(
      infrastructure.logger.child({ component: 'task-monitor.managed-turn' }),
    );
    const taskMonitorLaunchFailureRuntime = new TaskMonitorLaunchFailureRuntime(
      infrastructure.logger.child({ component: 'task-monitor.launch-failure' }),
    );
    const agentRuntime = new AgentApplicationRuntime({
      runStore: infrastructure.runStore,
      oauthClient: infrastructure.oauthClient,
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      logger: infrastructure.logger.child({ component: 'agents' }),
      isJevEnabled: () => new MachineOptionsStore().isJevEnabled(),
      taskMonitorManagedTurnRuntime,
    });
    infrastructure.logger.debug('local.bootstrap.agent_runtime.constructed');
    const reportIndex = new EntityReportIndex({
      logger: infrastructure.logger.child({ component: 'report-influence-index' }),
    });
    const agentOutputEvents = new AgentOutputEvents();
    const runLifecycleEvents = new RunLifecycleEvents();
    const operationTimeline = new OperationTimelineRegistry(infrastructure.logger);
    const runRuntime = new RunApplicationRuntime({
      capabilityCatalog: capabilityCatalogLifecycle,
      projectBrowsers: infrastructure.projectBrowsers,
      runStore: infrastructure.runStore,
      repoStore: infrastructure.repoStore,
      oauthClient: infrastructure.oauthClient,
      apiRuntime: infrastructure.apiRuntime,
      agentRuntime,
      agentOutputEvents,
      runLifecycleEvents,
      taskMonitorManagedTurnRuntime,
      taskMonitorLaunchFailureRuntime,
      logger: infrastructure.logger,
      dataDir: resolveBaseDir(),
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      authContext: infrastructure.platformAuthContext,
      reportIndex,
      agentSessionReader: infrastructure.agentSessionReader,
      toolRuleStore: infrastructure.toolRuleStore,
      monitorProjectContext: infrastructure.monitorProjectContext,
      platformWebSocketManager: infrastructure.platformWebSocketManager,
      keyPairStore: infrastructure.keyPairStore,
      hostActionAdmission: infrastructure.hostActionAdmission,
      controllerRegistry: infrastructure.controllerRegistryStore,
      operationTimeline,
      trackToolUsage: process.env['HEYHEY_TRACK_TOOLS'] !== '0',
      inactivityTimeoutMs: readPositiveNumber(
        process.env['HEYHEY_RUN_INACTIVITY_TIMEOUT_MS'],
        DEFAULT_RUN_INACTIVITY_TIMEOUT_MS,
      ),
    });
    infrastructure.logger.debug('local.bootstrap.run_runtime.constructed');
    const monitorEventSources = new MonitorEventSourceRuntime(
      runRuntime.runRegistry,
      agentOutputEvents,
    );
    const monitorRuntime = new MonitorApplicationRuntime({
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      apiRuntime: infrastructure.apiRuntime,
      authContext: infrastructure.platformAuthContext,
      agentService: runRuntime.agentService,
      runStore: infrastructure.runStore,
      runRegistry: runRuntime.runRegistry,
      keyPairStore: infrastructure.keyPairStore,
      platformWebSocketManager: infrastructure.platformWebSocketManager,
      agentSessionReader: infrastructure.agentSessionReader,
      agentSource: monitorEventSources.agentSource,
      messagePoster: runRuntime.messagePoster,
      taskMonitorDecisionStore: agentRuntime.taskMonitorDecisionStore,
      sessionMonitorEvaluationStore: agentRuntime.sessionMonitorEvaluationStore,
      taskMonitorManagedTurnRuntime,
      taskMonitorLaunchFailureRuntime,
      logger: infrastructure.logger,
      enableDailySession: this.options.enableDailySession ?? false,
    });

    try {
      await monitorRuntime.initialize();
      infrastructure.logger.debug('local.bootstrap.monitor_runtime.initialized');
    } catch (error) {
      monitorRuntime.dispose();
      monitorEventSources.dispose();
      await runRuntime.dispose();
      await infrastructure.dispose();
      throw error;
    }

    const machineStateStorePath = resolveMachineStateStorePath(
      resolveBaseDir(),
      infrastructure.normalizedApiBaseUrl,
    );
    infrastructure.logger.debug('local.bootstrap.machine_store.configured', {
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      machineStateStorePath,
    });
    const machineStore: TaskMonitorStateStore = new MachineStateStore(
      machineStateStorePath,
      taskMonitorStateStoreCodec,
    );
    const machineRuntime: TaskMonitorMachineRuntime = new MachineRuntime(
      machineStore,
      infrastructure.logger.child({ component: 'state-machine.runtime' }),
    );
    const machineRegistry: TaskMonitorMachineRegistry = new MachineRegistry(
      machineRuntime,
      infrastructure.logger.child({ component: 'state-machine.registry' }),
    );
    machineRegistry.register(createTaskMonitorDefinition());
    const effectRunner = new EffectRunner<
      string,
      TaskMonitorMachineState,
      TaskMonitorMachineEvent,
      TaskMonitorMachineContext,
      TaskMonitorMachineLogic,
      TaskMonitorMachineEffect,
      TaskMonitorMachineEffectOutcome,
      VerifiedTaskMonitorInput
    >(
      machineStore,
      machineRuntime,
      machineRegistry,
      monitorRuntime.taskMonitorEffectHandlers,
      infrastructure.logger.child({ component: 'state-machine.effects' }),
    );
    const recovery = new MachineRecovery(
      machineStore,
      machineRegistry,
      effectRunner,
      infrastructure.logger.child({ component: 'state-machine.recovery' }),
    );
    const statePublication = monitorRuntime.taskMonitorMachineOwner.connectStatePublication(
      machineRuntime,
      machineStore,
      infrastructure.platformWebSocketManager,
    );
    const stateMachineRuntime = new StateMachineApplicationRuntime(
      [
        hostMachine('task-monitor', recovery, effectRunner, statePublication),
        runRuntime.subagentFanoutMachine,
      ],
      infrastructure.logger.child({ component: 'state-machine.application' }),
    );
    const taskMonitorStateMachineInputAdapter = new TaskMonitorStateMachineInputAdapter(
      new AddressedMachineAdmission(
        machineRegistry,
        infrastructure.logger.child({ component: 'state-machine.addressed-admission' }),
      ),
      infrastructure.logger.child({ component: 'state-machine.input' }),
      machineStore,
    );
    const platformRuntime = new PlatformApplicationRuntime({
      diagnosticFeed: infrastructure.diagnosticFeed,
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      apiRuntime: infrastructure.apiRuntime,
      initialAccessToken: infrastructure.initialAccessToken,
      keyPairStore: infrastructure.keyPairStore,
      runStore: infrastructure.runStore,
      runRegistry: runRuntime.runRegistry,
      runChangedFilesReader: runRuntime.runChangedFilesReader,
      runReadRestoreCoordinator: runRuntime.runReadRestoreCoordinator,
      agentService: runRuntime.agentService,
      sessionActivity: runRuntime.sessionActivitySource,
      isRemoteToolCallViewingEnabled: runRuntime.isRemoteToolCallViewingEnabled,
      poster: runRuntime.messagePoster,
      agentRuntime,
      agentSource: monitorEventSources.agentSource,
      monitorRuntime,
      taskMonitorManagedTurnRuntime,
      runLifecycleEvents,
      reportIndex,
      platformAuthContext: infrastructure.platformAuthContext,
      projectContext: infrastructure.monitorProjectContext,
      platformWebSocketManager: infrastructure.platformWebSocketManager,
      controllerRegistryStore: infrastructure.controllerRegistryStore,
      hostActionAdmission: infrastructure.hostActionAdmission,
      machineControllerAuthority: infrastructure.machineControllerAuthority,
      logger: infrastructure.logger,
      taskMonitorStateMachineInputAdapter,
      operationTimeline,
    });
    const runRetentionMaintenance = new RunRetentionMaintenance(
      infrastructure.runStore,
      new RunRetentionSettingsStore(),
      infrastructure.logger.child({ component: 'run-retention' }),
    );
    const applicationLifecycle = new LocalAgentApplicationLifecycle({
      platformRuntime,
      stateMachineRuntime,
      monitorRuntime,
      monitorEventSources,
      runRuntime,
      infrastructure,
      logger: infrastructure.logger,
      runRetentionMaintenance,
      machineActions: createMachineActions(infrastructure),
    });
    const router = new LocalAgentRouter({
      toolCalls: {
        sessionActivity: runRuntime.sessionActivitySource,
        isRemoteToolCallViewingEnabled: runRuntime.isRemoteToolCallViewingEnabled,
      },
      allowedOrigins: [resolvePairingWebOrigin()],
      keyPairStore: infrastructure.keyPairStore,
      logger: infrastructure.logger,
      oauthClient: infrastructure.oauthClient,
      repoStore: infrastructure.repoStore,
      runRegistry: runRuntime.runRegistry,
      runChangedFilesReader: runRuntime.runChangedFilesReader,
      runReadRestoreCoordinator: runRuntime.runReadRestoreCoordinator,
      poster: runRuntime.messagePoster,
      ...(runRuntime.browserToolsController
        ? { browserToolsController: runRuntime.browserToolsController }
        : {}),
      ...(runRuntime.runTabs
        ? {
            sharedBrowser: {
              projectBrowsers: infrastructure.projectBrowsers,
              tabs: runRuntime.runTabs,
              readMockup: createMockupReader(infrastructure.apiRuntime.clients),
            },
          }
        : {}),
      submissionToolRegistry: agentRuntime.submissionToolRegistry,
    });
    infrastructure.httpServer.on('request', router.app);

    const serverRuntime = new LocalAgentServerRuntime({
      httpServer: infrastructure.httpServer,
      localAgentEndpoint: runRuntime.localAgentEndpoint,
      applicationLifecycle,
      logger: infrastructure.logger,
      host: this.options.host ?? DEFAULT_HOST,
      preferredPort:
        this.options.preferredPort ??
        readPositiveNumber(process.env['HEYHEY_SERVER_PORT'], DEFAULT_PREFERRED_PORT),
      projectBrowsers: infrastructure.projectBrowsers,
    });

    try {
      await stateMachineRuntime.start();
      infrastructure.logger.debug('local.bootstrap.state_machine_runtime.started');
      monitorRuntime.connectTaskMonitorProviderEvents(
        agentOutputEvents,
        taskMonitorStateMachineInputAdapter,
        machineStore,
      );
      infrastructure.logger.debug('local.bootstrap.task_monitor_admission.started');
      await platformRuntime.start();
      infrastructure.logger.debug('local.bootstrap.platform_runtime.started');
      const startedServer = await serverRuntime.start();
      applicationLifecycle.startAfterReadiness();
      return startedServer;
    } catch (error) {
      await serverRuntime.close();
      throw error;
    }
  }
}
