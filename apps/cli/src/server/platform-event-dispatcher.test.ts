import { describe, expect, it, vi } from 'vitest';
import { RunStore } from '../run-store/run-store';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import { createTestRunRegistryWiring } from './__tests__/helpers/test-run-registry';
import { NOOP_LOGGER } from './logger';
import { createTestLocalAgentService } from './local-agent-service.test-support';
import { MonitorPipeline } from './monitors';
import { AgentSource } from './monitors/normalizer';
import {
  createTestMonitorRunnerDependencies,
  createTestPlatformAuthContext,
} from './monitors/test-owners.test-support';
import { DEFAULT_TRIGGER_CONFIG } from './monitors/trigger-config';
import { PlatformEventDispatcher } from './platform-event-dispatcher';
import type {
  PlatformEventListener,
  PlatformMonitorCommandHandler,
  PlatformWebSocketEvent,
} from './platform-ws';
import { PlatformWebSocketManager } from './platform-ws';
import { EntityReportIndex } from './reports/entity-report-index';
import { ReportInfluenceRuntime } from './reports/report-influence-runtime';
import { createTestTriggerVerificationRuntime } from './trigger-verification/test-owners.test-support';

const requireEventListener = (listener: PlatformEventListener | null): PlatformEventListener => {
  if (!listener) {
    throw new Error('Expected the platform event listener to be registered.');
  }
  return listener;
};

const canonical = {
  eventType: 'task.created',
  timestamp: '2026-07-26T00:00:00.000Z',
  origin: 'platform' as const,
  projectId: 'project-1',
  entityId: 'task-1',
};

const makeHarness = () => {
  let eventListener: PlatformEventListener | null = null;
  let monitorCommandHandler: PlatformMonitorCommandHandler | null = null;
  const unsubscribeEvent = vi.fn();
  const unsubscribeCommand = vi.fn();
  const runStore = new RunStore();
  const runRegistry = createTestRunRegistryWiring({ runStore }).runRegistry;
  const platformWebSocketManager = new PlatformWebSocketManager({
    serverUrl: 'https://platform.test',
    oauthClient: createTestOAuthClient({
      getAccessToken: async () => ({ success: false, error: 'not needed by dispatcher tests' }),
    }),
    keyPairStore: createTestKeyPairStore(),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(platformWebSocketManager, 'getCurrentUserId').mockReturnValue('user-1');
  vi.spyOn(platformWebSocketManager, 'onEvent').mockImplementation((listener) => {
    eventListener = listener;
    return unsubscribeEvent;
  });
  vi.spyOn(platformWebSocketManager, 'onMonitorCommand').mockImplementation((handler) => {
    monitorCommandHandler = handler;
    return unsubscribeCommand;
  });

  const triggerVerificationRuntime = createTestTriggerVerificationRuntime({
    runStore,
    runRegistry,
  });
  const handlePlatformEvent = vi
    .spyOn(triggerVerificationRuntime, 'handlePlatformEvent')
    .mockImplementation(async () => undefined);
  vi.spyOn(triggerVerificationRuntime, 'handleMonitorCommand').mockResolvedValue({
    status: 'ADMITTED',
    commandId: 'command-1',
    replayed: false,
  });

  const agentSource = new AgentSource(runRegistry);
  const normalizePlatformEvent = vi
    .spyOn(agentSource, 'normalizePlatformEvent')
    .mockReturnValue(canonical);
  const monitorPipeline = new MonitorPipeline({
    ...createTestMonitorRunnerDependencies(),
    monitors: [],
    triggerConfig: DEFAULT_TRIGGER_CONFIG,
    logger: NOOP_LOGGER,
  });
  const ingest = vi.spyOn(monitorPipeline, 'ingest').mockImplementation(() => undefined);
  const reportInfluenceRuntime = new ReportInfluenceRuntime({
    apiBaseUrl: 'https://api.test',
    fetchImpl: (async () => {
      throw new Error('Unexpected fetch in PlatformEventDispatcher test.');
    }) as typeof fetch,
    authContext: createTestPlatformAuthContext(null),
    runStore,
    agentService: createTestLocalAgentService({ runStore }),
    index: new EntityReportIndex(),
    logger: NOOP_LOGGER,
  });
  const handleReportInfluenceEvent = vi
    .spyOn(reportInfluenceRuntime, 'handlePlatformEvent')
    .mockImplementation(() => undefined);

  const dispatcher = new PlatformEventDispatcher({
    platformWebSocketManager,
    triggerVerificationRuntime,
    agentSource,
    monitorPipeline,
    reportInfluenceRuntime,
    logger: NOOP_LOGGER,
  });

  return {
    dispatcher,
    dispatchEvent: (event: PlatformWebSocketEvent) => requireEventListener(eventListener)(event),
    getMonitorCommandHandler: () => monitorCommandHandler,
    normalizePlatformEvent,
    ingest,
    handleReportInfluenceEvent,
    handlePlatformEvent,
    unsubscribeEvent,
    unsubscribeCommand,
    dispose: () => {
      dispatcher.dispose();
      monitorPipeline.dispose();
    },
  };
};

describe('PlatformEventDispatcher', () => {
  it('owns subscriptions and routes same-user activity through named owners', () => {
    const harness = makeHarness();
    const event: PlatformWebSocketEvent = {
      type: 'task.created',
      timestamp: '2026-07-26T00:00:00.000Z',
      organizationId: 'organization-1',
      projectId: 'project-1',
      userId: 'user-1',
      taskId: 'task-1',
    };

    harness.dispatcher.start();
    harness.dispatchEvent(event);

    expect(harness.normalizePlatformEvent).toHaveBeenCalledOnce();
    expect(harness.ingest).toHaveBeenCalledWith(canonical);
    expect(harness.handleReportInfluenceEvent).toHaveBeenCalledWith(event);
    expect(harness.handlePlatformEvent).toHaveBeenCalledWith(event);
    expect(harness.getMonitorCommandHandler()).not.toBeNull();

    harness.dispose();
    expect(harness.unsubscribeEvent).toHaveBeenCalledOnce();
    expect(harness.unsubscribeCommand).toHaveBeenCalledOnce();
  });

  it('routes activity without an event user through monitors and reports', () => {
    const harness = makeHarness();
    const event: PlatformWebSocketEvent = {
      type: 'task.status_changed',
      timestamp: '2026-07-26T00:00:00.000Z',
      organizationId: 'organization-1',
      taskId: 'task-1',
    };

    harness.dispatcher.start();
    harness.dispatchEvent(event);

    expect(harness.normalizePlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'task.status_changed', entityId: 'task-1' }),
    );
    expect(harness.ingest).toHaveBeenCalledWith(canonical);
    expect(harness.handleReportInfluenceEvent).toHaveBeenCalledWith(event);
    expect(harness.handlePlatformEvent).toHaveBeenCalledWith(event);
    harness.dispose();
  });

  it('routes activity from another user through monitors and reports', () => {
    const harness = makeHarness();
    const event: PlatformWebSocketEvent = {
      type: 'task.status_changed',
      timestamp: '2026-07-26T00:00:00.000Z',
      organizationId: 'organization-1',
      userId: 'user-2',
      taskId: 'task-1',
    };

    harness.dispatcher.start();
    harness.dispatchEvent(event);

    expect(harness.normalizePlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'task.status_changed', userId: 'user-2' }),
    );
    expect(harness.ingest).toHaveBeenCalledWith(canonical);
    expect(harness.handleReportInfluenceEvent).toHaveBeenCalledWith(event);
    expect(harness.handlePlatformEvent).toHaveBeenCalledWith(event);
    harness.dispose();
  });
});
