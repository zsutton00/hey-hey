/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../session/index';
import type { Run } from '../run/run';
import type { RunRegistry } from '../run/run-registry';
import { RunStore } from '../run-store/run-store';
import { ConversationRoomSubscriptions } from './conversation-room-subscriptions';
import type { ServerLogger } from './logger';
import { MonitorProjectContext } from './monitors/project-context';
import { createTestPlatformWebSocketManager } from './monitors/test-owners.test-support';
import { RunLifecycleEvents } from './run-lifecycle-events';

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
};

interface MakeSessionOverrides {
  agentic_session_id?: string;
  conversationId?: string | undefined;
  contextMetadata?: AgenticSession['contextMetadata'];
}

const makeSession = (overrides: MakeSessionOverrides = {}): AgenticSession =>
  ({
    agentic_session_id: overrides.agentic_session_id ?? 'run-1',
    conversationId: Object.prototype.hasOwnProperty.call(overrides, 'conversationId')
      ? overrides.conversationId
      : 'conv-1',
    contextMetadata: overrides.contextMetadata ?? {
      capturedAt: '2026-06-29T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: overrides.agentic_session_id ?? 'run-1',
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  }) as AgenticSession;

const makeLogger = (): ServerLogger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
});

const makeHarness = (seededRunIds: string[] = []) => {
  const runs = new Map<string, AgenticSession>();
  const logger = makeLogger();
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const learnedProjectIds: string[] = [];
  const lifecycle = new RunLifecycleEvents();
  const runRegistry = {
    list: vi.fn(() => seededRunIds.map((runId) => ({ runId }) as unknown as Run)),
  } as unknown as RunRegistry;
  const runStore = new RunStore();
  vi.spyOn(runStore, 'getRun').mockImplementation(async (runId) => runs.get(runId) ?? null);
  const platformWebSocketManager = createTestPlatformWebSocketManager();
  vi.spyOn(platformWebSocketManager, 'subscribe').mockImplementation(subscribe);
  vi.spyOn(platformWebSocketManager, 'unsubscribe').mockImplementation(unsubscribe);
  const projectContext = new MonitorProjectContext({
    runStore,
    platformWebSocketManager,
    logger,
  });
  vi.spyOn(projectContext, 'learn').mockImplementation((projectId) => {
    learnedProjectIds.push(projectId);
  });

  const subscriptions = new ConversationRoomSubscriptions({
    runRegistry,
    runLifecycleEvents: lifecycle,
    runStore,
    platformWebSocketManager,
    projectContext,
    logger,
    retryDelayMs: 10,
    maxAttempts: 3,
  });
  subscriptions.start();

  return {
    register: (runId: string) => lifecycle.publishRunRegistered(runId),
    remove: (runId: string) => lifecycle.publishRunRemoved(runId),
    runs,
    logger,
    subscribe,
    unsubscribe,
    learnedProjectIds,
    dispose: () => subscriptions.dispose(),
  };
};

describe('ConversationRoomSubscriptions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds already-registered runs without a local UI socket', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness(['run-1']);
    harness.runs.set('run-1', makeSession());

    await vi.advanceTimersByTimeAsync(10);

    expect(harness.subscribe).toHaveBeenCalledOnce();
    expect(harness.subscribe).toHaveBeenCalledWith('conv-1');
    expect(harness.learnedProjectIds).toEqual(['project-1']);

    harness.dispose();
  });

  it('retries a lifecycle registration until the run is persisted, then subscribes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();

    harness.register('run-1');
    await flushPromises();

    expect(harness.subscribe).not.toHaveBeenCalled();

    harness.runs.set('run-1', makeSession());
    await vi.advanceTimersByTimeAsync(10);

    expect(harness.subscribe).toHaveBeenCalledOnce();
    expect(harness.subscribe).toHaveBeenCalledWith('conv-1');
    expect(harness.logger.info).toHaveBeenCalledWith(
      'conversation-room.subscription.run_registered.subscribed',
      expect.objectContaining({ runId: 'run-1', conversationId: 'conv-1', attempts: 2 }),
    );

    harness.dispose();
  });

  it('bounds retries for unavailable persisted metadata', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();

    harness.register('run-1');
    await vi.advanceTimersByTimeAsync(30);

    expect(harness.subscribe).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      'conversation-room.subscription.register.skipped',
      expect.objectContaining({ runId: 'run-1', reason: 'run_not_found', attempts: 3 }),
    );

    harness.dispose();
  });

  it('cancels a pending retry when the Run is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();

    harness.register('run-1');
    await flushPromises();
    harness.remove('run-1');

    harness.runs.set('run-1', makeSession());
    await vi.advanceTimersByTimeAsync(10);

    expect(harness.subscribe).not.toHaveBeenCalled();
    expect(harness.unsubscribe).not.toHaveBeenCalled();
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'conversation-room.subscription.remove.cancelled_pending',
      expect.objectContaining({ runId: 'run-1', attempts: 1 }),
    );

    harness.dispose();
  });

  it('unsubscribes exactly once when a registered Run is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();
    harness.runs.set('run-1', makeSession());

    harness.register('run-1');
    await flushPromises();
    harness.remove('run-1');
    harness.remove('run-1');

    expect(harness.subscribe).toHaveBeenCalledOnce();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.unsubscribe).toHaveBeenCalledWith('conv-1');

    harness.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps a shared conversation room until every Run is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();
    harness.runs.set('run-1', makeSession({ conversationId: 'conv-shared' }));
    harness.runs.set(
      'run-2',
      makeSession({ agentic_session_id: 'run-2', conversationId: 'conv-shared' }),
    );

    harness.register('run-1');
    harness.register('run-2');
    await flushPromises();
    harness.remove('run-1');

    expect(harness.subscribe).toHaveBeenCalledOnce();
    expect(harness.unsubscribe).not.toHaveBeenCalled();

    harness.remove('run-2');
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.unsubscribe).toHaveBeenCalledWith('conv-shared');

    harness.dispose();
  });

  it('does not retry a persisted Run with no conversation id', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = makeHarness();
    harness.runs.set('run-1', makeSession({ conversationId: undefined }));

    harness.register('run-1');
    await vi.advanceTimersByTimeAsync(30);

    expect(harness.subscribe).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      'conversation-room.subscription.register.skipped',
      expect.objectContaining({ runId: 'run-1', reason: 'no_conversation_id', attempts: 1 }),
    );

    harness.dispose();
  });
});
