import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { TaskMonitorDecisionStore } from '../../agents/task-monitor/task-monitor-decision-store';
import { SessionMonitorEvaluationStore } from '../../agents/session-monitor';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { MessagePoster } from '../../run/message-poster';
import { RunStore } from '../../run-store/run-store';
import { createTestOAuthClient } from '../__tests__/helpers/test-oauth-client';
import { createTestLocalAgentService } from '../local-agent-service.test-support';
import { NOOP_LOGGER } from '../logger';
import { TaskMonitorManagedTurnRuntime } from '../task-monitor-managed-turn-runtime';
import { PlatformAuthContext, type PlatformAuth } from '../platform-auth-context';
import { PlatformWebSocketManager } from '../platform-ws';
import { TaskMonitorStartRuntime } from '../task-monitor-start';
import { AgentSessionReader } from './agent-session-reader';
import { MonitorProjectContext } from './project-context';
import type { MonitorRunnerDependencies } from './runner';

export const createTestPlatformWebSocketManager = (): PlatformWebSocketManager =>
  new PlatformWebSocketManager({
    serverUrl: 'http://monitor.test',
    oauthClient: createTestOAuthClient({
      getAccessToken: async () => ({
        success: false as const,
        error: 'Test PlatformWebSocketManager auth boundary was called unexpectedly.',
      }),
    }),
    keyPairStore: createTestKeyPairStore(),
    logger: NOOP_LOGGER,
  });

export const createTestPlatformAuthContext = (
  auth: PlatformAuth | null,
  accessToken: string | null = auth?.accessToken ?? null,
): PlatformAuthContext => {
  const projectContext = new MonitorProjectContext({
    runStore: new RunStore(),
    platformWebSocketManager: createTestPlatformWebSocketManager(),
    logger: NOOP_LOGGER,
  });
  if (auth) projectContext.learn(auth.projectId);
  const authContext = new PlatformAuthContext(
    createTestOAuthClient({
      getAccessToken: async () => ({
        success: false as const,
        error: 'Test PlatformAuthContext token boundary was called unexpectedly.',
      }),
    }),
    projectContext,
    NOOP_LOGGER,
  );
  vi.spyOn(authContext, 'resolve').mockResolvedValue(auth);
  if (accessToken !== null) {
    vi.spyOn(authContext, 'getAccessToken').mockResolvedValue(accessToken);
  }
  return authContext;
};

export const createTestAgentSessionReader = (
  readAgentSession: AgentSessionReader['readAgentSession'],
): AgentSessionReader => {
  const reader = new AgentSessionReader({
    apiBaseUrl: 'https://api.monitor.test',
    authProvider: createTestPlatformAuthContext(null),
    logger: NOOP_LOGGER,
    fetchImpl: vi.fn(),
  });
  vi.spyOn(reader, 'readAgentSession').mockImplementation(readAgentSession);
  return reader;
};

export const createTestTaskMonitorStartRuntime = (
  readMonitor: TaskMonitorStartRuntime['readMonitor'],
): TaskMonitorStartRuntime => {
  const runtime = new TaskMonitorStartRuntime({
    apiBaseUrl: 'https://api.monitor.test',
    fetchImpl: vi.fn(),
    authContext: createTestPlatformAuthContext(null, 'token'),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(runtime, 'readMonitor').mockImplementation(readMonitor);
  return runtime;
};

export const createTestMonitorRunnerDependencies = (): MonitorRunnerDependencies => {
  const authProvider = createTestPlatformAuthContext(null);
  const runStore = new RunStore();
  const platformWebSocketManager = createTestPlatformWebSocketManager();
  const agentService = createTestLocalAgentService({ runStore });
  vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(async () => {
    throw new Error('Test MonitorRunner agent boundary was called unexpectedly.');
  });
  vi.spyOn(agentService, 'sendMessage').mockImplementation(async () => {
    throw new Error('Test MonitorRunner message boundary was called unexpectedly.');
  });
  return {
    authProvider,
    agentService,
    runStore,
    platformWebSocketManager,
    agentSessionReader: createTestAgentSessionReader(async () => null),
    taskMonitorDecisionStore: new TaskMonitorDecisionStore(
      NOOP_LOGGER,
      new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
    ),
    sessionMonitorEvaluationStore: new SessionMonitorEvaluationStore(NOOP_LOGGER),
    turnSupervisionReceiptStorePath: path.join(
      os.tmpdir(),
      `heyhey-test-monitor-runner-${randomUUID()}.supervision.jsonl`,
    ),
    apiBaseUrl: 'https://api.monitor.test',
    fetchImpl: vi.fn(),
    logger: NOOP_LOGGER,
    keyPairStore: createTestKeyPairStore(),
  };
};
