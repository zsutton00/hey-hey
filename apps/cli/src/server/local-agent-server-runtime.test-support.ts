import { MachineActions } from '../commands/machine-actions';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

import { AgentApplicationRuntime } from '../agents/agent-application-runtime';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorInput,
} from '../agents/task-monitor/state-machine/events';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineLogic,
  type TaskMonitorMachineRuntime,
  type TaskMonitorMachineState,
  type TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type { Run } from '../run/run';
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
import { LocalAgentServerRuntime } from './local-agent-server-runtime';
import { MonitorApplicationRuntime } from './monitor-application-runtime';
import { MonitorEventSourceRuntime } from './monitor-event-source-runtime';
import { PlatformApplicationRuntime } from './platform-application-runtime';
import { EntityReportIndex } from './reports/entity-report-index';
import { RunApplicationRuntime } from './run-application-runtime';
import { TaskMonitorManagedTurnRuntime } from './task-monitor-managed-turn-runtime';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import { RunLifecycleEvents } from './run-lifecycle-events';
import { hostMachine, StateMachineApplicationRuntime } from './state-machine-application-runtime';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import { RunRetentionMaintenance } from '../run-store/run-retention-maintenance';
import { RunRetentionSettingsStore } from '../run-store/run-retention-settings';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

/**
 * Construct the same concrete top-level owners as the server composition root,
 * without starting authentication, platform sockets, or an HTTP listener.
 */
export interface TestLocalAgentServerRuntimeOptions {
  httpServer?: HttpServer;
  runs?: Run[];
  host?: string;
  preferredPort?: number;
  fetchImpl?: typeof fetch;
  enableDailySession?: boolean;
}

export const createTestLocalAgentServerRuntimeOwners = (
  options: TestLocalAgentServerRuntimeOptions = {},
) => {
  const infrastructure = new LocalAgentInfrastructure({ apiBaseUrl: 'https://api.test.local' });
  const fetchImpl = options.fetchImpl ?? fetch;
  const dataDir = path.join(os.tmpdir(), `heyhey-server-runtime-test-${randomUUID()}`);
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
    isJevParentFeatureFilterEnabled: () => Promise.resolve(true),
    taskMonitorManagedTurnRuntime,
    fetchImpl,
  });
  const reportIndex = new EntityReportIndex({
    logger: infrastructure.logger.child({ component: 'report-influence-index' }),
  });
  const agentOutputEvents = new AgentOutputEvents();
  const runLifecycleEvents = new RunLifecycleEvents();
  const runRuntime = new RunApplicationRuntime({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
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
    dataDir,
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
    fetchImpl,
    trackToolUsage: false,
  });
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
    triggerConfig: { rules: [], debounceMs: 0 },
    fetchImpl,
    enableDailySession: options.enableDailySession ?? true,
  });
  const machineStore: TaskMonitorStateStore = new MachineStateStore(
    path.join(dataDir, 'state-machines', 'snapshots.json'),
    taskMonitorStateStoreCodec,
  );
  const machineRuntime: TaskMonitorMachineRuntime = new MachineRuntime(machineStore);
  const machineRegistry: TaskMonitorMachineRegistry = new MachineRegistry(machineRuntime);
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
  >(machineStore, machineRuntime, machineRegistry, monitorRuntime.taskMonitorEffectHandlers);
  const recovery = new MachineRecovery(machineStore, machineRegistry, effectRunner);
  const stateMachineRuntime = new StateMachineApplicationRuntime(
    [hostMachine('task-monitor', recovery, effectRunner)],
    infrastructure.logger.child({ component: 'state-machine.application' }),
  );
  const taskMonitorStateMachineInputAdapter = new TaskMonitorStateMachineInputAdapter(
    new AddressedMachineAdmission(machineRegistry),
    undefined,
    machineStore,
  );
  monitorRuntime.connectTaskMonitorProviderEvents(
    agentOutputEvents,
    taskMonitorStateMachineInputAdapter,
    machineStore,
  );
  const platformRuntime = new PlatformApplicationRuntime({
    apiBaseUrl: infrastructure.normalizedApiBaseUrl,
    apiRuntime: infrastructure.apiRuntime,
    initialAccessToken: 'test-access-token',
    keyPairStore: infrastructure.keyPairStore,
    runStore: infrastructure.runStore,
    runRegistry: runRuntime.runRegistry,
    runChangedFilesReader: runRuntime.runChangedFilesReader,
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
    logger: infrastructure.logger,
    taskMonitorStateMachineInputAdapter,
    fetchImpl,
  });
  const applicationLifecycle = new LocalAgentApplicationLifecycle({
    platformRuntime,
    stateMachineRuntime,
    monitorRuntime,
    monitorEventSources,
    runRuntime,
    infrastructure,
    logger: infrastructure.logger,
    runRetentionMaintenance: new RunRetentionMaintenance(
      infrastructure.runStore,
      new RunRetentionSettingsStore(dataDir),
      infrastructure.logger,
    ),
    // Machine actions read readiness on construction; these runtime tests
    // script the platform transport, so the actions here never reach it.
    machineActions: new MachineActions({
      oauthClient: {
        isAuthenticated: () => Promise.resolve(true),
        logout: () => Promise.resolve({ success: true, data: undefined }),
        onAuthChanged: () => () => undefined,
      },
      platformWebSocketManager: infrastructure.platformWebSocketManager,
      machineControllerAuthority: {
        readReadiness: () => new Promise(() => undefined),
        addController: () => Promise.resolve({ outcome: 'failed' }),
      },
      pair: () => Promise.resolve({ outcome: 'failed' }),
      logger: infrastructure.logger,
    }),
  });
  if (options.runs) {
    vi.spyOn(runRuntime.runRegistry, 'list').mockReturnValue(options.runs);
  }
  const runtime = new LocalAgentServerRuntime({
    httpServer: options.httpServer ?? infrastructure.httpServer,
    localAgentEndpoint: runRuntime.localAgentEndpoint,
    applicationLifecycle,
    logger: infrastructure.logger,
    host: options.host ?? 'localhost',
    preferredPort: options.preferredPort ?? 3847,
    projectBrowsers: infrastructure.projectBrowsers,
  });
  return {
    dataDir,
    runtime,
    applicationLifecycle,
    stateMachineRuntime,
    taskMonitorStateMachineInputAdapter,
    machineStore,
    effectRunner,
    machineRuntime,
    machineRegistry,
    monitorRuntime,
    infrastructure,
    agentService: runRuntime.agentService,
    messagePoster: runRuntime.messagePoster,
    localAgentEndpoint: runRuntime.localAgentEndpoint,
    runChangedFilesReader: runRuntime.runChangedFilesReader,
    runRegistry: runRuntime.runRegistry,
  };
};

export const createTestLocalAgentServerRuntime = (port = 3847): LocalAgentServerRuntime => {
  const { runtime } = createTestLocalAgentServerRuntimeOwners({ preferredPort: port });
  runtime.port = port;
  runtime.url = `http://localhost:${String(port)}`;
  return runtime;
};
